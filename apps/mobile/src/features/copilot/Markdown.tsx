import { Fragment, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "@/ui/Text";
import { radius, spacing, useTheme } from "@/ui/theme";
import { parseMarkdown, type Span } from "./markdown";

interface Props {
  source: string;
  onCite?: (n: number) => void;
}

export function Markdown({ source, onCite }: Props) {
  const { colors } = useTheme();
  const lines = useMemo(() => parseMarkdown(source), [source]);

  const spans = (list: Span[]) =>
    list.map((s, i) =>
      s.cite !== undefined ? (
        <Text
          key={i}
          color={colors.accent}
          style={styles.cite}
          onPress={onCite ? () => onCite(s.cite!) : undefined}
          accessibilityRole="link"
          accessibilityLabel={`Source ${s.cite}`}
        >
          {s.text}
        </Text>
      ) : (
        <Text key={i} style={[s.bold && styles.bold, s.code && [styles.code, { backgroundColor: colors.surfaceAlt }]]}>
          {s.text}
        </Text>
      ),
    );

  return (
    <View style={styles.root}>
      {lines.map((l, i) => (
        <Fragment key={i}>
          {l.type === "gap" ? <View style={styles.gap} /> : null}
          {l.type === "heading" ? <Text variant="heading">{spans(l.spans)}</Text> : null}
          {l.type === "p" ? <Text>{spans(l.spans)}</Text> : null}
          {l.type === "bullet" ? (
            <View style={styles.bullet}>
              <Text muted style={styles.mark}>{l.ordinal !== undefined ? `${l.ordinal}.` : "•"}</Text>
              <Text style={styles.flex}>{spans(l.spans)}</Text>
            </View>
          ) : null}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 2 },
  gap: { height: spacing.sm },
  bold: { fontWeight: "700" },
  code: { fontFamily: "monospace", fontSize: 13, borderRadius: radius.sm },
  cite: { fontSize: 12, fontWeight: "600" },
  bullet: { flexDirection: "row", gap: spacing.sm, paddingLeft: spacing.xs },
  mark: { minWidth: 14 },
  flex: { flex: 1 },
});
