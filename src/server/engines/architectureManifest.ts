export interface EngineDescriptor {
  id: string;
  name: string;
  pythonModule: string;
  tsModule: string;
  responsibility: string;
  endpoints: string[];
  status: 'ACTIVE';
}

export interface RoadmapMilestone {
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  outcome: string;
  engineId: string;
  completed: boolean;
}

export interface SpecializedAgentSpec {
  id: string;
  name: string;
  engine: string;
  role: string;
  outputArtifact: string;
}

export const FORGE_MODULAR_ENGINES: EngineDescriptor[] = [
  {
    id: '3d_generation_engine',
    name: '3D Generation Engine',
    pythonModule: 'backend/engines/generation_3d_engine.py',
    tsModule: 'src/server/engines/generation3DEngine.ts',
    responsibility: 'Texto e imágenes de referencia a modelos 3D compuestos en Studs y mallas de relieve.',
    endpoints: ['/api/v1/generate-3d', '/api/v1/generate-3d-stream'],
    status: 'ACTIVE',
  },
  {
    id: 'asset_engine',
    name: 'Asset Engine',
    pythonModule: 'backend/engines/asset_engine.py',
    tsModule: 'src/server/engines/assetEngine.ts',
    responsibility: 'Texturas PBR (SurfaceAppearance), optimización LOD/colisiones, importación GLB/GLTF/OBJ/FBX y Biblioteca.',
    endpoints: ['/api/v1/assets', '/api/v1/assets/:id', '/api/v1/assets/rebuild-luau'],
    status: 'ACTIVE',
  },
  {
    id: 'luau_engine',
    name: 'Luau Engine',
    pythonModule: 'backend/engines/luau_engine.py',
    tsModule: 'src/server/engines/luauEngine.ts',
    responsibility: 'Scripts Server, Client y Module con tipado --!strict, librería task.* y patrón Maid.',
    endpoints: ['/api/v1/generate-script', '/api/v1/generate-script-stream'],
    status: 'ACTIVE',
  },
  {
    id: 'ui_engine',
    name: 'UI Engine',
    pythonModule: 'backend/engines/ui_engine.py',
    tsModule: 'src/server/engines/uiEngine.ts',
    responsibility: 'Interfaces ScreenGui responsive (UDim2.fromScale), ViewportFrame 3D y animaciones TweenService.',
    endpoints: ['/api/v1/generate-ui', '/api/v1/generate-ui-stream'],
    status: 'ACTIVE',
  },
  {
    id: 'world_engine',
    name: 'World Engine',
    pythonModule: 'backend/engines/world_engine.py',
    tsModule: 'src/server/engines/worldEngine.ts',
    responsibility: 'Escenarios completos, iluminación ambiental, atmósfera, zonas de mapa y ensamblaje espacial.',
    endpoints: ['/api/v1/world/build-scene'],
    status: 'ACTIVE',
  },
  {
    id: 'rojo_bridge',
    name: 'Rojo Bridge',
    pythonModule: 'backend/engines/rojo_bridge.py',
    tsModule: 'src/server/engines/rojoBridge.ts',
    responsibility: 'Sandboxing de rutas, detección de default.project.json, auditoría de módulos y manifiesto SHA-256.',
    endpoints: ['/api/v1/rojo/status', '/api/v1/rojo/configure', '/api/v1/rojo/sync-manifest', '/api/v1/context/audit'],
    status: 'ACTIVE',
  },
  {
    id: 'agents_engine',
    name: 'Specialized Agents Engine (P3)',
    pythonModule: 'backend/engines/agents_engine.py',
    tsModule: 'src/server/engines/agentsEngine.ts',
    responsibility: 'Orquestación autónoma multi-agente que coordina 3D, PBR, Mundo, Scripts Luau, UI y Rojo en un solo flujo.',
    endpoints: ['/api/v1/agents/orchestrate-stream', '/api/v1/architecture'],
    status: 'ACTIVE',
  },
];

