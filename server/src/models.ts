import type { Request, Response } from "express";
import type { AgentSpec } from "@melon/core";
import { listModelsFor, testAgentConnection } from "@melon/core";

/*
 * HTTP wrappers, nothing more. The work is in the core so the hosted build,
 * which has no server to call, runs exactly the same code in the page.
 */

export async function listModels(req: Request, res: Response): Promise<void> {
  res.json(await listModelsFor(req.body as AgentSpec));
}

export async function testAgent(req: Request, res: Response): Promise<void> {
  res.json(await testAgentConnection(req.body as AgentSpec));
}
