import type { Citation } from "../types.js";

/**
 * Collects sources as a stream arrives.
 *
 * Providers repeat the same source many times over a response — once per
 * sentence it supports, in some cases — so this de-duplicates by URL and keeps
 * the first title seen, which is usually the fullest. Order is preserved:
 * first cited, first listed, which matches how the answer reads.
 */
export class CitationCollector {
  private readonly byUrl = new Map<string, Citation>();

  add(url: unknown, title?: unknown): void {
    if (typeof url !== "string") return;
    const trimmed = url.trim();
    // Only real web links. A relative or javascript: URL here would be a bug
    // in the provider, but it would become a link in someone's browser.
    if (!/^https?:\/\//i.test(trimmed)) return;
    const existing = this.byUrl.get(trimmed);
    if (existing) {
      if (!existing.title && typeof title === "string" && title.trim()) existing.title = title.trim();
      return;
    }
    this.byUrl.set(trimmed, {
      url: trimmed,
      title: typeof title === "string" && title.trim() ? title.trim() : undefined,
    });
  }

  /** Undefined rather than an empty array, so "no search" and "search found
   *  nothing" stay distinguishable downstream. */
  list(): Citation[] | undefined {
    return this.byUrl.size > 0 ? [...this.byUrl.values()] : undefined;
  }
}
