import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface ErrorStateProps {
  message?: string;
  detail?: string;
  onRetry?: () => void;
}

export function ErrorState({ message, detail, onRetry }: ErrorStateProps) {
  const colors = useColors();
  return (
    <View style={styles.center}>
      <Feather name="alert-circle" size={40} color={colors.destructive} />
      <Text style={[styles.message, { color: colors.destructive }]}>
        {message ?? "Something went wrong"}
      </Text>
      {detail ? (
        <Text style={[styles.detail, { color: colors.mutedForeground }]}>
          {detail}
        </Text>
      ) : null}
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          style={[
            styles.retryBtn,
            { backgroundColor: colors.primary, borderRadius: colors.radius },
          ]}
        >
          <Text style={[styles.retryText, { color: colors.primaryForeground }]}>
            Try again
          </Text>
        </Pressable>
      ) : null}
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
  message: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  detail: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  retryText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
});
