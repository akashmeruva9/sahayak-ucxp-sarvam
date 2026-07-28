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
      <Animated.View
        className="flex-row"
        // nowrap explicitly: on web the duplicated strip wrapped onto a second
        // line, showing the same chips twice instead of scrolling as one row.
        style={[{ flexWrap: "nowrap" }, style]}
      >
        {/* The list twice in ONE row: translating by a single list-width then
            wraps seamlessly. Two sibling rows wrapped onto a second line. */}
        <Chips onMeasure={setWidth} />
      </Animated.View>
    </View>
  );
}

function Chips({ onMeasure }: { onMeasure?: (w: number) => void }) {
  // Half the rendered width = one copy of the list = the loop distance.
  const handleLayout = onMeasure
    ? (e: LayoutChangeEvent) => onMeasure(e.nativeEvent.layout.width / 2)
    : undefined;
  return (
    <View
      className="flex-row"
      // nowrap + no shrink: inside a width-capped column the strip otherwise
      // wraps onto a second line and the "scrolling" row becomes two static ones.
      style={{ flexWrap: "nowrap", flexShrink: 0 }}
      onLayout={handleLayout}
    >
      {[...LANGUAGE_GREETINGS, ...LANGUAGE_GREETINGS].map((g, i) => (
        <View
          key={`${g.code}-${i}`}
          style={{ flexShrink: 0 }}
          className="mr-2.5 flex-row items-center rounded-full border border-hairline bg-elevated px-4 py-2 dark:border-hairline-dark dark:bg-elevated-dark"
        >
          <Text className="text-[15px] font-semibold text-ink dark:text-white">{g.hello}</Text>
          <Text className="ml-2 text-[12px] text-ink-muted dark:text-white/40">{g.native}</Text>
        </View>
      ))}
    </View>
  );
}
