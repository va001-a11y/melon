/**
 * Does a reply contain something a reader could actually go and check?
 *
 * Melon warns on every reply that cites no sources. Shown on a greeting as
 * readily as on a casualty figure, that warning becomes wallpaper within a
 * day — and a warning nobody reads is not there on the reply that invents
 * something. So it is shown only where there is a specific claim to doubt.
 *
 * Numbers and dates. Deliberately NOT proper nouns: "Melon", "Groq", "React"
 * and every model name are proper nouns, so keying on them would fire on
 * nearly every reply and rebuild the problem this solves. Numbers are also
 * what the failures actually looked like — invented casualty counts, invented
 * dates, attributed to real institutions.
 *
 * Conservative by design. When the answer is unclear this returns true: a
 * warning too many costs a glance, one too few costs the reader's trust.
 */

/** Code is not a claim about the world. A port number is not a death toll. */
const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]*`/g;

/** "1." opening a numbered list is formatting, not a quantity. */
const LIST_MARKER = /^[ \t]*\d+[.)]\s/gm;

/**
 * A digit that begins a number, rather than one buried in an identifier.
 *
 * The preceding character matters: it keeps "22 bodies" and "$5" while
 * rejecting "gpt-oss-120b", "v0.2.0", "COVID-19" and URL paths, none of which
 * are quantities a reader would verify.
 */
const BARE_NUMBER = /(^|[^0-9A-Za-z._/-])\d/;

/**
 * Quantities written as words. "one" and "two" are excluded on purpose —
 * "one of the reasons" and "two ways to do this" are ordinary prose, and
 * including them would fire on most replies.
 */
const QUANTITY_WORD =
  /\b(hundreds?|thousands?|millions?|billions?|trillions?|dozens?|percent|per cent|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i;

/**
 * Month names, matched case-sensitively so the word has to be used as a name.
 * "May" is left out: as a date it almost always carries a year or a day
 * number, and as a verb it is everywhere.
 */
const MONTH = /\b(January|February|March|April|June|July|August|September|October|November|December)\b/;

export function hasCheckableClaim(text: string): boolean {
  if (!text) return false;

  const prose = text
    .replace(FENCED_CODE, " ")
    .replace(INLINE_CODE, " ")
    .replace(LIST_MARKER, "");

  return BARE_NUMBER.test(prose) || QUANTITY_WORD.test(prose) || MONTH.test(prose);
}
