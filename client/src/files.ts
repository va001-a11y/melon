import type { Attachment } from "./types";
import { extractPdfText } from "./pdf";

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml", "xml", "html", "htm", "css",
  "js", "jsx", "ts", "tsx", "py", "java", "c", "h", "cpp", "hpp", "cs", "go", "rs", "rb", "php",
  "sh", "bat", "ps1", "sql", "ini", "toml", "cfg", "conf", "log", "svg",
]);

/** 4 MB keeps a single attachment from blowing the context window. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export type FileKind = "image" | "text" | "pdf" | "unsupported";

export function classify(file: File): FileKind {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_MIMES.includes(file.type)) return "image";
  if (file.type === "application/pdf" || ext === "pdf") return "pdf";
  // SVG is markup — models read it better as source than as a picture.
  if (file.type.startsWith("text/") || TEXT_EXTENSIONS.has(ext)) return "text";
  return "unsupported";
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? "").split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export interface PrepareResult {
  attachment?: Attachment;
  error?: string;
}

/**
 * Turn a picked file into something a chat model can consume: images stay
 * as base64, text is read directly, PDFs are sent to the server for text
 * extraction. Anything else is refused with a clear reason.
 */
export async function prepareFile(file: File): Promise<PrepareResult> {
  if (file.size > MAX_FILE_BYTES) {
    return { error: `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 4 MB.` };
  }

  const kind = classify(file);

  if (kind === "image") {
    return {
      attachment: { name: file.name, mime: file.type, kind: "image", data: await readAsBase64(file), size: file.size },
    };
  }

  if (kind === "text") {
    const text = await readAsText(file);
    return {
      attachment: { name: file.name, mime: file.type || "text/plain", kind: "text", data: text, size: file.size },
    };
  }

  if (kind === "pdf") {
    // Extracted here rather than on a server: the file is already in the
    // browser, and this is the one path that works in both builds.
    const result = await extractPdfText(file);
    if (!result.ok || !result.text) {
      return { error: result.message ?? `Could not read “${file.name}”.` };
    }
    return {
      attachment: {
        name: file.name,
        mime: "text/plain",
        kind: "text",
        data: result.text,
        size: file.size,
      },
    };
  }

  const isAudioOrVideo = file.type.startsWith("audio/") || file.type.startsWith("video/");
  return {
    error: isAudioOrVideo
      ? `“${file.name}” is ${file.type.split("/")[0]}. Chat models cannot listen or watch — transcribe it first, then attach the text.`
      : `“${file.name}” isn't a type Melon can read. Supported: images (PNG, JPEG, GIF, WebP), PDFs, and text or code files.`,
  };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
