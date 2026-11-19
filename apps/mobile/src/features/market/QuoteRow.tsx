import { memo, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import { Text } from "@/ui/Text";
import { spacing, useTheme } from "@/ui/theme";
import { change, formatPct, formatPrice } from "./format";
import { useQuote } from "./tickStore";

interface Props {
  symbol: string;
  name: string;
  prevClose: number;
  onPress?: () => void;
  onLongPress?: () => void;
  trailing?: ReactNode;
}

const CLEAR = "rgba(0,0,0,0)";

export const QuoteRow = memo(function QuoteRow({ symbol, name, prevClose, onPress, onLongPress, trailing }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const quote = useQuote(symbol);
  const reduceMotion = useReducedMotion();
  const flash = useSharedValue(0);

  const ltp = quote?.ltp ?? prevClose;
  const base = quote?.prevClose ?? prevClose;
  const { pct } = change(ltp, base);
  const tone = pct > 0 ? colors.up : pct < 0 ? colors.down : colors.textMuted;

  useEffect(() => {
    if (!quote || quote.dir === 0 || reduceMotion) return;
    flash.value = withSequence(withTiming(quote.dir, { duration: 0 }), withTiming(0, { duration: 650 }));
  }, [quote, reduceMotion, flash]);

  const up = colors.upFlash;
  const down = colors.downFlash;
  const flashStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(flash.value, [-1, 0, 1], [down, CLEAR, up]),
  }));

  const label = t("quote.a11y", {
    name,
    price: formatPrice(ltp),
    change: formatPct(pct),
    state: quote ? "" : t("quote.delayed"),
  });

  return (
    <Pressable
      testID={`quote-${symbol}`}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
    >
      <Animated.View style={[styles.row, { borderBottomColor: colors.border }, flashStyle]}>
        <View style={styles.left}>
          <Text style={styles.symbol} numberOfLines={1}>{symbol}</Text>
          <Text variant="caption" muted numberOfLines={1}>{name}</Text>
        </View>
        <View style={styles.right}>
          <Text variant="mono" style={styles.price} color={quote ? colors.text : colors.textMuted}>{formatPrice(ltp)}</Text>
          <Text variant="caption" color={tone} style={styles.pct}>{formatPct(pct)}</Text>
        </View>
        {trailing}
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  left: { flex: 1, gap: 2 },
  right: { alignItems: "flex-end", gap: 2 },
  symbol: { fontWeight: "600" },
  price: { fontVariant: ["tabular-nums"] },
  pct: { fontVariant: ["tabular-nums"], fontWeight: "600" },
});
