import { useTranslation } from "react-i18next";
import { LANGUAGES, useLanguage, type Language } from "./index";

/* Выбор языка. Обычный select: доступен с клавиатуры, на телефоне открывает родной список,
 * а языков всего три. Названия языков — на самих языках: человек ищет «Čeština», а не «Czech». */
export function LanguagePicker({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const { t } = useTranslation();
  const [language, setLanguage] = useLanguage();
  return (
    <label className={`language-picker ${className}`} title={t("language.label")}>
      <span aria-hidden="true">🌐</span>
      <select
        aria-label={t("language.label")}
        value={language}
        onChange={event => setLanguage(event.target.value as Language)}
      >
        {LANGUAGES.map(item => (
          <option key={item.id} value={item.id}>
            {compact ? item.short : item.title}
          </option>
        ))}
      </select>
    </label>
  );
}
