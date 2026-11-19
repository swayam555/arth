import { useTranslation } from "react-i18next";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { radius, spacing, useTheme } from "@/ui/theme";
import type { Citation } from "./types";

interface Props {
  citations: Citation[];
  focus: number | null;
  onClose: () => void;
}

export function CitationSheet({ citations, focus, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const ordered = focus === null ? citations : [...citations].sort((a, b) => Number(b.n === focus) - Number(a.n === focus));
  return (
    <Modal visible={focus !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t("common.cancel")} />
      <View style={[styles.sheet, { backgroundColor: colors.surface }]} testID="citation-sheet">
        <Text variant="heading" accessibilityRole="header">{t("copilot.sources")}</Text>
        <ScrollView contentContainerStyle={styles.list}>
          {ordered.map((c) => (
            <View key={c.n} style={[styles.item, { borderColor: c.n === focus ? colors.accent : colors.border }]}>
              <Text variant="caption" color={colors.accent}>{`[${c.n}] ${c.source}`}</Text>
              <Text style={styles.bold}>{c.title}</Text>
              {c.publishedAt ? <Text variant="caption" muted>{t("copilot.published", { date: c.publishedAt.slice(0, 10) })}</Text> : null}
              <Text muted numberOfLines={6}>{c.snippet}</Text>
              {c.url ? (
                <Text color={colors.accent} accessibilityRole="link" onPress={() => void Linking.openURL(c.url!)}>{t("copilot.openSource")}</Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
        <Button label={t("common.continue")} variant="secondary" onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { maxHeight: "70%", padding: spacing.lg, gap: spacing.md, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  list: { gap: spacing.md },
  item: { gap: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: spacing.md },
  bold: { fontWeight: "600" },
});
