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
  selection: SYSTEM,
  autoLight: "paper",
  autoDark: "dusk",
};

export function themeLabel(id: string): string {
  return THEMES.find((t) => t.id === id)?.label ?? id;
}

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Which palette is actually in force right now. */
export function resolveTheme(choice: ThemeChoice): string {
  if (choice.selection !== SYSTEM) return choice.selection;
  return systemPrefersDark() ? choice.autoDark : choice.autoLight;
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

/** Older builds stored a bare theme id; keep those working. */
export function migrateThemeChoice(stored: unknown): ThemeChoice {
  if (typeof stored === "string") {
    return stored === SYSTEM ? DEFAULT_THEME_CHOICE : { ...DEFAULT_THEME_CHOICE, selection: stored };
  }
  if (stored && typeof stored === "object") {
    const c = stored as Partial<ThemeChoice>;
    return {
      selection: c.selection ?? DEFAULT_THEME_CHOICE.selection,
      autoLight: c.autoLight ?? DEFAULT_THEME_CHOICE.autoLight,
      autoDark: c.autoDark ?? DEFAULT_THEME_CHOICE.autoDark,
    };
  }
  return DEFAULT_THEME_CHOICE;
}
