import { Feather } from "@expo/vector-icons";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import {
  addItemEvidence,
  deleteItemEvidence,
  getEvidenceSignedUrl,
  loadItemEvidence,
} from "@/lib/evidence-service";
import {
  EVIDENCE_TYPE_LABEL,
  type ClaimEvidence,
  type EvidenceFileInput,
  type EvidenceType,
} from "@/types/evidence";

const EVIDENCE_TYPES = Object.keys(EVIDENCE_TYPE_LABEL) as EvidenceType[];

const TYPE_ICON: Record<EvidenceType, keyof typeof Feather.glyphMap> = {
  photo: "image",
  receipt: "file-text",
  warranty: "shield",
  manual: "book-open",
  valuation: "trending-up",
  other: "paperclip",
};

const TYPE_COLOR: Record<EvidenceType, string> = {
  photo: "#3B82F6",
  receipt: "#16A34A",
  warranty: "#8B5CF6",
  manual: "#CA8A04",
  valuation: "#EA580C",
  other: "#64748B",
};

export function ItemEvidenceSection({
  itemId,
  fileId,
  userId,
  userEmail,
  autoOpenAdd = false,
}: {
  itemId: string;
  fileId: string;
  userId: string;
  userEmail?: string | null;
  autoOpenAdd?: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [modalVisible, setModalVisible] = useState(false);
  const [evidenceType, setEvidenceType] = useState<EvidenceType>("receipt");
  const [selectedFile, setSelectedFile] = useState<EvidenceFileInput | null>(null);
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const didAutoOpenRef = React.useRef(false);

  React.useEffect(() => {
    if (!autoOpenAdd || didAutoOpenRef.current) return;
    didAutoOpenRef.current = true;
    setModalVisible(true);
  }, [autoOpenAdd]);

  const queryKey = ["item-evidence", itemId, userId];
  const {
    data: evidence = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () => loadItemEvidence(itemId),
    enabled: Boolean(itemId && userId),
  });

  const resetDraft = () => {
    setEvidenceType("receipt");
    setSelectedFile(null);
    setCaption("");
    setActionError(null);
  };

  const closeModal = () => {
    if (saving) return;
    setModalVisible(false);
    resetDraft();
  };

  const pickImage = async (camera: boolean) => {
    setActionError(null);
    if (Platform.OS !== "web") {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== "granted") {
        setActionError(`Allow ${camera ? "camera" : "photo library"} access to add evidence.`);
        return;
      }
    }

    const result = camera
      ? await ImagePicker.launchCameraAsync({ quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setSelectedFile({
      uri: asset.uri,
      filename: asset.fileName ?? `evidence-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? "image/jpeg",
      fileSize: asset.fileSize,
    });
  };

  const pickPdf = async () => {
    setActionError(null);
    try {
      const picked = await File.pickFileAsync(undefined, "application/pdf");
      const file = Array.isArray(picked) ? picked[0] : picked;
      if (!file) return;
      const uriFilename = file.uri.split("/").pop()?.split("?")[0];
      setSelectedFile({
        uri: file.uri,
        filename: uriFilename?.toLowerCase().endsWith(".pdf")
          ? decodeURIComponent(uriFilename)
          : `evidence-${Date.now()}.pdf`,
        mimeType: "application/pdf",
        fileSize: file.size,
      });
    } catch (pickError) {
      const message = pickError instanceof Error ? pickError.message : String(pickError);
      if (!/cancel/i.test(message)) setActionError(message);
    }
  };

  const saveEvidence = async () => {
    if (!selectedFile || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      await addItemEvidence({
        itemId,
        fileId,
        userId,
        userEmail,
        evidenceType,
        file: selectedFile,
        caption,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["room-evidence-counts"] }),
      ]);
      setModalVisible(false);
      resetDraft();
    } catch (saveError) {
      setActionError(saveError instanceof Error ? saveError.message : "Could not add evidence.");
    } finally {
      setSaving(false);
    }
  };

  const openEvidence = async (item: ClaimEvidence) => {
    setActionError(null);
    try {
      const signedUrl = await getEvidenceSignedUrl(item.file_url);
      await WebBrowser.openBrowserAsync(signedUrl);
    } catch (openError) {
      setActionError(openError instanceof Error ? openError.message : "Could not open evidence.");
    }
  };

  const confirmDelete = (item: ClaimEvidence) => {
    Alert.alert(
      "Delete evidence?",
      `Remove “${item.filename}” from this item?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setDeletingId(item.id);
            setActionError(null);
            void deleteItemEvidence(itemId, item)
              .then(() =>
                Promise.all([
                  queryClient.invalidateQueries({ queryKey }),
                  queryClient.invalidateQueries({ queryKey: ["room-evidence-counts"] }),
                ]),
              )
              .catch((deleteError) => {
                setActionError(deleteError instanceof Error ? deleteError.message : "Could not delete evidence.");
              })
              .finally(() => setDeletingId(null));
          },
        },
      ],
    );
  };

  return (
    <>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>EVIDENCE & DOCUMENTS</Text>
            <Text style={[styles.headerHint, { color: colors.mutedForeground }]}>Receipts, warranties, manuals and supporting photos</Text>
          </View>
          <Pressable
            onPress={() => setModalVisible(true)}
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: colors.secondary, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Feather name="plus" size={14} color={colors.primary} />
            <Text style={[styles.addButtonText, { color: colors.primary }]}>Add</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.stateRow}><ActivityIndicator size="small" color={colors.primary} /></View>
        ) : error ? (
          <Pressable onPress={() => void refetch()} style={styles.stateRow}>
            <Feather name="alert-circle" size={15} color="#B91C1C" />
            <Text style={styles.errorText}>Couldn’t load evidence. Tap to retry.</Text>
          </Pressable>
        ) : evidence.length === 0 ? (
          <View style={styles.emptyRow}>
            <Feather name="paperclip" size={17} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Add receipts, warranties, manuals or extra photos for this item.</Text>
          </View>
        ) : (
          <View>
            {evidence.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => void openEvidence(item)}
                style={({ pressed }) => [
                  styles.evidenceRow,
                  { borderTopColor: colors.border, opacity: pressed ? 0.72 : 1 },
                ]}
              >
                <View style={[styles.typeIcon, { backgroundColor: `${TYPE_COLOR[item.evidence_type]}18` }]}>
                  <Feather name={TYPE_ICON[item.evidence_type]} size={16} color={TYPE_COLOR[item.evidence_type]} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.filename, { color: colors.foreground }]} numberOfLines={1}>{item.filename}</Text>
                    <Text style={[styles.typeLabel, { color: TYPE_COLOR[item.evidence_type] }]}>{EVIDENCE_TYPE_LABEL[item.evidence_type]}</Text>
                  </View>
                  <Text style={[styles.dateText, { color: colors.mutedForeground }]}>
                    {new Date(item.document_date ?? item.upload_date).toLocaleDateString("en-NZ")}
                  </Text>
                  {item.caption ? <Text style={[styles.caption, { color: colors.mutedForeground }]} numberOfLines={2}>{item.caption}</Text> : null}
                </View>
                <Pressable
                  accessibilityLabel={`Delete ${item.filename}`}
                  onPress={(event) => {
                    event.stopPropagation();
                    confirmDelete(item);
                  }}
                  disabled={deletingId === item.id}
                  hitSlop={8}
                  style={{ padding: 5 }}
                >
                  {deletingId === item.id
                    ? <ActivityIndicator size="small" color={colors.mutedForeground} />
                    : <Feather name="trash-2" size={15} color={colors.mutedForeground} />}
                </Pressable>
              </Pressable>
            ))}
          </View>
        )}
        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      </View>

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={closeModal}>
        <Pressable style={styles.backdrop} onPress={closeModal}>
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                paddingBottom: insets.bottom + 16,
              },
            ]}
          >
            <View style={styles.handleWrap}><View style={[styles.handle, { backgroundColor: colors.border }]} /></View>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Add evidence</Text>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>TYPE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typePicker}>
              {EVIDENCE_TYPES.map((type) => (
                <Pressable
                  key={type}
                  onPress={() => setEvidenceType(type)}
                  style={[
                    styles.typeChip,
                    {
                      backgroundColor: evidenceType === type ? TYPE_COLOR[type] : colors.secondary,
                      borderColor: evidenceType === type ? TYPE_COLOR[type] : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.typeChipText, { color: evidenceType === type ? "#FFFFFF" : colors.foreground }]}>
                    {EVIDENCE_TYPE_LABEL[type]}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>FILE</Text>
            <View style={styles.sourceButtons}>
              <SourceButton icon="camera" label="Camera" onPress={() => void pickImage(true)} colors={colors} />
              <SourceButton icon="image" label="Library" onPress={() => void pickImage(false)} colors={colors} />
              <SourceButton icon="file-text" label="PDF" onPress={() => void pickPdf()} colors={colors} />
            </View>
            {selectedFile ? (
              <View style={[styles.selectedFile, { backgroundColor: colors.secondary }]}>
                <Feather name={selectedFile.mimeType === "application/pdf" ? "file-text" : "image"} size={16} color={colors.primary} />
                <Text style={[styles.selectedFileText, { color: colors.foreground }]} numberOfLines={1}>{selectedFile.filename}</Text>
                <Feather name="check" size={15} color={colors.primary} />
              </View>
            ) : null}

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>CAPTION (OPTIONAL)</Text>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder="Short description for an insurer"
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[styles.captionInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            />
            {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

            <View style={styles.sheetActions}>
              <Pressable onPress={closeModal} disabled={saving} style={[styles.cancelButton, { borderColor: colors.border }]}>
                <Text style={[styles.actionText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void saveEvidence()}
                disabled={!selectedFile || saving}
                style={[styles.saveButton, { backgroundColor: colors.primary, opacity: !selectedFile || saving ? 0.45 : 1 }]}
              >
                {saving ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="upload" size={15} color={colors.primaryForeground} />}
                <Text style={[styles.actionText, { color: colors.primaryForeground }]}>{saving ? "Adding…" : "Add evidence"}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function SourceButton({
  icon,
  label,
  onPress,
  colors,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.sourceButton, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <Feather name={icon} size={18} color={colors.primary} />
      <Text style={[styles.sourceButtonText, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { borderWidth: 1, padding: 16, gap: 12, marginTop: 4 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  headerHint: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 3 },
  addButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, minHeight: 34, borderRadius: 9 },
  addButtonText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  stateRow: { minHeight: 48, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 },
  emptyRow: { minHeight: 48, alignItems: "center", flexDirection: "row", gap: 8 },
  emptyText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  evidenceRow: { minHeight: 58, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  typeIcon: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  filename: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  typeLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  dateText: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  caption: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 3, lineHeight: 15 },
  errorText: { color: "#B91C1C", fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.42)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 18, gap: 10, maxHeight: "88%" },
  handleWrap: { alignItems: "center", paddingTop: 11, paddingBottom: 3 },
  handle: { width: 36, height: 4, borderRadius: 2 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 3 },
  fieldLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.7, marginTop: 4 },
  typePicker: { gap: 7, paddingRight: 10 },
  typeChip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 11, paddingVertical: 7 },
  typeChipText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  sourceButtons: { flexDirection: "row", gap: 8 },
  sourceButton: { flex: 1, borderWidth: 1, borderRadius: 9, minHeight: 54, alignItems: "center", justifyContent: "center", gap: 4 },
  sourceButtonText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  selectedFile: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 8, padding: 10 },
  selectedFileText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  captionInput: { minHeight: 68, maxHeight: 110, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 9, textAlignVertical: "top", fontSize: 13, fontFamily: "Inter_400Regular" },
  sheetActions: { flexDirection: "row", gap: 9, marginTop: 4 },
  cancelButton: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  saveButton: { flex: 1.5, minHeight: 44, borderRadius: 9, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  actionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
