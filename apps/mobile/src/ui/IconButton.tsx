import { Pressable, StyleSheet } from "react-native";
import { Text } from "./Text";
import { radius, useTheme } from "./theme";

interface Props {
  glyph: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
  testID?: string;
}

export function IconButton({ glyph, label, onPress, disabled, tone = "default", testID }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.btn, { backgroundColor: colors.surfaceAlt, opacity: disabled ? 0.35 : pressed ? 0.7 : 1 }]}
    >
      <Text color={tone === "danger" ? colors.danger : colors.text} style={styles.glyph}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 36, height: 36, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  glyph: { fontSize: 16, fontWeight: "700" },
});
