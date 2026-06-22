import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack, router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import {
  ActivityIndicator,
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
import { PROPERTY_TYPES } from "@/constants/propertyTypes";
import { supabase } from "@/lib/supabase";

function FormField({
  label,
  required,
  children,
  colors,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", letterSpacing: 0.3, color: colors.mutedForeground }}>
        {label}
        {required ? <Text style={{ color: colors.destructive }}>{" *"}</Text> : null}
      </Text>
      {children}
    </View>
  );
}

function InputBox({
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  colors,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: "default" | "decimal-pad";
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <TextInput
      style={[
        styles.input,
        multiline && styles.inputMulti,
        {
          backgroundColor: colors.muted,
          borderColor: colors.border,
          color: colors.foreground,
        },
      ]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      multiline={multiline}
      keyboardType={keyboardType ?? "default"}
      autoCapitalize="sentences"
    />
  );
}

export default function AddPropertyScreen() {
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [propertyType, setPropertyType] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [coverAmount, setCoverAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Property name is required.");
      return;
    }
    if (!session?.user) return;

    setSaving(true);
    setError(null);

    const now = new Date().toISOString();

    // address is not yet persisted — inventory_files has no dedicated address column
    void address;

    // Resolve next file_number for this user.
    // file_number is a bigint NOT NULL per-user sequential integer.
    // We fetch the current max scoped to the authenticated user (RLS ensures
    // this only sees their own rows) and increment by 1.
    const { data: maxRow } = await supabase
      .from("inventory_files")
      .select("file_number")
      .order("file_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextFileNumber = ((maxRow as { file_number?: number } | null)?.file_number ?? 0) + 1;

    // Generate a UUID client-side for the id column.
    // inventory_files.id may have no server default (like inventory_items.id),
    // so we always supply one.
    const newId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });

    const { data, error: dbError } = await supabase
      .from("inventory_files")
      .insert({
        id: newId,
        user_id: session.user.id,
        file_number: nextFileNumber,
        name: name.trim(),
        status: "active",
        property_type: propertyType ?? null,
        created_by_email: session.user.email ?? null,
        created_date: now,
        last_modified: now,
        contents_sum_insured: coverAmount ? parseFloat(coverAmount) : null,
      })
      .select()
      .single();

    setSaving(false);

    if (dbError) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(dbError.message);
      return;
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    queryClient.invalidateQueries({ queryKey: ["properties"] });

    // Navigate into the new property so the user can add rooms immediately
    router.replace({
      pathname: "/(tabs)/property/[id]",
      params: { id: data.id, name: data.name },
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: "New Property" }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Details section ── */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              PROPERTY DETAILS
            </Text>

            <FormField label="Property name" required colors={colors}>
              <InputBox
                value={name}
                onChangeText={setName}
                placeholder="e.g. Main home, Beach house…"
                colors={colors}
              />
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

            <FormField label="Address (optional)" colors={colors}>
              <InputBox
                value={address}
                onChangeText={setAddress}
                placeholder="e.g. 12 Oak Street, London"
                colors={colors}
              />
            </FormField>
          </View>

          {/* ── Insurance section ── */}
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
            disabled={saving}
            style={({ pressed }) => [
              styles.saveBtn,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity: saving || pressed ? 0.75 : 1,
              },
            ]}
          >
            {saving ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <>
                <Feather name="home" size={17} color={colors.primaryForeground} />
                <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>
                  Create Property
                </Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 16,
    gap: 24,
  },
  section: {
    gap: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  input: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  inputMulti: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  typeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  typeChip: {
    borderWidth: 1.5,
    paddingHorizontal: 13,
    paddingVertical: 8,
    maxWidth: "100%",
    alignSelf: "flex-start",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#DC2626",
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 52,
  },
  saveBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
