import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useTranslation } from "react-i18next";
import { useMarketStream } from "@/features/market/hooks";
import { useTheme } from "@/ui/theme";

export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  useMarketStream();
  return (
    <NativeTabs backgroundColor={colors.surface} tintColor={colors.accent} iconColor={colors.textMuted} labelStyle={{ color: colors.textMuted }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t("tabs.markets")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.line.uptrend.xyaxis" md="show_chart" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="portfolio">
        <NativeTabs.Trigger.Label>{t("tabs.portfolio")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.pie" md="pie_chart" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="copilot">
        <NativeTabs.Trigger.Label>{t("tabs.copilot")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sparkles" md="auto_awesome" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>{t("tabs.settings")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
