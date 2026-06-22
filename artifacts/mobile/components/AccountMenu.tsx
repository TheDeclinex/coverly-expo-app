import { Feather } from "@expo/vector-icons";
import React, { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

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
  last = false,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  last?: boolean;
}) {
  const colors = useColors();
  const active = !!onPress && !disabled;
  const foreground = destructive ? "#DC2626" : colors.foreground;

  return (
    <Pressable
      accessibilityRole={active ? "button" : undefined}
      accessibilityLabel={title}
      accessibilityState={{ disabled: !active }}
      disabled={!active}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
        { opacity: disabled ? 0.62 : pressed ? 0.72 : 1 },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: destructive ? "#FEF2F2" : colors.secondary }]}>
        <Feather name={icon} size={17} color={destructive ? "#DC2626" : colors.primary} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: foreground }]}>{title}</Text>
        {!!subtitle && <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>}
      </View>
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
});
