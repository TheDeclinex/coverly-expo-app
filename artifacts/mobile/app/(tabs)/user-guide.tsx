import { Feather } from "@expo/vector-icons";
import { Stack } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  userGuideReminder,
  userGuideSections,
  type UserGuideItem,
  type UserGuideSection,
} from "@/constants/userGuide";
import { useColors } from "@/hooks/useColors";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

export default function UserGuideScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const initialOpenSections = useMemo(
    () =>
      userGuideSections.reduce<Record<string, boolean>>((acc, section, index) => {
        acc[section.id] = index < 2;
        return acc;
      }, {}),
    [],
  );
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(initialOpenSections);

  const toggleSection = (id: string) => {
    setOpenSections((current) => ({ ...current, [id]: !current[id] }));
  };

  return (
    <>
      <Stack.Screen options={{ title: "User guide" }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}>
            <Feather name="book-open" size={21} color={colors.primary} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>Coverly user guide</Text>
            <Text style={[styles.heroText, { color: colors.mutedForeground }]}>
              A quick guide to the tools currently available in the app, from adding your first property to preparing claim pack records.
            </Text>
          </View>
        </View>

        <View style={styles.sections}>
          {userGuideSections.map((section) => (
            <GuideSectionCard
              key={section.id}
              section={section}
              isOpen={!!openSections[section.id]}
              onToggle={() => toggleSection(section.id)}
            />
          ))}
        </View>

        <View style={[styles.noteCard, { backgroundColor: colors.accent, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Feather name="shield" size={18} color={colors.primary} />
          <Text style={[styles.noteText, { color: colors.secondaryForeground }]}>{userGuideReminder}</Text>
        </View>
      </ScrollView>
    </>
  );
}

function GuideSectionCard({
  section,
  isOpen,
  onToggle,
}: {
  section: UserGuideSection;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const colors = useColors();
  const iconName = section.icon as FeatherName;

  return (
    <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${isOpen ? "Collapse" : "Expand"} ${section.title}`}
        accessibilityState={{ expanded: isOpen }}
        onPress={onToggle}
        style={({ pressed }) => [styles.sectionHeader, { opacity: pressed ? 0.72 : 1 }]}
      >
        <View style={[styles.sectionIcon, { backgroundColor: colors.secondary }]}>
          <Feather name={iconName} size={17} color={colors.primary} />
        </View>
        <View style={styles.sectionHeaderCopy}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{section.title}</Text>
          <Text style={[styles.sectionSummary, { color: colors.mutedForeground }]}>{section.summary}</Text>
        </View>
        <Feather name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
      </Pressable>

      {isOpen ? (
        <View style={[styles.sectionBody, { borderTopColor: colors.border }]}>
          {section.items.map((item, index) => (
            <GuideItemBlock key={`${section.id}-${item.title}`} item={item} isLast={index === section.items.length - 1} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function GuideItemBlock({ item, isLast }: { item: UserGuideItem; isLast: boolean }) {
  const colors = useColors();
  return (
    <View style={[styles.itemBlock, !isLast && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <Text style={[styles.itemTitle, { color: colors.foreground }]}>{item.title}</Text>
      {item.body ? <Text style={[styles.itemBody, { color: colors.mutedForeground }]}>{item.body}</Text> : null}
      {item.bullets ? (
        <View style={styles.bulletList}>
          {item.bullets.map((bullet) => (
            <View key={bullet} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.bulletText, { color: colors.mutedForeground }]}>{bullet}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  heroCard: {
    borderWidth: 1,
    padding: 16,
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  heroIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, gap: 5 },
  heroTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  heroText: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  sections: { gap: 10 },
  sectionCard: { borderWidth: 1, overflow: "hidden" },
  sectionHeader: { minHeight: 74, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 11 },
  sectionIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  sectionHeaderCopy: { flex: 1, gap: 3 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  sectionSummary: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  sectionBody: { borderTopWidth: StyleSheet.hairlineWidth },
  itemBlock: { paddingHorizontal: 15, paddingVertical: 13, gap: 5 },
  itemTitle: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_700Bold" },
  itemBody: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  bulletList: { gap: 7, marginTop: 2 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  bulletDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 7 },
  bulletText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  noteCard: { borderWidth: 1, padding: 14, flexDirection: "row", gap: 10, alignItems: "flex-start" },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: "Inter_500Medium" },
});
