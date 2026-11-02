/**
 * Minimal SSE / NDJSON reader over a fetch response body.
 * Yields the `data:` payload of each SSE event (SSE mode) or each
 * non-empty line (NDJSON mode).
 */
export async function* readStreamLines(
  body: ReadableStream<Uint8Array>,
  mode: "sse" | "ndjson",
  /** Called on every chunk read, keep-alive comments included. */
  onActivity?: () => void
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onActivity?.();
      buffer += decoder.decode(value, { stream: true });
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, "");
        buffer = buffer.slice(newlineIdx + 1);
        if (mode === "sse") {
          if (line.startsWith("data:")) yield line.slice(5).trimStart();
        } else if (line.trim().length > 0) {
          yield line;
        }
      }
    }
    const tail = buffer.trim();
    if (tail) {
      if (mode === "sse") {
        if (tail.startsWith("data:")) yield tail.slice(5).trimStart();
      } else {
        yield tail;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Pull a human-usable message out of whatever the endpoint returned. */
function extractMessage(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) return "";
  // Most APIs return {error: {message}} or {error: "..."} or {message}.
  try {
    const parsed = JSON.parse(trimmed);
    const msg = parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? parsed?.detail;
    if (typeof msg === "string" && msg) return msg;
  } catch {
    /* not JSON */
  }
  // An HTML page means we hit a web server, not an API.
  if (/^\s*<(!doctype|html)/i.test(trimmed)) {
    const pre = trimmed.match(/<pre>([\s\S]*?)<\/pre>/i)?.[1]?.trim();
    return pre ? `the server replied with a web page, not an API response (${pre})` : "the server replied with a web page, not an API response";
  }
  return trimmed.slice(0, 300);
}

/**
 * Whether an error is a provider refusing the reply length Melon asked for.
 * Context-window errors mention tokens too, but shortening the reply does
 * not fix those, so they are not counted.
 */
export function isOutputLimitError(text: string): boolean {
  const aboutOutput =
    /max_tokens|max_completion_tokens|max_output_tokens|maxOutputTokens|output tokens|completion tokens|\bOTPM\b/i;
  return aboutOutput.test(text) && !/context (?:length|window)|prompt is too long|input tokens/i.test(text);
}

/**
 * The reply length a provider says it allows, read from its error, when that
 * is less than what was asked. Every provider words it differently:
 *
 *   Groq       "… output tokens per minute (OTPM): Limit 1000, Requested 1351"
 *   OpenAI     "… This model supports at most 4096 completion tokens"
 *   Anthropic  "max_tokens: 10000 > 8192, which is the maximum allowed …"
 *   others     "max_tokens must be less than or equal to 8192", "… in [1, 8192]"
 *
 * Null when the error is about something else or names no usable number, so
 * the caller reports it as it came rather than guessing.
 */
export function outputLimitFrom(error: unknown, requested: number): number | null {
  const text = error instanceof Error ? error.message : String(error);
  if (!isOutputLimitError(text)) return null;
  const num = (s: string | undefined) => (s ? Number(s.replace(/,/g, "")) : NaN);
  const found =
    num(text.match(/limit[:\s]+([\d,]+)\s*,\s*requested/i)?.[1]) ||
    num(text.match(/at most ([\d,]+) (?:completion|output) tokens/i)?.[1]) ||
    num(text.match(/max_tokens:?\s*[\d,]+\s*>\s*([\d,]+)/i)?.[1]) ||
    num(text.match(/\[\s*1\s*,\s*([\d,]+)\s*\]/)?.[1]) ||
    num(
      text.match(/(?:less than or equal to|<=|≤|no (?:more|greater) than|at most|up to|maximum(?: value)? (?:is|of))\s*([\d,]+)/i)?.[1]
    );
  return Number.isFinite(found) && found >= 16 && found < requested ? found : null;
}

/**
 * Turn a failed HTTP response into an error a user can act on. Raw status
 * codes and HTML dumps are useless in a chat card; these say what to fix.
 */
export async function throwHttpError(res: Response, provider: string, url: string): Promise<never> {
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch {
    /* body unreadable */
  }
  const detail = extractMessage(bodyText);
  const looksLikeWebPage = /^\s*<(!doctype|html)/i.test(bodyText.trim());

  let hint = "";
  switch (res.status) {
    case 401:
    case 403:
      hint = "Check the API key for this agent — it looks missing, wrong, or not authorised for this model.";
      break;
    case 404:
      hint = looksLikeWebPage
        ? `Nothing is listening for this API at ${url}. Check the provider and Base URL on this agent — a base URL left over from a different provider is the usual cause.`
        : `The endpoint or model was not found. Check the model id, and that ${url} is the right Base URL for ${provider}.`;
      break;
    case 400:
      hint = "The request was rejected — usually an unknown model id for this provider.";
      break;
    case 413:
      hint =
        "The request was too big for this provider — usually a long conversation, a large attachment, or both. " +
        "Press Reset to clear this chat, start a new one, or remove the attachment.";
      break;
    case 429:
      hint = "Rate limit or quota exceeded on this provider.";
      break;
    case 500:
    case 502:
    case 503:
    case 504:
      hint = "The provider is having trouble right now. Try again shortly.";
      break;
    default:
      hint = "";
  }

  /*
   * A reply longer than this provider allows for this model. Groq sends it
   * as a 429, which read as "rate limit — wait and retry", when no amount of
   * waiting helps: the request is refused every time until it asks for less.
   */
  if (isOutputLimitError(detail)) {
    hint =
      "This provider allows shorter replies from this model than your Reply length asks for. " +
      "Lower Reply length in Settings, or use a plan with a higher limit.";
  }

  const parts = [`${provider} request failed (${res.status})`];
  if (hint) parts.push(hint);
  if (detail && !looksLikeWebPage) parts.push(`Provider said: ${detail}`);
  throw new Error(parts.join(" — "));
}

/**
 * Loopback aliases to try when a local connection is refused.
 *
 * Node's fetch resolves "localhost" through the OS resolver, which on Windows
 * usually returns IPv6 ::1 first. Ollama, LM Studio and llama.cpp bind to IPv4
 * 127.0.0.1 by default, so the connection is refused even though the server is
 * running. Trying the other family transparently fixes it.
 */
function loopbackAlternatives(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [url];
  }
  const host = parsed.hostname;
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (!isLoopback) return [url];

  const order = ["127.0.0.1", "localhost", "[::1]"];
  const out: string[] = [url];
  for (const alt of order) {
    const candidate = new URL(url);
    candidate.hostname = alt;
    const str = candidate.toString();
    if (!out.includes(str)) out.push(str);
  }
  return out;
}

