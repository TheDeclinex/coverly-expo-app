import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

interface ScanWorkflowHeaderProps {
  backLabel: string;
  onBack: () => void;
  actionLabel?: string;
  onAction?: () => void;
}

export function ScanWorkflowHeader({
  backLabel,
  onBack,
  actionLabel,
  onAction,
}: ScanWorkflowHeaderProps) {
  const colors = useColors();

  return (
    <SafeAreaView
      edges={["top"]}
      style={[
        styles.safeArea,
        { backgroundColor: colors.card, borderBottomColor: colors.border },
      ]}
    >
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Back to ${backLabel}`}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.58 : 1 }]}
        >
          <Feather name="chevron-left" size={21} color={colors.primary} />
          <Text
            numberOfLines={1}
            style={[styles.backLabel, { color: colors.primary }]}
          >
            {backLabel}
          </Text>
        </Pressable>

        <View pointerEvents="none" style={styles.titleWrap}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>
            Scan items
          </Text>
        </View>

        {actionLabel && onAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            onPress={onAction}
            style={({ pressed }) => [styles.actionButton, { opacity: pressed ? 0.58 : 1 }]}
          >
            <Text numberOfLines={1} style={[styles.actionLabel, { color: colors.primary }]}>
              {actionLabel}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.actionPlaceholder} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flexShrink: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    minHeight: 52,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    zIndex: 1,
    minWidth: 44,
    minHeight: 44,
    maxWidth: 112,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
  },
  backLabel: {
    maxWidth: 82,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  titleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 120,
  },
  title: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
  },
  actionButton: {
    zIndex: 1,
    minWidth: 44,
    minHeight: 44,
    maxWidth: 110,
    paddingHorizontal: 8,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  actionLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  actionPlaceholder: {
    width: 44,
    height: 44,
  },
});
