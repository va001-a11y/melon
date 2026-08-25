import type { Attachment, ChatMessage } from "../types.js";

/**
 * Text-like attachments are folded into the message text so they work with
 * every model. Images need provider-specific blocks, handled per adapter.
 */
export function inlineTextAttachments(message: ChatMessage): string {
  const texts = (message.attachments ?? []).filter((a) => a.kind === "text");
  if (texts.length === 0) return message.content;
  const blocks = texts.map((a) => `--- attached file: ${a.name} ---\n${a.data}\n--- end of ${a.name} ---`);
  return [message.content, ...blocks].join("\n\n");
}

export function imageAttachments(message: ChatMessage): Attachment[] {
  return (message.attachments ?? []).filter((a) => a.kind === "image");
}

export function hasImages(messages: ChatMessage[]): boolean {
  return messages.some((m) => imageAttachments(m).length > 0);
}
