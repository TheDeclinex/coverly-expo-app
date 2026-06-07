import { Feather } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorState } from "@/components/ErrorState";
import { ExpandableImage } from "@/components/ExpandableImage";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSignedUrls } from "@/hooks/useSignedUrls";
import { formatCurrencyFull } from "@/lib/inventory-mappers";
import { supabase } from "@/lib/supabase";
import type { InventoryItem } from "@/types";

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
  const queryClient = useQueryClient();

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

  const rawPrimaryUri = item?.image_url ?? item?.photo_url;

  const itemPin = React.useMemo(() => {
    const raw = item?.image_pin as Record<string, unknown> | null | undefined;
    if (!raw || typeof raw.x !== "number" || typeof raw.y !== "number") return null;
    return { x: raw.x, y: raw.y };
  }, [item?.image_pin]);

  const rawPhotoUris: string[] = React.useMemo(() => {
    const uris: string[] = [];
    if (rawPrimaryUri) uris.push(rawPrimaryUri);
    for (const att of item?.attachments ?? []) {
      if (att.url && !uris.includes(att.url)) uris.push(att.url);
    }
    return uris;
  }, [rawPrimaryUri, item?.attachments]);

  // Resolve storage paths → 1-hr signed URLs in one batch call.
  // While loading, signedUriMap is empty — use null so ExpandableImage shows its
  // placeholder rather than passing an invalid storage path to the Image component.
  const signedUriMap = useSignedUrls(rawPhotoUris);
  const allPhotoUris = rawPhotoUris.map((u) => signedUriMap.get(u) ?? null).filter((u): u is string => u !== null);
  const primaryUri = allPhotoUris[0] ?? null;

  const handleEdit = async () => {
    router.push({
      pathname: "/(tabs)/edit-item/[id]",
      params: { id: id! },
    });
  };

  /**
   * Saves the repositioned pin to Supabase. Called by DraggablePinLayer on drop.
   * Throws on error so DraggablePinLayer can revert the optimistic pin position.
   */
  const handleRepositionPin = React.useCallback(
    async (x: number, y: number) => {
      if (!item) throw new Error("Item not loaded");
      const rawPin = item.image_pin as Record<string, unknown> | null | undefined;
      const { error } = await supabase
        .from("inventory_items")
        .update({
          image_pin: {
            x,
            y,
            sourcePhotoIndex: (rawPin?.sourcePhotoIndex as number | undefined) ?? 0,
            type: rawPin?.type ?? "user",
          },
        })
        .eq("id", item.id);
      if (error) throw new Error(error.message);
      queryClient.invalidateQueries({ queryKey: ["item", id, session?.user.id] });
    },
    [item, id, session?.user.id, queryClient],
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: name ?? "Item Detail",
          headerRight: () => (
            <Pressable onPress={handleEdit} style={{ padding: 4 }} hitSlop={8}>
              <Feather name="edit-2" size={18} color={colors.primary} />
            </Pressable>
          ),
        }}
      />
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState
          message="Failed to load item"
          detail={(error as Error).message}
          onRetry={refetch}
        />
      ) : item ? (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom: insets.bottom + 32,
              ...(Platform.OS === "web" ? { paddingTop: 16 } : {}),
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <ExpandableImage
            uri={primaryUri}
            style={styles.heroImage}
            contentFit="cover"
            placeholderIcon="package"
            placeholderIconSize={48}
            placeholderIconColor={colors.primary}
            placeholderBackgroundColor={colors.secondary}
            allUris={allPhotoUris}
            initialPhotoIndex={0}
            pin={itemPin}
            onReposition={itemPin ? handleRepositionPin : undefined}
          />
          {itemPin && (
            <Text style={[styles.pinHint, { color: colors.mutedForeground }]}>
              Long-press the pin to reposition it
            </Text>
          )}

          <View style={styles.content}>
            <View style={styles.titleRow}>
              <Text style={[styles.itemName, { color: colors.foreground }]}>
                {item.name}
              </Text>
              {item.category && (
                <View
                  style={[
                    styles.categoryBadge,
                    { backgroundColor: colors.accent, borderRadius: 8 },
                  ]}
                >
                  <Text
                    style={[styles.categoryText, { color: colors.accentForeground }]}
                  >
                    {item.category}
                  </Text>
                </View>
              )}
            </View>

            {item.description && (
              <Text style={[styles.description, { color: colors.mutedForeground }]}>
                {item.description}
              </Text>
            )}

            <Pressable
              onPress={handleEdit}
              style={({ pressed }) => [
                styles.editBtn,
                {
                  backgroundColor: colors.secondary,
                  borderRadius: colors.radius,
                  borderColor: colors.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Feather name="edit-2" size={15} color={colors.primary} />
              <Text style={[styles.editBtnText, { color: colors.primary }]}>
                Edit item
              </Text>
            </Pressable>

            <Section title="VALUATION" colors={colors}>
              <DetailRow
                label="Estimated replacement"
                value={formatCurrencyFull(item.estimated_price)}
                colors={colors}
              />
              <DetailRow
                label="Unit price"
                value={formatCurrencyFull(item.unit_estimated_price)}
                colors={colors}
              />
              <DetailRow label="Quantity" value={item.quantity} colors={colors} />
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
              <DetailRow label="Confidence" value={item.confidence} colors={colors} />
            </Section>

            {(item.brand_maker || item.model_series || item.condition_label) && (
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
                  value={formatCurrencyFull(item.original_purchase_price)}
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

            {/* WEB LISTING section removed — inventory_items no longer has web_listing_* columns */}

            {item.notes && (
              <Section title="NOTES" colors={colors}>
                <Text style={[styles.notes, { color: colors.foreground }]}>
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
  scrollContent: { flexGrow: 1 },
  heroImage: { width: "100%", height: 280 },
  heroPlaceholder: {
    width: "100%",
    height: 220,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { padding: 16, gap: 12 },
  titleRow: { gap: 8 },
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
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  editBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
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
  pinHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingVertical: 5,
    opacity: 0.7,
  },
});
