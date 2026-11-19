import { Pressable, StyleSheet } from "react-native";
import { Text } from "./Text";
import { radius, spacing, useTheme } from "./theme";

interface Props {
  label: string;
  selected?: boolean;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
}

export function Chip({ label, selected, onPress, testID, accessibilityLabel }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? colors.accent : colors.surfaceAlt, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <Text variant="caption" style={styles.label} color={selected ? colors.onAccent : colors.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.lg, minHeight: 32, justifyContent: "center" },
  label: { fontWeight: "600" },
});