function isNetworkFailure(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${(err as any).cause?.code ?? ""}` : String(err);
  return /ECONNREFUSED|fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT/i.test(msg);
}

/**
 * fetch that transparently retries the other loopback address family when a
 * local server refuses the first attempt. Returns the response plus the URL
 * that actually worked, so errors can name the right endpoint.
 */
export async function fetchLocalAware(
  url: string,
  init: RequestInit
): Promise<{ res: Response; url: string }> {
  const candidates = loopbackAlternatives(url);
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return { res: await fetch(candidate, init), url: candidate };
    } catch (err) {
      // A caller-triggered abort must not be retried against other addresses.
      if (init.signal?.aborted) throw err;
      if (!isNetworkFailure(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/** Wrap network-level failures (bad host, refused connection) usefully. */
export function describeNetworkError(err: unknown, provider: string, url: string): Error {
  const message = err instanceof Error ? `${err.message} ${(err as any).cause?.code ?? ""}` : String(err);
  if (!/ECONNREFUSED|fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT/i.test(message)) {
    return err instanceof Error ? err : new Error(message);
  }

  const isLocal = /localhost|127\.0\.0\.1|\[::1\]/.test(url);
  if (!isLocal) {
    return new Error(`Could not reach ${provider} at ${url} — check your internet connection and the Base URL.`);
  }

  const port = (() => {
    try {
      return new URL(url).port;
    } catch {
      return "";
    }
  })();

  // Melon already retried both loopback families, so this really is "not running".
  const steps =
    provider === "Ollama"
      ? `Start it, then try again:\n` +
        `  1. Check it is installed — run: ollama --version\n` +
        `  2. Start the server — run: ollama serve  (the desktop app does this too)\n` +
        `  3. Make sure the model is pulled — run: ollama list\n` +
        `  4. If Ollama runs on another machine or port, set the Base URL to match.`
      : `Start the local server, then try again. If it uses a different port, update the Base URL.`;

  return new Error(
    `Could not reach ${provider} on port ${port || "the configured port"} — nothing is listening there. ` +
      `(Melon tried both 127.0.0.1 and localhost.) ${steps}`
  );
}
