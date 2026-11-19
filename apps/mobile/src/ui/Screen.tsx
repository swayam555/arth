import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { spacing, useTheme } from "./theme";

interface Props {
  children: ReactNode;
  edges?: Edge[];
  padded?: boolean;
}

export function Screen({ children, edges = ["top", "bottom"], padded = true }: Props) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={[styles.root, padded && styles.padded]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  padded: { paddingHorizontal: spacing.lg },
});
