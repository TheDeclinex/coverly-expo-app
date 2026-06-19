import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export function QuantityStepper({
  value,
  onChange,
  onCommit,
  disabled = false,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const colors = useColors();
  const quantity = Math.max(1, Number.parseInt(value, 10) || 1);

  const step = (amount: number) => {
    const next = String(Math.max(1, quantity + amount));
    onChange(next);
    onCommit?.(next);
  };

  return (
    <View
      style={[
        styles.container,
        compact ? styles.compactContainer : null,
        { borderColor: colors.border, backgroundColor: colors.card },
      ]}
    >
      <TextInput
        accessibilityLabel="Quantity"
        value={value}
        onChangeText={(next) => onChange(next.replace(/[^0-9]/g, ""))}
        onBlur={() => {
          const next = String(quantity);
          onChange(next);
          onCommit?.(next);
        }}
        keyboardType="number-pad"
        inputMode="numeric"
        selectTextOnFocus
        editable={!disabled}
        style={[
          styles.input,
          compact ? styles.compactInput : null,
          { color: colors.foreground },
        ]}
      />
      <View style={[styles.arrows, { borderLeftColor: colors.border }]}>
        <Pressable
          accessibilityLabel="Increase quantity"
          onPress={() => step(1)}
          disabled={disabled}
          style={({ pressed }) => [
            styles.arrowButton,
            { opacity: disabled ? 0.4 : pressed ? 0.55 : 1 },
          ]}
        >
          <Feather name="chevron-up" size={compact ? 12 : 14} color={colors.foreground} />
        </Pressable>
        <Pressable
          accessibilityLabel="Decrease quantity"
          onPress={() => step(-1)}
          disabled={disabled || quantity <= 1}
          style={({ pressed }) => [
            styles.arrowButton,
            { opacity: disabled || quantity <= 1 ? 0.3 : pressed ? 0.55 : 1 },
          ]}
        >
          <Feather name="chevron-down" size={compact ? 12 : 14} color={colors.foreground} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 44,
    minWidth: 82,
    borderWidth: 1,
    borderRadius: 9,
    flexDirection: "row",
    overflow: "hidden",
  },
  compactContainer: { height: 38, minWidth: 68, borderRadius: 8 },
  input: {
    flex: 1,
    minWidth: 42,
    paddingHorizontal: 8,
    paddingVertical: 0,
    textAlign: "center",
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  compactInput: { minWidth: 34, fontSize: 13, paddingHorizontal: 5 },
  arrows: {
    width: 30,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  arrowButton: { flex: 1, alignItems: "center", justifyContent: "center" },
});
