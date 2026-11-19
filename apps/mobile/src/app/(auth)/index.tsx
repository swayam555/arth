import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { api, ApiError } from "@/data/api";
import { normalizeIndianMobile } from "@/features/auth/phone";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { spacing } from "@/ui/theme";

export default function PhoneScreen() {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const phone = normalizeIndianMobile(input);
    if (!phone) {
      setError(t("auth.invalidPhone"));
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.POST("/v1/auth/otp/request", { body: { phone } });
      router.push({ pathname: "/(auth)/otp", params: { phone } });
    } catch (e) {
      // A cooldown means a code was already sent moments ago; let the user type it.
      if (e instanceof ApiError && e.status === 429) router.push({ pathname: "/(auth)/otp", params: { phone } });
      else setError(e instanceof ApiError ? e.message : t("common.somethingWrong"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.hero}>
          <Text variant="title" accessibilityRole="header">Arth</Text>
          <Text variant="heading">{t("auth.welcome")}</Text>
          <Text muted>{t("auth.tagline")}</Text>
        </View>
        <View style={styles.form}>
          <TextField
            testID="phone-input"
            label={t("auth.phoneLabel")}
            prefix="+91"
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            maxLength={14}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={submit}
            error={error}
          />
          <Button testID="send-code" label={t("auth.sendCode")} onPress={submit} loading={sending} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: "space-between", paddingVertical: spacing.xl },
  hero: { gap: spacing.sm, marginTop: spacing.xxl },
  form: { gap: spacing.lg },
});
