"""
Asset Engine (backend/engines/asset_engine.py)
Manages PBR materials (SurfaceAppearance), local texture storage vs. real Roblox Open Cloud
publishing, polygon LOD optimization, CollisionFidelity validation, and the persistent
Reusable Asset Library.
"""

import hashlib
import json
import os
import re
import time
import urllib.request
import urllib.error
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


DEFAULT_LIBRARY_PATH = (
    Path(__file__).resolve().parent.parent.parent / "rojo_workspace" / "assets_library.json"
)


def is_verified_roblox_asset_uri(uri: Optional[str]) -> bool:
    """
    Returns True ONLY if `uri` is a real, non-zero `rbxassetid://<digits>` or `rbxasset://...`
    asset identifier (never `rbxassetid://0` or empty).
    """
    if not uri:
        return False
    cleaned = str(uri).strip()
    if cleaned.startswith("rbxassetid://"):
        numeric_part = cleaned.replace("rbxassetid://", "").split()[0].strip()
        return numeric_part.isdigit() and int(numeric_part) > 0
    if cleaned.startswith("rbxasset://") and len(cleaned) > len("rbxasset://"):
        return True
    return False


class AssetEngine:
    def __init__(self, library_file_path: Optional[Path] = None):
        self.library_file_path: Path = library_file_path or DEFAULT_LIBRARY_PATH

    @staticmethod
    def is_verified_roblox_asset_uri(uri: Optional[str]) -> bool:
        """
        Method on AssetEngine so both `asset_engine.is_verified_roblox_asset_uri(uri)`
        and module-level `is_verified_roblox_asset_uri(uri)` work seamlessly.
        """
        return is_verified_roblox_asset_uri(uri)

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
        now_iso = datetime.now(timezone.utc).isoformat()
        if not asset_data.get("id"):
            asset_data["id"] = f"asset-{uuid.uuid4().hex[:8]}"
        if not asset_data.get("created_at"):
            asset_data["created_at"] = now_iso

        updated = False
        for idx, existing in enumerate(assets):
            if existing.get("id") == asset_data["id"] or existing.get("name") == asset_data.get("name"):
                # Preserve full version history snapshots (parts, luau_code, pbr_profile, collision_fidelity) up to 10 revisions
                history = list(existing.get("version_history", []))
                prev_version = int(existing.get("version") or len(history) or 1)
                snapshot_parts = json.loads(json.dumps(existing.get("parts", [])))
                snapshot_pbr = json.loads(json.dumps(existing.get("pbr_profile", {})))
                snapshot = {
                    "version": prev_version,
                    "timestamp": existing.get("updated_at") or existing.get("created_at") or now_iso,
                    "poly_count": int(existing.get("poly_count", 0)),
                    "part_count": len(snapshot_parts),
                    "collision_fidelity": str(existing.get("collision_fidelity", "Hull")),
                    "description": str(existing.get("description", "")),
                    "pbr_profile": snapshot_pbr,
                    "luau_code": str(existing.get("luau_code", "")),
                    "parts": snapshot_parts,
                }
                history.insert(0, snapshot)
                asset_data["version"] = prev_version + 1
                asset_data["version_history"] = history[:10]
                asset_data["created_at"] = existing.get("created_at", now_iso)
                asset_data["updated_at"] = now_iso
                assets[idx] = asset_data
                updated = True
                break

        if not updated:
            asset_data["version"] = 1
            asset_data["updated_at"] = now_iso
            init_parts = json.loads(json.dumps(asset_data.get("parts", [])))
            init_pbr = json.loads(json.dumps(asset_data.get("pbr_profile", {})))
            asset_data["version_history"] = [
                {
                    "version": 1,
                    "timestamp": asset_data["created_at"],
                    "poly_count": int(asset_data.get("poly_count", 0)),
                    "part_count": len(init_parts),
                    "collision_fidelity": str(asset_data.get("collision_fidelity", "Hull")),
                    "description": str(asset_data.get("description", "")),
                    "pbr_profile": init_pbr,
                    "luau_code": str(asset_data.get("luau_code", "")),
                    "parts": init_parts,
                }
            ]
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
            mesh_data = p.get("meshData")
            if isinstance(mesh_data, dict) and isinstance(mesh_data.get("faces"), list):
                estimated_tris += len(mesh_data["faces"])
            else:
                shape = p.get("shape", "MeshPart")
                if shape == "Ball":
                    estimated_tris += 120
                elif shape == "Cylinder":
                    estimated_tris += 48
                else:
                    estimated_tris += 48

        exceeds_roblox_limit = estimated_tris > 10000
        recommended_lod = [100, 75, 50, 25]
        return {
            "estimated_triangles": min(estimated_tris, target_budget),
            "actual_triangles": estimated_tris,
            "exceeds_roblox_meshpart_limit": exceeds_roblox_limit,
            "recommended_lod_levels": recommended_lod,
        }

    def publish_decal_to_roblox_cloud(
        self,
        png_bytes: bytes,
        display_name: str,
        api_key: Optional[str] = None,
        creator_user_id: Optional[str] = None,
        max_poll_attempts: int = 8,
        poll_interval_sec: float = 0.75,
    ) -> Dict[str, Any]:
        """
        Publishes a PNG texture map to Roblox Open Cloud Assets API (`/assets/v1/assets`),
        handles both immediate responses and asynchronous `Operation` polling
        (`GET https://apis.roblox.com/assets/v1/operations/{operationId}` when `done == False`),
        and always returns a structured dictionary with:
        - `published`: bool
        - `roblox_asset_uri`: Optional[str] (`rbxassetid://<id>` when verified)
        - `asset_id`: Optional[str]
        - `operation_id`: Optional[str]
        - `sha256`: str
        - `status`: str
        - `error`: Optional[str]
        """
        payload_sha256 = hashlib.sha256(png_bytes or b"").hexdigest()
        resolved_key = (api_key or os.getenv("ROBLOX_OPEN_CLOUD_API_KEY") or "").strip()
        resolved_creator = (
            creator_user_id
            or os.getenv("ROBLOX_CREATOR_ID")
            or os.getenv("ROBLOX_CREATOR_USER_ID")
            or ""
        ).strip()

        if not png_bytes or len(png_bytes) < 16:
            return {
                "published": False,
                "roblox_asset_uri": None,
                "asset_id": None,
                "operation_id": None,
                "display_name": display_name,
                "sha256": payload_sha256,
                "status": "invalid_png_bytes",
                "error": "Empty or invalid PNG buffer.",
            }

        if not resolved_key or not resolved_creator:
            return {
                "published": False,
                "roblox_asset_uri": None,
                "asset_id": None,
                "operation_id": None,
                "display_name": display_name,
                "sha256": payload_sha256,
                "status": "local_rojo_only",
                "error": None,
            }

        boundary = f"----ForgeBoundary{uuid.uuid4().hex}"
        request_json = json.dumps(
            {
                "assetType": "Decal",
                "displayName": display_name[:45],
                "description": f"Published by Forge AI Studio PBR Pipeline ({display_name}, sha256:{payload_sha256[:12]})",
                "creationContext": {
                    "creator": {
                        "userId": resolved_creator,
                    }
                },
            }
        )

        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="request"\r\n'
            f"Content-Type: application/json\r\n\r\n"
            f"{request_json}\r\n"
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="fileContent"; filename="{display_name}.png"\r\n'
            f"Content-Type: image/png\r\n\r\n"
        ).encode("utf-8") + png_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

        req = urllib.request.Request(
            "https://apis.roblox.com/assets/v1/assets",
            data=body,
            headers={
                "x-api-key": resolved_key,
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))

            def _extract_asset_id(obj: Dict[str, Any]) -> Optional[str]:
                direct = obj.get("assetId") or (obj.get("response") or {}).get("assetId")
                if direct and str(direct).isdigit() and int(str(direct)) > 0:
                    return str(direct)
                path_val = str(obj.get("path") or (obj.get("response") or {}).get("path") or "")
                if path_val.startswith("assets/"):
                    cand = path_val.split("/", 1)[1].strip()
                    if cand.isdigit() and int(cand) > 0:
                        return cand
                return None

            asset_id = _extract_asset_id(resp_data)
            operation_id = str(resp_data.get("operationId") or "").strip()
            if not operation_id:
                raw_path = str(resp_data.get("path") or "").strip()
                if raw_path.startswith("operations/"):
                    operation_id = raw_path.split("/", 1)[1].strip()

            # Poll Roblox Open Cloud Operation endpoint if asynchronous (`done` is False)
            is_done = bool(resp_data.get("done", False))
            if not asset_id and operation_id and not is_done:
                op_url = f"https://apis.roblox.com/assets/v1/operations/{operation_id}"
                for _ in range(max(1, max_poll_attempts)):
                    time.sleep(poll_interval_sec)
                    poll_req = urllib.request.Request(
                        op_url,
                        headers={"x-api-key": resolved_key},
                        method="GET",
                    )
                    with urllib.request.urlopen(poll_req, timeout=10) as poll_resp:
                        poll_data = json.loads(poll_resp.read().decode("utf-8"))
                    asset_id = _extract_asset_id(poll_data)
                    if asset_id or poll_data.get("done"):
                        resp_data = poll_data
                        break

            if asset_id and asset_id.isdigit() and int(asset_id) > 0:
                uri = f"rbxassetid://{asset_id}"
                return {
                    "published": True,
                    "roblox_asset_uri": uri,
                    "asset_id": asset_id,
                    "operation_id": operation_id or None,
                    "display_name": display_name,
                    "sha256": payload_sha256,
                    "status": "published_cloud",
                    "error": None,
                }

            op_error = (
                (resp_data.get("error") or {}).get("message")
                if isinstance(resp_data.get("error"), dict)
                else None
            )
            return {
                "published": False,
                "roblox_asset_uri": None,
                "asset_id": None,
                "operation_id": operation_id or None,
                "display_name": display_name,
                "sha256": payload_sha256,
                "status": "operation_pending_or_incomplete",
                "error": op_error or "Open Cloud operation did not return a final assetId within polling window.",
            }
        except Exception as exc:
            return {
                "published": False,
                "roblox_asset_uri": None,
                "asset_id": None,
                "operation_id": None,
                "display_name": display_name,
                "sha256": payload_sha256,
                "status": "cloud_request_failed",
                "error": str(exc),
            }

    def generate_pbr_surface_appearance_luau(
        self,
        material_name: str,
        local_texture_folder: str = "src/shared/Assets3D/Textures",
        target_folder: Optional[str] = None,
        roughness: float = 0.35,
        metalness: float = 0.75,
        albedo_hex: str = "#38bdf8",
        emissive_hex: str = "#06b6d4",
        pattern: str = "hex_plate",
        color_map_id: Optional[str] = None,
        normal_map_id: Optional[str] = None,
        roughness_map_id: Optional[str] = None,
        metalness_map_id: Optional[str] = None,
    ) -> str:
        """
        Generates a `--!strict` Luau module for Roblox `SurfaceAppearance` that strictly separates:
        1. Local Rojo PNG texture storage (`src/shared/Assets3D/Textures/*.png` for all 4 channels)
        2. Verified published Roblox Cloud Asset IDs (`rbxassetid://<real_id>`)
        3. Real-time `AssetService:CreateEditableImage()` fallback when cloud IDs are not yet published
        Never emits `rbxassetid://0` or synthetic hash asset IDs, and accepts both `target_folder`
        and `local_texture_folder` keyword arguments.
        """
        safe_mat = re.sub(r"[^a-zA-Z0-9_]", "", material_name or "ForgePBRMaterial") or "ForgePBRMaterial"
        effective_folder = (target_folder or local_texture_folder or "src/shared/Assets3D/Textures").strip()
        clean_hex = albedo_hex.lstrip("#")
        if len(clean_hex) == 6:
            try:
                r_val = int(clean_hex[0:2], 16)
                g_val = int(clean_hex[2:4], 16)
                b_val = int(clean_hex[4:6], 16)
            except ValueError:
                r_val, g_val, b_val = 56, 189, 248
        else:
            r_val, g_val, b_val = 56, 189, 248

        verified_color = color_map_id.strip() if is_verified_roblox_asset_uri(color_map_id) and color_map_id else ""
        verified_normal = normal_map_id.strip() if is_verified_roblox_asset_uri(normal_map_id) and normal_map_id else ""
        verified_rough = (
            roughness_map_id.strip() if is_verified_roblox_asset_uri(roughness_map_id) and roughness_map_id else ""
        )
        verified_metal = (
            metalness_map_id.strip() if is_verified_roblox_asset_uri(metalness_map_id) and metalness_map_id else ""
        )

        has_published_ids = any([verified_color, verified_normal, verified_rough, verified_metal])
        pub_status = "PUBLISHED_ROBLOX_CLOUD" if has_published_ids else "LOCAL_ROJO_AND_EDITABLE_IMAGE"

        color_val_lua = f'"{verified_color}"' if verified_color else "nil"
        normal_val_lua = f'"{verified_normal}"' if verified_normal else "nil"
        rough_val_lua = f'"{verified_rough}"' if verified_rough else "nil"
        metal_val_lua = f'"{verified_metal}"' if verified_metal else "nil"

        return "\n".join(
            [
                "--!strict",
                f"-- Generated by Forge AI Asset Engine: {safe_mat} (Status: {pub_status})",
                f"-- Local Rojo PNG Maps: {effective_folder}/{safe_mat}_ColorMap.png, _NormalMap.png, _RoughnessMap.png, _MetalnessMap.png",
                'local AssetService = game:GetService("AssetService")',
                "",
                "export type PublishedPBRTextureIds = {",
                "    ColorMap: string?,",
                "    NormalMap: string?,",
                "    RoughnessMap: string?,",
                "    MetalnessMap: string?,",
                "}",
                "",
                f"local {safe_mat}PBR = {{}}",
                "",
                "local PUBLISHED_TEXTURE_IDS: PublishedPBRTextureIds = {",
                f"    ColorMap = {color_val_lua},",
                f"    NormalMap = {normal_val_lua},",
                f"    RoughnessMap = {rough_val_lua},",
                f"    MetalnessMap = {metal_val_lua},",
                "}",
                "",
                "local LOCAL_ROJO_FILES = {",
                f'    ColorMapPath = "{effective_folder}/{safe_mat}_ColorMap.png",',
                f'    NormalMapPath = "{effective_folder}/{safe_mat}_NormalMap.png",',
                f'    RoughnessMapPath = "{effective_folder}/{safe_mat}_RoughnessMap.png",',
                f'    MetalnessMapPath = "{effective_folder}/{safe_mat}_MetalnessMap.png",',
                "}",
                "",
                "local function isValidRobloxAssetUri(uri: string?): boolean",
                '    if not uri or uri == "" or uri == "rbxassetid://0" then',
                "        return false",
                "    end",
                '    return string.match(uri, "^rbxassetid://[1-9]%d*$") ~= nil or string.match(uri, "^rbxasset://.+") ~= nil',
                "end",
                "",
                f"function {safe_mat}PBR.RegisterPublishedTextureIds(ids: PublishedPBRTextureIds)",
                "    if isValidRobloxAssetUri(ids.ColorMap) then PUBLISHED_TEXTURE_IDS.ColorMap = ids.ColorMap end",
                "    if isValidRobloxAssetUri(ids.NormalMap) then PUBLISHED_TEXTURE_IDS.NormalMap = ids.NormalMap end",
                "    if isValidRobloxAssetUri(ids.RoughnessMap) then PUBLISHED_TEXTURE_IDS.RoughnessMap = ids.RoughnessMap end",
                "    if isValidRobloxAssetUri(ids.MetalnessMap) then PUBLISHED_TEXTURE_IDS.MetalnessMap = ids.MetalnessMap end",
                "end",
                "",
                f"function {safe_mat}PBR.Apply(targetPart: BasePart, overrideIds: PublishedPBRTextureIds?): Instance",
                '    local existing = targetPart:FindFirstChildOfClass("SurfaceAppearance")',
                "    if existing then",
                "        existing:Destroy()",
                "    end",
                "",
                f"    targetPart.Color = Color3.fromRGB({r_val}, {g_val}, {b_val})",
                f'    targetPart:SetAttribute("PBR_MaterialName", "{safe_mat}")',
                f'    targetPart:SetAttribute("PBR_Pattern", "{pattern}")',
                f'    targetPart:SetAttribute("PBR_Roughness", {roughness:.2f})',
                f'    targetPart:SetAttribute("PBR_Metalness", {metalness:.2f})',
                f'    targetPart:SetAttribute("PBR_AlbedoHex", "{albedo_hex}")',
                f'    targetPart:SetAttribute("PBR_EmissiveHex", "{emissive_hex}")',
                '    targetPart:SetAttribute("PBR_LocalColorMap", LOCAL_ROJO_FILES.ColorMapPath)',
                '    targetPart:SetAttribute("PBR_LocalNormalMap", LOCAL_ROJO_FILES.NormalMapPath)',
                '    targetPart:SetAttribute("PBR_LocalRoughnessMap", LOCAL_ROJO_FILES.RoughnessMapPath)',
                '    targetPart:SetAttribute("PBR_LocalMetalnessMap", LOCAL_ROJO_FILES.MetalnessMapPath)',
                "",
                "    local ids = overrideIds or PUBLISHED_TEXTURE_IDS",
                "    local hasVerifiedCloudIds = isValidRobloxAssetUri(ids.ColorMap)",
                "        or isValidRobloxAssetUri(ids.NormalMap)",
                "        or isValidRobloxAssetUri(ids.RoughnessMap)",
                "        or isValidRobloxAssetUri(ids.MetalnessMap)",
                "",
                '    local surface = Instance.new("SurfaceAppearance")',
                f'    surface.Name = "{safe_mat}_SurfaceAppearance"',
                "    surface.AlphaMode = Enum.AlphaMode.Overlay",
                "",
                "    if hasVerifiedCloudIds then",
                "        if isValidRobloxAssetUri(ids.ColorMap) then surface.ColorMap = ids.ColorMap :: string end",
                "        if isValidRobloxAssetUri(ids.NormalMap) then surface.NormalMap = ids.NormalMap :: string end",
                "        if isValidRobloxAssetUri(ids.RoughnessMap) then surface.RoughnessMap = ids.RoughnessMap :: string end",
                "        if isValidRobloxAssetUri(ids.MetalnessMap) then surface.MetalnessMap = ids.MetalnessMap :: string end",
                '        targetPart:SetAttribute("PBR_PublicationStatus", "PUBLISHED_CLOUD_IDS_BOUND")',
                "    else",
                "        -- Synthesize runtime procedural EditableImage texture when cloud IDs are not yet published",
                "        local okEditableImg, editableImg = pcall(function()",
                "            local img = AssetService:CreateEditableImage({ Size = Vector2.new(32, 32) })",
                "            if not img then",
                '                error("AssetService:CreateEditableImage returned nil")',
                "            end",
                "            local pixelBuffer = buffer.create(32 * 32 * 4)",
                "            for py = 0, 31 do",
                "                for px = 0, 31 do",
                "                    local offset = (py * 32 + px) * 4",
                "                    local gridBand = if (px % 8 == 0 or py % 8 == 0) then 0.84 else 1.0",
                f"                    buffer.writeu8(pixelBuffer, offset, math.clamp(math.floor({r_val} * gridBand), 0, 255))",
                f"                    buffer.writeu8(pixelBuffer, offset + 1, math.clamp(math.floor({g_val} * gridBand), 0, 255))",
                f"                    buffer.writeu8(pixelBuffer, offset + 2, math.clamp(math.floor({b_val} * gridBand), 0, 255))",
                "                    buffer.writeu8(pixelBuffer, offset + 3, 255)",
                "                end",
                "            end",
                "            img:WritePixelsBuffer(Vector2.zero, Vector2.new(32, 32), pixelBuffer)",
                "            return img",
                "        end)",
                '        if okEditableImg and editableImg and targetPart:IsA("MeshPart") then',
                "            pcall(function()",
                "                (targetPart :: any).TextureContent = Content.fromObject(editableImg)",
                "            end)",
                "        end",
                '        targetPart:SetAttribute("PBR_PublicationStatus", "LOCAL_ROJO_READY_FOR_CLOUD_UPLOAD")',
                "    end",
                "",
                "    surface.Parent = targetPart",
                "    return surface",
                "end",
                "",
                f"return {safe_mat}PBR",
            ]
        )

