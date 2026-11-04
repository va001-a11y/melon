/*
 * Deciding what to search for.
 *
 * Melon used to send the whole question as one query. Asked "what are
 * Tiamat / Argus / Khonsu / Gevurah / Drygioni? in the context of SCP?", the
 * engine returned five pages about the two best-known names, and the agents
 * said — correctly — that the results defined none of the other three, all
 * of which have pages of their own a search away.
 *
 * Cheapest first, because a model call costs the user time and money:
 *
 *   1. A list in the question ("A / B / C", "A, B and C") is split into one
 *      query per item, each carrying the question's context. Free.
 *   2. Otherwise the question is searched as before. Free.
 *   3. If no result is about a name the question asks about — none has it
 *      in its title or address — a model is asked for queries aimed at what
 *      is missing, and those are searched too. Only then is a model called.
 */

/** Words that are never the subject of a search. */
const FILLER = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "from", "by", "with", "about", "as", "into",
  "and", "or", "vs", "versus", "between", "within",
  "what", "whats", "who", "whos", "which", "where", "when", "why", "how",
  "is", "are", "was", "were", "be", "been", "do", "does", "did", "can", "could", "would", "should",
  "i", "me", "my", "you", "your", "it", "its", "this", "that", "these", "those", "they", "them", "their",
  "tell", "explain", "describe", "define", "compare", "list", "give", "please", "show", "find",
  "context", "meaning", "mean", "means", "definition", "difference", "differences", "regarding",
]);

/** Small words that can sit inside a name: "Lord of the Rings", "Leonardo da Vinci". */
const NAME_GLUE = new Set(["of", "the", "a", "an", "and", "de", "da", "la", "le", "von", "van", "del"]);