export const FORGE_ROADMAP_STATUS: RoadmapMilestone[] = [
  { priority: 'P0', title: 'Unificar los backends', outcome: 'Arquitectura estable (FastAPI + Gateway Unificado)', engineId: 'rojo_bridge', completed: true },
  { priority: 'P0', title: 'Corregir seguridad y rutas', outcome: 'Escritura segura (Anti-Path Traversal + X-Forge-Token)', engineId: 'rojo_bridge', completed: true },
  { priority: 'P0', title: 'Integración real con Rojo', outcome: 'Conexión real con tus juegos y manifiesto SHA-256', engineId: 'rojo_bridge', completed: true },
  { priority: 'P1', title: 'Motor de generación 3D', outcome: 'Crear modelos 3D desde texto e imagen', engineId: '3d_generation_engine', completed: true },
  { priority: 'P1', title: 'Importador GLB/GLTF/OBJ/FBX', outcome: 'Llevar modelos externos a Roblox (<10k tris)', engineId: 'asset_engine', completed: true },
  { priority: 'P1', title: 'Generador de texturas PBR', outcome: 'Mapas Albedo, Normal y Roughness (SurfaceAppearance)', engineId: 'asset_engine', completed: true },
  { priority: 'P1', title: 'Visor 3D real WebGL', outcome: 'Inspeccionar modelos con ViewportFrame + WorldModel', engineId: '3d_generation_engine', completed: true },
  { priority: 'P2', title: 'Editor interactivo de modelos 3D', outcome: 'Modificar piezas, escala, posición y materiales en vivo', engineId: 'asset_engine', completed: true },
  { priority: 'P2', title: 'Generador de escenarios (World Engine)', outcome: 'Construir mapas, iluminación y atmósfera', engineId: 'world_engine', completed: true },
  { priority: 'P2', title: 'Biblioteca de assets reutilizables', outcome: 'Guardar, editar y reutilizar creaciones 3D', engineId: 'asset_engine', completed: true },
  { priority: 'P3', title: 'Agentes especializados', outcome: 'Automatizar todo el flujo (Modelo 3D + Mapa + Script + UI + Rojo)', engineId: 'agents_engine', completed: true },
];

export const SPECIALIZED_AGENTS: SpecializedAgentSpec[] = [
  {
    id: 'architect_agent',
    name: 'Architect Agent',
    engine: 'Core Orchestrator',
    role: 'Audita los módulos físicos en Rojo (Maid, RemoteProvider, GameTypes) y diseña el plan de sistema.',
    outputArtifact: 'Plan Arquitectónico & Validación de Módulos',
  },
  {
    id: 'modeler_3d_agent',
    name: '3D Generation Agent',
    engine: '3D Generation Engine',
    role: 'Sintetiza la geometría 3D multi-parte en Studs y su constructor Luau --!strict.',
    outputArtifact: 'src/shared/Assets3D/<System>Model.luau',
  },
  {
    id: 'asset_pbr_agent',
    name: 'Asset & PBR Agent',
    engine: 'Asset Engine',
    role: 'Calcula el perfil PBR (Albedo, Roughness, Metalness), niveles LOD y CollisionFidelity.',
    outputArtifact: 'Registro en assets_library.json (<10k tris)',
  },
  {
    id: 'world_builder_agent',
    name: 'World & Lighting Agent',
    engine: 'World Engine',
    role: 'Configura Lighting, Atmosphere y el posicionamiento espacial del escenario en Workspace.',
    outputArtifact: 'src/shared/Scenes/<System>World.luau',
  },
  {
    id: 'luau_scripter_agent',
    name: 'Luau Systems Agent',
    engine: 'Luau Engine',
    role: 'Desarrolla el controlador Server/Client --!strict con librería task.* y limpieza Maid.',
    outputArtifact: 'src/server/<System>Controller.server.luau',
  },
  {
    id: 'ui_hud_agent',
    name: 'ForgeGUI & Viewport Agent',
    engine: 'UI Engine',
    role: 'Genera el módulo ScreenGui responsive con ViewportFrame 3D y animaciones TweenService.',
    outputArtifact: 'src/client/UI/<System>HUD.luau',
  },
  {
    id: 'rojo_sync_agent',
    name: 'Rojo Bridge Agent',
    engine: 'Rojo Bridge',
    role: 'Sincroniza todos los archivos generados en ROJO_PROJECT_PATH y firma el manifiesto SHA-256.',
    outputArtifact: 'Manifiesto SHA-256 sincronizado con Roblox Studio',
  },
];
