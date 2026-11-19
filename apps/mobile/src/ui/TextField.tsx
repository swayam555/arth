import { StyleSheet, TextInput, type TextInputProps, View } from "react-native";
import { Text } from "./Text";
import { radius, spacing, useTheme } from "./theme";

interface Props extends TextInputProps {
  label: string;
  error?: string | null;
  prefix?: string;
}

export function TextField({ label, error, prefix, style, ...rest }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <Text variant="caption" muted>{label}</Text>
      <View style={[styles.box, { backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border }]}>
        {prefix ? <Text variant="mono" muted style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { color: colors.text }, style]}
          {...rest}
        />
      </View>
      {error ? <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  box: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 52 },
  prefix: { marginRight: spacing.sm },
  input: { flex: 1, fontSize: 17, fontVariant: ["tabular-nums"] },
});
