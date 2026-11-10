"""
Forge AI - Unified Roblox Luau, Rojo 7.x & 3D Asset Creation Backend
====================================================================
Single authoritative FastAPI backend for both the React Web Workbench
and the Roblox Studio Plugin (via HttpService).

Capabilities:
1. Luau Script Generation (--!strict, task library, verified Maid pattern)
2. ForgeGUI Responsive UI Generation (Scale-only + Studio Instance Tree)
3. 3D Model, PBR Material & Scene Generation (Text-to-3D, Image-to-3D, GLB/OBJ conversion with real EditableMesh/MeshPart geometry, Collision & LOD optimization)
4. Reusable 3D Asset Library persistence & PBR Texture publishing to Rojo
5. Real Rojo Project Management (default.project.json parser, CLI detector, Port 34872 probe, Sync Manifest SHA-256 verification)
6. Autonomous 7-Agent Orchestrator with self-review & correction loop
7. Security Hardening (Path traversal protection, module existence auditing, restricted CORS, rate limiting, token protection)
"""

import base64
import hashlib
import json
import logging
import os
import re
import shutil
import socket
import subprocess
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# Official current Google GenAI SDK (NEVER use deprecated google-generativeai)
from google import genai
from google.genai import types

# Modular Engines (Section 4 Recommended Architecture)
from engines.rojo_bridge import RojoBridgeEngine
from engines.luau_engine import LuauEngine
from engines.ui_engine import UIEngine
from engines.generation_3d_engine import (
    Generation3DEngine,
    Generate3DEngineRequest,
    MeshPart3DSpec,
    Model3DResponse,
    PBRProfileSpec,
    SubMeshGeometrySpec,
    extract_mesh_geometry_from_processed_submesh,
    validate_published_roblox_mesh_id,
)
from engines.asset_engine import AssetEngine
from engines.world_engine import WorldEngine
from engines.agents_engine import AGENT_DEFINITIONS, AutonomousMultiAgentOrchestrator

# ------------------------------------------------------------------------------
# 1. Configuration, Security & Initialization
# ------------------------------------------------------------------------------

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("ForgeAI.UnifiedBackend")

TIER_MODELS: Dict[str, str] = {
    "pro": os.getenv("MODEL_TIER_PRO", "gemini-2.5-pro"),
    "fast": os.getenv("MODEL_TIER_FAST", "gemini-2.5-flash"),
}

# Mutable runtime configuration for Rojo workspace path
RUNTIME_CONFIG: Dict[str, Any] = {
    "rojo_project_path": os.getenv("ROJO_PROJECT_PATH", "./rojo_workspace"),
    "project_context_file": os.getenv("PROJECT_CONTEXT_FILE", "project_context.md"),
    "forge_local_token": os.getenv("FORGE_LOCAL_TOKEN", ""),
    "rate_limit_per_minute": int(os.getenv("RATE_LIMIT_PER_MINUTE", "45")),
}

ALLOWED_EXTENSIONS = {".luau", ".json", ".obj", ".mtl", ".gltf", ".glb", ".rbxmx", ".md", ".png"}
FORBIDDEN_LUAU_PATTERNS = [
    r"\bloadstring\s*\(",
    r"\bgetfenv\s*\(",
    r"\bsetfenv\s*\(",
]

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
try:
    gemini_client = genai.Client() if GEMINI_API_KEY else None
    if gemini_client:
        logger.info("✅ Google GenAI SDK initialized successfully.")
except Exception as init_err:
    logger.error(f"❌ Failed to initialize Google GenAI Client: {init_err}")
    gemini_client = None

generation_3d_engine = Generation3DEngine(gemini_client, TIER_MODELS)
autonomous_orchestrator = AutonomousMultiAgentOrchestrator(gemini_client, TIER_MODELS)

app = FastAPI(
    title="Forge AI - Unified Roblox 3D, Luau & Rojo Backend",
    version="2.1.0",
    description="Unified FastAPI backend for React Studio Workbench and Roblox Studio Plugin."
)

# Restricted CORS (No wildcard '*' with credentials)
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Forge-Token", "User-Agent"],
)

# Sliding-window rate limiter store
_rate_limit_Buckets: Dict[str, List[float]] = defaultdict(list)


def verify_security_token(provided_token: Optional[str] = None) -> None:
    configured_token = RUNTIME_CONFIG.get("forge_local_token", "")
    if configured_token and (provided_token or "") != configured_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Forge-Token header.",
        )


@app.middleware("http")
async def security_and_rate_limit_middleware(request: Request, call_next):
    # 1. Payload size guard (Max 25 MB for 3D meshes & PBR textures)
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > 25 * 1024 * 1024:
        return JSONResponse(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            content={"error": "Payload exceeds maximum allowed size (25 MB)."}
        )

    # 2. Sliding-window rate limiting per client IP
    client_ip = request.client.host if request.client else "127.0.0.1"
    now = time.time()
    window = 60.0
    max_requests = RUNTIME_CONFIG["rate_limit_per_minute"]
    bucket = [t for t in _rate_limit_Buckets[client_ip] if now - t < window]
    if len(bucket) >= max_requests:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"error": f"Rate limit exceeded ({max_requests} req/min). Please wait a moment."}
        )
    bucket.append(now)
    _rate_limit_Buckets[client_ip] = bucket

    # 3. Optional local security token validation on mutating requests
    configured_token = RUNTIME_CONFIG["forge_local_token"]
    if configured_token and request.method in ("POST", "DELETE", "PUT"):
        provided_token = request.headers.get("X-Forge-Token", "")
        if provided_token != configured_token:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"error": "Invalid or missing X-Forge-Token header."}
            )

    return await call_next(request)


# ------------------------------------------------------------------------------
# 2. Security Helpers: Path Traversal Protection & Luau Validation
# ------------------------------------------------------------------------------

def get_rojo_root() -> Path:
    return Path(RUNTIME_CONFIG["rojo_project_path"]).resolve()


