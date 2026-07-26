import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { useColors } from "@/hooks/useColors";
import {
  shouldCloseLegalViewerNavigation,
  type CoverlyLegalDocument,
} from "@/lib/legal-links";

interface LegalDocumentModalProps {
  document: CoverlyLegalDocument | null;
  onClose: () => void;
}

export function LegalDocumentModal({ document, onClose }: LegalDocumentModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const closeRequestedRef = React.useRef(false);

  React.useEffect(() => {
    if (document) closeRequestedRef.current = false;
  }, [document]);

  const close = React.useCallback(() => {
    if (closeRequestedRef.current) return;
    closeRequestedRef.current = true;
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={document !== null}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={close}
    >
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            {
              paddingTop: insets.top + 6,
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.headerSide} />
          <Text style={[styles.title, { color: colors.foreground }]}>
            {document?.title ?? ""}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Close ${document?.title ?? "legal document"}`}
            onPress={close}
            hitSlop={10}
            style={({ pressed }) => [
              styles.closeButton,
              {
                backgroundColor: colors.secondary,
                opacity: pressed ? 0.68 : 1,
              },
            ]}
          >
            <Feather name="x" size={20} color={colors.foreground} />
          </Pressable>
        </View>

        {document ? (
          <WebView
            key={document.url}
            source={{ uri: document.url }}
            startInLoadingState
            renderLoading={() => (
              <View style={[styles.loading, { backgroundColor: colors.background }]}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
                  Loading {document.title.toLowerCase()}…
                </Text>
              </View>
            )}
            renderError={() => (
              <View style={[styles.loading, { backgroundColor: colors.background }]}>
                <Feather name="alert-circle" size={24} color={colors.destructive} />
                <Text style={[styles.errorTitle, { color: colors.foreground }]}>
                  Could not load {document.title.toLowerCase()}
                </Text>
                <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
                  Check your connection and try again.
                </Text>
              </View>
            )}
            onShouldStartLoadWithRequest={(request) => {
              if (!shouldCloseLegalViewerNavigation(request.url, document.url)) return true;
              requestAnimationFrame(close);
              return false;
            }}
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    minHeight: 58,
    paddingHorizontal: 14,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
  },
  headerSide: {
    width: 40,
    height: 40,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 28,
  },
  loadingText: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  errorTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
});
