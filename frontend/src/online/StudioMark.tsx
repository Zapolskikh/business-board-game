import { useTranslation } from "react-i18next";
import logoLight from "./assets/studio-logo-light.png";

/* Логотип студии. Версия со светлой надписью — страницы вокруг игры тёмные; исходник и
 * вариант для светлого фона нарезает frontend/scripts/build-card-art.py. */
export function StudioLogo({ className = "" }: { className?: string }) {
  return <img src={logoLight} alt="Imbapewpew Studio" className={`studio-logo ${className}`} />;
}

/** Подвал страниц вокруг игры: кто её делает. */
export function StudioFooter() {
  const { t } = useTranslation();
  return (
    <footer className="studio-footer">
      <span>{t("studio.makes")}</span>
      <StudioLogo />
    </footer>
  );
}
