"""
Specialized Multi-Agent Engine (backend/engines/agents_engine.py) - Priority P3
Coordinates 6 specialized domain agents in sequence to build a complete Roblox system:
1. ArchitectAgent -> System design & module dependency audit
2. 3DGenerationAgent -> 3D Model parts & Stud proportions
3. AssetEngineAgent -> PBR SurfaceAppearance & LOD/Collision optimization
4. WorldEngineAgent -> Environment lighting & spatial scene layout
5. LuauEngineAgent -> Server/Client --!strict gameplay controller with Maid
6. UIEngineAgent -> Responsive ScreenGui + ViewportFrame HUD
7. RojoBridgeAgent -> Atomic disk write & SHA-256 sync verification
"""

from typing import Any, Dict, List


AGENT_DEFINITIONS: List[Dict[str, str]] = [
    {
        "id": "architect_agent",
        "name": "Architect Agent",
        "engine": "Core Orchestrator",
        "role": "Diseña la arquitectura cliente-servidor, audita módulos en disco (Maid, RemoteProvider) y define contratos de tipos.",
    },
    {
        "id": "modeler_3d_agent",
        "name": "3D Generation Agent",
        "engine": "3D Generation Engine",
        "role": "Sintetiza modelos 3D compuestos en Studs y valida el presupuesto de <10,000 triángulos por MeshPart.",
    },
    {
        "id": "asset_pbr_agent",
        "name": "Asset & PBR Agent",
        "engine": "Asset Engine",
        "role": "Genera perfiles SurfaceAppearance (Albedo, Normal, Roughness), niveles LOD y CollisionFidelity.",
    },
    {
        "id": "world_builder_agent",
        "name": "World & Lighting Agent",
        "engine": "World Engine",
        "role": "Configura iluminación ambiental, atmósfera y posicionamiento espacial en Workspace.",
    },
    {
        "id": "luau_scripter_agent",
        "name": "Luau Systems Agent",
        "engine": "Luau Engine",
        "role": "Escribe scripts --!strict con librería task.* y gestión de memoria Maid.",
    },
    {
        "id": "ui_hud_agent",
        "name": "ForgeGUI & Viewport Agent",
        "engine": "UI Engine",
        "role": "Construye interfaces ScreenGui responsive (UDim2.fromScale) con ViewportFrame 3D y TweenService.",
    },
    {
        "id": "rojo_sync_agent",
        "name": "Rojo Bridge Agent",
        "engine": "Rojo Bridge",
        "role": "Escribe todos los artefactos en ROJO_PROJECT_PATH y firma el manifiesto SHA-256 para Roblox Studio.",
    },
]
