import type { AgentSpec, ProviderAdapter } from "../types.js";
import { getProvider } from "../catalog.js";
import type { Protocol } from "../catalog.js";
import { anthropic } from "./anthropic.js";
import { openai } from "./openai.js";
import { google } from "./google.js";
import { ollama } from "./ollama.js";
import { demo } from "./demo.js";

const byProtocol: Record<Protocol, ProviderAdapter> = {
  anthropic,
  openai,
  google,
  ollama,
  demo,
};

export interface ResolvedTarget {
  adapter: ProviderAdapter;
  baseUrl: string | undefined;
  label: string;
  protocol: Protocol;
  needsKey: boolean;
}

/**
 * Resolve an agent to the adapter, endpoint and label to use. The catalog's
 * base URL wins for hosted providers so a stale URL left over from another
 * provider can never be sent to the wrong service.
 */
export function resolveTarget(agent: AgentSpec): ResolvedTarget {
  const def = getProvider(agent.provider);
  if (!def) throw new Error(`Unknown provider "${agent.provider}". Re-select it in this agent's properties.`);

  const custom = agent.baseUrl?.trim();
  const baseUrl = def.editableBaseUrl ? custom || def.baseUrl : def.baseUrl;

  if (def.editableBaseUrl && !baseUrl) {
    throw new Error(`${def.label} needs a Base URL — add one in this agent's properties.`);
  }
  return {
    adapter: byProtocol[def.protocol],
    baseUrl,
    label: def.label,
    protocol: def.protocol,
    needsKey: def.needsKey,
  };
}
