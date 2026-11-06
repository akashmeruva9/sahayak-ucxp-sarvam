import { useState, useMemo } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import {
  Check,
  CheckCheck,
  CheckCircle2,
  Copy,
  FileText,
  Image as ImageIcon,
  Info,
  Paperclip,
  Sparkles,
  TriangleAlert,
  Volume2,
} from "lucide-react-native";
import type { Message } from "@/types";
import { formatClock } from "@/utils/time";
import { getBusiness, listBusinesses } from "@/constants/businesses";
import { palette } from "@/constants/theme";
import { useThemeColors } from "@/hooks/useThemeColors";
import { LoadingDots } from "./LoadingDots";

const Row = (Platform.OS === "web" ? View : Animated.View) as typeof Animated.View;
const ENTER = Platform.OS === "web" ? undefined : FadeInDown.duration(260);

const toneStyles = {
  success: { icon: CheckCircle2, color: "#0EA66E", bg: "bg-emerald-50 dark:bg-emerald-500/10" },
  warning: { icon: TriangleAlert, color: "#D97706", bg: "bg-amber-50 dark:bg-amber-500/10" },
  info: { icon: Info, color: "#2563EB", bg: "bg-blue-50 dark:bg-blue-500/10" },
} as const;

/** Known business glyph map for suggestion chips */
const BUSINESS_GLYPHS: Record<string, string> = {
  "deepika andhra pickles": "🌶️",
  "anna groceries": "🛒",
  airtel: "📱",
  boat: "🎧",
  apollo: "🏥",
  flipkart: "🛍️",
  "lakshmi fashion": "👗",
  "meena kitchen store": "🍳",
  nykaa: "💄",
  "ravi electronics": "⚡",
  "sri pharma": "💊",
};

