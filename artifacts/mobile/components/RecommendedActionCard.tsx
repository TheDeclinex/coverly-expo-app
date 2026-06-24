import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ENABLE_RECOMMENDED_ACTIONS } from "@/constants/recommendedActions";
import { useColors } from "@/hooks/useColors";

export type RecommendedActionCardProps = {
  title?: string;
  body: string;
  detail?: string;
  primaryLabel: string;
  onPrimaryPress: () => void;
  secondaryLabel?: string;
  onSecondaryPress?: () => void;
  dismissible?: boolean;
  onDismiss?: () => void;
};

export function RecommendedActionCard({
  title = "Recommended action",
  body,
  detail,
  primaryLabel,
  onPrimaryPress,
  secondaryLabel,
  onSecondaryPress,
  dismissible = false,
  onDismiss,
}: RecommendedActionCardProps) {
  const colors = useColors();

  if (!ENABLE_RECOMMENDED_ACTIONS) return null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.kicker, { color: colors.primary }]}>{title}</Text>
        {dismissible && onDismiss ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss recommended action"
            onPress={onDismiss}
            hitSlop={8}
            style={({ pressed }) => [styles.dismissButton, { opacity: pressed ? 0.55 : 1 }]}
          >
            <Feather name="x" size={15} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      <Text style={[styles.body, { color: colors.foreground }]}>{body}</Text>
      {detail ? (
        <Text style={[styles.detail, { color: colors.mutedForeground }]}>{detail}</Text>
      ) : null}

      <View style={styles.actionRow}>
        {secondaryLabel && onSecondaryPress ? (
          <Pressable
            accessibilityRole="button"
            onPress={onSecondaryPress}
            style={({ pressed }) => [
              styles.secondaryButton,
              {
                borderColor: colors.border,
                backgroundColor: pressed ? colors.secondary : colors.card,
              },
            ]}
          >
            <Text style={[styles.secondaryText, { color: colors.foreground }]}>
              {secondaryLabel}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={onPrimaryPress}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: colors.primary,
              opacity: pressed ? 0.84 : 1,
            },
          ]}
        >
          <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>
          {primaryLabel}
        </Text>
          <Feather name="arrow-right" size={12} color={colors.primaryForeground} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 14,
  },
  kicker: {
    flex: 1,
    fontSize: 8,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.55,
    textTransform: "uppercase",
  },
  dismissButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    fontSize: 13,
    lineHeight: 17,
    fontFamily: "Inter_600SemiBold",
  },
  detail: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: "Inter_400Regular",
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 5,
  },
  primaryButton: {
    minHeight: 28,
    borderRadius: 7,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  primaryText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  secondaryButton: {
    minHeight: 28,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
});
