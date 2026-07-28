import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Animated, { FadeIn, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { AudioModule, createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { Check, Mic, MicOff, PhoneOff } from "lucide-react-native";
import type { BusinessAction, BusinessId } from "@/types";
import { getBusiness } from "@/constants/businesses";
import { palette } from "@/constants/theme";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { sendCallTurn } from "@/api/call";
import { formatDuration } from "@/utils/time";
import { BusinessBadge, ScreenContainer, Waveform } from "@/components";
import { useThemeColors } from "@/hooks/useThemeColors";

/**
 * Reanimated `entering` animations stall under react-native-web: the view mounts
 * at its initial opacity and never advances until something forces a repaint, so
 * the screen sits there greyed out or invisible. Web gets the same layout with
 * no entrance; the phone keeps it.
 */
const WEB = Platform.OS === "web";

/** Where a call turn currently is. Drives the whole screen. */
type Phase = "idle" | "listening" | "thinking" | "speaking" | "error";

interface Line {
  who: "you" | "agent";
  text: string;
  receipt?: BusinessAction;
  /** A placeholder shown while the runtime works; dropped when the answer lands. */
  hold?: boolean;
}

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Tap to speak",
  listening: "Listening…",
  thinking: "Working on it…",
  speaking: "Speaking…",
  error: "Something went wrong",
};

/**
 * Silence that ends a turn.
 *
 * Short, because the caller is waiting through it: this pause sits in front of
 * every single reply. Sarvam's transcription tolerates a clipped tail far
 * better than a caller tolerates a hanging line, and the meter is sampled every
 * 120ms, so this is about as tight as it can be read.
 */
const END_OF_TURN_MS = 600;

/**
 * How long an unspoken-to mic records before the clip is thrown away and
 * started again. Sarvam rejects anything over 30s, so silence has to be
 * recycled rather than accumulated — the caller sees an open mic throughout.
 */
const SILENT_RECYCLE_MS = 20000;

/**
 * How long a turn runs on a device that reports no microphone level. Without a
 * meter there is no silence to detect, so the turn is simply timed — short
 * enough to stay conversational, long enough for a sentence.
 */
const UNMETERED_TURN_MS = 6000;

/** Absolute ceiling. Sarvam rejects clips over 30s; nothing should get close. */
const MAX_TURN_MS = 20000;

/** Longest a spoken reply is allowed to hold the line before the mic returns. */
const PLAYBACK_CEILING_MS = 30000;

/** How long the error stays on screen before the caller gets another go. */
const ERROR_RECOVERY_MS = 2500;

/**
 * What the assistant says while it works.
 *
 * A call cannot go quiet. The runtime takes a few seconds on a real lookup, and
 * dead air on a phone line reads as a dropped call — so the hold line goes up
 * the moment the caller stops talking, and is replaced by the real answer.
 * Shown, not spoken: synthesising it would cost another round trip and delay
 * the very thing it is covering for.
 */
const HOLD_LINE = "One moment — I'm working on that. Please hold.";

/**
 * A hands-free voice call over the UCXP runtime.
 *
 * Each turn is one `POST /voice`: speech in → the same manifest-driven
 * resolution the app and WhatsApp use → the answer spoken back. When
 * `businessId` is set the call is that merchant's own line and never routes
 * elsewhere; without it the runtime picks the business from what's said,
 * exactly like the central chat.
 */
export function CallScreen({ businessId }: { businessId?: BusinessId }) {
  const router = useRouter();
  const { colors } = useThemeColors();
  const business = businessId ? getBusiness(businessId) : null;

  const { durationMs, loudness, issue, start, finish, cancel } = useVoiceRecorder();
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const conversationId = useRef<string | undefined>(undefined);
  /** True while beginTurn is in flight, so the open-mic rule fires once. */
  const answering = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True once this turn is already closing, so the meter can't close it twice. */
  const ending = useRef(false);
  const player = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const live = useRef(true);
  /** Null until asked. False ⇒ the mic is blocked and speaking is pointless. */
  const [micAllowed, setMicAllowed] = useState<boolean | null>(null);
  /** Muted, exactly like the button on a phone call: the line stays open. */
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (retry.current) clearTimeout(retry.current);
      player.current?.remove();
      cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Ask for the microphone as the call opens, not when the caller has already
   * started talking. The recorder falls back to a *simulated* capture when
   * permission is missing, so without this a blocked mic looks like a call that
   * simply heard nothing — which is what it did before.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (Platform.OS === "web") {
        // The browser raises its own prompt on the first getUserMedia call,
        // which happens when recording starts. Asking here as well would show
        // two prompts, so enable the button and let the real request ask.
        if (!cancelled) setMicAllowed(true);
        return;
      }
      try {
        const granted = await AudioModule.requestRecordingPermissionsAsync();
        if (cancelled) return;
        setMicAllowed(granted.granted);
        if (!granted.granted) {
          setError(
            "Sahayak needs microphone access to take a call. Enable it in Settings → Apps → Sahayak → Permissions."
          );
        }
      } catch {
        if (!cancelled) {
          setMicAllowed(false);
          setError("The microphone couldn't be opened. Close any other app using it and reopen this screen.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Play the spoken reply; resolves when it finishes (or immediately if muted). */
  const play = useCallback(async (base64: string) => {
    if (!base64) return;
    try {
      // Speaker, not earpiece — a call screen that plays quietly reads as broken.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      player.current?.remove();
      const p = createAudioPlayer({ uri: `data:audio/wav;base64,${base64}` });
      player.current = p;
      p.play();
      // Wait for playback rather than cutting the reply off when we re-listen.
      await new Promise<void>((resolve) => {
        const started = Date.now();
        const tick = setInterval(() => {
          const done = !p.playing && Date.now() - started > 400;
          // A reply that somehow never reports finishing must not strand the
          // call in "speaking" — the caller would be left with a dead mic.
          if (done || Date.now() - started > PLAYBACK_CEILING_MS) {
            clearInterval(tick);
            resolve();
          }
        }, 200);
      });
    } catch {
      // Text is already on screen; a playback failure must not end the call.
    } finally {
      // Release the player the moment it is done rather than at the start of
      // the next reply. On Android a live player keeps audio focus, and the
      // recorder that opens for the caller's next turn then captures nothing —
      // the call looks alive and hears nothing from the second turn on.
      player.current?.remove();
      player.current = null;
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      } catch {
        // start() sets the mode too; this is only to hand the mic back sooner.
      }
    }
  }, []);

  const endCall = useCallback(async () => {
    live.current = false;
    player.current?.remove();
    await cancel();
    router.back();
  }, [cancel, router]);

  /** Stop recording, resolve the turn, speak the answer, then listen again. */
  const completeTurn = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const clip = await finish();
    if (!clip.uri) {
      // The recorder says *why* it produced nothing — pass that on rather than
      // a vague "nothing captured", which hid a denied permission.
      setPhase("error");
      setError(
        clip.issue === "permission-denied"
          ? Platform.OS === "web"
            ? "Microphone access was blocked. Allow it for this site (click the 🔒 in the address bar) and try again."
            : "Microphone access is blocked. Enable it in Settings → Apps → Sahayak → Permissions, then try again."
          : clip.issue === "web-unsupported"
            ? "This browser doesn't support recording. Try Chrome, Edge or Safari."
            : "The microphone couldn't start. Close anything else using it and try again."
      );
      if (clip.issue === "permission-denied") setMicAllowed(false);
      return;
    }

    setPhase("thinking");
    setLines((prev) => [...prev, { who: "agent", text: HOLD_LINE, hold: true }]);
    try {
      const turn = await sendCallTurn({
        uri: clip.uri,
        conversationId: conversationId.current,
        businessId,
      });
      if (!live.current) return;
      conversationId.current = turn.conversationId;
      setLines((prev) => [
        ...prev.filter((l) => !l.hold),
        { who: "you", text: turn.transcript },
        { who: "agent", text: turn.reply, receipt: turn.receipt },
      ]);
      setPhase("speaking");
      await play(turn.audioBase64);
      if (!live.current) return;
      // Back to idle, which the open-mic rule reads as "your turn".
      setPhase("idle");
    } catch (err) {
      if (!live.current) return;
      setLines((prev) => prev.filter((l) => !l.hold));
      setError(err instanceof Error ? err.message : "That didn't go through.");
      // A turn that fails must not end the call. Say what went wrong, then hand
      // the mic back — on a phone line you get to repeat yourself, and a dead
      // mic after one bad turn is indistinguishable from the app having hung.
      setPhase("error");
      retry.current = setTimeout(() => {
        if (live.current) setPhase("idle");
      }, ERROR_RECOVERY_MS);
    }
  }, [businessId, finish, play]);

  const beginTurn = useCallback(async () => {
    setError(null);
    ending.current = false;
    setPhase("listening");
    await start();
  }, [start]);

  /**
   * The line is open whenever nobody else is using it.
   *
   * Stated as a rule rather than a handoff: idle and unmuted means the mic is
   * on, full stop. The previous version set a "resume" flag when a reply
   * finished and cleared it on the way back, which meant any path that reached
   * idle without setting it — a mute toggle, a cancelled turn — left the call
   * up with a dead mic and no way back short of hanging up.
   *
   * `answering` keeps the effect from firing again while beginTurn is still in
   * flight, since start() is async and phase stays idle until it returns.
   */
  useEffect(() => {
    if (phase !== "idle" || muted || micAllowed !== true || !live.current) return;
    if (answering.current) return;
    answering.current = true;
    void beginTurn().finally(() => {
      answering.current = false;
    });
  }, [phase, muted, micAllowed, beginTurn]);

  /**
   * Mute, the way a phone does it: the call stays up, the far end just stops
   * hearing you. Unmuting picks the turn straight back up.
   */
  /** End the turn now, rather than waiting for the pause to be long enough. */
  const sendNow = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (ending.current) return;
    ending.current = true;
    void completeTurn();
  }, [completeTurn]);

  const toggleMute = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    // Decide from the current value and act outside the updater. A setState
    // updater must be pure — React is free to run it more than once, and side
    // effects in there fire twice for one press.
    const next = !muted;
    setMuted(next);
    if (next) {
      void cancel();
      setPhase("idle");
    } else if (phase === "idle") {
      void beginTurn();
    }
  }, [muted, cancel, phase, beginTurn]);

  /**
   * End the caller's turn when they stop talking, the way a person would.
   *
   * Three ways a turn can close, in order of preference:
   *
   *  1. Silence after speech — the real one. The meter has to have heard actual
   *     speech first, so an open mic in a quiet room waits rather than posting
   *     an empty clip.
   *  2. A fixed length, when the device gives us no meter at all. Waiting for
   *     silence we cannot observe is how a turn hangs open forever.
   *  3. A hard ceiling, always. Whatever else goes wrong, the mic closes.
   *
   * `ending` makes this idempotent: the meter ticks every 120ms and setPhase is
   * async, so without it a single pause fires completeTurn several times over.
   */
  useEffect(() => {
    if (phase !== "listening" || muted) return;

    const stop = () => {
      if (ending.current) return;
      ending.current = true;
      void completeTurn();
    };

    // No real capture (web, blocked mic). There is no ✓ to press any more, so
    // close the turn immediately: completeTurn reads the recorder's reason and
    // says what to do about it, which beats an open mic that never responds.
    if (issue) return stop();

    if (loudness.metered) {
      if (loudness.heardSpeech && loudness.silentMs >= END_OF_TURN_MS) return stop();
      // Nothing said yet: keep waiting, the way a call does. The clip is
      // recycled before it can reach Sarvam's 30s ceiling, so the mic can stay
      // open indefinitely without ever posting a recording of an empty room.
      if (!loudness.heardSpeech) {
        if (durationMs >= SILENT_RECYCLE_MS) {
          ending.current = true;
          void cancel().then(() => {
            if (live.current) setPhase("idle");
          });
        }
        return;
      }
    } else if (durationMs >= UNMETERED_TURN_MS) {
      return stop();
    }

    if (durationMs >= MAX_TURN_MS) stop();
  }, [phase, muted, issue, loudness, durationMs, completeTurn, cancel]);

  // Waiting on the permission answer, or denied — speaking would only produce
  // a simulated clip that fails at the end of the turn.
  const busy = phase === "thinking" || phase === "speaking" || micAllowed !== true;

  return (
    <ScreenContainer edges={["top", "bottom"]}>
      {/* Who you're calling */}
      <View className="items-center px-6 pt-2">
        {business ? (
          <>
            <View
              className="h-16 w-16 items-center justify-center rounded-3xl"
              style={{ backgroundColor: business.tint }}
            >
              <Text className="text-[30px]">{business.glyph}</Text>
            </View>
            <Text className="mt-3 text-[22px] font-bold text-ink dark:text-white">
              {business.name}
            </Text>
            <Text className="mt-0.5 text-[13px] text-ink-muted dark:text-white/50">
              Voice support · UCXP
            </Text>
          </>
        ) : (
          <>
            <Text className="text-[22px] font-bold text-ink dark:text-white">Sahayak</Text>
            <Text className="mt-0.5 text-[13px] text-ink-muted dark:text-white/50">
              Say the business you need
            </Text>
          </>
        )}
      </View>

      {/* Transcript so far — a call you can also read */}
      <ScrollView
        className="mt-6 flex-1 px-5"
        contentContainerClassName="pb-4"
        showsVerticalScrollIndicator={false}
      >
        {lines.length === 0 && phase === "idle" ? (
          <Text className="mt-8 text-center text-[15px] leading-[22px] text-ink-muted dark:text-white/40">
            {business
              ? `Ask about an order or a refund — ${business.name} answers here.`
              : "Ask about an order, a refund or a delivery."}
          </Text>
        ) : null}

        {/* Spacing carries the turn-taking. The chat screen has timestamps under
            every bubble to separate them; a call transcript has nothing, so an
            even gap makes four alternating lines read as one block. A change of
            speaker gets room, a continuation stays tucked under its own bubble. */}
        {lines.map((line, i) => (
          <Animated.View
            key={i}
            entering={WEB ? undefined : FadeInUp.duration(220)}
            className={`${
              i === 0 ? "" : lines[i - 1].who === line.who ? "mt-1.5" : "mt-5"
            } ${line.who === "you" ? "items-end" : "items-start"}`}
          >
            <View
              className={`max-w-[88%] rounded-card px-4 py-3 ${
                line.who === "you"
                  ? "rounded-br-md bg-accent"
                  : "rounded-bl-md border border-hairline/70 bg-elevated dark:border-hairline-dark/70 dark:bg-elevated-dark"
              }`}
              style={line.hold ? { opacity: 0.6 } : undefined}
            >
              <Text
                className={`text-[15px] leading-[21px] ${
                  line.who === "you" ? "text-white" : "text-ink dark:text-white"
                }`}
              >
                {line.text}
              </Text>
              {line.receipt ? (
                <View className="mt-2.5 flex-row items-center rounded-xl bg-emerald-50 px-3 py-2 dark:bg-emerald-500/10">
                  <Check size={15} color="#0EA66E" />
                  <Text className="ml-2 text-[13px] font-semibold" style={{ color: "#0EA66E" }}>
                    {line.receipt.label}
                  </Text>
                </View>
              ) : null}
            </View>
          </Animated.View>
        ))}

        {error ? (
          <Animated.View entering={WEB ? undefined : FadeIn} className="mt-5 items-center">
            <Text className="text-center text-[14px] leading-5 text-rose-500">{error}</Text>
            {micAllowed === false && Platform.OS !== "web" ? (
              <Pressable
                onPress={() => Linking.openSettings()}
                className="mt-3 rounded-full border border-hairline px-4 py-2 dark:border-hairline-dark"
              >
                <Text className="text-[13px] font-semibold text-accent">Open settings</Text>
              </Pressable>
            ) : null}
          </Animated.View>
        ) : null}
      </ScrollView>

      {/* Call controls */}
      <View className="items-center px-6 pb-6">
        <View className="h-14 w-full items-center justify-center">
          {muted ? (
            <Text className="text-[13px] font-semibold uppercase tracking-widest text-ink-faint dark:text-white/40">
              Muted
            </Text>
          ) : phase === "listening" ? (
            <Waveform active color={palette.accent} height={44} barCount={24} />
          ) : (
            <Text
              className={`text-[13px] font-semibold uppercase tracking-widest ${
                phase === "error" ? "text-rose-500" : "text-accent"
              }`}
            >
              {PHASE_LABEL[phase]}
            </Text>
          )}
        </View>

        {phase === "listening" ? (
          <Text className="mb-3 text-[26px] font-semibold text-ink dark:text-white">
            {formatDuration(durationMs)}
          </Text>
        ) : (
          <View className="mb-3 h-[34px]" />
        )}

        <View className="flex-row items-center gap-7">
          <Pressable
            onPress={endCall}
            accessibilityRole="button"
            accessibilityLabel="End call"
            className="h-16 w-16 items-center justify-center rounded-full bg-rose-500"
          >
            <PhoneOff size={26} color="#FFFFFF" />
          </Pressable>

          <Pressable
            onPress={phase === "listening" ? sendNow : toggleMute}
            disabled={micAllowed !== true || busy}
            accessibilityRole="button"
            accessibilityLabel={
              phase === "listening" ? "Stop and send" : muted ? "Turn the microphone on" : "Mute"
            }
            className="h-20 w-20 items-center justify-center rounded-full"
            style={{
              // Recording is the state that has to read across a room, so it's
              // the filled one — and it's the one you can press to end. Idle is
              // an outline, and while the assistant is talking it's dimmed,
              // because the mic really is closed and there's nothing to press.
              backgroundColor:
                phase === "listening" ? palette.accent : busy ? colors.hairline : "transparent",
              borderWidth: phase === "listening" ? 0 : 2,
              borderColor: busy ? colors.hairline : palette.accent,
              opacity: micAllowed === true ? 1 : 0.5,
            }}
          >
            {phase === "listening" ? (
              // The universal stop square, over a live level ring.
              <View className="h-6 w-6 rounded-[5px] bg-white" />
            ) : muted ? (
              <MicOff size={30} color={busy ? colors.textMuted : palette.accent} strokeWidth={2.2} />
            ) : (
              <Mic size={30} color={busy ? colors.textMuted : palette.accent} strokeWidth={2.2} />
            )}
          </Pressable>
        </View>

        <Text className="mt-4 text-center text-[12px] text-ink-faint dark:text-white/30">
          {micAllowed === null
            ? "Connecting…"
            : micAllowed === false
              ? "Microphone access is needed to call"
              : muted
                ? "Muted — tap the mic to speak again"
                : phase === "listening"
                  ? loudness.heardSpeech
                    ? "Just stop talking when you're done"
                    : "Go ahead — I'm listening"
                  : phase === "thinking"
                    ? "Working on it…"
                    : phase === "speaking"
                      ? "Speaking — you'll be back on straight after"
                      : "One moment…"}
        </Text>
      </View>

      {business ? (
        <View className="absolute right-5 top-3">
          <BusinessBadge businessId={business.id} size="sm" />
        </View>
      ) : null}
    </ScreenContainer>
  );
}
