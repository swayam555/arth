import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet } from "react-native";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { spacing } from "@/ui/theme";

export default function PrivacyScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="title" accessibilityRole="header">{t("privacy.title")}</Text>
        <Text style={styles.body}>{t("privacy.body")}</Text>
      </ScrollView>
      <Button label={t("common.continue")} onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingVertical: spacing.xl },
  body: { lineHeight: 22 },
});
