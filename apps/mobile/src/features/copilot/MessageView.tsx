import { memo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Text } from "@/ui/Text";
import { radius, spacing, useTheme } from "@/ui/theme";
import { BlockView } from "./Blocks";
import { Markdown } from "./Markdown";
import type { ChatMessage } from "./types";

interface Props {
  message: ChatMessage;
  onCite: (n: number) => void;
}

function errorText(t: TFunction, m: ChatMessage): string {
  const code = m.error?.code ?? "unknown";
  if (code === "offline") return t("copilot.offline");
  if (code === "stream_interrupted") return t("copilot.interrupted");
  return m.error?.message && m.error.message !== code ? m.error.message : t("copilot.failed", { code });
}

export const MessageView = memo(function MessageView({ message: m, onCite }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  if (m.role === "user") {
    return (
      <View style={[styles.user, { backgroundColor: colors.accent }]} testID="msg-user">
        <Text color={colors.onAccent}>{m.content}</Text>
      </View>
    );
  }

  const waiting = m.status === "streaming" && !m.content && !m.blocks.length;
  return (
    <View style={styles.assistant} testID={`msg-assistant-${m.status}`}>
      {waiting ? (
        <View style={styles.row}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text muted>{m.tools?.length ? t("copilot.working") : t("copilot.thinking")}</Text>
        </View>
      ) : null}
      {m.content ? <Markdown source={m.content} onCite={m.citations.length ? onCite : undefined} /> : null}
      {m.blocks.map((b, i) => (
        <BlockView key={`${b.kind}-${i}`} block={b} />
      ))}
      {m.citations.length ? (
        <View style={styles.cites}>
          {m.citations.map((c) => (
            <Text
              key={c.n}
              variant="caption"
              onPress={() => onCite(c.n)}
              accessibilityRole="button"
              style={[styles.citeChip, { backgroundColor: colors.surfaceAlt }]}
              numberOfLines={1}
            >
              {`[${c.n}] ${c.source}`}
            </Text>
          ))}
        </View>
      ) : null}
      {m.status === "error" ? <Text color={colors.danger}>{errorText(t, m)}</Text> : null}
      {m.status === "stopped" ? <Text variant="caption" muted>{t("copilot.stopped")}</Text> : null}
      {m.piiMasked?.length ? <Text variant="caption" muted>{t("copilot.piiMasked", { items: m.piiMasked.join(", ") })}</Text> : null}
      {m.done && !m.done.grounded ? <Text variant="caption" color={colors.danger}>{t("copilot.ungrounded")}</Text> : null}
      {m.done ? (
        <Text variant="caption" muted testID="disclaimer">
          {m.done.cached ? `${t("copilot.cached")} · ${m.done.disclaimer}` : m.done.disclaimer}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  user: { alignSelf: "flex-end", maxWidth: "85%", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
  assistant: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cites: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  citeChip: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm, maxWidth: 220, overflow: "hidden" },
});
