import { Feather } from "@expo/vector-icons";
import React from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { filterCountryOptions, resolveMarketConfig } from "@/constants/market-config";
import { useColors } from "@/hooks/useColors";

export function CountrySelect({ value, onChange, label = "Country or region" }: {
  value: string;
  onChange: (countryCode: string) => void;
  label?: string;
}) {
  const colors = useColors();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const market = resolveMarketConfig(value) ?? resolveMarketConfig("NZ")!;
  const options = React.useMemo(() => filterCountryOptions(query), [query]);
  const selectedTier = market.pricingSupportTier === "verified" ? "Verified pricing" : market.pricingSupportTier === "preview" ? "Pricing preview" : "Manual inventory";

  return <>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => setOpen(true)}
      style={[styles.trigger, { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: colors.radius }]}
    >
      <View style={styles.copy}><Text style={[styles.name, { color: colors.foreground }]}>{market.countryName}</Text><Text style={[styles.detail, { color: colors.mutedForeground }]}>{market.countryCode} · {market.currencyCode} · {selectedTier}</Text></View>
      <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
    </Pressable>
    <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={[styles.modal, { backgroundColor: colors.background }]}>
        <View style={styles.header}><Text style={[styles.title, { color: colors.foreground }]}>{label}</Text><Pressable onPress={() => setOpen(false)}><Feather name="x" size={24} color={colors.foreground} /></Pressable></View>
        <View style={[styles.search, { backgroundColor: colors.card, borderColor: colors.border }]}><Feather name="search" size={16} color={colors.mutedForeground} /><TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Search country, code, or currency" placeholderTextColor={colors.mutedForeground} style={[styles.searchInput, { color: colors.foreground }]} /></View>
        <FlatList
          data={options}
          keyExtractor={(item) => item.code}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <Pressable onPress={() => { onChange(item.code); setOpen(false); setQuery(""); }} style={[styles.option, { borderBottomColor: colors.border }]}><View style={styles.copy}><Text style={[styles.name, { color: colors.foreground }]}>{item.label}</Text><Text style={[styles.detail, { color: colors.mutedForeground }]}>{item.code} · {item.currencyCode} · {item.supportTier === "verified" ? "Verified pricing" : item.supportTier === "preview" ? "Pricing preview" : "Manual inventory"}</Text></View>{item.code === market.countryCode ? <Feather name="check" size={18} color={colors.primary} /> : null}</Pressable>}
        />
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  trigger: { minHeight: 52, borderWidth: 1.5, paddingHorizontal: 13, paddingVertical: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modal: { flex: 1, paddingTop: 54, paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  title: { fontSize: 21, fontFamily: "Inter_600SemiBold" },
  search: { height: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 15 },
  option: { minHeight: 62, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  copy: { flex: 1, paddingRight: 12 },
  name: { fontSize: 15, fontFamily: "Inter_500Medium" },
  detail: { fontSize: 12, marginTop: 3 },
});
