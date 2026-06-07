import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  ActivityIndicator,
  Alert,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line, Path, Polyline, Rect } from "react-native-svg";

import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSignedUrl, useSignedUrls } from "@/hooks/useSignedUrls";
import {
  buildSparklinePoints,
  calcPropertyStats,
  type RoomStat,
} from "@/lib/dashboard-stats";
import {
  formatCurrency,
  getItemTotalValue,
  hasPhoto,
  hasValue,
} from "@/lib/inventory-mappers";
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
  if (percent >= 100) return "#EF4444";
  if (percent >= 75) return "#F97316";
  return "#22C55E";
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

  // Map normalised points to screen coords
  const screen = points.map((p) => ({
    x: pad + p.x * w,
    y: pad + (1 - p.y) * h,
  }));

  // Catmull-Rom → cubic Bezier for smooth curve
  let d = `M${screen[0].x.toFixed(2)},${screen[0].y.toFixed(2)}`;
  for (let i = 0; i < screen.length - 1; i++) {
    const p0 = screen[Math.max(0, i - 1)];
    const p1 = screen[i];
    const p2 = screen[i + 1];
    const p3 = screen[Math.min(screen.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }

  return (
    <Svg width={width} height={height}>
      <Path
        d={d}
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
            <LinearGradient
              colors={["#22C55E", "#22C55E", "#FBBF24", "#F97316", "#EF4444"]}
              locations={[0, 0.75, 0.85, 0.93, 1.0]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
            <View
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${Math.min(stats.coveragePercent, 100)}%` as any,
                right: 0,
                backgroundColor: colors.border,
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
  const [sparkPeriod, setSparkPeriod] = useState(3);
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  const sparkPoints = useMemo(() => buildSparklinePoints(items, sparkPeriod), [items, sparkPeriod]);

  // Animated counting total + haptic feedback (fast → slow deceleration)
  const [displayVal, setDisplayVal] = useState(0);
  useEffect(() => {
    const anim = new Animated.Value(0);
    const id = anim.addListener(({ value }) => setDisplayVal(Math.round(value)));
    Animated.timing(anim, {
      toValue: totalValue,
      duration: 700,
      useNativeDriver: false,
      easing: Easing.out(Easing.cubic),
    }).start();

    // Schedule 8 haptic pulses with quadratically increasing gaps (fast start → slow end)
    const PULSES = 8;
    const DURATION = 680; // slightly under animation duration
    const timeouts = Array.from({ length: PULSES }, (_, i) => {
      const delay = Math.round(((i / (PULSES - 1)) ** 2) * DURATION);
      return setTimeout(
        () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
        delay,
      );
    });

    return () => {
      anim.removeListener(id);
      timeouts.forEach(clearTimeout);
    };
  }, [totalValue]);

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
        {totalValue > 0 ? formatCurrency(displayVal || 0) : formatCurrency(null)}
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

          {/* Mini sparkline — tap to pick period */}
          {innerW > 0 && (
            <Pressable
              style={({ pressed }) => [
                styles.insightSparkWrap,
                pressed && { opacity: 0.75 },
              ]}
              onPress={() => setShowPeriodPicker((v) => !v)}
            >
              <Text style={styles.insightSparkLabel}>{sparkPeriod}MO GROWTH</Text>
              <SparkLine points={sparkPoints} width={68} height={40} />
            </Pressable>
          )}
        </View>

        {/* Period picker — shown on tap */}
        {showPeriodPicker && (
          <View style={styles.insightPeriodWrap}>
            <Text style={styles.insightPeriodTitle}>{sparkPeriod} months</Text>
            <View style={styles.insightPeriodRow}>
              {[1, 3, 6, 12, 24].map((m) => (
                <Pressable
                  key={m}
                  onPress={() => {
                    setSparkPeriod(m);
                    setShowPeriodPicker(false);
                  }}
                  style={[
                    styles.insightPeriodChip,
                    sparkPeriod === m && styles.insightPeriodChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.insightPeriodChipText,
                      sparkPeriod === m && styles.insightPeriodChipTextActive,
                    ]}
                  >
                    {m}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

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
        {/* Gradient spans full track so locations map to real bar width */}
        <LinearGradient
          colors={["#22C55E", "#22C55E", "#FBBF24", "#F97316", "#EF4444"]}
          locations={[0, 0.75, 0.85, 0.93, 1.0]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Overlay hides the unfilled right portion with the track colour */}
        <View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${clamped}%` as any,
            right: 0,
            backgroundColor: colors.border,
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

// ─── Room distribution stacked bars ───────────────────────────────────────────

/** Pastel palette — one colour per room, consistent across both bars */
const ROOM_BAR_PALETTE = [
  "#80CBC4", // teal-mint
  "#A5D6A7", // sage-green
  "#FFCC80", // peachy-amber
  "#CE93D8", // soft-lavender
  "#90CAF9", // sky-blue
  "#F48FB1", // dusty-rose
  "#FFE082", // warm-yellow
  "#BCAAA4", // warm-grey
  "#80DEEA", // cyan-light
  "#EF9A9A", // soft-coral
];

const LEGEND_LIMIT = 4; // dots shown beneath bars before "+N more"

function RoomBarsSection({
  roomStats,
  colors,
}: {
  roomStats: RoomStat[];
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const [modalVisible, setModalVisible] = useState(false);
  const insets = useSafeAreaInsets();

  if (roomStats.length === 0) return null;

  // Sort by value descending — this ordering defines palette assignment
  const byValue = [...roomStats].sort((a, b) => b.totalValue - a.totalValue);
  const byCount = [...roomStats].sort((a, b) => b.itemCount - a.itemCount);

  const colorMap: Record<string, string> = {};
  byValue.forEach((rs, i) => {
    colorMap[rs.room.id] = ROOM_BAR_PALETTE[i % ROOM_BAR_PALETTE.length];
  });

  const totalValue = byValue.reduce((s, r) => s + r.totalValue, 0) || 1;
  const totalCount = byValue.reduce((s, r) => s + r.itemCount, 0) || 1;

  const legendRooms = byValue.slice(0, LEGEND_LIMIT);
  const extraCount = Math.max(0, byValue.length - LEGEND_LIMIT);

  const renderStackedBar = (
    sorted: RoomStat[],
    getValue: (r: RoomStat) => number,
    total: number
  ) => (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        height: 14,
        borderRadius: 7,
        overflow: "hidden",
      }}
    >
      {sorted.map((rs) => {
        const pct = (getValue(rs) / total) * 100;
        if (pct < 0.8) return null;
        return (
          <View
            key={rs.room.id}
            style={{ flex: pct, backgroundColor: colorMap[rs.room.id] }}
          />
        );
      })}
    </View>
  );

  return (
    <>
      <Pressable
        onPress={() => setModalVisible(true)}
        style={({ pressed }) => [
          styles.footerCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
            opacity: pressed ? 0.92 : 1,
          },
        ]}
      >
        <Text
          style={[styles.sectionLabel, { color: colors.mutedForeground, marginBottom: 12 }]}
        >
          VALUE & ITEMS BY ROOM
        </Text>

        {/* Value stacked bar */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 7 }}>
          <Text
            style={{
              fontSize: 11,
              fontFamily: "Inter_500Medium",
              color: colors.mutedForeground,
              width: 36,
            }}
          >
            Value
          </Text>
          {renderStackedBar(byValue, (r) => r.totalValue, totalValue)}
        </View>

        {/* Items stacked bar */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <Text
            style={{
              fontSize: 11,
              fontFamily: "Inter_500Medium",
              color: colors.mutedForeground,
              width: 36,
            }}
          >
            Items
          </Text>
          {renderStackedBar(byCount, (r) => r.itemCount, totalCount)}
        </View>

        {/* Legend: top rooms + "+N more" tap hint */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {legendRooms.map((rs) => (
            <View key={rs.room.id} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: colorMap[rs.room.id],
                }}
              />
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: "Inter_400Regular",
                  color: colors.foreground,
                }}
              >
                {rs.room.name}
              </Text>
            </View>
          ))}
          {extraCount > 0 && (
            <Text
              style={{
                fontSize: 12,
                fontFamily: "Inter_400Regular",
                color: colors.primary,
              }}
            >
              +{extraCount} more
            </Text>
          )}
        </View>
      </Pressable>

      {/* ── Full room breakdown bottom sheet ── */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}
          onPress={() => setModalVisible(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              backgroundColor: colors.card,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingBottom: insets.bottom + 16,
              maxHeight: "80%",
            }}
          >
            {/* Handle */}
            <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 4 }}>
              <View
                style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }}
              />
            </View>

            <Text
              style={{
                fontSize: 16,
                fontFamily: "Inter_600SemiBold",
                color: colors.foreground,
                paddingHorizontal: 20,
                paddingVertical: 12,
              }}
            >
              Room Breakdown
            </Text>

            {/* Mini stacked bars inside modal */}
            <View style={{ paddingHorizontal: 20, gap: 7, marginBottom: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text
                  style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground, width: 36 }}
                >
                  Value
                </Text>
                {renderStackedBar(byValue, (r) => r.totalValue, totalValue)}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text
                  style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground, width: 36 }}
                >
                  Items
                </Text>
                {renderStackedBar(byCount, (r) => r.itemCount, totalCount)}
              </View>
            </View>

            {/* Divider */}
            <View
              style={{
                height: StyleSheet.hairlineWidth,
                backgroundColor: colors.border,
                marginHorizontal: 20,
                marginBottom: 4,
              }}
            />

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20 }}
            >
              {/* Table header */}
              <View
                style={{
                  flexDirection: "row",
                  paddingVertical: 8,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.border,
                }}
              >
                <Text
                  style={{ flex: 1, fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground }}
                >
                  ROOM
                </Text>
                <Text
                  style={{ width: 90, fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground, textAlign: "right" }}
                >
                  VALUE
                </Text>
                <Text
                  style={{ width: 52, fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground, textAlign: "right" }}
                >
                  ITEMS
                </Text>
              </View>

              {byValue.map((rs) => (
                <View
                  key={rs.room.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 11,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderColor: colors.border,
                  }}
                >
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: colorMap[rs.room.id],
                      marginRight: 8,
                    }}
                  />
                  <Text
                    style={{ flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground }}
                    numberOfLines={1}
                  >
                    {rs.room.name}
                  </Text>
                  <Text
                    style={{ width: 90, fontSize: 14, fontFamily: "Inter_500Medium", color: colors.foreground, textAlign: "right" }}
                  >
                    {formatCurrency(rs.totalValue || null)}
                  </Text>
                  <Text
                    style={{ width: 52, fontSize: 14, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "right" }}
                  >
                    {rs.itemCount}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// ─── Room card ────────────────────────────────────────────────────────────────

