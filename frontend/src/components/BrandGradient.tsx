import { useId } from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { GRADIENT } from "@/constants/theme";

interface BrandGradientProps {
  /** Diagonal by default (top-left → bottom-right), matching Sarvam's spectrum. */
  angle?: "diagonal" | "horizontal" | "vertical";
  colors?: [string, string, string?];
  style?: ViewStyle;
}

/**
 * Sarvam blue→orange spectrum as an absolutely-positioned fill. Drop it as the
 * first child of a rounded/circular container with `overflow: hidden` and put
 * content on top. Uses react-native-svg (already in the build) — no gradient
 * native module or rebuild required.
 */
export function BrandGradient({
  angle = "diagonal",
  colors = [GRADIENT.from, GRADIENT.mid, GRADIENT.to],
  style,
}: BrandGradientProps) {
  // Unique per instance so multiple gradients on one screen never collide.
  // Strip non-alphanumerics: React's useId() contains colons, which break
  // SVG url(#id) references.
  const id = `bg${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const coords =
    angle === "horizontal"
      ? { x1: "0", y1: "0", x2: "1", y2: "0" }
      : angle === "vertical"
        ? { x1: "0", y1: "0", x2: "0", y2: "1" }
        : { x1: "0", y1: "0", x2: "1", y2: "1" };

  const [from, mid, to] = colors;
  const stops = to
    ? [
        { offset: "0", color: from },
        { offset: "0.5", color: mid },
        { offset: "1", color: to },
      ]
    : [
        { offset: "0", color: from },
        { offset: "1", color: mid },
      ];

  return (
    <Svg style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} {...coords}>
          {stops.map((s) => (
            <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}
