import type { ReactNode } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { Text } from "./Text";
import { spacing, useTheme } from "./theme";

interface Props {
  title: string;
  description?: string;
  onPress?: () => void;
  value?: boolean;
  onValueChange?: (value: boolean) => void;
  switchDisabled?: boolean;
  trailing?: ReactNode;
  destructive?: boolean;
  testID?: string;
}

export function ListRow({ title, description, onPress, value, onValueChange, switchDisabled, trailing, destructive, testID }: Props) {
  const { colors } = useTheme();
  const isSwitch = onValueChange !== undefined;
  const body = (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={styles.text}>
        <Text color={destructive ? colors.danger : undefined}>{title}</Text>
        {description ? <Text variant="caption" muted>{description}</Text> : null}
      </View>
      {isSwitch ? (
        <Switch
          testID={testID}
          accessibilityLabel={title}
          value={!!value}
          disabled={switchDisabled}
          onValueChange={onValueChange}
          trackColor={{ true: colors.accent, false: colors.surfaceAlt }}
        />
      ) : (
        trailing
      )}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {body}
    </Pressable>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      {title ? <Text variant="caption" muted style={styles.sectionTitle}>{title.toUpperCase()}</Text> : null}
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  text: { flex: 1, gap: 2 },
  section: { gap: spacing.sm },
  sectionTitle: { paddingHorizontal: spacing.xs, letterSpacing: 0.6 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
});
