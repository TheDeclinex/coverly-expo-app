import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { CategoryPicker } from "@/components/CategoryPicker";
import { DraggablePhotoStrip, type PhotoEntry } from "@/components/DraggablePhotoStrip";
import { QuantityStepper } from "@/components/QuantityStepper";
import { useToast } from "@/components/Toast";
import { VoiceInputSheet } from "@/components/voice/VoiceInputSheet";
import { VoiceFieldButton } from "@/components/voice/VoiceFieldButton";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { formatCurrencyFull, getItemPhotos, getItemTotalValue } from "@/lib/inventory-mappers";
import { buildItemUpdatePayload } from "@/lib/item-insert-helpers";
import { formatUploadFailure, uploadItemPhoto } from "@/lib/photo-upload";
import { parseReplacementPriceInput, resolveReviewedValueCurrency, resolveStoredValueCurrency, resolveValueMarket, supportedCurrencyCode } from "@/lib/replacement-value";
import { supabase } from "@/lib/supabase";
import type { InventoryItem, InventoryRoom } from "@/types";
import type { VoiceItemField, VoiceItemPatch } from "@/types/voice";

export type ItemMaintenanceSaveState = "idle" | "dirty" | "saving" | "saved";
export type ItemMaintenanceFormHandle = { save: () => void };

type Draft = {
  name: string; description: string; category: string; price: string; quantity: string;
  brandMaker: string; modelSeries: string; conditionLabel: string; purchaseSource: string;
  purchaseYear: string; originalPrice: string; notes: string; roomId: string;
};

const fromItem = (item: InventoryItem): Draft => ({
  name: item.name ?? "", description: item.description ?? "", category: item.category ?? "",
  price: String(item.unit_estimated_price ?? item.estimated_price ?? ""), quantity: String(item.quantity ?? 1),
  brandMaker: item.brand_maker ?? "", modelSeries: item.model_series ?? "", conditionLabel: item.condition_label ?? "",
  purchaseSource: item.purchase_source ?? "", purchaseYear: item.purchase_year_approx ?? "",
  originalPrice: String(item.original_purchase_price ?? ""), notes: item.notes ?? "", roomId: item.room_id ?? "",
});

