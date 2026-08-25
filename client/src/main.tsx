import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { DEFAULT_THEME_CHOICE, applyTheme, migrateThemeChoice } from "./themes";
import "./styles.css";

/**
 * Apply the saved theme before the first render. App does this too, but only
 * once it has mounted — so without this the recovery screen below would show
 * in the default palette rather than the one the user chose, precisely when
 * things already look broken.
 */
try {
  const raw = localStorage.getItem("melon.theme");
  applyTheme(migrateThemeChoice(raw ? JSON.parse(raw) : DEFAULT_THEME_CHOICE));
} catch {
  applyTheme(DEFAULT_THEME_CHOICE);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Outermost, so a throw anywhere below shows a recovery screen rather
        than the blank page React leaves behind by default. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
