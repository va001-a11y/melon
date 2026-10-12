/*
 * Secret-scrubbing shared by everything that writes a file out of Melon.
 *
 * It lives on its own rather than beside either caller: preset export and
 * full backups both need it, and a pure function should not have to import a
 * React component -- which would pull the whole API layer in with it -- to
 * strip a query string.
 */

/**
 * A base URL can itself carry a secret: several APIs accept `?key=...`, and a
 * custom endpoint may embed `user:pass@`. Keep only scheme, host and path.
 */
export function sanitiseBaseUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    // Not parseable as a URL: drop anything after a "?" as a precaution.
    return url.split("?")[0].split("#")[0];
  }
}
