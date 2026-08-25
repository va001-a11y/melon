import type { Request, Response } from "express";

/** Types we can turn into something a chat model can actually read. */
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml", "xml", "html", "htm", "css",
  "js", "jsx", "ts", "tsx", "py", "java", "c", "h", "cpp", "hpp", "cs", "go", "rs", "rb", "php",
  "sh", "bat", "ps1", "sql", "ini", "toml", "cfg", "conf", "log", "svg",
]);

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function classifyFile(name: string, mime: string): "image" | "text" | "pdf" | "unsupported" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_MIMES.has(mime)) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  // SVG is XML — more useful to a model as source text than as an image.
  if (mime.startsWith("text/") || TEXT_EXTENSIONS.has(ext)) return "text";
  return "unsupported";
}

/**
 * Extract text from an uploaded PDF so any model can read it, including
 * ones with no document support.
 */
export async function extractPdf(req: Request, res: Response): Promise<void> {
  const base64 = typeof req.body?.data === "string" ? req.body.data : "";
  const name = typeof req.body?.name === "string" ? req.body.name : "document.pdf";
  if (!base64) {
    res.status(400).json({ error: "No PDF data supplied." });
    return;
  }
  try {
    // Imported lazily so a missing/broken optional dep can't stop the server.
    const mod: any = await import("pdf-parse");
    const parse = mod.default ?? mod.pdf ?? mod;
    const result = await parse(Buffer.from(base64, "base64"));
    const text = (result?.text ?? "").trim();
    if (!text) {
      res.json({
        ok: false,
        message: `“${name}” has no extractable text — it is probably a scanned image. Attach it as an image instead, using a model that can see pictures.`,
      });
      return;
    }
    res.json({ ok: true, text, pages: result?.numpages ?? null });
  } catch (err) {
    res.json({
      ok: false,
      message: `Could not read “${name}”: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
