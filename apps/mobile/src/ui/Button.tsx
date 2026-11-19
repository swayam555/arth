import { ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { Text } from "./Text";
import { radius, spacing, useTheme } from "./theme";

interface Props {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function Button({ label, onPress, variant = "primary", loading, disabled, testID }: Props) {
  const { colors } = useTheme();
  const background = variant === "primary" ? colors.accent : variant === "danger" ? colors.danger : colors.surfaceAlt;
  const foreground = variant === "secondary" ? colors.text : colors.onAccent;
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: background, opacity: inactive ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? <ActivityIndicator color={foreground} /> : <Text style={styles.label} color={foreground}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 50, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  label: { fontWeight: "600", fontSize: 16 },
});
