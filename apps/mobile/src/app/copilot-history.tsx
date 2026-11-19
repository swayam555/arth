import { router } from "expo-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Alert, FlatList, StyleSheet, View } from "react-native";
import { useCopilot } from "@/features/copilot/store";
import { IconButton } from "@/ui/IconButton";
import { ListRow } from "@/ui/ListRow";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { spacing } from "@/ui/theme";

export default function CopilotHistoryScreen() {
  const { t, i18n } = useTranslation();
  const sessions = useCopilot((s) => s.sessions);
  const refresh = useCopilot((s) => s.refreshSessions);
  const open = useCopilot((s) => s.open);
  const remove = useCopilot((s) => s.removeSession);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pick = (id: string) => {
    void open(id);
    router.back();
  };

  const confirmRemove = (id: string) =>
    Alert.alert(t("copilot.deleteChat"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("copilot.deleteChat"), style: "destructive", onPress: () => void remove(id).catch(() => Alert.alert(t("common.somethingWrong"))) },
    ]);

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="title" accessibilityRole="header">{t("copilot.history")}</Text>
        <IconButton glyph="✕" label={t("common.cancel")} onPress={() => router.back()} />
      </View>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        ListEmptyComponent={<Text muted>{t("copilot.historyEmpty")}</Text>}
        renderItem={({ item }) => (
          <ListRow
            title={item.title || t("copilot.newChat")}
            description={new Date(item.updatedAt).toLocaleString(i18n.language === "hi" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short" })}
            onPress={() => pick(item.id)}
            trailing={<IconButton glyph="🗑" label={t("copilot.deleteChat")} tone="danger" onPress={() => confirmRemove(item.id)} />}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md },
});
