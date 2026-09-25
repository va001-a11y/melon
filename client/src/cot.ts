export const COT_START = "===REASONING===";
export const COT_END = "===ANSWER===";

/** Agents end with this to signal agreement; it is machinery, never shown. */
export const CONCLUSION_MARKER = "===CONCLUDED===";

export function stripConclusion(text: string): string {
  // Hide it as soon as any prefix of it appears, so it never flickers
  // into view part-written while the response is still streaming.
  let out = text.split(CONCLUSION_MARKER).join("");
  for (let i = CONCLUSION_MARKER.length - 1; i > 0; i--) {
    const partial = CONCLUSION_MARKER.slice(0, i);
    if (out.endsWith(partial)) {
      out = out.slice(0, -partial.length);
      break;
    }
  }
  return out.trimEnd();
}

export interface SplitResult {
  cot: string;
  answer: string;
  /** True while the stream is still inside the reasoning section. */
  reasoningInProgress: boolean;
}

/**
 * Remove a speaker label the model wrote at the start of its own reply.
 *
 * History shows earlier turns as "[Agent name]: …" so agents can tell each
 * other apart, and models imitate that format on their own output. The system
 * prompt now says not to, but instructions are guidance — this makes it
 * certain. Mirrors stripSpeakerLabel in the core, applied here so a reply
 * saved by an older build is cleaned on display too.
 *
 * Also hides a half-written label mid-stream, so "[Gen" never flickers into
 * view before its closing bracket arrives.
 */
function escapeForRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove a speaker label the model wrote at the start of its own reply.
 *
 * "[Name]: …" is imitation of Melon's transcript format. "Name: …" with no
 * brackets is the worse case: models continuing a multi-speaker transcript
 * write the NEXT speaker's turn, so an agent publishes words under a
 * teammate's name — and if that teammate errored, the user reads a
 * contribution nobody made.
 *
 * The bare form is stripped only for a name actually in this run, so replies
 * legitimately opening "Note:" or "Answer:" are untouched.
 *
 * The trade-off, stated plainly: an agent literally named "Note" writing
 * "Note: …" loses that word. That is accepted, because the alternative is an
 * agent publishing under a teammate's name — which is how a user ends up
 * reading a contribution from an agent that errored and never ran.
 */
export function stripSpeakerLabel(text: string, agentNames: string[] = []): string {
  const bracketed = text.replace(/^\s*\[[^\]\n]{1,60}\]:[ \t]*/, "");
  if (bracketed !== text) return bracketed;

  for (const name of agentNames) {
    const trimmed = name?.trim();
    if (!trimmed) continue;
    const bare = new RegExp(`^\\s*${escapeForRegex(trimmed)}\\s*:[ \\t]*`, "i");
    if (bare.test(text)) return text.replace(bare, "");
  }

  if (/^\s*\[[^\]\n]{0,60}$/.test(text)) return "";
  return text;
}

/**
 * Remove a marker that is still arriving one character at a time.
 *
 * Mid-stream the answer briefly ends with "===REASO" before the rest of the
 * marker lands, which flickers Melon's own machinery into the reply.
 */
function stripTrailingPartial(text: string, marker: string): string {
  for (let i = marker.length - 1; i > 0; i--) {
    if (text.endsWith(marker.slice(0, i))) return text.slice(0, -i);
  }
  return text;
}

/**
 * Drop the single line break that belongs to the marker, not to the model.
 *
 * The format asked for is "===ANSWER===" then a newline then the answer, so
 * that newline is punctuation of Melon's own protocol. Left in, a continuation
 * resuming a broken word renders as "high-alt ...high-altitude" — a space
 * inside a word, which reads as a bug. Only one is removed: a blank line the
 * model wrote deliberately survives.
 */
function dropProtocolNewline(text: string): string {
  if (text.startsWith("\r\n")) return text.slice(2);
  if (text.startsWith("\n")) return text.slice(1);
  return text;
}

/**
 * Split a (possibly still-streaming) response into Detailed CoT and answer.
 *
 * A reply can hold MORE THAN ONE reasoning/answer pair. Continue appends the
 * new reply onto the cut-off one, and if Detailed CoT is on that second reply
 * opens with its own ===REASONING=== block. Reading only the first pair —
 * which is what this did — left every later marker sitting in the answer,
 * along with the model's private planning for the continuation. So scan the
 * whole text: every reasoning section joins the drawer, every answer section
 * joins the answer.
 *
 * Answer segments are joined with nothing between them, because the model was
 * asked to carry straight on from a sentence it left unfinished. Whatever
 * whitespace it emitted is kept as it came, rather than guessed at here.
 */
export function splitCot(text: string, agentNames: string[] = []): SplitResult {
  text = stripConclusion(text);

  const reasonings: string[] = [];
  const answers: string[] = [];
  let rest = text;
  let reasoningInProgress = false;

  for (;;) {
    const startIdx = rest.indexOf(COT_START);
    if (startIdx < 0) {
      answers.push(rest);
      break;
    }
    answers.push(rest.slice(0, startIdx));

    const afterStart = rest.slice(startIdx + COT_START.length);
    const endIdx = afterStart.indexOf(COT_END);
    if (endIdx < 0) {
      // Still inside the reasoning section: nothing after it has arrived yet.
      reasonings.push(afterStart);
      reasoningInProgress = true;
      break;
    }
    reasonings.push(afterStart.slice(0, endIdx));
    rest = dropProtocolNewline(afterStart.slice(endIdx + COT_END.length));
  }

  const answer = stripTrailingPartial(answers.join(""), COT_START).trim();

  return {
    cot: reasonings.map((r) => r.trim()).filter(Boolean).join("\n\n"),
    answer: stripSpeakerLabel(answer, agentNames),
    reasoningInProgress,
  };
}
