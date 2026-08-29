export interface Theme {
  id: string;
  label: string;
  description: string;
  base: "light" | "dark";
}

/** Every concrete palette. "Match my system" is a pairing, not a palette. */
export const THEMES: Theme[] = [
  { id: "paper", label: "Paper", description: "Warm off-white, easy on the eyes", base: "light" },
  { id: "mist", label: "Mist", description: "Cool grey-blue daylight", base: "light" },
  { id: "sepia", label: "Sepia", description: "Soft amber, gentlest for long reads", base: "light" },
  { id: "dusk", label: "Dusk", description: "Warm dark brown, low glare", base: "dark" },
  { id: "ink", label: "Ink", description: "Deep neutral dark", base: "dark" },
  { id: "contrast", label: "High contrast", description: "Maximum legibility", base: "dark" },
];

export const LIGHT_THEMES = THEMES.filter((t) => t.base === "light");
export const DARK_THEMES = THEMES.filter((t) => t.base === "dark");

export const SYSTEM = "system";

/**
 * What the user picked. When `selection` is "system" the app follows the
 * device, using the two palettes they chose for day and night — so matching
 * the system is a real choice rather than a duplicate of a fixed theme.
 */
export interface ThemeChoice {
  selection: string;
  autoLight: string;
  autoDark: string;
}

export const DEFAULT_THEME_CHOICE: ThemeChoice = {
  selection: "paper",
  autoLight: "paper",
  autoDark: "dusk",
};

export function themeLabel(id: string): string {
  return THEMES.find((t) => t.id === id)?.label ?? id;
}

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Which palette is in force. Anything unrecognised — including the retired
 * "system" selection — falls back to a real palette, so `data-theme` can never
 * name a block that does not exist in the stylesheet.
 */
export function resolveTheme(choice: ThemeChoice): string {
  return THEMES.some((t) => t.id === choice.selection) ? choice.selection : DEFAULT_THEME_CHOICE.selection;
}

/** Apply it. data-theme is always set, so there is no implicit fallback. */
export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.setAttribute("data-theme", resolveTheme(choice));
}

/** Notify when the device switches between light and dark. */
export function watchSystemScheme(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Bring a stored choice up to date.
 *
 * Two migrations. Older builds stored a bare theme id rather than an object.
 * And "Match my system" has been retired — it depended on the browser
 * reporting the OS preference correctly, which on Windows means a different
 * setting from the one most people change, so it silently disagreed with the
 * device and could not be explained without a paragraph of trivia.
 *
 * A stored "system" is resolved ONCE against what the device says right now
 * and written back as that concrete palette, so the user keeps the appearance
 * they already had instead of being snapped to a default.
 */
export function migrateThemeChoice(stored: unknown): ThemeChoice {
  const asChoice = (c: Partial<ThemeChoice>): ThemeChoice => ({
    selection: c.selection ?? DEFAULT_THEME_CHOICE.selection,
    autoLight: c.autoLight ?? DEFAULT_THEME_CHOICE.autoLight,
    autoDark: c.autoDark ?? DEFAULT_THEME_CHOICE.autoDark,
  });

  const settled = (c: ThemeChoice): ThemeChoice =>
    c.selection === SYSTEM
      ? { ...c, selection: systemPrefersDark() ? c.autoDark : c.autoLight }
      : c;

  if (typeof stored === "string") {
    return settled(asChoice(stored === SYSTEM ? {} : { selection: stored }));
  }
  if (stored && typeof stored === "object") {
    return settled(asChoice(stored as Partial<ThemeChoice>));
  }
  return DEFAULT_THEME_CHOICE;
}
