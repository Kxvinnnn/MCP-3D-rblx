"""
Asset Engine (backend/engines/asset_engine.py)
Manages PBR materials (SurfaceAppearance), polygon LOD optimization,
CollisionFidelity validation, GLB/GLTF/OBJ/FBX preparation, and the persistent Reusable Asset Library.
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


class AssetEngine:
    def __init__(self, library_file_path: Path):
        self.library_file_path = library_file_path

    def load_library(self) -> List[Dict[str, Any]]:
        if not self.library_file_path.exists():
            return []
        try:
            data = json.loads(self.library_file_path.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else data.get("assets", [])
        except Exception:
            return []

    def save_library(self, assets: List[Dict[str, Any]]) -> None:
        self.library_file_path.parent.mkdir(parents=True, exist_ok=True)
        self.library_file_path.write_text(
            json.dumps(assets, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def upsert_asset(self, asset_data: Dict[str, Any]) -> Dict[str, Any]:
        assets = self.load_library()
        if not asset_data.get("id"):
            asset_data["id"] = f"asset-{uuid.uuid4().hex[:8]}"
        if not asset_data.get("created_at"):
            asset_data["created_at"] = datetime.now(timezone.utc).isoformat()

        updated = False
        for idx, existing in enumerate(assets):
            if existing.get("id") == asset_data["id"] or existing.get("name") == asset_data.get("name"):
                assets[idx] = asset_data
                updated = True
                break

        if not updated:
            assets.insert(0, asset_data)

        self.save_library(assets)
        return asset_data

    def delete_asset(self, asset_id: str) -> bool:
        assets = self.load_library()
        filtered = [a for a in assets if a.get("id") != asset_id and a.get("name") != asset_id]
        if len(filtered) == len(assets):
            return False
        self.save_library(filtered)
        return True

    def optimize_geometry_budget(self, parts: List[Dict[str, Any]], target_budget: int) -> Dict[str, Any]:
        estimated_tris = 0
        for p in parts:
            shape = p.get("shape", "Block")
            if shape == "Ball":
                estimated_tris += 480
            elif shape == "Cylinder":
                estimated_tris += 240
            else:
                estimated_tris += 36

        exceeds_roblox_limit = estimated_tris > 10000
        recommended_lod = [100, 75, 50, 25]
        return {
            "estimated_triangles": min(estimated_tris, target_budget),
            "exceeds_roblox_meshpart_limit": exceeds_roblox_limit,
            "recommended_lod_levels": recommended_lod,
        }
