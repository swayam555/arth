import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { formatPct } from "@/features/market/format";
import { Text } from "@/ui/Text";
import { radius, spacing, useTheme, type Colors } from "@/ui/theme";
import { useTodayDigest } from "./queries";
import type { Digest, DigestItem } from "./types";

export function DigestCard() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { data } = useTodayDigest();
  const digest = data?.digest;
  if (!digest || digest.items.length === 0) return null;
  const open = () => (digest.phase === "final" ? router.push({ pathname: "/digest/[date]", params: { date: digest.forDate } }) : undefined);
  return (
    <Pressable
      testID="digest-card"
      onPress={open}
      disabled={digest.phase !== "final"}
      accessibilityRole={digest.phase === "final" ? "button" : "summary"}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.head}>
        <Text variant="caption" muted>{digest.phase === "live" ? t("digest.live") : t("digest.final", { date: digest.forDate })}</Text>
      </View>
      <Text variant="heading">{digest.title}</Text>
      {digest.items.map((i) => (
        <ItemLine key={i.symbol} item={i} colors={colors} />
      ))}
    </Pressable>
  );
}

export function ItemLine({ item, colors }: { item: DigestItem; colors: Colors }) {
  return (
    <View style={styles.item}>
      <View style={[styles.bar, { width: `${Math.max(4, Math.round(item.share * 100))}%`, backgroundColor: item.dayChange >= 0 ? colors.up : colors.down }]} />
      <Text variant="caption">{item.text}</Text>
    </View>
  );
}

export function digestA11y(d: Digest): string {
  return [d.title, ...d.items.map((i) => `${i.symbol} ${formatPct(i.dayChangePct)}`)].join(". ");
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: "row", justifyContent: "space-between" },
  item: { gap: 4 },
  bar: { height: 4, borderRadius: 2 },
});
