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
export function stripSpeakerLabel(text: string): string {
  const complete = text.replace(/^\s*\[[^\]\n]{1,60}\]:[ \t]*/, "");
  if (complete !== text) return complete;
  if (/^\s*\[[^\]\n]{0,60}$/.test(text)) return "";
  return text;
}

/** Split a (possibly still-streaming) response into Detailed CoT and answer. */
export function splitCot(text: string): SplitResult {
  text = stripConclusion(text);
  const startIdx = text.indexOf(COT_START);
  if (startIdx < 0) {
    return { cot: "", answer: stripSpeakerLabel(text), reasoningInProgress: false };
  }
  const afterStart = text.slice(startIdx + COT_START.length);
  const endIdx = afterStart.indexOf(COT_END);
  if (endIdx < 0) {
    return { cot: afterStart.trim(), answer: "", reasoningInProgress: true };
  }
  return {
    cot: afterStart.slice(0, endIdx).trim(),
    answer: stripSpeakerLabel(afterStart.slice(endIdx + COT_END.length).trim()),
    reasoningInProgress: false,
  };
}
