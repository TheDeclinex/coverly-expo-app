import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { ImageViewerModal } from "@/components/ImageViewerModal";
import { useColors } from "@/hooks/useColors";
import {
  createFeedbackScreenshotSignedUrl,
} from "@/lib/feedback-service";
import { serializeError } from "@/lib/feedback-model";

export function FeedbackScreenshotPreview({
  storedValue,
  ticketId,
}: {
  storedValue: string | null;
  ticketId: string;
}) {
  const colors = useColors();
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [imageFailed, setImageFailed] = React.useState(false);
  const screenshotQuery = useQuery({
    queryKey: ["feedback-screenshot", ticketId, storedValue],
    queryFn: () => createFeedbackScreenshotSignedUrl(storedValue!),
    enabled: Boolean(storedValue),
    staleTime: 4 * 60 * 1000,
    retry: 1,
  });

  React.useEffect(() => {
    setImageFailed(false);
  }, [screenshotQuery.data]);

  if (!storedValue) {
    return <Text style={[styles.helper, { color: colors.mutedForeground }]}>No screenshot attached.</Text>;
  }

  if (screenshotQuery.isLoading || screenshotQuery.isFetching) {
    return (
      <View style={[styles.state, { backgroundColor: colors.secondary }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>Loading screenshot…</Text>
      </View>
    );
  }

  if (screenshotQuery.isError || !screenshotQuery.data || imageFailed) {
    return (
      <View style={[styles.state, { backgroundColor: colors.secondary }]}>
        <Feather name="image" size={22} color={colors.mutedForeground} />
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>The screenshot could not be loaded.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry feedback screenshot"
          onPress={() => {
            setImageFailed(false);
            void screenshotQuery.refetch();
          }}
          style={[styles.retry, { borderColor: colors.border }]}
        >
          <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const launchViewer = () => {
    try {
      setViewerOpen(true);
    } catch (error) {
      if (__DEV__) {
        console.warn("[feedback] screenshot viewer launch failed", {
          ticketId,
          error: serializeError(error),
        });
      }
    }
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open feedback screenshot full screen"
        onPress={launchViewer}
        style={({ pressed }) => [
          styles.thumbnailButton,
          { borderColor: colors.border, opacity: pressed ? 0.78 : 1 },
        ]}
      >
        <Image
          source={{ uri: screenshotQuery.data }}
          style={styles.thumbnail}
          contentFit="contain"
          onError={(event) => {
            setImageFailed(true);
            if (__DEV__) {
              console.warn("[feedback] screenshot thumbnail failed", {
                ticketId,
                error: event.error,
              });
            }
          }}
        />
        <View style={[styles.openPill, { backgroundColor: colors.card }]}>
          <Feather name="maximize-2" size={14} color={colors.primary} />
          <Text style={[styles.openText, { color: colors.primary }]}>View full screen</Text>
        </View>
      </Pressable>
      <ImageViewerModal
        uris={[screenshotQuery.data]}
        visible={viewerOpen}
        title="Feedback screenshot"
        onClose={() => setViewerOpen(false)}
        onPermanentError={() => {
          if (__DEV__) {
            console.warn("[feedback] screenshot viewer image failed", { ticketId });
          }
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  helper: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular", textAlign: "center" },
  state: { minHeight: 132, borderRadius: 10, padding: 16, alignItems: "center", justifyContent: "center", gap: 9 },
  retry: { minHeight: 38, borderWidth: 1, borderRadius: 19, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  retryText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  thumbnailButton: { height: 210, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  thumbnail: { ...StyleSheet.absoluteFillObject },
  openPill: { position: "absolute", right: 10, bottom: 10, minHeight: 34, borderRadius: 17, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 6 },
  openText: { fontSize: 11, fontFamily: "Inter_700Bold" },
});
