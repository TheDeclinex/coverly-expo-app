import { Feather } from "@expo/vector-icons";
import React from "react";
import { FlatList, Keyboard, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { filterCountryOptions, resolveMarketConfig } from "@/constants/market-config";
import { getPricingSupportContent, PRICING_SUPPORT_TIERS } from "@/constants/pricing-support-content";
import { useColors } from "@/hooks/useColors";

export function CountrySelect({ value, onChange, label = "Country or region" }: {
  value: string;
  onChange: (countryCode: string) => void;
  label?: string;
}) {
  const colors = useColors();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [supportGuideOpen, setSupportGuideOpen] = React.useState(false);
  const market = resolveMarketConfig(value) ?? resolveMarketConfig("NZ")!;
  const options = React.useMemo(() => filterCountryOptions(query), [query]);
  const selectedSupport = getPricingSupportContent(market.pricingSupportTier);

  const closePicker = () => {
    setOpen(false);
    setQuery("");
    setSupportGuideOpen(false);
  };

  const openPicker = (showSupportGuide = false) => {
    setSupportGuideOpen(showSupportGuide);
    setOpen(true);
  };

  return <>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${market.countryName}, ${market.countryCode}, ${market.currencyCode}, ${selectedSupport.label}. ${selectedSupport.shortDescription}`}
      accessibilityHint="Opens the country or region selector"
      onPress={() => openPicker(false)}
      style={[styles.trigger, { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: colors.radius }]}
    >
      <View style={styles.copy}><Text style={[styles.name, { color: colors.foreground }]}>{market.countryName}</Text><Text style={[styles.detail, { color: colors.mutedForeground }]}>{market.countryCode} · {market.currencyCode} · {selectedSupport.label}</Text></View>
      <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
    </Pressable>
    <View style={styles.supportSummary}>
      <Text style={[styles.supportSummaryText, { color: colors.mutedForeground }]}>{selectedSupport.shortDescription}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Explain country pricing support levels"
        accessibilityHint="Opens descriptions of full pricing support, pricing preview, and manual pricing"
        hitSlop={10}
        onPress={() => openPicker(true)}
        style={styles.infoButton}
      >
        <Feather name="info" size={17} color={colors.primary} />
      </Pressable>
    </View>
    <Modal visible={open} animationType="slide" onRequestClose={closePicker}>
      <View style={[styles.modal, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>{label}</Text>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Explain pricing support levels"
              accessibilityState={{ expanded: supportGuideOpen }}
              hitSlop={8}
              onPress={() => { Keyboard.dismiss(); setSupportGuideOpen((current) => !current); }}
            >
              <Feather name="info" size={22} color={colors.primary} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Close ${label}`} hitSlop={8} onPress={closePicker}><Feather name="x" size={24} color={colors.foreground} /></Pressable>
          </View>
        </View>
        {supportGuideOpen ? (
          <View style={[styles.supportGuide, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.supportGuideTitle, { color: colors.foreground }]}>Pricing support levels</Text>
            {PRICING_SUPPORT_TIERS.map((tier) => {
              const content = getPricingSupportContent(tier);
              return (
                <View key={tier} accessible accessibilityLabel={`${content.label}. ${content.expandedDescription}`} style={styles.supportGuideItem}>
                  <Text style={[styles.supportGuideLabel, { color: colors.foreground }]}>{content.label}</Text>
                  <Text style={[styles.supportGuideDescription, { color: colors.mutedForeground }]}>{content.expandedDescription}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
        <View style={[styles.search, { backgroundColor: colors.card, borderColor: colors.border }]}><Feather name="search" size={16} color={colors.mutedForeground} /><TextInput autoFocus={!supportGuideOpen} value={query} onChangeText={setQuery} placeholder="Search country, code, or currency" placeholderTextColor={colors.mutedForeground} style={[styles.searchInput, { color: colors.foreground }]} /></View>
        <FlatList
          data={options}
          keyExtractor={(item) => item.code}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const support = getPricingSupportContent(item.supportTier);
            const selected = item.code === market.countryCode;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.label}, ${item.code}, ${item.currencyCode}, ${support.label}. ${support.shortDescription}`}
                accessibilityState={{ selected }}
                onPress={() => { onChange(item.code); closePicker(); }}
                style={[styles.option, { borderBottomColor: colors.border }]}
              >
                <View style={styles.copy}><Text style={[styles.name, { color: colors.foreground }]}>{item.label}</Text><Text style={[styles.detail, { color: colors.mutedForeground }]}>{item.code} · {item.currencyCode} · {support.label}</Text></View>
                {selected ? <Feather name="check" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  trigger: { minHeight: 52, borderWidth: 1.5, paddingHorizontal: 13, paddingVertical: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  supportSummary: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingTop: 7, paddingHorizontal: 2 },
  supportSummaryText: { flex: 1, fontSize: 12, lineHeight: 17 },
  infoButton: { width: 28, height: 28, alignItems: "center", justifyContent: "center", marginTop: -5 },
  modal: { flex: 1, paddingTop: 54, paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 18 },
  title: { fontSize: 21, fontFamily: "Inter_600SemiBold" },
  supportGuide: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10, marginBottom: 12 },
  supportGuideTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  supportGuideItem: { gap: 2 },
  supportGuideLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  supportGuideDescription: { fontSize: 11, lineHeight: 16 },
  search: { height: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 15 },
  option: { minHeight: 62, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  copy: { flex: 1, paddingRight: 12 },
  name: { fontSize: 15, fontFamily: "Inter_500Medium" },
  detail: { fontSize: 12, marginTop: 3 },
});
