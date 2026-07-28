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
 * Silence that ends a turn. Long enough to survive the pause in the middle of
 * "my order is… 1001", short enough that the reply doesn't feel late.
 */
const END_OF_TURN_MS = 1400;

/** An open mic that never hears anything closes rather than recording the room. */
const NO_SPEECH_TIMEOUT_MS = 9000;

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
  /** Set when a reply finishes playing, so the next turn opens the mic itself. */
  const resume = useRef(false);
  const player = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const live = useRef(true);
  /** Null until asked. False ⇒ the mic is blocked and speaking is pointless. */
  const [micAllowed, setMicAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
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
          if (done || Date.now() - started > 60_000) {
            clearInterval(tick);
            resolve();
          }
        }, 250);
      });
    } catch {
      // Text is already on screen; a playback failure must not end the call.
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
      // A real call doesn't ask you to press anything between sentences.
      resume.current = true;
      setPhase("idle");
    } catch (err) {
      if (!live.current) return;
      setLines((prev) => prev.filter((l) => !l.hold));
      setPhase("error");
      setError(err instanceof Error ? err.message : "That didn't go through.");
    }
  }, [businessId, finish, play]);

  const beginTurn = useCallback(async () => {
    setError(null);
    setPhase("listening");
    await start();
  }, [start]);

  /**
   * Hand the turn back to the caller once the reply has been spoken.
   *
   * Kept in an effect rather than called straight from completeTurn: that
   * function is still on the stack inside `play()` when the audio ends, and
   * starting a recording from there races the player's own teardown.
   */
  useEffect(() => {
    if (phase !== "idle" || !resume.current) return;
    resume.current = false;
    if (!live.current || micAllowed !== true) return;
    void beginTurn();
  }, [phase, micAllowed, beginTurn]);

  /**
   * End the caller's turn when they stop talking, the way a person would.
   *
   * Two guards keep it from firing on its own: the meter has to have heard
   * actual speech first, so an open mic in a quiet room waits instead of
   * sending an empty clip; and a turn that hears nothing at all eventually
   * gives up rather than recording until the 30s ceiling.
   */
  useEffect(() => {
    // No real capture (web, or a blocked mic): the meter reads nothing, so
    // ending the turn on silence would just hide the actual problem. Let the
    // caller tap ✓ and get the explicit reason instead.
    if (phase !== "listening" || issue) return;

    if (loudness.heardSpeech && loudness.silentMs >= END_OF_TURN_MS) {
      void completeTurn();
      return;
    }
    if (!loudness.heardSpeech && durationMs >= NO_SPEECH_TIMEOUT_MS) {
      void cancel();
      setPhase("idle");
    }
  }, [phase, issue, loudness, durationMs, completeTurn, cancel]);

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
          {phase === "listening" ? (
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
            onPress={phase === "listening" ? completeTurn : beginTurn}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={
              phase === "listening"
                ? "Send now"
                : phase === "thinking" || phase === "speaking"
                  ? "Microphone off while the assistant replies"
                  : "Speak"
            }
            className="h-20 w-20 items-center justify-center rounded-full"
            style={{
              backgroundColor: busy ? colors.hairline : palette.accent,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {phase === "listening" ? (
              <Check size={32} color="#FFFFFF" strokeWidth={2.5} />
            ) : phase === "thinking" || phase === "speaking" ? (
              <MicOff size={30} color={colors.textMuted} strokeWidth={2.2} />
            ) : (
              <Mic size={30} color={busy ? colors.textMuted : "#FFFFFF"} strokeWidth={2.2} />
            )}
          </Pressable>
        </View>

        <Text className="mt-4 text-center text-[12px] text-ink-faint dark:text-white/30">
          {phase === "listening"
            ? loudness.heardSpeech
              ? "Just stop talking when you're done"
              : "Go ahead — I'm listening"
            : micAllowed === null
              ? "Waiting for microphone access…"
              : micAllowed === false
                ? "Microphone access is needed to call"
                : phase === "thinking"
                  ? "Working on it — the mic is off for a moment"
                  : phase === "speaking"
                    ? "Speaking — the mic comes back on straight after"
                    : "Tap the mic to start. It stays on between replies."}
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
