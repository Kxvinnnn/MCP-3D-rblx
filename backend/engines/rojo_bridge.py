"""
Rojo Bridge Engine (backend/engines/rojo_bridge.py)
Handles secure filesystem sandboxing, Rojo 7.x project configuration,
default.project.json verification, SHA-256 sync manifests, and on-disk Luau module auditing.
"""

import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import HTTPException

ALLOWED_ROJO_SUBFOLDERS = {
    "src/server",
    "src/client",
    "src/client/UI",
    "src/shared",
    "src/shared/Assets3D",
    "src/shared/Materials",
    "src/shared/Scenes",
    "src/shared/Utils",
    "src/shared/Network",
    "src/shared/Types",
}

FORBIDDEN_LUAU_PATTERNS = [
    r"\bloadstring\s*\(",
    r"\bgetfenv\s*\(",
    r"\bsetfenv\s*\(",
]

DEFAULT_ROJO_PROJECT_JSON = {
    "name": "ForgeAI_Roblox_Project",
    "servePort": 34872,
    "tree": {
        "$className": "DataModel",
        "ReplicatedStorage": {
            "$className": "ReplicatedStorage",
            "Shared": {"$path": "src/shared"},
        },
        "ServerScriptService": {
            "$className": "ServerScriptService",
            "Server": {"$path": "src/server"},
        },
        "StarterPlayer": {
            "$className": "StarterPlayer",
            "StarterPlayerScripts": {
                "$className": "StarterPlayerScripts",
                "Client": {"$path": "src/client"},
            },
        },
        "StarterGui": {
            "$className": "StarterGui",
            "ForgeGUI": {"$path": "src/client/UI"},
        },
    },
}


class RojoBridgeEngine:
    def __init__(self, initial_project_path: Path):
        self.project_path = initial_project_path.resolve()

    def sanitize_luau_filename(self, file_name: str, default_suffix: str = ".luau") -> str:
        base = os.path.basename(file_name.strip())
        base = re.sub(r"[^a-zA-Z0-9_.-]", "", base)
        if not base:
            base = f"GeneratedAsset{default_suffix}"
        if not (base.endswith(".luau") or base.endswith(".lua")):
            base += default_suffix
        return base

    def validate_generated_luau_code(self, code: str) -> str:
        trimmed = code.strip()
        if not trimmed.startswith("--!strict"):
            trimmed = "--!strict\n" + trimmed
        for pattern in FORBIDDEN_LUAU_PATTERNS:
            if re.search(pattern, trimmed):
                raise HTTPException(
                    status_code=400,
                    detail=f"Security policy violation: forbidden Luau global matched ({pattern}).",
                )
        return trimmed

    def resolve_safe_project_path(self, target_folder: str, file_name: str) -> Path:
        norm_folder = target_folder.strip().strip("/\\").replace("\\", "/")
        if norm_folder not in ALLOWED_ROJO_SUBFOLDERS:
            norm_folder = "src/shared"

        safe_name = self.sanitize_luau_filename(file_name)
        root_resolved = self.project_path.resolve()
        candidate = (root_resolved / norm_folder / safe_name).resolve()

        if not str(candidate).startswith(str(root_resolved)):
            raise HTTPException(
                status_code=403,
                detail="Security Error: Path traversal outside ROJO_PROJECT_PATH blocked.",
            )
        return candidate

    def write_to_rojo(self, target_folder: str, file_name: str, luau_code: str) -> str:
        validated_code = self.validate_generated_luau_code(luau_code)
        dest_path = self.resolve_safe_project_path(target_folder, file_name)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_text(validated_code, encoding="utf-8")
        return str(dest_path.relative_to(self.project_path.resolve()))

    def check_port_open(self, host: str, port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.25)
            return s.connect_ex((host, port)) == 0

    def get_status(self) -> Dict[str, Any]:
        root = self.project_path.resolve()
        proj_json_path = root / "default.project.json"
        default_name = None
        if proj_json_path.exists():
            try:
                data = json.loads(proj_json_path.read_text(encoding="utf-8"))
                default_name = data.get("name", "ForgeAI_Roblox_Project")
            except Exception:
                default_name = "Invalid JSON"

        rojo_bin = shutil.which("rojo")
        rojo_version = None
        if rojo_bin:
            try:
                out = subprocess.check_output([rojo_bin, "--version"], text=True, timeout=2).strip()
                rojo_version = out
            except Exception:
                rojo_version = "rojo (detected)"

        luau_files = list(root.rglob("*.luau")) if root.exists() else []
        return {
            "project_path": str(root),
            "project_exists": root.exists(),
            "default_project_json_exists": proj_json_path.exists(),
            "default_project_name": default_name,
            "rojo_cli_installed": rojo_bin is not None,
            "rojo_cli_version": rojo_version,
            "rojo_server_listening": self.check_port_open("127.0.0.1", 34872),
            "rojo_port": 34872,
            "synced_files_count": len(luau_files),
        }

    def configure_project(
        self,
        new_path_str: str,
        create_if_missing: bool = True,
        init_default_project_json: bool = True,
    ) -> Dict[str, Any]:
        new_path = Path(new_path_str).expanduser().resolve()
        if not new_path.exists():
            if create_if_missing:
                new_path.mkdir(parents=True, exist_ok=True)
            else:
                raise HTTPException(status_code=404, detail=f"Path does not exist: {new_path}")

        self.project_path = new_path
        for sub in ALLOWED_ROJO_SUBFOLDERS:
            (self.project_path / sub).mkdir(parents=True, exist_ok=True)

        proj_json = self.project_path / "default.project.json"
        if init_default_project_json and not proj_json.exists():
            proj_json.write_text(json.dumps(DEFAULT_ROJO_PROJECT_JSON, indent=2), encoding="utf-8")

        return self.get_status()

    def get_sync_manifest(self) -> Dict[str, Any]:
        root = self.project_path.resolve()
        files_manifest: List[Dict[str, Any]] = []
        if root.exists():
            for p in sorted(root.rglob("*.luau")):
                raw = p.read_bytes()
                sha = hashlib.sha256(raw).hexdigest()[:16]
                files_manifest.append(
                    {
                        "relative_path": str(p.relative_to(root)),
                        "size_bytes": len(raw),
                        "sha256": sha,
                        "modified_at": datetime.fromtimestamp(
                            p.stat().st_mtime, tz=timezone.utc
                        ).isoformat(),
                    }
                )
        return {
            "project_path": str(root),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "files": files_manifest,
        }

    def audit_project_modules(self) -> List[Dict[str, Any]]:
        root = self.project_path.resolve()
        known_modules = [
            {
                "module_name": "Maid",
                "require_expression": 'require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Utils"):WaitForChild("Maid"))',
                "expected_rojo_path": "src/shared/Utils/Maid.luau",
            },
            {
                "module_name": "RemoteProvider",
                "require_expression": 'require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Network"):WaitForChild("RemoteProvider"))',
                "expected_rojo_path": "src/shared/Network/RemoteProvider.luau",
            },
            {
                "module_name": "GameTypes",
                "require_expression": 'require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Types"):WaitForChild("GameTypes"))',
                "expected_rojo_path": "src/shared/Types/GameTypes.luau",
            },
        ]
        results = []
        for mod in known_modules:
            full_path = root / mod["expected_rojo_path"]
            results.append({**mod, "exists_on_disk": full_path.exists()})
        return results
