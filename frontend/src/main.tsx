import React from "react";
import ReactDOM from "react-dom/client";
import App from "./online/App";
import "./styles.css";

// Галерея состояний нового интерфейса живёт на /dev. Какой из двух экранов открывается
// на остальных адресах, решает App.tsx: в production старый, в dev — v2.
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
