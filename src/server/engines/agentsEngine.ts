/**
 * @module agentsEngine
 * @description
 * Engine 7/7 — P3 Specialized Multi-Agent Autonomous Orchestrator (TypeScript Server Module).
 *
 * RESPONSIBILITIES:
 * 1. Define the 7 sequential agent execution steps (`ArchitectAgent` -> `3DGenerationAgent` ->
 *    `AssetEngineAgent` -> `WorldBuilderAgent` -> `LuauScripterAgent` -> `UIEngineAgent` ->
 *    `RojoBridgeAgent`).
 * 2. Provide deterministic system naming and artifact path conventions for autonomous missions.
 */

export interface AgentStepEvent {
  type: 'agent_step';
  agent_id: string;
  status: 'running' | 'completed';
  message: string;
  artifact?: string;
}

export function deriveCleanSystemName(missionPrompt: string): string {
  const words = String(missionPrompt || 'ForgeSystem')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return words.join('') || 'ForgeOrbitalSystem';
}
