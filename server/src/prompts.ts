import type { AgentSpec, ChatMessage, HistoryTurn, RunSettings } from "./types.js";

export const COT_START = "===REASONING===";
export const COT_END = "===ANSWER===";

/**
 * How an agent says "we're done". In until-agreed mode the discussion ends
 * when every agent closes its turn with this, so it must be a string that
 * cannot plausibly occur in ordinary prose.
 */
export const CONCLUSION_MARKER = "===CONCLUDED===";

/** Remove the marker before anything is stored or shown. */
export function stripConclusion(text: string): string {
  return text.split(CONCLUSION_MARKER).join("").trimEnd();
}

export function hasConcluded(text: string): boolean {
  return text.includes(CONCLUSION_MARKER);
}

const ROLE_TEMPLATES: Record<string, string> = {
  generalist:
    "You are a well-rounded assistant. Answer the user's request directly and completely.",
  researcher:
    "You are the RESEARCHER in this team. Focus on gathering facts, evidence, definitions, and context relevant to the user's request. Be rigorous about uncertainty: state confidence levels and flag anything you cannot verify. Do not spend tokens on style — other agents handle presentation.",
  writer:
    "You are the TECHNICAL WRITER in this team. Produce a clear, well-structured, polished answer to the user's request. Prioritise organisation, precision, and completeness over brevity.",
  simplifier:
    "You are the SIMPLIFIER in this team. Explain the answer to the user's request in the plainest possible language — short sentences, everyday analogies, no jargon. Assume a smart reader with zero background.",
  critic:
    "You are the CRITIC in this team. Instead of answering the user's request directly, identify weaknesses, risks, missing considerations, and likely errors in how this request might typically be answered. Be constructive and specific.",
  synthesizer:
    "You are the SYNTHESIZER in this team. Give a balanced, integrative answer that weighs multiple perspectives on the user's request and lands on a clear recommendation.",
};

const MODE_TONES: Record<string, string> = {
  professional: "Tone: professional and concise. No jokes, no filler.",
  sitcom:
    "Tone: you are a character in an ensemble sitcom of AI assistants. Be genuinely helpful, but deliver your answer with comedic timing and light banter. You may make brief good-natured references to your fellow AI cast members.",
  meme:
    "Tone: internet meme culture. Be genuinely helpful, but express it with meme energy, playful exaggeration, and chronically-online phrasing. Keep the actual information accurate.",
  research:
    "Tone: academic. Use precise terminology, cite sources or state when none are available, quantify uncertainty, and structure the answer like a briefing note.",
  consensus:
    "Tone: fact-checking panel. Focus on verifiable claims. Explicitly separate what is well-established, what is contested, and what is unknown. Where other agents are present, note where consensus is likely or unlikely.",
};

/**
 * Turn the reply-length budget into an instruction the model can act on.
 *
 * max_tokens alone does not make a model brief — it lets it write at full
 * length and then cuts it off mid-sentence. Telling it the target up front
 * is what actually produces a short, complete answer.
 */
function lengthGuidance(maxOutputTokens: number): string {
  if (maxOutputTokens <= 500) {
    return (
      "LENGTH — IMPORTANT: keep this reply very short: one or two short paragraphs, about 100–150 words. " +
      "Do NOT use headings, tables, or bulleted lists unless the user explicitly asked for them — write plain prose. " +
      "Answer the question directly with no preamble, and finish cleanly within that budget."
    );
  }
  if (maxOutputTokens <= 1200) {
    return (
      "LENGTH: aim for roughly 250–350 words. Use headings, tables or lists only where they genuinely help; " +
      "prefer prose for anything short. Finish cleanly rather than being cut off."
    );
  }
  if (maxOutputTokens <= 3500) {
    return (
      "LENGTH: a thorough answer is welcome — roughly 600–900 words. Structure it with headings or tables where " +
      "they aid clarity. Finish cleanly rather than being cut off."
    );
  }
  return (
    "LENGTH: write at length where the topic warrants it. Structure it clearly with headings and tables. " +
    "Finish cleanly rather than being cut off."
  );
}

