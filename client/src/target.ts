/// <reference types="vite/client" />

/**
 * Which Melon this build is.
 *
 * "server"  — the desktop app. A local Node process runs the orchestrator and
 *             the browser talks to it over HTTP.
 * "browser" — the hosted build. There is no server at all: the same core runs
 *             inside the page, and requests go straight to the AI providers.
 *
 * Set at build time with VITE_MELON_TARGET=browser. Everything that differs
 * between the two lives behind this one flag, so there is no second codebase
 * to keep in step — only a handful of branches that pick a transport.
 */
export type Target = "server" | "browser";

export const TARGET: Target = import.meta.env.VITE_MELON_TARGET === "browser" ? "browser" : "server";

/** True when the orchestrator runs in this page rather than over HTTP. */
export const RUNS_LOCALLY = TARGET === "browser";
