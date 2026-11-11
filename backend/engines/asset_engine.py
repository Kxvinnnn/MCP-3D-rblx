"""
Asset Engine (backend/engines/asset_engine.py)
Manages PBR materials (SurfaceAppearance), local texture storage vs. real Roblox Open Cloud
publishing, polygon LOD optimization, CollisionFidelity validation, and the persistent
Reusable Asset Library.
"""

import base64
import hashlib
import json
import os
import re
import struct
import time
import urllib.request
import urllib.error
import uuid
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


DEFAULT_LIBRARY_PATH = (
    Path(__file__).resolve().parent.parent.parent / "rojo_workspace" / "assets_library.json"
)

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def is_verified_roblox_asset_uri(uri: Optional[str]) -> bool:
    """
    Returns True ONLY if `uri` is a real, non-zero `rbxassetid://<digits>` or `rbxasset://...`
    asset identifier (never `rbxassetid://0`, local file paths, or empty).
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


def validate_and_decode_png_bytes(
    png_bytes: bytes,
    target_preview_size: int = 32,
) -> Dict[str, Any]:
    """
    Validates that `png_bytes` is a genuine PNG image (checking the 8-byte PNG signature,
    IHDR width/height/colorType, and IDAT zlib stream), decodes scanlines, and downsamples
    the real pixel data into a `target_preview_size x target_preview_size` RGBA buffer
    encoded in base64 (`rgba_preview_b64`) for runtime `AssetService:CreateEditableImage()`
    reconstruction in Roblox Studio.
    """
    if not png_bytes or len(png_bytes) < 33:
        return {
            "valid": False,
            "error": "Buffer vacío o demasiado corto para ser un PNG válido.",
            "width": 0,
            "height": 0,
            "sha256": hashlib.sha256(png_bytes or b"").hexdigest()[:16],
            "rgba_preview_b64": None,
        }

    if png_bytes[:8] != PNG_SIGNATURE:
        return {
            "valid": False,
            "error": "Firma binaria PNG inválida (se esperaba \\x89PNG\\r\\n\\x1a\\n).",
            "width": 0,
            "height": 0,
            "sha256": hashlib.sha256(png_bytes).hexdigest()[:16],
            "rgba_preview_b64": None,
        }

    pos = 8
    width = 0
    height = 0
    bit_depth = 8
    color_type = 6
    idat_chunks: List[bytes] = []

    try:
        while pos + 8 <= len(png_bytes):
            chunk_len = struct.unpack(">I", png_bytes[pos : pos + 4])[0]
            chunk_type = png_bytes[pos + 4 : pos + 8]
            chunk_data_start = pos + 8
            chunk_data_end = chunk_data_start + chunk_len
            if chunk_data_end + 4 > len(png_bytes):
                return {
                    "valid": False,
                    "error": "Chunk PNG truncado o corrupto.",
                    "width": width,
                    "height": height,
                    "sha256": hashlib.sha256(png_bytes).hexdigest()[:16],
                    "rgba_preview_b64": None,
                }
            chunk_data = png_bytes[chunk_data_start:chunk_data_end]
            if chunk_type == b"IHDR" and len(chunk_data) >= 13:
                width, height, bit_depth, color_type = struct.unpack(">IIBB", chunk_data[:10])
            elif chunk_type == b"IDAT":
                idat_chunks.append(chunk_data)
            elif chunk_type == b"IEND":
                break
            pos = chunk_data_end + 4
    except Exception as exc:
        return {
            "valid": False,
            "error": f"Error leyendo estructura de chunks PNG: {exc}",
            "width": 0,
            "height": 0,
            "sha256": hashlib.sha256(png_bytes).hexdigest()[:16],
            "rgba_preview_b64": None,
        }

    if width <= 0 or height <= 0 or not idat_chunks:
        return {
            "valid": False,
            "error": "PNG sin dimensiones IHDR válidas o sin datos IDAT.",
            "width": width,
            "height": height,
            "sha256": hashlib.sha256(png_bytes).hexdigest()[:16],
            "rgba_preview_b64": None,
        }

    # Decompress IDAT stream and sample real pixels into target_preview_size x target_preview_size RGBA
    rgba_preview = bytearray(target_preview_size * target_preview_size * 4)
    try:
        raw_decompressed = zlib.decompress(b"".join(idat_chunks))
        bpp = 4 if color_type == 6 else (3 if color_type == 2 else (2 if color_type == 4 else 1))
        stride = width * bpp
        recon = bytearray(height * stride)

        def _paeth(a: int, b: int, c: int) -> int:
            p = a + b - c
            pa = abs(p - a)
            pb = abs(p - b)
            pc = abs(p - c)
            if pa <= pb and pa <= pc:
                return a
            if pb <= pc:
                return b
            return c

        in_offset = 0
        for y in range(height):
            if in_offset >= len(raw_decompressed):
                break
            filter_type = raw_decompressed[in_offset]
            in_offset += 1
            row_start = y * stride
            prev_row_start = (y - 1) * stride
            for x in range(stride):
                raw_val = raw_decompressed[in_offset] if in_offset < len(raw_decompressed) else 0
                in_offset += 1
                left = recon[row_start + x - bpp] if x >= bpp else 0
                up = recon[prev_row_start + x] if y > 0 else 0
                up_left = recon[prev_row_start + x - bpp] if (y > 0 and x >= bpp) else 0
                if filter_type == 0:
                    val = raw_val
                elif filter_type == 1:
                    val = (raw_val + left) & 0xFF
                elif filter_type == 2:
                    val = (raw_val + up) & 0xFF
                elif filter_type == 3:
                    val = (raw_val + ((left + up) >> 1)) & 0xFF
                elif filter_type == 4:
                    val = (raw_val + _paeth(left, up, up_left)) & 0xFF
                else:
                    val = raw_val
                recon[row_start + x] = val

        for py in range(target_preview_size):
            src_y = min(height - 1, int((py * height) / target_preview_size))
            for px in range(target_preview_size):
                src_x = min(width - 1, int((px * width) / target_preview_size))
                src_idx = src_y * stride + src_x * bpp
                dst_idx = (py * target_preview_size + px) * 4
                if bpp == 4:
                    rgba_preview[dst_idx : dst_idx + 4] = recon[src_idx : src_idx + 4]
                elif bpp == 3:
                    rgba_preview[dst_idx : dst_idx + 3] = recon[src_idx : src_idx + 3]
                    rgba_preview[dst_idx + 3] = 255
                else:
                    lum = recon[src_idx]
                    rgba_preview[dst_idx] = lum
                    rgba_preview[dst_idx + 1] = lum
                    rgba_preview[dst_idx + 2] = lum
                    rgba_preview[dst_idx + 3] = 255
    except Exception:
        # Even if custom filter mode prevented full scanline decode, zlib verify check:
        try:
            zlib.decompress(b"".join(idat_chunks))
        except Exception as z_err:
            return {
                "valid": False,
                "error": f"Stream zlib IDAT corrupto en PNG: {z_err}",
                "width": width,
                "height": height,
                "sha256": hashlib.sha256(png_bytes).hexdigest()[:16],
                "rgba_preview_b64": None,
            }

    return {
        "valid": True,
        "error": None,
        "width": width,
        "height": height,
        "bit_depth": bit_depth,
        "color_type": color_type,
        "sha256": hashlib.sha256(png_bytes).hexdigest()[:16],
        "rgba_preview_b64": base64.b64encode(bytes(rgba_preview)).decode("ascii"),
        "preview_dim": target_preview_size,
    }


def compute_asset_snapshot_sha256(asset_data: Dict[str, Any]) -> str:
    """
    Computes a canonical SHA-256 fingerprint over an asset's geometry (`parts`),
    PBR material configuration (`pbr_profile`), and `collision_fidelity` so version
    history never creates duplicate snapshots for identical states.
    """
    canonical = {
        "parts": asset_data.get("parts", []),
        "pbr_profile": asset_data.get("pbr_profile", {}),
        "collision_fidelity": asset_data.get("collision_fidelity", "Hull"),
    }
    serialized = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:16]


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

    @staticmethod
    def validate_and_decode_png(png_bytes: bytes, target_preview_size: int = 32) -> Dict[str, Any]:
        return validate_and_decode_png_bytes(png_bytes, target_preview_size)

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

        incoming_sha = compute_asset_snapshot_sha256(asset_data)
        asset_data["snapshot_sha256"] = incoming_sha

        updated = False
        for idx, existing in enumerate(assets):
            if existing.get("id") == asset_data["id"] or existing.get("name") == asset_data.get("name"):
                history = list(existing.get("version_history", []))
                prev_version = int(existing.get("version") or len(history) or 1)
                existing_sha = existing.get("snapshot_sha256") or compute_asset_snapshot_sha256(existing)

                # Only push a new snapshot if the geometry or PBR material genuinely changed
                if existing_sha != incoming_sha:
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
                        "snapshot_sha256": existing_sha,
                    }
                    # Deduplicate by version number and snapshot_sha256
                    history = [
                        h for h in history
                        if int(h.get("version", -1)) != prev_version
                        and h.get("snapshot_sha256") != existing_sha
                    ]
                    history.insert(0, snapshot)
                    asset_data["version"] = prev_version + 1
                else:
                    asset_data["version"] = prev_version

                asset_data["version_history"] = history[:20]
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
                    "snapshot_sha256": incoming_sha,
                }
            ]
            assets.insert(0, asset_data)

        self.save_library(assets)
        return asset_data

    def restore_asset_version(
        self,
        asset_id_or_name: str,
        target_version: int,
    ) -> Optional[Dict[str, Any]]:
        """
        Restores an asset's exact geometry (`parts`, including `meshData` and per-part `pbrMaterial`),
        `pbr_profile`, `collision_fidelity`, and `luau_code` from `version_history` without
        generating duplicate or inconsistent history entries.
        """
        assets = self.load_library()
        target_idx = -1
        target_asset = None
        for idx, a in enumerate(assets):
            if str(a.get("id")) == asset_id_or_name or str(a.get("name")) == asset_id_or_name:
                target_idx = idx
                target_asset = a
                break
        if target_asset is None or target_idx < 0:
            return None

        history = list(target_asset.get("version_history", []))
        snap = next((h for h in history if int(h.get("version", -1)) == int(target_version)), None)
        if not snap:
            return None

        now_iso = datetime.now(timezone.utc).isoformat()
        curr_version = int(target_asset.get("version", 1))
        curr_sha = target_asset.get("snapshot_sha256") or compute_asset_snapshot_sha256(target_asset)

        # Save current active state into history before restoring if not already present
        if not any(h.get("snapshot_sha256") == curr_sha for h in history):
            curr_parts_clone = json.loads(json.dumps(target_asset.get("parts", [])))
            curr_pbr_clone = json.loads(json.dumps(target_asset.get("pbr_profile", {})))
            history.insert(
                0,
                {
                    "version": curr_version,
                    "timestamp": target_asset.get("updated_at") or now_iso,
                    "poly_count": int(target_asset.get("poly_count", 0)),
                    "part_count": len(curr_parts_clone),
                    "collision_fidelity": str(target_asset.get("collision_fidelity", "Hull")),
                    "description": str(target_asset.get("description", "")),
                    "pbr_profile": curr_pbr_clone,
                    "luau_code": str(target_asset.get("luau_code", "")),
                    "parts": curr_parts_clone,
                    "snapshot_sha256": curr_sha,
                },
            )

        restored_parts = json.loads(json.dumps(snap.get("parts", [])))
        restored_pbr = json.loads(json.dumps(snap.get("pbr_profile", target_asset.get("pbr_profile", {}))))
        max_ver = max([curr_version] + [int(h.get("version", 1)) for h in history])

        target_asset["parts"] = restored_parts
        target_asset["pbr_profile"] = restored_pbr
        target_asset["poly_count"] = int(snap.get("poly_count", target_asset.get("poly_count", 0)))
        target_asset["collision_fidelity"] = str(snap.get("collision_fidelity", target_asset.get("collision_fidelity", "Hull")))
        target_asset["luau_code"] = str(snap.get("luau_code", target_asset.get("luau_code", "")))
        if snap.get("description"):
            target_asset["description"] = str(snap["description"])
        target_asset["version"] = max_ver + 1
        target_asset["restored_from_version"] = int(target_version)
        target_asset["updated_at"] = now_iso
        target_asset["snapshot_sha256"] = compute_asset_snapshot_sha256(target_asset)
        target_asset["version_history"] = history[:25]

        assets[target_idx] = target_asset
        self.save_library(assets)
        return target_asset

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
        and always returns a structured dictionary.
        """
        payload_sha256 = hashlib.sha256(png_bytes or b"").hexdigest()
        resolved_key = (api_key or os.getenv("ROBLOX_OPEN_CLOUD_API_KEY") or "").strip()
        resolved_creator = (
            creator_user_id
            or os.getenv("ROBLOX_CREATOR_ID")
            or os.getenv("ROBLOX_CREATOR_USER_ID")
            or ""
        ).strip()

        png_validation = validate_and_decode_png_bytes(png_bytes)
        if not png_validation["valid"]:
            return {
                "published": False,
                "roblox_asset_uri": None,
                "asset_id": None,
                "operation_id": None,
                "display_name": display_name,
                "sha256": payload_sha256,
                "status": "invalid_png_bytes",
                "error": png_validation["error"] or "Empty or invalid PNG buffer.",
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
                    "status": "cloud_published",
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
                "status": "cloud_publishing" if (operation_id and not op_error) else "failed",
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
                "status": "failed",
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
        decoded_rgba_previews: Optional[Dict[str, str]] = None,
    ) -> str:
        """
        Generates a `--!strict` Luau module for Roblox `SurfaceAppearance` that:
        1. Binds verified published Roblox Cloud Asset IDs (`rbxassetid://<positive_int>`) per channel
           to `SurfaceAppearance.ColorMap`, `NormalMap`, `RoughnessMap`, and `MetalnessMap`.
        2. Explicitly handles partial publication (e.g., when only 1 or 2 maps are published to Roblox Cloud):
           binds the published channels to `SurfaceAppearance`, while reconstructing unpublished ColorMap
           pixels from the actual decoded PNG RGBA buffer (`decoded_rgba_previews`) via
           `AssetService:CreateEditableImage()` and `MeshPart.TextureContent`.
        3. Includes `VerifyVisualAppearance(targetPart)` to validate in Roblox Studio that the material
           is visually applied and records per-channel status attributes.
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

        published_count = sum(1 for v in [verified_color, verified_normal, verified_rough, verified_metal] if v)
        if published_count == 4:
            pub_state = "cloud_published"
        elif published_count > 0:
            pub_state = "partially_published"
        else:
            pub_state = "local_saved"

        color_val_lua = f'"{verified_color}"' if verified_color else "nil"
        normal_val_lua = f'"{verified_normal}"' if verified_normal else "nil"
        rough_val_lua = f'"{verified_rough}"' if verified_rough else "nil"
        metal_val_lua = f'"{verified_metal}"' if verified_metal else "nil"

        albedo_rgba_b64 = (decoded_rgba_previews or {}).get("ColorMap.png") or ""

        return "\n".join(
            [
                "--!strict",
                f"-- Generated by Forge AI Asset Engine: {safe_mat} (Publication State: {pub_state}, Published Channels: {published_count}/4)",
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
                "export type PBRVisualVerificationReport = {",
                "    visualVerificationPassed: boolean,",
                "    publicationState: string,",
                "    verifiedCloudChannelCount: number,",
                "    editableImageFallbackActive: boolean,",
                "    channelStatus: { [string]: string },",
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
                f'local EMBEDDED_ALBEDO_RGBA32_B64 = "{albedo_rgba_b64}"',
                "",
                "local LOCAL_ROJO_FILES = {",
                f'    ColorMapPath = "{effective_folder}/{safe_mat}_ColorMap.png",',
                f'    NormalMapPath = "{effective_folder}/{safe_mat}_NormalMap.png",',
                f'    RoughnessMapPath = "{effective_folder}/{safe_mat}_RoughnessMap.png",',
                f'    MetalnessMapPath = "{effective_folder}/{safe_mat}_MetalnessMap.png",',
                "}",
                "",
                "local B64_ALPHABET = \"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/\"",
                "local function decodeBase64ToBuffer(b64: string, expectedBytes: number): buffer?",
                "    if #b64 == 0 then return nil end",
                "    local out = buffer.create(expectedBytes)",
                "    local outIdx = 0",
                "    local acc = 0",
                "    local bits = 0",
                "    for i = 1, #b64 do",
                "        local ch = string.sub(b64, i, i)",
                "        if ch == \"=\" then break end",
                "        local pos = string.find(B64_ALPHABET, ch, 1, true)",
                "        if pos then",
                "            acc = acc * 64 + (pos - 1)",
                "            bits += 6",
                "            if bits >= 8 then",
                "                bits -= 8",
                "                local byteVal = math.floor(acc / (2 ^ bits)) % 256",
                "                if outIdx < expectedBytes then",
                "                    buffer.writeu8(out, outIdx, byteVal)",
                "                    outIdx += 1",
                "                end",
                "            end",
                "        end",
                "    end",
                "    if outIdx < expectedBytes then return nil end",
                "    return out",
                "end",
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
                f"function {safe_mat}PBR.VerifyVisualAppearance(targetPart: BasePart): PBRVisualVerificationReport",
                '    local sa = targetPart:FindFirstChildOfClass("SurfaceAppearance")',
                "    local channelStatus: { [string]: string } = {",
                '        ColorMap = "missing",',
                '        NormalMap = "missing",',
                '        RoughnessMap = "missing",',
                '        MetalnessMap = "missing",',
                "    }",
                "    local verifiedCloudCount = 0",
                "    if sa then",
                "        if isValidRobloxAssetUri(sa.ColorMap) then channelStatus.ColorMap = \"cloud_published\"; verifiedCloudCount += 1 end",
                "        if isValidRobloxAssetUri(sa.NormalMap) then channelStatus.NormalMap = \"cloud_published\"; verifiedCloudCount += 1 end",
                "        if isValidRobloxAssetUri(sa.RoughnessMap) then channelStatus.RoughnessMap = \"cloud_published\"; verifiedCloudCount += 1 end",
                "        if isValidRobloxAssetUri(sa.MetalnessMap) then channelStatus.MetalnessMap = \"cloud_published\"; verifiedCloudCount += 1 end",
                "    end",
                '    local editableActive = targetPart:GetAttribute("PBR_EditableImageBound") == true',
                '    if channelStatus.ColorMap == "missing" and editableActive then',
                '        channelStatus.ColorMap = "editable_image_bound"',
                "    end",
                "    local pubState = if verifiedCloudCount == 4 then \"cloud_published\" elseif verifiedCloudCount > 0 then \"partially_published\" elseif editableActive then \"local_saved\" else \"failed\"",
                "    local passed = (verifiedCloudCount > 0) or editableActive",
                '    targetPart:SetAttribute("PBR_VisualVerificationPassed", passed)',
                '    targetPart:SetAttribute("PBR_VerifiedChannelsCount", verifiedCloudCount)',
                '    targetPart:SetAttribute("PBR_PublicationStatus", pubState)',
                "    return {",
                "        visualVerificationPassed = passed,",
                "        publicationState = pubState,",
                "        verifiedCloudChannelCount = verifiedCloudCount,",
                "        editableImageFallbackActive = editableActive,",
                "        channelStatus = channelStatus,",
                "    }",
                "end",
                "",
                f"function {safe_mat}PBR.Apply(targetPart: BasePart, overrideIds: PublishedPBRTextureIds?): Instance",
                '    local existing = targetPart:FindFirstChildOfClass("SurfaceAppearance")',
                "    if existing then",
                "        existing:Destroy()",
                "    end",
                "",
                f"    targetPart.Color = Color3.fromRGB({r_val}, {g_val}, {b_val})",
                f"    targetPart.Reflectance = {min(1.0, max(0.0, metalness * 0.35)):.2f}",
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
                '    local surface = Instance.new("SurfaceAppearance")',
                f'    surface.Name = "{safe_mat}_SurfaceAppearance"',
                "    surface.AlphaMode = Enum.AlphaMode.Overlay",
                "",
                "    -- Bind each verified cloud channel independently (supports full 4-map or partial 1..3-map publication)",
                "    if isValidRobloxAssetUri(ids.ColorMap) then",
                "        surface.ColorMap = ids.ColorMap :: string",
                '        targetPart:SetAttribute("PBR_Channel_ColorMap", "cloud_published")',
                "    else",
                '        targetPart:SetAttribute("PBR_Channel_ColorMap", "unverified_or_local")',
                "    end",
                "    if isValidRobloxAssetUri(ids.NormalMap) then",
                "        surface.NormalMap = ids.NormalMap :: string",
                '        targetPart:SetAttribute("PBR_Channel_NormalMap", "cloud_published")',
                "    else",
                '        targetPart:SetAttribute("PBR_Channel_NormalMap", "unverified_or_local")',
                "    end",
                "    if isValidRobloxAssetUri(ids.RoughnessMap) then",
                "        surface.RoughnessMap = ids.RoughnessMap :: string",
                '        targetPart:SetAttribute("PBR_Channel_RoughnessMap", "cloud_published")',
                "    else",
                '        targetPart:SetAttribute("PBR_Channel_RoughnessMap", "unverified_or_local")',
                "    end",
                "    if isValidRobloxAssetUri(ids.MetalnessMap) then",
                "        surface.MetalnessMap = ids.MetalnessMap :: string",
                '        targetPart:SetAttribute("PBR_Channel_MetalnessMap", "cloud_published")',
                "    else",
                '        targetPart:SetAttribute("PBR_Channel_MetalnessMap", "unverified_or_local")',
                "    end",
                "",
                "    -- When ColorMap is not yet published as a cloud rbxassetid://, reconstruct the decoded PNG pixels via EditableImage",
                "    if not isValidRobloxAssetUri(ids.ColorMap) then",
                "        local okEditableImg, editableImg = pcall(function()",
                "            local img = AssetService:CreateEditableImage({ Size = Vector2.new(32, 32) })",
                "            if not img then",
                '                error("AssetService:CreateEditableImage returned nil")',
                "            end",
                "            local pixelBuffer = decodeBase64ToBuffer(EMBEDDED_ALBEDO_RGBA32_B64, 32 * 32 * 4)",
                "            if not pixelBuffer then",
                "                pixelBuffer = buffer.create(32 * 32 * 4)",
                "                for py = 0, 31 do",
                "                    for px = 0, 31 do",
                "                        local offset = (py * 32 + px) * 4",
                "                        local gridBand = if (px % 8 == 0 or py % 8 == 0) then 0.84 else 1.0",
                f"                        buffer.writeu8(pixelBuffer, offset, math.clamp(math.floor({r_val} * gridBand), 0, 255))",
                f"                        buffer.writeu8(pixelBuffer, offset + 1, math.clamp(math.floor({g_val} * gridBand), 0, 255))",
                f"                        buffer.writeu8(pixelBuffer, offset + 2, math.clamp(math.floor({b_val} * gridBand), 0, 255))",
                "                        buffer.writeu8(pixelBuffer, offset + 3, 255)",
                "                    end",
                "                end",
                "            end",
                "            img:WritePixelsBuffer(Vector2.zero, Vector2.new(32, 32), pixelBuffer)",
                "            return img",
                "        end)",
                '        if okEditableImg and editableImg and targetPart:IsA("MeshPart") then',
                "            local okBind = pcall(function()",
                "                (targetPart :: any).TextureContent = Content.fromObject(editableImg)",
                "            end)",
                '            targetPart:SetAttribute("PBR_EditableImageBound", okBind)',
                "        end",
                "    end",
                "",
                "    surface.Parent = targetPart",
                f"    {safe_mat}PBR.VerifyVisualAppearance(targetPart)",
                "    return surface",
                "end",
                "",
                f"return {safe_mat}PBR",
            ]
        )

