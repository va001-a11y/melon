/**
 * PDF text extraction, in the browser.
 *
 * This used to be a server round trip: the page base64-encoded the file,
 * POSTed it to the local Node process, which decoded it and ran `pdf-parse`,
 * and sent the text back. That existed only because the library was Node-only
 * — the file was already sitting in the browser the whole time. Doing it here
 * removes the round trip (a 4 MB PDF became ~5.5 MB of base64 over the wire,
 * which is why the server's JSON body limit had to be 40 MB), and it means
 * the desktop and hosted builds extract text with the same code rather than
 * two libraries that would quietly disagree.
 *
 * pdfjs-dist is loaded on demand: it is by far the largest thing Melon can
 * pull in, and most sessions never attach a PDF at all.
 */

export interface PdfResult {
  ok: boolean;
  text?: string;
  pages?: number;
  message?: string;
}

/** Cached so a second PDF in the same session doesn't re-fetch the library. */
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      // Parsing happens in a worker so a large document cannot freeze the UI.
      // The ?url import lets Vite fingerprint and emit the worker as an asset,
      // which is what makes this work on a static host as well as in dev.
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export async function extractPdfText(file: File): Promise<PdfResult> {
  let pdfjs: typeof import("pdfjs-dist");
  try {
    pdfjs = await loadPdfjs();
  } catch {
    return { ok: false, message: `Could not load the PDF reader needed for “${file.name}”.` };
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data: bytes }).promise;

    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      // Items carry positioning too; only the strings matter to a model.
      const line = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (line) pages.push(line);
      page.cleanup();
    }
    const numPages = doc.numPages;
    await doc.destroy();

    const text = pages.join("\n\n").trim();
    if (!text) {
      return {
        ok: false,
        message:
          `“${file.name}” has no extractable text — it is probably a scanned image. ` +
          `Attach it as an image instead, using a model that can see pictures.`,
      };
    }
    return { ok: true, text, pages: numPages };
  } catch (err) {
    return {
      ok: false,
      message: `Could not read “${file.name}”: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