// Module-level Set — tracks rooms whose completion celebration has already fired
// this session.  This ensures the celebration plays even when the user navigates
// back to the property screen after the ring was already closed (in which case
// the component mounts with completionPct already = 1, so the old prevPctRef
// approach — which started at the current value — never triggered).
const celebratedRooms = new Set<string>();

const RING_SIZE = 88;
// Rounded-rect ring that hugs the square thumbnail
const RING_RECT_INSET = 4;                              // path centre 4 px from container edge
const RING_RECT_SIDE = RING_SIZE - 2 * RING_RECT_INSET; // 80 px
const RING_RECT_RX = 10;                                // outer corner radius (thumbnail rx=6 + gap)
// Perimeter: 4 straight sides + one full circle of arcs
const RING_CIRC =
  4 * (RING_RECT_SIDE - 2 * RING_RECT_RX) +            // four straight segments (square, so all equal)
  2 * Math.PI * RING_RECT_RX;                           // four quarter-circles = one full circle ≈ 303 px
// Explicit path starting at top-center (12 o'clock) going clockwise — gives precise control
// over where the progress arc starts and ends.
// Coords: I=4 S=80 R=10 → top-center=(44,4)
const RING_PATH =
  "M 44 4 L 74 4 A 10 10 0 0 1 84 14 L 84 74 A 10 10 0 0 1 74 84 " +
  "L 14 84 A 10 10 0 0 1 4 74 L 4 14 A 10 10 0 0 1 14 4 L 44 4";

