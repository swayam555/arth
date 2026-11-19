import type { Schemas } from "@arth/api-client";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { api, ApiError } from "@/data/api";
import { formatIndianMobile } from "@/features/auth/phone";
import { useSession } from "@/features/auth/session";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { spacing } from "@/ui/theme";

const RESEND_SECONDS = 30;

export default function OtpScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const { t } = useTranslation();
  const completeLogin = useSession((s) => s.completeLogin);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const verify = async (value: string) => {
    setVerifying(true);
    setError(null);
    try {
      const { data } = await api.POST("/v1/auth/otp/verify", { body: { phone, code: value } });
      await completeLogin(data as Schemas["Session"]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.somethingWrong"));
      setCode("");
    } finally {
      setVerifying(false);
    }
  };

  const onChange = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void verify(digits);
  };

  const resend = async () => {
    setSecondsLeft(RESEND_SECONDS);
    await api.POST("/v1/auth/otp/request", { body: { phone } }).catch(() => undefined);
  };

  return (
    <Screen>
      <View style={styles.root}>
        <Text variant="title" accessibilityRole="header">{t("auth.otpTitle")}</Text>
        <Text muted>{t("auth.otpSent", { phone: formatIndianMobile(phone) })}</Text>
        <TextField
          testID="otp-input"
          label={t("auth.otpLabel")}
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          autoFocus
          maxLength={6}
          value={code}
          onChangeText={onChange}
          error={error}
          style={styles.code}
        />
        <Button testID="verify" label={t("auth.verify")} onPress={() => void verify(code)} loading={verifying} disabled={code.length !== 6} />
        <Button
          variant="secondary"
          label={secondsLeft > 0 ? t("auth.resendIn", { seconds: secondsLeft }) : t("auth.resend")}
          onPress={resend}
          disabled={secondsLeft > 0}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: spacing.lg, paddingTop: spacing.xxl },
  code: { letterSpacing: 8, fontSize: 24 },
});
