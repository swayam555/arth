import { Text as RNText, type TextProps, StyleSheet } from "react-native";
import { useTheme } from "./theme";

type Variant = "title" | "heading" | "body" | "caption" | "mono";

interface Props extends TextProps {
  variant?: Variant;
  muted?: boolean;
  color?: string;
}

export function Text({ variant = "body", muted, color, style, ...rest }: Props) {
  const { colors } = useTheme();
  return (
    <RNText
      {...rest}
      style={[styles[variant], { color: color ?? (muted ? colors.textMuted : colors.text) }, style]}
    />
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.4 },
  heading: { fontSize: 18, fontWeight: "600" },
  body: { fontSize: 15 },
  caption: { fontSize: 12 },
  mono: { fontSize: 15, fontVariant: ["tabular-nums"] },
});
