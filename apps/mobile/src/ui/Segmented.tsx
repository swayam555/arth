import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { radius, spacing, useTheme } from "./theme";

interface Props<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  testID?: string;
}

export function Segmented<T extends string>({ options, value, onChange, testID }: Props<T>) {
  const { colors } = useTheme();
  return (
    <View testID={testID} accessibilityRole="radiogroup" style={[styles.wrap, { backgroundColor: colors.surfaceAlt }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={testID ? `${testID}-${o.value}` : undefined}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[styles.item, selected && { backgroundColor: colors.surface }]}
          >
            <Text variant="caption" style={styles.label} color={selected ? colors.text : colors.textMuted}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", borderRadius: radius.md, padding: 3, margin: spacing.md },
  item: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: "center" },
  label: { fontWeight: "600" },
});
