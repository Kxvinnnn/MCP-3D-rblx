"""
Domain-Scoped AI Context Pruner & Self-Discovery Manifest Generator (`context_pruner.py`).

Why this exists:
Sending the entire `project_context.md` on every Gemini API call adds unnecessary context tokens
when the task only concerns one domain (e.g., 3D geometry generation does not need `TweenService`
or `UDim2.fromScale` UI layout rules).

This module slices `project_context.md` into domain-specific blocks (`3d`, `pbr`, `luau`, `ui`,
`world`, `agents`), cutting prompt context overhead by ~60-70% while always retaining the live
on-disk verified Rojo module list.
"""

import re
from typing import Any, Dict, List

AI_MODULE_CONTRACTS: List[Dict[str, Any]] = [
    {
        "id": "context_pruner",
        "domain": "agents",
        "tsPath": "src/server/engines/contextPrunerEngine.ts",
        "pyPath": "backend/engines/context_pruner.py",
        "keyExports": [
            "build_pruned_domain_context",
            "build_ai_self_understanding_manifest",
            "AI_MODULE_CONTRACTS",
        ],
        "invariants": [
            "Slices project_context.md by task domain so Gemini only receives relevant conventions.",
            "Always appends the live VERIFIED ON-DISK ROJO MODULES block to prevent hallucinated require() calls.",
        ],
    },
    {
        "id": "generation_3d_engine",
        "domain": "3d",
        "tsPath": "src/server/engines/generation3DEngine.ts",
        "pyPath": "backend/engines/generation_3d_engine.py",
        "keyExports": [
            "validate_published_roblox_mesh_id",
            "split_oversized_mesh_part_spec",
            "parse_wavefront_obj_geometry",
            "extract_geometry_from_processed_mesh",
            "extract_parts_from_uploaded_mesh",
            "build_luau_from_parts",
            "build_rbxmx_from_parts",
            "parse_rbxmx_to_parts",
        ],
        "invariants": [
            "Never invent fictional rbxassetid:// hashes or rbxassetid://0; never assign read-only MeshPart.MeshId.",
            "Construct geometry via AssetService:CreateEditableMesh(), verify GetTriangles() count, and call editableMesh:Destroy().",
            "Split sub-meshes exceeding 9,000 vertices or 9,500 triangles instead of truncating faces.",
        ],
    },
    {
        "id": "asset_engine",
        "domain": "pbr",
        "tsPath": "src/server/engines/assetEngine.ts",
        "pyPath": "backend/engines/asset_engine.py",
        "keyExports": [
            "upsert_asset",
            "publish_decal_to_roblox_cloud",
            "generate_pbr_surface_appearance_luau",
            "is_verified_roblox_asset_uri",
        ],
        "invariants": [
            "Always generate all 5 package files (.luau, .rbxmx, .gltf, .obj, .mtl) on the server.",
            "Support 4-channel PBR (ColorMap, NormalMap, RoughnessMap, MetalnessMap) per MeshPart.",
            "Poll Roblox Open Cloud /assets/v1/operations/{id} when Decal upload returns an async Operation.",
        ],
    },
    {
        "id": "world_engine",
        "domain": "world",
        "tsPath": "src/server/engines/worldEngine.ts",
        "pyPath": "backend/engines/world_engine.py",
        "keyExports": ["build_world_environment_luau"],
        "invariants": [
            "Configure Lighting and Atmosphere deterministically from biome presets.",
            "Spawn anchored spatial MeshPart pads with SpawnTargetAsset attributes.",
        ],
    },
    {
        "id": "luau_engine",
        "domain": "luau",
        "tsPath": "src/server/engines/luauEngine.ts",
        "pyPath": "backend/engines/luau_engine.py",
        "keyExports": ["build_system_instruction", "resolve_target_folder_and_extension"],
        "invariants": [
            "Every script must start with --!strict and use task.wait/task.spawn/task.delay/task.defer.",
            "Route Server scripts to src/server, Client scripts to src/client, and Modules to src/shared.",
        ],
    },
    {
        "id": "ui_engine",
        "domain": "ui",
        "tsPath": "src/server/engines/uiEngine.ts",
        "pyPath": "backend/engines/ui_engine.py",
        "keyExports": ["build_ui_system_instruction"],
        "invariants": [
            "All ScreenGui containers must use UDim2.fromScale with AnchorPoint = Vector2.new(0.5, 0.5).",
            "Support 3D ViewportFrame + WorldModel previews and TweenService transitions.",
        ],
    },
    {
        "id": "rojo_bridge",
        "domain": "luau",
        "tsPath": "src/server/engines/rojoBridge.ts",
        "pyPath": "backend/engines/rojo_bridge.py",
        "keyExports": ["resolve_safe_project_path", "validate_and_sanitize_luau", "build_sync_manifest"],
        "invariants": [
            "Reject any path traversal (..) or writes escaping ROJO_PROJECT_PATH.",
            "Reject forbidden Luau patterns (loadstring, getfenv, setfenv).",
        ],
    },
]

DOMAIN_SECTION_MAP: Dict[str, List[str]] = {
    "3d": ["ROJO_MAPPING", "LUAU_STANDARDS"],
    "pbr": ["ROJO_MAPPING", "LUAU_STANDARDS"],
    "world": ["ROJO_MAPPING", "LUAU_STANDARDS", "EXISTING_MODULES"],
    "luau": ["ROJO_MAPPING", "LUAU_STANDARDS", "MAID_PATTERN", "EXISTING_MODULES"],
    "ui": ["ROJO_MAPPING", "LUAU_STANDARDS", "MAID_PATTERN", "UI_FORGEGUI"],
    "agents": ["ROJO_MAPPING", "LUAU_STANDARDS", "MAID_PATTERN", "UI_FORGEGUI", "EXISTING_MODULES"],
}

