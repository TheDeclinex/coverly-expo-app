import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line, Path, Polyline } from "react-native-svg";

import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  buildSparklinePoints,
  calcPropertyStats,
  type RoomStat,
} from "@/lib/dashboard-stats";
import { formatCurrency, getItemTotalValue } from "@/lib/inventory-mappers";
import { uploadCoverPhoto } from "@/lib/photo-upload";
import { supabase } from "@/lib/supabase";
import type { InventoryFile, InventoryItem, InventoryRoom } from "@/types";

const BRAND_TEAL = "#1D9E75";
const BRAND_AMBER = "#D97706";
const BRAND_DANGER = "#B91C1C";
const BRAND_BORDER = "#DDE7E3";
const BRAND_DARK = "#0B6F66";
const BRAND_DARK_DEEP = "#0A5C55";

function coverageColor(percent: number): string {
  if (percent >= 90) return BRAND_DANGER;
  if (percent >= 70) return BRAND_AMBER;
  return BRAND_TEAL;
}

const ROOM_ICONS: Record<string, string> = {
  kitchen: "coffee",
  bedroom: "moon",
  bathroom: "droplet",
  living_room: "tv",
  lounge: "tv",
  dining: "scissors",
  office: "monitor",
  garage: "truck",
  garden: "sun",
  utility: "tool",
  hallway: "navigation",
  loft: "archive",
};

