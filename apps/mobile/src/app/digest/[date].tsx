import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { digestA11y, ItemLine } from "@/features/digest/DigestCard";
import { useDigest } from "@/features/digest/queries";
import { isIsoDate } from "@/features/digest/types";
import { formatInr, formatSignedInr } from "@/features/portfolio/labels";
import { formatPct } from "@/features/market/format";
import { Button } from "@/ui/Button";
import { IconButton } from "@/ui/IconButton";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { radius, spacing, useTheme } from "@/ui/theme";

export default function DigestScreen() {
  const { date = "" } = useLocalSearchParams<{ date: string }>();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { data: digest, isLoading, isError, refetch } = useDigest(date);
  const tone = (n: number) => (n > 0 ? colors.up : n < 0 ? colors.down : colors.textMuted);

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton testID="digest-back" glyph="‹" label={t("instrument.back")} onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        <Text variant="heading" accessibilityRole="header">{t("digest.title", { date })}</Text>
      </View>
      {!isIsoDate(date) ? (
        <Text muted>{t("digest.notFound")}</Text>
      ) : isLoading ? (
        <ActivityIndicator color={colors.textMuted} />
      ) : isError ? (
        <View style={styles.center}>
          <Text muted>{t("common.somethingWrong")}</Text>
          <Button label={t("common.retry")} variant="secondary" onPress={() => void refetch()} />
        </View>
      ) : !digest ? (
        <Text testID="digest-missing" muted>{t("digest.notFound")}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View testID="digest-detail" accessible accessibilityLabel={digestA11y(digest)} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text variant="title">{digest.title}</Text>
            <Text color={tone(digest.dayChange)}>
              {formatSignedInr(digest.dayChange)}
              {digest.dayChangePct === null ? "" : ` (${formatPct(digest.dayChangePct)})`}
            </Text>
            <Text variant="caption" muted>{t("digest.value", { value: formatInr(digest.value) })}</Text>
          </View>
          {digest.items.length ? (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text variant="heading">{t("digest.drivers")}</Text>
              {digest.items.map((i) => (
                <ItemLine key={i.symbol} item={i} colors={colors} />
              ))}
            </View>
          ) : (
            <Text muted>{digest.body}</Text>
          )}
          <Text variant="caption" muted>{digest.disclaimer}</Text>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingBottom: spacing.md },
  body: { gap: spacing.md, paddingBottom: spacing.xxl },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  center: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl },
});