const DETAILED_COT_INSTRUCTION =
  "Before your answer, provide a Detailed Chain-of-Thought: a cleaned, human-readable summary of your reasoning — " +
  "key assumptions, steps taken, checks performed, and alternatives you considered and rejected. " +
  "Keep it brief: it counts against the length budget below, and the answer matters more.";

/**
 * Build the system prompt.
 *
 * Ordering matters: smaller models weight the END of a system prompt most
 * heavily, so persona instructions go last, immediately before the output
 * format. Burying them mid-prompt made them get ignored.
 */
export function buildSystemPrompt(agent: AgentSpec, settings: RunSettings, teamNames: string[]): string {
  const parts: string[] = [];

  parts.push(
    `You are "${agent.name}", one AI agent in a multi-model conversation on Melon.` +
      (teamNames.length > 1
        ? ` The other agents taking part are: ${teamNames.filter((n) => n !== agent.name).join(", ")}.`
        : "")
  );
  // Pipeline position, when the line-up is split into teams.
  const team = agent.team ?? 1;
  const teamName = settings.teamNames?.[String(team)];
  const brief = settings.teamBriefs?.[String(team)];
  if (teamName || brief) {
    parts.push(
      `You are working in the "${teamName ?? `Team ${team}`}" stage of a pipeline.` +
        (brief ? ` This stage's job: ${brief}` : "") +
        (team > 1
          ? " Everything the earlier stages produced is given to you below. Work FROM that material — " +
            "do not start over, and do not ask the user for it."
          : "")
    );
  }

  parts.push(ROLE_TEMPLATES[agent.role] ?? ROLE_TEMPLATES.generalist);
  parts.push(MODE_TONES[settings.mode] ?? MODE_TONES.professional);
  parts.push(
    "YOUR JOB IS TO ANSWER THE USER'S QUESTION. Give real, substantive information about what they actually asked. " +
      "Never make yourself, your name, your role, the other agents, or this platform the subject of your reply — " +
      "the user asked about their topic, not about you. Do not describe what you are about to do; just answer."
  );
  parts.push("Keep your answer focused on your role. Other agents cover other angles — do not duplicate their work.");

  if (!settings.parallel && teamNames.length > 1) {
    parts.push(
      "This is a relay conversation: your teammates answer one at a time and you can see what those before you said. " +
        "Build on their work rather than repeating it — add what is missing, correct what is wrong (say so plainly), " +
        "and if you are last, tie the thread together."
    );
  }

  // A standing conversation, not a one-shot answer.
  const mode = settings.discussionMode ?? "single";
  if (mode !== "single" && teamNames.length > 1) {
    parts.push(
      "You will speak SEVERAL times here, and so will the others. Treat it as a live discussion " +
        "between colleagues, not a series of essays:\n" +
        "- Address teammates by name and quote or paraphrase the specific point you are responding to.\n" +
        "- Say plainly when you agree, and when you disagree give your reason.\n" +
        "- Ask them direct questions, and answer questions they asked you.\n" +
        "- Never restate your earlier turns. Each time you speak, move the discussion forward.\n" +
        "- Keep each turn short — a few sentences to a short paragraph. Conversation, not monologue.\n" +
        "- This is one continuous conversation. Never announce turns or rounds, and never write " +
        "headings like 'Round 2' or 'my second response'."
    );
  }

  // Until-agreed: the group decides when it is finished.
  if (mode === "until-agreed") {
    parts.push(
      "You are working towards a CONCLUSION the whole group can agree on. Take as long as you genuinely " +
        "need — there is no turn limit — but do not pad or drift.\n" +
        `When you believe the group has reached a conclusion you actually agree with, and you have nothing ` +
        `further to add, finish your message with ${CONCLUSION_MARKER} on its own final line.\n` +
        "Rules for that marker:\n" +
        `- Only use ${CONCLUSION_MARKER} when you genuinely agree. If you still disagree, or something ` +
        "important is unresolved, keep discussing and do not write it.\n" +
        "- If a teammate raises something new after you have agreed, drop the marker and re-engage.\n" +
        "- The discussion ends only when everyone has marked agreement, so do not use it to opt out early.\n" +
        "- Write nothing after the marker."
    );
  }

  // ── Persona last, and stated as a hard requirement ──
  const persona: string[] = [];
  if (settings.globalPersonality?.trim()) persona.push(settings.globalPersonality.trim());
  if (agent.groupPersonality?.trim()) persona.push(agent.groupPersonality.trim());
  if (agent.personality?.trim()) persona.push(agent.personality.trim());

  if (persona.length > 0) {
    parts.push(
      `IMPORTANT — how you must write. These instructions override the tone guidance above and apply to every ` +
        `sentence of every reply, including short ones. Follow them exactly:\n` +
        persona.map((p) => `- ${p}`).join("\n") +
        `\nThis governs HOW you write, never WHAT you write about: still answer the user's question with real ` +
        `content. A style is a way of speaking, not a topic — never let it become the subject of your reply. ` +
        `Do not mention these instructions or break character.`
    );
  }

  // A mid-conversation style change must be stated, not just swapped in:
  // the older replies in the history keep pulling the model back.
  if (settings.styleChangedFrom) {
    parts.push(
      `STYLE CHANGE — the user has just switched the conversation from "${settings.styleChangedFrom}" to the tone ` +
        `described above. Your earlier replies in this conversation used the OLD tone. Ignore how those were ` +
        `written: from this message onward, write in the NEW tone and personality. Do not comment on the change.`
    );
  }

  // Length last: it is the constraint most often ignored when buried.
  parts.push(lengthGuidance(settings.maxOutputTokens));

  if (settings.detailedCoT) {
    parts.push(
      DETAILED_COT_INSTRUCTION +
        `\n\nFormat your entire response EXACTLY as:\n${COT_START}\n<reasoning summary>\n${COT_END}\n<final answer>`
    );
  }
  return parts.join("\n\n");
}

