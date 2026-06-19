import { Feather } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorState } from "@/components/ErrorState";
import { ExpandableImage } from "@/components/ExpandableImage";
import { ItemEvidenceSection } from "@/components/ItemEvidenceSection";
import { LoadingState } from "@/components/LoadingState";
import { QuantityStepper } from "@/components/QuantityStepper";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSignedUrls } from "@/hooks/useSignedUrls";
import { formatCurrencyFull, getItemUnitPrice } from "@/lib/inventory-mappers";
import { supabase } from "@/lib/supabase";
import type { InventoryItem } from "@/types";

// One-line rollback for the item review/edit trial.
const ITEM_REVIEW_EDIT_TRIAL = true;

type InlineField = "name" | "quantity" | "brand_maker";

function DetailRow({
  label,
  value,
  colors,
  onPress,
}: {
  label: string;
  value: string | number | null | undefined;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onPress?: () => void;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      {onPress ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open ${String(value)}`}
          onPress={onPress}
          hitSlop={6}
          style={styles.detailLink}
        >
          <Text style={[styles.detailValue, styles.linkText, { color: colors.primary }]}>
            {String(value)} <Feather name="external-link" size={12} color={colors.primary} />
          </Text>
        </Pressable>
      ) : (
        <Text
          style={[styles.detailValue, { color: colors.foreground }]}
          numberOfLines={4}
        >
          {String(value)}
        </Text>
      )}
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

function valuationSourceLabel(item: InventoryItem): string | null {
  const priceSource = (item.price_source_type ?? "").toLowerCase();
  if (priceSource === "web_listing" || priceSource.includes("listing")) {
    return "Replacement listing";
  }
  if (priceSource.includes("user") || priceSource.includes("manual")) {
    return "User entered";
  }
  if (priceSource.includes("ai") || priceSource.includes("scan")) {
    return "AI estimate";
  }

  const basis = (item.valuation_basis ?? "").toLowerCase();
  if (basis.includes("listing")) return "Replacement listing";
  if (basis.includes("ai")) return "AI estimate";
  if (basis.includes("user") || basis.includes("manual")) return "User entered";
  return item.valuation_basis;
}

function isWebUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function QuickEditRow({
  label,
  value,
  editing,
  draft,
  keyboardType,
  quantityStepper = false,
  saving,
  colors,
  onStart,
  onChange,
  onSave,
  onCancel,
}: {
  label: string;
  value: string | number | null | undefined;
  editing: boolean;
  draft: string;
  keyboardType?: "default" | "numeric";
  quantityStepper?: boolean;
  saving: boolean;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onStart: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={[styles.quickEditRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.quickEditLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      {editing ? (
        <View style={styles.quickEditControls}>
          <View style={styles.quickEditActions}>
            <Pressable
              accessibilityLabel={`Save ${label}`}
              onPress={onSave}
              disabled={saving}
              hitSlop={6}
              style={[styles.iconButton, { backgroundColor: colors.primary }]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Feather name="check" size={15} color={colors.primaryForeground} />
              )}
            </Pressable>
            <Pressable
              accessibilityLabel={`Cancel editing ${label}`}
              onPress={onCancel}
              disabled={saving}
              hitSlop={6}
              style={[styles.iconButton, { backgroundColor: colors.secondary }]}
            >
              <Feather name="x" size={15} color={colors.foreground} />
            </Pressable>
          </View>
          {quantityStepper ? (
            <QuantityStepper
              value={draft}
              onChange={onChange}
              disabled={saving}
              compact
            />
          ) : (
            <TextInput
              autoFocus
              value={draft}
              onChangeText={onChange}
              keyboardType={keyboardType ?? "default"}
              selectTextOnFocus
              editable={!saving}
              onSubmitEditing={onSave}
              style={[
                styles.quickEditInput,
                {
                  color: colors.foreground,
                  backgroundColor: colors.background,
                  borderColor: colors.primary,
                },
              ]}
            />
          )}
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${label}`}
          onPress={onStart}
          hitSlop={6}
          style={styles.quickEditValueButton}
        >
          <Text
            numberOfLines={2}
            style={[
              styles.quickEditValue,
              { color: value === null || value === undefined || value === "" ? colors.mutedForeground : colors.foreground },
            ]}
          >
            {value === null || value === undefined || value === "" ? "Add" : String(value)}
          </Text>
          <Feather name="edit-2" size={13} color={colors.primary} />
        </Pressable>
      )}
    </View>
  );
}

