import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSession } from "@/features/auth/session";
import { initialDecisions } from "@/features/consent/purposes";
import { CitationSheet } from "@/features/copilot/CitationSheet";
import { MessageView } from "@/features/copilot/MessageView";
import { useCopilot } from "@/features/copilot/store";
import { VoiceButton } from "@/features/copilot/VoiceButton";
import { Button } from "@/ui/Button";
import { IconButton } from "@/ui/IconButton";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { radius, spacing, useTheme } from "@/ui/theme";

const SUGGESTIONS = ["copilot.suggest1", "copilot.suggest2", "copilot.suggest3", "copilot.suggest4"] as const;

export default function CopilotScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const user = useSession((s) => s.user);
  const saveConsents = useSession((s) => s.saveConsents);
  const { messages, streaming, gate, send, stop, newChat } = useCopilot();
  const [text, setText] = useState("");
  const [cite, setCite] = useState<{ msg: number; n: number } | null>(null);
  const [enabling, setEnabling] = useState(false);
  const list = useRef<FlatList>(null);
  const consented = !!user?.consents?.ai_copilot && gate !== "consent_required";

  useEffect(() => {
    if (messages.length) list.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const submit = (q = text) => {
    if (!q.trim() || streaming) return;
    setText("");
    void send(q);
  };

  const enable = async () => {
    setEnabling(true);
    try {
      await saveConsents({ ...initialDecisions(user?.consents), ai_copilot: true });
      useCopilot.setState({ gate: "ok" });
    } finally {
      setEnabling(false);
    }
  };

  if (!consented) {
    return (
      <Screen edges={["top"]}>
        <View style={styles.center} testID="copilot-consent">
          <Text variant="title" accessibilityRole="header">{t("copilot.consentTitle")}</Text>
          <Text muted style={styles.centerText}>{t("consent.ai_copilotDesc")}</Text>
          <Button testID="copilot-enable" label={t("copilot.consentAction")} loading={enabling} onPress={() => void enable()} />
        </View>
      </Screen>
    );
  }

  const citeMsg = cite ? messages[cite.msg] : undefined;

  return (
    <Screen edges={["top"]} padded={false}>
      <View style={styles.header}>
        <Text variant="title" accessibilityRole="header">{t("copilot.title")}</Text>
        <View style={styles.row}>
          <IconButton testID="copilot-history" glyph="☰" label={t("copilot.history")} onPress={() => router.push("/copilot-history")} />
          <IconButton testID="copilot-new" glyph="+" label={t("copilot.newChat")} onPress={newChat} disabled={!messages.length} />
        </View>
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <FlatList
          ref={list}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item, index }) => <MessageView message={item} onCite={(n) => setCite({ msg: index, n })} />}
          ListEmptyComponent={
            <View style={styles.empty} testID="copilot-empty">
              <Text variant="heading">{t("copilot.emptyTitle")}</Text>
              <Text muted>{t("copilot.emptyDesc")}</Text>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((k) => (
                  <Pressable
                    key={k}
                    accessibilityRole="button"
                    onPress={() => submit(t(k))}
                    style={[styles.suggestion, { borderColor: colors.border }]}
                  >
                    <Text>{t(k)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
        />
        {gate === "budget" ? <Text color={colors.danger} style={styles.banner}>{t("copilot.budget")}</Text> : null}
        <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
          <VoiceButton disabled={streaming} onText={(s) => setText((cur) => (cur ? `${cur} ${s}` : s))} />
          <TextInput
            testID="copilot-input"
            value={text}
            onChangeText={setText}
            placeholder={t("copilot.placeholder")}
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={2000}
            style={[styles.input, { color: colors.text, backgroundColor: colors.surface }]}
            accessibilityLabel={t("copilot.placeholder")}
          />
          {streaming ? (
            <IconButton testID="copilot-stop" glyph="■" label={t("copilot.stop")} onPress={stop} tone="danger" />
          ) : (
            <IconButton testID="copilot-send" glyph="↑" label={t("copilot.send")} onPress={() => submit()} disabled={!text.trim()} />
          )}
        </View>
      </KeyboardAvoidingView>
      <CitationSheet citations={citeMsg?.citations ?? []} focus={citeMsg ? cite!.n : null} onClose={() => setCite(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  row: { flexDirection: "row", gap: spacing.sm },
  list: { padding: spacing.lg, gap: spacing.lg, flexGrow: 1 },
  empty: { gap: spacing.sm, paddingTop: spacing.xl },
  suggestions: { gap: spacing.sm, marginTop: spacing.md },
  suggestion: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: spacing.md },
  banner: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 15 },
  center: { flex: 1, justifyContent: "center", gap: spacing.lg },
  centerText: { lineHeight: 21 },
});
