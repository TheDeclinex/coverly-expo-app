import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

export function LoadingState({ message }: { message?: string }) {
  const colors = useColors();
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      {message ? <Text style={[styles.message, { color: colors.mutedForeground }]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  message: { fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
});
