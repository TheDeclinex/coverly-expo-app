import { Feather } from "@expo/vector-icons";
import React, { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export type AccountRowTone = "neutral" | "blue" | "teal" | "lavender" | "amber" | "green" | "greyBlue" | "red";

const rowTones: Record<AccountRowTone, { surface: string; iconSurface: string; icon: string }> = {
  neutral: { surface: "transparent", iconSurface: "#F1F5F9", icon: "#0F8F83" },
  blue: { surface: "#F8FBFF", iconSurface: "#EAF3FF", icon: "#2563A8" },
  teal: { surface: "#F6FCFA", iconSurface: "#E7F7F3", icon: "#0F766E" },
  lavender: { surface: "#FBF9FF", iconSurface: "#F1ECFB", icon: "#6D5A9C" },
  amber: { surface: "#FFFCF5", iconSurface: "#FFF3D8", icon: "#A16207" },
  green: { surface: "#F8FCF8", iconSurface: "#EAF7EC", icon: "#397A4A" },
  greyBlue: { surface: "#F8FAFC", iconSurface: "#EAF0F6", icon: "#52677C" },
  red: { surface: "#FFF9F9", iconSurface: "#FDECEC", icon: "#B91C1C" },
};

export function AccountSection({ title, children }: { title: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

export function AccountRow({
  icon,
  title,
  subtitle,
  value,
  onPress,
  disabled = false,
  destructive = false,
  tone = "neutral",
  badgeCount,
  last = false,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  tone?: AccountRowTone;
  badgeCount?: number;
  last?: boolean;
}) {
  const colors = useColors();
  const active = !!onPress && !disabled;
  const foreground = destructive ? "#DC2626" : colors.foreground;
  const resolvedTone = destructive ? rowTones.red : rowTones[tone];
  const badgeLabel = badgeCount && badgeCount > 0 ? (badgeCount > 9 ? "9+" : String(badgeCount)) : null;

  return (
    <Pressable
      accessibilityRole={active ? "button" : undefined}
      accessibilityLabel={badgeLabel ? `${title}, ${badgeLabel} unread support replies` : title}
      accessibilityState={{ disabled: !active }}
      disabled={!active}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
        { backgroundColor: resolvedTone.surface, opacity: disabled ? 0.62 : pressed ? 0.72 : 1 },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: resolvedTone.iconSurface }]}>
        <Feather name={icon} size={17} color={resolvedTone.icon} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: foreground }]}>{title}</Text>
        {!!subtitle && <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>}
      </View>
      {badgeLabel ? (
        <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
          <Text style={[styles.unreadBadgeText, { color: colors.primaryForeground }]}>{badgeLabel}</Text>
        </View>
      ) : null}
      {!!value && <Text style={[styles.value, { color: colors.mutedForeground }]}>{value}</Text>}
      {active && <Feather name="chevron-right" size={17} color={colors.mutedForeground} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { borderWidth: 1, overflow: "hidden" },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  row: { minHeight: 62, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 11 },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  subtitle: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  value: { maxWidth: 120, textAlign: "right", fontSize: 12, fontFamily: "Inter_500Medium" },
  unreadBadge: { minWidth: 21, height: 21, borderRadius: 11, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  unreadBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
});
