import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Animated, { FadeIn, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { AudioModule, createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { Check, Mic, PhoneOff } from "lucide-react-native";
import type { BusinessAction, BusinessId } from "@/types";
import { getBusiness } from "@/constants/businesses";
import { palette } from "@/constants/theme";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { sendCallTurn } from "@/api/call";
import { formatDuration } from "@/utils/time";
import { BusinessBadge, ScreenContainer, Waveform } from "@/components";
import { useThemeColors } from "@/hooks/useThemeColors";

/** Where a call turn currently is. Drives the whole screen. */
type Phase = "idle" | "listening" | "thinking" | "speaking" | "error";

interface Line {
  who: "you" | "agent";
  text: string;
  receipt?: BusinessAction;
}

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Tap to speak",
  listening: "Listening…",
  thinking: "Working on it…",
  speaking: "Speaking",
  error: "Something went wrong",
};

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

  const { isRecording, durationMs, start, finish, cancel } = useVoiceRecorder();
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const conversationId = useRef<string | undefined>(undefined);
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
        if (!cancelled) {
          setMicAllowed(false);
          setError("Calling needs a microphone, which this browser build can't use yet. Use the Android app to call.");
        }
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
          ? "Microphone access is blocked. Enable it in Settings → Apps → Sahayak → Permissions, then try again."
          : clip.issue === "web-unsupported"
            ? "Calling needs a microphone, which this browser build can't use yet. Use the Android app to call."
            : "The microphone couldn't start. Close any other app using it and try again."
      );
      if (clip.issue === "permission-denied") setMicAllowed(false);
      return;
    }

    setPhase("thinking");
    try {
      const turn = await sendCallTurn({
        uri: clip.uri,
        conversationId: conversationId.current,
        businessId,
      });
      if (!live.current) return;
      conversationId.current = turn.conversationId;
      setLines((prev) => [
        ...prev,
        { who: "you", text: turn.transcript },
        { who: "agent", text: turn.reply, receipt: turn.receipt },
      ]);
      setPhase("speaking");
      await play(turn.audioBase64);
      if (!live.current) return;
      setPhase("idle");
    } catch (err) {
      if (!live.current) return;
      setPhase("error");
      setError(err instanceof Error ? err.message : "That didn't go through.");
    }
  }, [businessId, finish, play]);

  const beginTurn = useCallback(async () => {
    setError(null);
    setPhase("listening");
    await start();
  }, [start]);

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

        {lines.map((line, i) => (
          <Animated.View
            key={i}
            entering={FadeInUp.duration(220)}
            className={`mb-3 ${line.who === "you" ? "items-end" : "items-start"}`}
          >
            <View
              className={`max-w-[88%] rounded-card px-4 py-3 ${
                line.who === "you"
                  ? "rounded-br-md bg-accent"
                  : "rounded-bl-md border border-hairline/70 bg-elevated dark:border-hairline-dark/70 dark:bg-elevated-dark"
              }`}
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
          <Animated.View entering={FadeIn} className="mt-2 items-center">
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
            accessibilityLabel={phase === "listening" ? "Send" : "Speak"}
            className="h-20 w-20 items-center justify-center rounded-full"
            style={{
              backgroundColor: busy ? colors.hairline : palette.accent,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {phase === "listening" ? (
              <Check size={32} color="#FFFFFF" strokeWidth={2.5} />
            ) : (
              <Mic size={30} color={busy ? colors.textMuted : "#FFFFFF"} strokeWidth={2.2} />
            )}
          </Pressable>
        </View>

        <Text className="mt-4 text-center text-[12px] text-ink-faint dark:text-white/30">
          {phase === "listening"
            ? "Tap ✓ when you've finished speaking"
            : micAllowed === null
              ? "Waiting for microphone access…"
              : micAllowed === false
                ? "Microphone access is needed to call"
                : busy
                  ? "One moment…"
                  : "Tap the mic, speak, then tap ✓"}
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
