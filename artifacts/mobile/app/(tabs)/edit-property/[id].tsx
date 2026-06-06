import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { supabase } from "@/lib/supabase";
import type { InventoryFile } from "@/types";

const PROPERTY_TYPES = [
  { label: "Main home", value: "main_home" },
  { label: "Rental property", value: "rental" },
  { label: "Holiday / beach house", value: "holiday" },
  { label: "Storage unit", value: "storage" },
  { label: "Parent's home", value: "parents" },
  { label: "Other", value: "other" },
];

function FormField({
  label,
  children,
  colors,
}: {
  label: string;
  children: React.ReactNode;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", letterSpacing: 0.3, color: colors.mutedForeground }}>
        {label}
      </Text>
      {children}
    </View>
  );
}

function InputBox({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  colors,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "decimal-pad";
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <TextInput
      style={[
        styles.input,
        { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground },
      ]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      keyboardType={keyboardType ?? "default"}
      autoCapitalize="sentences"
    />
  );
}

export default function EditPropertyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: property, isLoading } = useQuery({
    queryKey: ["property", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_files")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as InventoryFile;
    },
    enabled: !!id,
  });

  const [name, setName] = useState("");
  const [propertyType, setPropertyType] = useState<string | null>(null);
  const [coverAmount, setCoverAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate fields once property loads
  useEffect(() => {
    if (property) {
      setName(property.name ?? "");
      setPropertyType(property.property_type ?? null);
      setCoverAmount(property.contents_sum_insured != null ? String(property.contents_sum_insured) : "");
    }
  }, [property]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["properties"] });
    queryClient.invalidateQueries({ queryKey: ["property", id] });
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Property name is required.");
      return;
    }
    setSaving(true);
    setError(null);

    const { error: dbError } = await supabase
      .from("inventory_files")
      .update({
        name: name.trim(),
        property_type: propertyType ?? null,
        contents_sum_insured: coverAmount ? parseFloat(coverAmount) : null,
        last_modified: new Date().toISOString(),
      })
      .eq("id", id);

    setSaving(false);

    if (dbError) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(dbError.message);
      return;
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    invalidate();
    router.back();
  };

  const handleDelete = () => {
    Alert.alert(
      "Delete property?",
      `This will permanently delete "${name}" and all its rooms and items. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            // Delete items and rooms first (Supabase RLS / FK may cascade; belt-and-braces)
            await supabase.from("inventory_items").delete().eq("file_id", id);
            await supabase.from("inventory_rooms").delete().eq("file_id", id);
            const { error: dbError } = await supabase
              .from("inventory_files")
              .delete()
              .eq("id", id);
            setDeleting(false);
            if (dbError) {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              setError(dbError.message);
              return;
            }
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            invalidate();
            // Go back to the home screen
            router.dismissAll();
          },
        },
      ]
    );
  };

  if (isLoading || !property) {
    return (
      <>
        <Stack.Screen options={{ title: "Edit Property" }} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Edit Property" }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Details ── */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              PROPERTY DETAILS
            </Text>

            <FormField label="Property name *" colors={colors}>
              <InputBox value={name} onChangeText={setName} placeholder="e.g. Main home" colors={colors} />
            </FormField>

            <FormField label="Property type" colors={colors}>
              <View style={styles.typeGrid}>
                {PROPERTY_TYPES.map((pt) => {
                  const selected = propertyType === pt.value;
                  return (
                    <Pressable
                      key={pt.value}
                      onPress={() => setPropertyType(selected ? null : pt.value)}
                      style={({ pressed }) => [
                        styles.typeChip,
                        {
                          backgroundColor: selected ? colors.primary : colors.muted,
                          borderColor: selected ? colors.primary : colors.border,
                          borderRadius: colors.radius,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          fontFamily: selected ? "Inter_600SemiBold" : "Inter_400Regular",
                          color: selected ? colors.primaryForeground : colors.foreground,
                        }}
                      >
                        {pt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </FormField>
          </View>

          {/* ── Insurance ── */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              INSURANCE (OPTIONAL)
            </Text>
            <FormField label="Recorded contents cover amount" colors={colors}>
              <InputBox
                value={coverAmount}
                onChangeText={setCoverAmount}
                placeholder="e.g. 50000"
                keyboardType="decimal-pad"
                colors={colors}
              />
              <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>
                Used to track how your inventory value compares to your recorded cover.
              </Text>
            </FormField>
          </View>

          {/* ── Error ── */}
          {error ? (
            <View style={[styles.errorBox, { backgroundColor: "#FEF2F2", borderRadius: colors.radius }]}>
              <Feather name="alert-circle" size={14} color="#DC2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* ── Save ── */}
          <Pressable
            onPress={handleSave}
            disabled={saving || deleting}
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: saving || pressed ? 0.75 : 1 },
            ]}
          >
            {saving ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <>
                <Feather name="check" size={17} color={colors.primaryForeground} />
                <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Save Changes</Text>
              </>
            )}
          </Pressable>

          {/* ── Danger zone ── */}
          <View style={[styles.dangerZone, { borderColor: "#FCA5A5", borderRadius: colors.radius }]}>
            <Text style={styles.dangerTitle}>Danger zone</Text>
            <Text style={styles.dangerBody}>
              Deleting this property permanently removes all its rooms and items. This cannot be undone.
            </Text>
            <Pressable
              onPress={handleDelete}
              disabled={saving || deleting}
              style={({ pressed }) => [
                styles.deleteBtn,
                { borderColor: "#DC2626", borderRadius: colors.radius, opacity: deleting || pressed ? 0.65 : 1 },
              ]}
            >
              {deleting ? (
                <ActivityIndicator color="#DC2626" size="small" />
              ) : (
                <>
                  <Feather name="trash-2" size={15} color="#DC2626" />
                  <Text style={styles.deleteBtnText}>Delete property</Text>
                </>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 24 },
  section: { gap: 16 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  input: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: { borderWidth: 1.5, paddingHorizontal: 13, paddingVertical: 8 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#DC2626" },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, height: 52,
  },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  dangerZone: {
    borderWidth: 1,
    padding: 16,
    gap: 10,
    backgroundColor: "#FFF5F5",
  },
  dangerTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#DC2626" },
  dangerBody: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#7F1D1D", lineHeight: 18 },
  deleteBtn: {
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 42,
  },
  deleteBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#DC2626" },
});