function RoomCard({
  item,
  itemCount,
  totalValue,
  maxValue,
  completedCount,
  colors,
  resolvedCoverUrl,
}: {
  item: InventoryRoom;
  itemCount: number;
  totalValue: number;
  maxValue: number;
  completedCount: number;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  /** Pre-resolved signed URL from the parent's batch useSignedUrls() call. */
  resolvedCoverUrl?: string | null;
}) {
  const handlePress = async () => {
    await Haptics.selectionAsync();
    router.push({
      pathname: "/(tabs)/room/[id]",
      params: { id: item.id, name: item.name, fileId: item.file_id },
    });
  };

  const pct = maxValue > 0 ? Math.min(totalValue / maxValue, 1) : 0;
  const completionPct = itemCount > 0 ? Math.min(completedCount / itemCount, 1) : 0;
  const ringOffset = RING_CIRC * (1 - completionPct);

  // Ring completion celebration:
  //   - bounce-scales the thumbnail+ring
  //   - fires success haptic
  //   - shows a brief "Room complete 🎉" toast pill
  //
  // Uses the module-level celebratedRooms Set so the celebration fires at most
  // once per room per session — critically, it fires even when the user navigates
  // back to the property screen AFTER the ring closed (mounting with completionPct
  // already = 1, which the old prevPctRef approach missed entirely).
  const celebAnim = useRef(new Animated.Value(0)).current;
  const toastAnim = useRef(new Animated.Value(0)).current;
  const celebScale = celebAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] });
  const toastOpacity = toastAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const toastTranslate = toastAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });

  useEffect(() => {
    if (completionPct >= 1 && !celebratedRooms.has(item.id)) {
      celebratedRooms.add(item.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Ring bounce
      Animated.sequence([
        Animated.timing(celebAnim, {
          toValue: 1,
          duration: 260,
          useNativeDriver: true,
          easing: Easing.out(Easing.back(2.5)),
        }),
        Animated.timing(celebAnim, {
          toValue: 0,
          duration: 380,
          useNativeDriver: true,
          easing: Easing.in(Easing.cubic),
        }),
      ]).start();

      // Toast: slide up + fade in, hold 1.8 s, then fade out
      Animated.sequence([
        Animated.timing(toastAnim, {
          toValue: 1,
          duration: 260,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.delay(1800),
        Animated.timing(toastAnim, {
          toValue: 0,
          duration: 320,
          useNativeDriver: true,
          easing: Easing.in(Easing.cubic),
        }),
      ]).start();
    }
  }, [completionPct, item.id]);

  return (
    <View>
      {/* "Room complete 🎉" toast — slides up from the card, fades in/out */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -36,
          alignSelf: "center",
          zIndex: 10,
          opacity: toastOpacity,
          transform: [{ translateY: toastTranslate }],
          backgroundColor: "#1C6B5A",
          paddingHorizontal: 16,
          paddingVertical: 7,
          borderRadius: 20,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.18,
          shadowRadius: 6,
          elevation: 6,
        }}
      >
        <Text style={{ fontSize: 15 }}>🎉</Text>
        <Text
          style={{
            color: "#fff",
            fontSize: 13,
            fontFamily: "Inter_600SemiBold",
            letterSpacing: 0.2,
          }}
        >
          Room complete!
        </Text>
      </Animated.View>

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
        {/* Completion ring — animated scale on full completion */}
        <Animated.View style={[styles.roomThumbWrap, { transform: [{ scale: celebScale }] }]}>
          <Svg
            width={RING_SIZE}
            height={RING_SIZE}
            style={StyleSheet.absoluteFillObject}
          >
            {/* Track — full rounded-rect, path starts at top-center */}
            <Path
              d={RING_PATH}
              fill="none"
              stroke={BRAND_BORDER}
              strokeWidth={4}
              strokeLinecap="round"
            />
            {/* Progress — same path, dashed to show only completionPct */}
            {completionPct > 0 && (
              <Path
                d={RING_PATH}
                fill="none"
                stroke={BRAND_TEAL}
                strokeWidth={4}
                strokeLinecap="round"
                strokeDasharray={`${RING_CIRC} ${RING_CIRC}`}
                strokeDashoffset={ringOffset}
              />
            )}
          </Svg>
          {resolvedCoverUrl ? (
            <Image
              source={{ uri: resolvedCoverUrl }}
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
        </Animated.View>
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
    </View>
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

// ─── Shimmer skeleton ─────────────────────────────────────────────────────────

const SHIMMER_W = 220;

function ShimmerBlock({
  height,
  borderRadius = 8,
  bgColor,
  style,
}: {
  height: number;
  borderRadius?: number;
  bgColor: string;
  style?: object;
}) {
  const shimmerX = useRef(new Animated.Value(-SHIMMER_W)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(shimmerX, {
        toValue: 420,
        duration: 1100,
        useNativeDriver: true,
        easing: Easing.linear,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <View
      style={[{ height, borderRadius, backgroundColor: bgColor, overflow: "hidden" }, style]}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          { transform: [{ translateX: shimmerX }] },
        ]}
      >
        <LinearGradient
          colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.45)", "rgba(255,255,255,0)"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ width: SHIMMER_W, height: "100%" }}
        />
      </Animated.View>
    </View>
  );
}

function PropertySkeleton({
  colors,
}: {
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const bg = colors.border;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Hero */}
      <ShimmerBlock height={200} borderRadius={0} bgColor={bg} />

      <View style={{ gap: 10, paddingHorizontal: 16, paddingTop: 14 }}>
        {/* Summary card */}
        <ShimmerBlock height={82} borderRadius={12} bgColor={bg} />

        {/* Insight card */}
        <ShimmerBlock height={244} borderRadius={14} bgColor={bg} />

        {/* Action buttons */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <ShimmerBlock height={48} borderRadius={10} bgColor={bg} style={{ flex: 1 }} />
          <ShimmerBlock height={48} borderRadius={10} bgColor={bg} style={{ flex: 1 }} />
        </View>

        {/* Rooms heading */}
        <ShimmerBlock height={20} borderRadius={4} bgColor={bg} style={{ width: 60 }} />

        {/* Room cards */}
        {[1, 2, 3].map((i) => (
          <ShimmerBlock key={i} height={88} borderRadius={12} bgColor={bg} />
        ))}
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

const ROOM_TYPE_OPTIONS = [
  { label: "Living Room", value: "living_room" },
  { label: "Bedroom",     value: "bedroom" },
  { label: "Kitchen",     value: "kitchen" },
  { label: "Bathroom",    value: "bathroom" },
  { label: "Dining Room", value: "dining" },
  { label: "Office",      value: "office" },
  { label: "Garage",      value: "garage" },
  { label: "Hallway",     value: "hallway" },
  { label: "Utility",     value: "utility" },
  { label: "Loft",        value: "loft" },
  { label: "Garden",      value: "garden" },
  { label: "Other",       value: "other" },
];

export default function PropertyDetailScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const { session } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [coverModalVisible, setCoverModalVisible] = useState(false);
  const [coverPhotoUploading, setCoverPhotoUploading] = useState(false);

  // Add-room sheet state
  const [addRoomVisible, setAddRoomVisible] = useState(false);
  const [addRoomName, setAddRoomName] = useState("");
  const [addRoomType, setAddRoomType] = useState<string | null>(null);
  const [addRoomSaving, setAddRoomSaving] = useState(false);
  const [addRoomError, setAddRoomError] = useState<string | null>(null);
  // Optimistic local state — holds the 1-hr signed displayUrl right after upload
  // so the hero shows immediately without waiting for a query refetch + URL resolution.
  const [localCoverUrl, setLocalCoverUrl] = useState<string | null>(null);

  // Parallax hero
  const scrollY = useRef(new Animated.Value(0)).current;
  const heroTranslateY = scrollY.interpolate({
    inputRange: [0, 200],
    outputRange: [0, -40],
    extrapolate: "clamp",
  });

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
    // Always refetch when screen remounts (e.g. back-navigation) so room list
    // and cover images are current; stale cache is shown while refetching.
    staleTime: 0,
  });

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["property-items", id, session?.user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select(
          "id, file_id, room_id, name, category, estimated_price, unit_estimated_price, quantity, image_url, photo_url"
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

  // Per-room completion: items that have a photo are considered "documented".
  // Value is NOT required — the ring should reach 100% once everything is
  // photographed, which is the primary insurance-readiness signal.
  const completionMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items ?? []) {
      if (item.room_id && hasPhoto(item)) {
        map.set(item.room_id, (map.get(item.room_id) ?? 0) + 1);
      }
    }
    return map;
  }, [items]);

  const isLoading = roomsLoading || itemsLoading;

  // Signed URL for the property cover photo (path → 1-hr signed URL).
  // localCoverUrl overrides while the optimistic displayUrl is still fresh.
  const signedCoverUrl = useSignedUrl(property?.property_cover_image_url);

  // Batch-resolve room thumbnail paths → signed URLs in one round-trip.
  // Derived from `rooms` (not `stats`) so URLs start resolving as soon as
  // rooms load — before items have finished loading (which stats requires).
  // This prevents the blank-thumbnail flash when navigating back.
  const roomCoverPaths = useMemo(
    () => (rooms ?? []).map((r) => r.cover_photo_url ?? null),
    [rooms],
  );
  const roomCoverSignedUrls = useSignedUrls(roomCoverPaths);

  // Map room.id → resolved signed URL, for clean O(1) lookup in renderItem.
  const roomSignedUrlById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const r of rooms ?? []) {
      const path = r.cover_photo_url;
      map.set(r.id, path ? (roomCoverSignedUrls.get(path) ?? null) : null);
    }
    return map;
  }, [rooms, roomCoverSignedUrls]);

  const handleAddRoom = async () => {
    const trimmed = addRoomName.trim();
    if (!trimmed) {
      setAddRoomError("Room name is required.");
      return;
    }
    if (!session?.user.id) return;
    setAddRoomError(null);
    setAddRoomSaving(true);
    try {
      const { error } = await supabase.from("inventory_rooms").insert({
        file_id: id,
        user_id: session.user.id,
        name: trimmed,
        room_type: addRoomType,
        sort_order: (rooms?.length ?? 0) + 1,
      });
      if (error) {
        setAddRoomError(error.message);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["rooms", id] });
      setAddRoomVisible(false);
      setAddRoomName("");
      setAddRoomType(null);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      setAddRoomError(err instanceof Error ? err.message : "Failed to create room.");
    } finally {
      setAddRoomSaving(false);
    }
  };

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
    if (coverPhotoUploading) return;
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
      const uploaded = await uploadCoverPhoto(
        result.assets[0].uri,
        session.user.id
      );
      if (!uploaded) {
        Alert.alert("Upload failed", "Could not upload cover photo. Please try again.");
        return;
      }
      // Show immediately via the 1-hr signed URL while the DB write is in-flight.
      setLocalCoverUrl(uploaded.displayUrl);
      const { data: updatedRows, error: updateError } = await supabase
        .from("inventory_files")
        .update({ property_cover_image_url: uploaded.path })
        .eq("id", id)
        .eq("user_id", session.user.id)
        .select("id");
      if (updateError) {
        console.error("[propertyCover] DB update error:", updateError);
        setLocalCoverUrl(null);
        Alert.alert("Save failed", updateError.message);
        return;
      }
      if (!updatedRows || updatedRows.length === 0) {
        console.error("[propertyCover] DB update matched 0 rows — possible missing UPDATE RLS policy. Run supabase/migrations/add_update_policies.sql.");
        setLocalCoverUrl(null);
        Alert.alert("Save failed", "Cover photo could not be saved. Please check your connection and try again.");
        return;
      }
      // DB write confirmed — clear optimistic state and let the signed URL from
      // the freshly-invalidated property query drive the display.
      setLocalCoverUrl(null);
      // Invalidate both the property query and the cached signed URL for the new
      // path so useSignedUrl immediately re-fetches the correct signed URL.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["property", id] }),
        queryClient.invalidateQueries({ queryKey: ["signed-url", uploaded.path] }),
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
          {(localCoverUrl ?? signedCoverUrl) ? (
            <Animated.View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 240, // 40 px taller than container — room to shift up
                transform: [{ translateY: heroTranslateY }],
              }}
            >
              <Image
                source={{ uri: (localCoverUrl ?? signedCoverUrl)! }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
            </Animated.View>
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
                  First, add a cover photo
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

        {/* 3.5 — Scan hint: shown until the first item is documented */}
        {(items ?? []).length === 0 && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 2,
            }}
          >
            <Feather name="arrow-right" size={12} color={colors.primary} />
            <Text
              style={{
                fontSize: 12,
                fontFamily: "Inter_400Regular",
                color: colors.mutedForeground,
              }}
            >
              Then scan your first room to start adding items
            </Text>
          </View>
        )}

        {/* 3.6 — First-use guidance card: shown until cover photo, room, or item exists */}
        {!(localCoverUrl ?? property?.property_cover_image_url) && (rooms ?? []).length === 0 && (items ?? []).length === 0 && (
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: colors.radius,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 16,
              gap: 14,
            }}
          >
            <View style={{ gap: 4 }}>
              <Text
                style={{
                  fontSize: 15,
                  fontFamily: "Inter_600SemiBold",
                  color: colors.foreground,
                }}
              >
                Start your inventory
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: "Inter_400Regular",
                  color: colors.mutedForeground,
                  lineHeight: 19,
                }}
              >
                Add a property photo, create your first room, then scan items room by room.
              </Text>
            </View>
            {(
              [
                {
                  label: "Add a cover photo",
                  done: !!(localCoverUrl ?? property?.property_cover_image_url),
                  onPress: handlePickPropertyCover,
                },
                {
                  label: "Add your first room",
                  done: (rooms ?? []).length > 0,
                  onPress: () => {
                    setAddRoomName("");
                    setAddRoomType(null);
                    setAddRoomError(null);
                    setAddRoomVisible(true);
                  },
                },
                {
                  label: "Start an AI scan",
                  done: (items ?? []).length > 0,
                  onPress: () =>
                    router.push({
                      pathname: "/(tabs)/scan",
                      params: { fileId: id, fileName: name },
                    }),
                },
              ] as { label: string; done: boolean; onPress: () => void }[]
            ).map((stepItem, i) => (
              <Pressable
                key={i}
                onPress={stepItem.onPress}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  backgroundColor: stepItem.done ? colors.secondary : colors.background,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: stepItem.done
                    ? colors.primary + "40"
                    : colors.border,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    backgroundColor: stepItem.done ? colors.primary : "transparent",
                    borderWidth: stepItem.done ? 0 : 1.5,
                    borderColor: colors.border,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {stepItem.done ? (
                    <Feather name="check" size={14} color="#FFFFFF" />
                  ) : (
                    <Text
                      style={{
                        fontSize: 11,
                        fontFamily: "Inter_600SemiBold",
                        color: colors.mutedForeground,
                      }}
                    >
                      {i + 1}
                    </Text>
                  )}
                </View>
                <Text
                  style={{
                    flex: 1,
                    fontSize: 14,
                    fontFamily: stepItem.done ? "Inter_500Medium" : "Inter_400Regular",
                    color: stepItem.done ? colors.primary : colors.foreground,
                  }}
                >
                  {stepItem.label}
                </Text>
                {!stepItem.done && (
                  <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                )}
              </Pressable>
            ))}
          </View>
        )}

        {/* 4 — Rooms heading + add-room button */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={[styles.sectionHeading, { color: colors.foreground }]}>
            Rooms
          </Text>
          <Pressable
            onPress={() => {
              setAddRoomName("");
              setAddRoomType(null);
              setAddRoomError(null);
              setAddRoomVisible(true);
            }}
            hitSlop={10}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.secondary : colors.card,
            })}
          >
            <Feather name="plus" size={14} color={colors.primary} />
            <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: colors.primary }}>
              Add room
            </Text>
          </Pressable>
        </View>
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
        <PropertySkeleton colors={colors} />
      ) : roomsError ? (
        <ErrorState
          message="Failed to load rooms"
          detail={(roomsError as Error).message}
          onRetry={refetch}
        />
      ) : (
        <Animated.FlatList
          data={stats ? stats.roomStats : []}
          keyExtractor={(rs) => rs.room.id}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: false },
          )}
          scrollEventThrottle={16}
          renderItem={({ item: rs }) => (
            <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
              <RoomCard
                item={rs.room}
                itemCount={rs.itemCount}
                totalValue={rs.totalValue}
                maxValue={maxRoomValue}
                completedCount={completionMap.get(rs.room.id) ?? 0}
                colors={colors}
                resolvedCoverUrl={roomSignedUrlById.get(rs.room.id) ?? null}
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

      {/* ── Add Room sheet ────────────────────────────────────────────────── */}
      <Modal
        visible={addRoomVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddRoomVisible(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }}
          onPress={() => !addRoomSaving && setAddRoomVisible(false)}
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
              paddingHorizontal: 20,
              paddingTop: 16,
              paddingBottom: insets.bottom + 20,
              gap: 16,
            }}
          >
            {/* Handle */}
            <View style={{ alignItems: "center" }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
            </View>

            {/* Title row */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground }}>
                Add a room
              </Text>
              <Pressable onPress={() => setAddRoomVisible(false)} hitSlop={12} disabled={addRoomSaving}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {/* Room name */}
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground, letterSpacing: 0.3 }}>
                ROOM NAME
              </Text>
              <TextInput
                value={addRoomName}
                onChangeText={(t) => { setAddRoomName(t); setAddRoomError(null); }}
                placeholder="e.g. Master Bedroom"
                placeholderTextColor={colors.mutedForeground}
                autoFocus
                returnKeyType="done"
                style={{
                  borderWidth: 1,
                  borderColor: addRoomError ? "#B91C1C" : colors.border,
                  borderRadius: colors.radius,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  fontSize: 16,
                  fontFamily: "Inter_400Regular",
                  color: colors.foreground,
                  backgroundColor: colors.background,
                }}
              />
              {addRoomError && (
                <Text style={{ fontSize: 12, color: "#B91C1C", fontFamily: "Inter_400Regular" }}>
                  {addRoomError}
                </Text>
              )}
            </View>

            {/* Room type picker */}
            <View style={{ gap: 8 }}>
              <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground, letterSpacing: 0.3 }}>
                ROOM TYPE (optional)
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
                {ROOM_TYPE_OPTIONS.map((opt) => {
                  const active = addRoomType === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setAddRoomType(active ? null : opt.value)}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 7,
                        borderRadius: 20,
                        borderWidth: 1,
                        borderColor: active ? BRAND_TEAL : colors.border,
                        backgroundColor: active ? "#E8F5F3" : colors.card,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: active ? BRAND_DARK : colors.foreground }}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Create button */}
            <Pressable
              onPress={handleAddRoom}
              disabled={addRoomSaving || !addRoomName.trim()}
              style={({ pressed }) => ({
                paddingVertical: 14,
                borderRadius: colors.radius,
                backgroundColor: BRAND_TEAL,
                alignItems: "center",
                opacity: pressed || addRoomSaving || !addRoomName.trim() ? 0.6 : 1,
              })}
            >
              {addRoomSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" }}>
                  Create room
                </Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
    gap: 10,
  },
  insightSectionLabel: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.1,
    color: BRAND_DARK,
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
    color: "#1A2E2A",
    flex: 1,
  },
  insightMoreText: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: "#64736F",
    marginTop: 1,
  },
  insightSparkWrap: {
    backgroundColor: "#E8F5F3",
    borderRadius: 8,
    padding: 6,
    alignItems: "center",
    gap: 3,
  },
  insightSparkLabel: {
    fontSize: 8,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
    color: BRAND_DARK,
  },
  insightSubtext: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#1A2E2A",
  },
  insightPeriodWrap: {
    backgroundColor: "#F0FAF8",
    borderRadius: 8,
    padding: 10,
    gap: 8,
  },
  insightPeriodTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: BRAND_DARK,
  },
  insightPeriodRow: {
    flexDirection: "row",
    gap: 6,
  },
  insightPeriodChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: "#DDF0EC",
  },
  insightPeriodChipActive: {
    backgroundColor: BRAND_DARK,
  },
  insightPeriodChipText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: BRAND_DARK,
  },
  insightPeriodChipTextActive: {
    color: "#FFFFFF",
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
  roomThumbWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  roomThumb: { width: 72, height: 72, borderRadius: 6 },
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
