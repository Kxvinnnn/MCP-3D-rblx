import React, { useState, useEffect } from 'react';
import {
  Cpu,
  Box,
  Layers,
  FileCode2,
  Palette,
  Compass,
  Share2,
  CheckCircle2,
  Play,
  Sparkles,
  FolderSync,
  Terminal,
  ArrowRight,
  Wrench,
  Eye,
} from 'lucide-react';

interface EngineDescriptor {
  id: string;
  name: string;
  pythonModule: string;
  tsModule: string;
  responsibility: string;
  endpoints: string[];
  status: string;
}

interface RoadmapMilestone {
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  outcome: string;
  engineId: string;
  completed: boolean;
}

interface SpecializedAgentSpec {
  id: string;
  name: string;
  engine: string;
  role: string;
  outputArtifact: string;
}

interface AgentExecutionState {
  status: 'idle' | 'running' | 'completed';
  message?: string;
  artifact?: string;
}

interface DomainPrunerStat {
  domain: string;
  includedSections: string[];
  originalChars: number;
  prunedChars: number;
  reductionPercent: number;
}

export const ModularArchitectureAndAgents: React.FC = () => {
  const [engines, setEngines] = useState<EngineDescriptor[]>([]);
  const [roadmap, setRoadmap] = useState<RoadmapMilestone[]>([]);
  const [agents, setAgents] = useState<SpecializedAgentSpec[]>([]);
  const [domainPrunerStats, setDomainPrunerStats] = useState<DomainPrunerStat[]>([]);

  // P3 Specialized Agents Orchestrator State
  const [missionPrompt, setMissionPrompt] = useState<string>(
    'Torreta Defensiva de Plasma MK-V con escudo energético, escenario orbital nocturno, controlador Server --!strict con Maid y HUD táctico con ViewportFrame 3D.'
  );
  const [selectedBiome, setSelectedBiome] = useState<
    'CyberpunkOrbital' | 'MedievalForge' | 'ArcticResearchBase'
  >('CyberpunkOrbital');
  const [isOrchestrating, setIsOrchestrating] = useState<boolean>(false);
  const [agentStates, setAgentStates] = useState<Record<string, AgentExecutionState>>({});
  const [orchestrationSummary, setOrchestrationSummary] = useState<{
    system_name: string;
    files_written: string[];
    total_synced_files: number;
  } | null>(null);

  // P2 World Engine Composer State
  const [worldSceneName, setWorldSceneName] = useState<string>('OrbitalCommandSector');
  const [worldPlacedAssets, setWorldPlacedAssets] = useState<string[]>([
    'PlasmaTurretMK4',
    'CryoStasisChamber',
    'RunicBlacksmithForge',
  ]);
  const [worldGeneratedLuau, setWorldGeneratedLuau] = useState<string>('');
  const [worldSavedPath, setWorldSavedPath] = useState<string | null>(null);
  const [buildingWorld, setBuildingWorld] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/v1/architecture')
      .then((res) => res.json())
      .then((data) => {
        if (data.engines) setEngines(data.engines);
        if (data.roadmap) setRoadmap(data.roadmap);
        if (data.agents) setAgents(data.agents);
        if (data.domain_pruner_stats) setDomainPrunerStats(data.domain_pruner_stats);
      })
      .catch((err) => console.error('Error loading architecture manifest:', err));
  }, []);

  const handleRunSpecializedAgents = async () => {
    if (!missionPrompt.trim() || isOrchestrating) return;
    setIsOrchestrating(true);
    setOrchestrationSummary(null);

    const initialStates: Record<string, AgentExecutionState> = {};
    agents.forEach((a) => {
      initialStates[a.id] = { status: 'idle' };
    });
    setAgentStates(initialStates);

    try {
      const response = await fetch('/api/v1/agents/orchestrate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission_prompt: missionPrompt,
          biome: selectedBiome,
          save_to_rojo: true,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Error al iniciar el pipeline de agentes especializados.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split('\n\n');
        sseBuffer = events.pop() || '';

        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.replace(/^data:\s*/, '');
          try {
            const payload = JSON.parse(jsonStr);
            if (payload.type === 'agent_step') {
              setAgentStates((prev) => ({
                ...prev,
                [payload.agent_id]: {
                  status: payload.status,
                  message: payload.message || prev[payload.agent_id]?.message,
                  artifact: payload.artifact || prev[payload.agent_id]?.artifact,
                },
              }));
            } else if (payload.type === 'done') {
              setOrchestrationSummary(payload.summary);
            }
          } catch {
            // ignore partial chunk
          }
        }
      }
    } catch (err) {
      console.error('Error running agent pipeline:', err);
    } finally {
      setIsOrchestrating(false);
    }
  };

  const handleBuildWorldScene = async () => {
    setBuildingWorld(true);
    try {
      const res = await fetch('/api/v1/world/build-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene_name: worldSceneName,
          biome: selectedBiome,
          placed_assets: worldPlacedAssets,
          save_to_rojo: true,
        }),
      });
      const data = await res.json();
      if (data.luau_code) {
        setWorldGeneratedLuau(data.luau_code);
        setWorldSavedPath(data.saved_path || null);
      }
    } catch (err) {
      console.error('Error building world scene:', err);
    } finally {
      setBuildingWorld(false);
    }
  };

  const getEngineIcon = (id: string) => {
    switch (id) {
      case '3d_generation_engine':
        return <Box className="w-4 h-4 text-cyan-400" />;
      case 'asset_engine':
        return <Layers className="w-4 h-4 text-amber-400" />;
      case 'luau_engine':
        return <FileCode2 className="w-4 h-4 text-blue-400" />;
      case 'ui_engine':
        return <Palette className="w-4 h-4 text-purple-400" />;
      case 'world_engine':
        return <Compass className="w-4 h-4 text-emerald-400" />;
      case 'rojo_bridge':
        return <Share2 className="w-4 h-4 text-teal-400" />;
      default:
        return <Cpu className="w-4 h-4 text-indigo-400" />;
    }
  };

  const getPriorityBadgeStyle = (priority: RoadmapMilestone['priority']) => {
    switch (priority) {
      case 'P0':
        return 'bg-red-950/80 border-red-500/40 text-red-300';
      case 'P1':
        return 'bg-cyan-950/80 border-cyan-500/40 text-cyan-300';
      case 'P2':
        return 'bg-purple-950/80 border-purple-500/40 text-purple-300';
      case 'P3':
        return 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300';
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Section 4: Visual Modular Engine Architecture Diagram */}
      <div className="p-6 rounded-2xl bg-[#0d1117] border border-slate-800 shadow-xl flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Cpu className="w-5 h-5 text-cyan-400" />
              Arquitectura Modular de 7 Motores Independientes (Forge AI Studio)
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              El backend central (<code className="text-cyan-300">FastAPI + Gateway Unificado</code>) delega cada responsabilidad en motores desacoplados bajo <code className="text-cyan-300">backend/engines/</code> y <code className="text-cyan-300">src/server/engines/</code>.
            </p>
          </div>
          <span className="px-3 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-mono text-xs flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            7 Motores Activos
          </span>
        </div>

        {/* Top Tier: React UI -> Central FastAPI Orchestrator */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-slate-950 border border-cyan-500/30 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400">
                CAPA FRONTEND
              </span>
              <h3 className="text-sm font-bold text-white mt-0.5">
                FORGE AI STUDIO · Interfaz Principal React + Visor 3D WebGL
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Workbench 3D, Editor de Piezas, PBR SurfaceAppearance, ForgeGUI y Consola SSE.
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-cyan-400 hidden md:block shrink-0" />
          </div>

          <div className="p-4 rounded-xl bg-slate-950 border border-blue-500/30 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-blue-400">
                ORQUESTADOR CENTRAL
              </span>
              <h3 className="text-sm font-bold text-white mt-0.5">
                Backend Central · FastAPI (main.py) &amp; Unified Gateway
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Gestión de IA (SDK oficial google-genai), seguridad, proyectos, tareas y comunicación HTTP/SSE.
              </p>
            </div>
          </div>
        </div>

        {/* Middle Tier: The 7 Independent Domain Engines */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {engines.map((eng) => (
            <div
              key={eng.id}
              className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between gap-3"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    {getEngineIcon(eng.id)}
                    <span className="font-bold text-xs text-white">{eng.name}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[10px]">
                    {eng.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{eng.responsibility}</p>
              </div>

              <div className="pt-2.5 border-t border-slate-800/80 flex flex-col gap-1 font-mono text-[10px]">
                <span className="text-cyan-300 truncate" title={eng.pythonModule}>
                  PY: {eng.pythonModule}
                </span>
                {eng.tsModule && (
                  <span className="text-emerald-300 truncate" title={eng.tsModule}>
                    TS: {eng.tsModule}
                  </span>
                )}
                <span className="text-slate-500 truncate">{eng.endpoints.join(' • ')}</span>
              </div>
            </div>
          ))}
        </div>

        {/* AI Self-Understanding & Domain Context Pruner Panel */}
        {domainPrunerStats.length > 0 && (
          <div className="p-4 rounded-xl bg-slate-950/90 border border-indigo-500/30 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Podador de Contexto IA por Dominio (Auto-Comprensión Modular · AI_ARCHITECTURE_MAP.md)
                </span>
              </div>
              <span className="px-2.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-mono text-[10px]">
                GET /api/v1/ai-manifest · GET /api/v1/context/pruned
              </span>
            </div>
            <p className="text-xs text-slate-400">
              En lugar de inyectar todo el contexto en cada llamada a Gemini, el motor <code className="text-indigo-300">contextPrunerEngine.ts</code> / <code className="text-indigo-300">context_pruner.py</code> envía únicamente los bloques semánticos necesarios para el dominio activo, reduciendo el contexto extra sin perder la lista de módulos Rojo verificados en disco:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              {domainPrunerStats.map((stat) => (
                <div
                  key={stat.domain}
                  className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col justify-between gap-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-xs uppercase text-cyan-300">
                      {stat.domain}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono text-[10px]">
                      -{stat.reductionPercent}% ctx
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-400">
                    {stat.prunedChars} / {stat.originalChars} chars
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 truncate" title={stat.includedSections.join(', ')}>
                    {stat.includedSections.join(' + ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bottom Tier: Roblox Studio Plugin Bridge */}
        <div className="p-4 rounded-xl bg-gradient-to-r from-slate-950 via-cyan-950/20 to-slate-950 border border-cyan-500/30 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-cyan-400 shrink-0" />
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                Roblox Studio Plugin v2.1 (ForgeAIStudioPlugin.server.luau)
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                Reconstrucción EditableMesh in-place en modo edición, importador 3D, publicación PBR y verificación de sincronización Rojo.
              </p>
            </div>
          </div>
          <span className="font-mono text-xs text-cyan-300">
            HttpService ↔ 127.0.0.1:8000 / 34872
          </span>
        </div>
      </div>

      {/* Priority P3: Specialized Multi-Agent Autonomous Workflow Orchestrator */}
      <div className="p-6 rounded-2xl bg-[#0d1117] border border-slate-800 shadow-xl flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="text-base font-bold text-white">
                P3 · Orquestador de Agentes Especializados (Automatización End-to-End)
              </h3>
              <p className="text-xs text-slate-400">
                Describe un sistema completo de juego y los 7 agentes especializados construirán y sincronizarán automáticamente el Modelo 3D, Material PBR, Escenario, Script Luau y HUD en Rojo.
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-mono text-xs">
            Prioridad P3 Activa
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Mission Prompt & Biome */}
          <div className="lg:col-span-5 flex flex-col gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Misión del Sistema a Construir
              </label>
              <textarea
                value={missionPrompt}
                onChange={(e) => setMissionPrompt(e.target.value)}
                rows={4}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs text-white focus:outline-none focus:border-emerald-500 resize-none leading-relaxed"
                placeholder="Describe el sistema completo que deseas automatizar..."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Bioma de Iluminación &amp; Escenario (World Engine)
              </label>
              <select
                value={selectedBiome}
                onChange={(e) => setSelectedBiome(e.target.value as any)}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white"
              >
                <option value="CyberpunkOrbital">Cyberpunk Orbital (Neón Nocturno)</option>
                <option value="MedievalForge">Forja Volcánica Medieval (Cálido)</option>
                <option value="ArcticResearchBase">Base Científica Ártica (Cristalino)</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handleRunSpecializedAgents}
              disabled={isOrchestrating}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
            >
              {isOrchestrating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Ejecutando Pipeline de 7 Agentes...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  <span>Ejecutar Flujo Autónomo de Agentes (3D + Mundo + Luau + UI + Rojo)</span>
                </>
              )}
            </button>

            {orchestrationSummary && (
              <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/40 flex flex-col gap-2">
                <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  Sistema '{orchestrationSummary.system_name}' sincronizado en Rojo ({orchestrationSummary.total_synced_files} archivos totales)
                </div>
                <div className="space-y-1 font-mono text-[11px] text-slate-200">
                  {orchestrationSummary.files_written.map((f) => (
                    <div key={f} className="flex items-center gap-1.5">
                      <FolderSync className="w-3 h-3 text-cyan-400 shrink-0" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Live 7-Agent Pipeline Status */}
          <div className="lg:col-span-7 flex flex-col gap-2.5">
            {agents.map((agent, index) => {
              const st = agentStates[agent.id] || { status: 'idle' };
              return (
                <div
                  key={agent.id}
                  className={`p-3.5 rounded-xl border transition flex items-start justify-between gap-3 ${
                    st.status === 'completed'
                      ? 'bg-emerald-950/20 border-emerald-500/40'
                      : st.status === 'running'
                      ? 'bg-cyan-950/30 border-cyan-500'
                      : 'bg-slate-950/80 border-slate-800'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-lg bg-slate-900 border border-slate-700 font-mono text-xs font-bold text-cyan-300 flex items-center justify-center shrink-0 tabular-nums">
                      {index + 1}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-white">{agent.name}</span>
                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-[10px] text-cyan-300">
                          {agent.engine}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{agent.role}</p>
                      {st.artifact && (
                        <div className="mt-1.5 font-mono text-[11px] text-emerald-300 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>{st.artifact}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <span className="font-mono text-[10px] uppercase shrink-0 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                    {st.status === 'completed'
                      ? 'DONE'
                      : st.status === 'running'
                      ? 'RUNNING'
                      : 'READY'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Priority P2: Dedicated World Engine Scene & Lighting Composer */}
      <div className="p-6 rounded-2xl bg-[#0d1117] border border-slate-800 shadow-xl flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Compass className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="text-base font-bold text-white">
                P2 · World Engine: Constructor de Escenarios, Iluminación y Atmósfera
              </h3>
              <p className="text-xs text-slate-400">
                Configura el bioma lumínico (<code className="text-cyan-300">Lighting + Atmosphere</code>) y ensambla múltiples assets 3D en un módulo de escenario listo para <code className="text-cyan-300">Workspace</code>.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 flex flex-col gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Nombre del Escenario / Mapa
              </label>
              <input
                type="text"
                value={worldSceneName}
                onChange={(e) => setWorldSceneName(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Assets 3D Anclados en el Escenario (separados por coma)
              </label>
              <input
                type="text"
                value={worldPlacedAssets.join(', ')}
                onChange={(e) =>
                  setWorldPlacedAssets(
                    e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  )
                }
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-cyan-200 font-mono"
              />
            </div>

            <button
              type="button"
              onClick={handleBuildWorldScene}
              disabled={buildingWorld}
              className="py-2.5 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <Compass className="w-4 h-4" />
              <span>
                {buildingWorld
                  ? 'Generando Escenario...'
                  : 'Construir Escenario & Sincronizar en Rojo (src/shared)'}
              </span>
            </button>

            {worldSavedPath && (
              <div className="text-xs font-mono text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                <span>Escrito en Rojo: {worldSavedPath}</span>
              </div>
            )}
          </div>

          <div className="lg:col-span-7">
            <div className="h-56 rounded-xl bg-[#070a0f] border border-slate-800 p-3.5 overflow-auto font-mono text-xs text-slate-200">
              <pre className="whitespace-pre-wrap">
                {worldGeneratedLuau ||
                  '-- Pulsa "Construir Escenario" para generar el módulo Luau --!strict de Lighting, Atmosphere y anclajes espaciales.'}
              </pre>
            </div>
          </div>
        </div>
      </div>

      {/* Section 5: Complete P0 - P3 Roadmap Verification Table */}
      <div className="p-6 rounded-2xl bg-[#0d1117] border border-slate-800 shadow-xl flex flex-col gap-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Wrench className="w-5 h-5 text-emerald-400" />
          Hoja de Ruta Completa (P0 → P3): Estado de Implementación
        </h3>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900/90 border-b border-slate-800 text-slate-400 font-mono uppercase text-[11px]">
                <th className="py-2.5 px-4">Prioridad</th>
                <th className="py-2.5 px-4">Desarrollo</th>
                <th className="py-2.5 px-4">Resultado</th>
                <th className="py-2.5 px-4">Motor Asignado</th>
                <th className="py-2.5 px-4">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {roadmap.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-900/40">
                  <td className="py-2.5 px-4">
                    <span
                      className={`px-2 py-0.5 rounded border font-mono font-bold text-[10px] ${getPriorityBadgeStyle(
                        item.priority
                      )}`}
                    >
                      {item.priority}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 font-semibold text-white">{item.title}</td>
                  <td className="py-2.5 px-4 text-slate-300">{item.outcome}</td>
                  <td className="py-2.5 px-4 font-mono text-cyan-300">{item.engineId}</td>
                  <td className="py-2.5 px-4">
                    <span className="inline-flex items-center gap-1 text-emerald-400 font-mono text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Completado
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
