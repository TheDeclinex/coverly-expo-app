import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { supabase } from "@/lib/supabase";
import type { InventoryItem } from "@/types";

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function DetailRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string | number | null | undefined;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text
        style={[styles.detailValue, { color: colors.foreground }]}
        numberOfLines={4}
      >
        {String(value)}
      </Text>
    </View>
  );
}

function Section({
  title,
  children,
  colors,
}: {
  title: string;
  children: React.ReactNode;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View
      style={[
        styles.section,
        {
          backgroundColor: colors.card,
          borderRadius: colors.radius,
          borderColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export default function ItemDetailScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const {
    data: item,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["item", id, session?.user.id],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("inventory_items")
        .select("*")
        .eq("id", id)
        .single();
      if (queryError) throw queryError;
      return data as InventoryItem;
    },
    enabled: !!session && !!id,
  });

  const imageUri = item?.image_url ?? item?.photo_url;

  return (
    <>
      <Stack.Screen options={{ title: name ?? "Item Detail" }} />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={40} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            Failed to load item
          </Text>
          <Text style={[styles.errorSub, { color: colors.mutedForeground }]}>
            {(error as Error).message}
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={[
              styles.retryButton,
              { backgroundColor: colors.primary, borderRadius: colors.radius },
            ]}
          >
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>
              Retry
            </Text>
          </Pressable>
        </View>
      ) : item ? (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom: insets.bottom + 32,
              ...(Platform.OS === "web"
                ? { paddingTop: 16 }
                : {}),
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {imageUri ? (
            <Image
              source={{ uri: imageUri }}
              style={styles.heroImage}
              contentFit="cover"
            />
          ) : (
            <View
              style={[
                styles.heroPlaceholder,
                { backgroundColor: colors.secondary },
              ]}
            >
              <Feather name="package" size={48} color={colors.primary} />
            </View>
          )}

          <View style={styles.content}>
            <View style={styles.titleRow}>
              <Text
                style={[styles.itemName, { color: colors.foreground }]}
              >
                {item.name}
              </Text>
              {item.category && (
                <View
                  style={[
                    styles.categoryBadge,
                    {
                      backgroundColor: colors.accent,
                      borderRadius: 8,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.categoryText,
                      { color: colors.accentForeground },
                    ]}
                  >
                    {item.category}
                  </Text>
                </View>
              )}
            </View>

            {item.description && (
              <Text
                style={[styles.description, { color: colors.mutedForeground }]}
              >
                {item.description}
              </Text>
            )}

            <Section title="VALUATION" colors={colors}>
              <DetailRow
                label="Estimated replacement"
                value={formatCurrency(item.estimated_price)}
                colors={colors}
              />
              <DetailRow
                label="Unit price"
                value={formatCurrency(item.unit_estimated_price)}
                colors={colors}
              />
              <DetailRow
                label="Quantity"
                value={item.quantity}
                colors={colors}
              />
              <DetailRow
                label="Quantity estimate"
                value={item.quantity_estimate}
                colors={colors}
              />
              <DetailRow
                label="Valuation basis"
                value={item.valuation_basis}
                colors={colors}
              />
              <DetailRow
                label="Confidence"
                value={item.confidence}
                colors={colors}
              />
            </Section>

            {(item.brand_maker ||
              item.model_series ||
              item.condition_label) && (
              <Section title="PRODUCT INFO" colors={colors}>
                <DetailRow
                  label="Brand / Maker"
                  value={item.brand_maker}
                  colors={colors}
                />
                <DetailRow
                  label="Model / Series"
                  value={item.model_series}
                  colors={colors}
                />
                <DetailRow
                  label="Condition"
                  value={item.condition_label}
                  colors={colors}
                />
              </Section>
            )}

            {(item.original_purchase_price ||
              item.purchase_year_approx ||
              item.purchase_source) && (
              <Section title="PURCHASE HISTORY" colors={colors}>
                <DetailRow
                  label="Original price"
                  value={formatCurrency(item.original_purchase_price)}
                  colors={colors}
                />
                <DetailRow
                  label="Year purchased"
                  value={item.purchase_year_approx}
                  colors={colors}
                />
                <DetailRow
                  label="Source"
                  value={item.purchase_source}
                  colors={colors}
                />
              </Section>
            )}

            {(item.web_listing_title || item.web_listing_price) && (
              <Section title="WEB LISTING" colors={colors}>
                <DetailRow
                  label="Title"
                  value={item.web_listing_title}
                  colors={colors}
                />
                <DetailRow
                  label="Listed price"
                  value={formatCurrency(item.web_listing_price)}
                  colors={colors}
                />
                <DetailRow
                  label="Source"
                  value={item.web_listing_source}
                  colors={colors}
                />
              </Section>
            )}

            {item.notes && (
              <Section title="NOTES" colors={colors}>
                <Text
                  style={[styles.notes, { color: colors.foreground }]}
                >
                  {item.notes}
                </Text>
              </Section>
            )}
          </View>
        </ScrollView>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
  },
  heroImage: {
    width: "100%",
    height: 280,
  },
  heroPlaceholder: {
    width: "100%",
    height: 220,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 16,
    gap: 12,
  },
  titleRow: {
    gap: 8,
  },
  itemName: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    lineHeight: 28,
  },
  categoryBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  categoryText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "capitalize",
  },
  description: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
    marginTop: 4,
  },
  section: {
    borderWidth: 1,
    padding: 16,
    gap: 0,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  detailLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
    marginRight: 8,
  },
  detailValue: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    flex: 1,
    textAlign: "right",
  },
  notes: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  errorText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  errorSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  retryText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
});
