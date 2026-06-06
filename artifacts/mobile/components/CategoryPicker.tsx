import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ITEM_CATEGORIES } from "@/constants/categories";
import { useColors } from "@/hooks/useColors";

interface CategoryPickerProps {
  value: string;
  onChange: (v: string) => void;
}

export function CategoryPicker({ value, onChange }: CategoryPickerProps) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  const isCustom = !!value && !ITEM_CATEGORIES.includes(value);
  const displayList: string[] = isCustom
    ? [value, ...ITEM_CATEGORIES]
    : ITEM_CATEGORIES;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[
          styles.trigger,
          {
            borderColor: colors.border,
            borderRadius: colors.radius,
            backgroundColor: colors.card,
          },
        ]}
      >
        <Text
          style={[
            styles.triggerText,
            { color: value ? colors.foreground : colors.mutedForeground },
          ]}
          numberOfLines={1}
        >
          {value || "Select a category"}
        </Text>
        <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
            Category
          </Text>
          <FlatList
            data={displayList}
            keyExtractor={(item) => item}
            renderItem={({ item }) => {
              const selected = item === value;
              return (
                <Pressable
                  onPress={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                  style={[
                    styles.option,
                    { borderBottomColor: colors.border },
                    selected && { backgroundColor: colors.secondary },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      {
                        color: selected ? colors.primary : colors.foreground,
                        fontFamily: selected
                          ? "Inter_600SemiBold"
                          : "Inter_400Regular",
                      },
                    ]}
                  >
                    {item}
                    {isCustom && item === value ? "  (existing value)" : ""}
                  </Text>
                  {selected && (
                    <Feather name="check" size={16} color={colors.primary} />
                  )}
                </Pressable>
              );
            }}
            contentContainerStyle={{ paddingBottom: 48 }}
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  triggerText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingTop: 12,
    maxHeight: "72%",
    elevation: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
    paddingBottom: 8,
    paddingHorizontal: 20,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionText: {
    fontSize: 15,
    flex: 1,
  },
});
