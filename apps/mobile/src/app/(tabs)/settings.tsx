import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { api } from "@/data/api";
import { useBiometricLock } from "@/features/auth/biometricLock";
import { formatIndianMobile } from "@/features/auth/phone";
import { useSession } from "@/features/auth/session";
import { ConsentList } from "@/features/consent/ConsentList";
import { initialDecisions, type Purpose } from "@/features/consent/purposes";
import { deleteMyAccount, exportMyData } from "@/features/settings/dataRights";
import { setLanguage, type Language } from "@/i18n";
import { ListRow, Section } from "@/ui/ListRow";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { spacing, useThemePreference, type ThemePreference } from "@/ui/theme";

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const user = useSession((s) => s.user);
  const saveConsents = useSession((s) => s.saveConsents);
  const signOut = useSession((s) => s.signOut);
  const wipeLocal = useSession((s) => s.wipeLocal);
  const preference = useThemePreference((s) => s.preference);
  const setPreference = useThemePreference((s) => s.setPreference);
  const biometric = useBiometricLock((s) => s.enabled);
  const setBiometric = useBiometricLock((s) => s.setEnabled);
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);

  const decisions = initialDecisions(user?.consents);
  const changeConsent = (p: Purpose, granted: boolean) => void saveConsents({ ...decisions, [p]: granted });

  const changeLanguage = (language: Language) => {
    setLanguage(language);
    void api.PATCH("/v1/me", { body: { locale: language } }).catch(() => undefined);
  };

  const toggleBiometric = async (enabled: boolean) => {
    const ok = await setBiometric(enabled);
    if (!ok) Alert.alert(t("settings.biometric"), t("settings.biometricUnavailable"));
  };

  const runExport = async () => {
    setBusy("export");
    try {
      await exportMyData();
    } catch {
      Alert.alert(t("common.somethingWrong"));
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = () =>
    Alert.alert(t("settings.delete"), t("settings.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.deleteAction"),
        style: "destructive",
        onPress: async () => {
          setBusy("delete");
          try {
            await deleteMyAccount();
            await wipeLocal();
          } catch {
            setBusy(null);
            Alert.alert(t("common.somethingWrong"));
          }
        },
      },
    ]);

  return (
    <Screen edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View>
          <Text variant="title" accessibilityRole="header">{t("settings.title")}</Text>
          {user ? <Text muted>{t("settings.signedInAs", { phone: formatIndianMobile(user.phone) })}</Text> : null}
        </View>

        <Section title={t("settings.appearance")}>
          <Segmented<ThemePreference>
            testID="theme"
            value={preference}
            onChange={setPreference}
            options={[
              { value: "system", label: t("settings.system") },
              { value: "light", label: t("settings.light") },
              { value: "dark", label: t("settings.dark") },
            ]}
          />
        </Section>

        <Section title={t("settings.language")}>
          <Segmented<Language>
            testID="language"
            value={i18n.language === "hi" ? "hi" : "en"}
            onChange={changeLanguage}
            options={[
              { value: "en", label: "English" },
              { value: "hi", label: "हिन्दी" },
            ]}
          />
        </Section>

        <Section title={t("settings.privacy")}>
          <ListRow testID="biometric" title={t("settings.biometric")} description={t("settings.biometricDesc")} value={biometric} onValueChange={toggleBiometric} />
          <ConsentList decisions={decisions} onChange={changeConsent} />
          <ListRow testID="privacy-notice" title={t("settings.privacyNotice")} onPress={() => router.push("/privacy")} trailing={<Text muted>›</Text>} />
          <ListRow testID="export" title={t("settings.export")} onPress={runExport} trailing={busy === "export" ? <Text muted>…</Text> : null} />
          <ListRow testID="delete-account" title={t("settings.delete")} destructive onPress={confirmDelete} />
        </Section>

        <Section>
          <ListRow testID="logout" title={t("settings.logout")} onPress={() => void signOut()} />
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingVertical: spacing.lg },
});
