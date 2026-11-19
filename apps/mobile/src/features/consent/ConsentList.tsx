import { useTranslation } from "react-i18next";
import { ListRow } from "@/ui/ListRow";
import { PURPOSES, REQUIRED, type Purpose } from "./purposes";

interface Props {
  decisions: Record<Purpose, boolean>;
  onChange: (purpose: Purpose, granted: boolean) => void;
}

export function ConsentList({ decisions, onChange }: Props) {
  const { t } = useTranslation();
  return PURPOSES.map((p) => (
    <ListRow
      key={p}
      testID={`consent-${p}`}
      title={REQUIRED.has(p) ? `${t(`consent.${p}`)} · ${t("consent.required")}` : t(`consent.${p}`)}
      description={t(`consent.${p}Desc`)}
      value={decisions[p]}
      switchDisabled={REQUIRED.has(p)}
      onValueChange={(v) => onChange(p, v)}
    />
  ));
}
