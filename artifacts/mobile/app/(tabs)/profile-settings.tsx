import { Feather } from "@expo/vector-icons";
import { Stack } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { useToast } from "@/components/Toast";
import { useProfileSettings } from "@/hooks/useProfileSettings";
import { useColors } from "@/hooks/useColors";
import {
  COUNTRY_OPTIONS,
  DEFAULT_COUNTRY_CODE,
  validateProfileSettings,
  type ProfileSettingsInput,
} from "@/lib/profile-settings-model";

export default function ProfileSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { settings, isLoading, isError, refetch, saveSettings, saveState } = useProfileSettings();
  const [form, setForm] = useState<ProfileSettingsInput>({
    fullName: "",
    countryCode: DEFAULT_COUNTRY_CODE,
    reminderNotificationsEnabled: false,
    productUpdatesEnabled: false,
  });
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings || settings.id === loadedId) return;
    setForm({
      fullName: settings.fullName,
      countryCode: settings.countryCode || DEFAULT_COUNTRY_CODE,
      reminderNotificationsEnabled: settings.reminderNotificationsEnabled,
      productUpdatesEnabled: settings.productUpdatesEnabled,
    });
    setLoadedId(settings.id);
  }, [loadedId, settings]);

  const dirty = useMemo(() => !!settings && (
    form.fullName !== settings.fullName
    || form.countryCode !== settings.countryCode
    || form.reminderNotificationsEnabled !== settings.reminderNotificationsEnabled
    || form.productUpdatesEnabled !== settings.productUpdatesEnabled
  ), [form, settings]);

  const handleSave = async () => {
    const validationError = validateProfileSettings(form);
    if (validationError) {
      setSaveError(validationError);
      return;
    }
    setSaveError(null);
    try {
      const saved = await saveSettings(form);
      setForm({
        fullName: saved.fullName,
        countryCode: saved.countryCode,
        reminderNotificationsEnabled: saved.reminderNotificationsEnabled,
        productUpdatesEnabled: saved.productUpdatesEnabled,
      });
      showToast("Profile preferences saved");
    } catch {
      setSaveError("Your changes could not be saved. Check your connection and try again.");
    }
  };

  if (isLoading) return <LoadingState />;
  if (isError || !settings) {
    return <ErrorState message="Profile settings could not be loaded" onRetry={() => void refetch()} />;
  }

  return (
    <>
      <Stack.Screen options={{ title: "Profile & Preferences" }} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}> 
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Your profile</Text>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>FULL NAME</Text>
          <TextInput
            value={form.fullName}
            onChangeText={(fullName) => { setForm((current) => ({ ...current, fullName })); setSaveError(null); }}
            placeholder="Your name"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="words"
            maxLength={100}
            style={[styles.input, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background, borderRadius: colors.radius }]}
          />
          <Text style={[styles.label, { color: colors.mutedForeground }]}>EMAIL</Text>
          <View style={[styles.readOnly, { borderColor: colors.border, backgroundColor: colors.muted, borderRadius: colors.radius }]}> 
            <Text style={[styles.readOnlyText, { color: colors.mutedForeground }]}>{settings.email}</Text>
            <Feather name="lock" size={14} color={colors.mutedForeground} />
          </View>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>Email changes are managed through your account authentication.</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}> 
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Country or region</Text>
          <View style={styles.countryGrid}>
            {COUNTRY_OPTIONS.map((option) => {
              const selected = form.countryCode === option.code;
              return (
                <Pressable
                  key={option.code}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => { setForm((current) => ({ ...current, countryCode: option.code })); setSaveError(null); }}
                  style={[styles.countryOption, {
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? colors.accent : colors.card,
                    borderRadius: colors.radius,
                  }]}
                >
                  <Text style={[styles.countryLabel, { color: selected ? colors.accentForeground : colors.foreground }]}>{option.label}</Text>
                  <Text style={[styles.countryCode, { color: colors.mutedForeground }]}>{option.code}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}> 
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Future notifications</Text>
          <PreferenceRow
            title="Reminders and scan nudges"
            value={form.reminderNotificationsEnabled}
            onValueChange={(value) => setForm((current) => ({ ...current, reminderNotificationsEnabled: value }))}
            colors={colors}
          />
          <PreferenceRow
            title="Product and feature updates"
            value={form.productUpdatesEnabled}
            onValueChange={(value) => setForm((current) => ({ ...current, productUpdatesEnabled: value }))}
            colors={colors}
          />
          <Text style={[styles.notice, { color: colors.mutedForeground, backgroundColor: colors.muted, borderRadius: colors.radius }]}>These preferences are saved for future notification features. Transactional account and security emails are not affected.</Text>
        </View>

        {saveError ? <Text style={[styles.error, { color: colors.destructive }]}>{saveError}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={!dirty || saveState.isPending}
          onPress={() => void handleSave()}
          style={({ pressed }) => [styles.saveButton, {
            backgroundColor: colors.primary,
            borderRadius: colors.radius,
            opacity: !dirty || saveState.isPending ? 0.5 : pressed ? 0.8 : 1,
          }]}
        >
          {saveState.isPending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.saveText, { color: colors.primaryForeground }]}>Save preferences</Text>}
        </Pressable>
      </ScrollView>
    </>
  );
}

function PreferenceRow({ title, value, onValueChange, colors }: {
  title: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.preferenceRow, { borderBottomColor: colors.border }]}> 
      <Text style={[styles.preferenceTitle, { color: colors.foreground }]}>{title}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={colors.card}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  card: { borderWidth: 1, padding: 16, gap: 10 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  label: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.7, marginTop: 5 },
  input: { borderWidth: 1, paddingHorizontal: 13, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_400Regular" },
  readOnly: { borderWidth: 1, paddingHorizontal: 13, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  readOnlyText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  helper: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  countryGrid: { gap: 8 },
  countryOption: { borderWidth: 1, paddingHorizontal: 13, paddingVertical: 11, flexDirection: "row", justifyContent: "space-between" },
  countryLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  countryCode: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  preferenceRow: { minHeight: 52, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  preferenceTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", paddingRight: 12 },
  notice: { padding: 12, fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 3 },
  error: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium", textAlign: "center" },
  saveButton: { minHeight: 52, alignItems: "center", justifyContent: "center" },
  saveText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
