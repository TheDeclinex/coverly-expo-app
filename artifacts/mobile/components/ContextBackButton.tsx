import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { useColors } from "@/hooks/useColors";

export function ContextBackButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.58 : 1 }]}
    >
      <Feather name="chevron-left" size={21} color={colors.primary} />
      <Text numberOfLines={1} style={[styles.label, { color: colors.primary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    maxWidth: 142,
    minHeight: 38,
    marginLeft: -7,
    flexDirection: "row",
    alignItems: "center",
  },
  label: {
    maxWidth: 116,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
});