function roomIcon(roomType: string | null): string {
  if (!roomType) return "square";
  const key = roomType.toLowerCase().replace(/\s+/g, "_");
  return ROOM_ICONS[key] ?? "square";
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function SparkLine({
  points,
  width,
  height = 36,
  light = false,
}: {
  points: { x: number; y: number }[];
  width: number;
  height?: number;
  /** Render white strokes for use on teal/dark card backgrounds */
  light?: boolean;
}) {
  if (width <= 0) return null;
  const pad = 6;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const stroke = light ? "rgba(255,255,255,0.9)" : BRAND_TEAL;
  const dashStroke = light ? "rgba(255,255,255,0.3)" : BRAND_BORDER;

  if (points.length < 2) {
    return (
      <Svg width={width} height={height}>
        <Line
          x1={pad}
          y1={height / 2}
          x2={width - pad}
          y2={height / 2}
          stroke={dashStroke}
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
      </Svg>
    );
  }

  const pts = points
    .map(
      (p) =>
        `${(pad + p.x * w).toFixed(1)},${(pad + (1 - p.y) * h).toFixed(1)}`
    )
    .join(" ");

  return (
    <Svg width={width} height={height}>
      <Polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ─── Compact summary card ─────────────────────────────────────────────────────

function CompactSummary({
  stats,
  colors,
  onEditCover,
}: {
  stats: ReturnType<typeof calcPropertyStats>;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onEditCover: () => void;
}) {
  const coverColor =
    stats.coveragePercent != null
      ? coverageColor(stats.coveragePercent)
      : colors.mutedForeground;

  return (
    <View
      style={[
        styles.summaryCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <View style={styles.summaryRow}>
        <View style={{ flex: 1.4 }}>
          <Text
            style={[styles.summaryBigValue, { color: colors.foreground }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {formatCurrency(stats.totalValue || null)}
          </Text>
          <Text
            style={[styles.summarySmallLabel, { color: colors.mutedForeground }]}
          >
            Inventory value
          </Text>
        </View>

        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />

        <View style={styles.summaryMetricCell}>
          <Text style={[styles.summaryMetricValue, { color: colors.foreground }]}>
            {stats.itemCount}
          </Text>
          <Text style={[styles.summarySmallLabel, { color: colors.mutedForeground }]}>
            Items
          </Text>
        </View>

        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />

        <View style={styles.summaryMetricCell}>
          <Text style={[styles.summaryMetricValue, { color: colors.foreground }]}>
            {stats.roomCount}
          </Text>
          <Text style={[styles.summarySmallLabel, { color: colors.mutedForeground }]}>
            Rooms
          </Text>
        </View>

        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />

        <Pressable
          onPress={onEditCover}
          style={styles.summaryMetricCell}
          hitSlop={8}
        >
          {stats.coveragePercent != null ? (
            <>
              <Text style={[styles.summaryMetricValue, { color: coverColor }]}>
                {Math.round(stats.coveragePercent)}%
              </Text>
              <Text
                style={[styles.summarySmallLabel, { color: colors.mutedForeground }]}
              >
                of cover
              </Text>
            </>
          ) : (
            <>
              <Feather name="shield" size={16} color={colors.primary} />
              <Text
                style={[styles.summarySmallLabel, { color: colors.primary }]}
              >
                Set cover
              </Text>
            </>
          )}
        </Pressable>
      </View>

      {stats.coveragePercent != null && (
        <View style={{ marginTop: 10 }}>
          <View
            style={{
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.border,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: 4,
                borderRadius: 2,
                width: `${Math.min(stats.coveragePercent, 100)}%` as any,
                backgroundColor: coverColor,
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Donut chart helpers ───────────────────────────────────────────────────────

/** Pastel palette for donut segments (works on the teal card background) */
const DONUT_COLORS = [
  "#80CBC4", // teal-mint  — Furniture
  "#81D4A8", // green      — Electronics
  "#FFB74D", // amber      — Appliances
  "#CE93D8", // purple     — General
  "#90CAF9", // blue       — Other
  "#F48FB1", // pink
  "#A5D6A7", // light green
  "#BCAAA4", // warm grey
];

function segmentPath(
  cx: number, cy: number,
  outerR: number, innerR: number,
  sa: number, ea: number
): string {
  const x1 = cx + outerR * Math.cos(sa), y1 = cy + outerR * Math.sin(sa);
  const x2 = cx + outerR * Math.cos(ea), y2 = cy + outerR * Math.sin(ea);
  const ix1 = cx + innerR * Math.cos(ea), iy1 = cy + innerR * Math.sin(ea);
  const ix2 = cx + innerR * Math.cos(sa), iy2 = cy + innerR * Math.sin(sa);
  const large = ea - sa > Math.PI ? 1 : 0;
  return [
    `M${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A${outerR} ${outerR} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L${ix1.toFixed(2)} ${iy1.toFixed(2)}`,
    `A${innerR} ${innerR} 0 ${large} 0 ${ix2.toFixed(2)} ${iy2.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function CategoryDonut({
  data,
  total,
  size = 110,
}: {
  data: { name: string; value: number }[];
  total: number;
  size?: number;
}) {
  const cx = size / 2, cy = size / 2;
  const outerR = size / 2 - 3;
  const innerR = outerR * 0.56;

  if (total <= 0 || data.length === 0) {
    return (
      <Svg width={size} height={size}>
        <Circle
          cx={cx} cy={cy}
          r={(outerR + innerR) / 2}
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth={outerR - innerR}
        />
      </Svg>
    );
  }

  const GAP = 0.02;
  let angle = -Math.PI / 2;
  return (
    <Svg width={size} height={size}>
      {data.map((seg, i) => {
        const sweep = Math.max((seg.value / total) * 2 * Math.PI - GAP, 0.01);
        const ea = angle + sweep;
        const d = segmentPath(cx, cy, outerR, innerR, angle, ea);
        angle += (seg.value / total) * 2 * Math.PI;
        return <Path key={i} d={d} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />;
      })}
      <Circle cx={cx} cy={cy} r={innerR - 1} fill="rgba(255,255,255,0.1)" />
    </Svg>
  );
}

// ─── Insight card ─────────────────────────────────────────────────────────────

function InsightCard({
  items,
  totalValue,
  colors,
}: {
  items: InventoryItem[];
  totalValue: number;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const [innerW, setInnerW] = useState(0);
  const sparkPoints = useMemo(() => buildSparklinePoints(items, 6), [items]);

  // Build category breakdown sorted by value desc
  const categoryData = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      const raw = item.category ?? "Other";
      const cat = raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, " ");
      map.set(cat, (map.get(cat) ?? 0) + getItemTotalValue(item));
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));
  }, [items]);

  const insightText = useMemo(() => {
    if (categoryData.length === 0 || totalValue === 0) {
      return items.length === 0
        ? "Start scanning or adding items to build your record."
        : "Keep adding items to see a category breakdown.";
    }
    const top = categoryData[0];
    const pct = Math.round((top.value / totalValue) * 100);
    return `Your biggest category is ${top.name}, making up ${pct}% of your total.`;
  }, [categoryData, totalValue, items.length]);

  const LEGEND_MAX = 4;
  const legendItems = categoryData.slice(0, LEGEND_MAX);
  const moreCount = Math.max(0, categoryData.length - LEGEND_MAX);

  return (
    <LinearGradient
      colors={["#0A6860", "#0F8F83"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.insightCard, { borderRadius: colors.radius + 2 }]}
    >
      {/* ── Total header ──────────────────────────────── */}
      <Text style={styles.insightLabel}>You've documented so far</Text>
      <Text style={styles.insightValue} numberOfLines={1} adjustsFontSizeToFit>
        {formatCurrency(totalValue || null)}
      </Text>
      <Text style={styles.insightTagline}>
        {totalValue > 0
          ? "Keep going to make sure everything is covered"
          : "Start scanning to build your record"}
      </Text>

      {/* ── What's documented ────────────────────────── */}
      <View style={styles.insightInner}>
        <Text style={styles.insightSectionLabel}>WHAT'S DOCUMENTED</Text>
        <View
          style={styles.insightBody}
          onLayout={(e) => setInnerW(e.nativeEvent.layout.width)}
        >
          {/* Pastel donut */}
          <CategoryDonut data={categoryData} total={totalValue} size={110} />

          {/* Legend */}
          <View style={styles.insightLegend}>
            {legendItems.map((item, i) => (
              <View key={i} style={styles.insightLegendRow}>
                <View
                  style={[
                    styles.insightLegendDot,
                    { backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] },
                  ]}
                />
                <Text style={styles.insightLegendText} numberOfLines={1}>
                  {item.name}
                </Text>
              </View>
            ))}
            {moreCount > 0 && (
              <Text style={styles.insightMoreText}>+{moreCount} more</Text>
            )}
          </View>

          {/* Mini sparkline */}
          {innerW > 0 && (
            <View style={styles.insightSparkWrap}>
              <Text style={styles.insightSparkLabel}>GROWTH</Text>
              <SparkLine points={sparkPoints} width={68} height={40} light />
            </View>
          )}
        </View>

        <Text style={styles.insightSubtext}>{insightText}</Text>
      </View>
    </LinearGradient>
  );
}

// ─── Radial coverage arc ──────────────────────────────────────────────────────

function RadialCoverage({
  percent,
  size = 80,
  strokeWidth = 8,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
}) {
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.min(percent, 100) / 100) * circumference;
  const stroke = coverageColor(percent);

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={BRAND_BORDER}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${filled} ${circumference - filled}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </Svg>
      <Text
        style={{
          fontSize: 13,
          fontFamily: "Inter_700Bold",
          color: stroke,
          textAlign: "center",
        }}
      >
        {Math.round(Math.min(percent, 999))}%
      </Text>
      <Text
        style={{
          fontSize: 8,
          fontFamily: "Inter_400Regular",
          color: "#64736F",
          textAlign: "center",
        }}
      >
        of cover
      </Text>
    </View>
  );
}

// ─── Coverage bar ─────────────────────────────────────────────────────────────

function CoverageBar({
  percent,
  colors,
}: {
  percent: number;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const clamped = Math.min(percent, 100);
  const fill = coverageColor(percent);
  const label =
    percent >= 100
      ? "Recorded cover value reached — review with your insurer"
      : percent >= 90
        ? "Approaching recorded cover value"
        : percent >= 70
          ? "Moderate usage of recorded cover"
          : `${Math.round(percent)}% of recorded cover value`;

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text
          style={{
            fontSize: 12,
            fontFamily: "Inter_400Regular",
            color: colors.mutedForeground,
          }}
        >
          Contents value vs recorded cover
        </Text>
        <Text
          style={{
            fontSize: 12,
            fontFamily: "Inter_600SemiBold",
            color: fill,
          }}
        >
          {Math.round(percent)}%
        </Text>
      </View>
      <View
        style={{
          height: 8,
          borderRadius: 4,
          backgroundColor: colors.border,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: 8,
            borderRadius: 4,
            width: `${clamped}%` as any,
            backgroundColor: fill,
          }}
        />
      </View>
      <Text
        style={{
          fontSize: 11,
          fontFamily: "Inter_400Regular",
          color: colors.mutedForeground,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

// ─── Room distribution bars ───────────────────────────────────────────────────

function RoomBarsSection({
  roomStats,
  colors,
}: {
  roomStats: RoomStat[];
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  if (roomStats.length === 0) return null;
  const top = roomStats.slice(0, 8);
  const maxValue = Math.max(...top.map((r) => r.totalValue), 1);
  const topByCount = [...top].sort((a, b) => b.itemCount - a.itemCount);
  const maxCount = Math.max(...topByCount.map((r) => r.itemCount), 1);

  return (
    <View
      style={[
        styles.footerCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <Text
        style={[styles.sectionLabel, { color: colors.mutedForeground, marginBottom: 10 }]}
      >
        VALUE BY ROOM
      </Text>
      {top.map((rs) => (
        <View key={`${rs.room.id}-val`} style={styles.barRow}>
          <Text
            style={[styles.barLabel, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {rs.room.name}
          </Text>
          <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${(rs.totalValue / maxValue) * 100}%` as any,
                  backgroundColor: BRAND_TEAL,
                },
              ]}
            />
          </View>
          <Text style={[styles.barMeta, { color: colors.mutedForeground }]}>
            {formatCurrency(rs.totalValue || null)}
          </Text>
        </View>
      ))}

      <View
        style={{
          height: StyleSheet.hairlineWidth,
          backgroundColor: colors.border,
          marginVertical: 14,
        }}
      />

      <Text
        style={[styles.sectionLabel, { color: colors.mutedForeground, marginBottom: 10 }]}
      >
        ITEMS BY ROOM
      </Text>
      {topByCount.map((rs) => (
        <View key={`${rs.room.id}-cnt`} style={styles.barRow}>
          <Text
            style={[styles.barLabel, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {rs.room.name}
          </Text>
          <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${(rs.itemCount / maxCount) * 100}%` as any,
                  backgroundColor: BRAND_DARK,
                },
              ]}
            />
          </View>
          <Text style={[styles.barMeta, { color: colors.mutedForeground }]}>
            {rs.itemCount} {rs.itemCount === 1 ? "item" : "items"}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ─── Room card ────────────────────────────────────────────────────────────────

function RoomCard({
  item,
  itemCount,
  totalValue,
  maxValue,
  colors,
}: {
  item: InventoryRoom;
  itemCount: number;
  totalValue: number;
  maxValue: number;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const handlePress = async () => {
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/room/[id]",
      params: { id: item.id, name: item.name, fileId: item.file_id },
    });
  };

  const pct = maxValue > 0 ? Math.min(totalValue / maxValue, 1) : 0;

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderRadius: colors.radius,
          borderColor: colors.border,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <View style={styles.cardLeft}>
        {item.cover_photo_url ? (
          <Image
            source={{ uri: item.cover_photo_url }}
            style={styles.roomThumb}
            contentFit="cover"
          />
        ) : (
          <View
            style={[
              styles.roomThumbPlaceholder,
              { backgroundColor: colors.secondary },
            ]}
          >
            <Feather
              name={roomIcon(item.room_type) as any}
              size={20}
              color={colors.primary}
            />
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardRow}>
          <Text
            style={[styles.cardName, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </View>
        <View style={styles.cardMeta}>
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </Text>
          <Text style={[styles.metaValue, { color: colors.primary }]}>
            {formatCurrency(totalValue || null)}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
          <View
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: BRAND_BORDER,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: 4,
                borderRadius: 2,
                width: `${pct * 100}%` as any,
                backgroundColor: BRAND_TEAL,
              }}
            />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Cover amount modal ───────────────────────────────────────────────────────

function CoverAmountModal({
  visible,
  current,
  onClose,
  onSave,
  colors,
}: {
  visible: boolean;
  current: number | null;
  onClose: () => void;
  onSave: (value: number | null) => Promise<void>;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const insets = useSafeAreaInsets();
  const [raw, setRaw] = useState(current != null ? String(current) : "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = raw.trim();
    const parsed =
      trimmed === "" ? null : parseFloat(trimmed.replace(/,/g, ""));
    if (trimmed !== "" && (isNaN(parsed!) || parsed! < 0)) {
      Alert.alert("Invalid amount", "Please enter a valid positive number.");
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed);
      onClose();
    } catch {
      Alert.alert("Error", "Failed to save cover amount. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleOpen = () => {
    setRaw(current != null ? String(current) : "");
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={handleOpen}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }}
        onPress={onClose}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
      >
        <View
          style={{
            backgroundColor: colors.card,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 24,
            paddingBottom: insets.bottom + 24,
            gap: 16,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontFamily: "Inter_700Bold",
                color: colors.foreground,
              }}
            >
              Contents cover amount
            </Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <Text
            style={{
              fontSize: 13,
              fontFamily: "Inter_400Regular",
              color: colors.mutedForeground,
              lineHeight: 19,
            }}
          >
            Enter the contents insurance sum insured from your policy document.
            This unlocks the coverage arc and bar on this property.
          </Text>

          <View style={{ gap: 6 }}>
            <Text
              style={{
                fontSize: 12,
                fontFamily: "Inter_500Medium",
                color: colors.mutedForeground,
                letterSpacing: 0.3,
              }}
            >
              Cover amount (£)
            </Text>
            <TextInput
              value={raw}
              onChangeText={setRaw}
              placeholder="e.g. 50000"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="decimal-pad"
              autoFocus
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: colors.radius,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 16,
                fontFamily: "Inter_400Regular",
                color: colors.foreground,
                backgroundColor: colors.background,
              }}
            />
          </View>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 14,
                borderRadius: colors.radius,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: "center",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  fontSize: 15,
                  fontFamily: "Inter_600SemiBold",
                  color: colors.foreground,
                }}
              >
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 14,
                borderRadius: colors.radius,
                backgroundColor: colors.primary,
                alignItems: "center",
                opacity: pressed || saving ? 0.7 : 1,
              })}
            >
              {saving ? (
                <ActivityIndicator
                  size="small"
                  color={colors.primaryForeground}
                />
              ) : (
                <Text
                  style={{
                    fontSize: 15,
                    fontFamily: "Inter_600SemiBold",
                    color: colors.primaryForeground,
                  }}
                >
                  Save
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function PropertyDetailScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [coverModalVisible, setCoverModalVisible] = useState(false);
  const [coverPhotoUploading, setCoverPhotoUploading] = useState(false);
  // Optimistic local state so the cover photo shows instantly after upload
  const [localCoverUrl, setLocalCoverUrl] = useState<string | null>(null);

  const {
    data: rooms,
    isLoading: roomsLoading,
    error: roomsError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["rooms", id, session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_rooms")
        .select("*")
        .eq("file_id", id)
        .is("archived_at", null)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as InventoryRoom[];
    },
    enabled: !!session && !!id,
  });

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["property-items", id, session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select(
          "id, file_id, room_id, name, estimated_price, unit_estimated_price, quantity, image_url, photo_url"
        )
        .eq("file_id", id);
      if (error) throw error;
      return (data ?? []) as InventoryItem[];
    },
    enabled: !!session && !!id,
  });

  // Optional scan_date query — silently ignored if the column doesn't exist yet
  const { data: scanDateMap } = useQuery({
    queryKey: ["item-scan-dates", id, session?.user.id],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("inventory_items")
          .select("id, scan_date")
          .eq("file_id", id);
        if (error) return {} as Record<string, string | null>;
        const map: Record<string, string | null> = {};
        for (const row of data ?? []) {
          map[(row as any).id] = (row as any).scan_date ?? null;
        }
        return map;
      } catch {
        return {} as Record<string, string | null>;
      }
    },
    enabled: !!session && !!id,
  });

  const { data: property } = useQuery({
    queryKey: ["property", id, session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_files")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as InventoryFile;
    },
    enabled: !!session && !!id,
  });

  // Merge scan dates into items for the insight card
  const itemsWithDates = useMemo<InventoryItem[]>(() => {
    if (!items) return [];
    if (!scanDateMap) return items;
    return items.map((i) => ({ ...i, scan_date: scanDateMap[i.id] ?? null }));
  }, [items, scanDateMap]);

  const stats = useMemo(() => {
    if (!property || !rooms || !items) return null;
    return calcPropertyStats(property, rooms, items);
  }, [property, rooms, items]);

  const maxRoomValue = stats
    ? Math.max(...stats.roomStats.map((r) => r.totalValue), 1)
    : 1;

  const isLoading = roomsLoading || itemsLoading;

  const saveCoverAmount = async (value: number | null) => {
    const { error } = await supabase
      .from("inventory_files")
      .update({ contents_sum_insured: value })
      .eq("id", id);
    if (error) throw error;
    await queryClient.invalidateQueries({
      queryKey: ["property", id, session?.user.id],
    });
  };

  const handlePickPropertyCover = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "Allow access to your photos to set a property cover image."
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: true,
      aspect: [16, 9],
    });
    if (result.canceled || !result.assets[0]) return;
    if (!session?.user.id) return;
    setCoverPhotoUploading(true);
    try {
      const publicUrl = await uploadCoverPhoto(
        result.assets[0].uri,
        session.user.id
      );
      if (!publicUrl) {
        Alert.alert("Upload failed", "Could not upload cover photo. Please try again.");
        return;
      }
      // Show the photo immediately — don't wait for cache refetch
      setLocalCoverUrl(publicUrl);
      const { error: updateError } = await supabase
        .from("inventory_files")
        .update({ property_cover_image_url: publicUrl })
        .eq("id", id)
        .eq("user_id", session.user.id);
      if (updateError) {
        // Revert optimistic update and surface the real error
        setLocalCoverUrl(null);
        Alert.alert("Save failed", updateError.message);
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["property", id] }),
        queryClient.invalidateQueries({ queryKey: ["files"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-files"] }),
      ]);
    } finally {
      setCoverPhotoUploading(false);
    }
  };

  const renderHeader = () => {
    if (!stats) return null;
    return (
      <>
        {/* Property cover photo hero */}
        <View style={{ height: 200, overflow: "hidden" }}>
          {(localCoverUrl ?? property?.property_cover_image_url) ? (
            <Image
              source={{ uri: localCoverUrl ?? property!.property_cover_image_url! }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
          ) : (
            /* Designed placeholder — gradient teal, icon badge, CTA */
            <Pressable
              onPress={handlePickPropertyCover}
              disabled={coverPhotoUploading}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
              }}
            >
              <LinearGradient
                colors={["#0B6F66", "#14A99A"]}
                start={{ x: 0, y: 1 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
              {/* Subtle concentric rings for depth */}
              <View
                style={{
                  position: "absolute",
                  width: 220,
                  height: 220,
                  borderRadius: 110,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.06)",
                }}
              />
              <View
                style={{
                  position: "absolute",
                  width: 160,
                  height: 160,
                  borderRadius: 80,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.08)",
                }}
              />
              {/* Icon badge */}
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: "rgba(255,255,255,0.12)",
                  borderWidth: 1.5,
                  borderColor: "rgba(255,255,255,0.25)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {coverPhotoUploading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Feather name="camera" size={26} color="#fff" />
                )}
              </View>
              <View style={{ alignItems: "center", gap: 4 }}>
                <Text
                  style={{
                    color: "#fff",
                    fontSize: 15,
                    fontFamily: "Inter_600SemiBold",
                    letterSpacing: 0.1,
                  }}
                >
                  Add a cover photo
                </Text>
                <Text
                  style={{
                    color: "rgba(255,255,255,0.5)",
                    fontSize: 12,
                    fontFamily: "Inter_400Regular",
                  }}
                >
                  Tap to choose from your library
                </Text>
              </View>
            </Pressable>
          )}
          {/* Camera button shown only when a photo is already set */}
          {(localCoverUrl ?? property?.property_cover_image_url) && (
            <Pressable
              onPress={handlePickPropertyCover}
              disabled={coverPhotoUploading}
              style={{
                position: "absolute",
                bottom: 12,
                right: 12,
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: "rgba(0,0,0,0.45)",
                alignItems: "center",
                justifyContent: "center",
              }}
              hitSlop={8}
            >
              {coverPhotoUploading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Feather name="camera" size={16} color="#fff" />
              )}
            </Pressable>
          )}
        </View>

      <View style={{ gap: 10, paddingHorizontal: 16, paddingTop: 14 }}>
        {/* 1 — Compact summary */}
        <CompactSummary
          stats={stats}
          colors={colors}
          onEditCover={() => setCoverModalVisible(true)}
        />

        {/* 2 — Insight card */}
        <InsightCard
          items={itemsWithDates}
          totalValue={stats.totalValue}
          colors={colors}
        />

        {/* 3 — Action buttons */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/(tabs)/scan",
                params: { fileId: id, fileName: name },
              })
            }
            style={({ pressed }) => [
              styles.actionBtn,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity: pressed ? 0.85 : 1,
                flex: 1,
              },
            ]}
          >
            <Feather name="zap" size={16} color={colors.primaryForeground} />
            <Text style={[styles.actionBtnText, { color: colors.primaryForeground }]}>
              Scan items
            </Text>
          </Pressable>
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/(tabs)/add-item",
                params: { fileId: id, fileName: name },
              })
            }
            style={({ pressed }) => [
              styles.actionBtn,
              {
                backgroundColor: colors.card,
                borderRadius: colors.radius,
                borderWidth: 1,
                borderColor: colors.border,
                opacity: pressed ? 0.85 : 1,
                flex: 1,
              },
            ]}
          >
            <Feather name="plus" size={16} color={colors.foreground} />
            <Text style={[styles.actionBtnText, { color: colors.foreground }]}>
              Add manually
            </Text>
          </Pressable>
        </View>

        {/* 4 — Rooms heading */}
        <Text style={[styles.sectionHeading, { color: colors.foreground }]}>
          Rooms
        </Text>
      </View>
      </>
    );
  };

  const renderFooter = () => {
    if (!stats) return null;
    return (
      <View style={{ paddingHorizontal: 16, paddingTop: 4, gap: 10, paddingBottom: 8 }}>
        {/* Room distribution bars */}
        {stats.roomStats.length > 0 && (
          <RoomBarsSection roomStats={stats.roomStats} colors={colors} />
        )}

        {/* Claim readiness */}
        {stats.itemCount > 0 && (
          <View
            style={[
              styles.footerCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <Text
              style={[styles.sectionLabel, { color: colors.mutedForeground, marginBottom: 10 }]}
            >
              HOW COMPLETE IS YOUR RECORD?
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
              <View style={styles.claimStat}>
                <Feather
                  name="camera"
                  size={14}
                  color={
                    stats.photoPercent >= 80
                      ? colors.success
                      : colors.mutedForeground
                  }
                />
                <Text style={[styles.claimText, { color: colors.mutedForeground }]}>
                  {Math.round(stats.photoPercent)}% have photos
                </Text>
              </View>
              <View style={styles.claimStat}>
                <Feather
                  name="tag"
                  size={14}
                  color={
                    stats.valuePercent >= 80
                      ? colors.success
                      : colors.mutedForeground
                  }
                />
                <Text style={[styles.claimText, { color: colors.mutedForeground }]}>
                  {Math.round(stats.valuePercent)}% valued
                </Text>
              </View>
              {stats.itemsNeedingReview > 0 && (
                <View style={styles.claimStat}>
                  <Feather name="alert-circle" size={14} color={colors.warning} />
                  <Text style={[styles.claimText, { color: colors.mutedForeground }]}>
                    {stats.itemsNeedingReview} need review
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Coverage detail */}
        {stats.coveragePercent != null && (
          <View
            style={[
              styles.footerCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <Text
              style={[styles.sectionLabel, { color: colors.mutedForeground, marginBottom: 12 }]}
            >
              COVERAGE OVERVIEW
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
              <Pressable
                onPress={() => setCoverModalVisible(true)}
                hitSlop={8}
                style={{ alignItems: "center" }}
              >
                <RadialCoverage percent={stats.coveragePercent} size={80} />
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 3,
                    marginTop: 4,
                  }}
                >
                  <Feather name="edit-2" size={10} color={colors.mutedForeground} />
                  <Text
                    style={{
                      fontSize: 10,
                      fontFamily: "Inter_400Regular",
                      color: colors.mutedForeground,
                    }}
                  >
                    Edit cover
                  </Text>
                </View>
              </Pressable>
              <View style={{ flex: 1 }}>
                <CoverageBar percent={stats.coveragePercent} colors={colors} />
              </View>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: name ?? "Property",
          headerRight: () => (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/(tabs)/edit-property/[id]",
                  params: { id },
                })
              }
              style={{ padding: 4 }}
              hitSlop={8}
            >
              <Feather name="edit-2" size={19} color={colors.primary} />
            </Pressable>
          ),
        }}
      />
      {isLoading ? (
        <LoadingState />
      ) : roomsError ? (
        <ErrorState
          message="Failed to load rooms"
          detail={(roomsError as Error).message}
          onRetry={refetch}
        />
      ) : (
        <FlatList
          data={stats ? stats.roomStats : []}
          keyExtractor={(rs) => rs.room.id}
          renderItem={({ item: rs }) => (
            <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
              <RoomCard
                item={rs.room}
                itemCount={rs.itemCount}
                totalValue={rs.totalValue}
                maxValue={maxRoomValue}
                colors={colors}
              />
            </View>
          )}
          ListHeaderComponent={renderHeader}
          ListFooterComponent={renderFooter}
          contentContainerStyle={{
            paddingBottom: insets.bottom + 24,
            ...(Platform.OS === "web" ? { paddingTop: 0 } : {}),
          }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
              <EmptyState
                icon="layers"
                title="No rooms found"
                subtitle="Rooms will appear here once added"
              />
            </View>
          }
        />
      )}
      <CoverAmountModal
        visible={coverModalVisible}
        current={property?.contents_sum_insured ?? null}
        onClose={() => setCoverModalVisible(false)}
        onSave={saveCoverAmount}
        colors={colors}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Summary card
  summaryCard: {
    borderWidth: 1,
    padding: 14,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  summaryBigValue: {
    fontSize: 19,
    fontFamily: "Inter_700Bold",
  },
  summarySmallLabel: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
    marginHorizontal: 12,
  },
  summaryMetricCell: {
    alignItems: "center",
    gap: 2,
  },
  summaryMetricValue: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },

  // Insight card — teal gradient, donut + sparkline
  insightCard: {
    padding: 16,
    overflow: "hidden",
  },
  insightLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.75)",
  },
  insightValue: {
    fontSize: 30,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    marginTop: 2,
    lineHeight: 36,
  },
  insightTagline: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.65)",
    marginTop: 5,
  },
  insightInner: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
    gap: 10,
  },
  insightSectionLabel: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.1,
    color: "rgba(255,255,255,0.6)",
  },
  insightBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  insightLegend: {
    flex: 1,
    gap: 5,
  },
  insightLegendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  insightLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  insightLegendText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.9)",
    flex: 1,
  },
  insightMoreText: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)",
    marginTop: 1,
  },
  insightSparkWrap: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 8,
    padding: 6,
    alignItems: "center",
    gap: 3,
  },
  insightSparkLabel: {
    fontSize: 8,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
    color: "rgba(255,255,255,0.55)",
  },
  insightSubtext: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.75)",
  },

  // Action buttons
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actionBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },

  // Section heading
  sectionHeading: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    marginTop: 2,
    marginBottom: 2,
  },

  // Room card
  card: {
    borderWidth: 1,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
  },
  cardLeft: {},
  roomThumb: { width: 72, height: 72 },
  roomThumbPlaceholder: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1, padding: 12, gap: 2 },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
    marginRight: 4,
  },
  cardMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  metaValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // Footer cards
  footerCard: {
    borderWidth: 1,
    padding: 14,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  barLabel: {
    width: 80,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  barTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: { height: 6, borderRadius: 3 },
  barMeta: {
    width: 62,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "right",
  },

  // Claim readiness
  claimStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  claimText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
