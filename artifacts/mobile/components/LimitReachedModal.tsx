import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import type { NormalizedLimitError } from "@/lib/limit-errors";

interface LimitReachedModalProps {
  visible: boolean;
  content: NormalizedLimitError | null;
  onPrimary: () => void;
  onSecondary: () => void;
  onDismiss: () => void;
}

export function LimitReachedModal({
  visible,
  content,
  onPrimary,
  onSecondary,
  onDismiss,
}: LimitReachedModalProps) {
  const colors = useColors();
  if (!content) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop}>
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
          <View style={[styles.iconWrap, { backgroundColor: colors.secondary }]}>
            <Feather name="lock" size={22} color={colors.primary} />
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>
            {content.title}
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            {content.body}
          </Text>
          <View style={[styles.benefitBox, { backgroundColor: colors.muted }]}>
            <Feather name="star" size={15} color={colors.primary} />
            <Text style={[styles.benefit, { color: colors.foreground }]}>
              {content.benefit}
            </Text>
          </View>

          <Pressable
            onPress={onPrimary}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: colors.primary,
                borderColor: colors.primary,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>
              {content.primaryCta}
            </Text>
          </Pressable>

          <Pressable
            onPress={onSecondary}
            style={({ pressed }) => [
              styles.secondaryButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Text style={[styles.secondaryText, { color: colors.primary }]}>
              {content.secondaryCta}
            </Text>
          </Pressable>

          {content.dismissCta ? (
            <Pressable
              onPress={onDismiss}
              style={({ pressed }) => [
                styles.dismissButton,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[styles.dismissText, { color: colors.mutedForeground }]}>
                {content.dismissCta}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(15, 23, 42, 0.42)",
  },
  card: {
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
    borderWidth: 1,
    padding: 22,
    gap: 13,
    shadowColor: "#0F172A",
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 5,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 2,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  benefitBox: {
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  benefit: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_500Medium",
  },
  primaryButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  secondaryButton: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  secondaryText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  dismissButton: {
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  dismissText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
});
