import { getLocales } from "expo-localization";
import { default as i18n } from "i18next";
import { initReactI18next } from "react-i18next";
import { prefs } from "@/data/storage";
import { en } from "./en";
import { hi } from "./hi";

export type Language = "en" | "hi";

const deviceLanguage = (): Language => (getLocales()[0]?.languageCode === "hi" ? "hi" : "en");

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, hi: { translation: hi } },
  lng: (prefs.getString("language") as Language | undefined) ?? deviceLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function setLanguage(language: Language) {
  prefs.set("language", language);
  void i18n.changeLanguage(language);
}

export default i18n;
