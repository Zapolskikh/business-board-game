import React from "react";
import ReactDOM from "react-dom/client";
import App from "./online/App";
import "./styles.css";

// Галерея состояний нового интерфейса живёт на /dev. Старый UI остаётся точкой входа
// по умолчанию, пока v2 не заменит его целиком — плейтесты с людьми не останавливаются.
const isGallery = location.pathname.startsWith("/dev") || new URLSearchParams(location.search).has("dev");

const root = ReactDOM.createRoot(document.getElementById("root")!);

if (isGallery) {
  void import("./ui/dev/Gallery").then(({ Gallery }) =>
    root.render(
      <React.StrictMode>
        <Gallery />
      </React.StrictMode>,
    ),
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
