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
from engines.asset_engine import (
    AssetEngine,
    compute_fnv1a_32_hex,
    normalize_parts_with_sync_metadata,
    validate_and_decode_png_bytes,
)
from engines.world_engine import WorldEngine
from engines.agents_engine import AGENT_DEFINITIONS, AutonomousMultiAgentOrchestrator
from engines.context_pruner import (
    AI_MODULE_CONTRACTS,
    build_ai_self_understanding_manifest,
    build_pruned_domain_context,
)

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
            raw_bytes = luau_file.read_bytes()
            raw_text = raw_bytes.decode("utf-8", errors="ignore")
            existing_files.append({
                "name": module_name,
                "relative_path": rel_path,
                "sha256": hashlib.sha256(raw_bytes).hexdigest()[:12],
                "content_fnv32": compute_fnv1a_32_hex(raw_text),
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


def get_pruned_project_context_details(domain: str = "luau") -> Dict[str, Any]:
    """
    Reads project_context.md, appends the verified on-disk Rojo module manifest,
    and slices the context to ONLY the semantic blocks needed for `domain`.
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
    return build_pruned_domain_context(raw_context, verification_note, domain)


def load_project_context(domain: str = "luau") -> str:
    """
    Returns the domain-pruned context string ready for Gemini prompt injection.
    """
    return get_pruned_project_context_details(domain)["prompt_context"]


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
        "bridge_connected": _bridge_is_connected(),
        "bridge_status": _get_public_bridge_status(),
    }


# ------------------------------------------------------------------------------
# 5b. Forge Local Bridge Cloud Coordinator State & Endpoints (FastAPI Parity)
# ------------------------------------------------------------------------------

_BRIDGE_STATE: Dict[str, Any] = {
    "session_id": None,
    "session_token": None,
    "session_expires_at": 0.0,
    "bridge_version": "1.0.0",
    "last_heartbeat_at": 0.0,
    "reconnect_requested": False,
    "rojo_remote_status": None,
    "studio_remote_state": None,
    "queue_metrics": {},
    "pending_tasks": {},
    "recent_results": [],
    "recent_errors": [],
}


def _bridge_is_connected() -> bool:
    sid = _BRIDGE_STATE["session_id"]
    if not sid or time.time() > _BRIDGE_STATE["session_expires_at"] or _BRIDGE_STATE["reconnect_requested"]:
        return False
    return (time.time() - _BRIDGE_STATE["last_heartbeat_at"]) < 12.0


def _get_public_bridge_status() -> Dict[str, Any]:
    pending_list = [
        {
            "taskId": item["envelope"]["taskId"],
            "operation": item["envelope"]["operation"],
            "status": item["status"],
            "correlationId": item["envelope"]["correlationId"],
            "timestamp": item["envelope"]["timestamp"],
        }
        for item in _BRIDGE_STATE["pending_tasks"].values()
    ]
    return {
        "bridgeConnected": _bridge_is_connected(),
        "bridgeVersion": _BRIDGE_STATE["bridge_version"],
        "protocolVersion": "1.0",
        "sessionActive": bool(_BRIDGE_STATE["session_id"] and time.time() < _BRIDGE_STATE["session_expires_at"]),
        "lastHeartbeatAt": (
            datetime.utcfromtimestamp(_BRIDGE_STATE["last_heartbeat_at"]).isoformat() + "Z"
            if _BRIDGE_STATE["last_heartbeat_at"] > 0
            else None
        ),
        "activeProject": (_BRIDGE_STATE["rojo_remote_status"] or {}).get("projectName"),
        "rojo": _BRIDGE_STATE["rojo_remote_status"]
        or {
            "projectName": None,
            "projectConnected": False,
            "defaultProjectJsonFound": False,
            "rojoCliInstalled": False,
            "rojoVersion": None,
            "rojoServePort": 34872,
            "rojoServerListening": False,
            "syncedFilesCount": 0,
        },
        "robloxStudio": _BRIDGE_STATE["studio_remote_state"]
        or {
            "connected": False,
            "lastSeenAt": None,
            "pluginVersion": None,
            "placeName": None,
            "selectedModelName": None,
            "selectedPartCount": 0,
            "pendingDestructiveConfirmations": 0,
        },
        "pendingTasksCount": len(pending_list),
        "pendingTasks": pending_list,
        "recentResults": _BRIDGE_STATE["recent_results"][-10:],
        "recentErrors": _BRIDGE_STATE["recent_errors"][-10:],
        "queueMetrics": _BRIDGE_STATE["queue_metrics"],
    }


def _bridge_get_shared_secret() -> str:
    return (
        os.environ.get("FORGE_BRIDGE_SHARED_SECRET")
        or os.environ.get("FORGE_SECURITY_TOKEN")
        or os.environ.get("FORGE_LOCAL_TOKEN")
        or ""
    ).strip()


def _bridge_sign_envelope(env: Dict[str, Any]) -> str:
    import hashlib
    import hmac
    secret = _bridge_get_shared_secret()
    if not secret:
        return ""
    payload_str = json.dumps(env.get("payload") or {}, separators=(",", ":"))
    canonical = "|".join([
        str(env.get("protocolVersion", "1.0")),
        str(env.get("taskId", "")),
        str(env.get("sessionId", "")),
        str(env.get("operation", "")),
        str(env.get("timestamp", "")),
        str(env.get("correlationId", "")),
        payload_str,
    ])
    return hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()


def _bridge_verify_session_request(request: Request) -> bool:
    if (
        not _BRIDGE_STATE["session_id"]
        or time.time() > _BRIDGE_STATE["session_expires_at"]
        or _BRIDGE_STATE["reconnect_requested"]
    ):
        return False
    auth_header = request.headers.get("authorization", "")
    bearer = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
    if bearer and _BRIDGE_STATE["session_token"] and bearer == _BRIDGE_STATE["session_token"]:
        return True
    secret = _bridge_get_shared_secret()
    forge_tok = request.headers.get("x-forge-token", "").strip()
    sess_hdr = request.headers.get("x-bridge-session", "").strip()
    if secret and forge_tok == secret and (not sess_hdr or sess_hdr == _BRIDGE_STATE["session_id"]):
        return True
    return not secret and bool(_BRIDGE_STATE["session_id"])


@app.post("/api/v1/bridge/auth/handshake")
def bridge_auth_handshake(request: Request, body: Dict[str, Any]):
    import hashlib
    import hmac
    import secrets
    secret = _bridge_get_shared_secret()
    bridge_version = str(body.get("bridgeVersion", "1.0.0")).strip()
    protocol_version = str(body.get("protocolVersion", "1.0")).strip()
    timestamp = str(body.get("timestamp", "")).strip()
    nonce = str(body.get("nonce", "")).strip()
    signature = str(body.get("signature", "")).strip()
    header_tok = request.headers.get("x-forge-token", "").strip()

    if secret:
        canonical = f"{bridge_version}|{protocol_version}|{timestamp}|{nonce}"
        expected_sig = hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
        sig_ok = bool(signature) and hmac.compare_digest(signature, expected_sig)
        tok_ok = bool(header_tok) and hmac.compare_digest(header_tok, secret)
        if not sig_ok and not tok_ok:
            raise HTTPException(status_code=401, detail="Invalid HMAC signature or shared secret in handshake.")

    sid = f"sess_{secrets.token_hex(12)}"
    stoken = secrets.token_hex(24)
    expires_ms = int((time.time() + 3600) * 1000)
    _BRIDGE_STATE["session_id"] = sid
    _BRIDGE_STATE["session_token"] = stoken
    _BRIDGE_STATE["session_expires_at"] = time.time() + 3600
    _BRIDGE_STATE["bridge_version"] = bridge_version
    _BRIDGE_STATE["last_heartbeat_at"] = time.time()
    _BRIDGE_STATE["reconnect_requested"] = False
    if isinstance(body.get("rojoStatus"), dict):
        _BRIDGE_STATE["rojo_remote_status"] = body["rojoStatus"]
    if isinstance(body.get("studioState"), dict):
        _BRIDGE_STATE["studio_remote_state"] = body["studioState"]
    return {
        "accepted": True,
        "sessionId": sid,
        "sessionToken": stoken,
        "expiresAt": expires_ms,
        "wsSupported": False,
    }


@app.post("/api/v1/bridge/heartbeat")
def bridge_heartbeat(request: Request, body: Dict[str, Any]):
    if not _bridge_verify_session_request(request):
        raise HTTPException(status_code=401, detail="Bridge session expired or reconnect requested.")
    _BRIDGE_STATE["last_heartbeat_at"] = time.time()
    if isinstance(body.get("rojoStatus"), dict):
        _BRIDGE_STATE["rojo_remote_status"] = body["rojoStatus"]
    if isinstance(body.get("studioState"), dict):
        _BRIDGE_STATE["studio_remote_state"] = body["studioState"]
    if isinstance(body.get("queueMetrics"), dict):
        _BRIDGE_STATE["queue_metrics"] = body["queueMetrics"]
    pending = []
    for item in _BRIDGE_STATE["pending_tasks"].values():
        if item["status"] == "queued":
            env = dict(item["envelope"])
            env["sessionId"] = _BRIDGE_STATE["session_id"] or env.get("sessionId", "")
            env["signature"] = _bridge_sign_envelope(env)
            pending.append(env)
    return {"pendingTasks": pending}


@app.post("/api/v1/bridge/task-ack")
def bridge_task_ack(request: Request, body: Dict[str, Any]):
    if not _bridge_verify_session_request(request):
        raise HTTPException(status_code=401, detail="Unauthorized bridge session.")
    tid = str(body.get("taskId", ""))
    if tid in _BRIDGE_STATE["pending_tasks"]:
        _BRIDGE_STATE["pending_tasks"][tid]["status"] = "acked"
        return {"acked": True}
    return {"acked": False}


@app.post("/api/v1/bridge/task-result")
def bridge_task_result(request: Request, body: Dict[str, Any]):
    if not _bridge_verify_session_request(request):
        raise HTTPException(status_code=401, detail="Unauthorized bridge session.")
    tid = str(body.get("taskId", ""))
    _BRIDGE_STATE["pending_tasks"].pop(tid, None)
    _BRIDGE_STATE["recent_results"].append(body)
    if body.get("status") in ("failed", "timeout"):
        _BRIDGE_STATE["recent_errors"].append({
            "taskId": tid,
            "operation": body.get("operation", "unknown"),
            "error": body.get("error", "Error"),
            "timestamp": body.get("timestamp", datetime.utcnow().isoformat() + "Z"),
        })
    return {"accepted": True}


@app.get("/api/v1/bridge/status")
def bridge_get_status():
    return _get_public_bridge_status()


@app.post("/api/v1/bridge/reconnect")
def bridge_request_reconnect():
    _BRIDGE_STATE["reconnect_requested"] = True
    _BRIDGE_STATE["session_expires_at"] = 0.0
    return {
        "reconnecting": True,
        "status": _get_public_bridge_status(),
    }


@app.post("/api/v1/bridge/enqueue")
def bridge_enqueue_task(body: Dict[str, Any]):
    import uuid
    operation = str(body.get("operation", "")).strip()
    if not operation:
        raise HTTPException(status_code=400, detail="Operation is required.")
    tid = f"task_{uuid.uuid4()}"
    cid = f"corr_{int(time.time() * 1000)}"
    envelope: Dict[str, Any] = {
        "protocolVersion": "1.0",
        "taskId": tid,
        "sessionId": _BRIDGE_STATE["session_id"] or "pending_session",
        "operation": operation,
        "payload": body.get("payload") or {},
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "correlationId": cid,
    }
    envelope["signature"] = _bridge_sign_envelope(envelope)
    _BRIDGE_STATE["pending_tasks"][tid] = {
        "envelope": envelope,
        "status": "queued",
    }
    return {"queued": True, "taskId": tid, "correlationId": cid}


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
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("[]", encoding="utf-8")
    return p


def get_asset_engine() -> AssetEngine:
    """
    Returns the single authoritative AssetEngine persistence service for the active Rojo workspace.
    """
    return AssetEngine(get_assets_library_path())


def load_assets_library() -> List[Dict[str, Any]]:
    return get_asset_engine().load_library()


def save_asset_to_library(asset_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Unified persistence wrapper delegating to AssetEngine.upsert_asset()
    (with SHA-256 snapshot deduplication, 20-version history, and full PBR metadata).
    """
    return get_asset_engine().upsert_asset(asset_data)


@app.get("/api/v1/assets")
def list_assets():
    return {"assets": load_assets_library()}


@app.post("/api/v1/assets")
def add_asset(asset: Dict[str, Any]):
    saved = save_asset_to_library(asset)
    return {"asset": saved}


@app.delete("/api/v1/assets/{asset_id}")
def delete_asset(asset_id: str):
    engine = get_asset_engine()
    deleted_ok = engine.delete_asset(asset_id)
    remaining = len(engine.load_library())
    return {"deleted": asset_id, "deleted_ok": deleted_ok, "remaining": remaining}


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

    context_data = load_project_context("3d")
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
    context_data = load_project_context("3d")
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
    domains = ["3d", "pbr", "luau", "ui", "world", "agents"]
    domain_stats = []
    for d in domains:
        pruned = get_pruned_project_context_details(d)
        domain_stats.append({
            "domain": pruned["domain"],
            "includedSections": pruned["included_sections"],
            "originalChars": pruned["raw_char_count"],
            "prunedChars": pruned["pruned_char_count"],
            "reductionPercent": pruned["saved_percentage"],
        })
    return {
        "engines": [
            {"id": "3d_generation_engine", "name": "3D Generation Engine", "pythonModule": "backend/engines/generation_3d_engine.py", "tsModule": "src/server/engines/generation3DEngine.ts", "status": "ACTIVE"},
            {"id": "asset_engine", "name": "Asset Engine", "pythonModule": "backend/engines/asset_engine.py", "tsModule": "src/server/engines/assetEngine.ts", "status": "ACTIVE"},
            {"id": "luau_engine", "name": "Luau Engine", "pythonModule": "backend/engines/luau_engine.py", "tsModule": "src/server/engines/luauEngine.ts", "status": "ACTIVE"},
            {"id": "ui_engine", "name": "UI Engine", "pythonModule": "backend/engines/ui_engine.py", "tsModule": "src/server/engines/uiEngine.ts", "status": "ACTIVE"},
            {"id": "world_engine", "name": "World Engine", "pythonModule": "backend/engines/world_engine.py", "tsModule": "src/server/engines/worldEngine.ts", "status": "ACTIVE"},
            {"id": "rojo_bridge", "name": "Rojo Bridge", "pythonModule": "backend/engines/rojo_bridge.py", "tsModule": "src/server/engines/rojoBridge.ts", "status": "ACTIVE"},
            {"id": "agents_engine", "name": "Specialized Agents Engine (P3)", "pythonModule": "backend/engines/agents_engine.py", "tsModule": "src/server/engines/agentsEngine.ts", "status": "ACTIVE"},
        ],
        "agents": AGENT_DEFINITIONS,
        "ai_manifest": build_ai_self_understanding_manifest(),
        "module_contracts": AI_MODULE_CONTRACTS,
        "domain_pruner_stats": domain_stats,
    }


@app.get("/api/v1/ai-manifest")
def get_ai_manifest():
    domains = ["3d", "pbr", "luau", "ui", "world", "agents"]
    domain_stats = []
    for d in domains:
        pruned = get_pruned_project_context_details(d)
        domain_stats.append({
            "domain": pruned["domain"],
            "includedSections": pruned["included_sections"],
            "originalChars": pruned["raw_char_count"],
            "prunedChars": pruned["pruned_char_count"],
            "reductionPercent": pruned["saved_percentage"],
        })
    return {
        **build_ai_self_understanding_manifest(),
        "domainPrunerStats": domain_stats,
    }


@app.get("/api/v1/context/pruned")
def get_pruned_context(domain: str = "luau"):
    return get_pruned_project_context_details(domain)


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
    Publishes browser-synthesized 4-channel PBR texture maps (Albedo, Normal, Roughness, Metalness PNGs)
    into `src/shared/Assets3D/Textures/`, validates and decodes all 4 PNG buffers (including indexed PLTE/tRNS),
    checks that `target_asset_id` exists before persisting any PBR profile, optionally uploads decals to
    Roblox Open Cloud (with async Operation polling), and reports an honest publication status:
    `local_saved` | `cloud_publishing` | `cloud_published` | `partially_published` | `failed` | `asset_not_found`.
    """
    verify_security_token(x_forge_token)
    material_name = re.sub(r"[^a-zA-Z0-9_]", "", str(payload_body.get("material_name", "ForgePBRMaterial"))) or "ForgePBRMaterial"
    target_asset_id = str(payload_body.get("target_asset_id", "") or "").strip() or None
    target_part_name = str(payload_body.get("target_part_name", "") or "").strip() or None
    target_folder = "src/shared/Assets3D/Textures"

    asset_engine = get_asset_engine()
    existing_asset: Optional[Dict[str, Any]] = None
    if target_asset_id:
        existing_asset = asset_engine.get_asset(target_asset_id)
        if not existing_asset:
            return {
                "success": False,
                "status": "asset_not_found",
                "error": f"El asset destino '{target_asset_id}' no existe en la biblioteca de assets.",
                "material_name": material_name,
                "target_asset_id": target_asset_id,
                "target_part_name": target_part_name,
                "saved_textures": {},
                "published_channels": [],
                "missing_channels": ["ColorMap.png", "NormalMap.png", "RoughnessMap.png", "MetalnessMap.png"],
                "decode_errors": {},
                "channel_status": {
                    "ColorMap.png": "asset_not_found",
                    "NormalMap.png": "asset_not_found",
                    "RoughnessMap.png": "asset_not_found",
                    "MetalnessMap.png": "asset_not_found",
                },
                "is_cloud_published": False,
                "verified_cloud_ids": {},
                "verified_cloud_uris": {},
                "updated_asset": None,
            }

    saved_textures: Dict[str, str] = {}
    raw_png_buffers: Dict[str, bytes] = {}
    decoded_rgba_previews: Dict[str, str] = {}
    png_validation_reports: Dict[str, Any] = {}
    decode_errors: Dict[str, str] = {}
    received_channels: List[str] = []
    missing_channels: List[str] = []
    channel_status: Dict[str, str] = {}

    for map_key, suffix in [
        ("albedo_data_url", "ColorMap.png"),
        ("normal_data_url", "NormalMap.png"),
        ("roughness_data_url", "RoughnessMap.png"),
        ("metalness_data_url", "MetalnessMap.png"),
    ]:
        data_url = str(payload_body.get(map_key, "") or "").strip()
        if not data_url:
            missing_channels.append(suffix)
            channel_status[suffix] = "missing"
            continue
        b64_part = data_url.split(",", 1)[1] if "," in data_url else data_url
        try:
            raw_bytes = base64.b64decode(b64_part, validate=False)
            validation = validate_and_decode_png_bytes(raw_bytes)
            png_validation_reports[suffix] = {
                "valid": validation["valid"],
                "width": validation.get("width", 0),
                "height": validation.get("height", 0),
                "bit_depth": validation.get("bit_depth"),
                "color_type": validation.get("color_type"),
                "sha256": validation.get("sha256"),
                "mean_rgba": validation.get("mean_rgba"),
                "error": validation.get("error"),
            }
            if not validation["valid"]:
                decode_errors[suffix] = str(validation.get("error") or "Invalid PNG buffer")
                channel_status[suffix] = "decode_failed"
                continue
            raw_png_buffers[suffix] = raw_bytes
            received_channels.append(suffix)
            if validation.get("rgba_preview_b64"):
                decoded_rgba_previews[suffix] = str(validation["rgba_preview_b64"])
            tex_file = f"{material_name}_{suffix}"
            saved_textures[suffix] = save_raw_asset_to_rojo(target_folder, tex_file, raw_bytes)
            channel_status[suffix] = "local_saved"
        except Exception as err:
            decode_errors[suffix] = str(err)
            channel_status[suffix] = "decode_failed"
            logger.warning(f"Failed to decode {map_key}: {err}")

    roughness_val = float(payload_body.get("roughness", 0.35))
    metalness_val = float(payload_body.get("metalness", 0.75))
    albedo_hex = str(payload_body.get("albedo_hex", "#38bdf8"))
    emissive_hex = str(payload_body.get("emissive_hex", "#0ea5e9"))
    pattern = str(payload_body.get("pattern", "hex_carbon"))

    color_map_id = str(payload_body.get("color_map_asset_id", "") or "").strip()
    normal_map_id = str(payload_body.get("normal_map_asset_id", "") or "").strip()
    roughness_map_id = str(payload_body.get("roughness_map_asset_id", "") or "").strip()
    metalness_map_id = str(payload_body.get("metalness_map_asset_id", "") or "").strip()

    roblox_api_key = str(
        payload_body.get("roblox_api_key")
        or payload_body.get("roblox_open_cloud_api_key")
        or os.getenv("ROBLOX_OPEN_CLOUD_API_KEY", "")
    ).strip()
    roblox_creator_id = str(
        payload_body.get("roblox_creator_id")
        or payload_body.get("creator_user_id")
        or os.getenv("ROBLOX_CREATOR_ID", "")
    ).strip()
    cloud_publish_results: Dict[str, Any] = {}
    cloud_requested = bool(roblox_api_key and roblox_creator_id)
    cloud_publishing_channels: List[str] = []

    if cloud_requested:
        for suffix, attr_name in [
            ("ColorMap.png", "color"),
            ("NormalMap.png", "normal"),
            ("RoughnessMap.png", "roughness"),
            ("MetalnessMap.png", "metalness"),
        ]:
            if suffix in raw_png_buffers:
                pub_res = asset_engine.publish_decal_to_roblox_cloud(
                    png_bytes=raw_png_buffers[suffix],
                    display_name=f"{material_name}_{suffix.replace('.png', '')}",
                    api_key=roblox_api_key,
                    creator_user_id=roblox_creator_id,
                )
                cloud_publish_results[suffix] = pub_res
                if isinstance(pub_res, dict) and pub_res.get("published") and pub_res.get("roblox_asset_uri"):
                    uri = str(pub_res["roblox_asset_uri"])
                    channel_status[suffix] = "cloud_published"
                    if attr_name == "color" and not color_map_id:
                        color_map_id = uri
                    elif attr_name == "normal" and not normal_map_id:
                        normal_map_id = uri
                    elif attr_name == "roughness" and not roughness_map_id:
                        roughness_map_id = uri
                    elif attr_name == "metalness" and not metalness_map_id:
                        metalness_map_id = uri
                elif isinstance(pub_res, dict) and pub_res.get("status") == "cloud_publishing":
                    channel_status[suffix] = "cloud_publishing"
                    cloud_publishing_channels.append(suffix)
                else:
                    channel_status[suffix] = "cloud_publish_failed"

    verified_cloud_uris = {
        "color_map_id": color_map_id if asset_engine.is_verified_roblox_asset_uri(color_map_id) else None,
        "normal_map_id": normal_map_id if asset_engine.is_verified_roblox_asset_uri(normal_map_id) else None,
        "roughness_map_id": roughness_map_id if asset_engine.is_verified_roblox_asset_uri(roughness_map_id) else None,
        "metalness_map_id": metalness_map_id if asset_engine.is_verified_roblox_asset_uri(metalness_map_id) else None,
    }
    if verified_cloud_uris["color_map_id"]:
        channel_status["ColorMap.png"] = "cloud_published"
    if verified_cloud_uris["normal_map_id"]:
        channel_status["NormalMap.png"] = "cloud_published"
    if verified_cloud_uris["roughness_map_id"]:
        channel_status["RoughnessMap.png"] = "cloud_published"
    if verified_cloud_uris["metalness_map_id"]:
        channel_status["MetalnessMap.png"] = "cloud_published"

    published_channels = [
        ch
        for ch, uri_key in [
            ("ColorMap.png", "color_map_id"),
            ("NormalMap.png", "normal_map_id"),
            ("RoughnessMap.png", "roughness_map_id"),
            ("MetalnessMap.png", "metalness_map_id"),
        ]
        if verified_cloud_uris[uri_key] is not None
    ]
    is_cloud_published = len(published_channels) == 4

    # Determine honest publication status
    if len(received_channels) == 0 or len(decode_errors) > 0:
        pub_status = "failed"
    elif len(published_channels) == 4:
        pub_status = "cloud_published"
    elif len(cloud_publishing_channels) > 0:
        pub_status = "cloud_publishing"
    elif len(published_channels) > 0:
        pub_status = "partially_published"
    elif cloud_requested and len(published_channels) == 0:
        pub_status = "failed"
    elif len(received_channels) == 4:
        pub_status = "local_saved"
    else:
        pub_status = "partially_published"

    is_success = pub_status in ("local_saved", "cloud_published", "partially_published", "cloud_publishing")

    pbr_luau = asset_engine.generate_pbr_surface_appearance_luau(
        material_name=material_name,
        color_map_id=color_map_id,
        normal_map_id=normal_map_id,
        roughness_map_id=roughness_map_id,
        metalness_map_id=metalness_map_id,
        roughness=roughness_val,
        metalness=metalness_val,
        albedo_hex=albedo_hex,
        emissive_hex=emissive_hex,
        pattern=pattern,
        target_folder=target_folder,
        decoded_rgba_previews=decoded_rgba_previews,
    )
    luau_file_name = f"{material_name}_SurfaceAppearance.luau"
    luau_saved_path = save_luau_to_rojo("src/shared/Assets3D", luau_file_name, pbr_luau) if is_success else None

    updated_asset: Optional[Dict[str, Any]] = None
    if existing_asset and is_success:
        pbr_spec = {
            "materialName": material_name,
            "albedoHex": albedo_hex,
            "roughness": roughness_val,
            "metalness": metalness_val,
            "emissiveHex": emissive_hex,
            "pattern": pattern,
            "publicationStatus": pub_status,
            "colorMapId": verified_cloud_uris["color_map_id"],
            "normalMapId": verified_cloud_uris["normal_map_id"],
            "roughnessMapId": verified_cloud_uris["roughness_map_id"],
            "metalnessMapId": verified_cloud_uris["metalness_map_id"],
            "colorMapAssetId": verified_cloud_uris["color_map_id"],
            "normalMapAssetId": verified_cloud_uris["normal_map_id"],
            "roughnessMapAssetId": verified_cloud_uris["roughness_map_id"],
            "metalnessMapAssetId": verified_cloud_uris["metalness_map_id"],
            "localColorMapFile": saved_textures.get("ColorMap.png"),
            "localNormalMapFile": saved_textures.get("NormalMap.png"),
            "localRoughnessMapFile": saved_textures.get("RoughnessMap.png"),
            "localMetalnessMapFile": saved_textures.get("MetalnessMap.png"),
            "rgbaPreviewByChannel": decoded_rgba_previews,
        }
        existing_asset["pbr_profile"] = {
            **(existing_asset.get("pbr_profile") or {}),
            "albedo_hex": albedo_hex,
            "emissive_hex": emissive_hex,
            "roughness": roughness_val,
            "metalness": metalness_val,
            "pattern": pattern,
            "surface_appearance": True,
            "emissive_accent": emissive_hex,
            "publication_status": pub_status,
            "color_map_asset_id": verified_cloud_uris["color_map_id"],
            "normal_map_asset_id": verified_cloud_uris["normal_map_id"],
            "roughness_map_asset_id": verified_cloud_uris["roughness_map_id"],
            "metalness_map_asset_id": verified_cloud_uris["metalness_map_id"],
            "local_color_map_file": saved_textures.get("ColorMap.png"),
            "local_normal_map_file": saved_textures.get("NormalMap.png"),
            "local_roughness_map_file": saved_textures.get("RoughnessMap.png"),
            "local_metalness_map_file": saved_textures.get("MetalnessMap.png"),
        }
        if isinstance(existing_asset.get("parts"), list):
            new_parts = []
            for pt in existing_asset["parts"]:
                if not target_part_name or target_part_name == "__ALL__" or pt.get("name") == target_part_name:
                    pt = {
                        **pt,
                        "roughness": roughness_val,
                        "metalness": metalness_val,
                        "pbrMaterial": pbr_spec,
                    }
                new_parts.append(pt)
            existing_asset["parts"] = new_parts

        safe_asset_name = re.sub(r"[^a-zA-Z0-9_]", "", str(existing_asset.get("name", "Model3D"))) or "Model3D"
        part_specs = [MeshPart3DSpec(**p) for p in existing_asset.get("parts", [])]
        enriched_specs = generation_3d_engine.ensure_mesh_data_on_parts(safe_asset_name, part_specs)
        collision_fid = str(existing_asset.get("collision_fidelity", "Hull"))
        rebuilt_luau = generation_3d_engine.build_luau_from_parts(safe_asset_name, enriched_specs, collision_fid)
        rebuilt_rbxmx = generation_3d_engine.build_rbxmx_from_parts(
            safe_asset_name,
            enriched_specs,
            collision_fid,
            str(existing_asset.get("category", "3D Asset")),
            rebuilt_luau,
        )
        asset_folder = str(existing_asset.get("rojo_target_folder", "src/shared/Assets3D"))
        save_luau_to_rojo(asset_folder, f"{safe_asset_name}.luau", rebuilt_luau)
        save_raw_asset_to_rojo(asset_folder, f"{safe_asset_name}.rbxmx", rebuilt_rbxmx.encode("utf-8"))
        existing_asset["luau_code"] = rebuilt_luau
        existing_asset["parts"] = [p.model_dump() for p in enriched_specs]
        updated_asset = asset_engine.upsert_asset(existing_asset)

    return {
        "success": is_success,
        "status": pub_status,
        "material_name": material_name,
        "target_asset_id": target_asset_id,
        "target_part_name": target_part_name,
        "saved_textures": saved_textures,
        "received_channels": received_channels,
        "published_channels": published_channels,
        "missing_channels": missing_channels,
        "decode_errors": decode_errors,
        "channel_status": channel_status,
        "png_validation": png_validation_reports,
        "is_cloud_published": is_cloud_published,
        "verified_cloud_ids": verified_cloud_uris,
        "verified_cloud_uris": verified_cloud_uris,
        "cloud_publish_results": cloud_publish_results,
        "luau_file": f"src/shared/Assets3D/{luau_file_name}",
        "luau_saved_path": luau_saved_path,
        "luau_binder_path": luau_saved_path,
        "luau_code": pbr_luau,
        "updated_asset": updated_asset,
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
    Either pulls updated `.rbxmx` / `.obj` / `.luau` geometry from `rojo_workspace/src/shared/Assets3D/`
    into the active Forge AI Studio asset (parsing `.rbxmx` CFrames, Materials, 4-channel SurfaceAppearance,
    and `ForgeMeshGeometryJSON` buffers), or restores a specific historical revision (`restore_version`).
    Returns `rbxmx_content` so the client can run `computeModelVersionDiff` and `incrementalMergeAssets`.
    """
    verify_security_token(x_forge_token)
    asset_id = str(payload_body.get("asset_id", "")).strip()
    asset_name = str(payload_body.get("asset_name", "")).strip()
    restore_version = payload_body.get("restore_version")

    engine = get_asset_engine()
    target_asset = engine.get_asset(asset_id or asset_name)
    if not target_asset:
        raise HTTPException(status_code=404, detail="Asset not found in library.")

    safe_name = re.sub(r"[^a-zA-Z0-9_]", "", str(target_asset.get("name", "Model3D"))) or "Model3D"

    if restore_version is not None:
        restored = engine.restore_asset_version(
            str(target_asset.get("id") or target_asset.get("name")),
            int(restore_version),
        )
        if not restored:
            raise HTTPException(status_code=404, detail=f"Version {restore_version} not found in asset history.")
        part_specs = [MeshPart3DSpec(**p) for p in restored.get("parts", [])]
        enriched_specs = generation_3d_engine.ensure_mesh_data_on_parts(safe_name, part_specs)
        collision_fid = str(restored.get("collision_fidelity", "Hull"))
        rebuilt_luau = str(restored.get("luau_code") or "") or generation_3d_engine.build_luau_from_parts(
            safe_name, enriched_specs, collision_fid
        )
        rbxmx_content = generation_3d_engine.build_rbxmx_from_parts(
            safe_name,
            enriched_specs,
            collision_fid,
            str(restored.get("category", "3D Asset")),
            rebuilt_luau,
        )
        target_folder = str(restored.get("rojo_target_folder", "src/shared/Assets3D"))
        save_luau_to_rojo(target_folder, f"{safe_name}.luau", rebuilt_luau)
        save_raw_asset_to_rojo(target_folder, f"{safe_name}.rbxmx", rbxmx_content.encode("utf-8"))
        return {
            "success": True,
            "source": f"version_history_v{restore_version}",
            "rbxmx_content": rbxmx_content,
            "luau_content": rebuilt_luau,
            "asset": restored,
        }

    rojo_root = Path(RUNTIME_CONFIG["rojo_project_path"]).resolve()
    assets_dir = rojo_root / "src" / "shared" / "Assets3D"
    obj_path = assets_dir / str(target_asset.get("obj_file_name") or f"{safe_name}.obj")
    luau_path = assets_dir / str(target_asset.get("file_name") or f"{safe_name}.luau")
    rbxmx_path = assets_dir / f"{safe_name}.rbxmx"

    rbxmx_content = ""
    rbxmx_parsed_parts: List[MeshPart3DSpec] = []
    if rbxmx_path.is_file():
        rbxmx_content = rbxmx_path.read_text(encoding="utf-8", errors="ignore")
        parsed_rbxmx = generation_3d_engine.parse_rbxmx_to_parts(
            rbxmx_text=rbxmx_content,
            fallback_name=safe_name,
            default_collision_fidelity=str(target_asset.get("collision_fidelity", "Hull")),
        )
        rbxmx_parsed_parts = parsed_rbxmx.get("parts", [])
        if rbxmx_parsed_parts:
            target_asset["parts"] = [p.model_dump() for p in rbxmx_parsed_parts]
            target_asset["poly_count"] = int(parsed_rbxmx.get("poly_count", 0))
            if parsed_rbxmx.get("luau_code"):
                target_asset["luau_code"] = str(parsed_rbxmx["luau_code"])
            else:
                target_asset["luau_code"] = generation_3d_engine.build_luau_from_parts(
                    safe_name,
                    rbxmx_parsed_parts,
                    str(target_asset.get("collision_fidelity", "Hull")),
                )

    if not rbxmx_parsed_parts and obj_path.is_file():
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

    if not rbxmx_content:
        part_specs = [MeshPart3DSpec(**p) for p in target_asset.get("parts", [])]
        rbxmx_content = generation_3d_engine.build_rbxmx_from_parts(
            safe_name,
            part_specs,
            str(target_asset.get("collision_fidelity", "Hull")),
            str(target_asset.get("category", "3D Asset")),
            str(target_asset.get("luau_code", "")),
        )

    saved = save_asset_to_library(target_asset)
    return {
        "success": True,
        "source": "rojo_workspace_disk",
        "rbxmx_content": rbxmx_content,
        "luau_content": saved.get("luau_code", ""),
        "asset": saved,
    }


def _resolve_baseline_parts_for_asset(
    existing_asset: Optional[Dict[str, Any]],
    payload_body: Dict[str, Any],
) -> Optional[List[Dict[str, Any]]]:
    if isinstance(payload_body.get("base_parts"), list):
        return payload_body["base_parts"]
    baseline_sha = str(payload_body.get("baseline_snapshot_sha256") or "").strip()
    if not baseline_sha or not existing_asset:
        return None
    if str(existing_asset.get("snapshot_sha256") or "") == baseline_sha:
        return existing_asset.get("parts", [])
    for snap in existing_asset.get("version_history", []) or []:
        if isinstance(snap, dict) and str(snap.get("snapshot_sha256") or "") == baseline_sha:
            if isinstance(snap.get("parts"), list):
                return snap["parts"]
    return None


@app.post("/api/v1/assets/compare-datamodel")
def compare_studio_datamodel(payload_body: Dict[str, Any], x_forge_token: Optional[str] = Header(default=None)):
    """
    Pillar C Real DataModel Bidirectional Sync Diff:
    Compares the live Roblox Studio DataModel (`studio_parts`) against the active asset in Forge (`asset_id` / `model_name`)
    using stable `partId` (`ForgePartId`), `geometryHash`, `materialHash`, `transformHash`, and `hierarchyPath` (`FORGE_SYNC_HASH_SCHEMA_V1`).
    """
    verify_security_token(x_forge_token)
    model_name = str(payload_body.get("model_name") or payload_body.get("asset_id") or "").strip()
    studio_parts = payload_body.get("parts") or payload_body.get("studio_parts") or []
    sync_scope = str(payload_body.get("sync_scope") or "full_model").strip()
    if sync_scope not in ("selection", "full_model", "explicit_delete"):
        sync_scope = "full_model"
    explicit_delete_ids = payload_body.get("explicit_delete_ids")
    if not isinstance(explicit_delete_ids, list):
        explicit_delete_ids = []

    engine = get_asset_engine()
    safe_name = re.sub(r"[^a-zA-Z0-9_]", "", model_name) or model_name
    existing = engine.get_asset(model_name) or engine.get_asset(safe_name)
    if not existing:
        return {
            "found_in_forge": False,
            "asset_id": None,
            "model_name": model_name,
            "version": 1,
            "diff": engine.compare_datamodel(
                [],
                studio_parts if isinstance(studio_parts, list) else [],
                base_parts=None,
                sync_scope=sync_scope,
                model_name=safe_name,
                explicit_delete_ids=explicit_delete_ids,
            ),
        }
    base_parts = _resolve_baseline_parts_for_asset(existing, payload_body)
    diff = engine.compare_datamodel(
        existing.get("parts", []),
        studio_parts if isinstance(studio_parts, list) else [],
        base_parts=base_parts,
        sync_scope=sync_scope,
        model_name=str(existing.get("name") or safe_name),
        explicit_delete_ids=explicit_delete_ids,
    )
    return {
        "found_in_forge": True,
        "asset_id": existing.get("id"),
        "model_name": existing.get("name"),
        "version": existing.get("version", 1),
        "snapshot_sha256": existing.get("snapshot_sha256"),
        "diff": diff,
    }


@app.post("/api/v1/assets/studio-push")
def receive_studio_incremental_push(payload_body: Dict[str, Any], x_forge_token: Optional[str] = Header(default=None)):
    """
    Pillar C Bidirectional Sync: Receives incremental part updates directly from the Roblox Studio Plugin
    (`Selection` or `Workspace` model changes), matches parts by `partId` (`ForgePartId`) or `name`,
    validates duplicate `partId`s and 3-way merge conflicts (`conflict_policy`), preserves external
    `MeshPart`s without inventing procedural cubes, and atomically updates `assets_library.json`,
    `.rbxmx`, and `.luau` with `.tmp` + rollback protection.
    """
    verify_security_token(x_forge_token)
    model_name = str(payload_body.get("model_name") or payload_body.get("name") or "StudioModel").strip()
    incoming_parts = payload_body.get("parts", [])
    explicit_delete_ids = payload_body.get("explicit_delete_ids")
    if not isinstance(explicit_delete_ids, list):
        explicit_delete_ids = []
    explicit_delete_set = {str(x) for x in explicit_delete_ids if str(x).strip()}

    raw_scope = str(payload_body.get("sync_scope") or "").strip()
    if raw_scope in ("selection", "full_model", "explicit_delete"):
        sync_scope = raw_scope
    elif payload_body.get("remove_missing", False) or payload_body.get("merge_mode") == "replace":
        sync_scope = "full_model"
    elif len(explicit_delete_set) > 0 and (not isinstance(incoming_parts, list) or len(incoming_parts) == 0):
        sync_scope = "explicit_delete"
    else:
        sync_scope = "selection"

    raw_policy = str(payload_body.get("conflict_policy") or "smart_merge").strip().lower()
    policy_alias_map = {
        "keep_forge": "keep_forge",
        "prefer_forge": "keep_forge",
        "accept_studio": "accept_studio",
        "prefer_studio": "accept_studio",
        "smart_merge": "smart_merge",
        "manual_resolution": "manual_resolution",
        "reject": "manual_resolution",
        "abort_on_conflict": "manual_resolution",
    }
    conflict_policy = policy_alias_map.get(raw_policy, "smart_merge")
    merge_mode = str(payload_body.get("merge_mode") or ("replace" if sync_scope == "full_model" else "incremental"))

    if not isinstance(incoming_parts, list) or (len(incoming_parts) == 0 and len(explicit_delete_set) == 0):
        raise HTTPException(status_code=400, detail="Requires non-empty parts array or explicit_delete_ids from Roblox Studio.")

    engine = get_asset_engine()
    safe_name = re.sub(r"[^a-zA-Z0-9_]", "", model_name) or "StudioModel"
    existing = engine.get_asset(model_name) or engine.get_asset(safe_name)
    base_parts = _resolve_baseline_parts_for_asset(existing, payload_body)

    # Pre-merge incoming parts with existing Forge meshData when incoming Studio part omits ForgeMeshGeometryJSON
    norm_existing = (
        normalize_parts_with_sync_metadata(existing.get("parts", []), safe_name)
        if existing and isinstance(existing.get("parts"), list)
        else []
    )
    existing_by_id = {str(p.get("partId")): p for p in norm_existing}
    existing_by_name = {str(p.get("name")): p for p in norm_existing}

    prepared_incoming: List[Dict[str, Any]] = []
    for idx, raw_inc in enumerate(incoming_parts):
        if not isinstance(raw_inc, dict):
            continue
        inc = dict(raw_inc)
        inc_id = str(inc.get("partId") or inc.get("id") or "").strip()
        pname = str(inc.get("name") or f"MeshPart_{idx + 1}").strip()
        matched_existing = (existing_by_id.get(inc_id) if inc_id else None) or (
            existing_by_name.get(pname) if not inc_id else None
        )

        inc_md = inc.get("meshData") if isinstance(inc.get("meshData"), dict) else None
        has_inc_buffers = bool(
            inc_md
            and isinstance(inc_md.get("vertices"), list)
            and len(inc_md["vertices"]) > 0
            and isinstance(inc_md.get("faces"), list)
            and len(inc_md["faces"]) > 0
        )
        inc_mesh_id = validate_published_roblox_mesh_id(
            inc.get("meshId")
            or inc.get("mesh_id")
            or (inc_md.get("meshId") if inc_md else None)
            or (inc_md.get("assetId") if inc_md else None)
        )
        inc_geom_source = str(inc.get("geometrySource") or "").strip()

        if not has_inc_buffers and matched_existing:
            ex_mesh_id = validate_published_roblox_mesh_id(
                matched_existing.get("meshId")
                or (matched_existing.get("meshData") or {}).get("meshId")
            )
            # If Studio didn't switch to a different published MeshId, preserve Forge's existing meshData
            if not inc_mesh_id or inc_mesh_id == ex_mesh_id:
                if matched_existing.get("meshData"):
                    inc["meshData"] = json.loads(json.dumps(matched_existing["meshData"]))
                if not inc_geom_source and matched_existing.get("geometrySource"):
                    inc["geometrySource"] = matched_existing["geometrySource"]
                if not inc_mesh_id and ex_mesh_id:
                    inc["meshId"] = ex_mesh_id
                    inc["assetId"] = ex_mesh_id

        if inc_mesh_id:
            inc["meshId"] = inc_mesh_id
            inc["assetId"] = inc.get("assetId") or inc_mesh_id
            if not has_inc_buffers and not (
                isinstance(inc.get("meshData"), dict)
                and len(inc["meshData"].get("vertices") or []) > 0
            ):
                inc["geometrySource"] = "PublishedCloudMeshId"
        elif not has_inc_buffers and not (
            isinstance(inc.get("meshData"), dict)
            and len(inc["meshData"].get("vertices") or []) > 0
        ):
            if inc_geom_source in ("StudioExternalUnreadable", "PublishedCloudMeshId"):
                inc["geometrySource"] = inc_geom_source
            elif not matched_existing:
                inc["geometrySource"] = "StudioExternalUnreadable"

        if not inc_id and matched_existing and matched_existing.get("partId"):
            inc["partId"] = matched_existing["partId"]

        prepared_incoming.append(inc)

    sync_diff = engine.compare_datamodel(
        forge_parts=norm_existing,
        studio_parts=prepared_incoming,
        base_parts=base_parts,
        sync_scope=sync_scope,
        model_name=safe_name,
        explicit_delete_ids=list(explicit_delete_set),
    )

    # 1. Reject duplicate partIds immediately
    if sync_diff.get("has_duplicate_ids"):
        return {
            "success": False,
            "status": "duplicate_part_ids",
            "error": "Push rechazado: se detectaron ForgePartId duplicados en el payload.",
            "duplicate_studio_part_ids": sync_diff.get("duplicate_studio_part_ids", []),
            "duplicate_forge_part_ids": sync_diff.get("duplicate_forge_part_ids", []),
            "sync_diff": sync_diff,
        }

    # 1b. Reject circular hierarchy cycles
    if sync_diff.get("has_hierarchy_cycles"):
        return {
            "success": False,
            "status": "hierarchy_cycle_detected",
            "error": "Push rechazado: se detectaron ciclos circulares en la jerarquía de contenedores.",
            "studio_hierarchy_cycles": sync_diff.get("studio_hierarchy_cycles", []),
            "forge_hierarchy_cycles": sync_diff.get("forge_hierarchy_cycles", []),
            "sync_diff": sync_diff,
        }

    # 2. Enforce conflict policy when 3-way conflicts exist
    if sync_diff.get("has_conflicts") and conflict_policy == "manual_resolution":
        return {
            "success": False,
            "status": "conflict_detected",
            "conflict_policy": raw_policy,
            "error": "Push rechazado por política de conflictos: el modelo cambió tanto en Forge como en Studio desde el último snapshot base.",
            "conflicts": sync_diff.get("conflicts", []),
            "sync_diff": sync_diff,
        }

    norm_studio = normalize_parts_with_sync_metadata(prepared_incoming, safe_name)
    conflict_by_id = {str(c.get("partId")): c for c in (sync_diff.get("conflicts") or [])}
    base_by_id = (
        {str(b.get("partId")): b for b in normalize_parts_with_sync_metadata(base_parts, safe_name)}
        if base_parts
        else {}
    )

    merged_parts: List[Dict[str, Any]] = []
    if existing and len(norm_existing) > 0:
        seen_ids = set()
        seen_names = set()
        for idx, inc in enumerate(norm_studio):
            inc_id = str(inc.get("partId") or "")
            pname = str(inc.get("name") or f"MeshPart_{idx + 1}")
            if inc_id in explicit_delete_set or pname in explicit_delete_set:
                continue
            f_part = existing_by_id.get(inc_id) or (existing_by_name.get(pname) if not inc_id else None)
            resolved_id = inc_id or (str(f_part.get("partId")) if f_part else f"forge-part-{idx + 1}-{pname.lower()}")
            seen_ids.add(resolved_id)
            seen_names.add(pname)
            if f_part and f_part.get("name"):
                seen_names.add(str(f_part.get("name")))

            if not f_part:
                merged_parts.append(inc)
                continue

            has_conflict = resolved_id in conflict_by_id
            if has_conflict and conflict_policy == "keep_forge":
                merged_parts.append(f_part)
                continue

            b_part = base_by_id.get(resolved_id)
            if has_conflict and conflict_policy == "smart_merge" and b_part:
                # Field-level 3-way merge: apply Studio's changed aspect while preserving Forge's non-conflicting changes
                studio_geom_changed = inc.get("geometryHash") != b_part.get("geometryHash")
                studio_mat_changed = inc.get("materialHash") != b_part.get("materialHash")
                studio_trans_changed = inc.get("transformHash") != b_part.get("transformHash")
                studio_hier_changed = inc.get("hierarchyHash") != b_part.get("hierarchyHash")
                studio_name_changed = inc.get("name") != b_part.get("name")
                resolved_name = pname if studio_name_changed else str(f_part.get("name") or pname)
                merged_part = {
                    **f_part,
                    "partId": resolved_id,
                    "name": resolved_name,
                    "parentId": inc.get("parentId") if studio_hier_changed else f_part.get("parentId"),
                    "parentName": inc.get("parentName") if studio_hier_changed else f_part.get("parentName", "Root"),
                    "parentContainerClass": inc.get("parentContainerClass") if studio_hier_changed else f_part.get("parentContainerClass", "Model"),
                    "hierarchyPath": inc.get("hierarchyPath") if studio_hier_changed else f_part.get("hierarchyPath", f"Root/{resolved_name}"),
                    "size": inc.get("size") if studio_trans_changed else f_part.get("size", [2.0, 2.0, 2.0]),
                    "position": inc.get("position") if studio_trans_changed else f_part.get("position", [0.0, 1.0, 0.0]),
                    "rotation": inc.get("rotation") if studio_trans_changed else f_part.get("rotation", [0.0, 0.0, 0.0]),
                    "rotationMatrix": inc.get("rotationMatrix") if studio_trans_changed else f_part.get("rotationMatrix"),
                    "color": inc.get("color") if studio_mat_changed else f_part.get("color", [148, 163, 184]),
                    "material": inc.get("material") if studio_mat_changed else f_part.get("material", "Metal"),
                    "roughness": float(inc.get("roughness", 0.35)) if studio_mat_changed else float(f_part.get("roughness", 0.35)),
                    "metalness": float(inc.get("metalness", 0.65)) if studio_mat_changed else float(f_part.get("metalness", 0.65)),
                    "transparency": float(inc.get("transparency", 0.0)) if studio_mat_changed else float(f_part.get("transparency", 0.0)),
                    "reflectance": float(inc.get("reflectance", 0.0)) if studio_mat_changed else float(f_part.get("reflectance", 0.0)),
                    "pbrMaterial": (inc.get("pbrMaterial") or f_part.get("pbrMaterial")) if studio_mat_changed else f_part.get("pbrMaterial"),
                    "meshId": inc.get("meshId") if studio_geom_changed else f_part.get("meshId"),
                    "assetId": inc.get("assetId") if studio_geom_changed else f_part.get("assetId"),
                    "textureId": inc.get("textureId") if studio_mat_changed else f_part.get("textureId"),
                    "geometrySource": inc.get("geometrySource") if studio_geom_changed else f_part.get("geometrySource"),
                    "meshData": inc.get("meshData") if studio_geom_changed else f_part.get("meshData"),
                }
                merged_parts.append(merged_part)
            else:
                merged_part = {
                    **f_part,
                    **inc,
                    "partId": resolved_id,
                    "name": pname,
                    "parentName": str(inc.get("parentName") or f_part.get("parentName") or "Root"),
                    "parentContainerClass": str(inc.get("parentContainerClass") or f_part.get("parentContainerClass") or "Model"),
                    "hierarchyPath": str(inc.get("hierarchyPath") or f_part.get("hierarchyPath") or pname),
                    "shape": "MeshPart",
                    "meshData": inc.get("meshData") if inc.get("meshData") is not None else f_part.get("meshData"),
                    "pbrMaterial": inc.get("pbrMaterial") or f_part.get("pbrMaterial"),
                }
                merged_parts.append(merged_part)

        if sync_scope != "full_model":
            for ep in norm_existing:
                ep_id = str(ep.get("partId") or "")
                ep_name = str(ep.get("name") or "")
                if ep_id in explicit_delete_set or ep_name in explicit_delete_set:
                    continue
                if ep_id not in seen_ids and ep_name not in seen_names:
                    merged_parts.append(ep)
    else:
        merged_parts = [
            p
            for p in norm_studio
            if str(p.get("partId")) not in explicit_delete_set and str(p.get("name")) not in explicit_delete_set
        ]

    part_specs = [MeshPart3DSpec(**p) for p in merged_parts]
    enriched_specs = generation_3d_engine.ensure_mesh_data_on_parts(safe_name, part_specs)
    collision_fidelity = str((existing or {}).get("collision_fidelity", "Hull"))
    luau_code = generation_3d_engine.build_luau_from_parts(safe_name, enriched_specs, collision_fidelity)
    rbxmx_content = generation_3d_engine.build_rbxmx_from_parts(
        safe_name,
        enriched_specs,
        collision_fidelity,
        str((existing or {}).get("category", "Studio Synced Asset")),
        luau_code,
    )

    target_folder = str((existing or {}).get("rojo_target_folder", "src/shared/Assets3D"))
    luau_target_path = resolve_safe_project_path(target_folder, f"{safe_name}.luau")
    rbxmx_target_path = resolve_safe_project_path(target_folder, f"{safe_name}.rbxmx")
    lib_path = get_assets_library_path()

    # Backup existing files on disk for atomic rollback if any step fails
    prev_luau_bytes = luau_target_path.read_bytes() if luau_target_path.exists() else None
    prev_rbxmx_bytes = rbxmx_target_path.read_bytes() if rbxmx_target_path.exists() else None
    prev_lib_bytes = lib_path.read_bytes() if lib_path.exists() else None

    try:
        safe_luau = validate_and_sanitize_luau(luau_code)
        luau_tmp = luau_target_path.with_suffix(".luau.tmp")
        rbxmx_tmp = rbxmx_target_path.with_suffix(".rbxmx.tmp")
        luau_tmp.write_text(safe_luau, encoding="utf-8")
        rbxmx_tmp.write_bytes(rbxmx_content.encode("utf-8"))
        os.replace(luau_tmp, luau_target_path)
        os.replace(rbxmx_tmp, rbxmx_target_path)

        luau_saved = str(luau_target_path)
        rbxmx_saved = str(rbxmx_target_path)

        enriched_dicts = normalize_parts_with_sync_metadata([p.model_dump() for p in enriched_specs], safe_name)
        total_tris = sum(len(p.meshData.faces) for p in enriched_specs if p.meshData and p.meshData.faces)
        asset_payload = {
            **(existing or {}),
            "id": (existing or {}).get("id") or f"asset-{int(time.time() * 1000)}",
            "name": safe_name,
            "category": (existing or {}).get("category") or "Studio Synced Asset",
            "asset_type": "Model3D",
            "poly_count": total_tris,
            "collision_fidelity": collision_fidelity,
            "rojo_target_folder": target_folder,
            "file_name": f"{safe_name}.luau",
            "parts": enriched_dicts,
            "luau_code": luau_code,
            "saved_path": luau_saved,
        }
        saved = save_asset_to_library(asset_payload)
    except Exception as exc:
        # Rollback disk state so `.luau`, `.rbxmx`, and `assets_library.json` never diverge
        try:
            if prev_luau_bytes is not None:
                luau_target_path.write_bytes(prev_luau_bytes)
            elif luau_target_path.exists():
                luau_target_path.unlink()
            if prev_rbxmx_bytes is not None:
                rbxmx_target_path.write_bytes(prev_rbxmx_bytes)
            elif rbxmx_target_path.exists():
                rbxmx_target_path.unlink()
            if prev_lib_bytes is not None:
                lib_path.write_bytes(prev_lib_bytes)
        except Exception as rb_err:
            logger.error(f"Rollback error during studio-push: {rb_err}")
        raise HTTPException(status_code=500, detail=f"Atomic studio-push failed and was rolled back: {exc}")

    return {
        "success": True,
        "status": "synced",
        "merge_mode": merge_mode,
        "sync_scope": sync_scope,
        "conflict_policy": conflict_policy,
        "asset": saved,
        "sync_diff": sync_diff,
        "luau_saved_path": luau_saved,
        "rbxmx_saved_path": rbxmx_saved,
        "updated_part_count": len(enriched_specs),
        "updated_parts_count": len(enriched_specs),
    }


@app.post("/api/v1/assets/validate-rojo-build")
def validate_and_self_heal_rojo_build(payload_body: Dict[str, Any], x_forge_token: Optional[str] = Header(default=None)):
    """
    Pillar D Automated Rojo Build Verification & Self-Healing:
    Verifies `default.project.json`, required Rojo directory structure, core Luau modules,
    and optionally verifies/regenerates all 5 package files (`.luau`, `.rbxmx`, `.gltf`, `.obj`, `.mtl`)
    for the target asset. Automatically heals any missing files or configuration.
    """
    verify_security_token(x_forge_token)
    auto_heal = bool(payload_body.get("auto_heal", True))
    asset_name = str(payload_body.get("asset_name", "")).strip()
    rojo_root = get_rojo_root()
    checks: List[Dict[str, Any]] = []
    auto_healed_actions: List[str] = []

    # 1. Verify default.project.json
    proj_file = rojo_root / "default.project.json"
    proj_valid = False
    if proj_file.is_file():
        try:
            parsed = json.loads(proj_file.read_text(encoding="utf-8"))
            proj_valid = isinstance(parsed, dict) and "tree" in parsed
        except Exception:
            proj_valid = False

    if not proj_valid and auto_heal:
        configure_rojo_path(RojoConfigRequest(rojo_project_path=str(rojo_root), initialize_if_missing=True))
        proj_valid = proj_file.is_file()
        auto_healed_actions.append("Regenerado default.project.json y estructura de carpetas Rojo.")

    checks.append({
        "id": "rojo_project_json",
        "title": "Configuración Rojo (default.project.json)",
        "passed": proj_valid,
        "auto_healed": len(auto_healed_actions) > 0,
        "details": f"Ruta verificada: {proj_file}",
    })

    # 2. Verify Core Shared Modules (Maid, RemoteProvider, GameTypes)
    audit = audit_project_modules()
    missing_core = [k for k, v in audit["core_modules_verified"].items() if not v]
    healed_core = False
    if missing_core and auto_heal:
        bootstrap_core_modules()
        audit = audit_project_modules()
        missing_core = [k for k, v in audit["core_modules_verified"].items() if not v]
        healed_core = True
        auto_healed_actions.append("Instalados módulos base verificados (Maid, RemoteProvider, GameTypes).")

    checks.append({
        "id": "rojo_core_modules",
        "title": "Módulos Base Luau (Maid, RemoteProvider, GameTypes)",
        "passed": len(missing_core) == 0,
        "auto_healed": healed_core,
        "details": "100% módulos base presentes." if not missing_core else f"Faltantes: {', '.join(missing_core)}",
    })

    # 3. Verify 5-file package for active asset if specified
    if asset_name:
        safe_name = re.sub(r"[^a-zA-Z0-9_]", "", asset_name) or "Model3D"
        assets_dir = rojo_root / "src" / "shared" / "Assets3D"
        expected_exts = ["luau", "rbxmx", "gltf", "obj", "mtl"]
        missing_exts = [ext for ext in expected_exts if not (assets_dir / f"{safe_name}.{ext}").is_file()]
        healed_pkg = False
        if missing_exts and auto_heal:
            assets = load_assets_library()
            found_asset = next((a for a in assets if a.get("name") == asset_name or a.get("name") == safe_name), None)
            if found_asset:
                export_roblox_package({"asset": found_asset, "save_to_rojo": True, "save_to_library": False})
                missing_exts = [ext for ext in expected_exts if not (assets_dir / f"{safe_name}.{ext}").is_file()]
                healed_pkg = True
                auto_healed_actions.append(f"Regenerados archivos de paquete 3D faltantes para {safe_name}.")

        checks.append({
            "id": "rojo_asset_package_5_files",
            "title": f"Paquete 5 Archivos en Rojo ({safe_name})",
            "passed": len(missing_exts) == 0,
            "auto_healed": healed_pkg,
            "details": "Los 5 archivos (.luau, .rbxmx, .gltf, .obj, .mtl) existen en disco." if not missing_exts else f"Faltan: {', '.join(missing_exts)}",
        })

    all_passed = all(c["passed"] for c in checks)
    return {
        "success": all_passed,
        "rojo_project_path": str(rojo_root),
        "checks": checks,
        "auto_healed_actions": auto_healed_actions,
        "timestamp": datetime.utcnow().isoformat() + "Z",
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
