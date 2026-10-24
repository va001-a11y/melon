/**
 * Writing to localStorage throws when the browser's allowance is full —
 * roughly five million characters per site in Chrome, Firefox and Safari.
 * Images are stored inside chats as base64, so two ordinary phone photos are
 * enough to reach it. A throw from a save in a React effect takes the whole
 * page down to the crash screen, and the reply that triggered it, already
 * paid for, is gone. Saves therefore report failure instead of throwing, and
 * the app tells the person what is not being kept.
 */

/** True when an error from a storage write means "full", not "broken". */
export function isQuotaError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return (
    error.name === "QuotaExceededError" ||
    // Older Firefox.
    error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error.code === 22 ||
    error.code === 1014
  );
}

/** localStorage.setItem that answers whether it worked rather than throwing. */
export function trySave(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