COMPACT_DOMAIN_CHEATSHEETS: Dict[str, str] = {
    "3d": "\n".join([
        "--- 3D EDITABLEMESH COMPACT RULES ---",
        "- Scale: 1 Stud = 0.28m; R15 Avatar height = 5.5 Studs; base rests at Y = 0.",
        "- Geometry: Use AssetService:CreateEditableMesh() + AssetService:CreateMeshPartAsync(Content.fromObject(editableMesh), options).",
        "- Never invent rbxassetid:// hashes or assign read-only MeshPart.MeshId.",
    ]),
    "pbr": "\n".join([
        "--- PBR SURFACEAPPEARANCE COMPACT RULES ---",
        "- 4 Channels: ColorMap, NormalMap, RoughnessMap, MetalnessMap.",
        "- Only assign rbxassetid://<positive_int> when verified; otherwise synthesize runtime EditableImage.",
    ]),
    "luau": "\n".join([
        "--- LUAU STRICT COMPACT RULES ---",
        "- Line 1 MUST be `--!strict`. Use `task.wait`, `task.spawn`, `task.delay`, `task.defer`.",
        "- Clean up all RBXScriptConnections and dynamic Instances via `Maid`.",
    ]),
    "ui": "\n".join([
        "--- FORGEGUI COMPACT RULES ---",
        "- Use `UDim2.fromScale` + `AnchorPoint = Vector2.new(0.5, 0.5)` for all layout containers.",
        "- Offset is only allowed in UIPadding or UIStroke.Thickness.",
    ]),
    "world": "\n".join([
        "--- WORLD ENGINE COMPACT RULES ---",
        "- Configure `Lighting` + `Atmosphere` and place spatial anchors inside a `Workspace` Zone Folder.",
    ]),
    "agents": "\n".join([
        "--- P3 MULTI-AGENT ORCHESTRATOR RULES ---",
        "- Coordinate Architect -> 3D -> Asset/PBR -> World -> Luau -> UI -> Rojo SHA-256 verification.",
    ]),
}


def build_pruned_domain_context(
    raw_project_context: str,
    verified_modules_block: str = "",
    domain: str = "luau",
) -> Dict[str, Any]:
    raw_text = str(raw_project_context or "")
    norm_domain = domain if domain in DOMAIN_SECTION_MAP else "luau"
    sections: Dict[str, str] = {
        "ROJO_MAPPING": "",
        "LUAU_STANDARDS": "",
        "MAID_PATTERN": "",
        "UI_FORGEGUI": "",
        "EXISTING_MODULES": "",
    }

    parts = re.split(r"^##\s+", raw_text, flags=re.MULTILINE)
    for part in parts:
        trimmed = part.strip()
        if not trimmed:
            continue
        if trimmed.startswith("1."):
            sections["ROJO_MAPPING"] = f"## {trimmed}"
        elif trimmed.startswith("2."):
            sections["LUAU_STANDARDS"] = f"## {trimmed}"
        elif trimmed.startswith("3."):
            sections["MAID_PATTERN"] = f"## {trimmed}"
        elif trimmed.startswith("4."):
            sections["UI_FORGEGUI"] = f"## {trimmed}"
        elif trimmed.startswith("5."):
            sections["EXISTING_MODULES"] = f"## {trimmed}"

    wanted_keys = DOMAIN_SECTION_MAP[norm_domain]
    included_sections: List[str] = []
    selected_chunks: List[str] = [COMPACT_DOMAIN_CHEATSHEETS[norm_domain]]

    for key in wanted_keys:
        if sections.get(key):
            included_sections.append(key)
            selected_chunks.append(sections[key])

    if verified_modules_block.strip():
        selected_chunks.append(verified_modules_block.strip())

    full_unpruned = f"{raw_text}\n{verified_modules_block}"
    pruned_text = "\n\n".join(selected_chunks)
    raw_chars = max(1, len(full_unpruned))
    pruned_chars = len(pruned_text)
    saved_pct = max(0, min(90, round(((raw_chars - pruned_chars) / raw_chars) * 100)))

    return {
        "domain": norm_domain,
        "prompt_context": pruned_text,
        "included_sections": included_sections,
        "raw_char_count": raw_chars,
        "pruned_char_count": pruned_chars,
        "saved_percentage": saved_pct,
    }


def build_ai_self_understanding_manifest(
    raw_project_context: str = "",
    verified_modules_block: str = "",
) -> Dict[str, Any]:
    domains = ["3d", "pbr", "luau", "ui", "world", "agents"]
    profiles = []
    for d in domains:
        res = build_pruned_domain_context(raw_project_context, verified_modules_block, d)
        profiles.append({
            "domain": res["domain"],
            "included_sections": res["included_sections"],
            "raw_chars": res["raw_char_count"],
            "pruned_chars": res["pruned_char_count"],
            "saved_percentage": res["saved_percentage"],
        })

    return {
        "schema_version": "2.2-modular-ai-first",
        "architecture_index_file": "AI_ARCHITECTURE_MAP.md",
        "design_principle": "7 Single-Responsibility Domain Engines + Domain-Scoped Context Pruner (Zero Monoliths, Minimal Prompt Context)",
        "module_contracts": AI_MODULE_CONTRACTS,
        "context_pruning_profiles": profiles,
    }
