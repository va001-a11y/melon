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

/** Split a (possibly still-streaming) response into Detailed CoT and answer. */
export function splitCot(text: string): SplitResult {
  text = stripConclusion(text);
  const startIdx = text.indexOf(COT_START);
  if (startIdx < 0) {
    return { cot: "", answer: text, reasoningInProgress: false };
  }
  const afterStart = text.slice(startIdx + COT_START.length);
  const endIdx = afterStart.indexOf(COT_END);
  if (endIdx < 0) {
    return { cot: afterStart.trim(), answer: "", reasoningInProgress: true };
  }
  return {
    cot: afterStart.slice(0, endIdx).trim(),
    answer: afterStart.slice(endIdx + COT_END.length).trim(),
    reasoningInProgress: false,
  };
}