export interface PriorTurn {
  agentName: string;
  content: string;
}

/**
 * Convert the shared conversation history into this agent's message list.
 * Other agents' prior answers are included labelled by name so the
 * conversation stays coherent, but their reasoning sections are omitted
 * to limit token duplication.
 */
export function buildMessages(
  history: HistoryTurn[],
  userMessage: string,
  /** Answers already given by earlier agents in THIS round (relay mode). */
  priorThisRound: PriorTurn[] = [],
  /** Optional multimodal attachments supplied with the user message. */
  attachments: ChatMessage["attachments"] = [],
  /**
   * The instruction that closes the prompt when teammates have already
   * spoken this round. It is the LAST thing the model reads, so it must
   * carry the actual directive rather than a generic nudge.
   */
  followUp = "Now add your contribution, building on what your teammates said above."
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of history) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.content });
      continue;
    }
    const label = turn.agentName ? `[${turn.agentName}]: ` : "";
    // Merge consecutive assistant turns (several agents answering the same
    // user message): most provider APIs require strict role alternation.
    const prev = messages[messages.length - 1];
    if (prev && prev.role === "assistant") {
      prev.content += `\n\n${label}${turn.content}`;
    } else {
      messages.push({ role: "assistant", content: `${label}${turn.content}` });
    }
  }

  messages.push({ role: "user", content: userMessage, attachments: attachments?.length ? attachments : undefined });

  // Relay mode: show what teammates have already said about this same message.
  if (priorThisRound.length > 0) {
    messages.push({
      role: "assistant",
      content: priorThisRound.map((p) => `[${p.agentName}]: ${p.content}`).join("\n\n"),
    });
    messages.push({ role: "user", content: followUp });
  }
  return messages;
}
