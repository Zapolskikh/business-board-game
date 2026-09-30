import "i18next";
import type { resources } from "./index";

/* Ключи проверяются по русским файлам: опечатка в t("...") не соберётся. */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: (typeof resources)["ru"];
    returnNull: false;
  }
}
