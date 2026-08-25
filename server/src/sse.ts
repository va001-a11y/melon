import type { Response } from "express";
import type { RunSink } from "@melon/core";

/**
 * Adapts an Express response into the `RunSink` the orchestrator emits
 * through. This is the entirety of what the HTTP transport contributes to a
 * run — everything else about how agents take turns lives in the core, which
 * is what lets the same orchestrator drive a browser build with no server.
 */
export function sseSink(res: Response): RunSink {
  return {
    send(event, data) {
      // Writing to a finished response throws; a client that navigated away
      // mid-run is ordinary, not exceptional.
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (res.writableEnded) return;
      res.end();
    },
    onClose(handler) {
      res.on("close", handler);
    },
  };
}
