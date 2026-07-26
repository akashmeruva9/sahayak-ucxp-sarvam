import { useMemo, useState } from "react";
import { Pressable, SectionList, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Search, Store, X } from "lucide-react-native";
import type { Business, BusinessCategory } from "@/types";
import { CATEGORY_ORDER, listBusinesses } from "@/constants/businesses";
import { useConversationStore } from "@/store/useConversationStore";
import { CompanyRow, ScreenContainer } from "@/components";
import { useThemeColors } from "@/hooks/useThemeColors";

export function CompaniesScreen() {
  const router = useRouter();
  const { colors } = useThemeColors();
  const [query, setQuery] = useState("");
  const startBusinessChat = useConversationStore((s) => s.startBusinessChat);

  const all = useMemo(() => listBusinesses(), []);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? all.filter(
          (b) =>
            b.name.toLowerCase().includes(q) || b.category.toLowerCase().includes(q)
        )
      : all;

    const grouped: Record<string, Business[]> = {};
    for (const b of matches) (grouped[b.category] ??= []).push(b);

    return CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((c) => ({
      title: c as BusinessCategory,
      data: grouped[c].sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [all, query]);

  const openChat = (business: Business) => {
    const id = startBusinessChat(business.id);
    router.push(`/conversation/${id}`);
  };

  return (
    <ScreenContainer>
      <View className="px-5 pb-3 pt-2">
        <Text className="text-[32px] font-bold tracking-tight text-ink dark:text-white">
          Companies
        </Text>
        <Text className="mt-1 text-[16px] text-ink-muted dark:text-white/50">
          Pick a business to start a support chat.
        </Text>

        {/* Search */}
        <View className="mt-4 flex-row items-center rounded-2xl border border-hairline bg-surface px-3.5 py-3 dark:border-hairline-dark dark:bg-elevated-dark">
          <Search size={19} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search companies…"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            className="ml-2.5 flex-1 p-0 text-[16px] text-ink dark:text-white"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery("")} hitSlop={10}>
              <X size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerClassName="px-5 pb-40 pt-1"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text className="mb-2 mt-4 text-[13px] font-semibold uppercase tracking-wider text-ink-faint dark:text-white/40">
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <View className="mb-2">
            <CompanyRow business={item} onPress={openChat} />
          </View>
        )}
        ListEmptyComponent={
          <View className="mt-24 items-center px-10">
            <Store size={40} color={colors.textFaint} />
            <Text className="mt-4 text-center text-[15px] text-ink-muted dark:text-white/40">
              No companies match “{query}”. Try a different name.
            </Text>
          </View>
        }
      />
    </ScreenContainer>
  );
}
