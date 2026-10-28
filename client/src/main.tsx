import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { initChatStore } from "./chatStore";
import { readVault } from "./vault";
import { Unlock } from "./Unlock";
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

/** The open chat's id, read the way App reads it, so it can be loaded before the first render. */
function currentChatId(): string {
  try {
    const raw = localStorage.getItem("melon.currentChat");
    const id = raw ? JSON.parse(raw) : "";
    return typeof id === "string" ? id : "";
  } catch {
    return "";
  }
}

/*
 * Chats are read from IndexedDB, which only answers asynchronously, so the
 * store is opened — and any chats an older Melon left in localStorage moved
 * into it — before the first render. It takes milliseconds, and it means App
 * starts with the open chat already in hand rather than flashing empty.
 */
void initChatStore(currentChatId()).then(() => {
  const root = ReactDOM.createRoot(document.getElementById("root")!);
  const start = () =>
    root.render(
      <React.StrictMode>
        {/* Outermost, so a throw anywhere below shows a recovery screen rather
            than the blank page React leaves behind by default. */}
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>
    );

  /*
   * With the passphrase lock on, App does not start until the keys are
   * unlocked or deliberately given up — so nothing can run on missing keys,
   * and App's first render already holds them.
   */
  const locked = readVault();
  if (locked) {
    root.render(
      <React.StrictMode>
        <Unlock record={locked} onDone={start} />
      </React.StrictMode>
    );
  } else {
    start();
  }
});