/** Formatted text parser supporting **bold**, code, and bullet lists */
function FormattedMessageText({
  text,
  isError = false,
}: {
  text: string;
  isError?: boolean;
}) {
  const lines = text.split("\n");

  return (
    <View className="gap-1.5">
      {lines.map((line, lIdx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <View key={lIdx} className="h-1.5" />;
        }

        // Bullet point line
        const isBullet = trimmed.startsWith("- ") || trimmed.startsWith("• ") || trimmed.startsWith("* ");
        const content = isBullet ? trimmed.replace(/^[-•*]\s+/, "") : trimmed;

        // Split by **bold**
        const parts = content.split(/(\*\*[^*]+\*\*)/g);

        return (
          <View key={lIdx} className={`flex-row items-start ${isBullet ? "pl-2" : ""}`}>
            {isBullet ? (
              <Text className="mr-2 text-[14px] font-bold text-accent dark:text-accent">•</Text>
            ) : null}
            <Text
              className={`flex-1 text-[15px] leading-[23px] ${
                isError
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-ink dark:text-zinc-100"
              }`}
            >
              {parts.map((part, pIdx) => {
                if (part.startsWith("**") && part.endsWith("**")) {
                  return (
                    <Text key={pIdx} className="font-bold text-ink dark:text-white">
                      {part.slice(2, -2)}
                    </Text>
                  );
                }
                return <Text key={pIdx}>{part}</Text>;
              })}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

interface ChatBubbleProps {
  message: Message;
  onSelectSuggestion?: (text: string) => void;
}

export function ChatBubble({ message, onSelectSuggestion }: ChatBubbleProps) {
  const isUser = message.role === "user";
  const { colors } = useThemeColors();
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // Extract suggestions dynamically when the assistant asks or offers choices
  const suggestions = useMemo(() => {
    if (isUser || !message.text) return [];

    const lower = message.text.toLowerCase();
    const found: Array<{ label: string; glyph: string; query: string }> = [];

    // If assistant asks "Which business is this about?" or lists businesses
    if (lower.includes("which business") || lower.includes("i can help with")) {
      const allKnown = listBusinesses();
      for (const b of allKnown) {
        if (lower.includes(b.name.toLowerCase())) {
          found.push({
            label: b.name,
            glyph: BUSINESS_GLYPHS[b.name.toLowerCase()] || b.glyph || "🏢",
            query: b.name,
          });
        }
      }
    }

    // If assistant offers specific capabilities
    if (lower.includes("track order") && !found.some((f) => f.label === "Track Order")) {
      found.push({ label: "Track Order", glyph: "📦", query: "track order" });
    }
    if (lower.includes("refund") && !found.some((f) => f.label === "Request Refund")) {
      found.push({ label: "Request Refund", glyph: "💸", query: "request refund" });
    }

    return found;
  }, [isUser, message.text]);

  const handleCopy = () => {
    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSpeak = () => {
    if (Platform.OS === "web" && typeof window !== "undefined" && window.speechSynthesis) {
      if (speaking) {
        window.speechSynthesis.cancel();
        setSpeaking(false);
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message.text);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    }
  };

  if (isUser) {
    const attachment = message.attachment;
    const AttachIcon =
      attachment?.kind === "pdf" ? FileText : attachment?.kind === "image" ? ImageIcon : Paperclip;

    return (
      <Row entering={ENTER} className="mb-4 items-end">
        <View className="max-w-[84%] rounded-2xl rounded-tr-xs bg-accent px-4 py-3 shadow-sm">
          {attachment ? (
            <View
              className={`flex-row items-center rounded-xl bg-white/20 px-3 py-2 ${
                message.text ? "mb-2.5" : ""
              }`}
            >
              <AttachIcon size={16} color="#FFFFFF" />
              <Text
                className="ml-2 flex-shrink text-[13.5px] font-semibold text-white"
                numberOfLines={1}
              >
                {attachment.name}
              </Text>
            </View>
          ) : null}

          {message.text ? (
            <Text className="text-[15px] font-normal leading-[22px] text-white">
              {message.text}
            </Text>
          ) : null}

          <View className="mt-1.5 flex-row items-center justify-end">
            <Text className="text-[11px] font-medium text-white/70">
              {formatClock(message.createdAt)}
            </Text>
            <View className="ml-1 opacity-80">
              <CheckCheck size={13} color="#FFFFFF" strokeWidth={2.5} />
            </View>
          </View>
        </View>
      </Row>
    );
  }

  const tone = message.action?.tone ?? "info";
  const toneStyle = toneStyles[tone];
  const ToneIcon = toneStyle.icon;
  const business = getBusiness(message.businessId);

  return (
    <Row entering={ENTER} className="mb-5 items-start">
      <View className="w-full flex-row items-start">
        {/* Assistant Avatar */}
        <View
          className="mr-2.5 mt-1 h-8 w-8 items-center justify-center rounded-full shadow-xs"
          style={{
            backgroundColor: message.businessId ? business.tint : palette.accent + "18",
          }}
        >
          {message.businessId ? (
            <Text className="text-[14px]">{business.glyph || "🏢"}</Text>
          ) : (
            <Sparkles size={16} color={palette.accent} strokeWidth={2.4} />
          )}
        </View>

        <View className="max-w-[85%] flex-1">
          {/* Assistant Name Label */}
          <View className="mb-1.5 flex-row items-center">
            <Text className="text-[12.5px] font-semibold text-ink dark:text-zinc-200">
              {message.businessId ? business.name : "Sahayak"}
            </Text>
            {message.businessId ? (
              <View className="ml-1.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 dark:bg-emerald-500/20">
                <Text className="text-[9.5px] font-bold text-emerald-600 dark:text-emerald-400">
                  VERIFIED
                </Text>
              </View>
            ) : null}
          </View>

          {/* Bubble Card */}
          <View className="rounded-2xl rounded-tl-xs border border-hairline/90 bg-surface px-4 py-3.5 shadow-xs dark:border-white/[0.08] dark:bg-elevated-dark">
            {message.pending ? (
              <View className="py-2">
                <LoadingDots />
              </View>
            ) : (
              <>
                <FormattedMessageText
                  text={message.text}
                  isError={message.status === "error"}
                />

                {/* UCXP Resolution Receipt Card */}
                {message.action ? (
                  <View className={`mt-3.5 overflow-hidden rounded-2xl border border-emerald-500/30 p-3.5 ${toneStyle.bg}`}>
                    <View className="flex-row items-center justify-between border-b border-emerald-500/15 pb-2">
                      <View className="flex-row items-center">
                        <CheckCircle2 size={15} color="#0EA66E" strokeWidth={2.4} />
                        <Text className="ml-1.5 text-[11.5px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                          UCXP Resolution
                        </Text>
                      </View>
                      <View className="rounded-full bg-emerald-500/20 px-2 py-0.5">
                        <Text className="text-[9.5px] font-bold text-emerald-700 dark:text-emerald-300">
                          RECEIPT ISSUED
                        </Text>
                      </View>
                    </View>
                    <View className="flex-row items-center pt-2.5">
                      <ToneIcon size={17} color={toneStyle.color} />
                      <Text
                        className="ml-2 text-[14px] font-bold"
                        style={{ color: toneStyle.color }}
                      >
                        {message.action.label}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </>
            )}
          </View>

          {/* Interactive Suggestions Chips (if assistant listed options) */}
          {!message.pending && suggestions.length > 0 && onSelectSuggestion ? (
            <View className="mt-2.5 flex-row flex-wrap gap-1.5">
              {suggestions.map((s, idx) => (
                <Pressable
                  key={idx}
                  onPress={() => onSelectSuggestion(s.query)}
                  className="flex-row items-center rounded-full border border-hairline bg-surface px-3 py-1.5 shadow-2xs hover:border-accent hover:bg-accent/5 active:scale-95 transition dark:border-hairline-dark dark:bg-elevated-dark"
                >
                  <Text className="mr-1.5 text-[12px]">{s.glyph}</Text>
                  <Text className="text-[12.5px] font-semibold text-ink dark:text-white">
                    {s.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* Action Row: Timestamp + Copy + Speak */}
          {!message.pending ? (
            <View className="mt-1.5 flex-row items-center">
              <Text className="text-[11px] font-medium text-ink-faint dark:text-white/40">
                {formatClock(message.createdAt)}
              </Text>

              {Platform.OS === "web" ? (
                <View className="ml-3 flex-row items-center gap-2">
                  <Pressable
                    onPress={handleCopy}
                    hitSlop={6}
                    className="flex-row items-center rounded px-1.5 py-0.5 hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <Copy size={12} color={colors.textFaint} />
                    <Text className="ml-1 text-[11px] text-ink-faint dark:text-white/40">
                      {copied ? "Copied" : "Copy"}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={handleSpeak}
                    hitSlop={6}
                    className="flex-row items-center rounded px-1.5 py-0.5 hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <Volume2 size={12} color={speaking ? palette.accent : colors.textFaint} />
                    <Text
                      className={`ml-1 text-[11px] ${
                        speaking ? "font-semibold text-accent" : "text-ink-faint dark:text-white/40"
                      }`}
                    >
                      {speaking ? "Stop" : "Listen"}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </Row>
  );
}