const parseOriginalMoney = (value: string) => {
  const cleaned = value.replace(/[^0-9.]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const localUri = (url: string) => ["file://", "ph://", "content://", "blob:"].some((prefix) => url.startsWith(prefix));

function Field({ label, children, action }: { label: string; children: React.ReactNode; action?: React.ReactNode }) {
  const colors = useColors();
  return <View style={styles.field}><View style={styles.fieldHeader}><Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>{action}</View>{children}</View>;
}

export const ItemMaintenanceForm = React.forwardRef<ItemMaintenanceFormHandle, {
  item: InventoryItem;
  rooms: Pick<InventoryRoom, "id" | "name" | "file_id">[];
  valueSource?: string | null;
  onOpenValueSource?: () => void;
  onReviewReplacementPrice: () => void;
  barcodeAction: React.ReactNode;
  onDirtyChange?: (dirty: boolean) => void;
  onSaveStateChange?: (state: ItemMaintenanceSaveState) => void;
}>(function ItemMaintenanceForm({ item, rooms, valueSource, onOpenValueSource, onReviewReplacementPrice, barcodeAction, onDirtyChange, onSaveStateChange }, ref) {
  const colors = useColors();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [draft, setDraft] = React.useState(() => fromItem(item));
  const [photos, setPhotos] = React.useState<PhotoEntry[]>(() => getItemPhotos(item));
  const [photosModified, setPhotosModified] = React.useState(false);
  const [detailsOpen, setDetailsOpen] = React.useState(true);
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  const [voiceTarget, setVoiceTarget] = React.useState<VoiceItemField | undefined>();
  const [saving, setSaving] = React.useState(false);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const savedFlashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [voiceEstimatedCurrency, setVoiceEstimatedCurrency] = React.useState<string | null>(null);
  const [voiceOriginalCurrency, setVoiceOriginalCurrency] = React.useState<string | null>(null);
  const { data: propertyMarket } = useQuery({
    queryKey: ["property-market", item.file_id],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_files").select("country_code,currency_code").eq("id", item.file_id).single();
      if (error) throw error;
      return data as { country_code: string; currency_code: string };
    },
  });
  const storedReplacementCurrency = resolveStoredValueCurrency(item.estimated_currency, propertyMarket?.currency_code);
  const storedPurchaseCurrency = resolveStoredValueCurrency(item.original_purchase_currency, propertyMarket?.currency_code);
  const replacementCurrency = resolveReviewedValueCurrency(voiceEstimatedCurrency, item.estimated_currency, propertyMarket?.currency_code);
  const purchaseCurrency = resolveReviewedValueCurrency(voiceOriginalCurrency, item.original_purchase_currency, propertyMarket?.currency_code);
  const hydratedItemId = React.useRef(item.id);
  const dirty = photosModified
    || JSON.stringify(draft) !== JSON.stringify(fromItem(item))
    || replacementCurrency !== storedReplacementCurrency
    || purchaseCurrency !== storedPurchaseCurrency;

  React.useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  React.useEffect(() => {
    onSaveStateChange?.(saving ? "saving" : savedFlash ? "saved" : dirty ? "dirty" : "idle");
  }, [dirty, onSaveStateChange, savedFlash, saving]);
  React.useEffect(() => () => {
    if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
  }, []);

  React.useEffect(() => {
    if (hydratedItemId.current === item.id) return;
    hydratedItemId.current = item.id;
    setDraft(fromItem(item));
    setPhotos(getItemPhotos(item));
    setPhotosModified(false);
    setDetailsOpen(true);
    setVoiceEstimatedCurrency(null);
    setVoiceOriginalCurrency(null);
  }, [item]);

  const set = React.useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  }, []);

  const applyVoice = React.useCallback((patch: VoiceItemPatch) => {
    const reviewedReplacementCurrency = supportedCurrencyCode(patch.estimated_currency);
    const reviewedPurchaseCurrency = supportedCurrencyCode(patch.original_purchase_currency);
    if (reviewedReplacementCurrency) setVoiceEstimatedCurrency(reviewedReplacementCurrency);
    if (reviewedPurchaseCurrency) setVoiceOriginalCurrency(reviewedPurchaseCurrency);
    setDraft((current) => ({
      ...current,
      ...(patch.name !== undefined ? { name: patch.name ?? "" } : {}),
      ...(patch.description !== undefined ? { description: patch.description ?? "" } : {}),
      ...(patch.category !== undefined ? { category: patch.category ?? "" } : {}),
      ...(patch.quantity != null ? { quantity: String(patch.quantity) } : {}),
      ...(patch.brand_maker !== undefined ? { brandMaker: patch.brand_maker ?? "" } : {}),
      ...(patch.model_series !== undefined ? { modelSeries: patch.model_series ?? "" } : {}),
      ...(patch.purchase_source !== undefined ? { purchaseSource: patch.purchase_source ?? "" } : {}),
      ...(patch.purchase_year_approx !== undefined ? { purchaseYear: patch.purchase_year_approx ?? "" } : {}),
      ...(patch.original_purchase_price !== undefined ? { originalPrice: String(patch.original_purchase_price ?? "") } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes ?? "" } : {}),
      ...(patch.unit_estimated_price !== undefined || patch.estimated_price !== undefined
        ? { price: String(patch.unit_estimated_price ?? patch.estimated_price ?? "") } : {}),
    }));
    setError(null);
  }, []);

  const save = React.useCallback(async () => {
    if (saving) return;
    if (!draft.name.trim()) return setError("Item name is required.");
    if (!draft.roomId) return setError("Please select a room.");
    const replacementPrice = parseReplacementPriceInput(draft.price);
    const parsedPrice = replacementPrice.value;
    const parsedOriginal = parseOriginalMoney(draft.originalPrice);
    if (replacementPrice.status === "invalid") return setError("Enter a valid price.");
    if (parsedPrice != null && !item.estimated_currency && !propertyMarket) return setError("Property market details are still loading. Please try again.");
    if (draft.originalPrice.trim() && parsedOriginal === null) return setError("Enter a valid original price.");
    setSaving(true); setError(null);
    try {
      const uploaded: PhotoEntry[] = [];
      const failedUploads: string[] = [];
      for (const photo of photos) {
        if (!localUri(photo.url)) { uploaded.push(photo); continue; }
        if (!session?.user.id) throw new Error("Not signed in");
        const result = await uploadItemPhoto(photo.url, session.user.id, item.file_id);
        if (!result.ok) { failedUploads.push(formatUploadFailure(result)); continue; }
        uploaded.push({ url: result.path, caption: photo.caption });
      }
      const destination = rooms.find((room) => room.id === draft.roomId);
      const priceChanged = parsedPrice !== (item.unit_estimated_price ?? item.estimated_price ?? null)
        || replacementCurrency !== storedReplacementCurrency;
      const purchaseChanged = parsedOriginal !== item.original_purchase_price
        || purchaseCurrency !== storedPurchaseCurrency;
      const updates = buildItemUpdatePayload({
        roomId: draft.roomId, roomName: destination?.name ?? null, name: draft.name,
        description: draft.description, category: draft.category, estimatedPrice: parsedPrice,
        unitEstimatedPrice: parsedPrice, quantity: Number.parseInt(draft.quantity, 10) || 1,
        brandMaker: draft.brandMaker, modelSeries: draft.modelSeries, conditionLabel: draft.conditionLabel,
        purchaseSource: draft.purchaseSource, purchaseYearApprox: draft.purchaseYear,
        originalPurchasePrice: parsedOriginal, notes: draft.notes,
        ...(priceChanged ? { priceSourceType: "user_entered", valuationBasis: "manual" } : {}),
        ...(priceChanged ? { estimatedCurrency: replacementCurrency, valuationMarket: resolveValueMarket(replacementCurrency, item.estimated_currency, item.valuation_market, propertyMarket?.currency_code, propertyMarket?.country_code), estimatedAt: parsedPrice == null ? null : new Date().toISOString() } : {}),
        ...(purchaseChanged ? { originalPurchaseCurrency: purchaseCurrency } : {}),
        photos: photosModified ? uploaded : undefined,
      });
      const { data, error: updateError } = await supabase.from("inventory_items").update(updates).eq("id", item.id).select("*").single();
      if (updateError) throw updateError;
      const updated = data as InventoryItem;
      queryClient.setQueryData(["item", item.id, session?.user.id], updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["items", item.room_id] }),
        queryClient.invalidateQueries({ queryKey: ["items", draft.roomId] }),
        queryClient.invalidateQueries({ queryKey: ["all-items"] }),
        queryClient.invalidateQueries({ queryKey: ["property-items", item.file_id] }),
      ]);
      setPhotos(getItemPhotos(updated)); setPhotosModified(false);
      setError(failedUploads.length > 0 ? `${failedUploads.length} photo(s) failed to upload and were skipped.` : null);
      setSavedFlash(true);
      if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
      savedFlashTimer.current = setTimeout(() => setSavedFlash(false), 1200);
      showToast("Item updated");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save changes."); }
    finally { setSaving(false); }
  }, [draft, item, photos, photosModified, propertyMarket?.country_code, propertyMarket?.currency_code, purchaseCurrency, queryClient, replacementCurrency, rooms, saving, session?.user.id, showToast, storedPurchaseCurrency, storedReplacementCurrency]);

  React.useImperativeHandle(ref, () => ({ save: () => { void save(); } }), [save]);

  const openVoice = React.useCallback((target?: VoiceItemField) => { setVoiceTarget(target); setVoiceOpen(true); }, []);

  const input = (key: keyof Draft, multiline = false, placeholder?: string) => <TextInput value={draft[key]} onChangeText={(value) => set(key, value)} placeholder={placeholder} placeholderTextColor={colors.mutedForeground} multiline={multiline} keyboardType={key === "price" || key === "originalPrice" ? "decimal-pad" : "default"} style={[styles.input, multiline && styles.multiline, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]} />;
  const parsedDraftPrice = parseReplacementPriceInput(draft.price).value;
  const draftQuantity = Number.parseInt(draft.quantity, 10) || 1;
  const recordedTotal = draft.price.trim() && parsedDraftPrice !== null
    ? getItemTotalValue({ ...item, estimated_price: parsedDraftPrice, unit_estimated_price: parsedDraftPrice, quantity: draftQuantity })
    : null;
  const displayedValueSource = parsedDraftPrice !== (item.unit_estimated_price ?? item.estimated_price ?? null)
    ? "User entered"
    : valueSource;

  return <View style={styles.form}>
    <View style={styles.section}><Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>OVERVIEW</Text>
      <Pressable onPress={() => openVoice()} style={[styles.voice, { borderColor: colors.primary, backgroundColor: colors.accent }]}><Feather name="mic" size={17} color={colors.primary} /><Text style={[styles.voiceText, { color: colors.primary }]}>Fill or edit with voice</Text></Pressable>
      <Field label="Name" action={<VoiceFieldButton label="item name" onPress={() => openVoice("name")} />}>{input("name")}</Field><Field label="Description" action={<VoiceFieldButton label="description" onPress={() => openVoice("description")} />}>{input("description", true)}</Field>
      <Field label="Category"><CategoryPicker value={draft.category} onChange={(value) => set("category", value)} /></Field>
      <Text style={[styles.subsectionTitle, { color: colors.mutedForeground }]}>ROOM</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{rooms.map((room) => <Pressable key={room.id} onPress={() => set("roomId", room.id)} style={[styles.chip, { backgroundColor: draft.roomId === room.id ? colors.primary : colors.secondary }]}><Text style={{ color: draft.roomId === room.id ? colors.primaryForeground : colors.foreground }}>{room.name}</Text></Pressable>)}</ScrollView>
      <View style={styles.photosHeading}><Feather name="image" size={15} color={colors.primary} /><Text style={[styles.photosTitle, { color: colors.foreground }]}>PHOTOS</Text></View>
      <DraggablePhotoStrip photos={photos} onChange={(next) => { setPhotos(next); setPhotosModified(true); }} colors={colors} />
    </View>

    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>VALUE</Text>
      <View style={[styles.valueCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.row}><View style={styles.grow}><Field label={`Each price (${replacementCurrency})`}>{input("price")}</Field></View><View style={styles.qty}><Field label="Quantity"><QuantityStepper value={draft.quantity} onChange={(value) => set("quantity", value)} /></Field></View></View>
        <View style={[styles.valueSummary, { borderTopColor: colors.border }]}>
          <View><Text style={[styles.valueLabel, { color: colors.mutedForeground }]}>Recorded total</Text><Text style={[styles.valueTotal, { color: colors.foreground }]}>{recordedTotal === null ? "—" : formatCurrencyFull(recordedTotal, replacementCurrency)}</Text></View>
          {displayedValueSource ? <Pressable disabled={!onOpenValueSource} onPress={onOpenValueSource} style={styles.valueSource}><Text style={[styles.valueLabel, { color: colors.mutedForeground }]}>Value source</Text><Text style={[styles.valueSourceText, { color: onOpenValueSource ? colors.primary : colors.foreground }]}>{displayedValueSource}{onOpenValueSource ? " ↗" : ""}</Text></Pressable> : null}
        </View>
        {item.quantity_estimate ? <View style={styles.estimateRow}><Text style={[styles.valueLabel, { color: colors.mutedForeground }]}>Quantity estimate</Text><Text style={[styles.estimateValue, { color: colors.foreground }]}>{item.quantity_estimate}</Text></View> : null}
        <Pressable onPress={onReviewReplacementPrice} style={({ pressed }) => [styles.replacementAction, { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 }]}>
          <Feather name="search" size={16} color={colors.primaryForeground} />
          <View style={styles.grow}><Text style={[styles.replacementTitle, { color: colors.primaryForeground }]}>Review replacement price</Text><Text style={[styles.replacementHint, { color: colors.primaryForeground }]}>Find or update the current replacement value</Text></View>
          <Feather name="chevron-right" size={16} color={colors.primaryForeground} />
        </Pressable>
      </View>
    </View>

    <View style={styles.section}><Pressable accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen((value) => !value)} style={[styles.detailsHeader, { backgroundColor: colors.accent, borderColor: colors.border }]}><View style={[styles.icon, { backgroundColor: colors.card }]}><Feather name="package" size={17} color={colors.primary} /></View><View style={styles.grow}><Text style={[styles.detailsTitle, { color: colors.foreground }]}>Product & purchase details</Text><Text style={[styles.detailsSub, { color: colors.mutedForeground }]}>Brand, model, condition and purchase history</Text></View><Feather name={detailsOpen ? "chevron-up" : "chevron-down"} size={20} color={colors.primary} /></Pressable>
      {detailsOpen ? <View style={[styles.detailsBody, { borderColor: colors.border, backgroundColor: colors.card }]}><Field label="Brand / Maker" action={<VoiceFieldButton label="brand or maker" onPress={() => openVoice("brand_maker")} />}>{input("brandMaker", false, "e.g. Samsung")}</Field><Field label="Model / Series" action={<VoiceFieldButton label="model or series" onPress={() => openVoice("model_series")} />}>{input("modelSeries", false, "e.g. QN90B")}</Field><Field label="Condition">{input("conditionLabel", false, "e.g. Excellent")}</Field><Field label="Purchased from" action={<VoiceFieldButton label="purchase source" onPress={() => openVoice("purchase_source")} />}>{input("purchaseSource", false, "e.g. Harvey Norman")}</Field><Field label="Purchase year">{input("purchaseYear", false, "e.g. 2022")}</Field><Field label={`Original price (${purchaseCurrency})`}>{input("originalPrice", false, "e.g. 399")}</Field><Field label="Notes" action={<VoiceFieldButton label="notes" onPress={() => openVoice("notes")} />}>{input("notes", true, "Optional notes")}</Field>{barcodeAction}</View> : null}
    </View>
    {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
    <VoiceInputSheet visible={voiceOpen} title={voiceTarget ? "Fill field with voice" : "Fill item with voice"} targetField={voiceTarget} currentValues={{ name: draft.name, description: draft.description, category: draft.category, quantity: Number.parseInt(draft.quantity, 10) || 1, estimated_price: parseReplacementPriceInput(draft.price).value, unit_estimated_price: parseReplacementPriceInput(draft.price).value, estimated_currency: replacementCurrency, brand_maker: draft.brandMaker, model_series: draft.modelSeries, purchase_source: draft.purchaseSource, purchase_year_approx: draft.purchaseYear, original_purchase_price: parseOriginalMoney(draft.originalPrice), original_purchase_currency: purchaseCurrency, notes: draft.notes }} context={{ itemId: item.id, currentName: draft.name, currentCategory: draft.category, currentDescription: draft.description }} onClose={() => setVoiceOpen(false)} onApply={applyVoice} />
  </View>;
});

