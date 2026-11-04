/*
 * The part of a page worth handing over.
 *
 * A page read in full was cut to its first few thousand characters, on the
 * reasoning that what matters is near the top. On a wiki it is not: the SCP
 * wiki puts its whole navigation first, and on SCP-3895 the article itself —
 * "Item #… Anomaly Class: Tiamat" — begins at character 6,200 of the text.
 * The model was given 3,000: menus, a rating widget and half a sentence. It
 * was "reading pages" and still answering from guesswork (2026-11-04).
 *
 * So a page is excerpted around what the question asks about: the passage
 * around each name, a little before and more after, since a definition
 * follows the thing it defines. Every name gets a passage before any gets a
 * second, and each name's first mention after the menus comes first — that
 * is where "Anomaly Class: Tiamat" sits, a short labelled line that a rule
 * preferring long paragraphs passed over. A name on nearly every line, like
 * "SCP" on the SCP wiki, identifies nothing and goes last. A page naming none
 * of them is read from its first real paragraph, past the short lines menus
 * are made of. Same room as before, better spent.
 */

/** Before and after a mention: a definition follows the name it defines. */
const BEFORE = 220;
const AFTER = 680;

/** A line shorter than this, alone, is a menu item or a heading rather than prose. */
const PROSE_LINE = 80;

/** A name mentioned more often than this is everywhere on the page, and finds nothing in particular. */
const COMMON = 15;

interface Mention {
  term: number;
  at: number;
}

/**
 * Page markdown as text for a model: links reduced to their words and images
 * dropped, so no address reaches it from inside a page — and none of the room
 * goes on addresses it cannot use.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]\n]*)\]\([^)]*\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Where the first real paragraph starts, past the short lines menus are made of. */
export function firstProse(text: string): number {
  let at = 0;
  for (const line of text.split("\n")) {
    if (line.trim().length >= PROSE_LINE) return at;
    at += line.length + 1;
  }
  return 0;
}

function cutAt(text: string, from: number, limit: number): string {
  const slice = text.slice(from, from + limit);
  if (from + limit >= text.length) return slice.trim();
  const sentence = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf(".\n"));
  if (sentence > limit * 0.5) return slice.slice(0, sentence + 1).trim() + " […]";
  const word = slice.lastIndexOf(" ");
  return (word > limit * 0.5 ? slice.slice(0, word) : slice).trim() + " […]";
}

/**
 * Up to `limit` characters of `text`, chosen around `terms`. Short pages are
 * returned whole.
 */
export function excerptFor(text: string, terms: string[], limit: number): string {
  if (text.length <= limit) return text;
  const wanted = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))];
  const lower = text.toLowerCase();

  const body = firstProse(text);
  const mentions: Mention[] = [];
  const counts = wanted.map(() => 0);
  wanted.forEach((term, i) => {
    const needle = term.toLowerCase();
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
      counts[i]++;
      if (counts[i] <= 20) mentions.push({ term: i, at });
    }
  });
  if (mentions.length === 0) return cutAt(text, body, limit);

  // Rarer names first; one on nearly every line last. Within a name, mentions
  // past the menus first, earliest first: the top of the article is where a
  // thing is introduced.
  // Once a rarer name is found, a common one only spends the room on whatever
  // banner or menu happens to contain it.
  const anyRare = counts.some((c) => c > 0 && c <= COMMON);
  const byTerm = wanted
    .map((_, i) => i)
    .filter((i) => counts[i] > 0 && (!anyRare || counts[i] <= COMMON))
    .sort((a, b) => Number(counts[a] > COMMON) - Number(counts[b] > COMMON) || counts[a] - counts[b])
    .map((i) =>
      mentions.filter((m) => m.term === i).sort((a, b) => Number(b.at >= body) - Number(a.at >= body) || a.at - b.at)
    );
  const order: Mention[] = [];
  for (let rank = 0; byTerm.some((list) => rank < list.length); rank++) {
    for (const list of byTerm) if (list[rank]) order.push(list[rank]);
  }

  // Take windows in that order until the room is spent, merging any that touch.
  const windows: [number, number][] = [];
  const used = () => windows.reduce((n, [a, b]) => n + (b - a), 0);
  for (const m of order) {
    // No further back than the paragraph the mention is in: reaching past it
    // picks up whatever came before, which on a wiki is a banner or the menu.
    const paragraph = text.lastIndexOf("\n\n", m.at);
    const start = Math.max(0, m.at - BEFORE, paragraph >= 0 ? paragraph + 2 : 0);
    const end = Math.min(text.length, m.at + AFTER);
    if (windows.some(([a, b]) => m.at >= a && m.at < b)) continue;
    if (used() + (end - start) > limit) {
      if (windows.length === 0) windows.push([start, Math.min(text.length, start + limit)]);
      break;
    }
    windows.push([start, end]);
    windows.sort((x, y) => x[0] - y[0]);
    for (let i = windows.length - 1; i > 0; i--) {
      if (windows[i][0] <= windows[i - 1][1]) {
        windows[i - 1][1] = Math.max(windows[i - 1][1], windows[i][1]);
        windows.splice(i, 1);
      }
    }
  }

  return windows
    .map(([a, b]) => {
      // Start at a line or word boundary, so a passage never opens mid-word.
      const lineStart = text.lastIndexOf("\n", a);
      const from = lineStart >= 0 && a - lineStart < 120 ? lineStart + 1 : text.indexOf(" ", a) + 1 || a;
      return (from > 0 ? "[…] " : "") + cutAt(text, from, b - from).replace(/ \[…\]$/, "");
    })
    .join(" […]\n\n")
    .concat(windows[windows.length - 1][1] < text.length ? " […]" : "");
}
