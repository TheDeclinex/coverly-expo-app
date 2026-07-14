import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import type { ReplacementPriceResult } from "@/lib/replacement-pricing";

interface ReplacementListingCardProps {
  result: ReplacementPriceResult;
  selecting: boolean;
  onOpen: () => void;
  onUse: () => void;
}

const MATCH_LABELS: Record<ReplacementPriceResult["matchType"], string> = {
  best_match: "Best match",
  close_match: "Close match",
  similar_item: "Similar item",
};

function formatPrice(result: ReplacementPriceResult): string {
  if (result.price != null) {
    return result.price.toLocaleString("en-NZ", {
      style: "currency",
      currency: "NZD",
      minimumFractionDigits: 2,
    });
  }
  return result.priceRaw || "Price unavailable";
}

export function ReplacementListingCard({
  result,
  selecting,
  onOpen,
  onUse,
}: ReplacementListingCardProps) {
  const colors = useColors();
  const canUse = result.price != null && result.price > 0;
  const canOpen = /^https?:\/\//i.test(result.link);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <View style={styles.topRow}>
        <View style={[styles.imageWrap, { backgroundColor: colors.muted }]}>
          {result.thumbnail ? (
            <Image
              source={{ uri: result.thumbnail }}
              style={styles.image}
              contentFit="contain"
              transition={150}
            />
          ) : (
            <Feather name="shopping-bag" size={28} color={colors.primary} />
          )}
        </View>

        <View style={styles.body}>
          <View style={[styles.matchBadge, { backgroundColor: colors.accent }]}>
            <Text style={[styles.matchText, { color: colors.accentForeground }]}>
              {MATCH_LABELS[result.matchType]}
            </Text>
          </View>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={3}>
            {result.title}
          </Text>
          <Text style={[styles.source, { color: colors.mutedForeground }]} numberOfLines={1}>
            {result.source}
          </Text>
          <Text style={[styles.price, { color: colors.foreground }]}>
            {formatPrice(result)}
          </Text>
        </View>
      </View>

      {result.snippet ? (
        <Text style={[styles.snippet, { color: colors.mutedForeground }]} numberOfLines={2}>
          {result.snippet}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          disabled={!canOpen}
          onPress={onOpen}
          style={({ pressed }) => [
            styles.secondaryButton,
            {
              borderColor: colors.border,
              opacity: !canOpen ? 0.45 : pressed ? 0.7 : 1,
            },
          ]}
        >
          <Feather name="external-link" size={15} color={colors.foreground} />
          <Text style={[styles.secondaryText, { color: colors.foreground }]}>Open listing</Text>
        </Pressable>

        <Pressable
          disabled={!canUse || selecting}
          onPress={onUse}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: colors.primary,
              opacity: !canUse || selecting ? 0.5 : pressed ? 0.8 : 1,
            },
          ]}
        >
          {selecting ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Feather name="check" size={15} color={colors.primaryForeground} />
          )}
          <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>
            {canUse ? "Use this listing" : "Price unavailable"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 14, gap: 12 },
  topRow: { flexDirection: "row", gap: 12 },
  imageWrap: {
    width: 92,
    height: 92,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
  body: { flex: 1, alignItems: "flex-start", gap: 4 },
  matchBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  matchText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  title: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  source: { fontSize: 12, fontFamily: "Inter_400Regular" },
  price: { fontSize: 17, fontFamily: "Inter_700Bold", marginTop: 2 },
  snippet: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  actions: { flexDirection: "row", gap: 8 },
  secondaryButton: {
    minHeight: 42,
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 10,
  },
  primaryButton: {
    minHeight: 42,
    flex: 1.35,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 10,
  },
  secondaryText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  primaryText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