const styles = StyleSheet.create({ form: { gap: 22 }, section: { gap: 13 }, sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: .8 }, subsectionTitle: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: .7, marginTop: 2 }, field: { gap: 6 }, fieldHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 28 }, label: { fontSize: 12, fontFamily: "Inter_500Medium" }, input: { borderWidth: 1, borderRadius: 10, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 }, multiline: { minHeight: 84, textAlignVertical: "top" }, row: { flexDirection: "row", gap: 12 }, grow: { flex: 1 }, qty: { width: 120 }, voice: { flexDirection: "row", alignItems: "center", gap: 9, padding: 12, borderWidth: 1, borderRadius: 10 }, voiceText: { fontFamily: "Inter_600SemiBold" }, valueCard: { borderWidth: 1, borderRadius: 12, padding: 13, gap: 13 }, valueSummary: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }, valueLabel: { fontSize: 11, fontFamily: "Inter_500Medium" }, valueTotal: { fontSize: 20, fontFamily: "Inter_700Bold", marginTop: 3 }, valueSource: { alignItems: "flex-end", maxWidth: "50%" }, valueSourceText: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 4, textAlign: "right" }, estimateRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, estimateValue: { fontSize: 13, fontFamily: "Inter_500Medium" }, replacementAction: { minHeight: 52, borderRadius: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10 }, replacementTitle: { fontSize: 13, fontFamily: "Inter_700Bold" }, replacementHint: { fontSize: 11, lineHeight: 16, marginTop: 2 }, detailsHeader: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, padding: 13 }, icon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" }, detailsTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" }, detailsSub: { fontSize: 11, marginTop: 3 }, detailsBody: { gap: 13, borderWidth: 1, borderTopWidth: 0, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, padding: 14 }, chips: { gap: 8 }, chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 }, photosHeading: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 2 }, photosTitle: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: .8 }, error: { fontSize: 13, fontFamily: "Inter_500Medium" } });
