import { Feather } from "@expo/vector-icons";
import {
  CameraView,
  type BarcodeScanningResult,
  useCameraPermissions,
} from "expo-camera";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import {
  classifyBarcodeFailure,
  isSupportedBarcodeValue,
  verifyBarcode,
  type BarcodeFailureKind,
  type BarcodeVerifySuccess,
} from "@/lib/barcode-verify";
import type { InventoryItem } from "@/types";

type ScanStage = "scanning" | "lookup" | "confirm" | BarcodeFailureKind | "saving" | "save-error";
type SuggestedField = "name" | "brand" | "model" | "description";

export interface BarcodeApplyValues {
  barcode: string;
  verified?: boolean;
  name?: string;
  brandMaker?: string;
  modelSeries?: string;
  description?: string;
}

interface BarcodeScanFlowProps {
  visible: boolean;
  item: InventoryItem;
  onClose: () => void;
  onApply: (values: BarcodeApplyValues) => Promise<void>;
}

function cleanSuggestion(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function BarcodeScanFlow({ visible, item, onClose, onApply }: BarcodeScanFlowProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const scanLockedRef = React.useRef(false);
  const visibleRef = React.useRef(visible);
  const appStateRef = React.useRef<AppStateStatus>(AppState.currentState);
  const [stage, setStage] = React.useState<ScanStage>("scanning");
  const [detectedBarcode, setDetectedBarcode] = React.useState("");
  const [result, setResult] = React.useState<BarcodeVerifySuccess | null>(null);
  const [message, setMessage] = React.useState("");
  const [selected, setSelected] = React.useState<Record<SuggestedField, boolean>>({
    name: false,
    brand: false,
    model: false,
    description: false,
  });

  const suggestions = React.useMemo(() => ({
    name: cleanSuggestion(result?.productName ?? result?.matchedProduct?.title),
    brand: cleanSuggestion(result?.brand ?? result?.matchedProduct?.brand),
    model: cleanSuggestion(result?.matchedProduct?.model),
    description: cleanSuggestion(result?.matchedProduct?.description),
  }), [result]);

  const resetScan = React.useCallback(() => {
    scanLockedRef.current = false;
    setStage("scanning");
    setDetectedBarcode("");
    setResult(null);
    setMessage("");
    setSelected({ name: false, brand: false, model: false, description: false });
  }, []);

  React.useEffect(() => {
    visibleRef.current = visible;
    if (visible) resetScan();
  }, [resetScan, visible]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (visibleRef.current && nextState === "active" && previousState !== "active") {
        void getPermission();
      }
    });
    return () => subscription.remove();
  }, [getPermission]);

  const handleDetected = React.useCallback(async ({ data, type }: BarcodeScanningResult) => {
    const barcode = data.trim();
    if (!barcode || scanLockedRef.current) return;
    if (__DEV__) console.info("[barcode] detected", {
      rawScannedBarcode: data,
      detectedBarcodeFormat: type,
    });

    // Close the latch synchronously before React state changes so a burst of
    // native scan callbacks can never trigger duplicate Edge Function calls.
    scanLockedRef.current = true;
    setDetectedBarcode(barcode);
    if (!isSupportedBarcodeValue(barcode)) {
      setMessage("The scanned value is not a supported EAN or UPC barcode. Try centring the full barcode inside the frame.");
      setStage("invalid");
      return;
    }
    setStage("lookup");
    setMessage("");

    try {
      const response = await verifyBarcode({
        barcode,
        barcodeFormat: type,
        itemName: item.name,
        category: item.category ?? undefined,
        itemId: item.id,
      });

      if (!response.success) {
        const failureKind = classifyBarcodeFailure(response.errorCode, response.error);
        setMessage(failureKind === "not-found"
          ? "The barcode was captured, but matching product details are unavailable. You can keep the barcode on this item or scan another."
          : barcodeFailureCopy(failureKind));
        setStage(failureKind);
        return;
      }

      setResult(response);
      const name = cleanSuggestion(response.productName ?? response.matchedProduct?.title);
      const brand = cleanSuggestion(response.brand ?? response.matchedProduct?.brand);
      const model = cleanSuggestion(response.matchedProduct?.model);
      const description = cleanSuggestion(response.matchedProduct?.description);
      setSelected({
        name: Boolean(name && name !== item.name),
        brand: Boolean(brand && brand !== item.brand_maker),
        model: Boolean(model && model !== item.model_series),
        // Existing descriptions are never selected for overwrite by default.
        description: Boolean(description && !item.description?.trim()),
      });
      setStage("confirm");
    } catch (lookupError) {
      const detail = lookupError instanceof Error ? lookupError.message : "Barcode lookup failed.";
      const failureKind = classifyBarcodeFailure(null, detail);
      setMessage(barcodeFailureCopy(failureKind));
      setStage(failureKind);
    }
  }, [item]);

  const toggleField = (field: SuggestedField) => {
    setSelected((current) => ({ ...current, [field]: !current[field] }));
  };

  const applyMatch = async () => {
    if (!result || stage === "saving") return;
    setStage("saving");
    setMessage("");
    try {
      await onApply({
        barcode: result.barcode?.trim() || detectedBarcode,
        ...(selected.name && suggestions.name ? { name: suggestions.name } : {}),
        ...(selected.brand && suggestions.brand ? { brandMaker: suggestions.brand } : {}),
        ...(selected.model && suggestions.model ? { modelSeries: suggestions.model } : {}),
        ...(selected.description && suggestions.description
          ? { description: suggestions.description }
          : {}),
      });
      onClose();
    } catch (saveError) {
      if (__DEV__) console.warn("[barcode] matched details save failed", {
        message: saveError instanceof Error ? saveError.message : "unknown",
      });
      setMessage("The matched barcode details could not be saved. Your existing item details were not changed.");
      setStage("save-error");
    }
  };

  const keepBarcode = async () => {
    if (!detectedBarcode || stage === "saving") return;
    setStage("saving");
    try {
      await onApply({ barcode: detectedBarcode, verified: false });
      onClose();
    } catch {
      setMessage("The barcode could not be saved. Your existing item was not changed.");
      setStage("save-error");
    }
  };

  const comparisonRow = (
    field: SuggestedField,
    label: string,
    currentValue: string | null | undefined,
    suggestedValue: string | undefined,
  ) => {
    if (!suggestedValue) return null;
    return (
      <Pressable
        onPress={() => toggleField(field)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected[field] }}
        style={[styles.comparisonRow, { borderColor: colors.border }]}
      >
        <Feather
          name={selected[field] ? "check-square" : "square"}
          size={18}
          color={selected[field] ? colors.primary : colors.mutedForeground}
        />
        <View style={styles.comparisonCopy}>
          <Text style={[styles.comparisonLabel, { color: colors.mutedForeground }]}>{label}</Text>
          <Text numberOfLines={2} style={[styles.currentValue, { color: colors.mutedForeground }]}>
            Current: {currentValue?.trim() || "Not set"}
          </Text>
          <Text numberOfLines={3} style={[styles.suggestedValue, { color: colors.foreground }]}>
            Suggested: {suggestedValue}
          </Text>
        </View>
      </Pressable>
    );
  };

  const renderCamera = () => {
    if (!permission) {
      return <ActivityIndicator size="large" color="#ffffff" />;
    }
    if (!permission.granted) {
      return (
        <View style={styles.permissionCard}>
          <Feather name="camera" size={30} color={colors.primary} />
          <Text style={[styles.permissionTitle, { color: colors.foreground }]}>Camera access needed</Text>
          <Text style={[styles.permissionText, { color: colors.mutedForeground }]}>
            Allow camera access to scan the product barcode.
          </Text>
          <Pressable
            onPress={() => {
              if (permission.canAskAgain === false) {
                void Linking.openSettings().catch(() => {
                  Alert.alert("Could not open Settings", "Open your device settings and allow camera access for Coverly.");
                });
                return;
              }
              void requestPermission();
            }}
            style={[styles.primaryButton, styles.permissionButton, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
              {permission.canAskAgain === false ? "Open Settings" : "Allow camera"}
            </Text>
          </Pressable>
        </View>
      );
    }
    return (
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
        onBarcodeScanned={stage === "scanning" ? handleDetected : undefined}
      />
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: "#071b1d" }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close barcode scanner" style={styles.closeButton}>
            <Feather name="x" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Scan barcode</Text>
          <View style={styles.closeButton} />
        </View>

        {stage === "scanning" ? (
          <View style={styles.cameraArea}>
            {renderCamera()}
            {permission?.granted ? (
              <View pointerEvents="none" style={styles.scanGuide}>
                <View style={styles.scanFrame} />
                <Text style={styles.scanHint}>Centre an EAN or UPC barcode inside the frame</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={[styles.panel, { backgroundColor: colors.background, paddingBottom: insets.bottom + 20 }]}>
            {stage === "lookup" || stage === "saving" ? (
              <View style={styles.centerState}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.stateTitle, { color: colors.foreground }]}>
                  {stage === "lookup" ? "Looking up product…" : "Applying product details…"}
                </Text>
                <Text style={[styles.barcodeText, { color: colors.mutedForeground }]}>{detectedBarcode}</Text>
              </View>
            ) : null}

            {stage === "confirm" && result ? (
              <>
                <View style={styles.confirmHeader}>
                  <Feather name="check-circle" size={24} color={colors.primary} />
                  <View style={styles.confirmHeaderCopy}>
                    <Text style={[styles.stateTitle, { color: colors.foreground }]}>Product match found</Text>
                    <Text style={[styles.barcodeText, { color: colors.mutedForeground }]}>
                      {result.barcode || detectedBarcode}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.selectionHint, { color: colors.mutedForeground }]}>
                  Select the suggested details you want to apply. Nothing changes until you confirm.
                </Text>
                <View style={[styles.comparisonRow, { borderColor: colors.border }]}>
                  <Feather name="lock" size={18} color={colors.primary} />
                  <View style={styles.comparisonCopy}>
                    <Text style={[styles.comparisonLabel, { color: colors.mutedForeground }]}>Barcode</Text>
                    <Text style={[styles.currentValue, { color: colors.mutedForeground }]}>
                      Current: {item.barcode?.trim() || "Not set"}
                    </Text>
                    <Text style={[styles.suggestedValue, { color: colors.foreground }]}>
                      Scanned: {result.barcode || detectedBarcode}
                    </Text>
                  </View>
                </View>
                {comparisonRow("name", "Item name", item.name, suggestions.name)}
                {comparisonRow("brand", "Brand / Maker", item.brand_maker, suggestions.brand)}
                {comparisonRow("model", "Model / Series", item.model_series, suggestions.model)}
                {comparisonRow("description", "Description", item.description, suggestions.description)}
                <View style={styles.actions}>
                  <Pressable onPress={resetScan} style={[styles.secondaryButton, { borderColor: colors.border }]}>
                    <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Re-scan</Text>
                  </Pressable>
                  <Pressable onPress={() => void applyMatch()} style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Apply to item</Text>
                  </Pressable>
                </View>
                <Pressable onPress={onClose} style={styles.cancelButton}>
                  <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
                </Pressable>
              </>
            ) : null}

            {stage === "not-found" || stage === "invalid" || stage === "network" ||
            stage === "authentication" || stage === "rate-limit" ||
            stage === "malformed-response" || stage === "parse" || stage === "service" ? (
              <View style={styles.centerState}>
                <Feather name={stage === "not-found" ? "search" : stage === "network" ? "wifi-off" : "alert-circle"} size={30} color={colors.primary} />
                <Text style={[styles.stateTitle, { color: colors.foreground }]}>
                  {barcodeFailureTitle(stage)}
                </Text>
                <Text style={[styles.stateMessage, { color: colors.mutedForeground }]}>{message}</Text>
                <Text style={[styles.barcodeText, { color: colors.mutedForeground }]}>{detectedBarcode}</Text>
                {stage === "not-found" ? (
                  <View style={styles.fallbackActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Keep captured barcode"
                      onPress={() => void keepBarcode()}
                      style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                    >
                      <Feather name="bookmark" size={16} color={colors.primaryForeground} />
                      <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Keep barcode</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Scan another barcode"
                      onPress={resetScan}
                      style={[styles.secondaryButton, { borderColor: colors.border }]}
                    >
                      <Feather name="refresh-cw" size={16} color={colors.primary} />
                      <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>Scan another</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Cancel barcode changes"
                      onPress={onClose}
                      style={styles.cancelButton}
                    >
                      <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.actions}>
                    <Pressable onPress={onClose} style={[styles.secondaryButton, { borderColor: colors.border }]}>
                      <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Close</Text>
                    </Pressable>
                    <Pressable onPress={resetScan} style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
                      <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Retry barcode</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ) : null}

            {stage === "save-error" ? (
              <View style={styles.centerState}>
                <Feather name="save" size={30} color={colors.destructive} />
                <Text style={[styles.stateTitle, { color: colors.foreground }]}>
                  Couldn’t save barcode details
                </Text>
                <Text style={[styles.stateMessage, { color: colors.mutedForeground }]}>
                  {message || "The item could not be updated. Your scanned barcode and product match are still available."}
                </Text>
                <Text style={[styles.barcodeText, { color: colors.mutedForeground }]}>{detectedBarcode}</Text>
                {result ? (
                  <Text style={[styles.suggestedValue, { color: colors.foreground }]} numberOfLines={2}>
                    {result.productName ?? result.matchedProduct?.title ?? "Matched product"}
                  </Text>
                ) : null}
                <View style={styles.fallbackActions}>
                  {result ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Retry saving barcode match"
                      onPress={() => void applyMatch()}
                      style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                    >
                      <Feather name="refresh-cw" size={16} color={colors.primaryForeground} />
                      <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Retry</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Retry keeping captured barcode"
                      onPress={() => void keepBarcode()}
                      style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                    >
                      <Feather name="refresh-cw" size={16} color={colors.primaryForeground} />
                      <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Retry</Text>
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel barcode changes"
                    onPress={onClose}
                    style={[styles.secondaryButton, { borderColor: colors.border }]}
                  >
                    <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </Modal>
  );
}

function barcodeFailureTitle(kind: BarcodeFailureKind): string {
  if (kind === "not-found") return "Product not found";
  if (kind === "invalid") return "Barcode not readable";
  if (kind === "rate-limit") return "Barcode lookup limit reached";
  if (kind === "network") return "You’re offline";
  return "Barcode service unavailable";
}

function barcodeFailureCopy(kind: BarcodeFailureKind): string {
  if (kind === "invalid") return "We couldn’t read a valid EAN or UPC barcode. Try again with the full barcode in view.";
  if (kind === "network") return "Check your connection and try the barcode lookup again.";
  if (kind === "not-found") return "This barcode is not in the product database.";
  if (kind === "authentication") return "The barcode provider could not authenticate this request. Please try again later.";
  if (kind === "rate-limit") return "The barcode provider is temporarily limiting lookups. Please wait and try again.";
  if (kind === "malformed-response") return "The barcode provider returned an invalid response. Please try again shortly.";
  if (kind === "parse") return "Coverly could not read the product details returned for this barcode.";
  return "The barcode lookup service couldn’t complete this request. Please try again shortly.";
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { height: 64, paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  closeButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#ffffff", fontSize: 17, fontWeight: "700", paddingBottom: 7 },
  cameraArea: { flex: 1, alignItems: "center", justifyContent: "center" },
  scanGuide: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 18 },
  scanFrame: { width: "82%", maxWidth: 420, height: 180, borderWidth: 2, borderColor: "#ffffff", borderRadius: 18, backgroundColor: "transparent" },
  scanHint: { color: "#ffffff", fontSize: 13, fontWeight: "600", textAlign: "center", paddingHorizontal: 24, textShadowColor: "#000000", textShadowRadius: 5 },
  permissionCard: { width: "84%", padding: 22, borderRadius: 18, backgroundColor: "#ffffff", alignItems: "center", gap: 10 },
  permissionButton: { flex: 0, width: "100%" },
  permissionTitle: { fontSize: 17, fontWeight: "700" },
  permissionText: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  panel: { flex: 1, padding: 20, gap: 12 },
  centerState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  stateTitle: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  stateMessage: { fontSize: 14, lineHeight: 20, textAlign: "center", maxWidth: 420 },
  barcodeText: { fontSize: 12, fontFamily: "monospace" },
  confirmHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 2 },
  confirmHeaderCopy: { flex: 1, gap: 2 },
  selectionHint: { fontSize: 13, lineHeight: 18, marginBottom: 2 },
  comparisonRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  comparisonCopy: { flex: 1, gap: 3 },
  comparisonLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  currentValue: { fontSize: 12 },
  suggestedValue: { fontSize: 13, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 10, marginTop: 8, width: "100%" },
  fallbackActions: { gap: 9, marginTop: 8, width: "100%" },
  primaryButton: { minHeight: 46, flex: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, flexDirection: "row", gap: 8 },
  primaryButtonText: { fontSize: 14, fontWeight: "700" },
  secondaryButton: { minHeight: 46, flex: 1, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, flexDirection: "row", gap: 8 },
  secondaryButtonText: { fontSize: 14, fontWeight: "600" },
  cancelButton: { alignSelf: "center", padding: 10 },
  cancelText: { fontSize: 13, fontWeight: "600" },
});
