import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useColors } from "@/hooks/useColors";

export function LoadingState() {
  const colors = useColors();
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
});
