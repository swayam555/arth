import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, View } from "react-native";
import { ConsentList } from "@/features/consent/ConsentList";
import { initialDecisions } from "@/features/consent/purposes";
import { useSession } from "@/features/auth/session";
import { Button } from "@/ui/Button";
import { Section } from "@/ui/ListRow";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { spacing, useTheme } from "@/ui/theme";

export default function ConsentScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const user = useSession((s) => s.user);
  const saveConsents = useSession((s) => s.saveConsents);
  const [decisions, setDecisions] = useState(() => initialDecisions(user?.consents));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveConsents(decisions);
    } catch {
      setError(t("common.somethingWrong"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="title" accessibilityRole="header">{t("consent.title")}</Text>
        <Text muted>{t("consent.intro")}</Text>
        <Section title={t("settings.consents")}>
          <ConsentList decisions={decisions} onChange={(p, v) => setDecisions((d) => ({ ...d, [p]: v }))} />
        </Section>
        <Text variant="caption" muted onPress={() => router.push("/privacy")} accessibilityRole="link">
          {t("settings.privacyNotice")} ›
        </Text>
      </ScrollView>
      <View style={styles.footer}>
        {error ? <Text color={colors.danger}>{error}</Text> : null}
        <Button testID="consent-accept" label={t("consent.accept")} onPress={accept} loading={saving} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingVertical: spacing.xl },
  footer: { gap: spacing.sm, paddingVertical: spacing.lg },
});
