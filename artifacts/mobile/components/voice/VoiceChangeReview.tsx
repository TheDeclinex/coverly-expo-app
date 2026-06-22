import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { VoiceMappedChange, VoiceScalar } from "@/types/voice";

function displayValue(value: VoiceScalar): string {
  if (value === null || value === "") return "—";
  return typeof value === "number" ? String(value) : value;
}

export function VoiceChangeReview({
  transcript,
  changes,
  selectedIds,
  onToggle,
  onResolvePrice,
}: {
  transcript: string;
  changes: VoiceMappedChange[];
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onResolvePrice: (id: string, destination: "replacement_price" | "original_purchase_price") => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.container}>
      <View style={[styles.transcript, { backgroundColor: colors.secondary, borderRadius: colors.radius }]}>
        <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>HEARD</Text>
        <Text style={[styles.transcriptText, { color: colors.foreground }]}>{transcript}</Text>
      </View>
      <Text style={[styles.heading, { color: colors.foreground }]}>Suggested changes</Text>
      {changes.map((change) => (
        <View key={change.id} style={[styles.change, { borderColor: colors.border, borderRadius: colors.radius }]}>
          <View style={styles.changeHeader}>
            <Text style={[styles.label, { color: colors.foreground }]}>{change.label}</Text>
            {!change.requiresResolution && (
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selectedIds.has(change.id) }} onPress={() => onToggle(change.id)} hitSlop={8}>
                <Feather name={selectedIds.has(change.id) ? "check-square" : "square"} size={19} color={colors.primary} />
              </Pressable>
            )}
          </View>
          {change.uncertain && <Text style={[styles.warning, { color: colors.warning }]}>Please check this suggestion</Text>}
          <Text style={[styles.value, { color: colors.mutedForeground }]}>Current: {displayValue(change.currentValue)}</Text>
          <Text style={[styles.value, { color: colors.foreground }]}>New: {displayValue(change.nextValue)}</Text>
          {change.requiresResolution && (
            <View style={styles.resolveRow}>
              <Pressable onPress={() => onResolvePrice(change.id, "replacement_price")} style={[styles.resolveButton, { borderColor: colors.primary }]}>
                <Text style={[styles.resolveText, { color: colors.primary }]}>Replacement / Each</Text>
              </Pressable>
              <Pressable onPress={() => onResolvePrice(change.id, "original_purchase_price")} style={[styles.resolveButton, { borderColor: colors.primary }]}>
                <Text style={[styles.resolveText, { color: colors.primary }]}>Original purchase</Text>
              </Pressable>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  transcript: { padding: 12, gap: 4 },
  eyebrow: { fontSize: 10, letterSpacing: 0.8, fontFamily: "Inter_600SemiBold" },
  transcriptText: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  heading: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  change: { borderWidth: 1, padding: 12, gap: 4 },
  changeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  warning: { fontSize: 11, fontFamily: "Inter_500Medium" },
  value: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  resolveRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  resolveButton: { flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 6, alignItems: "center" },
  resolveText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textAlign: "center" },
});
