import { Feather } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorState } from "@/components/ErrorState";
import { ContextBackButton } from "@/components/ContextBackButton";
import { ExpandableImage } from "@/components/ExpandableImage";
import { ItemEvidenceSection } from "@/components/ItemEvidenceSection";
import { ItemMaintenanceForm, type ItemMaintenanceFormHandle, type ItemMaintenanceSaveState } from "@/components/ItemMaintenanceForm";
import { LoadingState } from "@/components/LoadingState";
import {
  BarcodeScanFlow,
  type BarcodeApplyValues,
} from "@/components/BarcodeScanFlow";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSignedImageRecovery, useSignedUrls } from "@/hooks/useSignedUrls";
import { itemWithCommittedPin, replaceItemWithCommittedPin } from "@/lib/item-pin-state";
import { supabase } from "@/lib/supabase";
import type { InventoryItem, InventoryRoom } from "@/types";

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
  // Fall back to a friendly label when a value exists but the source is
  // unrecognised — never surface the raw internal valuation_basis string.
  return item.estimated_price != null || item.unit_estimated_price != null
    ? "Estimated"
    : null;
}

function isWebUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

export default function ItemDetailScreen() {
  const { id, name, evidence, roomId, roomName, fileId, fileName, origin } = useLocalSearchParams<{
    id: string;
    name: string;
    evidence?: string;
    roomId?: string;
    roomName?: string;
    fileId?: string;
    fileName?: string;
    origin?: string;
  }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [barcodeScanOpen, setBarcodeScanOpen] = React.useState(false);
  const [deletingItem, setDeletingItem] = React.useState(false);
  const [maintenanceDirty, setMaintenanceDirty] = React.useState(false);
  const [maintenanceSaveState, setMaintenanceSaveState] = React.useState<ItemMaintenanceSaveState>("idle");
  const maintenanceFormRef = React.useRef<ItemMaintenanceFormHandle>(null);

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

  const { data: rooms } = useQuery({
    queryKey: ["rooms", item?.file_id, session?.user.id],
    queryFn: async () => {
      const { data, error: roomsError } = await supabase
        .from("inventory_rooms")
        .select("id, name, file_id")
        .eq("file_id", item!.file_id)
        .is("archived_at", null)
        .order("sort_order", { ascending: true });
      if (roomsError) throw roomsError;
      return (data ?? []) as Pick<InventoryRoom, "id" | "name" | "file_id">[];
    },
    enabled: !!session && !!item?.file_id,
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
  const recoverItemImageUrl = useSignedImageRecovery(rawPhotoUris);
  const allPhotoUris = rawPhotoUris.map((u) => signedUriMap.get(u) ?? null).filter((u): u is string => u !== null);
  const primaryUri = allPhotoUris[0] ?? null;

  const handleReplacementPricing = () => {
    router.push({
      pathname: "/(tabs)/replacement-pricing/[id]",
      params: {
        id,
        origin: "item",
        itemName: item?.name ?? name,
        roomId: roomId ?? item?.room_id ?? "",
        roomName: roomName ?? item?.room ?? "Room",
        fileId: fileId ?? item?.file_id ?? "",
        fileName: fileName ?? "Property",
      },
    } as Href);
  };


  const navigateToItemParent = React.useCallback(() => {
    const targetRoomId = roomId ?? item?.room_id ?? "";
    const targetFileId = fileId ?? item?.file_id ?? "";

    if (targetRoomId) {
      if ((origin === "room" || origin === "attention") && router.canGoBack()) {
        router.back();
        return;
      }
      router.replace({
        pathname: "/(tabs)/room/[id]",
        params: {
          id: targetRoomId,
          name: roomName ?? item?.room ?? "Room",
          fileId: targetFileId,
          fileName: fileName ?? "Property",
        },
      } as Href);
      return;
    }

    if (targetFileId) {
      router.replace({
        pathname: "/(tabs)/property/[id]",
        params: { id: targetFileId, name: fileName ?? "Property" },
      } as Href);
      return;
    }

    router.back();
  }, [fileId, fileName, item?.file_id, item?.room, item?.room_id, origin, roomId, roomName]);

  const handleItemBack = React.useCallback(() => {
    if (!maintenanceDirty) {
      navigateToItemParent();
      return;
    }
    Alert.alert("Discard unsaved changes?", "Your item changes have not been saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: navigateToItemParent },
    ]);
  }, [maintenanceDirty, navigateToItemParent]);

  React.useEffect(() => {
    if (!maintenanceDirty) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      handleItemBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleItemBack, maintenanceDirty]);

  const invalidateItemCollections = React.useCallback(async (target: InventoryItem) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["items", target.room_id] }),
      queryClient.invalidateQueries({ queryKey: ["all-items"] }),
      queryClient.invalidateQueries({ queryKey: ["property-items", target.file_id] }),
      queryClient.invalidateQueries({ queryKey: ["room", target.room_id] }),
      queryClient.invalidateQueries({ queryKey: ["rooms", target.file_id] }),
      queryClient.invalidateQueries({ queryKey: ["property", target.file_id] }),
    ]);
  }, [queryClient]);

  const deleteItem = React.useCallback(async () => {
    if (!item || deletingItem) return;
    setDeletingItem(true);
    try {
      const { error: deleteError } = await supabase
        .from("inventory_items")
        .delete()
        .eq("id", item.id);
      if (deleteError) throw deleteError;

      queryClient.removeQueries({ queryKey: ["item", item.id] });
      await invalidateItemCollections(item);
      showToast("Item deleted");
      navigateToItemParent();
    } catch (deleteFailure) {
      Alert.alert(
        "Couldn't delete item",
        deleteFailure instanceof Error ? deleteFailure.message : "Please try again.",
      );
    } finally {
      setDeletingItem(false);
    }
  }, [deletingItem, invalidateItemCollections, item, navigateToItemParent, queryClient, showToast]);

  const handleDeleteItem = React.useCallback(() => {
    if (!item || deletingItem) return;
    Alert.alert(
      "Delete item?",
      `This will remove ${item.name} from your inventory. Evidence files and storage cleanup are not changed by this action.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void deleteItem() },
      ],
    );
  }, [deleteItem, deletingItem, item]);

  const handleApplyBarcode = async (values: BarcodeApplyValues) => {
    if (!item) throw new Error("Item not loaded.");

    const updates: Partial<InventoryItem> = {
      barcode: values.barcode,
      barcode_verified: values.verified ?? true,
      ...(values.name ? { name: values.name } : {}),
      ...(values.brandMaker ? { brand_maker: values.brandMaker } : {}),
      ...(values.modelSeries ? { model_series: values.modelSeries } : {}),
      ...(values.description ? { description: values.description } : {}),
    };

    const { data, error: updateError } = await supabase
      .from("inventory_items")
      .update(updates)
      .eq("id", item.id)
      .select("*")
      .single();
    if (updateError) throw updateError;

    queryClient.setQueryData(["item", id, session?.user.id], data as InventoryItem);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["items", item.room_id] }),
      queryClient.invalidateQueries({ queryKey: ["all-items"] }),
      queryClient.invalidateQueries({ queryKey: ["property-items", item.file_id] }),
    ]);
    showToast("Barcode details applied");
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
      const committedItem = itemWithCommittedPin(item, { x, y });
      queryClient.setQueryData(["item", id, session?.user.id], committedItem);
      queryClient.setQueriesData<InventoryItem[]>(
        { queryKey: ["items", item.room_id] },
        (current) => replaceItemWithCommittedPin(current, item.id, { x, y }),
      );
      queryClient.setQueryData<InventoryItem[]>(
        ["all-items", "home-valuation", session?.user.id],
        (current) => replaceItemWithCommittedPin(current, item.id, { x, y }),
      );
      queryClient.setQueryData<InventoryItem[]>(
        ["property-items", item.file_id, session?.user.id],
        (current) => replaceItemWithCommittedPin(current, item.id, { x, y }),
      );
    },
    [item, id, session?.user.id, queryClient],
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: item?.name ?? name ?? "Item Detail",
          headerTitleAlign: "center",
          headerBackVisible: false,
          gestureEnabled: !maintenanceDirty,
          headerLeft: () => (
            <ContextBackButton
              label={roomName ?? item?.room ?? "Room"}
              onPress={handleItemBack}
            />
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
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.stickySaveBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={maintenanceSaveState === "dirty" ? "Save item changes" : maintenanceSaveState === "saved" ? "Item changes saved" : "No item changes to save"}
            disabled={maintenanceSaveState !== "dirty"}
            onPress={() => maintenanceFormRef.current?.save()}
            style={[
              styles.stickySaveButton,
              {
                backgroundColor: maintenanceSaveState === "dirty" || maintenanceSaveState === "saving" ? colors.primary : colors.secondary,
                borderColor: maintenanceSaveState === "dirty" || maintenanceSaveState === "saving" ? colors.primary : colors.border,
              },
            ]}
          >
            {maintenanceSaveState === "saving" ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Feather name={maintenanceSaveState === "saved" ? "check-circle" : "save"} size={16} color={maintenanceSaveState === "dirty" ? colors.primaryForeground : colors.mutedForeground} />
            )}
            <Text style={[styles.stickySaveText, { color: maintenanceSaveState === "dirty" || maintenanceSaveState === "saving" ? colors.primaryForeground : maintenanceSaveState === "saved" ? colors.primary : colors.mutedForeground }]}>
              {maintenanceSaveState === "saving" ? "Saving…" : maintenanceSaveState === "saved" ? "Saved" : maintenanceSaveState === "dirty" ? "Save Changes" : "No unsaved changes"}
            </Text>
          </Pressable>
        </View>
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
            pinPhotoIndex={0}
            viewerTitle={item.name}
            pin={itemPin}
            pinAwareCover
            onReposition={itemPin ? handleRepositionPin : undefined}
            onPermanentError={() => recoverItemImageUrl(rawPrimaryUri)}
          />
          <View style={styles.content}>
            <ItemMaintenanceForm
              ref={maintenanceFormRef}
              item={item}
              rooms={rooms ?? []}
              valueSource={valuationSourceLabel(item)}
              onOpenValueSource={item.price_source_type === "web_listing" && isWebUrl(item.web_listing_url) ? handleOpenReplacementListing : undefined}
              onReviewReplacementPrice={handleReplacementPricing}
              barcodeAction={(
                <View style={styles.barcodeGroup}>
                  {item.barcode_verified ? (
                    <View style={[styles.barcodeStatus, { backgroundColor: colors.accent }]}>
                      <Feather name="check-circle" size={14} color={colors.primary} />
                      <View style={styles.barcodeStatusCopy}>
                        <Text style={[styles.barcodeStatusTitle, { color: colors.foreground }]}>Barcode verified</Text>
                        {item.barcode ? <Text style={[styles.barcodeStatusValue, { color: colors.mutedForeground }]}>{item.barcode}</Text> : null}
                      </View>
                    </View>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={item.barcode || item.barcode_verified ? "Update barcode" : "Scan barcode"}
                    onPress={() => setBarcodeScanOpen(true)}
                    style={({ pressed }) => [styles.barcodeAction, { borderColor: colors.primary, backgroundColor: colors.background, opacity: pressed ? 0.75 : 1 }]}
                  >
                    <Feather name="camera" size={15} color={colors.primary} />
                    <Text style={[styles.barcodeActionText, { color: colors.primary }]}>{item.barcode || item.barcode_verified ? "Update barcode" : "Scan barcode"}</Text>
                  </Pressable>
                </View>
              )}
              onDirtyChange={setMaintenanceDirty}
              onSaveStateChange={setMaintenanceSaveState}
            />

            {session?.user.id ? (
              <ItemEvidenceSection
                itemId={item.id}
                fileId={item.file_id}
                userId={session.user.id}
                userEmail={session.user.email}
                autoOpenAdd={evidence === "add"}
              />
            ) : null}

            <Section title="DELETE ITEM" colors={colors}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete item"
                onPress={handleDeleteItem}
                disabled={deletingItem}
                style={({ pressed }) => [
                  styles.destructiveAction,
                  { borderTopColor: colors.border, opacity: deletingItem || pressed ? 0.65 : 1 },
                ]}
              >
                {deletingItem ? <ActivityIndicator size="small" color="#B91C1C" /> : <Feather name="trash-2" size={15} color="#B91C1C" />}
                <View style={styles.nextActionCopy}>
                  <Text style={styles.destructiveTitle}>Delete item</Text>
                  <Text style={[styles.advancedEditHint, { color: colors.mutedForeground }]}>Remove this item from the inventory</Text>
                </View>
              </Pressable>
            </Section>
          </View>
        </ScrollView>
        </KeyboardAvoidingView>
      ) : null}
      {item ? (
        <BarcodeScanFlow
          visible={barcodeScanOpen}
          item={item}
          onClose={() => setBarcodeScanOpen(false)}
          onApply={handleApplyBarcode}
          onTakePhoto={() => {
            setBarcodeScanOpen(false);
            router.push({
              pathname: "/(tabs)/scan",
              params: {
                roomId: item.room_id ?? "",
                roomName: params.roomName ?? "",
                fileId: item.file_id,
                fileName: params.fileName ?? "",
              },
            } as Href);
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1 },
  stickySaveBar: {
    paddingHorizontal: 16,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 2,
  },
  stickySaveButton: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  stickySaveText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  heroImage: { width: "100%", height: 280 },
  content: { padding: 16, gap: 12 },
  barcodeGroup: { gap: 9, paddingTop: 2 },
  barcodeStatus: { flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9 },
  barcodeStatusCopy: { flex: 1, gap: 1 },
  barcodeStatusTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  barcodeStatusValue: { fontSize: 11, fontFamily: "monospace" },
  barcodeAction: { minHeight: 42, borderWidth: 1, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  barcodeActionText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  nextActionCopy: { flex: 1, gap: 2 },
  advancedEditHint: { fontSize: 11, fontFamily: "Inter_400Regular" },
  destructiveAction: {
    minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
    paddingTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  destructiveTitle: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#B91C1C" },
  section: { borderWidth: 1, padding: 14, gap: 0, marginTop: 4 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, marginBottom: 10 },
});
