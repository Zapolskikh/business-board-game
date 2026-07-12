import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CityPrototype from "./city/CityPrototype";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).has("city") ? <CityPrototype /> : <App />}
  </React.StrictMode>,
);