export default function ItemDetailScreen() {
  const { id, name, evidence } = useLocalSearchParams<{ id: string; name: string; evidence?: string }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [editingField, setEditingField] = React.useState<InlineField | null>(null);
  const [inlineDraft, setInlineDraft] = React.useState("");
  const [savingInline, setSavingInline] = React.useState(false);

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

  const handleReplacementPricing = () => {
    router.push(`/(tabs)/replacement-pricing/${id}` as Href);
  };

  const startInlineEdit = (field: InlineField, value: string | number | null) => {
    setEditingField(field);
    setInlineDraft(value === null ? "" : String(value));
  };

  const cancelInlineEdit = () => {
    setEditingField(null);
    setInlineDraft("");
  };

  const saveInlineEdit = async () => {
    if (!item || !editingField || savingInline) return;

    const trimmed = inlineDraft.trim();
    let updates: Partial<Pick<InventoryItem, "name" | "quantity" | "brand_maker">>;

    if (editingField === "name") {
      if (!trimmed) {
        Alert.alert("Item name required", "Enter a name before saving.");
        return;
      }
      updates = { name: trimmed };
    } else if (editingField === "quantity") {
      const quantity = Number(trimmed);
      if (!Number.isInteger(quantity) || quantity < 1) {
        Alert.alert("Check quantity", "Quantity must be a whole number of 1 or more.");
        return;
      }
      updates = { quantity };
    } else {
      updates = { brand_maker: trimmed || null };
    }

    setSavingInline(true);
    try {
      const { data, error: updateError } = await supabase
        .from("inventory_items")
        .update(updates)
        .eq("id", item.id)
        .select("*")
        .single();
      if (updateError) throw updateError;

      queryClient.setQueryData(
        ["item", id, session?.user.id],
        data as InventoryItem,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["items", item.room_id] }),
        queryClient.invalidateQueries({ queryKey: ["all-items"] }),
        queryClient.invalidateQueries({ queryKey: ["property-items", item.file_id] }),
      ]);
      cancelInlineEdit();
      showToast("Item updated");
    } catch (updateFailure) {
      Alert.alert(
        "Couldn’t update item",
        updateFailure instanceof Error ? updateFailure.message : "Please try again.",
      );
    } finally {
      setSavingInline(false);
    }
  };

  const handleOpenReplacementListing = () => {
    if (!isWebUrl(item?.web_listing_url)) return;
    void WebBrowser.openBrowserAsync(item.web_listing_url);
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
          title: item?.name ?? name ?? "Item Detail",
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

            {ITEM_REVIEW_EDIT_TRIAL ? (
              <>
                <Section title="QUICK EDIT" colors={colors}>
                  <QuickEditRow
                    label="Item name"
                    value={item.name}
                    editing={editingField === "name"}
                    draft={inlineDraft}
                    saving={savingInline}
                    colors={colors}
                    onStart={() => startInlineEdit("name", item.name)}
                    onChange={setInlineDraft}
                    onSave={() => void saveInlineEdit()}
                    onCancel={cancelInlineEdit}
                  />
                  <QuickEditRow
                    label="Quantity"
                    value={item.quantity ?? 1}
                    editing={editingField === "quantity"}
                    draft={inlineDraft}
                    keyboardType="numeric"
                    quantityStepper
                    saving={savingInline}
                    colors={colors}
                    onStart={() => startInlineEdit("quantity", item.quantity ?? 1)}
                    onChange={setInlineDraft}
                    onSave={() => void saveInlineEdit()}
                    onCancel={cancelInlineEdit}
                  />
                  <QuickEditRow
                    label="Brand / Maker"
                    value={item.brand_maker}
                    editing={editingField === "brand_maker"}
                    draft={inlineDraft}
                    saving={savingInline}
                    colors={colors}
                    onStart={() => startInlineEdit("brand_maker", item.brand_maker)}
                    onChange={setInlineDraft}
                    onSave={() => void saveInlineEdit()}
                    onCancel={cancelInlineEdit}
                  />
                </Section>

                <Section title="NEXT STEPS" colors={colors}>
                  {!rawPrimaryUri ? (
                    <Pressable
                      onPress={handleEdit}
                      style={({ pressed }) => [
                        styles.nextActionPrimary,
                        { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
                      ]}
                    >
                      <Feather name="camera" size={16} color={colors.primaryForeground} />
                      <View style={styles.nextActionCopy}>
                        <Text style={[styles.nextActionTitle, { color: colors.primaryForeground }]}>Add photos</Text>
                        <Text style={[styles.nextActionHint, { color: colors.primaryForeground }]}>Strengthen the item record</Text>
                      </View>
                      <Feather name="chevron-right" size={16} color={colors.primaryForeground} />
                    </Pressable>
                  ) : item.estimated_price == null || item.estimated_price <= 0 ? (
                    <Pressable
                      onPress={handleReplacementPricing}
                      style={({ pressed }) => [
                        styles.nextActionPrimary,
                        { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
                      ]}
                    >
                      <Feather name="search" size={16} color={colors.primaryForeground} />
                      <View style={styles.nextActionCopy}>
                        <Text style={[styles.nextActionTitle, { color: colors.primaryForeground }]}>Find replacement price</Text>
                        <Text style={[styles.nextActionHint, { color: colors.primaryForeground }]}>Add a current replacement value</Text>
                      </View>
                      <Feather name="chevron-right" size={16} color={colors.primaryForeground} />
                    </Pressable>
                  ) : !item.description || !item.category || !item.brand_maker ? (
                    <Pressable
                      onPress={handleEdit}
                      style={({ pressed }) => [
                        styles.nextActionPrimary,
                        { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
                      ]}
                    >
                      <Feather name="check-circle" size={16} color={colors.primaryForeground} />
                      <View style={styles.nextActionCopy}>
                        <Text style={[styles.nextActionTitle, { color: colors.primaryForeground }]}>Complete item details</Text>
                        <Text style={[styles.nextActionHint, { color: colors.primaryForeground }]}>Review photos, category and description</Text>
                      </View>
                      <Feather name="chevron-right" size={16} color={colors.primaryForeground} />
                    </Pressable>
                  ) : isWebUrl(item.web_listing_url) ? (
                    <Pressable
                      onPress={handleOpenReplacementListing}
                      style={({ pressed }) => [
                        styles.nextActionPrimary,
                        { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
                      ]}
                    >
                      <Feather name="external-link" size={16} color={colors.primaryForeground} />
                      <View style={styles.nextActionCopy}>
                        <Text style={[styles.nextActionTitle, { color: colors.primaryForeground }]}>Open replacement listing</Text>
                        <Text style={[styles.nextActionHint, { color: colors.primaryForeground }]}>Review the selected product source</Text>
                      </View>
                      <Feather name="chevron-right" size={16} color={colors.primaryForeground} />
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={handleReplacementPricing}
                      style={({ pressed }) => [
                        styles.nextActionPrimary,
                        { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
                      ]}
                    >
                      <Feather name="refresh-cw" size={16} color={colors.primaryForeground} />
                      <View style={styles.nextActionCopy}>
                        <Text style={[styles.nextActionTitle, { color: colors.primaryForeground }]}>Review replacement price</Text>
                        <Text style={[styles.nextActionHint, { color: colors.primaryForeground }]}>Compare current replacement listings</Text>
                      </View>
                      <Feather name="chevron-right" size={16} color={colors.primaryForeground} />
                    </Pressable>
                  )}

                  <View style={styles.secondaryActions}>
                    <Pressable
                      onPress={handleEdit}
                      style={({ pressed }) => [
                        styles.secondaryAction,
                        { borderColor: colors.border, backgroundColor: colors.secondary, opacity: pressed ? 0.8 : 1 },
                      ]}
                    >
                      <Feather name="edit-2" size={14} color={colors.foreground} />
                      <Text style={[styles.secondaryActionText, { color: colors.foreground }]}>Edit all details</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleReplacementPricing}
                      style={({ pressed }) => [
                        styles.secondaryAction,
                        { borderColor: colors.border, backgroundColor: colors.secondary, opacity: pressed ? 0.8 : 1 },
                      ]}
                    >
                      <Feather name="search" size={14} color={colors.foreground} />
                      <Text style={[styles.secondaryActionText, { color: colors.foreground }]}>Replacement price</Text>
                    </Pressable>
                  </View>
                </Section>
              </>
            ) : (
              <>
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
                  <Text style={[styles.editBtnText, { color: colors.primary }]}>Edit item</Text>
                </Pressable>
                <Pressable
                  onPress={handleReplacementPricing}
                  style={({ pressed }) => [
                    styles.pricingBtn,
                    {
                      backgroundColor: colors.primary,
                      borderRadius: colors.radius,
                      opacity: pressed ? 0.82 : 1,
                    },
                  ]}
                >
                  <Feather name="search" size={16} color={colors.primaryForeground} />
                  <Text style={[styles.pricingBtnText, { color: colors.primaryForeground }]}>Find replacement price</Text>
                </Pressable>
              </>
            )}

            <Section title="VALUATION" colors={colors}>
              <DetailRow
                label={(item.quantity ?? 1) > 1 ? "Each price" : "Price"}
                value={formatCurrencyFull(getItemUnitPrice(item))}
                colors={colors}
              />
              <DetailRow label="Quantity" value={item.quantity} colors={colors} />
              {(item.quantity ?? 1) > 1 ? (
                <DetailRow
                  label="Total price"
                  value={formatCurrencyFull(getItemUnitPrice(item) * (item.quantity ?? 1))}
                  colors={colors}
                />
              ) : null}
              <DetailRow
                label="Quantity estimate"
                value={item.quantity_estimate}
                colors={colors}
              />
              <DetailRow
                label="Value source"
                value={valuationSourceLabel(item)}
                colors={colors}
                onPress={
                  item.price_source_type === "web_listing" && isWebUrl(item.web_listing_url)
                    ? handleOpenReplacementListing
                    : undefined
                }
              />
              <DetailRow label="Confidence" value={item.confidence} colors={colors} />
            </Section>

            {session?.user.id ? (
              <ItemEvidenceSection
                itemId={item.id}
                fileId={item.file_id}
                userId={session.user.id}
                userEmail={session.user.email}
                autoOpenAdd={evidence === "add"}
              />
            ) : null}

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
  pricingBtn: {
    minHeight: 46,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  pricingBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  quickEditRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  quickEditLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  quickEditValueButton: {
    flex: 1.4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    minHeight: 44,
  },
  quickEditValue: { flexShrink: 1, fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "right" },
  quickEditControls: {
    flex: 1.4,
    minHeight: 44,
    alignItems: "flex-end",
    justifyContent: "center",
    position: "relative",
  },
  quickEditActions: {
    position: "absolute",
    right: "100%",
    marginRight: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    zIndex: 1,
  },
  quickEditInput: {
    flex: 1,
    alignSelf: "stretch",
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  iconButton: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  nextActionPrimary: {
    minHeight: 62,
    borderRadius: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  nextActionCopy: { flex: 1, gap: 2 },
  nextActionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  nextActionHint: { fontSize: 11, fontFamily: "Inter_400Regular", opacity: 0.82 },
  secondaryActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  secondaryAction: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  secondaryActionText: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
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
  detailLink: { flex: 1 },
  linkText: { textDecorationLine: "underline" },
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
