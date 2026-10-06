import { useEffect, useState } from "react";

/* Полный экран на телефоне.
 *
 * В браузере у альбомного телефона адресная строка и панель вкладок съедают до шестой части
 * высоты — ровно той, которой столу и так не хватает. Android умеет Fullscreen API и вдобавок
 * закрепляет ориентацию; iPhone не умеет ни того ни другого, и единственный способ убрать
 * панели Safari — добавить игру на экран «Домой». В собранном приложении (Capacitor) панелей
 * нет вовсе, и пункт меню не нужен.
 */
export type FullscreenSupport = "api" | "ios-home" | "none";

type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type LockableOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void> };

export function fullscreenSupport(): FullscreenSupport {
  if (typeof window === "undefined" || typeof document === "undefined") return "none";
  if ("Capacitor" in window) return "none";
  const doc = document as FullscreenDocument;
  if (doc.fullscreenEnabled || doc.webkitFullscreenEnabled) return "api";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
    || window.matchMedia?.("(display-mode: standalone)").matches;
  return ios && !standalone ? "ios-home" : "none";
}

function fullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export async function toggleFullscreen(): Promise<void> {
  const doc = document as FullscreenDocument;
  try {
    if (fullscreenElement()) {
      await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
      return;
    }
    const root = document.documentElement as FullscreenElement;
    await (root.requestFullscreen?.({ navigationUI: "hide" }) ?? root.webkitRequestFullscreen?.());
    // Закрепить можно только в полноэкранном режиме, и не везде: отказ — не ошибка.
    await (screen.orientation as LockableOrientation | undefined)?.lock?.("landscape");
  } catch {
    // Браузер отказал (нет жеста пользователя, запрет политики) — остаёмся как были.
  }
}

export function useIsFullscreen(): boolean {
  const [active, setActive] = useState(() => typeof document !== "undefined" && Boolean(fullscreenElement()));
  useEffect(() => {
    const update = () => setActive(Boolean(fullscreenElement()));
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
    };
  }, []);
  return active;
}
