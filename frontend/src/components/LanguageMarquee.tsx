import { useEffect, useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import { LANGUAGE_GREETINGS } from "@/constants/languages";

/**
 * An auto-scrolling "speak in your language" strip of script chips. Renders the
 * greeting list twice and translates by one list-width for a seamless loop.
 */
export function LanguageMarquee() {
  const x = useSharedValue(0);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (width <= 0) return;
    cancelAnimation(x);
    x.value = 0;
    // ~40px/sec — calm, readable drift.
    x.value = withRepeat(
      withTiming(-width, { duration: width * 25, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(x);
  }, [width, x]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View className="overflow-hidden">
      <Animated.View className="flex-row" style={style}>
        <Chips onMeasure={setWidth} />
        {/* Duplicate for a seamless wrap. */}
        <Chips />
      </Animated.View>
    </View>
  );
}

function Chips({ onMeasure }: { onMeasure?: (w: number) => void }) {
  const handleLayout = onMeasure
    ? (e: LayoutChangeEvent) => onMeasure(e.nativeEvent.layout.width)
    : undefined;
  return (
    <View className="flex-row" onLayout={handleLayout}>
      {LANGUAGE_GREETINGS.map((g) => (
        <View
          key={g.code}
          className="mr-2.5 flex-row items-center rounded-full border border-hairline bg-elevated px-4 py-2 dark:border-hairline-dark dark:bg-elevated-dark"
        >
          <Text className="text-[15px] font-semibold text-ink dark:text-white">{g.hello}</Text>
          <Text className="ml-2 text-[12px] text-ink-muted dark:text-white/40">{g.native}</Text>
        </View>
      ))}
    </View>
  );
}