const bare = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}'’-]/gu, "");
const words = (text: string) => text.split(" ").filter(Boolean);
const endsSentence = (word: string) => /[?.!:]$/.test(word);
const tidy = (text: string) => text.replace(/^[\s"'“”‘’(]+|[\s"'“”‘’)?.!:]+$/g, "").trim();

/**
 * One query per item of a list in the question, or none when there is no
 * list. The items are what the question asks about; the rest of it, minus
 * filler, is the context each query carries — "Khonsu SCP", not "Khonsu".
 *
 * Deliberately narrow: three or more items separated by "/", "," or ";"
 * (the last may be joined by "and" or "or"), each at most four words. A
 * comma in ordinary prose rarely produces that, and when it does the cost
 * is a few extra searches, not a wrong answer.
 */
export function splitListQuery(question: string, max = 5): string[] {
  const text = question.replace(/\s+/g, " ").trim();
  let parts = text.split(/\s*[/,;]\s*/).filter(Boolean);
  if (parts.length >= 2) {
    const tail = parts[parts.length - 1].split(/\s+(?:and|or|&)\s+/i);
    if (tail.length === 2) parts = [...parts.slice(0, -1), ...tail];
  }
  if (parts.length < 3) return [];

  // The first item is the end of the first part: "what are Tiamat" → "Tiamat".
  const head = words(parts[0]);
  let start = head.length;
  while (start > 0 && head.length - start < 4 && !FILLER.has(bare(head[start - 1]))) start--;
  const prefix = head.slice(0, start);

  // The last item is the start of the last part: "Drygioni? in the context of SCP?" → "Drygioni".
  const last = words(parts[parts.length - 1]);
  let end = 0;
  while (end < last.length && end < 4 && !FILLER.has(bare(last[end]))) {
    end++;
    if (endsSentence(last[end - 1])) break;
  }
  const suffix = last.slice(end);

  const items = [head.slice(start).join(" "), ...parts.slice(1, -1), last.slice(0, end).join(" ")].map(tidy);
  // Items are names. One holding "is", "I" or "were" is a clause of prose
  // that happened to contain commas, and the whole thing is not a list.
  const notAName = (item: string) => words(item).some((w) => FILLER.has(bare(w)) && !NAME_GLUE.has(bare(w)));
  if (items.some((item) => !item || words(item).length > 4 || notAName(item))) return [];

  const context = [...prefix, ...suffix]
    .map((w) => tidy(w))
    .filter((w) => w && !FILLER.has(bare(w)))
    .slice(0, 4)
    .join(" ");

  const seen = new Set<string>();
  const queries: string[] = [];
  for (const item of items) {
    const query = context ? `${item} ${context}` : item;
    if (seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    queries.push(query);
  }
  return queries.slice(0, max);
}

/**
 * The names a question asks about: capitalised words other than the first,
 * acronyms, and anything with a digit. These are what a single search most
 * often misses, and what can be checked for in the results without a model.
 *
 * The limit, stated plainly: a question typed all in lower case has no names
 * this can see, so nothing is found missing and no model is called. That
 * errs towards the cost the user cares about.
 */
export function keyTerms(question: string): string[] {
  const terms = new Set<string>();
  const tokens = words(question.replace(/\s+/g, " ").replace(/[/,;]/g, " "));
  tokens.forEach((token, i) => {
    const word = tidy(token);
    if (word.length < 2 || FILLER.has(bare(word))) return;
    const sentenceStart = i === 0 || endsSentence(tokens[i - 1]);
    const named = /^\p{Lu}/u.test(word) && !sentenceStart;
    const acronym = /^[\p{Lu}\p{N}-]{2,}$/u.test(word);
    if (named || acronym || /\p{N}/u.test(word)) terms.add(word);
  });
  return [...terms];
}

/**
 * Terms no result is about: in no result's title or address.
 *
 * Snippets are not counted. "Gevurah" turned up in one as a passing mention
 * on a page about something else, so the search looked complete, no better
 * query was tried, and the agent had nothing real to go on. A page actually
 * about a thing almost always names it in its title or its address.
 */
export function missingTerms(terms: string[], hits: { url: string; title: string; snippet?: string }[]): string[] {
  const about = hits.map((h) => `${h.title}\n${decodeSafe(h.url)}`).join("\n").toLowerCase();
  return terms.filter((term) => !about.includes(term.toLowerCase()));
}

function decodeSafe(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

export const PLANNER_SYSTEM =
  "You write web search queries. Reply with the queries only, one per line, with no numbering, quotes or " +
  "explanation. Write one query for each thing named as missing, and include in each the context needed to " +
  "find it (the franchise, field, place or time the question is about). Write at most five.";

export function plannerPrompt(question: string, missing: string[], previousQuestion?: string): string {
  return (
    `Question: ${question}\n` +
    (previousQuestion ? `The question before it, for context: ${previousQuestion}\n` : "") +
    `A web search for this found nothing about: ${missing.join(", ")}.\n` +
    `Write search queries that would find those.`
  );
}

/**
 * Queries out of a planner's reply. Reasoning a model wrote first, in Melon's
 * markers or in <think> tags, is dropped; so is numbering, bullets and quotes.
 */
export function parsePlannedQueries(reply: string, reasoningEnd: string, max = 5): string[] {
  let text = reply.includes(reasoningEnd) ? reply.split(reasoningEnd).pop()! : reply;
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const query = tidy(line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ""));
    if (!query || query.length > 150 || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    out.push(query);
  }
  return out.slice(0, max);
}

/**
 * Several result lists as one: each list's best result first, then each
 * list's second, and so on, so every query is represented before any gets
 * a second place. Duplicates by address are dropped.
 */
export function interleaveHits<T extends { url: string }>(lists: T[][], cap: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (let rank = 0; out.length < cap && lists.some((l) => rank < l.length); rank++) {
    for (const list of lists) {
      const hit = list[rank];
      if (!hit || seen.has(hit.url)) continue;
      seen.add(hit.url);
      out.push(hit);
      if (out.length >= cap) break;
    }
  }
  return out;
}
