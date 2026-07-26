import { Text, View } from "react-native";
import type { BusinessId } from "@/types";
import { getBusiness } from "@/constants/businesses";

interface BusinessBadgeProps {
  businessId?: BusinessId;
  size?: "sm" | "md";
}

/** A colored chip identifying which business a reply came from over UCXP. */
export function BusinessBadge({ businessId, size = "md" }: BusinessBadgeProps) {
  const business = getBusiness(businessId);
  const isSm = size === "sm";
  return (
    <View
      className={`flex-row items-center self-start rounded-full ${
        isSm ? "px-2 py-1" : "px-2.5 py-1.5"
      }`}
      style={{ backgroundColor: business.tint }}
    >
      <View
        className="rounded-full"
        style={{
          width: isSm ? 6 : 8,
          height: isSm ? 6 : 8,
          backgroundColor: business.color,
        }}
      />
      <Text
        className={`ml-1.5 font-semibold ${isSm ? "text-[11px]" : "text-[12px]"}`}
        style={{ color: business.color }}
      >
        {business.name}
      </Text>
    </View>
  );
}
