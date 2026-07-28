import { Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Check, FileText, Image as ImageIcon, Info, Paperclip, TriangleAlert } from "lucide-react-native";
import type { Message } from "@/types";
import { formatClock } from "@/utils/time";
import { BusinessBadge } from "./BusinessBadge";
import { LoadingDots } from "./LoadingDots";

const toneStyles = {
  success: { icon: Check, color: "#0EA66E", bg: "bg-emerald-50 dark:bg-emerald-500/10" },
  warning: { icon: TriangleAlert, color: "#D97706", bg: "bg-amber-50 dark:bg-amber-500/10" },
  info: { icon: Info, color: "#2563EB", bg: "bg-blue-50 dark:bg-blue-500/10" },
} as const;

/** A single message row: user (accent, right) or assistant (surface, left). */
export function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  if (isUser) {
    // A file the customer sent: show the filename, not the extracted text.
    const attachment = message.attachment;
    const AttachIcon =
      attachment?.kind === "pdf" ? FileText : attachment?.kind === "image" ? ImageIcon : Paperclip;

    return (
      <Animated.View entering={FadeInDown.duration(260)} className="mb-3 items-end">
        <View className="max-w-[82%] rounded-card rounded-br-md bg-accent px-4 py-3">
          {attachment ? (
            <View
              className={`flex-row items-center rounded-xl bg-white/20 px-2.5 py-2 ${
                message.text ? "mb-2" : ""
              }`}
            >
              <AttachIcon size={15} color="#FFFFFF" />
              <Text
                className="ml-2 flex-shrink text-[13px] font-medium text-white"
                numberOfLines={1}
              >
                {attachment.name}
              </Text>
            </View>
          ) : null}
          {message.text ? (
            <Text className="text-[15px] leading-[21px] text-white">{message.text}</Text>
          ) : null}
        </View>
        <Text className="mr-1 mt-1 text-[11px] text-ink-faint dark:text-white/30">
          {formatClock(message.createdAt)}
        </Text>
      </Animated.View>
    );
  }

  const tone = message.action?.tone ?? "info";
  const toneStyle = toneStyles[tone];
  const ToneIcon = toneStyle.icon;

  return (
    <Animated.View entering={FadeInDown.duration(260)} className="mb-3 items-start">
      <View className="max-w-[86%] rounded-card rounded-bl-md border border-hairline/70 bg-elevated px-4 py-3 dark:border-hairline-dark/70 dark:bg-elevated-dark">
        {message.businessId ? (
          <View className="mb-2">
            <BusinessBadge businessId={message.businessId} size="sm" />
          </View>
        ) : null}

        {message.pending ? (
          <View className="py-1">
            <LoadingDots />
          </View>
        ) : (
          <>
            <Text
              className={`text-[15px] leading-[22px] ${
                message.status === "error"
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-ink dark:text-white"
              }`}
            >
              {message.text}
            </Text>

            {message.action ? (
              <View className={`mt-3 flex-row items-center rounded-xl px-3 py-2.5 ${toneStyle.bg}`}>
                <ToneIcon size={16} color={toneStyle.color} />
                <Text
                  className="ml-2 text-[13px] font-semibold"
                  style={{ color: toneStyle.color }}
                >
                  {message.action.label}
                </Text>
              </View>
            ) : null}
          </>
        )}
      </View>
      {!message.pending ? (
        <Text className="ml-1 mt-1 text-[11px] text-ink-faint dark:text-white/30">
          {formatClock(message.createdAt)}
        </Text>
      ) : null}
    </Animated.View>
  );
}
