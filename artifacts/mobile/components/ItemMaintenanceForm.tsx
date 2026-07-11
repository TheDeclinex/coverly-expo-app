import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { CategoryPicker } from "@/components/CategoryPicker";
import { DraggablePhotoStrip, type PhotoEntry } from "@/components/DraggablePhotoStrip";
import { QuantityStepper } from "@/components/QuantityStepper";
import { useToast } from "@/components/Toast";
import { VoiceInputSheet } from "@/components/voice/VoiceInputSheet";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { getItemPhotos } from "@/lib/inventory-mappers";
import { buildItemUpdatePayload } from "@/lib/item-insert-helpers";
import { formatUploadFailure, uploadItemPhoto } from "@/lib/photo-upload";
import { supabase } from "@/lib/supabase";
import type { InventoryItem, InventoryRoom } from "@/types";
import type { VoiceItemPatch } from "@/types/voice";

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

const money = (value: string) => {
  const cleaned = value.replace(/[^0-9.]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const localUri = (url: string) => ["file://", "ph://", "content://", "blob:"].some((prefix) => url.startsWith(prefix));

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors();
  return <View style={styles.field}><Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>{children}</View>;
}

export function ItemMaintenanceForm({ item, rooms, onDirtyChange }: { item: InventoryItem; rooms: Pick<InventoryRoom, "id" | "name" | "file_id">[]; onDirtyChange?: (dirty: boolean) => void }) {
  const colors = useColors();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [draft, setDraft] = React.useState(() => fromItem(item));
  const [photos, setPhotos] = React.useState<PhotoEntry[]>(() => getItemPhotos(item));
  const [photosModified, setPhotosModified] = React.useState(false);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const hydratedItemId = React.useRef(item.id);
  const dirty = photosModified || JSON.stringify(draft) !== JSON.stringify(fromItem(item));

  React.useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  React.useEffect(() => {
    if (hydratedItemId.current === item.id) return;
    hydratedItemId.current = item.id;
    setDraft(fromItem(item));
    setPhotos(getItemPhotos(item));
    setPhotosModified(false);
    setDetailsOpen(false);
  }, [item]);

  const set = React.useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  }, []);

  const applyVoice = React.useCallback((patch: VoiceItemPatch) => {
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
    const parsedPrice = money(draft.price);
    const parsedOriginal = money(draft.originalPrice);
    if (draft.price.trim() && parsedPrice === null) return setError("Enter a valid price.");
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
      const priceChanged = parsedPrice !== (item.unit_estimated_price ?? item.estimated_price ?? null);
      const updates = buildItemUpdatePayload({
        roomId: draft.roomId, roomName: destination?.name ?? null, name: draft.name,
        description: draft.description, category: draft.category, estimatedPrice: parsedPrice,
        unitEstimatedPrice: parsedPrice, quantity: Number.parseInt(draft.quantity, 10) || 1,
        brandMaker: draft.brandMaker, modelSeries: draft.modelSeries, conditionLabel: draft.conditionLabel,
        purchaseSource: draft.purchaseSource, purchaseYearApprox: draft.purchaseYear,
        originalPurchasePrice: parsedOriginal, notes: draft.notes,
        ...(priceChanged ? { priceSourceType: "user_entered", valuationBasis: "manual" } : {}),
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
      showToast("Item updated");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save changes."); }
    finally { setSaving(false); }
  }, [draft, item, photos, photosModified, queryClient, rooms, saving, session?.user.id, showToast]);

  const input = (key: keyof Draft, multiline = false) => <TextInput value={draft[key]} onChangeText={(value) => set(key, value)} multiline={multiline} keyboardType={key === "price" || key === "originalPrice" ? "decimal-pad" : "default"} style={[styles.input, multiline && styles.multiline, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]} />;
  return <View style={styles.form}>
    <View style={styles.section}><Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ITEM DETAILS</Text>
      <Pressable onPress={() => setVoiceOpen(true)} style={[styles.voice, { borderColor: colors.primary, backgroundColor: colors.accent }]}><Feather name="mic" size={17} color={colors.primary} /><Text style={[styles.voiceText, { color: colors.primary }]}>Fill or edit with voice</Text></Pressable>
      <Field label="Name">{input("name")}</Field><Field label="Description">{input("description", true)}</Field>
      <Field label="Category"><CategoryPicker value={draft.category} onChange={(value) => set("category", value)} /></Field>
      <View style={styles.row}><View style={styles.grow}><Field label="Each price ($)">{input("price")}</Field></View><View style={styles.qty}><Field label="Quantity"><QuantityStepper value={draft.quantity} onChange={(value) => set("quantity", value)} /></Field></View></View>
    </View>
    <View style={styles.section}><Pressable accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen((value) => !value)} style={[styles.detailsHeader, { backgroundColor: colors.accent, borderColor: colors.border }]}><View style={[styles.icon, { backgroundColor: colors.card }]}><Feather name="package" size={17} color={colors.primary} /></View><View style={styles.grow}><Text style={[styles.detailsTitle, { color: colors.foreground }]}>Product & purchase details</Text><Text style={[styles.detailsSub, { color: colors.mutedForeground }]}>Brand, model, condition and purchase history</Text></View><Feather name={detailsOpen ? "chevron-up" : "chevron-down"} size={20} color={colors.primary} /></Pressable>
      {detailsOpen ? <View style={[styles.detailsBody, { borderColor: colors.border }]}><Field label="Brand / Maker">{input("brandMaker")}</Field><Field label="Model / Series">{input("modelSeries")}</Field><Field label="Condition">{input("conditionLabel")}</Field><Field label="Purchased from">{input("purchaseSource")}</Field><Field label="Purchase year">{input("purchaseYear")}</Field><Field label="Original price ($)">{input("originalPrice")}</Field><Field label="Notes">{input("notes", true)}</Field></View> : null}
    </View>
    <View style={styles.section}><Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ROOM</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{rooms.map((room) => <Pressable key={room.id} onPress={() => set("roomId", room.id)} style={[styles.chip, { backgroundColor: draft.roomId === room.id ? colors.primary : colors.secondary }]}><Text style={{ color: draft.roomId === room.id ? colors.primaryForeground : colors.foreground }}>{room.name}</Text></Pressable>)}</ScrollView></View>
    <View style={styles.section}><Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>PHOTOS</Text><DraggablePhotoStrip photos={photos} onChange={(next) => { setPhotos(next); setPhotosModified(true); }} colors={colors} /></View>
    {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
    <Pressable disabled={saving} onPress={() => void save()} style={[styles.save, { backgroundColor: saving ? colors.muted : colors.primary }]}>{saving ? <ActivityIndicator color={colors.primaryForeground} /> : <><Feather name="check" size={18} color={colors.primaryForeground} /><Text style={[styles.saveText, { color: colors.primaryForeground }]}>Save Changes</Text></>}</Pressable>
    <VoiceInputSheet visible={voiceOpen} title="Fill item with voice" currentValues={{ name: draft.name, description: draft.description, category: draft.category, quantity: Number.parseInt(draft.quantity, 10) || 1, estimated_price: money(draft.price), unit_estimated_price: money(draft.price), brand_maker: draft.brandMaker, model_series: draft.modelSeries, purchase_source: draft.purchaseSource, purchase_year_approx: draft.purchaseYear, original_purchase_price: money(draft.originalPrice), notes: draft.notes }} context={{ itemId: item.id, currentName: draft.name, currentCategory: draft.category, currentDescription: draft.description }} onClose={() => setVoiceOpen(false)} onApply={applyVoice} />
  </View>;
}

const styles = StyleSheet.create({ form: { gap: 20 }, section: { gap: 13 }, sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: .8 }, field: { gap: 6 }, label: { fontSize: 12, fontFamily: "Inter_500Medium" }, input: { borderWidth: 1, borderRadius: 10, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 }, multiline: { minHeight: 84, textAlignVertical: "top" }, row: { flexDirection: "row", gap: 12 }, grow: { flex: 1 }, qty: { width: 120 }, voice: { flexDirection: "row", alignItems: "center", gap: 9, padding: 12, borderWidth: 1, borderRadius: 10 }, voiceText: { fontFamily: "Inter_600SemiBold" }, detailsHeader: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, padding: 13 }, icon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" }, detailsTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" }, detailsSub: { fontSize: 11, marginTop: 3 }, detailsBody: { gap: 13, borderWidth: 1, borderTopWidth: 0, padding: 14 }, chips: { gap: 8 }, chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 }, error: { fontSize: 13, fontFamily: "Inter_500Medium" }, save: { minHeight: 50, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }, saveText: { fontSize: 16, fontFamily: "Inter_600SemiBold" } });
