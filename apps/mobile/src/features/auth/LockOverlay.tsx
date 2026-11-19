import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { spacing, useTheme } from "@/ui/theme";
import { useBiometricLock } from "./biometricLock";

export function LockOverlay() {
  const locked = useBiometricLock((s) => s.locked);
  const unlock = useBiometricLock((s) => s.unlock);
  const { colors } = useTheme();
  const { t } = useTranslation();

  useEffect(() => {
    if (locked) void unlock(t("lock.reason"));
  }, [locked, unlock, t]);

  if (!locked) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: colors.bg }]} accessibilityViewIsModal>
      <Text variant="heading">{t("lock.title")}</Text>
      <Button label={t("lock.unlock")} onPress={() => void unlock(t("lock.reason"))} testID="unlock" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "stretch", justifyContent: "center", gap: spacing.xl, padding: spacing.xl },
});