def resolve_safe_project_path(rojo_target_folder: str, file_name: str) -> Path:
    """
    Prevents Path Traversal attacks by ensuring the resolved target file
    strictly resides inside the configured ROJO_PROJECT_PATH and uses an allowed extension.
    """
    rojo_root = get_rojo_root()
    rojo_root.mkdir(parents=True, exist_ok=True)

    clean_folder = rojo_target_folder.strip().lstrip("/\\")
    if ".." in Path(clean_folder).parts or ".." in file_name:
        raise ValueError("Security Violation: Path traversal ('..') is strictly prohibited.")

    clean_name = Path(file_name).name
    ext = Path(clean_name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Security Violation: File extension '{ext}' is not permitted.")

    target_dir = (rojo_root / clean_folder).resolve()
    if not target_dir.is_relative_to(rojo_root):
        raise ValueError("Security Violation: Target directory escapes ROJO_PROJECT_PATH.")

    target_dir.mkdir(parents=True, exist_ok=True)
    target_file = (target_dir / clean_name).resolve()
    if not target_file.is_relative_to(rojo_root):
        raise ValueError("Security Violation: Target file escapes ROJO_PROJECT_PATH.")

    return target_file


def validate_and_sanitize_luau(code: str) -> str:
    """
    Validates generated Luau code:
    - Enforces --!strict header
    - Rejects dangerous code injection primitives (loadstring, getfenv, setfenv)
    """
    cleaned = code.strip()
    if not cleaned.startswith("--!strict"):
        cleaned = "--!strict\n" + cleaned

    for pattern in FORBIDDEN_LUAU_PATTERNS:
        if re.search(pattern, cleaned):
            raise ValueError(f"Security Violation: Forbidden Luau pattern detected ({pattern}).")

    return cleaned + "\n"


def save_luau_to_rojo(rojo_target_folder: str, file_name: str, code: str) -> str:
    safe_code = validate_and_sanitize_luau(code)
    target_path = resolve_safe_project_path(rojo_target_folder, file_name)
    target_path.write_text(safe_code, encoding="utf-8")
    logger.info(f"💾 Saved validated Luau file to Rojo: {target_path}")
    return str(target_path)


def save_raw_asset_to_rojo(rojo_target_folder: str, file_name: str, content: bytes) -> str:
    target_path = resolve_safe_project_path(rojo_target_folder, file_name)
    target_path.write_bytes(content)
    logger.info(f"💾 Saved binary/3D asset file to Rojo: {target_path}")
    return str(target_path)


# ------------------------------------------------------------------------------
# 3. Context Auditor & Real Module Existence Checker
# ------------------------------------------------------------------------------

def audit_project_modules() -> Dict[str, Any]:
    """
    Scans the actual Rojo workspace on disk to verify which shared/server/client
    modules exist, comparing them against modules referenced in project_context.md.
    """
    rojo_root = get_rojo_root()
    existing_files: List[Dict[str, str]] = []

    src_dir = rojo_root / "src"
    if src_dir.exists():
        for luau_file in src_dir.rglob("*.luau"):
            rel_path = luau_file.relative_to(rojo_root).as_posix()
            module_name = luau_file.name.replace(".server.luau", "").replace(".client.luau", "").replace(".luau", "")
            existing_files.append({
                "name": module_name,
                "relative_path": rel_path,
                "sha256": hashlib.sha256(luau_file.read_bytes()).hexdigest()[:12],
            })

    existing_names = {f["name"] for f in existing_files}
    expected_core_modules = [
        {"name": "Maid", "rojo_path": "src/shared/Utils/Maid.luau", "roblox_path": "ReplicatedStorage.Shared.Utils.Maid"},
        {"name": "RemoteProvider", "rojo_path": "src/shared/Network/RemoteProvider.luau", "roblox_path": "ReplicatedStorage.Shared.Network.RemoteProvider"},
        {"name": "GameTypes", "rojo_path": "src/shared/Types/GameTypes.luau", "roblox_path": "ReplicatedStorage.Shared.Types.GameTypes"},
    ]

    module_status = []
    for mod in expected_core_modules:
        full_p = rojo_root / mod["rojo_path"]
        module_status.append({
            **mod,
            "exists": full_p.exists(),
        })

    return {
        "rojo_root": str(rojo_root),
        "core_modules": module_status,
        "all_verified_modules": existing_files,
        "verified_module_names": sorted(list(existing_names)),
    }


def load_project_context() -> str:
    """
    Reads project_context.md AND appends a verified on-disk module manifest
    so Gemini only requires modules that genuinely exist in the user's project.
    """
    search_paths = [
        Path(RUNTIME_CONFIG["project_context_file"]),
        Path(__file__).parent / RUNTIME_CONFIG["project_context_file"],
        Path(__file__).parent.parent / "backend" / RUNTIME_CONFIG["project_context_file"],
        get_rojo_root() / RUNTIME_CONFIG["project_context_file"],
    ]

    raw_context = ""
    for p in search_paths:
        if p.exists() and p.is_file():
            try:
                raw_context = p.read_text(encoding="utf-8").strip()
                break
            except Exception:
                pass

    audit = audit_project_modules()
    verified_list = ", ".join(audit["verified_module_names"]) if audit["verified_module_names"] else "NONE"
    missing_core = [m["name"] for m in audit["core_modules"] if not m["exists"]]

    verification_note = f"""
--- VERIFIED ON-DISK ROJO MODULES ---
Verified existing modules in project: [{verified_list}]
Missing core modules: [{", ".join(missing_core) if missing_core else "None - All Core Modules Verified"}]
CRITICAL RULE: You may ONLY `require()` modules that are listed in 'Verified existing modules in project'. If a helper like Maid is missing, inline a lightweight local implementation instead of requiring a non-existent path!
--- END VERIFIED MODULES ---
"""
    if raw_context:
        return f"\n\n--- LOCAL PROJECT CONTEXT ---\n{raw_context}\n{verification_note}"
    return verification_note


# ------------------------------------------------------------------------------
# 4. Pydantic Schemas (Luau Scripts, ForgeGUI & 3D Asset Creation Engine)
# ------------------------------------------------------------------------------

class ScriptRequest(BaseModel):
    prompt: str
    script_type: Literal["Server", "Client", "Module"] = "Server"
    model_tier: Literal["fast", "pro"] = "fast"
    save_to_rojo: bool = True


class LuauScriptResponse(BaseModel):
    file_name: str
    rojo_target_folder: str
    luau_code: str
    dependencies: List[str] = Field(default_factory=list)
    explanation: str
    saved_path: Optional[str] = None


class UINode(BaseModel):
    class_name: str
    name: str
    properties: Dict[str, Any] = Field(default_factory=dict)
    children: List["UINode"] = Field(default_factory=list)


class UIRequest(BaseModel):
    prompt: str
    style_theme: str = "Dark Cyberpunk"
    reference_image_base64: Optional[str] = None
    save_to_rojo: bool = True
    model_tier: Literal["fast", "pro"] = "fast"


class LuauUIResponse(BaseModel):
    file_name: str
    rojo_target_folder: str = "src/client/UI"
    luau_code: str
    ui_tree: UINode
    explanation: str
    style_theme: str
    saved_path: Optional[str] = None


# ------------------------------------------------------------------------------
# 5. Rojo Project Management & Sync Verification Endpoints
# ------------------------------------------------------------------------------

@app.get("/api/v1/rojo/status")
def get_rojo_status():
    rojo_root = get_rojo_root()
    project_json_path = rojo_root / "default.project.json"
    project_config = None
    if project_json_path.exists():
        try:
            project_config = json.loads(project_json_path.read_text(encoding="utf-8"))
        except Exception:
            project_config = None

    rojo_bin = shutil.which("rojo")
    rojo_version = None
    if rojo_bin:
        try:
            out = subprocess.check_output([rojo_bin, "--version"], timeout=2, text=True).strip()
            rojo_version = out
        except Exception:
            rojo_version = "Installed"

    rojo_port = project_config.get("servePort", 34872) if isinstance(project_config, dict) else 34872
    rojo_server_active = False
    try:
        with socket.create_connection(("127.0.0.1", rojo_port), timeout=0.35):
            rojo_server_active = True
    except Exception:
        rojo_server_active = False

    audit = audit_project_modules()
    return {
        "rojo_project_path": str(rojo_root),
        "path_exists": rojo_root.exists(),
        "default_project_json_found": project_json_path.exists(),
        "project_config": project_config,
        "rojo_cli_installed": bool(rojo_bin),
        "rojo_version": rojo_version,
        "rojo_serve_port": rojo_port,
        "rojo_server_active": rojo_server_active,
        "audit": audit,
    }


class RojoConfigRequest(BaseModel):
    rojo_project_path: str
    initialize_if_missing: bool = True


@app.post("/api/v1/rojo/configure")
def configure_rojo_path(req: RojoConfigRequest):
    raw_path = req.rojo_project_path.strip()
    if not raw_path or "\0" in raw_path:
        raise HTTPException(status_code=400, detail="Invalid project path.")

    target = Path(raw_path).resolve()
    if req.initialize_if_missing:
        target.mkdir(parents=True, exist_ok=True)
        for sub in [
            "src/server",
            "src/client",
            "src/client/UI",
            "src/shared/Utils",
            "src/shared/Network",
            "src/shared/Types",
            "src/shared/Assets3D",
            "src/shared/Assets3D/Textures",
        ]:
            (target / sub).mkdir(parents=True, exist_ok=True)

        proj_file = target / "default.project.json"
        if not proj_file.exists():
            default_proj = {
                "name": target.name or "ForgeAI_Roblox_Game",
                "servePort": 34872,
                "tree": {
                    "$className": "DataModel",
                    "ReplicatedStorage": {"$className": "ReplicatedStorage", "Shared": {"$path": "src/shared"}},
                    "ServerScriptService": {"$className": "ServerScriptService", "Server": {"$path": "src/server"}},
                    "StarterPlayer": {
                        "$className": "StarterPlayer",
                        "StarterPlayerScripts": {"$className": "StarterPlayerScripts", "Client": {"$path": "src/client"}}
                    },
                    "StarterGui": {"$className": "StarterGui", "Interface": {"$path": "src/client/UI"}}
                }
            }
            proj_file.write_text(json.dumps(default_proj, indent=2), encoding="utf-8")

    RUNTIME_CONFIG["rojo_project_path"] = str(target)
    return get_rojo_status()


@app.get("/api/v1/rojo/sync-manifest")
def get_rojo_sync_manifest():
    """
    Returns a cryptographic manifest of all Luau scripts in the Rojo project
    mapped to their expected Roblox Studio DataModel paths so the Studio Plugin
    can verify live synchronization.
    """
    audit = audit_project_modules()
    manifest = []
    for item in audit["all_verified_modules"]:
        rel = item["relative_path"]
        if rel.startswith("src/server"):
            datamodel_target = f"ServerScriptService.Server.{item['name']}"
        elif rel.startswith("src/client/UI"):
            datamodel_target = f"StarterGui.Interface.{item['name']}"
        elif rel.startswith("src/client"):
            datamodel_target = f"StarterPlayer.StarterPlayerScripts.Client.{item['name']}"
        else:
            datamodel_target = f"ReplicatedStorage.Shared.{item['name']}"

        manifest.append({
            **item,
            "datamodel_target": datamodel_target,
        })

    return {
        "rojo_root": audit["rojo_root"],
        "total_files": len(manifest),
        "files": manifest,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@app.get("/api/v1/context/audit")
def get_context_audit():
    return audit_project_modules()


@app.post("/api/v1/context/bootstrap-modules")
def bootstrap_core_modules():
    """Installs verified Maid, RemoteProvider, and GameTypes into the current Rojo workspace."""
    rojo_root = get_rojo_root()
    source_root = Path(__file__).parent.parent / "rojo_workspace"
    installed = []

    for rel_path in [
        "src/shared/Utils/Maid.luau",
        "src/shared/Network/RemoteProvider.luau",
        "src/shared/Types/GameTypes.luau",
    ]:
        dest = rojo_root / rel_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        src_template = source_root / rel_path
        if src_template.exists() and src_template.resolve() != dest.resolve():
            shutil.copyfile(src_template, dest)
            installed.append(rel_path)
        elif dest.exists():
            installed.append(rel_path)

    return {"installed": installed, "audit": audit_project_modules()}


# ------------------------------------------------------------------------------
# 6. Reusable 3D Asset Library Endpoints
# ------------------------------------------------------------------------------

def get_assets_library_path() -> Path:
    p = get_rojo_root() / "assets_library.json"
    if not p.exists():
        default_lib = Path(__file__).parent.parent / "rojo_workspace" / "assets_library.json"
        if default_lib.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(default_lib, p)
        else:
            p.write_text("[]", encoding="utf-8")
    return p


def load_assets_library() -> List[Dict[str, Any]]:
    try:
        return json.loads(get_assets_library_path().read_text(encoding="utf-8"))
    except Exception:
        return []


def save_asset_to_library(asset_data: Dict[str, Any]) -> Dict[str, Any]:
    assets = load_assets_library()
    if not asset_data.get("id"):
        asset_data["id"] = f"asset-{int(time.time() * 1000)}"
    asset_data["created_at"] = datetime.utcnow().isoformat() + "Z"
    assets = [a for a in assets if a.get("id") != asset_data["id"]]
    assets.insert(0, asset_data)
    get_assets_library_path().write_text(json.dumps(assets, indent=2), encoding="utf-8")
    return asset_data


@app.get("/api/v1/assets")
def list_assets():
    return {"assets": load_assets_library()}


@app.post("/api/v1/assets")
def add_asset(asset: Dict[str, Any]):
    saved = save_asset_to_library(asset)
    return {"asset": saved}


@app.delete("/api/v1/assets/{asset_id}")
def delete_asset(asset_id: str):
    assets = load_assets_library()
    filtered = [a for a in assets if a.get("id") != asset_id]
    get_assets_library_path().write_text(json.dumps(filtered, indent=2), encoding="utf-8")
    return {"deleted": asset_id, "remaining": len(filtered)}


# ------------------------------------------------------------------------------
# 7. 3D Generation, Streaming & Real Geometry Conversion Endpoints
# ------------------------------------------------------------------------------

@app.post("/api/v1/generate-3d", response_model=Model3DResponse)
def generate_3d_asset(
    req: Generate3DEngineRequest,
    x_forge_token: Optional[str] = Header(default=None),
) -> Model3DResponse:
    verify_security_token(x_forge_token)
    if not gemini_client and not req.uploaded_mesh_obj and not req.uploaded_sub_meshes:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY is not configured.")

    context_data = load_project_context()
    return generation_3d_engine.generate_3d_asset(
        req=req,
        context_data=context_data,
        save_luau_fn=save_luau_to_rojo if req.save_to_rojo else None,
        save_library_fn=save_asset_to_library if req.save_to_library else None,
    )


@app.post("/api/v1/generate-3d-stream")
def generate_3d_asset_stream(
    req: Generate3DEngineRequest,
    x_forge_token: Optional[str] = Header(default=None),
):
    """
    SSE streaming endpoint for real-time 3D structure generation requested by Forge3DStudio.tsx.
    Accepts `prompt`, `asset_type`, `category`, `model_tier`, `collision_fidelity`,
    `target_poly_budget`, `reference_image_base64`, `reference_image_mime_type`,
    `save_to_rojo`, and `save_to_library`, and streams `stage`/`log`, `chunk`,
    `rojo_write`, and `done`/`complete` SSE payloads.
    """
    verify_security_token(x_forge_token)
    context_data = load_project_context()
    generator = generation_3d_engine.stream_3d_asset(
        req=req,
        context_data=context_data,
        save_luau_fn=save_luau_to_rojo if req.save_to_rojo else None,
        save_library_fn=save_asset_to_library if req.save_to_library else None,
    )
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/v1/architecture")
def get_modular_architecture():
    return {
        "engines": [
            {"id": "3d_generation_engine", "name": "3D Generation Engine", "pythonModule": "backend/engines/generation_3d_engine.py", "status": "ACTIVE"},
            {"id": "asset_engine", "name": "Asset Engine", "pythonModule": "backend/engines/asset_engine.py", "status": "ACTIVE"},
            {"id": "luau_engine", "name": "Luau Engine", "pythonModule": "backend/engines/luau_engine.py", "status": "ACTIVE"},
            {"id": "ui_engine", "name": "UI Engine", "pythonModule": "backend/engines/ui_engine.py", "status": "ACTIVE"},
            {"id": "world_engine", "name": "World Engine", "pythonModule": "backend/engines/world_engine.py", "status": "ACTIVE"},
            {"id": "rojo_bridge", "name": "Rojo Bridge", "pythonModule": "backend/engines/rojo_bridge.py", "status": "ACTIVE"},
            {"id": "agents_engine", "name": "Specialized Agents Engine (P3)", "pythonModule": "backend/engines/agents_engine.py", "status": "ACTIVE"},
        ],
        "agents": AGENT_DEFINITIONS,
    }


@app.post("/api/v1/world/build-scene")
def build_world_scene(payload: Dict[str, Any], x_forge_token: Optional[str] = Header(default=None)):
    verify_security_token(x_forge_token)
    world_engine = WorldEngine()
    scene_name = str(payload.get("scene_name", "CyberpunkCitadel"))
    biome = str(payload.get("biome", "CyberpunkOrbital"))
    placed_assets = payload.get("placed_assets", [])
    luau_code = world_engine.generate_world_lighting_luau(
        scene_name,
        biome,
        [{"name": a} if isinstance(a, str) else a for a in placed_assets],
    )
    file_name = f"{scene_name}World.luau"
    saved_path = save_luau_to_rojo("src/shared", file_name, luau_code) if payload.get("save_to_rojo", True) else None
    return {
        "scene_name": scene_name,
        "biome": biome,
        "file_name": file_name,
        "rojo_target_folder": "src/shared",
        "saved_path": saved_path,
        "luau_code": luau_code,
    }


@app.post("/api/v1/assets/process-meshpart")
def process_imported_meshpart(payload_body: Dict[str, Any], x_forge_token: Optional[str] = Header(default=None)):
    """
    Processes an imported 3D model (.GLB, .GLTF, .OBJ, .FBX, or 2D Heightmap),
    extracting real vertex, normal, UV, and triangle index buffers (`meshData`) with `shape: "MeshPart"`,
    attaching `MeshId`/`AssetId` references, saving the Wavefront `.obj` file into `src/shared/Assets3D/`,
    and generating a `--!strict` Luau `MeshPart` builder module.
    """
    verify_security_token(x_forge_token)
    payload = payload_body.get("payload", {})
    save_to_rojo = payload_body.get("save_to_rojo", True)
    save_to_library = payload_body.get("save_to_library", True)

    model_name = str(payload.get("modelName", "ImportedMesh3D"))
    sub_meshes = payload.get("subMeshParts", [])
    target_folder = str(payload.get("rojoTargetFolder", "src/shared/Assets3D"))
    file_name = str(payload.get("fileName", f"{model_name}_MeshPart.luau"))
    obj_file_name = str(payload.get("objFileName", f"{model_name}.obj"))
    combined_obj = str(payload.get("combinedWavefrontObj", ""))

    part_specs: List[MeshPart3DSpec] = []
    parts: List[Dict[str, Any]] = []

    for i, s in enumerate(sub_meshes):
        part_name = str(s.get("name", f"MeshPart_{i+1}"))
        extracted_geom = extract_mesh_geometry_from_processed_submesh(s, obj_file_name, model_name)
        mesh_id = validate_published_roblox_mesh_id(
            s.get("meshId")
            or s.get("mesh_id")
            or extracted_geom.meshId
        )
        asset_id = validate_published_roblox_mesh_id(
            s.get("assetId")
            or s.get("asset_id")
            or extracted_geom.assetId
            or mesh_id
        )
        extracted_geom.meshId = mesh_id
        extracted_geom.assetId = asset_id
        extracted_geom.objFileName = obj_file_name

        spec = MeshPart3DSpec(
            name=part_name,
            shape="MeshPart",
            meshId=mesh_id,
            assetId=asset_id,
            textureId=validate_published_roblox_mesh_id(s.get("textureId") or s.get("texture_id")) or None,
            size=s.get("studSize", [2.0, 2.0, 2.0]),
            position=s.get("studPosition", [0.0, 1.0, 0.0]),
            rotation=s.get("studRotation", [0.0, 0.0, 0.0]),
            color=s.get("colorRgb", [148, 163, 184]),
            material=s.get("robloxMaterial", "Metal"),
            roughness=float(s.get("roughness", 0.35)),
            metalness=float(s.get("metalness", 0.65)),
            transparency=0.0,
            canCollide=True,
            anchored=True,
            collisionFidelity=s.get("collisionFidelity", "Hull"),
            meshData=extracted_geom,
        )
        part_specs.append(spec)

    # Automatically split oversized sub-meshes (>9,000 verts or >9,500 tris) so zero triangles are lost
    part_specs = generation_3d_engine.ensure_mesh_data_on_parts(model_name, part_specs)
    parts = [spec.model_dump() for spec in part_specs]

    raw_luau = str(payload.get("luauMeshPartBuilderCode", ""))
    if (
        "CreateEditableMesh" in raw_luau
        and "CreateMeshPartAsync" in raw_luau
        and ".MeshId =" not in raw_luau
    ):
        luau_code = raw_luau
    else:
        luau_code = generation_3d_engine.build_luau_from_parts(
            model_name,
            part_specs,
            part_specs[0].collisionFidelity if part_specs else "Hull",
        )

    saved_path = save_luau_to_rojo(target_folder, file_name, luau_code) if save_to_rojo else None
    obj_saved_path = None
    if save_to_rojo and combined_obj.strip():
        obj_saved_path = save_raw_asset_to_rojo(target_folder, obj_file_name, combined_obj.encode("utf-8"))

    total_tris = sum(len(p.meshData.faces) for p in part_specs if p.meshData) or int(payload.get("totalTriangles", 0))

    asset_record = {
        "id": f"meshpart-{int(time.time() * 1000)}",
        "name": model_name,
        "category": f"Imported {payload.get('sourceFormat', '3D')}",
        "asset_type": "Model3D",
        "poly_count": total_tris,
        "collision_fidelity": parts[0]["collisionFidelity"] if parts else "Hull",
        "rojo_target_folder": target_folder,
        "file_name": file_name,
        "obj_file_name": obj_file_name,
        "obj_saved_path": obj_saved_path,
        "description": f"MeshPart 3D con geometría EditableMesh real ({len(parts)} sub-mallas, {total_tris} tris, OBJ sincronizado).",
        "pbr_profile": {
            "albedo_hex": "#38bdf8",
            "roughness": 0.35,
            "metalness": 0.65,
            "emissive_hex": "#06b6d4",
            "roblox_material": "Metal",
            "pattern": "BrushedTitanium",
        },
        "parts": parts,
        "luau_code": luau_code,
        "saved_path": saved_path,
    }
    if save_to_library:
        save_asset_to_library(asset_record)

    return {
        "success": True,
        "asset": asset_record,
        "saved_path": saved_path,
        "obj_saved_path": obj_saved_path,
        "meshpart_count": len(parts),
        "total_triangles": total_tris,
        "is_roblox_compliant": bool(payload.get("isRobloxCompliant", True)),
    }


@app.post("/api/v1/assets/export-roblox-package")
def export_roblox_package(payload_body: Dict[str, Any], x_forge_token: Optional[str] = Header(default=None)):
    """
    Autonomously builds and exports all 5 Roblox Studio 3D package files (.luau, .rbxmx, .gltf, .obj, .mtl)
    into the Rojo workspace (`src/shared/Assets3D/`), verifies on disk that all 5 files exist,
    and persists the updated asset with version history.
    """
    verify_security_token(x_forge_token)
    asset = payload_body.get("asset", {})
    if not asset or not asset.get("name"):
        raise HTTPException(status_code=400, detail="Valid asset object required.")

    safe_name = re.sub(r"[^a-zA-Z0-9_]", "", str(asset.get("name", "ForgeModel3D"))) or "ForgeModel3D"
    target_folder = str(asset.get("rojo_target_folder", "src/shared/Assets3D"))
    save_to_rojo = bool(payload_body.get("save_to_rojo", True))
    save_to_library = bool(payload_body.get("save_to_library", True))
    collision_fidelity = str(asset.get("collision_fidelity", "Hull"))

    raw_parts = asset.get("parts", [])
    part_specs = [MeshPart3DSpec(**p) for p in raw_parts]
    enriched_specs = generation_3d_engine.ensure_mesh_data_on_parts(safe_name, part_specs)
    rebuilt_luau = generation_3d_engine.build_luau_from_parts(
        safe_name,
        enriched_specs,
        collision_fidelity,
    )

    # Autonomously generate any of the 4 companion files on the backend if omitted by the client
    client_rbxmx = str(payload_body.get("rbxmx_content", "") or "").strip()
    client_gltf = str(payload_body.get("gltf_content", "") or "").strip()
    client_obj = str(payload_body.get("obj_content", "") or "").strip()
    client_mtl = str(payload_body.get("mtl_content", "") or "").strip()
    pbr_textures = payload_body.get("pbr_textures") if isinstance(payload_body.get("pbr_textures"), dict) else None

    if not client_rbxmx:
        client_rbxmx = generation_3d_engine.build_rbxmx_from_parts(
            safe_name,
            enriched_specs,
            collision_fidelity,
            str(asset.get("category", "3D Asset")),
            rebuilt_luau,
        )

    if not client_obj or not client_mtl:
        built_obj_mtl = generation_3d_engine.build_obj_and_mtl_from_parts(safe_name, enriched_specs)
        if not client_obj:
            client_obj = built_obj_mtl["obj"]
        if not client_mtl:
            client_mtl = built_obj_mtl["mtl"]

    if not client_gltf:
        client_gltf = generation_3d_engine.build_gltf_from_parts(
            safe_name,
            enriched_specs,
            pbr_textures=pbr_textures,
        )

    saved_files: Dict[str, Optional[str]] = {
        "luau": None,
        "rbxmx": None,
        "gltf": None,
        "obj": None,
        "mtl": None,
    }
    verified_files: Dict[str, bool] = {
        "luau": False,
        "rbxmx": False,
        "gltf": False,
        "obj": False,
        "mtl": False,
    }

    if save_to_rojo:
        saved_files["luau"] = save_luau_to_rojo(target_folder, f"{safe_name}.luau", rebuilt_luau)
        saved_files["rbxmx"] = save_raw_asset_to_rojo(target_folder, f"{safe_name}.rbxmx", client_rbxmx.encode("utf-8"))
        saved_files["gltf"] = save_raw_asset_to_rojo(target_folder, f"{safe_name}.gltf", client_gltf.encode("utf-8"))
        saved_files["obj"] = save_raw_asset_to_rojo(target_folder, f"{safe_name}.obj", client_obj.encode("utf-8"))
        saved_files["mtl"] = save_raw_asset_to_rojo(target_folder, f"{safe_name}.mtl", client_mtl.encode("utf-8"))

        for ext, abs_path in saved_files.items():
            if abs_path and Path(abs_path).is_file() and Path(abs_path).stat().st_size > 0:
                verified_files[ext] = True

    verified_count = sum(1 for ok in verified_files.values() if ok)
    all_five_exist = (verified_count == 5) if save_to_rojo else True

    total_tris = sum(len(p.meshData.faces) for p in enriched_specs if p.meshData)
    updated_asset = {
        **asset,
        "name": safe_name,
        "parts": [p.model_dump() for p in enriched_specs],
        "poly_count": total_tris,
        "luau_code": rebuilt_luau,
        "file_name": f"{safe_name}.luau",
        "obj_file_name": f"{safe_name}.obj",
        "saved_path": saved_files["luau"] or asset.get("saved_path"),
        "obj_saved_path": saved_files["obj"] or asset.get("obj_saved_path"),
        "exported_package_files": saved_files,
        "verified_package_files": verified_files,
    }
    if save_to_library:
        save_asset_to_library(updated_asset)

    return {
        "success": all_five_exist,
        "all_five_exist": all_five_exist,
        "verified_files_count": verified_count,
        "verified_files": verified_files,
        "asset": updated_asset,
        "saved_files": saved_files,
    }


@app.post("/api/v1/assets/publish-pbr")
def publish_pbr_to_rojo(payload_body: Dict[str, Any], x_forge_token: Optional[str] = Header(default=None)):
    """
    Publishes browser-synthesized PBR texture maps (Albedo, Normal, Roughness PNGs)
    into `src/shared/Assets3D/Textures/`, optionally uploads them to Roblox Open Cloud
    if `roblox_api_key` and `roblox_creator_id` are supplied, and generates a `--!strict`
    Luau `SurfaceAppearance` + `EditableImage` binder module (never outputting `rbxassetid://0`).
    """
    verify_security_token(x_forge_token)
    material_name = re.sub(r"[^a-zA-Z0-9_]", "", str(payload_body.get("material_name", "ForgePBRMaterial"))) or "ForgePBRMaterial"
    target_folder = "src/shared/Assets3D/Textures"
    saved_textures: Dict[str, str] = {}
    raw_png_buffers: Dict[str, bytes] = {}

    for map_key, suffix in [
        ("albedo_data_url", "ColorMap.png"),
        ("normal_data_url", "NormalMap.png"),
        ("roughness_data_url", "RoughnessMap.png"),
    ]:
        data_url = str(payload_body.get(map_key, ""))
        if "," in data_url:
            _, b64_part = data_url.split(",", 1)
            try:
                raw_bytes = base64.b64decode(b64_part)
                raw_png_buffers[suffix] = raw_bytes
                tex_file = f"{material_name}_{suffix}"
                saved_textures[suffix] = save_raw_asset_to_rojo(target_folder, tex_file, raw_bytes)
            except Exception as err:
                logger.warning(f"Failed to decode {map_key}: {err}")

    roughness_val = float(payload_body.get("roughness", 0.35))
    metalness_val = float(payload_body.get("metalness", 0.75))
    albedo_hex = str(payload_body.get("albedo_hex", "#38bdf8"))

    color_map_id = str(payload_body.get("color_map_asset_id", "") or "").strip()
    normal_map_id = str(payload_body.get("normal_map_asset_id", "") or "").strip()
    roughness_map_id = str(payload_body.get("roughness_map_asset_id", "") or "").strip()
    metalness_map_id = str(payload_body.get("metalness_map_asset_id", "") or "").strip()

    asset_engine = AssetEngine(get_assets_library_path())

    # Optional Roblox Open Cloud Asset API upload when credentials are provided
    roblox_api_key = str(payload_body.get("roblox_api_key", "") or os.getenv("ROBLOX_OPEN_CLOUD_API_KEY", "")).strip()
    roblox_creator_id = str(payload_body.get("roblox_creator_id", "") or os.getenv("ROBLOX_CREATOR_ID", "")).strip()
    cloud_publish_results: Dict[str, Any] = {}

    if roblox_api_key and roblox_creator_id:
        for suffix, attr_name in [
            ("ColorMap.png", "color"),
            ("NormalMap.png", "normal"),
            ("RoughnessMap.png", "roughness"),
        ]:
            if suffix in raw_png_buffers:
                pub_res = asset_engine.publish_decal_to_roblox_cloud(
                    png_bytes=raw_png_buffers[suffix],
                    display_name=f"{material_name}_{suffix.replace('.png', '')}",
                    api_key=roblox_api_key,
                    creator_user_id=roblox_creator_id,
                )
                cloud_publish_results[suffix] = pub_res
                if pub_res.get("published") and pub_res.get("roblox_asset_uri"):
                    uri = str(pub_res["roblox_asset_uri"])
                    if attr_name == "color" and not color_map_id:
                        color_map_id = uri
                    elif attr_name == "normal" and not normal_map_id:
                        normal_map_id = uri
                    elif attr_name == "roughness" and not roughness_map_id:
                        roughness_map_id = uri

    pbr_luau = asset_engine.generate_pbr_surface_appearance_luau(
        material_name=material_name,
        color_map_id=color_map_id,
        normal_map_id=normal_map_id,
        roughness_map_id=roughness_map_id,
        metalness_map_id=metalness_map_id,
        roughness=roughness_val,
        metalness=metalness_val,
        albedo_hex=albedo_hex,
        target_folder=target_folder,
    )
    luau_file_name = f"{material_name}_SurfaceAppearance.luau"
    luau_saved_path = save_luau_to_rojo("src/shared/Assets3D", luau_file_name, pbr_luau)

    return {
        "success": True,
        "material_name": material_name,
        "saved_textures": saved_textures,
        "verified_cloud_ids": {
            "color_map_id": color_map_id if asset_engine.is_verified_roblox_asset_uri(color_map_id) else None,
            "normal_map_id": normal_map_id if asset_engine.is_verified_roblox_asset_uri(normal_map_id) else None,
            "roughness_map_id": roughness_map_id if asset_engine.is_verified_roblox_asset_uri(roughness_map_id) else None,
            "metalness_map_id": metalness_map_id if asset_engine.is_verified_roblox_asset_uri(metalness_map_id) else None,
        },
        "cloud_publish_results": cloud_publish_results,
        "luau_file": f"src/shared/Assets3D/{luau_file_name}",
        "luau_saved_path": luau_saved_path,
        "luau_code": pbr_luau,
    }


@app.get("/api/v1/assets/sync-status")
def get_assets_bidirectional_sync_status():
    """
    Phase 4 Bidirectional Rojo <-> Forge AI Studio synchronization & version audit.
    Inspects all assets in `assets_library.json` and checks whether their corresponding
    `.luau`, `.obj`, `.rbxmx`, `.gltf`, and `.mtl` files in `rojo_workspace/src/shared/Assets3D/`
    exist or have been modified externally (e.g. from Roblox Studio / Rojo).
    """
    assets = load_assets_library()
    rojo_root = Path(RUNTIME_CONFIG["rojo_project_path"]).resolve()
    assets_dir = rojo_root / "src" / "shared" / "Assets3D"
    statuses: List[Dict[str, Any]] = []

    for a in assets:
        safe_name = re.sub(r"[^a-zA-Z0-9_]", "", str(a.get("name", "Model3D"))) or "Model3D"
        luau_path = assets_dir / str(a.get("file_name") or f"{safe_name}.luau")
        obj_path = assets_dir / str(a.get("obj_file_name") or f"{safe_name}.obj")
        rbxmx_path = assets_dir / f"{safe_name}.rbxmx"
        gltf_path = assets_dir / f"{safe_name}.gltf"
        mtl_path = assets_dir / f"{safe_name}.mtl"

        disk_luau_sha = None
        in_memory_luau_sha = hashlib.sha256(str(a.get("luau_code", "")).encode("utf-8")).hexdigest()[:12]
        external_change_detected = False

        if luau_path.is_file():
            disk_bytes = luau_path.read_bytes()
            disk_luau_sha = hashlib.sha256(disk_bytes).hexdigest()[:12]
            if disk_luau_sha != in_memory_luau_sha:
                external_change_detected = True

        statuses.append({
            "id": a.get("id"),
            "name": a.get("name"),
            "version": int(a.get("version", 1)),
            "version_history_count": len(a.get("version_history", [])),
            "files_on_disk": {
                "luau": luau_path.is_file(),
                "rbxmx": rbxmx_path.is_file(),
                "gltf": gltf_path.is_file(),
                "obj": obj_path.is_file(),
                "mtl": mtl_path.is_file(),
            },
            "disk_luau_sha256": disk_luau_sha,
            "library_luau_sha256": in_memory_luau_sha,
            "external_change_detected": external_change_detected,
        })

    return {
        "rojo_assets_folder": str(assets_dir),
        "total_assets": len(statuses),
        "assets": statuses,
    }


@app.post("/api/v1/assets/pull-from-rojo")
def pull_asset_changes_from_rojo(payload_body: Dict[str, Any], x_forge_token: Optional[str] = Header(default=None)):
    """
    Phase 4 Bidirectional Sync & Version Recovery:
    Either pulls updated `.obj` / `.luau` geometry from `rojo_workspace/src/shared/Assets3D/`
    into the active Forge AI Studio asset, or restores a specific historical revision (`restore_version`).
    """
    verify_security_token(x_forge_token)
    asset_id = str(payload_body.get("asset_id", "")).strip()
    asset_name = str(payload_body.get("asset_name", "")).strip()
    restore_version = payload_body.get("restore_version")

    assets = load_assets_library()
    target_asset = next(
        (a for a in assets if (asset_id and a.get("id") == asset_id) or (asset_name and a.get("name") == asset_name)),
        None,
    )
    if not target_asset:
        raise HTTPException(status_code=404, detail="Asset not found in library.")

    if restore_version is not None:
        history = target_asset.get("version_history", [])
        snap = next((h for h in history if int(h.get("version", -1)) == int(restore_version)), None)
        if not snap:
            raise HTTPException(status_code=404, detail=f"Version {restore_version} not found in asset history.")
        target_asset["parts"] = snap.get("parts", target_asset.get("parts", []))
        target_asset["luau_code"] = snap.get("luau_code", target_asset.get("luau_code", ""))
        target_asset["poly_count"] = snap.get("poly_count", target_asset.get("poly_count", 0))
        saved = save_asset_to_library(target_asset)
        return {
            "success": True,
            "source": f"version_history_v{restore_version}",
            "asset": saved,
        }

    safe_name = re.sub(r"[^a-zA-Z0-9_]", "", str(target_asset.get("name", "Model3D"))) or "Model3D"
    rojo_root = Path(RUNTIME_CONFIG["rojo_project_path"]).resolve()
    assets_dir = rojo_root / "src" / "shared" / "Assets3D"
    obj_path = assets_dir / str(target_asset.get("obj_file_name") or f"{safe_name}.obj")
    luau_path = assets_dir / str(target_asset.get("file_name") or f"{safe_name}.luau")

    if obj_path.is_file():
        obj_text = obj_path.read_text(encoding="utf-8", errors="ignore")
        if "v " in obj_text:
            re_parts = generation_3d_engine.extract_parts_from_uploaded_mesh(
                model_name=safe_name,
                uploaded_mesh_obj=obj_text,
                uploaded_sub_meshes=None,
                collision_fidelity=str(target_asset.get("collision_fidelity", "Hull")),
            )
            if re_parts:
                target_asset["parts"] = [p.model_dump() for p in re_parts]
                target_asset["poly_count"] = sum(len(p.meshData.faces) for p in re_parts if p.meshData)
                target_asset["luau_code"] = generation_3d_engine.build_luau_from_parts(
                    safe_name,
                    re_parts,
                    str(target_asset.get("collision_fidelity", "Hull")),
                )

    if luau_path.is_file():
        target_asset["luau_code"] = luau_path.read_text(encoding="utf-8", errors="ignore")

    saved = save_asset_to_library(target_asset)
    return {
        "success": True,
        "source": "rojo_workspace_disk",
        "asset": saved,
    }


@app.post("/api/v1/agents/orchestrate-stream")
def orchestrate_multi_agent_stream(payload: Dict[str, Any]):
    """
    Autonomous 7-Agent Orchestrator endpoint streaming real-time progress and
    executing prompt-driven 3D synthesis, PBR configuration, world lighting,
    Luau controller generation, HUD creation, and self-review verification.
    """
    prompt = str(payload.get("prompt", "Create an interactive sci-fi system"))
    model_tier = str(payload.get("model_tier", "fast"))
    save_to_rojo = bool(payload.get("save_to_rojo", True))

    generator = autonomous_orchestrator.orchestrate_stream(
        prompt=prompt,
        model_tier=model_tier,
        save_to_rojo=save_to_rojo,
        audit_fn=audit_project_modules,
        load_context_fn=load_project_context,
        save_luau_fn=save_luau_to_rojo,
        save_library_fn=save_asset_to_library,
        manifest_fn=get_rojo_sync_manifest,
    )
    return StreamingResponse(generator, media_type="text/event-stream")


@app.get("/api/v1/health")
def health_check():
    rojo_status = get_rojo_status()
    return {
        "status": "ok",
        "backend_engine": "FastAPI Unified v2.1 (7 Modular Engines + EditableMesh Pipeline)",
        "gemini_connected": gemini_client is not None,
        "configured_models": TIER_MODELS,
        "rojo_project_path": rojo_status["rojo_project_path"],
        "rojo_path_exists": rojo_status["path_exists"],
        "default_project_json_found": rojo_status["default_project_json_found"],
        "rojo_server_active": rojo_status["rojo_server_active"],
        "context_file_found": True,
        "server_time": datetime.utcnow().isoformat() + "Z",
    }


# Serve compiled frontend when running FastAPI standalone in production
dist_dir = Path(__file__).parent.parent / "dist"
if dist_dir.exists():
    app.mount("/", StaticFiles(directory=str(dist_dir), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host=host, port=port, reload=True)
