import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack, router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
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

import { ContextBackButton } from "@/components/ContextBackButton";
import { CountrySelect } from "@/components/CountrySelect";
import { LoadingState } from "@/components/LoadingState";
import { PropertyAllowanceModal } from "@/components/PropertyAllowanceModal";
import { useAuth } from "@/context/AuthContext";
import { PROPERTY_TYPES, propertyTypeLabel } from "@/constants/propertyTypes";
import { resolveMarketConfig } from "@/constants/market-config";
import { useColors } from "@/hooks/useColors";
import { usePropertyAllowance } from "@/hooks/usePropertyAllowance";
import { createProperty, PropertyCreationError } from "@/lib/property-service";
import { formatPropertyMoney, moneyDisplayToken } from "@/lib/money";
import { supabase } from "@/lib/supabase";

type SetupStep = 0 | 1 | 2;

function FormField({
  label,
  required,
  hint,
  children,
  colors,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
          {label}
          {required ? <Text style={{ color: colors.destructive }}>{" *"}</Text> : null}
        </Text>
        {hint ? <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>{hint}</Text> : null}
      </View>
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
      keyboardType={keyboardType ?? "default"}
      autoCapitalize="sentences"
    />
  );
}

function StepPill({
  index,
  currentStep,
  label,
  colors,
}: {
  index: SetupStep;
  currentStep: SetupStep;
  label: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const active = index === currentStep;
  const complete = index < currentStep;
  return (
    <View
      style={[
        styles.stepPill,
        {
          backgroundColor: active || complete ? colors.secondary : colors.muted,
          borderColor: active ? colors.primary : colors.border,
        },
      ]}
    >
      <View
        style={[
          styles.stepDot,
          {
            backgroundColor: active || complete ? colors.primary : colors.border,
          },
        ]}
      >
        {complete ? (
          <Feather name="check" size={10} color={colors.primaryForeground} />
        ) : (
          <Text style={[styles.stepDotText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>
            {index + 1}
          </Text>
        )}
      </View>
      <Text style={[styles.stepPillText, { color: active ? colors.primary : colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

export default function AddPropertyScreen() {
  const { session } = useAuth();
  const { allowance, refreshAllowance } = usePropertyAllowance();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<SetupStep>(0);
  const [name, setName] = useState("");
  const [propertyType, setPropertyType] = useState<string | null>(null);
  const [countryCode, setCountryCode] = useState("NZ");
  const [coverAmount, setCoverAmount] = useState("");
  const [insurerName, setInsurerName] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverAllowanceVisible, setServerAllowanceVisible] = useState(false);
  const submissionLockRef = useRef(false);
  const market = resolveMarketConfig(countryCode) ?? resolveMarketConfig("NZ")!;

  useEffect(() => {
    if (!session?.user.id) return;
    void supabase.from("user_profiles").select("country_code").eq("id", session.user.id).maybeSingle()
      .then(({ data }) => { if (resolveMarketConfig(data?.country_code)) setCountryCode(data!.country_code); });
  }, [session?.user.id]);

  const trimmedName = name.trim();
  const parsedCoverAmount = parseFloat(coverAmount.replace(/[^0-9.]/g, ""));
  const hasValidCoverAmount = Number.isFinite(parsedCoverAmount) && parsedCoverAmount > 0;
  const hasEssentials = !!trimmedName && !!propertyType && hasValidCoverAmount;
  const canCreate = hasEssentials && !saving;

  const clearError = () => setError(null);

  const goToOptional = () => {
    if (!trimmedName) {
      setError("Add a property name to continue.");
      return;
    }
    if (!propertyType) {
      setError("Choose a property type to continue.");
      return;
    }
    if (!hasValidCoverAmount) {
      setError("Add your contents cover amount to compare against your inventory value.");
      return;
    }
    setError(null);
    setStep(1);
  };

  const handleSave = async () => {
    if (!trimmedName) {
      setStep(0);
      setError("Property name is required.");
      return;
    }
    if (!propertyType) {
      setStep(0);
      setError("Choose a property type.");
      return;
    }
    if (!hasValidCoverAmount) {
      setStep(0);
      setError("Add your contents cover amount to compare against your inventory value.");
      return;
    }
    if (!session?.user) return;
    if (submissionLockRef.current) return;
    submissionLockRef.current = true;

    setSaving(true);
    setError(null);

    let data;
    try {
      const freshAllowance = await refreshAllowance();
      if (!freshAllowance.canCreateProperty) {
        setServerAllowanceVisible(true);
        return;
      }
      data = await createProperty({
        name: trimmedName,
        countryCode,
        propertyType,
        contentsSumInsured: parsedCoverAmount,
        insurerName: insurerName.trim() || null,
        policyNumber: policyNumber.trim() || null,
      });
    } catch (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (err instanceof PropertyCreationError && (
        err.errorCode === "PROPERTY_LIMIT_REACHED"
        || err.errorCode === "PROPERTY_ALLOWANCE_UNAVAILABLE"
      )) {
        await refreshAllowance();
        setServerAllowanceVisible(true);
      } else {
        setError(err instanceof Error ? err.message : "Could not create property. Please try again.");
      }
      return;
    } finally {
      setSaving(false);
      submissionLockRef.current = false;
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["properties"] }),
      queryClient.invalidateQueries({ queryKey: ["property-allowance"] }),
    ]);

    router.replace({
      pathname: "/(tabs)/property/[id]",
      params: { id: data.id, name: data.name },
    });
  };

  if (allowance.state === "loading") {
    return (
      <>
        <Stack.Screen options={{ title: "New Property" }} />
        <LoadingState message="Checking your plan" />
      </>
    );
  }

  if (!allowance.canCreateProperty) {
    return (
      <>
        <Stack.Screen options={{ title: "New Property" }} />
        <View style={{ flex: 1, backgroundColor: colors.background }} />
        <PropertyAllowanceModal
          visible
          allowance={allowance}
          onDismiss={() => router.back()}
          onRetry={() => void refreshAllowance()}
        />
      </>
    );
  }

  const renderEssentials = () => (
    <View style={styles.section}>
      <View style={styles.sectionIntro}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Start with the basics</Text>
        <Text style={[styles.sectionBody, { color: colors.mutedForeground }]}>
          Name the place, choose what it is, and add your contents cover.
        </Text>
      </View>

      <FormField label="Property name" required colors={colors}>
        <InputBox
          value={name}
          onChangeText={(value) => {
            setName(value);
            clearError();
          }}
          placeholder="e.g. Main home"
          colors={colors}
        />
      </FormField>

      <FormField label="Property type" required colors={colors}>
        <View style={styles.typeGrid}>
          {PROPERTY_TYPES.map((pt) => {
            const selected = propertyType === pt.value;
            return (
              <Pressable
                key={pt.value}
                onPress={() => {
                  setPropertyType(pt.value);
                  clearError();
                }}
                style={({ pressed }) => [
                  styles.typeChip,
                  {
                    backgroundColor: selected ? colors.primary : colors.muted,
                    borderColor: selected ? colors.primary : colors.border,
                    borderRadius: colors.radius,
                    opacity: pressed ? 0.82 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.typeChipText,
                    { color: selected ? colors.primaryForeground : colors.foreground },
                    selected && styles.typeChipTextSelected,
                  ]}
                >
                  {pt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </FormField>

      <FormField label="Property country" required colors={colors}>
        <CountrySelect value={countryCode} onChange={(value) => { setCountryCode(value); clearError(); }} />
        <Text style={[styles.helperText, { color: colors.mutedForeground }]}>Coverly uses the property country to estimate replacement values and search local retailers.</Text>
      </FormField>

      <FormField label="Insurance contents cover" required hint={moneyDisplayToken(market.currencyCode)} colors={colors}>
        <InputBox
          value={coverAmount}
          onChangeText={(value) => {
            setCoverAmount(value.replace(/[^0-9.]/g, ""));
            clearError();
          }}
          placeholder="e.g. 50000"
          keyboardType="decimal-pad"
          colors={colors}
        />
        <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
          Coverly uses this to compare your recorded inventory value against your cover.
        </Text>
      </FormField>

      <Pressable
        onPress={goToOptional}
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: pressed ? 0.84 : 1 },
        ]}
      >
        <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Continue</Text>
        <Feather name="arrow-right" size={16} color={colors.primaryForeground} />
      </Pressable>
    </View>
  );

  const renderOptional = () => (
    <View style={styles.section}>
      <View style={styles.sectionIntro}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Optional policy details</Text>
        <Text style={[styles.sectionBody, { color: colors.mutedForeground }]}>
          Add these now if they are handy, or skip them and keep moving.
        </Text>
      </View>

      <FormField label="Insurer" hint="Optional" colors={colors}>
        <InputBox
          value={insurerName}
          onChangeText={setInsurerName}
          placeholder="e.g. Tower, AMI, State"
          colors={colors}
        />
      </FormField>

      <FormField label="Policy number" hint="Optional" colors={colors}>
        <InputBox
          value={policyNumber}
          onChangeText={setPolicyNumber}
          placeholder="Optional policy reference"
          colors={colors}
        />
      </FormField>

      <View style={styles.buttonRow}>
        <Pressable
          onPress={() => setStep(2)}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: colors.border, borderRadius: colors.radius, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Skip for now</Text>
        </Pressable>
        <Pressable
          onPress={() => setStep(2)}
          style={({ pressed }) => [
            styles.primaryButton,
            styles.buttonRowPrimary,
            { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: pressed ? 0.84 : 1 },
          ]}
        >
          <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Continue</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderReview = () => (
    <View style={styles.section}>
      <View style={styles.sectionIntro}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Ready to create</Text>
        <Text style={[styles.sectionBody, { color: colors.mutedForeground }]}>
          You will land on this property next, where you can add rooms or scan items.
        </Text>
      </View>

      <View style={[styles.reviewCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <ReviewRow label="Property" value={trimmedName || "Not set"} colors={colors} />
        <ReviewRow label="Type" value={propertyTypeLabel(propertyType) ?? "Not set"} colors={colors} />
        <ReviewRow label="Country" value={`${market.countryName} · ${market.currencyCode}`} colors={colors} />
        <ReviewRow label="Contents cover" value={hasValidCoverAmount ? formatPropertyMoney(parsedCoverAmount, market.countryCode, market.currencyCode, { precision: "summary" }) : "Not set"} colors={colors} />
        <ReviewRow label="Insurer" value={insurerName.trim() || "Not set"} colors={colors} />
        <ReviewRow label="Policy number" value={policyNumber.trim() || "Not set"} colors={colors} />
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          onPress={() => setStep(1)}
          disabled={saving}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: colors.border, borderRadius: colors.radius, opacity: saving ? 0.5 : pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Back</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={!canCreate}
          style={({ pressed }) => [
            styles.primaryButton,
            styles.buttonRowPrimary,
            {
              backgroundColor: colors.primary,
              borderRadius: colors.radius,
              opacity: !canCreate || pressed ? 0.55 : 1,
            },
          ]}
        >
          {saving ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Feather name="home" size={16} color={colors.primaryForeground} />
              <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Create property</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: "New Property",
          headerBackVisible: false,
          headerLeft: () => <ContextBackButton label="Home" onPress={() => router.replace("/(tabs)")} />,
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={[styles.kicker, { color: colors.mutedForeground }]}>FIRST PROPERTY SETUP</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Create your property</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              A quick setup now gives Coverly somewhere to store rooms, items, evidence, and future claim packs.
            </Text>
          </View>

          <View style={styles.stepRow}>
            <StepPill index={0} currentStep={step} label="Basics" colors={colors} />
            <StepPill index={1} currentStep={step} label="Optional" colors={colors} />
            <StepPill index={2} currentStep={step} label="Create" colors={colors} />
          </View>

          {error ? (
            <View style={[styles.errorBox, { backgroundColor: "#FEF2F2", borderRadius: colors.radius }]}>
              <Feather name="alert-circle" size={14} color="#DC2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {step === 0 ? renderEssentials() : step === 1 ? renderOptional() : renderReview()}
        </ScrollView>
      </KeyboardAvoidingView>
      <PropertyAllowanceModal
        visible={serverAllowanceVisible}
        allowance={allowance}
        onDismiss={() => setServerAllowanceVisible(false)}
        onRetry={() => {
          setServerAllowanceVisible(false);
          void refreshAllowance();
        }}
      />
    </>
  );
}

function ReviewRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View style={[styles.reviewRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.reviewLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.reviewValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 16,
    gap: 18,
  },
  header: {
    gap: 5,
  },
  kicker: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
  },
  stepRow: {
    flexDirection: "row",
    gap: 8,
  },
  stepPill: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  stepDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
  },
  stepPillText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  section: {
    gap: 16,
  },
  sectionIntro: {
    gap: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  sectionBody: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
  },
  field: {
    gap: 6,
  },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  fieldLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.3,
  },
  fieldHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  input: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  helperText: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Inter_400Regular",
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
  typeChipText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  typeChipTextSelected: {
    fontFamily: "Inter_600SemiBold",
  },
  infoRow: {
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  infoIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  infoCopy: {
    flex: 1,
    gap: 2,
  },
  infoTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  infoBody: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
  },
  reviewCard: {
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  reviewRow: {
    minHeight: 46,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  reviewLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  reviewValue: {
    flex: 1,
    textAlign: "right",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
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
  buttonRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButton: {
    minHeight: 50,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonRowPrimary: {
    flex: 1.4,
  },
  primaryButtonText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  secondaryButton: {
    flex: 1,
    minHeight: 50,
    borderWidth: 1,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
