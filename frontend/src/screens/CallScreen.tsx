import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Animated, { FadeIn, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { Check, Mic, PhoneOff } from "lucide-react-native";
import type { BusinessAction, BusinessId } from "@/types";
import { getBusiness } from "@/constants/businesses";
import { palette } from "@/constants/theme";
import { useVoiceRecorder, type RecordingIssue } from "@/hooks/useVoiceRecorder";
import { sendCallTurn } from "@/api/call";
import { useConversationStore } from "@/store/useConversationStore";
import { formatDuration } from "@/utils/time";
import { ScreenContainer, Waveform } from "@/components";
import { useThemeColors } from "@/hooks/useThemeColors";

/**
 * Reanimated `entering` animations stall under react-native-web: the view mounts
 * at its initial opacity and never advances until something forces a repaint, so
 * the screen sits there greyed out or invisible. Web gets the same layout with
 * no entrance; the phone keeps it.
 */
const WEB = Platform.OS === "web";

/**
 * Where the line is. Exactly one of these is true at any moment, and every
 * transition below is written out explicitly.
 *
 *   connecting ──► listening ──(tap)──► thinking ──► speaking ──┐
 *                      ▲                                        │
 *                      └────────────────────────────────────────┘
 *                      ▲                                        │
 *                    error ◄────────────(anything fails)────────┘
 *
 * An earlier version expressed this as a declarative effect — "if idle and not
 * muted, open the mic" — which deadlocked: the effect skipped itself while a
 * start was in flight, and since the guard was a ref, nothing re-ran it when the
 * guard cleared. The call sat on idle with a live-looking button and a dead mic.
 * Transitions are now made by the functions that cause them.
 */
type Phase = "connecting" | "listening" | "thinking" | "speaking" | "error";

interface Line {
  who: "you" | "agent";
  text: string;
  receipt?: BusinessAction;
  /** A placeholder shown while the runtime works; dropped when the answer lands. */
  hold?: boolean;
}

const PHASE_LABEL: Record<Phase, string> = {
  connecting: "Connecting…",
  listening: "Listening…",
  thinking: "Working on it…",
  speaking: "Speaking…",
  error: "Something went wrong",
};

/** Why capture failed, in words that say what to do next. */
const ISSUE_MESSAGE: Record<RecordingIssue, string> = {
  "permission-denied":
    "Sahayak needs microphone access to take a call. Enable it in Settings → Apps → Sahayak → Permissions.",
  "web-unsupported": "This browser can't record. Open the call on the app instead.",
  "recorder-error":
    "The microphone couldn't start. Close anything else using it and try again.",
};

/**
 * What the assistant says while it works. A call cannot go quiet — dead air on a
 * phone line reads as a dropped call — and a real lookup takes a few seconds.
 * Shown rather than spoken: synthesising it would cost another round trip and
 * delay the very thing it exists to cover.
 */
const HOLD_LINE = "One moment — I'm working on that. Please hold.";

/** Sarvam rejects clips over 30s, so a turn is sent before it can get there. */
const MAX_CLIP_MS = 25000;

/** Below this there is nothing to transcribe; resume rather than send silence. */
const MIN_CLIP_MS = 700;

/** How long an error stays up before the caller gets another go. */
const ERROR_RECOVERY_MS = 2500;

/** A reply that never reports finishing must not hold the line forever. */
const PLAYBACK_CEILING_MS = 30000;

/**
 * A hands-free voice call over the UCXP runtime.
 *
 * Each turn is one `POST /voice`: speech in → the same manifest-driven
 * resolution the app and WhatsApp use → the answer spoken back. When
 * `businessId` is set the call is that merchant's own line and never routes
 * elsewhere; without it the runtime picks the business from what's said,
 * exactly like the central chat.
 *
 * The caller ends their own turn with the button. Ending it automatically on
 * silence was tried and removed: it needs a level that means "talking", and no
 * such number exists across devices — the same quiet room measured -24dB on the
 * test handset and the code assumed -50, so every sample counted as speech and
 * turns never ended.
 */
export function CallScreen({
  businessId,
  conversationId: startedFrom,
}: {
  businessId?: BusinessId;
  /**
   * The chat this call continues. The runtime keys a conversation's sticky
   * business, collected facts and pending action on this id, so carrying it in
   * means the caller doesn't have to repeat the order number they just typed —
   * a call placed from a thread is the same conversation, in a different medium.
   */
  conversationId?: string;
}) {
  const router = useRouter();
  const { colors } = useThemeColors();
  const business = businessId ? getBusiness(businessId) : null;

  const { isRecording, durationMs, start, stop, cancel } = useVoiceRecorder();
  const recordTurn = useConversationStore((s) => s.recordVoiceTurn);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const conversationId = useRef<string | undefined>(startedFrom);
  const player = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  /** False once the screen is gone; every async step checks it before setState. */
  const live = useRef(true);
  /** Guards re-entry. Safe as refs because every caller is an explicit event. */
  const opening = useRef(false);
  const sending = useRef(false);
  const recovery = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  /** Open the mic. The only way into `listening`. */
  const listen = useCallback(async () => {
    if (!live.current || opening.current || sending.current) return;
    opening.current = true;
    try {
      setError(null);
      setPhase("connecting");
      const result = await start();
      if (!live.current) return;
      if (!result.ok) {
        setDenied(result.issue === "permission-denied");
        setError(ISSUE_MESSAGE[result.issue ?? "recorder-error"]);
        setPhase("error");
        return;
      }
      setDenied(false);
      setPhase("listening");
    } finally {
      opening.current = false;
    }
  }, [start]);

  /** Show why a turn failed, then hand the mic back. */
  const failTurn = useCallback((message: string) => {
    setLines((prev) => prev.filter((l) => !l.hold));
    setError(message);
    setPhase("error");
    // A failed turn must not end the call. On a phone line you get to repeat
    // yourself; a dead mic afterwards is indistinguishable from a crash.
    if (recovery.current) clearTimeout(recovery.current);
    recovery.current = setTimeout(() => {
      if (live.current) void listen();
    }, ERROR_RECOVERY_MS);
  }, [listen]);

  /**
   * Stop and release the player.
   *
   * `remove()` alone was leaving the reply playing after the screen was gone:
   * the caller navigates away, the component unmounts, and the voice carries on
   * over whatever they opened next. Pausing first is what actually silences it.
   */
  const silence = useCallback(() => {
    const p = player.current;
    player.current = null;
    if (!p) return;
    try {
      p.pause();
    } catch {
      /* already stopped */
    }
    try {
      p.remove();
    } catch {
      /* already released */
    }
  }, []);

  /** Play the spoken reply; resolves when it has finished. */
  const play = useCallback(async (base64: string) => {
    // Navigated away while the answer was in flight — do not start talking.
    if (!base64 || !live.current) return;
    try {
      // Speaker, not earpiece — a call screen that plays quietly reads as broken.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      silence();
      if (!live.current) return;
      const p = createAudioPlayer({ uri: `data:audio/wav;base64,${base64}` });
      player.current = p;
      p.play();
      await new Promise<void>((resolve) => {
        const startedAt = Date.now();
        const tick = setInterval(() => {
          const done = !p.playing && Date.now() - startedAt > 400;
          // Leaving the screen ends playback immediately, not when the clip
          // happens to finish.
          if (done || !live.current || Date.now() - startedAt > PLAYBACK_CEILING_MS) {
            clearInterval(tick);
            resolve();
          }
        }, 200);
      });
    } catch {
      // The text is already on screen; a playback failure must not end the call.
    } finally {
      // Release the player as soon as it is done, not when the next reply
      // starts. On Android a live player holds audio focus, and the recorder
      // that opens for the caller's next turn then captures nothing — the call
      // looks alive and goes deaf from the second turn on.
      silence();
    }
  }, [silence]);

  /** End the caller's turn, resolve it, speak the answer, then listen again. */
  const send = useCallback(async () => {
    if (!live.current || sending.current) return;
    sending.current = true;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const clip = await stop();
      if (!live.current) return;

      if (!clip.uri) {
        failTurn("Nothing was recorded. Try again.");
        return;
      }
      // A tap that lands almost immediately isn't a turn — reopen rather than
      // posting a fraction of a second of nothing and answering it.
      if (clip.durationMs < MIN_CLIP_MS) {
        await listen();
        return;
      }

      setPhase("thinking");
      setLines((prev) => [...prev, { who: "agent", text: HOLD_LINE, hold: true }]);

      const turn = await sendCallTurn({
        uri: clip.uri,
        conversationId: conversationId.current,
        businessId,
      });
      if (!live.current) return;

      conversationId.current = turn.conversationId;
      // Write the turn into the thread as well, so the call and the chat are
      // one history rather than two that can't see each other.
      recordTurn(turn.conversationId, turn.transcript, turn.reply, {
        businessId: (turn.businessId as BusinessId | undefined) ?? businessId,
        receipt: turn.receipt,
      });
      setLines((prev) => [
        ...prev.filter((l) => !l.hold),
        { who: "you", text: turn.transcript },
        { who: "agent", text: turn.reply, receipt: turn.receipt },
      ]);

      setPhase("speaking");
      await play(turn.audioBase64);
      if (!live.current) return;
    } catch (err) {
      if (!live.current) return;
      failTurn(err instanceof Error ? err.message : "That didn't go through.");
      return;
    } finally {
      sending.current = false;
    }
    // Outside the guard, so the next turn isn't blocked by this one's flag.
    if (live.current) void listen();
  }, [stop, listen, failTurn, play, businessId, recordTurn]);

  /** The caller pressed the button: stop if recording, otherwise reopen. */
  const onMicPress = useCallback(() => {
    if (isRecording) void send();
    else void listen();
  }, [isRecording, send, listen]);

  const endCall = useCallback(async () => {
    live.current = false;
    if (recovery.current) clearTimeout(recovery.current);
    silence();
    await cancel();
    router.back();
  }, [cancel, router, silence]);

  /** Answer as soon as the screen is up — tapping Call was the whole gesture. */
  useEffect(() => {
    live.current = true;
    void listen();
    return () => {
      live.current = false;
      if (recovery.current) clearTimeout(recovery.current);
      silence();
      void cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Leaving the app ends the turn in progress; coming back reopens the mic.
   *
   * There is no foreground service behind this call, so Android stops feeding us
   * audio regardless — carrying on would only bank silence. "background" only:
   * "inactive" fires for anything that briefly covers the window.
   */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (!live.current) return;
      if (next === "background") {
        void cancel();
        silence();
        sending.current = false;
        setPhase("connecting");
      } else if (next === "active" && !sending.current) {
        void listen();
      }
    });
    return () => sub.remove();
  }, [cancel, listen, silence]);

  /** Sarvam's 30s ceiling: send the turn before the clip becomes unusable. */
  useEffect(() => {
    if (isRecording && durationMs >= MAX_CLIP_MS) void send();
  }, [isRecording, durationMs, send]);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [lines.length]);

  const busy = phase === "thinking" || phase === "speaking";

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
        ref={scrollRef}
        className="mt-6 flex-1 px-5"
        contentContainerClassName="pb-4"
        showsVerticalScrollIndicator={false}
      >
        {lines.length === 0 && !error ? (
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
            {denied && Platform.OS !== "web" ? (
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
          {isRecording ? (
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

        {isRecording ? (
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
            onPress={onMicPress}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={isRecording ? "Stop and send" : "Start speaking"}
            className="h-20 w-20 items-center justify-center rounded-full"
            style={{
              // Driven by the recorder itself, never by our idea of the phase:
              // a button that shows "recording" while nothing is being captured
              // is how this screen came to lie about what the call was doing.
              backgroundColor: isRecording ? palette.accent : busy ? colors.hairline : "transparent",
              borderWidth: isRecording ? 0 : 2,
              borderColor: busy ? colors.hairline : palette.accent,
            }}
          >
            {isRecording ? (
              <View className="h-6 w-6 rounded-[5px] bg-white" />
            ) : (
              <Mic size={30} color={busy ? colors.textMuted : palette.accent} strokeWidth={2.2} />
            )}
          </Pressable>
        </View>

        <Text className="mt-4 text-center text-[12px] text-ink-faint dark:text-white/30">
          {isRecording
            ? "Tap when you've finished speaking"
            : phase === "thinking"
              ? "Working on it — the mic is off for a moment"
              : phase === "speaking"
                ? "Speaking — the mic comes back on straight after"
                : phase === "error"
                  ? "Tap the mic to try again"
                  : "Opening the mic…"}
        </Text>
      </View>
    </ScreenContainer>
  );
}
