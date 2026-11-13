"""
3D Generation Engine (backend/engines/generation_3d_engine.py)
Synthesizes multi-part 3D Roblox models from text, reference images, or uploaded 3D meshes,
extracting real vertex, triangle index, normal, and UV buffers, automatically splitting
oversized meshes into sub-meshes (<10,000 triangles) without truncating geometry, and
generating:
- `--!strict` Luau scripts using `AssetService:CreateEditableMesh()` + `AssetService:CreateMeshPartAsync()`
  (never assigning read-only `MeshPart.MeshId` or inventing fictional `rbxassetid://` hashes)
- Native Roblox Studio `.rbxmx` XML models with auto-executing `ForgeAutoReconstructRunner` Script
- Standard `.gltf` 2.0 files with embedded binary geometry buffers and embedded PBR texture maps
- Paired Wavefront `.obj` and `.mtl` files
"""

import base64
import json
import math
import struct
import time
import xml.etree.ElementTree as ET
import xml.sax.saxutils as saxutils
from typing import Any, Callable, Dict, Generator, List, Literal, Optional, Tuple

try:
    from pydantic import BaseModel, Field, field_validator
except ImportError:
    class _FieldDefault:
        def __init__(self, default: Any = None, default_factory: Optional[Callable[[], Any]] = None, **kwargs: Any):
            self.default = default
            self.default_factory = default_factory

    def Field(default: Any = None, default_factory: Optional[Callable[[], Any]] = None, **kwargs: Any) -> Any:
        return _FieldDefault(default=default, default_factory=default_factory, **kwargs)

    def field_validator(*fields: str, **kwargs: Any) -> Callable[[Any], Any]:
        def _decorator(fn: Any) -> Any:
            return fn
        return _decorator

    class BaseModel:
        def __init__(self, **kwargs: Any):
            cls = self.__class__
            annotations = getattr(cls, "__annotations__", {})
            for name in annotations:
                val = getattr(cls, name, None)
                if isinstance(val, _FieldDefault):
                    if val.default_factory is not None:
                        setattr(self, name, val.default_factory())
                    else:
                        setattr(self, name, val.default)
                elif not callable(val):
                    setattr(self, name, val)
            for k, v in kwargs.items():
                if k == "meshData" and isinstance(v, dict):
                    v = SubMeshGeometrySpec(**v)
                elif k == "pbr_profile" and isinstance(v, dict):
                    v = PBRProfileSpec(**v)
                elif k == "parts" and isinstance(v, list):
                    v = [MeshPart3DSpec(**x) if isinstance(x, dict) else x for x in v]
                setattr(self, k, v)
            if hasattr(self, "_coerce_non_block_shape"):
                self.shape = self._coerce_non_block_shape(getattr(self, "shape", "MeshPart"))

        def model_dump(self) -> Dict[str, Any]:
            out: Dict[str, Any] = {}
            for k, v in self.__dict__.items():
                if isinstance(v, BaseModel):
                    out[k] = v.model_dump()
                elif isinstance(v, list):
                    out[k] = [x.model_dump() if isinstance(x, BaseModel) else x for x in v]
                else:
                    out[k] = v
            return out

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None  # type: ignore
    types = None  # type: ignore


ROBLOX_MAX_VERTICES_PER_SUBMESH = 9000
ROBLOX_MAX_TRIANGLES_PER_SUBMESH = 9500

ROBLOX_MATERIAL_ENUM_TOKENS: Dict[str, int] = {
    "Plastic": 256,
    "SmoothPlastic": 272,
    "Neon": 288,
    "Wood": 512,
    "WoodPlanks": 528,
    "Marble": 784,
    "Slate": 800,
    "Concrete": 816,
    "Granite": 832,
    "Brick": 848,
    "Pebble": 864,
    "Cobblestone": 880,
    "CorrodedMetal": 1040,
    "DiamondPlate": 1056,
    "Foil": 1072,
    "Metal": 1088,
    "Grass": 1280,
    "Sand": 1296,
    "Fabric": 1312,
    "Ice": 1536,
    "Glass": 1568,
    "ForceField": 1584,
}

ROBLOX_TOKEN_TO_MATERIAL: Dict[int, str] = {v: k for k, v in ROBLOX_MATERIAL_ENUM_TOKENS.items()}



def validate_published_roblox_mesh_id(candidate: Optional[str]) -> str:
    """
    Validates whether `candidate` is an explicitly provided, published Roblox asset URI
    (`rbxassetid://<positive_integer>` or `rbxasset://...`).
    Never invents fictional hash-based `rbxassetid://` numbers and rejects `rbxassetid://0`.
    Returns `""` when no published Roblox asset ID is bound, signaling direct `EditableMesh` construction.
    """
    if not candidate:
        return ""
    trimmed = str(candidate).strip()
    if trimmed.startswith("rbxassetid://"):
        rest = trimmed.replace("rbxassetid://", "").split()[0].strip()
        if rest.isdigit() and int(rest) > 0:
            return f"rbxassetid://{rest}"
    elif trimmed.startswith("rbxasset://") and len(trimmed) > len("rbxasset://"):
        return trimmed
    return ""


class SubMeshGeometrySpec(BaseModel):
    vertices: List[List[float]] = Field(
        default_factory=list,
        description="Array of [x, y, z] local-space vertex positions in Studs",
    )
    normals: List[List[float]] = Field(
        default_factory=list,
        description="Array of [nx, ny, nz] unit vertex normals",
    )
    uvs: List[List[float]] = Field(
        default_factory=list,
        description="Array of [u, v] texture coordinates in [0, 1]",
    )
    faces: List[List[int]] = Field(
        default_factory=list,
        description="Array of [i0, i1, i2] 0-based triangle vertex indices",
    )
    indices: Optional[List[int]] = Field(
        default=None,
        description="Flat 0-based triangle index buffer [i0, i1, i2, ...]",
    )
    vertexColors: Optional[List[List[float]]] = Field(
        default=None,
        description="Optional [r, g, b] vertex colors (0..1)",
    )
    objFileName: Optional[str] = Field(
        default=None,
        description="Associated Wavefront .obj asset file in Rojo",
    )
    meshId: Optional[str] = Field(
        default=None,
        description="Optional published Roblox MeshId URI (rbxassetid://<published_id>) if uploaded to Roblox Cloud",
    )
    assetId: Optional[str] = Field(
        default=None,
        description="Optional published Roblox AssetId reference if uploaded to Roblox Cloud",
    )
    geometrySource: Optional[str] = Field(
        default=None,
        description="Origin of geometry ('EditableMeshBuffers', 'PublishedCloudMeshId', or 'StudioExternalUnreadable')",
    )


def parse_wavefront_obj_geometry(obj_text: str, obj_file_name: Optional[str] = None) -> SubMeshGeometrySpec:
    """
    Extracts real vertex (`v`), normal (`vn`), UV (`vt`), and triangle index (`f`) data
    from a Wavefront .OBJ mesh or sub-mesh chunk.

    Supports independent `v/vt/vn`, `v//vn`, `v/vt`, and `v` face corner indices (including
    negative relative indices exported by Blender) by creating distinct unified vertices
    whenever a position index `v` is paired with a different `(vt, vn)` combination at UV
    seams or hard-edge smoothing group boundaries.
    """
    raw_positions: List[List[float]] = []
    raw_normals: List[List[float]] = []
    raw_uvs: List[List[float]] = []

    out_vertices: List[List[float]] = []
    out_uvs: List[List[float]] = []
    out_normals: List[Optional[List[float]]] = []
    faces: List[List[int]] = []

    # Maps (pos_idx, uv_idx, norm_idx) -> unified 0-based vertex index in out_vertices
    unique_corner_map: Dict[Tuple[int, int, int], int] = {}

    def _resolve_index(raw_token: str, current_len: int) -> int:
        if not raw_token:
            return -1
        try:
            idx = int(raw_token)
        except ValueError:
            return -1
        if idx > 0:
            resolved = idx - 1
        elif idx < 0:
            resolved = current_len + idx
        else:
            return -1
        return resolved if 0 <= resolved < current_len else -1

    for raw_line in (obj_text or "").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        prefix = parts[0]
        if prefix == "v" and len(parts) >= 4:
            try:
                raw_positions.append([float(parts[1]), float(parts[2]), float(parts[3])])
            except ValueError:
                pass
        elif prefix == "vn" and len(parts) >= 4:
            try:
                nx, ny, nz = float(parts[1]), float(parts[2]), float(parts[3])
                length = math.sqrt(nx * nx + ny * ny + nz * nz)
                if length > 1e-6:
                    raw_normals.append([nx / length, ny / length, nz / length])
                else:
                    raw_normals.append([0.0, 1.0, 0.0])
            except ValueError:
                pass
        elif prefix == "vt" and len(parts) >= 3:
            try:
                raw_uvs.append([float(parts[1]), float(parts[2])])
            except ValueError:
                pass
        elif prefix == "f" and len(parts) >= 4:
            face_unified_indices: List[int] = []
            for token in parts[1:]:
                sub_tokens = token.split("/")
                v_idx = _resolve_index(sub_tokens[0], len(raw_positions))
                if v_idx < 0:
                    continue
                vt_idx = _resolve_index(sub_tokens[1], len(raw_uvs)) if len(sub_tokens) >= 2 else -1
                vn_idx = _resolve_index(sub_tokens[2], len(raw_normals)) if len(sub_tokens) >= 3 else -1

                corner_key = (v_idx, vt_idx, vn_idx)
                unified_idx = unique_corner_map.get(corner_key)
                if unified_idx is None:
                    unified_idx = len(out_vertices)
                    unique_corner_map[corner_key] = unified_idx
                    pos = raw_positions[v_idx]
                    out_vertices.append([pos[0], pos[1], pos[2]])
                    if 0 <= vt_idx < len(raw_uvs):
                        uv = raw_uvs[vt_idx]
                        out_uvs.append([uv[0], uv[1]])
                    else:
                        out_uvs.append([0.0, 0.0])
                    if 0 <= vn_idx < len(raw_normals):
                        nm = raw_normals[vn_idx]
                        out_normals.append([nm[0], nm[1], nm[2]])
                    else:
                        out_normals.append(None)

                face_unified_indices.append(unified_idx)

            for i in range(1, len(face_unified_indices) - 1):
                i0 = face_unified_indices[0]
                i1 = face_unified_indices[i]
                i2 = face_unified_indices[i + 1]
                if i0 != i1 and i1 != i2 and i0 != i2:
                    faces.append([i0, i1, i2])

    # Fallback if an OBJ had `v` lines but no `f` lines (point cloud / unindexed vertices)
    if not out_vertices and raw_positions:
        out_vertices = [[p[0], p[1], p[2]] for p in raw_positions]
        out_uvs = [
            raw_uvs[i] if i < len(raw_uvs) else [0.0, 0.0]
            for i in range(len(out_vertices))
        ]
        out_normals = [
            raw_normals[i] if i < len(raw_normals) else None
            for i in range(len(out_vertices))
        ]

    # Compute smooth area-weighted normals for any unified vertices that did not specify an explicit `vn`
    accum_normals: List[List[float]] = [[0.0, 0.0, 0.0] for _ in range(len(out_vertices))]
    if out_vertices and faces:
        for tri in faces:
            i0, i1, i2 = tri[0], tri[1], tri[2]
            if i0 < len(out_vertices) and i1 < len(out_vertices) and i2 < len(out_vertices):
                v0, v1, v2 = out_vertices[i0], out_vertices[i1], out_vertices[i2]
                ux, uy, uz = v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]
                vx, vy, vz = v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]
                nx = uy * vz - uz * vy
                ny = uz * vx - ux * vz
                nz = ux * vy - uy * vx
                for idx in (i0, i1, i2):
                    accum_normals[idx][0] += nx
                    accum_normals[idx][1] += ny
                    accum_normals[idx][2] += nz

    final_normals: List[List[float]] = []
    for idx in range(len(out_vertices)):
        explicit_norm = out_normals[idx]
        if explicit_norm is not None:
            final_normals.append(explicit_norm)
        else:
            cn = accum_normals[idx]
            length = math.sqrt(cn[0] * cn[0] + cn[1] * cn[1] + cn[2] * cn[2])
            if length > 1e-6:
                final_normals.append([cn[0] / length, cn[1] / length, cn[2] / length])
            else:
                final_normals.append([0.0, 1.0, 0.0])

    flat_indices = [idx for tri in faces for idx in tri]
    return SubMeshGeometrySpec(
        vertices=out_vertices,
        normals=final_normals,
        uvs=out_uvs,
        faces=faces,
        indices=flat_indices,
        objFileName=obj_file_name,
    )


def extract_mesh_geometry_from_processed_submesh(
    sub_mesh: Dict[str, Any],
    default_obj_file: Optional[str] = None,
    model_name: str = "ImportedMesh3D",
) -> SubMeshGeometrySpec:
    """
    Extracts real vertex, index (faces), normal, and UV data from an uploaded/processed sub-mesh payload:
    1. Uses `sub_mesh['meshData']` if present and populated.
    2. Or extracts direct `vertices`, `indices`/`faces`, `normals`, and `uvs` arrays on `sub_mesh`.
    3. Or parses the Wavefront `.obj` chunk (`wavefrontObjChunk` / `objChunk`) to recover exact geometry.
    4. Synthesizes tessellated `MeshPart` vertex/index/normal buffers if only dimensions were provided.
    """
    obj_file = sub_mesh.get("objFileName") or default_obj_file or f"{model_name}.obj"
    raw_mesh_id = sub_mesh.get("meshId") or sub_mesh.get("mesh_id")
    raw_asset_id = sub_mesh.get("assetId") or sub_mesh.get("asset_id") or raw_mesh_id

    mesh_data = sub_mesh.get("meshData")
    if isinstance(mesh_data, dict) and len(mesh_data.get("vertices", [])) > 0:
        verts = mesh_data.get("vertices", [])
        norms = mesh_data.get("normals", [])
        uv_coords = mesh_data.get("uvs", [])
        faces = mesh_data.get("faces", [])
        raw_indices = mesh_data.get("indices", [])
        if not faces and isinstance(raw_indices, list) and len(raw_indices) >= 3:
            faces = [
                [int(raw_indices[i]), int(raw_indices[i + 1]), int(raw_indices[i + 2])]
                for i in range(0, len(raw_indices) - 2, 3)
            ]
        flat_indices = [idx for tri in faces for idx in tri]
        valid_id = validate_published_roblox_mesh_id(
            mesh_data.get("meshId") or raw_mesh_id or raw_asset_id
        )
        return SubMeshGeometrySpec(
            vertices=verts,
            normals=norms if len(norms) == len(verts) else [[0.0, 1.0, 0.0]] * len(verts),
            uvs=uv_coords if len(uv_coords) == len(verts) else [[0.0, 0.0]] * len(verts),
            faces=faces,
            indices=flat_indices,
            vertexColors=mesh_data.get("vertexColors"),
            objFileName=mesh_data.get("objFileName") or obj_file,
            meshId=valid_id or None,
            assetId=valid_id or None,
        )

    if isinstance(sub_mesh.get("vertices"), list) and len(sub_mesh["vertices"]) > 0:
        verts = sub_mesh["vertices"]
        norms = sub_mesh.get("normals") or [[0.0, 1.0, 0.0]] * len(verts)
        uv_coords = sub_mesh.get("uvs") or [[0.0, 0.0]] * len(verts)
        faces = sub_mesh.get("faces") or []
        raw_indices = sub_mesh.get("indices") or []
        if not faces and len(raw_indices) >= 3:
            faces = [
                [int(raw_indices[i]), int(raw_indices[i + 1]), int(raw_indices[i + 2])]
                for i in range(0, len(raw_indices) - 2, 3)
            ]
        flat_indices = [idx for tri in faces for idx in tri]
        valid_id = validate_published_roblox_mesh_id(raw_mesh_id or raw_asset_id)
        return SubMeshGeometrySpec(
            vertices=verts,
            normals=norms,
            uvs=uv_coords,
            faces=faces,
            indices=flat_indices,
            objFileName=obj_file,
            meshId=valid_id or None,
            assetId=valid_id or None,
        )

    obj_chunk = sub_mesh.get("wavefrontObjChunk") or sub_mesh.get("objChunk")
    if isinstance(obj_chunk, str) and "v " in obj_chunk:
        parsed_obj = parse_wavefront_obj_geometry(obj_chunk, obj_file)
        if len(parsed_obj.vertices) > 0 and len(parsed_obj.faces) > 0:
            valid_id = validate_published_roblox_mesh_id(raw_mesh_id or raw_asset_id)
            parsed_obj.meshId = valid_id or None
            parsed_obj.assetId = valid_id or None
            return parsed_obj

    valid_id = validate_published_roblox_mesh_id(raw_mesh_id or raw_asset_id)
    raw_geom_source = str(
        sub_mesh.get("geometrySource")
        or sub_mesh.get("geometry_source")
        or (mesh_data.get("geometrySource") if isinstance(mesh_data, dict) else "")
        or ""
    ).strip()
    if valid_id or raw_geom_source in ("PublishedCloudMeshId", "StudioExternalUnreadable"):
        return SubMeshGeometrySpec(
            vertices=[],
            normals=[],
            uvs=[],
            faces=[],
            indices=[],
            objFileName=obj_file,
            meshId=valid_id or None,
            assetId=valid_id or None,
            geometrySource="PublishedCloudMeshId" if valid_id else (raw_geom_source or "StudioExternalUnreadable"),
        )

    stud_size = sub_mesh.get("studSize") or sub_mesh.get("size") or [2.0, 2.0, 2.0]
    synth = synthesize_procedural_mesh_data(sub_mesh.get("shape", "MeshPart"), stud_size)
    synth.objFileName = obj_file
    synth.meshId = valid_id or None
    synth.assetId = valid_id or None
    synth.geometrySource = "EditableMeshBuffers"
    return synth


def synthesize_procedural_mesh_data(shape: str = "MeshPart", size: Optional[List[float]] = None) -> SubMeshGeometrySpec:
    """
    Generates indexed triangle mesh buffers (vertices, normals, UVs, faces, and flat 0-based
    triangle `indices`) in local Stud coordinates so every sub-part is serialized as a true
    Roblox `MeshPart` with real multi-faceted topology.
    """
    dims = (size or [2.0, 2.0, 2.0]) + [2.0, 2.0, 2.0]
    sx, sy, sz = float(dims[0]), float(dims[1]), float(dims[2])
    hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
    norm_shape = (shape or "MeshPart").strip()
    if norm_shape.lower() == "block":
        norm_shape = "MeshPart"

    if norm_shape in ("Wedge", "CornerWedge"):
        vertices = [
            [-hx, -hy, -hz],
            [hx, -hy, -hz],
            [hx, -hy, hz],
            [-hx, -hy, hz],
            [-hx, hy, hz],
            [hx, hy, hz],
        ]
        normals = [
            [0.0, -1.0, 0.0],
            [0.0, -1.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.0, 0.0, 1.0],
            [0.0, 0.7071, -0.7071],
            [0.0, 0.7071, -0.7071],
        ]
        uvs = [
            [0.0, 0.0],
            [1.0, 0.0],
            [1.0, 1.0],
            [0.0, 1.0],
            [0.0, 0.5],
            [1.0, 0.5],
        ]
        faces = [
            [0, 2, 1],
            [0, 3, 2],
            [3, 5, 2],
            [3, 4, 5],
            [0, 1, 5],
            [0, 5, 4],
            [0, 4, 3],
            [1, 2, 5],
        ]
        return SubMeshGeometrySpec(
            vertices=vertices,
            normals=normals,
            uvs=uvs,
            faces=faces,
            indices=[idx for tri in faces for idx in tri],
        )

    if norm_shape == "Cylinder":
        segments = 12
        vertices = []
        normals = []
        uvs = []
        faces = []
        rx = hx
        rz = hz
        for i in range(segments):
            theta = (2.0 * math.pi * i) / segments
            ct, st = math.cos(theta), math.sin(theta)
            u = i / float(segments)
            vertices.append([rx * ct, -hy, rz * st])
            normals.append([ct, 0.0, st])
            uvs.append([u, 0.0])
            vertices.append([rx * ct, hy, rz * st])
            normals.append([ct, 0.0, st])
            uvs.append([u, 1.0])

        bottom_center_idx = len(vertices)
        vertices.append([0.0, -hy, 0.0])
        normals.append([0.0, -1.0, 0.0])
        uvs.append([0.5, 0.5])

        top_center_idx = len(vertices)
        vertices.append([0.0, hy, 0.0])
        normals.append([0.0, 1.0, 0.0])
        uvs.append([0.5, 0.5])

        for i in range(segments):
            nxt = (i + 1) % segments
            b0, t0 = i * 2, i * 2 + 1
            b1, t1 = nxt * 2, nxt * 2 + 1
            faces.append([b0, b1, t1])
            faces.append([b0, t1, t0])
            faces.append([bottom_center_idx, b1, b0])
            faces.append([top_center_idx, t0, t1])

        return SubMeshGeometrySpec(
            vertices=vertices,
            normals=normals,
            uvs=uvs,
            faces=faces,
            indices=[idx for tri in faces for idx in tri],
        )

    if norm_shape == "Ball":
        lat_bands = 6
        lon_bands = 10
        vertices = []
        normals = []
        uvs = []
        faces = []
        for lat in range(lat_bands + 1):
            theta = (lat * math.pi) / lat_bands
            sin_t, cos_t = math.sin(theta), math.cos(theta)
            for lon in range(lon_bands + 1):
                phi = (lon * 2.0 * math.pi) / lon_bands
                sin_p, cos_p = math.sin(phi), math.cos(phi)
                nx, ny, nz = cos_p * sin_t, cos_t, sin_p * sin_t
                vertices.append([hx * nx, hy * ny, hz * nz])
                normals.append([nx, ny, nz])
                uvs.append([lon / float(lon_bands), lat / float(lat_bands)])

        for lat in range(lat_bands):
            for lon in range(lon_bands):
                first = lat * (lon_bands + 1) + lon
                second = first + lon_bands + 1
                faces.append([first, second, first + 1])
                faces.append([second, second + 1, first + 1])

        return SubMeshGeometrySpec(
            vertices=vertices,
            normals=normals,
            uvs=uvs,
            faces=faces,
            indices=[idx for tri in faces for idx in tri],
        )

    segments = 8
    bevel_scale = 0.82
    ring_levels = [
        (-hy, bevel_scale, 0.0),
        (0.0, 1.0, 0.5),
        (hy, bevel_scale, 1.0),
    ]
    vertices = []
    normals = []
    uvs = []
    faces = []

    for y_pos, radial_scale, v_coord in ring_levels:
        ny_comp = -0.35 if y_pos < 0 else (0.35 if y_pos > 0 else 0.0)
        for i in range(segments):
            theta = (2.0 * math.pi * i) / segments + (math.pi / segments)
            ct, st = math.cos(theta), math.sin(theta)
            vx = hx * radial_scale * ct
            vz = hz * radial_scale * st
            n_len = math.sqrt(ct * ct + ny_comp * ny_comp + st * st) or 1.0
            vertices.append([round(vx, 4), round(y_pos, 4), round(vz, 4)])
            normals.append([round(ct / n_len, 4), round(ny_comp / n_len, 4), round(st / n_len, 4)])
            uvs.append([round(i / float(segments), 4), v_coord])

    bottom_cap_idx = len(vertices)
    vertices.append([0.0, round(-hy, 4), 0.0])
    normals.append([0.0, -1.0, 0.0])
    uvs.append([0.5, 0.0])

    top_cap_idx = len(vertices)
    vertices.append([0.0, round(hy, 4), 0.0])
    normals.append([0.0, 1.0, 0.0])
    uvs.append([0.5, 1.0])

    for r in range(2):
        ring_a = r * segments
        ring_b = (r + 1) * segments
        for i in range(segments):
            nxt = (i + 1) % segments
            a0, a1 = ring_a + i, ring_a + nxt
            b0, b1 = ring_b + i, ring_b + nxt
            faces.append([a0, a1, b1])
            faces.append([a0, b1, b0])

    top_ring = 2 * segments
    for i in range(segments):
        nxt = (i + 1) % segments
        faces.append([bottom_cap_idx, nxt, i])
        faces.append([top_cap_idx, top_ring + i, top_ring + nxt])

    return SubMeshGeometrySpec(
        vertices=vertices,
        normals=normals,
        uvs=uvs,
        faces=faces,
        indices=[idx for tri in faces for idx in tri],
    )


class MeshPart3DSpec(BaseModel):
    partId: Optional[str] = Field(default=None, description="Stable ForgePartId identifier")
    parentId: Optional[str] = Field(default=None, description="Stable ForgeParentId identifier")
    parentName: Optional[str] = Field(default="ModelRoot", description="Parent container name or path")
    parentContainerClass: Optional[str] = Field(default="Model", description="Container class ('Folder' or 'Model')")
    hierarchyPath: Optional[str] = Field(default=None, description="Full canonical hierarchy path")
    name: str = Field(description="Sub-part name in PascalCase")
    shape: Literal["MeshPart", "Cylinder", "Ball", "Wedge", "CornerWedge"] = Field(
        default="MeshPart",
        description="Roblox MeshPart geometry descriptor",
    )
    meshId: Optional[str] = Field(
        default=None,
        description="Optional published Roblox MeshId URI reference (rbxassetid://<published_id>)",
    )
    assetId: Optional[str] = Field(
        default=None,
        description="Optional published Roblox AssetId reference (rbxassetid://<published_id>)",
    )
    textureId: Optional[str] = Field(
        default=None,
        description="Optional published Roblox TextureID URI reference (rbxassetid://<published_id>)",
    )
    geometrySource: Optional[str] = Field(
        default=None,
        description="Origin of geometry ('EditableMeshBuffers', 'PublishedCloudMeshId', or 'StudioExternalUnreadable')",
    )
    size: List[float] = Field(
        default_factory=lambda: [2.0, 2.0, 2.0],
        description="[X, Y, Z] bounding box reference in Studs",
    )
    position: List[float] = Field(description="[X, Y, Z] position offset in Studs")
    rotation: List[float] = Field(
        default_factory=lambda: [0.0, 0.0, 0.0],
        description="[RX, RY, RZ] Euler rotation in degrees",
    )
    rotationMatrix: Optional[List[float]] = Field(
        default=None,
        description="Optional 9-component 3x3 rotation matrix [r00..r22]",
    )
    color: List[int] = Field(description="[R, G, B] 0-255 color")
    material: str = Field(default="Metal", description="Roblox Enum.Material name")
    roughness: float = Field(default=0.35)
    metalness: float = Field(default=0.6)
    reflectance: float = Field(default=0.0)
    transparency: float = Field(default=0.0)
    canCollide: bool = Field(default=True)
    anchored: bool = Field(default=True)
    collisionFidelity: Literal["Default", "Box", "Hull", "PreciseConvexDecomposition"] = Field(default="Hull")
    pbrMaterial: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional per-MeshPart 4-channel PBR material specification",
    )
    meshData: Optional[SubMeshGeometrySpec] = Field(
        default=None,
        description="Real extracted vertex/normal/UV/triangle index buffers for MeshPart",
    )
    geometryHash: Optional[str] = Field(default=None)
    materialHash: Optional[str] = Field(default=None)
    transformHash: Optional[str] = Field(default=None)
    hierarchyHash: Optional[str] = Field(default=None)
    combinedHash: Optional[str] = Field(default=None)
    integritySha256: Optional[str] = Field(default=None)

    @field_validator("shape", mode="before")
    @classmethod
    def _coerce_non_block_shape(cls, v: Any) -> str:
        if not v or str(v).strip().lower() == "block":
            return "MeshPart"
        s = str(v).strip()
        if s in ("MeshPart", "Cylinder", "Ball", "Wedge", "CornerWedge"):
            return s
        return "MeshPart"


def split_oversized_mesh_part(
    part: MeshPart3DSpec,
    max_verts: int = ROBLOX_MAX_VERTICES_PER_SUBMESH,
    max_faces: int = ROBLOX_MAX_TRIANGLES_PER_SUBMESH,
) -> List[MeshPart3DSpec]:
    """
    Splits an oversized MeshPart into multiple contiguous sub-meshes that each strictly
    respect `max_verts` and `max_faces` (<10,000 triangles per Roblox MeshPart),
    remapping vertices, normals, UVs, and triangle face indices cleanly so ZERO triangles
    or vertex attributes are ever truncated or lost.
    """
    mesh_data = part.meshData
    if not mesh_data or not mesh_data.vertices or not mesh_data.faces:
        return [part]

    total_verts = len(mesh_data.vertices)
    total_faces = len(mesh_data.faces)
    if total_verts <= max_verts and total_faces <= max_faces:
        return [part]

    verts = mesh_data.vertices
    norms = mesh_data.normals if len(mesh_data.normals) == total_verts else [[0.0, 1.0, 0.0]] * total_verts
    uvs = mesh_data.uvs if len(mesh_data.uvs) == total_verts else [[0.0, 0.0]] * total_verts

    sub_parts: List[MeshPart3DSpec] = []
    chunk_idx = 1
    current_verts: List[List[float]] = []
    current_norms: List[List[float]] = []
    current_uvs: List[List[float]] = []
    current_faces: List[List[int]] = []
    old_to_new: Dict[int, int] = {}

    def flush_chunk() -> None:
        nonlocal chunk_idx, current_verts, current_norms, current_uvs, current_faces, old_to_new
        if not current_faces:
            return
        flat_indices = [idx for tri in current_faces for idx in tri]
        sub_geom = SubMeshGeometrySpec(
            vertices=current_verts,
            normals=current_norms,
            uvs=current_uvs,
            faces=current_faces,
            indices=flat_indices,
            objFileName=mesh_data.objFileName,
            meshId=mesh_data.meshId,
            assetId=mesh_data.assetId,
        )
        sub_name = f"{part.name}_Sub{chunk_idx}" if total_faces > max_faces or total_verts > max_verts else part.name
        sub_parts.append(
            MeshPart3DSpec(
                name=sub_name,
                shape="MeshPart",
                meshId=part.meshId,
                assetId=part.assetId,
                textureId=part.textureId,
                size=list(part.size),
                position=list(part.position),
                rotation=list(part.rotation),
                color=list(part.color),
                material=part.material,
                roughness=part.roughness,
                metalness=part.metalness,
                transparency=part.transparency,
                canCollide=part.canCollide,
                anchored=part.anchored,
                collisionFidelity=part.collisionFidelity,
                pbrMaterial=part.pbrMaterial,
                meshData=sub_geom,
            )
        )
        chunk_idx += 1
        current_verts = []
        current_norms = []
        current_uvs = []
        current_faces = []
        old_to_new = {}

    for tri in mesh_data.faces:
        if len(tri) < 3:
            continue
        i0, i1, i2 = tri[0], tri[1], tri[2]
        if i0 >= total_verts or i1 >= total_verts or i2 >= total_verts or i0 < 0 or i1 < 0 or i2 < 0:
            continue

        needed_new_verts = sum(1 for idx in {i0, i1, i2} if idx not in old_to_new)
        if (len(current_faces) + 1 > max_faces) or (len(current_verts) + needed_new_verts > max_verts):
            flush_chunk()

        mapped_tri: List[int] = []
        for orig_idx in (i0, i1, i2):
            new_idx = old_to_new.get(orig_idx)
            if new_idx is None:
                new_idx = len(current_verts)
                old_to_new[orig_idx] = new_idx
                current_verts.append(verts[orig_idx])
                current_norms.append(norms[orig_idx])
                current_uvs.append(uvs[orig_idx])
            mapped_tri.append(new_idx)
        current_faces.append(mapped_tri)

    flush_chunk()
    return sub_parts if sub_parts else [part]


class PBRProfileSpec(BaseModel):
    albedo_hex: str = Field(default="#334155")
    roughness: float = Field(default=0.35)
    metalness: float = Field(default=0.75)
    emissive_hex: str = Field(default="#06b6d4")
    roblox_material: str = Field(default="Metal")
    pattern: str = Field(default="BrushedTitanium")
    albedo_asset_path: Optional[str] = Field(default=None)
    normal_asset_path: Optional[str] = Field(default=None)
    roughness_asset_path: Optional[str] = Field(default=None)
    metalness_asset_path: Optional[str] = Field(default=None)
    color_map_asset_id: Optional[str] = Field(default=None)
    normal_map_asset_id: Optional[str] = Field(default=None)
    roughness_map_asset_id: Optional[str] = Field(default=None)
    metalness_map_asset_id: Optional[str] = Field(default=None)


class Generate3DEngineRequest(BaseModel):
    prompt: str = "Procedural 3D Asset"
    name: Optional[str] = None
    asset_type: Literal["Model3D", "Scene3D", "PBRMaterial"] = "Model3D"
    category: str = "Props"
    generation_mode: Optional[str] = None
    seed: Optional[str] = None
    tree_params: Optional[Dict[str, Any]] = None
    model_tier: Literal["fast", "pro"] = "fast"
    collision_fidelity: Literal["Default", "Box", "Hull", "PreciseConvexDecomposition"] = "Hull"
    target_poly_budget: int = 2500
    reference_image_base64: Optional[str] = None
    reference_image_mime_type: Optional[str] = "image/png"
    uploaded_mesh_obj: Optional[str] = Field(
        default=None,
        description="Optional uploaded Wavefront .OBJ text to extract real vertex, index, and normal buffers from",
    )
    uploaded_sub_meshes: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description="Optional uploaded sub-mesh descriptors containing vertex/index/normal arrays",
    )
    save_to_rojo: bool = True
    save_to_library: bool = True


class Model3DResponse(BaseModel):
    id: Optional[str] = Field(default=None)
    name: str = Field(description="PascalCase 3D model name")
    category: str = Field(default="Props")
    asset_type: Literal["Model3D", "Scene3D", "PBRMaterial"] = Field(default="Model3D")
    generation_mode: Optional[str] = Field(default=None)
    seed: Optional[str] = Field(default=None)
    poly_count: int = Field(description="Estimated triangle count (<10,000 per MeshPart)")
    collision_fidelity: Literal["Default", "Box", "Hull", "PreciseConvexDecomposition"] = Field(default="Hull")
    rojo_target_folder: str = Field(default="src/shared/Assets3D")
    file_name: str = Field(description="Luau builder file name ending in .luau")
    description: str = Field(description="Architectural summary of the 3D asset")
    pbr_profile: PBRProfileSpec
    parts: List[MeshPart3DSpec] = Field(description="6 to 14 articulated 3D MeshPart sub-parts")
    luau_code: str = Field(
        description="Complete --!strict Luau module that constructs true MeshParts via AssetService:CreateEditableMesh()"
    )
    saved_path: Optional[str] = Field(default=None)


GENERATION_3D_SYSTEM_INSTRUCTION = """
You are the Principal 3D Generation Engine for Forge AI Studio (Roblox).
MANDATORY LUAU & 3D MESHPART GEOMETRY RULES:
1. Start EVERY Luau script with `--!strict`.
2. Use ONLY `task.wait`, `task.spawn`, `task.delay`, `task.defer`.
3. NEVER use `'Block'` shapes or `Instance.new("Part")` dimensions. Every sub-part MUST be a true `MeshPart` (`shape: "MeshPart"`) with serialized vertex/index buffers (`meshData`).
4. NEVER invent fake `rbxassetid://` numbers or attempt to assign `MeshPart.MeshId` (which is read-only). Construct geometry directly from buffers via `AssetService:CreateEditableMesh()` and `AssetService:CreateMeshPartAsync(Content.fromObject(editableMesh))`.
5. Decompose every requested 3D asset into 6 to 14 articulated 3D MeshPart sub-parts across three silhouette scales:
   - Primary Silhouette (hull, chassis, foundation, main body)
   - Secondary Read (turrets, wings, columns, canopy, structural supports)
   - Accent Details (neon emitters, optic sensors, vents, bevel trims, terminals)
6. Ground the model so the lowest point rests flush at Y = 0 (bottom-center pivot) with realistic Roblox Stud proportions (1 R15 character = 5.5 studs tall).
"""


def _euler_deg_to_rotation_matrix(rx_deg: float, ry_deg: float, rz_deg: float) -> Tuple[float, ...]:
    rx = math.radians(rx_deg)
    ry = math.radians(ry_deg)
    rz = math.radians(rz_deg)
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)

    r00 = cy * cz
    r01 = -cy * sz
    r02 = sy
    r10 = sx * sy * cz + cx * sz
    r11 = -sx * sy * sz + cx * cz
    r12 = -sx * cy
    r20 = -cx * sy * cz + sx * sz
    r21 = cx * sy * sz + sx * cz
    r22 = cx * cy
    return (r00, r01, r02, r10, r11, r12, r20, r21, r22)


def _rotation_matrix_to_euler_deg(
    r00: float,
    r01: float,
    r02: float,
    r10: float,
    r11: float,
    r12: float,
    r20: float,
    r21: float,
    r22: float,
) -> List[float]:
    """
    Inverse of `_euler_deg_to_rotation_matrix` (XYZ intrinsic / Roblox CFrame rotation matrix)
    returning `[rx_deg, ry_deg, rz_deg]`.
    """
    clamped_r02 = max(-1.0, min(1.0, r02))
    ry = math.asin(clamped_r02)
    if abs(clamped_r02) < 0.999999:
        rx = math.atan2(-r12, r22)
        rz = math.atan2(-r01, r00)
    else:
        rx = math.atan2(r21, r11)
        rz = 0.0
    return [
        round(math.degrees(rx), 2),
        round(math.degrees(ry), 2),
        round(math.degrees(rz), 2),
    ]


def _euler_deg_to_quaternion(rx_deg: float, ry_deg: float, rz_deg: float) -> Tuple[float, float, float, float]:
    rx = math.radians(rx_deg) * 0.5
    ry = math.radians(ry_deg) * 0.5
    rz = math.radians(rz_deg) * 0.5
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)

    qx = sx * cy * cz + cx * sy * sz
    qy = cx * sy * cz - sx * cy * sz
    qz = cx * cy * sz + sx * sy * cz
    qw = cx * cy * cz - sx * sy * sz
    return (qx, qy, qz, qw)


class Generation3DEngine:
    """
    Self-contained 3D Generation & Multi-Format Export Engine:
    - Prompt + Reference Image + Uploaded Mesh 3D synthesis via Gemini (`generate_3d_asset`)
    - Real-time SSE streaming 3D synthesis (`stream_3d_asset`)
    - Automatic topological sub-mesh splitting (`split_oversized_mesh_part`) without vertex/face truncation
    - Deterministic `--!strict` Luau `EditableMesh` builder generation (without fake `MeshId`s)
    - Autonomous `.rbxmx`, `.gltf` 2.0 (with embedded binary geometry & PBR textures), and `.obj` + `.mtl` exporters
    - Bidirectional `.rbxmx` XML parser (`parse_rbxmx_to_parts`) for Roblox Studio <-> Forge AI Studio sync
    """

    def __init__(self, client: Optional[genai.Client], tier_models: Optional[Dict[str, str]] = None):
        self.client = client
        self.tier_models = tier_models or {
            "pro": "gemini-2.5-pro",
            "fast": "gemini-2.5-flash",
        }

    def resolve_model(self, model_tier: str) -> str:
        return self.tier_models.get(model_tier, self.tier_models.get("fast", "gemini-2.5-flash"))

    def extract_parts_from_uploaded_mesh(
        self,
        model_name: str,
        uploaded_mesh_obj: Optional[str] = None,
        uploaded_sub_meshes: Optional[List[Dict[str, Any]]] = None,
        collision_fidelity: str = "Hull",
    ) -> List[MeshPart3DSpec]:
        """Alias for `extract_parts_from_uploaded_meshes` supporting singular or plural invocation."""
        return self.extract_parts_from_uploaded_meshes(
            model_name=model_name,
            uploaded_mesh_obj=uploaded_mesh_obj,
            uploaded_sub_meshes=uploaded_sub_meshes,
            collision_fidelity=collision_fidelity,
        )

    def extract_parts_from_uploaded_meshes(
        self,
        model_name: str,
        uploaded_mesh_obj: Optional[str],
        uploaded_sub_meshes: Optional[List[Dict[str, Any]]],
        collision_fidelity: str = "Hull",
    ) -> List[MeshPart3DSpec]:
        safe_model = "".join(c for c in model_name if c.isalnum() or c == "_") or "UploadedModel3D"
        obj_file = f"{safe_model}.obj"
        extracted_parts: List[MeshPart3DSpec] = []

        if uploaded_sub_meshes and len(uploaded_sub_meshes) > 0:
            for idx, sub in enumerate(uploaded_sub_meshes):
                part_name = str(sub.get("name") or f"{safe_model}_MeshPart_{idx + 1}")
                geom = extract_mesh_geometry_from_processed_submesh(sub, obj_file, safe_model)
                published_id = validate_published_roblox_mesh_id(
                    sub.get("meshId") or geom.meshId
                )
                geom.meshId = published_id or None
                geom.assetId = published_id or None
                raw_spec = MeshPart3DSpec(
                    name=part_name,
                    shape="MeshPart",
                    meshId=published_id or None,
                    assetId=published_id or None,
                    textureId=validate_published_roblox_mesh_id(sub.get("textureId") or sub.get("texture_id")) or None,
                    size=sub.get("studSize") or sub.get("size") or [4.0, 4.0, 4.0],
                    position=sub.get("studPosition") or sub.get("position") or [0.0, 2.0, 0.0],
                    rotation=sub.get("studRotation") or sub.get("rotation") or [0.0, 0.0, 0.0],
                    color=sub.get("colorRgb") or sub.get("color") or [148, 163, 184],
                    material=sub.get("robloxMaterial") or sub.get("material") or "Metal",
                    roughness=float(sub.get("roughness", 0.35)),
                    metalness=float(sub.get("metalness", 0.65)),
                    collisionFidelity=sub.get("collisionFidelity") or collision_fidelity,  # type: ignore
                    pbrMaterial=sub.get("pbrMaterial"),
                    meshData=geom,
                )
                extracted_parts.extend(split_oversized_mesh_part(raw_spec))
            return extracted_parts

        if uploaded_mesh_obj and "v " in uploaded_mesh_obj:
            geom = parse_wavefront_obj_geometry(uploaded_mesh_obj, obj_file)
            if len(geom.vertices) > 0 and len(geom.faces) > 0:
                xs = [v[0] for v in geom.vertices]
                ys = [v[1] for v in geom.vertices]
                zs = [v[2] for v in geom.vertices]
                sx = max(0.5, max(xs) - min(xs))
                sy = max(0.5, max(ys) - min(ys))
                sz = max(0.5, max(zs) - min(zs))
                part_name = f"{safe_model}_PrimaryMesh"
                raw_spec = MeshPart3DSpec(
                    name=part_name,
                    shape="MeshPart",
                    size=[round(sx, 2), round(sy, 2), round(sz, 2)],
                    position=[0.0, round(sy * 0.5, 2), 0.0],
                    rotation=[0.0, 0.0, 0.0],
                    color=[148, 163, 184],
                    material="Metal",
                    roughness=0.35,
                    metalness=0.65,
                    collisionFidelity=collision_fidelity,  # type: ignore
                    meshData=geom,
                )
                extracted_parts.extend(split_oversized_mesh_part(raw_spec))
        return extracted_parts

    def ensure_mesh_data_on_parts(self, model_name: str, parts: List[MeshPart3DSpec]) -> List[MeshPart3DSpec]:
        """
        Ensures every sub-part carries extracted vertex/normal/UV/face index buffers,
        uses `shape = 'MeshPart'`, and automatically splits oversized meshes into sub-meshes
        without truncating vertices or triangles or inventing fake `MeshId`s.
        CRITICAL: Never overwrites external MeshParts (`published_mesh_id` or `geometrySource` in
        `("PublishedCloudMeshId", "StudioExternalUnreadable")`) with procedural cube geometry!
        """
        safe_model = "".join(c for c in model_name if c.isalnum() or c == "_") or "ForgeModel3D"
        enriched: List[MeshPart3DSpec] = []
        for idx, part in enumerate(parts):
            part_name = part.name or f"MeshPart_{idx + 1}"
            published_mesh_id = validate_published_roblox_mesh_id(
                part.meshId
                or part.assetId
                or (part.meshData.meshId if part.meshData else None)
                or (part.meshData.assetId if part.meshData else None)
            )
            raw_geom_source = str(
                part.geometrySource
                or (part.meshData.geometrySource if part.meshData else "")
                or ""
            ).strip()
            is_external_mesh = bool(
                published_mesh_id
                or raw_geom_source in ("PublishedCloudMeshId", "StudioExternalUnreadable")
            )

            if not part.meshData or len(part.meshData.vertices) == 0 or len(part.meshData.faces) == 0:
                if is_external_mesh:
                    part.meshData = SubMeshGeometrySpec(
                        vertices=[],
                        normals=[],
                        uvs=[],
                        faces=[],
                        indices=[],
                        objFileName=f"{safe_model}.obj",
                        meshId=published_mesh_id or None,
                        assetId=published_mesh_id or None,
                        geometrySource="PublishedCloudMeshId" if published_mesh_id else (raw_geom_source or "StudioExternalUnreadable"),
                    )
                    part.geometrySource = part.meshData.geometrySource
                else:
                    part.meshData = synthesize_procedural_mesh_data(part.shape, part.size)
                    part.meshData.geometrySource = "EditableMeshBuffers"
                    part.geometrySource = "EditableMeshBuffers"
            else:
                if not part.meshData.indices:
                    part.meshData.indices = [i for tri in part.meshData.faces for i in tri]
                part.meshData.geometrySource = "EditableMeshBuffers"
                part.geometrySource = "EditableMeshBuffers"

            obj_file = part.meshData.objFileName or f"{safe_model}.obj"
            part.meshData.objFileName = obj_file

            part.name = part_name
            part.shape = "MeshPart"
            part.meshId = published_mesh_id or None
            part.assetId = published_mesh_id or None
            part.meshData.meshId = published_mesh_id or None
            part.meshData.assetId = published_mesh_id or None

            enriched.extend(split_oversized_mesh_part(part))
        return enriched

    def build_luau_from_parts(self, model_name: str, parts: List[MeshPart3DSpec], collision_fidelity: str) -> str:
        """
        Outputs a `--!strict` Luau `MeshPart` creation module that constructs real 3D geometry
        directly from `Vertices`, `Normals`, `UVs`, and `Indices` via `AssetService:CreateEditableMesh()`
        and `AssetService:CreateMeshPartAsync(Content.fromObject(editableMesh))`.
        Hardened guarantees:
        - Detects when `AssetService:CreateEditableMesh()` returns `nil`.
        - Verifies that all expected triangles were created (`#editableMesh:GetTriangles() == expectedTriCount`).
        - Frees `editableMesh:Destroy()` immediately after `CreateMeshPartAsync` to prevent memory leaks.
        - Records `ForgeSyncOriginCFrame` on `model` and constructs real nested `Model` hierarchy containers.
        - Never marks `ForgeReconstructionVerified = true` if an empty fallback `MeshPart` was produced.
        """
        safe_name = "".join(c for c in model_name if c.isalnum() or c == "_") or "GeneratedMeshModel"
        parts = self.ensure_mesh_data_on_parts(safe_name, parts)

        lines = [
            "--!strict",
            f"-- Generated by Forge AI 3D Generation Engine: {safe_name} (EditableMesh + Real Vertex/Normal/UV/Index Buffers)",
            'local AssetService = game:GetService("AssetService")',
            'local InsertService = game:GetService("InsertService")',
            'local Workspace = game:GetService("Workspace")',
            "",
            "type VertexList = { { number } }",
            "type NormalList = { { number } }",
            "type UVList = { { number } }",
            "type IndexBuffer = { number }",
            "type FaceIndexList = { { number } }",
            "",
            "export type MeshPartDescriptor = {",
            "    Name: string,",
            "    PublishedMeshId: string,",
            "    PublishedTextureId: string,",
            "    ObjSourcePath: string,",
            "    TargetSize: Vector3,",
            "    CollisionFidelity: Enum.CollisionFidelity,",
            "    Vertices: VertexList,",
            "    Normals: NormalList,",
            "    UVs: UVList,",
            "    Indices: IndexBuffer,",
            "    Faces: FaceIndexList,",
            "}",
            "",
            "local function isPublishedRobloxAssetUri(uri: string?): boolean",
            '    if not uri or uri == "" or uri == "rbxassetid://0" then',
            "        return false",
            "    end",
            '    return string.match(uri, "^rbxassetid://[1-9]%d*$") ~= nil or string.match(uri, "^rbxasset://.+") ~= nil',
            "end",
            "",
            "local function ensureHierarchyContainer(rootModel: Model, parentPath: string?): Instance",
            '    if not parentPath or parentPath == "" or parentPath == "ModelRoot" or parentPath == rootModel.Name then',
            "        return rootModel",
            "    end",
            "    local current: Instance = rootModel",
            '    local accumPath = ""',
            '    for segment in string.gmatch(parentPath, "[^/\\\\]+") do',
            '        if segment ~= "" and segment ~= "ModelRoot" and segment ~= rootModel.Name then',
            '            accumPath = if accumPath == "" then segment else (accumPath .. "/" .. segment)',
            "            local existing = current:FindFirstChild(segment)",
            '            if not existing or (not existing:IsA("Model") and not existing:IsA("Folder")) then',
            '                local container = Instance.new("Model")',
            "                container.Name = segment",
            '                container:SetAttribute("ForgeNodeId", "fnode_" .. string.gsub(accumPath, "[^%w_]", "_"))',
            '                container:SetAttribute("ForgeHierarchyPath", accumPath)',
            "                container.Parent = current",
            "                current = container",
            "            else",
            "                current = existing",
            "            end",
            "        end",
            "    end",
            "    return current",
            "end",
            "",
            "local function createEditableMeshPartFromBuffers(desc: MeshPartDescriptor): (MeshPart, boolean, string?)",
            "    local lastErrorReason: string? = nil",
            "",
            "    -- 1. If a verified published Roblox Cloud MeshId is explicitly bound, try InsertService first",
            "    if isPublishedRobloxAssetUri(desc.PublishedMeshId) then",
            "        local okInsert, insertedOrErr = pcall(function()",
            "            return InsertService:CreateMeshPartAsync(desc.PublishedMeshId, desc.CollisionFidelity, Enum.RenderFidelity.Precise)",
            "        end)",
            "        if okInsert and insertedOrErr and insertedOrErr:IsA(\"MeshPart\") then",
            "            local insertedMeshPart = insertedOrErr :: MeshPart",
            "            insertedMeshPart.Name = desc.Name",
            "            insertedMeshPart.Size = desc.TargetSize",
            "            if isPublishedRobloxAssetUri(desc.PublishedTextureId) then",
            "                insertedMeshPart.TextureID = desc.PublishedTextureId",
            "            end",
            '            insertedMeshPart:SetAttribute("ForgeGeometrySource", "PublishedCloudMeshId")',
            '            insertedMeshPart:SetAttribute("ForgeGeometryVerified", true)',
            '            insertedMeshPart:SetAttribute("PublishedMeshId", desc.PublishedMeshId)',
            '            insertedMeshPart:SetAttribute("RojoObjPath", desc.ObjSourcePath)',
            '            insertedMeshPart:SetAttribute("VertexCount", #desc.Vertices)',
            '            insertedMeshPart:SetAttribute("TriangleCount", #desc.Faces)',
            "            return insertedMeshPart, true, nil",
            "        else",
            "            lastErrorReason = \"InsertService:CreateMeshPartAsync failed: \" .. tostring(insertedOrErr)",
            "        end",
            "    end",
            "",
            "    -- 2. Primary Path: Construct real MeshPart geometry directly from Vertex, Normal, UV & Triangle buffers via EditableMesh",
            "    local expectedTriCount = math.floor(#desc.Indices / 3)",
            "    local editableMeshInstance: EditableMesh? = nil",
            "    local okEditable, editableResultOrErr = pcall(function()",
            "        local editableMesh = AssetService:CreateEditableMesh()",
            "        if not editableMesh then",
            '            error("AssetService:CreateEditableMesh() returned nil (EditableMesh API may be disabled or memory budget exceeded)")',
            "        end",
            "        editableMeshInstance = editableMesh",
            "",
            "        local vertexIds = table.create(#desc.Vertices)",
            "        local normalIds = table.create(#desc.Normals)",
            "        local uvIds = table.create(#desc.UVs)",
            "",
            "        for i, v in ipairs(desc.Vertices) do",
            "            vertexIds[i] = editableMesh:AddVertex(Vector3.new(v[1], v[2], v[3]))",
            "        end",
            "        for i, n in ipairs(desc.Normals) do",
            "            normalIds[i] = editableMesh:AddNormal(Vector3.new(n[1], n[2], n[3]))",
            "        end",
            "        for i, uv in ipairs(desc.UVs) do",
            "            uvIds[i] = editableMesh:AddUV(Vector2.new(uv[1], uv[2]))",
            "        end",
            "",
            "        if #desc.Vertices > 20000 or expectedTriCount > 20000 then",
            '            error(string.format("EditableMesh safety limit (20000) exceeded for %s: %d verts, %d tris", desc.Name, #desc.Vertices, expectedTriCount))',
            "        end",
            "        local addedTriCount = 0",
            "        for t = 0, expectedTriCount - 1 do",
            "            local baseIdx = t * 3",
            "            local i1, i2, i3 = desc.Indices[baseIdx + 1], desc.Indices[baseIdx + 2], desc.Indices[baseIdx + 3]",
            "            local v1, v2, v3 = vertexIds[i1], vertexIds[i2], vertexIds[i3]",
            "            if v1 and v2 and v3 and v1 ~= v2 and v2 ~= v3 and v1 ~= v3 then",
            "                local fid = editableMesh:AddTriangle(v1, v2, v3)",
            "                if fid then",
            "                    addedTriCount += 1",
            "                    if normalIds[i1] and normalIds[i2] and normalIds[i3] then",
            "                        local okNorm, normErr = pcall(function()",
            "                            editableMesh:SetFaceNormals(fid, { normalIds[i1], normalIds[i2], normalIds[i3] })",
            "                        end)",
            "                        if not okNorm then",
            '                            error(string.format("EditableMesh:SetFaceNormals failed at face %d for %s: %s", t + 1, desc.Name, tostring(normErr)))',
            "                        end",
            "                    end",
            "                    if uvIds[i1] and uvIds[i2] and uvIds[i3] then",
            "                        local okUv, uvErr = pcall(function()",
            "                            editableMesh:SetFaceUVs(fid, { uvIds[i1], uvIds[i2], uvIds[i3] })",
            "                        end)",
            "                        if not okUv then",
            '                            error(string.format("EditableMesh:SetFaceUVs failed at face %d for %s: %s", t + 1, desc.Name, tostring(uvErr)))',
            "                        end",
            "                    end",
            "                end",
            "            end",
            "        end",
            "",
            "        if expectedTriCount > 0 and addedTriCount < expectedTriCount then",
            '            error(string.format("Incomplete triangle creation in EditableMesh: expected %d, added %d", expectedTriCount, addedTriCount))',
            "        end",
            "        local okTris, createdTris = pcall(function()",
            "            return editableMesh:GetTriangles()",
            "        end)",
            "        if okTris and type(createdTris) == \"table\" and expectedTriCount > 0 and #createdTris < expectedTriCount then",
            '            error(string.format("EditableMesh:GetTriangles() count mismatch: expected %d, found %d", expectedTriCount, #createdTris))',
            "        end",
            "",
            "        local createdPart: MeshPart? = nil",
            "        local okContent, partFromContent = pcall(function()",
            "            return AssetService:CreateMeshPartAsync(Content.fromObject(editableMesh), {",
            "                CollisionFidelity = desc.CollisionFidelity,",
            "                RenderFidelity = Enum.RenderFidelity.Precise,",
            "                FluidFidelity = Enum.FluidFidelity.Automatic,",
            "            })",
            "        end)",
            "        if okContent and partFromContent then",
            "            createdPart = partFromContent",
            "        else",
            "            createdPart = (AssetService :: any):CreateMeshPartAsync(editableMesh, {",
            "                CollisionFidelity = desc.CollisionFidelity,",
            "                RenderFidelity = Enum.RenderFidelity.Precise,",
            "            })",
            "        end",
            "",
            "        if not createdPart then",
            '            error("AssetService:CreateMeshPartAsync returned nil")',
            "        end",
            "        return createdPart",
            "    end)",
            "",
            "    -- Always release the temporary EditableMesh resource once baked into a MeshPart",
            "    if editableMeshInstance then",
            "        pcall(function()",
            "            editableMeshInstance:Destroy()",
            "        end)",
            "        editableMeshInstance = nil",
            "    end",
            "",
            "    if okEditable and editableResultOrErr and typeof(editableResultOrErr) == \"Instance\" and editableResultOrErr:IsA(\"MeshPart\") then",
            "        local meshPart = editableResultOrErr :: MeshPart",
            "        meshPart.Name = desc.Name",
            "        meshPart.Size = desc.TargetSize",
            "        if isPublishedRobloxAssetUri(desc.PublishedTextureId) then",
            "            meshPart.TextureID = desc.PublishedTextureId",
            "        end",
            '        meshPart:SetAttribute("ForgeGeometrySource", "EditableMeshBuffers")',
            '        meshPart:SetAttribute("ForgeGeometryVerified", true)',
            '        meshPart:SetAttribute("RojoObjPath", desc.ObjSourcePath)',
            '        meshPart:SetAttribute("VertexCount", #desc.Vertices)',
            '        meshPart:SetAttribute("TriangleCount", expectedTriCount)',
            "        return meshPart, true, nil",
            "    end",
            "",
            "    local errReason = tostring(editableResultOrErr or lastErrorReason or \"Unknown EditableMesh construction error\")",
            '    warn(string.format("[ForgeAI EditableMesh] Failed to construct geometry for \'%s\': %s", desc.Name, errReason))',
            '    local fallbackPart = Instance.new("MeshPart")',
            "    fallbackPart.Name = desc.Name",
            "    fallbackPart.Size = desc.TargetSize",
            '    fallbackPart:SetAttribute("ForgeGeometrySource", "UnverifiedFallbackContainer")',
            '    fallbackPart:SetAttribute("ForgeGeometryVerified", false)',
            '    fallbackPart:SetAttribute("ForgeReconstructionError", errReason)',
            '    fallbackPart:SetAttribute("RojoObjPath", desc.ObjSourcePath)',
            '    fallbackPart:SetAttribute("VertexCount", #desc.Vertices)',
            '    fallbackPart:SetAttribute("TriangleCount", expectedTriCount)',
            "    return fallbackPart, false, errReason",
            "end",
            "",
            f"local {safe_name}Builder = {{}}",
            "",
            f"function {safe_name}Builder.Spawn(origin: CFrame?): Model",
            "    local baseOrigin = origin or CFrame.new(0, 0, 0)",
            '    local model = Instance.new("Model")',
            f'    model.Name = "{safe_name}"',
            '    model:SetAttribute("ForgeSyncOriginCFrame", baseOrigin)',
            "    local rootMeshPart: MeshPart? = nil",
            "    local verifiedPartCount = 0",
            f"    local totalExpectedParts = {len(parts)}",
            "",
        ]

        for idx, p in enumerate(parts):
            sx, sy, sz = (p.size + [2.0, 2.0, 2.0])[:3]
            px, py, pz = (p.position + [0.0, 1.0, 0.0])[:3]
            rx, ry, rz = (p.rotation + [0.0, 0.0, 0.0])[:3]
            cr, cg, cb = (p.color + [180, 180, 180])[:3]
            var_name = f"meshPart_{idx + 1}"
            ok_var = f"isVerified_{idx + 1}"
            cf_mode = p.collisionFidelity or collision_fidelity or "Hull"
            clean_name = "".join(c if (c.isalnum() or c == "_") else "_" for c in (p.name or f"MeshPart_{idx + 1}"))
            part_id_str = (p.partId or "").strip() or f"fpart_{clean_name}"
            parent_name_str = (p.parentName or "ModelRoot").strip() or "ModelRoot"
            parent_clean = "".join(c if (c.isalnum() or c == "_") else "_" for c in parent_name_str)
            parent_id_str = (p.parentId or "").strip() or ("fnode_ModelRoot" if parent_name_str == "ModelRoot" else f"fnode_{parent_clean}")
            hierarchy_path_str = (p.hierarchyPath or "").strip() or f"{parent_name_str}/{p.name}"

            published_mesh_id = validate_published_roblox_mesh_id(p.meshId or (p.meshData.meshId if p.meshData else None))
            published_tex_id = validate_published_roblox_mesh_id(p.textureId)
            has_buffers = bool(p.meshData and len(p.meshData.vertices) > 0 and len(p.meshData.faces) > 0)
            if has_buffers:
                mesh_data = p.meshData  # type: ignore
            elif published_mesh_id or p.geometrySource in ("PublishedCloudMeshId", "StudioExternalUnreadable"):
                mesh_data = SubMeshGeometrySpec(vertices=[], normals=[], uvs=[], faces=[], indices=[], objFileName=f"{safe_name}.obj")
            else:
                mesh_data = synthesize_procedural_mesh_data(p.shape, [sx, sy, sz])
            vert_count = len(mesh_data.vertices)

            v_items = [
                f"{{{v[0]:.4f},{v[1]:.4f},{v[2]:.4f}}}"
                for v in mesh_data.vertices
            ]
            n_items = [
                f"{{{n[0]:.4f},{n[1]:.4f},{n[2]:.4f}}}"
                for n in (mesh_data.normals if len(mesh_data.normals) == vert_count else [[0.0, 1.0, 0.0]] * vert_count)
            ]
            uv_items = [
                f"{{{u[0]:.4f},{u[1]:.4f}}}"
                for u in (mesh_data.uvs if len(mesh_data.uvs) == vert_count else [[0.0, 0.0]] * vert_count)
            ]
            valid_faces = [
                [f[0] + 1, f[1] + 1, f[2] + 1]
                for f in mesh_data.faces
                if len(f) >= 3 and 0 <= f[0] < vert_count and 0 <= f[1] < vert_count and 0 <= f[2] < vert_count
            ]
            f_items = [f"{{{tri[0]},{tri[1]},{tri[2]}}}" for tri in valid_faces]
            flat_index_items = [str(idx_val) for tri in valid_faces for idx_val in tri]

            obj_file = mesh_data.objFileName or f"{safe_name}.obj"

            lines.extend([
                f"    -- Sub-MeshPart #{idx + 1}: {p.name} ({len(v_items)} verts, {len(f_items)} tris)",
                f"    local {var_name}, {ok_var} = createEditableMeshPartFromBuffers({{",
                f'        Name = "{p.name}",',
                f'        PublishedMeshId = "{published_mesh_id}",',
                f'        PublishedTextureId = "{published_tex_id}",',
                f'        ObjSourcePath = "src/shared/Assets3D/{obj_file}",',
                f"        TargetSize = Vector3.new({sx:.3f}, {sy:.3f}, {sz:.3f}),",
                f"        CollisionFidelity = Enum.CollisionFidelity.{cf_mode},",
                f"        Vertices = {{{', '.join(v_items)}}},",
                f"        Normals = {{{', '.join(n_items)}}},",
                f"        UVs = {{{', '.join(uv_items)}}},",
                f"        Indices = {{{', '.join(flat_index_items)}}},",
                f"        Faces = {{{', '.join(f_items)}}},",
                "    })",
                f"    if {ok_var} then verifiedPartCount += 1 end",
                f"    {var_name}.CFrame = baseOrigin * CFrame.new({px:.4f}, {py:.4f}, {pz:.4f}) * CFrame.Angles(math.rad({rx:.2f}), math.rad({ry:.2f}), math.rad({rz:.2f}))",
                f"    {var_name}.Color = Color3.fromRGB({int(cr)}, {int(cg)}, {int(cb)})",
                f"    {var_name}.Material = Enum.Material.{p.material if p.material else 'Metal'}",
                f"    {var_name}.Transparency = {p.transparency:.2f}",
                f"    {var_name}.Anchored = {'true' if p.anchored else 'false'}",
                f"    {var_name}.CanCollide = {'true' if p.canCollide else 'false'}",
                f'    {var_name}:SetAttribute("ForgePartId", "{part_id_str}")',
                f'    {var_name}:SetAttribute("ForgeParentId", "{parent_id_str}")',
                f'    {var_name}:SetAttribute("ForgeParentName", "{parent_name_str}")',
                f'    {var_name}:SetAttribute("ForgeHierarchyPath", "{hierarchy_path_str}")',
                f'    {var_name}:SetAttribute("CollisionFidelity", "{cf_mode}")',
                f'    {var_name}:SetAttribute("Roughness", {p.roughness:.2f})',
                f'    {var_name}:SetAttribute("Metalness", {p.metalness:.2f})',
                f'    {var_name}.Parent = ensureHierarchyContainer(model, "{parent_name_str}")',
            ])
            if idx == 0:
                lines.extend([
                    f"    rootMeshPart = {var_name}",
                    f"    model.PrimaryPart = {var_name}",
                    "",
                ])
            else:
                lines.extend([
                    "    if rootMeshPart then",
                    '        local weld = Instance.new("WeldConstraint")',
                    "        weld.Part0 = rootMeshPart",
                    f"        weld.Part1 = {var_name}",
                    f"        weld.Parent = {var_name}",
                    "    end",
                    "",
                ])

        lines.extend([
            "    local allVerified = (verifiedPartCount == totalExpectedParts and totalExpectedParts > 0)",
            '    model:SetAttribute("ForgeEditableMeshReconstructed", allVerified)',
            '    model:SetAttribute("ForgeReconstructionVerified", allVerified)',
            '    model:SetAttribute("ReconstructedMeshPartCount", verifiedPartCount)',
            '    model:SetAttribute("ExpectedMeshPartCount", totalExpectedParts)',
            "    model.Parent = Workspace",
            "    return model",
            "end",
            "",
            f"-- Reconstructs placeholder MeshParts in an imported .rbxmx Model in-place using ForgeMeshGeometryJSON",
            f"function {safe_name}Builder.ReconstructInPlace(targetModel: Model): (number, boolean, number)",
            '    local HttpService = game:GetService("HttpService")',
            "    local reconstructedCount = 0",
            "    local expectedCount = 0",
            "    local rootPart: MeshPart? = nil",
            "    for _, child in ipairs(targetModel:GetDescendants()) do",
            '        if child:IsA("BasePart") then',
            '            local geomVal = child:FindFirstChild("ForgeMeshGeometryJSON")',
            '            if geomVal and geomVal:IsA("StringValue") and #geomVal.Value > 2 then',
            "                expectedCount += 1",
            "                local okDecode, decoded = pcall(function()",
            "                    return HttpService:JSONDecode(geomVal.Value)",
            "                end)",
            "                if okDecode and decoded and type(decoded.vertices) == 'table' and type(decoded.faces) == 'table' then",
            "                    local flatIndices = {}",
            "                    local facesOneBased = {}",
            "                    for _, tri in ipairs(decoded.faces) do",
            "                        local i1, i2, i3 = (tri[1] or 0) + 1, (tri[2] or 0) + 1, (tri[3] or 0) + 1",
            "                        table.insert(facesOneBased, { i1, i2, i3 })",
            "                        table.insert(flatIndices, i1)",
            "                        table.insert(flatIndices, i2)",
            "                        table.insert(flatIndices, i3)",
            "                    end",
            "                    local newPart, isVerified, errMsg = createEditableMeshPartFromBuffers({",
            "                        Name = child.Name,",
            '                        PublishedMeshId = decoded.publishedMeshId or decoded.meshId or "",',
            '                        PublishedTextureId = "",',
            f'                        ObjSourcePath = "src/shared/Assets3D/{safe_name}.obj",',
            "                        TargetSize = child.Size,",
            "                        CollisionFidelity = Enum.CollisionFidelity.Hull,",
            "                        Vertices = decoded.vertices,",
            "                        Normals = decoded.normals or {},",
            "                        UVs = decoded.uvs or {},",
            "                        Indices = flatIndices,",
            "                        Faces = facesOneBased,",
            "                    })",
            "                    if isVerified then",
            "                        local parentTarget = child.Parent or targetModel",
            "                        newPart.CFrame = child.CFrame",
            "                        newPart.Color = child.Color",
            "                        newPart.Material = child.Material",
            "                        newPart.Transparency = child.Transparency",
            "                        newPart.Anchored = child.Anchored",
            "                        newPart.CanCollide = child.CanCollide",
            "                        for _, subChild in ipairs(child:GetChildren()) do",
            "                            subChild:Clone().Parent = newPart",
            "                        end",
            "                        newPart.Parent = parentTarget",
            "                        if targetModel.PrimaryPart == child or not rootPart then",
            "                            rootPart = newPart",
            "                            targetModel.PrimaryPart = newPart",
            "                        end",
            "                        child:Destroy()",
            "                        reconstructedCount += 1",
            "                    else",
            "                        newPart:Destroy()",
            '                        child:SetAttribute("ForgeGeometryVerified", false)',
            '                        child:SetAttribute("ForgeReconstructionError", tostring(errMsg or "EditableMesh failed"))',
            "                    end",
            "                end",
            "            end",
            "        end",
            "    end",
            "    local allVerified = (expectedCount > 0 and reconstructedCount == expectedCount)",
            '    targetModel:SetAttribute("ForgeEditableMeshReconstructed", allVerified)',
            '    targetModel:SetAttribute("ForgeReconstructionVerified", allVerified)',
            '    targetModel:SetAttribute("ReconstructedMeshPartCount", reconstructedCount)',
            '    targetModel:SetAttribute("ExpectedMeshPartCount", expectedCount)',
            "    return reconstructedCount, allVerified, expectedCount",
            "end",
            "",
            f"return {safe_name}Builder",
        ])
        return "\n".join(lines)

    def build_rbxmx_from_parts(
        self,
        model_name: str,
        parts: List[MeshPart3DSpec],
        collision_fidelity: str = "Hull",
        category: str = "3D Asset",
        luau_code: Optional[str] = None,
    ) -> str:
        """
        Autonomously builds a native Roblox Studio `.rbxmx` XML Model file containing:
        - `<Item class="Model">` with real nested `<Item class="Model">` hierarchy containers
        - `<Item class="MeshPart">` children (never inventing fake MeshIds or overwriting external MeshParts)
        - `<Item class="SurfaceAppearance">` with 4-channel PBR maps (`ColorMap`, `NormalMap`, `RoughnessMap`, `MetalnessMap`)
        - `<Item class="StringValue" name="ForgePartId" | "ForgeParentId" | "ForgeParentName" | "ForgeHierarchyPath" | "ForgeMeshGeometryJSON">`
        - `<Item class="ModuleScript" name="ForgeStudioReconstructor">`
        - `<Item class="Script" name="ForgeAutoReconstructRunner">` for Play/Run mode + Plugin Edit-Mode hook support.
        """
        from engines.asset_engine import AssetEngine
        safe_name = "".join(c for c in model_name if c.isalnum() or c == "_") or "ForgeModel3D"
        parts = self.ensure_mesh_data_on_parts(safe_name, parts)
        luau_reconstructor = luau_code or self.build_luau_from_parts(safe_name, parts, collision_fidelity)

        auto_runner_source = "\n".join([
            "--!strict",
            "-- Automatically reconstructs EditableMesh geometry when this .rbxmx Model runs in Studio or via Forge Plugin",
            'local reconstructorMod = script.Parent:FindFirstChild("ForgeStudioReconstructor")',
            'if reconstructorMod and reconstructorMod:IsA("ModuleScript") then',
            "    local ok, err = xpcall(function()",
            "        local Reconstructor = require(reconstructorMod) :: any",
            '        if type(Reconstructor.ReconstructInPlace) == "function" then',
            "            local count, verified, expected = Reconstructor.ReconstructInPlace(script.Parent)",
            '            script.Parent:SetAttribute("ForgeAutoReconstructed", verified == true)',
            '            script.Parent:SetAttribute("ForgeReconstructedParts", count)',
            '            script.Parent:SetAttribute("ForgeExpectedParts", expected)',
            "        end",
            "    end, debug.traceback)",
            "    if not ok then",
            '        warn("[ForgeAutoReconstructRunner] Error reconstructing EditableMesh:", err)',
            "    end",
            "end",
        ])

        lines = [
            '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">',
            "  <External>null</External>",
            "  <External>nil</External>",
            f'  <Item class="Model" referent="RBX_FORGE_MODEL_{safe_name}">',
            "    <Properties>",
            f'      <string name="Name">{saxutils.escape(safe_name)}</string>',
            '      <Ref name="PrimaryPart">RBX_PART_1</Ref>',
            "    </Properties>",
        ]

        def render_mesh_part_xml(part: MeshPart3DSpec, idx: int, indent: str = "    ") -> List[str]:
            ref_id = f"RBX_PART_{idx + 1}"
            part_name = part.name or f"MeshPart_{idx + 1}"
            sx, sy, sz = (part.size + [2.0, 2.0, 2.0])[:3]
            px, py, pz = (part.position + [0.0, 1.0, 0.0])[:3]
            rx, ry, rz = (part.rotation + [0.0, 0.0, 0.0])[:3]
            cr, cg, cb = (part.color + [160, 170, 185])[:3]

            part_dict = part.model_dump() if hasattr(part, "model_dump") else part.__dict__
            sync_meta = AssetEngine.compute_part_sync_hashes(part_dict, idx)
            rot_mat = sync_meta["rotationMatrix"]
            r00, r01, r02, r10, r11, r12, r20, r21, r22 = rot_mat[:9]

            color_uint8 = (
                (0xFF << 24)
                | ((max(0, min(255, int(cr))) & 0xFF) << 16)
                | ((max(0, min(255, int(cg))) & 0xFF) << 8)
                | (max(0, min(255, int(cb))) & 0xFF)
            )
            mat_token = ROBLOX_MATERIAL_ENUM_TOKENS.get(part.material or "Metal", 1088)
            published_mesh_id = validate_published_roblox_mesh_id(
                part.meshId or (part.meshData.meshId if part.meshData else None)
            )
            published_tex_id = validate_published_roblox_mesh_id(part.textureId)
            has_buffers = bool(part.meshData and len(part.meshData.vertices) > 0 and len(part.meshData.faces) > 0)
            if has_buffers:
                mesh_data = part.meshData  # type: ignore
            elif published_mesh_id or sync_meta["geometrySource"] in ("PublishedCloudMeshId", "StudioExternalUnreadable"):
                mesh_data = SubMeshGeometrySpec(vertices=[], normals=[], uvs=[], faces=[], indices=[])
            else:
                mesh_data = synthesize_procedural_mesh_data(part.shape, [sx, sy, sz])

            pbr_dict = part.pbrMaterial if isinstance(part.pbrMaterial, dict) else {}
            valid_color_map = validate_published_roblox_mesh_id(
                pbr_dict.get("colorMapAssetId") or pbr_dict.get("color_map_asset_id")
            )
            valid_normal_map = validate_published_roblox_mesh_id(
                pbr_dict.get("normalMapAssetId") or pbr_dict.get("normal_map_asset_id")
            )
            valid_rough_map = validate_published_roblox_mesh_id(
                pbr_dict.get("roughnessMapAssetId") or pbr_dict.get("roughness_map_asset_id")
            )
            valid_metal_map = validate_published_roblox_mesh_id(
                pbr_dict.get("metalnessMapAssetId") or pbr_dict.get("metalness_map_asset_id")
            )

            geom_payload = json.dumps({
                "hashSchemaVersion": sync_meta["hashSchemaVersion"],
                "partId": sync_meta["partId"],
                "parentId": sync_meta["parentId"],
                "parentName": sync_meta["parentName"],
                "parentContainerClass": sync_meta["parentContainerClass"],
                "hierarchyPath": sync_meta["hierarchyPath"],
                "geometrySource": sync_meta["geometrySource"],
                "geometryHash": sync_meta["geometryHash"],
                "materialHash": sync_meta["materialHash"],
                "transformHash": sync_meta["transformHash"],
                "hierarchyHash": sync_meta["hierarchyHash"],
                "combinedHash": sync_meta["combinedHash"],
                "shape": "MeshPart",
                "publishedMeshId": published_mesh_id,
                "meshId": published_mesh_id,
                "textureId": published_tex_id,
                "size": [round(sx, 4), round(sy, 4), round(sz, 4)],
                "position": [round(px, 4), round(py, 4), round(pz, 4)],
                "rotation": [round(rx, 2), round(ry, 2), round(rz, 2)],
                "rotationMatrix": rot_mat,
                "color": [int(cr), int(cg), int(cb)],
                "material": part.material or "Metal",
                "roughness": part.roughness,
                "metalness": part.metalness,
                "reflectance": sync_meta["reflectance"],
                "transparency": part.transparency,
                "anchored": part.anchored,
                "canCollide": part.canCollide,
                "collisionFidelity": part.collisionFidelity or collision_fidelity,
                "pbrMaterial": pbr_dict or None,
                "vertices": mesh_data.vertices,
                "normals": mesh_data.normals,
                "uvs": mesh_data.uvs,
                "faces": mesh_data.faces,
            })

            mesh_id_xml = (
                f'<Content name="MeshId"><url>{saxutils.escape(published_mesh_id)}</url></Content>'
                if published_mesh_id
                else '<Content name="MeshId"><null></null></Content>'
            )
            tex_id_xml = (
                f'<Content name="TextureID"><url>{saxutils.escape(published_tex_id)}</url></Content>'
                if published_tex_id
                else '<Content name="TextureID"><null></null></Content>'
            )
            color_map_xml = (
                f'<Content name="ColorMap"><url>{saxutils.escape(valid_color_map)}</url></Content>'
                if valid_color_map
                else '<Content name="ColorMap"><null></null></Content>'
            )
            normal_map_xml = (
                f'<Content name="NormalMap"><url>{saxutils.escape(valid_normal_map)}</url></Content>'
                if valid_normal_map
                else '<Content name="NormalMap"><null></null></Content>'
            )
            rough_map_xml = (
                f'<Content name="RoughnessMap"><url>{saxutils.escape(valid_rough_map)}</url></Content>'
                if valid_rough_map
                else '<Content name="RoughnessMap"><null></null></Content>'
            )
            metal_map_xml = (
                f'<Content name="MetalnessMap"><url>{saxutils.escape(valid_metal_map)}</url></Content>'
                if valid_metal_map
                else '<Content name="MetalnessMap"><null></null></Content>'
            )
            refl_val = float(getattr(part, "reflectance", 0.0) or 0.0)

            return [
                f'{indent}<Item class="MeshPart" referent="{ref_id}">',
                f"{indent}  <Properties>",
                f'{indent}    <string name="Name">{saxutils.escape(part_name)}</string>',
                f'{indent}    <bool name="Anchored">{"true" if part.anchored else "false"}</bool>',
                f'{indent}    <bool name="CanCollide">{"true" if part.canCollide else "false"}</bool>',
                f'{indent}    <float name="Transparency">{part.transparency:.3f}</float>',
                f'{indent}    <float name="Reflectance">{refl_val:.3f}</float>',
                f'{indent}    <token name="Material">{mat_token}</token>',
                f'{indent}    <Color3uint8 name="Color3uint8">{color_uint8}</Color3uint8>',
                f"{indent}    {mesh_id_xml}",
                f"{indent}    {tex_id_xml}",
                f'{indent}    <Vector3 name="size">',
                f"{indent}      <X>{sx:.4f}</X>",
                f"{indent}      <Y>{sy:.4f}</Y>",
                f"{indent}      <Z>{sz:.4f}</Z>",
                f"{indent}    </Vector3>",
                f'{indent}    <CoordinateFrame name="CFrame">',
                f"{indent}      <X>{px:.4f}</X>",
                f"{indent}      <Y>{py:.4f}</Y>",
                f"{indent}      <Z>{pz:.4f}</Z>",
                f"{indent}      <R00>{r00:.6f}</R00><R01>{r01:.6f}</R01><R02>{r02:.6f}</R02>",
                f"{indent}      <R10>{r10:.6f}</R10><R11>{r11:.6f}</R11><R12>{r12:.6f}</R12>",
                f"{indent}      <R20>{r20:.6f}</R20><R21>{r21:.6f}</R21><R22>{r22:.6f}</R22>",
                f"{indent}    </CoordinateFrame>",
                f"{indent}  </Properties>",
                f'{indent}  <Item class="SurfaceAppearance" referent="{ref_id}_PBR">',
                f"{indent}    <Properties>",
                f'{indent}      <string name="Name">{saxutils.escape(part_name)}_SurfaceAppearance</string>',
                f'{indent}      <token name="AlphaMode">0</token>',
                f"{indent}      {color_map_xml}",
                f"{indent}      {normal_map_xml}",
                f"{indent}      {rough_map_xml}",
                f"{indent}      {metal_map_xml}",
                f"{indent}    </Properties>",
                f"{indent}  </Item>",
                f'{indent}  <Item class="StringValue" referent="{ref_id}_PART_ID">',
                f"{indent}    <Properties>",
                f'{indent}      <string name="Name">ForgePartId</string>',
                f'{indent}      <string name="Value">{saxutils.escape(sync_meta["partId"])}</string>',
                f"{indent}    </Properties>",
                f"{indent}  </Item>",
                f'{indent}  <Item class="StringValue" referent="{ref_id}_PARENT_ID">',
                f"{indent}    <Properties>",
                f'{indent}      <string name="Name">ForgeParentId</string>',
                f'{indent}      <string name="Value">{saxutils.escape(sync_meta["parentId"])}</string>',
                f"{indent}    </Properties>",
                f"{indent}  </Item>",
                f'{indent}  <Item class="StringValue" referent="{ref_id}_PARENT_NAME">',
                f"{indent}    <Properties>",
                f'{indent}      <string name="Name">ForgeParentName</string>',
                f'{indent}      <string name="Value">{saxutils.escape(sync_meta["parentName"])}</string>',
                f"{indent}    </Properties>",
                f"{indent}  </Item>",
                f'{indent}  <Item class="StringValue" referent="{ref_id}_HIER_PATH">',
                f"{indent}    <Properties>",
                f'{indent}      <string name="Name">ForgeHierarchyPath</string>',
                f'{indent}      <string name="Value">{saxutils.escape(sync_meta["hierarchyPath"])}</string>',
                f"{indent}    </Properties>",
                f"{indent}  </Item>",
                f'{indent}  <Item class="StringValue" referent="{ref_id}_GEOM">',
                f"{indent}    <Properties>",
                f'{indent}      <string name="Name">ForgeMeshGeometryJSON</string>',
                f'{indent}      <string name="Value">{saxutils.escape(geom_payload)}</string>',
                f"{indent}    </Properties>",
                f"{indent}  </Item>",
                f"{indent}</Item>",
            ]

        root_tree: Dict[str, Any] = {
            "name": "ModelRoot",
            "path": "ModelRoot",
            "nodeId": "fnode_ModelRoot",
            "containerClass": "Model",
            "children": {},
            "parts": [],
        }

        for idx, part in enumerate(parts):
            part_dict = part.model_dump() if hasattr(part, "model_dump") else part.__dict__
            hier = AssetEngine.normalize_hierarchy_metadata(part_dict, idx)
            parent_segs = [
                s
                for s in hier["hierarchySegments"][:-1]
                if s and s not in ("ModelRoot", "Root", safe_name)
            ]
            if not parent_segs:
                root_tree["parts"].append((part, idx))
            else:
                curr = root_tree
                accum = ""
                for seg_idx, seg in enumerate(parent_segs):
                    accum = f"{accum}/{seg}" if accum else seg
                    is_direct_parent = seg_idx == len(parent_segs) - 1
                    desired_class = (
                        hier["parentContainerClass"]
                        if is_direct_parent
                        else ("Folder" if ("folder" in seg.lower() or "group" in seg.lower()) else "Model")
                    )
                    if seg not in curr["children"]:
                        clean_node = "".join(c if (c.isalnum() or c == "_") else "_" for c in accum)
                        curr["children"][seg] = {
                            "name": seg,
                            "path": accum,
                            "nodeId": f"fnode_{clean_node}",
                            "containerClass": desired_class,
                            "children": {},
                            "parts": [],
                        }
                    elif is_direct_parent and hier["parentContainerClass"] == "Folder":
                        curr["children"][seg]["containerClass"] = "Folder"
                    curr = curr["children"][seg]
                curr["parts"].append((part, idx))

        def emit_tree_node(node: Dict[str, Any], indent: str) -> None:
            for p_obj, p_idx in node["parts"]:
                lines.extend(render_mesh_part_xml(p_obj, p_idx, indent))
            container_counter = 0
            for _, child_node in node["children"].items():
                container_counter += 1
                ref_container = f"RBX_CONTAINER_{child_node['nodeId']}_{container_counter}"
                c_cls = child_node.get("containerClass") or "Model"
                lines.extend([
                    f'{indent}<Item class="{c_cls}" referent="{ref_container}">',
                    f"{indent}  <Properties>",
                    f'{indent}    <string name="Name">{saxutils.escape(child_node["name"])}</string>',
                    f"{indent}  </Properties>",
                    f'{indent}  <Item class="StringValue" referent="{ref_container}_NODE_ID">',
                    f"{indent}    <Properties>",
                    f'{indent}      <string name="Name">ForgeNodeId</string>',
                    f'{indent}      <string name="Value">{saxutils.escape(child_node["nodeId"])}</string>',
                    f"{indent}    </Properties>",
                    f"{indent}  </Item>",
                    f'{indent}  <Item class="StringValue" referent="{ref_container}_HIER_PATH">',
                    f"{indent}    <Properties>",
                    f'{indent}      <string name="Name">ForgeHierarchyPath</string>',
                    f'{indent}      <string name="Value">{saxutils.escape(child_node["path"])}</string>',
                    f"{indent}    </Properties>",
                    f"{indent}  </Item>",
                ])
                emit_tree_node(child_node, indent + "  ")
                lines.append(f"{indent}</Item>")

        emit_tree_node(root_tree, "    ")

        lines.extend([
            '    <Item class="StringValue" referent="RBX_FORGE_CATEGORY">',
            "      <Properties>",
            '        <string name="Name">ForgeAssetCategory</string>',
            f'        <string name="Value">{saxutils.escape(category or "3D Asset")}</string>',
            "      </Properties>",
            "    </Item>",
            '    <Item class="ModuleScript" referent="RBX_FORGE_RECONSTRUCTOR">',
            "      <Properties>",
            '        <string name="Name">ForgeStudioReconstructor</string>',
            f"        <ProtectedString name=\"Source\"><![CDATA[{luau_reconstructor}]]></ProtectedString>",
            "      </Properties>",
            "    </Item>",
            '    <Item class="Script" referent="RBX_FORGE_AUTO_RUNNER">',
            "      <Properties>",
            '        <string name="Name">ForgeAutoReconstructRunner</string>',
            '        <token name="RunContext">0</token>',
            f"        <ProtectedString name=\"Source\"><![CDATA[{auto_runner_source}]]></ProtectedString>",
            "      </Properties>",
            "    </Item>",
            "  </Item>",
            "</roblox>",
        ])
        return "\n".join(lines)

    def parse_rbxmx_to_parts(
        self,
        rbxmx_text: str,
        fallback_name: str = "Model3D",
        default_collision_fidelity: str = "Hull",
    ) -> Dict[str, Any]:
        """
        Parses a Roblox Studio `.rbxmx` XML file into `MeshPart3DSpec` instances and metadata,
        recovering:
        - Model name & category
        - Real nested container hierarchy (`parentName`, `parentContainerClass`, `hierarchyPath`) by walking the XML parent chain
          from each `MeshPart` up to the root `Model` as well as `ForgeParentName` / `ForgeHierarchyPath`
        - Full `CFrame` transformations (`position`, 9-component `rotationMatrix`, and `rotation` in degrees)
        - `size` `[X, Y, Z]`
        - `Color3uint8` / `Color3` -> RGB `[0..255]`
        - Roblox `Enum.Material` token -> material name
        - `SurfaceAppearance` 4-channel PBR maps (`ColorMap`, `NormalMap`, `RoughnessMap`, `MetalnessMap`)
        - Embedded `ForgeMeshGeometryJSON` vertex/normal/UV/face buffers (preserving external `MeshPart`s without overwriting them with procedural cubes)
        """
        from engines.asset_engine import AssetEngine
        root = ET.fromstring(rbxmx_text)
        parent_map: Dict[ET.Element, ET.Element] = {child: parent for parent in root.iter() for child in parent}

        model_item = root.find('.//Item[@class="Model"]')
        model_name = fallback_name
        category = "Roblox Studio (.rbxmx)"

        if model_item is not None:
            m_props = model_item.find("./Properties")
            if m_props is not None:
                name_el = m_props.find('./string[@name="Name"]')
                if name_el is not None and name_el.text:
                    model_name = name_el.text.strip()

        for sv in root.findall('.//Item[@class="StringValue"]'):
            sv_props = sv.find("./Properties")
            if sv_props is not None:
                sv_name = sv_props.find('./string[@name="Name"]')
                sv_val = sv_props.find('./string[@name="Value"]')
                if sv_name is not None and sv_name.text == "ForgeAssetCategory" and sv_val is not None and sv_val.text:
                    category = sv_val.text.strip()

        part_items: List[ET.Element] = []
        for elem in root.iter("Item"):
            if elem.attrib.get("class") in ("MeshPart", "Part", "WedgePart", "CornerWedgePart"):
                part_items.append(elem)

        recovered_parts: List[MeshPart3DSpec] = []
        for idx, item in enumerate(part_items):
            props = item.find("./Properties")
            if props is None:
                continue

            def _prop_text(xpath: str, default_val: str = "") -> str:
                el = props.find(xpath)
                return el.text.strip() if (el is not None and el.text) else default_val

            part_name = _prop_text('./string[@name="Name"]', f"MeshPart_{idx + 1}")
            anchored = _prop_text('./bool[@name="Anchored"]', "true").lower() != "false"
            can_collide = _prop_text('./bool[@name="CanCollide"]', "true").lower() != "false"
            transparency = float(_prop_text('./float[@name="Transparency"]', "0.0") or 0.0)
            reflectance_val = float(_prop_text('./float[@name="Reflectance"]', "0.0") or 0.0)

            # Walk XML ancestor chain to reconstruct nested container path up to root model
            ancestor_names: List[str] = []
            direct_parent_class = "Model"
            curr_parent = parent_map.get(item)
            first_container_seen = False
            while curr_parent is not None and curr_parent != model_item:
                if curr_parent.tag == "Item" and curr_parent.attrib.get("class") in ("Model", "Folder"):
                    if not first_container_seen:
                        direct_parent_class = "Folder" if curr_parent.attrib.get("class") == "Folder" else "Model"
                        first_container_seen = True
                    cp_props = curr_parent.find("./Properties")
                    cp_name = ""
                    if cp_props is not None:
                        cp_el = cp_props.find('./string[@name="Name"]')
                        if cp_el is not None and cp_el.text:
                            cp_name = cp_el.text.strip()
                    if cp_name and cp_name not in ("ModelRoot", "Root", model_name):
                        ancestor_names.insert(0, cp_name)
                curr_parent = parent_map.get(curr_parent)
            inferred_parent_name = ancestor_names[-1] if ancestor_names else "Root"
            inferred_hierarchy_path = (
                f"Root/{'/'.join(ancestor_names)}/{part_name}"
                if ancestor_names
                else f"Root/{part_name}"
            )

            part_id = ""
            parent_id = ""
            parent_name = inferred_parent_name
            parent_container_class = direct_parent_class
            hierarchy_path = inferred_hierarchy_path
            geometry_source: Optional[str] = None

            for child_sv in item.findall('./Item[@class="StringValue"]'):
                sv_p = child_sv.find("./Properties")
                if sv_p is None:
                    continue
                sv_key = (sv_p.findtext('./string[@name="Name"]', "") or "").strip()
                sv_val = (sv_p.findtext('./string[@name="Value"]', "") or "").strip()
                if sv_key == "ForgePartId" and sv_val:
                    part_id = sv_val
                elif sv_key == "ForgeParentId" and sv_val:
                    parent_id = sv_val
                elif sv_key == "ForgeParentName" and sv_val:
                    parent_name = sv_val
                elif sv_key == "ForgeHierarchyPath" and sv_val:
                    hierarchy_path = sv_val

            mat_token_str = _prop_text('./token[@name="Material"]', "1088")
            mat_token = int(mat_token_str) if mat_token_str.isdigit() else 1088
            material_name = ROBLOX_TOKEN_TO_MATERIAL.get(mat_token, "Metal")

            size_el = props.find('./Vector3[@name="size"]') or props.find('./Vector3[@name="Size"]')
            sx, sy, sz = 2.0, 2.0, 2.0
            if size_el is not None:
                sx = float(size_el.findtext("X", "2.0") or 2.0)
                sy = float(size_el.findtext("Y", "2.0") or 2.0)
                sz = float(size_el.findtext("Z", "2.0") or 2.0)

            cf_el = props.find('./CoordinateFrame[@name="CFrame"]')
            px, py, pz = 0.0, 1.0, 0.0
            rx, ry, rz = 0.0, 0.0, 0.0
            rotation_matrix: List[float] = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
            if cf_el is not None:
                px = float(cf_el.findtext("X", "0.0") or 0.0)
                py = float(cf_el.findtext("Y", "1.0") or 1.0)
                pz = float(cf_el.findtext("Z", "0.0") or 0.0)
                r00 = float(cf_el.findtext("R00", "1.0") or 1.0)
                r01 = float(cf_el.findtext("R01", "0.0") or 0.0)
                r02 = float(cf_el.findtext("R02", "0.0") or 0.0)
                r10 = float(cf_el.findtext("R10", "0.0") or 0.0)
                r11 = float(cf_el.findtext("R11", "1.0") or 1.0)
                r12 = float(cf_el.findtext("R12", "0.0") or 0.0)
                r20 = float(cf_el.findtext("R20", "0.0") or 0.0)
                r21 = float(cf_el.findtext("R21", "0.0") or 0.0)
                r22 = float(cf_el.findtext("R22", "1.0") or 1.0)
                rotation_matrix = [r00, r01, r02, r10, r11, r12, r20, r21, r22]
                rx, ry, rz = _rotation_matrix_to_euler_deg(r00, r01, r02, r10, r11, r12, r20, r21, r22)

            cr, cg, cb = 160, 170, 185
            c_uint_el = props.find('./Color3uint8[@name="Color3uint8"]')
            c_float_el = props.find('./Color3[@name="Color3uint8"]') or props.find('./Color3[@name="Color"]')
            if c_uint_el is not None and c_uint_el.text and c_uint_el.text.strip().isdigit():
                c_val = int(c_uint_el.text.strip())
                cr = (c_val >> 16) & 0xFF
                cg = (c_val >> 8) & 0xFF
                cb = c_val & 0xFF
            elif c_float_el is not None:
                rf = float(c_float_el.findtext("R", "0.62") or 0.62)
                gf = float(c_float_el.findtext("G", "0.66") or 0.66)
                bf = float(c_float_el.findtext("B", "0.72") or 0.72)
                cr = int(round(rf * 255)) if rf <= 1.0 else int(round(rf))
                cg = int(round(gf * 255)) if gf <= 1.0 else int(round(gf))
                cb = int(round(bf * 255)) if bf <= 1.0 else int(round(bf))

            mesh_id_url = _prop_text('./Content[@name="MeshId"]/url', "")
            published_mesh_id = validate_published_roblox_mesh_id(mesh_id_url)
            tex_id_url = _prop_text('./Content[@name="TextureID"]/url', "")
            published_tex_id = validate_published_roblox_mesh_id(tex_id_url)

            # Parse SurfaceAppearance 4-channel PBR maps if present
            sa_item = item.find('./Item[@class="SurfaceAppearance"]')
            sa_pbr: Dict[str, Any] = {}
            if sa_item is not None:
                sa_props = sa_item.find("./Properties")
                if sa_props is not None:
                    for xml_map_name, dict_key in [
                        ("ColorMap", "colorMapAssetId"),
                        ("NormalMap", "normalMapAssetId"),
                        ("RoughnessMap", "roughnessMapAssetId"),
                        ("MetalnessMap", "metalnessMapAssetId"),
                    ]:
                        url_el = sa_props.find(f'./Content[@name="{xml_map_name}"]/url')
                        if url_el is not None and url_el.text:
                            valid_uri = validate_published_roblox_mesh_id(url_el.text)
                            if valid_uri:
                                sa_pbr[dict_key] = valid_uri

            # Parse embedded ForgeMeshGeometryJSON StringValue if present
            geom_spec: Optional[SubMeshGeometrySpec] = None
            roughness_val = 0.35
            metalness_val = 0.65
            cf_mode = default_collision_fidelity
            for child_sv in item.findall('./Item[@class="StringValue"]'):
                sv_p = child_sv.find("./Properties")
                if sv_p is not None and sv_p.findtext('./string[@name="Name"]') == "ForgeMeshGeometryJSON":
                    raw_json = sv_p.findtext('./string[@name="Value"]', "")
                    if raw_json:
                        try:
                            decoded = json.loads(raw_json)
                            if isinstance(decoded, dict):
                                if decoded.get("partId"):
                                    part_id = str(decoded["partId"])
                                if decoded.get("parentId"):
                                    parent_id = str(decoded["parentId"])
                                if decoded.get("parentName"):
                                    parent_name = str(decoded["parentName"])
                                if decoded.get("parentContainerClass") in ("Folder", "Model"):
                                    parent_container_class = str(decoded["parentContainerClass"])
                                if decoded.get("hierarchyPath"):
                                    hierarchy_path = str(decoded["hierarchyPath"])
                                if decoded.get("geometrySource"):
                                    geometry_source = str(decoded["geometrySource"])
                                json_mesh_id = validate_published_roblox_mesh_id(
                                    decoded.get("publishedMeshId") or decoded.get("meshId")
                                )
                                if json_mesh_id and not published_mesh_id:
                                    published_mesh_id = json_mesh_id
                                json_tex_id = validate_published_roblox_mesh_id(decoded.get("textureId"))
                                if json_tex_id and not published_tex_id:
                                    published_tex_id = json_tex_id
                                roughness_val = float(decoded.get("roughness", roughness_val))
                                metalness_val = float(decoded.get("metalness", metalness_val))
                                if "reflectance" in decoded and decoded["reflectance"] is not None:
                                    reflectance_val = float(decoded["reflectance"])
                                cf_mode = str(decoded.get("collisionFidelity") or cf_mode)
                                if isinstance(decoded.get("rotationMatrix"), list) and len(decoded["rotationMatrix"]) == 9:
                                    rotation_matrix = [float(x) for x in decoded["rotationMatrix"]]
                                    rx, ry, rz = _rotation_matrix_to_euler_deg(*rotation_matrix)
                                elif isinstance(decoded.get("rotation"), list) and len(decoded["rotation"]) == 3:
                                    rx, ry, rz = [float(x) for x in decoded["rotation"]]
                                    rotation_matrix = list(_euler_deg_to_rotation_matrix(rx, ry, rz))
                                if isinstance(decoded.get("pbrMaterial"), dict):
                                    sa_pbr = {**decoded["pbrMaterial"], **sa_pbr}
                                verts = decoded.get("vertices") or []
                                faces = decoded.get("faces") or []
                                if len(verts) >= 3 and len(faces) >= 1:
                                    geom_spec = SubMeshGeometrySpec(
                                        vertices=verts,
                                        normals=decoded.get("normals") or [[0.0, 1.0, 0.0]] * len(verts),
                                        uvs=decoded.get("uvs") or [[0.0, 0.0]] * len(verts),
                                        faces=faces,
                                        indices=[i for tri in faces for i in tri[:3]],
                                        objFileName=f"{model_name}.obj",
                                        meshId=published_mesh_id or None,
                                        assetId=published_mesh_id or None,
                                        geometrySource="EditableMeshBuffers",
                                    )
                                    geometry_source = "EditableMeshBuffers"
                        except Exception:
                            pass

            if geom_spec is None:
                if published_mesh_id or geometry_source in ("PublishedCloudMeshId", "StudioExternalUnreadable"):
                    geometry_source = "PublishedCloudMeshId" if published_mesh_id else (geometry_source or "StudioExternalUnreadable")
                    geom_spec = SubMeshGeometrySpec(
                        vertices=[],
                        normals=[],
                        uvs=[],
                        faces=[],
                        indices=[],
                        objFileName=f"{model_name}.obj",
                        meshId=published_mesh_id or None,
                        assetId=published_mesh_id or None,
                        geometrySource=geometry_source,
                    )
                else:
                    geometry_source = "EditableMeshBuffers"
                    geom_spec = synthesize_procedural_mesh_data("MeshPart", [sx, sy, sz])
                    geom_spec.objFileName = f"{model_name}.obj"
                    geom_spec.geometrySource = "EditableMeshBuffers"

            raw_spec = MeshPart3DSpec(
                partId=part_id or None,
                parentId=parent_id or None,
                parentName=parent_name or "ModelRoot",
                parentContainerClass=parent_container_class,
                hierarchyPath=hierarchy_path or None,
                name=part_name,
                shape="MeshPart",
                meshId=published_mesh_id or None,
                assetId=published_mesh_id or None,
                textureId=published_tex_id or None,
                geometrySource=geometry_source,
                size=[round(sx, 3), round(sy, 3), round(sz, 3)],
                position=[round(px, 3), round(py, 3), round(pz, 3)],
                rotation=[rx, ry, rz],
                rotationMatrix=rotation_matrix,
                color=[max(0, min(255, cr)), max(0, min(255, cg)), max(0, min(255, cb))],
                material=material_name,
                roughness=roughness_val,
                metalness=metalness_val,
                reflectance=round(reflectance_val, 3),
                transparency=transparency,
                canCollide=can_collide,
                anchored=anchored,
                collisionFidelity=cf_mode if cf_mode in ("Default", "Box", "Hull", "PreciseConvexDecomposition") else "Hull",  # type: ignore
                pbrMaterial=sa_pbr if sa_pbr else None,
                meshData=geom_spec,
            )
            sync_hashes = AssetEngine.compute_part_sync_hashes(raw_spec.model_dump(), idx)
            raw_spec.partId = sync_hashes["partId"]
            raw_spec.parentId = sync_hashes["parentId"]
            raw_spec.parentName = sync_hashes["parentName"]
            raw_spec.parentContainerClass = sync_hashes["parentContainerClass"]
            raw_spec.hierarchyPath = sync_hashes["hierarchyPath"]
            raw_spec.geometrySource = sync_hashes["geometrySource"]
            raw_spec.rotationMatrix = sync_hashes["rotationMatrix"]
            raw_spec.reflectance = sync_hashes["reflectance"]
            raw_spec.geometryHash = sync_hashes["geometryHash"]
            raw_spec.materialHash = sync_hashes["materialHash"]
            raw_spec.transformHash = sync_hashes["transformHash"]
            raw_spec.hierarchyHash = sync_hashes["hierarchyHash"]
            raw_spec.combinedHash = sync_hashes["combinedHash"]
            raw_spec.integritySha256 = sync_hashes["integritySha256"]
            recovered_parts.append(raw_spec)

        total_tris = sum(len(p.meshData.faces) for p in recovered_parts if p.meshData)
        return {
            "name": model_name,
            "category": category,
            "poly_count": total_tris,
            "parts": recovered_parts,
        }

    def build_obj_and_mtl_from_parts(
        self, model_name: str, parts: List[MeshPart3DSpec]
    ) -> Dict[str, str]:
        """
        Autonomously builds paired Wavefront `.obj` and `.mtl` files from `parts`,
        preserving world-transformed vertices, normals, UVs, and PBR material definitions.
        Returns a dictionary `{"obj": ..., "mtl": ..., "obj_file_name": ..., "mtl_file_name": ...}`.
        """
        safe_name = "".join(c for c in model_name if c.isalnum() or c == "_") or "ForgeModel3D"
        parts = self.ensure_mesh_data_on_parts(safe_name, parts)

        obj_lines = [
            "# Forge AI Studio - Roblox Studio 3D Mesh (.OBJ + .MTL)",
            f"# Model: {safe_name} | Parts: {len(parts)}",
            f"mtllib {safe_name}.mtl",
            "",
        ]
        mtl_lines = [
            "# Forge AI Studio - PBR Material Library (.MTL)",
            f"# Model: {safe_name}",
            "",
        ]

        v_offset = 1
        vt_offset = 1
        vn_offset = 1

        for idx, part in enumerate(parts):
            part_name = (part.name or f"MeshPart_{idx + 1}").replace(" ", "_")
            mat_name = f"{part_name}_Mat"
            cr, cg, cb = (part.color + [160, 170, 185])[:3]
            kd_r, kd_g, kd_b = cr / 255.0, cg / 255.0, cb / 255.0
            roughness = max(0.04, min(1.0, part.roughness))
            metalness = max(0.0, min(1.0, part.metalness))
            opacity = max(0.05, min(1.0, 1.0 - part.transparency))

            mtl_lines.extend([
                f"newmtl {mat_name}",
                f"Ka {kd_r:.4f} {kd_g:.4f} {kd_b:.4f}",
                f"Kd {kd_r:.4f} {kd_g:.4f} {kd_b:.4f}",
                f"Ks {metalness:.4f} {metalness:.4f} {metalness:.4f}",
                f"Pr {roughness:.4f}",
                f"Pm {metalness:.4f}",
            ])
            if part.material == "Neon":
                mtl_lines.append(f"Ke {kd_r:.4f} {kd_g:.4f} {kd_b:.4f}")
            mtl_lines.extend([
                f"d {opacity:.4f}",
                "illum 2",
                "",
            ])

            sx, sy, sz = (part.size + [2.0, 2.0, 2.0])[:3]
            px, py, pz = (part.position + [0.0, 1.0, 0.0])[:3]
            rx, ry, rz = (part.rotation + [0.0, 0.0, 0.0])[:3]
            r00, r01, r02, r10, r11, r12, r20, r21, r22 = _euler_deg_to_rotation_matrix(rx, ry, rz)

            mesh_data = part.meshData or synthesize_procedural_mesh_data(part.shape, [sx, sy, sz])
            verts = mesh_data.vertices
            norms = mesh_data.normals if len(mesh_data.normals) == len(verts) else [[0.0, 1.0, 0.0]] * len(verts)
            uvs = mesh_data.uvs if len(mesh_data.uvs) == len(verts) else [[0.0, 0.0]] * len(verts)

            obj_lines.extend([
                f"o {part_name}",
                f"g {part_name}",
                f"usemtl {mat_name}",
            ])

            for v in verts:
                vx, vy, vz = v[0], v[1], v[2]
                wx = r00 * vx + r01 * vy + r02 * vz + px
                wy = r10 * vx + r11 * vy + r12 * vz + py
                wz = r20 * vx + r21 * vy + r22 * vz + pz
                obj_lines.append(f"v {wx:.4f} {wy:.4f} {wz:.4f}")

            for u in uvs:
                obj_lines.append(f"vt {u[0]:.4f} {u[1]:.4f}")

            for n in norms:
                nx, ny, nz = n[0], n[1], n[2]
                wnx = r00 * nx + r01 * ny + r02 * nz
                wny = r10 * nx + r11 * ny + r12 * nz
                wnz = r20 * nx + r21 * ny + r22 * nz
                mag = math.sqrt(wnx * wnx + wny * wny + wnz * wnz) or 1.0
                obj_lines.append(f"vn {wnx / mag:.4f} {wny / mag:.4f} {wnz / mag:.4f}")

            for f in mesh_data.faces:
                if len(f) >= 3:
                    i0, i1, i2 = f[0], f[1], f[2]
                    obj_lines.append(
                        f"f {i0 + v_offset}/{i0 + vt_offset}/{i0 + vn_offset} "
                        f"{i1 + v_offset}/{i1 + vt_offset}/{i1 + vn_offset} "
                        f"{i2 + v_offset}/{i2 + vt_offset}/{i2 + vn_offset}"
                    )

            v_offset += len(verts)
            vt_offset += len(uvs)
            vn_offset += len(norms)
            obj_lines.append("")

        return {
            "obj": "\n".join(obj_lines),
            "mtl": "\n".join(mtl_lines),
            "obj_file_name": f"{safe_name}.obj",
            "mtl_file_name": f"{safe_name}.mtl",
        }


    def build_gltf_from_parts(
        self,
        model_name: str,
        parts: List[MeshPart3DSpec],
        pbr_textures: Optional[Dict[str, str]] = None,
    ) -> str:
        """
        Autonomously builds a standard glTF 2.0 (`.gltf`) file with embedded binary geometry buffers
        (`POSITION`, `NORMAL`, `TEXCOORD_0`, `INDICES`) and full PBR materials (including embedded
        PNG texture maps `baseColorTexture`, `normalTexture`, `metallicRoughnessTexture` when provided).
        """
        safe_name = "".join(c for c in model_name if c.isalnum() or c == "_") or "ForgeModel3D"
        parts = self.ensure_mesh_data_on_parts(safe_name, parts)

        buffer_chunks: List[bytes] = []
        buffer_views: List[Dict[str, Any]] = []
        accessors: List[Dict[str, Any]] = []
        meshes: List[Dict[str, Any]] = []
        materials: List[Dict[str, Any]] = []
        nodes: List[Dict[str, Any]] = []
        images: List[Dict[str, Any]] = []
        textures: List[Dict[str, Any]] = []
        samplers: List[Dict[str, Any]] = []

        if pbr_textures:
            samplers.append({
                "magFilter": 9729,
                "minFilter": 9987,
                "wrapS": 10497,
                "wrapT": 10497,
            })
            for tex_key, tex_name in [
                ("albedo_data_url", f"{safe_name}_BaseColor"),
                ("normal_data_url", f"{safe_name}_Normal"),
                ("roughness_data_url", f"{safe_name}_Roughness"),
            ]:
                uri = pbr_textures.get(tex_key, "")
                if uri and uri.startswith("data:image/"):
                    img_idx = len(images)
                    images.append({"name": tex_name, "uri": uri})
                    textures.append({"sampler": 0, "source": img_idx})

        byte_offset = 0

        def append_bytes(raw: bytes, target: int) -> int:
            nonlocal byte_offset
            pad = (4 - (len(raw) % 4)) % 4
            view_idx = len(buffer_views)
            buffer_views.append({
                "buffer": 0,
                "byteOffset": byte_offset,
                "byteLength": len(raw),
                "target": target,
            })
            buffer_chunks.append(raw)
            if pad > 0:
                buffer_chunks.append(b"\x00" * pad)
            byte_offset += len(raw) + pad
            return view_idx

        for idx, part in enumerate(parts):
            part_name = part.name or f"MeshPart_{idx + 1}"
            sx, sy, sz = (part.size + [2.0, 2.0, 2.0])[:3]
            mesh_data = part.meshData or synthesize_procedural_mesh_data(part.shape, [sx, sy, sz])
            verts = mesh_data.vertices
            if len(verts) < 3 or len(mesh_data.faces) < 1:
                continue

            v_count = len(verts)
            norms = mesh_data.normals if len(mesh_data.normals) == v_count else [[0.0, 1.0, 0.0]] * v_count
            uvs = mesh_data.uvs if len(mesh_data.uvs) == v_count else [[0.0, 0.0]] * v_count

            xs = [v[0] for v in verts]
            ys = [v[1] for v in verts]
            zs = [v[2] for v in verts]

            pos_bytes = b"".join(struct.pack("<3f", float(v[0]), float(v[1]), float(v[2])) for v in verts)
            norm_bytes = b"".join(struct.pack("<3f", float(n[0]), float(n[1]), float(n[2])) for n in norms)
            uv_bytes = b"".join(struct.pack("<2f", float(u[0]), float(u[1])) for u in uvs)
            flat_indices = [
                int(i)
                for f in mesh_data.faces
                if len(f) >= 3 and 0 <= f[0] < v_count and 0 <= f[1] < v_count and 0 <= f[2] < v_count
                for i in f[:3]
            ]
            idx_bytes = b"".join(struct.pack("<I", i) for i in flat_indices)

            pos_view = append_bytes(pos_bytes, 34962)
            pos_acc = len(accessors)
            accessors.append({
                "bufferView": pos_view,
                "componentType": 5126,
                "count": v_count,
                "type": "VEC3",
                "min": [min(xs), min(ys), min(zs)],
                "max": [max(xs), max(ys), max(zs)],
            })

            norm_view = append_bytes(norm_bytes, 34962)
            norm_acc = len(accessors)
            accessors.append({
                "bufferView": norm_view,
                "componentType": 5126,
                "count": v_count,
                "type": "VEC3",
            })

            uv_view = append_bytes(uv_bytes, 34962)
            uv_acc = len(accessors)
            accessors.append({
                "bufferView": uv_view,
                "componentType": 5126,
                "count": v_count,
                "type": "VEC2",
            })

            idx_view = append_bytes(idx_bytes, 34963)
            idx_acc = len(accessors)
            accessors.append({
                "bufferView": idx_view,
                "componentType": 5125,
                "count": len(flat_indices),
                "type": "SCALAR",
            })

            cr, cg, cb = (part.color + [160, 170, 185])[:3]
            alpha = max(0.05, min(1.0, 1.0 - part.transparency))
            pbr_mr: Dict[str, Any] = {
                "baseColorFactor": [
                    round(cr / 255.0, 4),
                    round(cg / 255.0, 4),
                    round(cb / 255.0, 4),
                    round(alpha, 4),
                ],
                "metallicFactor": round(max(0.0, min(1.0, part.metalness)), 4),
                "roughnessFactor": round(max(0.04, min(1.0, part.roughness)), 4),
            }
            if len(textures) >= 1:
                pbr_mr["baseColorTexture"] = {"index": 0}
            if len(textures) >= 3:
                pbr_mr["metallicRoughnessTexture"] = {"index": 2}

            mat_obj: Dict[str, Any] = {
                "name": f"{part_name}_{part.material or 'Metal'}",
                "pbrMetallicRoughness": pbr_mr,
                "emissiveFactor": (
                    [round(cr / 255.0, 4), round(cg / 255.0, 4), round(cb / 255.0, 4)]
                    if part.material == "Neon"
                    else [0.0, 0.0, 0.0]
                ),
                "doubleSided": False,
                "alphaMode": "BLEND" if alpha < 0.99 else "OPAQUE",
            }
            if len(textures) >= 2:
                mat_obj["normalTexture"] = {"index": 1}

            mat_idx = len(materials)
            materials.append(mat_obj)

            mesh_idx = len(meshes)
            meshes.append({
                "name": part_name,
                "primitives": [{
                    "attributes": {
                        "POSITION": pos_acc,
                        "NORMAL": norm_acc,
                        "TEXCOORD_0": uv_acc,
                    },
                    "indices": idx_acc,
                    "material": mat_idx,
                    "mode": 4,
                }],
            })

            px, py, pz = (part.position + [0.0, 1.0, 0.0])[:3]
            rx, ry, rz = (part.rotation + [0.0, 0.0, 0.0])[:3]
            qx, qy, qz, qw = _euler_deg_to_quaternion(rx, ry, rz)

            nodes.append({
                "name": part_name,
                "mesh": mesh_idx,
                "translation": [round(px, 4), round(py, 4), round(pz, 4)],
                "rotation": [round(qx, 6), round(qy, 6), round(qz, 6), round(qw, 6)],
                "extras": {
                    "robloxMaterial": part.material or "Metal",
                    "collisionFidelity": part.collisionFidelity or "Hull",
                },
            })

        combined_bytes = b"".join(buffer_chunks)
        b64_buf = base64.b64encode(combined_bytes).decode("ascii")

        gltf_doc: Dict[str, Any] = {
            "asset": {
                "version": "2.0",
                "generator": "Forge AI Studio - Roblox Studio 3D & PBR Exporter",
            },
            "scene": 0,
            "scenes": [{"name": safe_name, "nodes": list(range(len(nodes)))}],
            "nodes": nodes,
            "meshes": meshes,
            "materials": materials,
            "accessors": accessors,
            "bufferViews": buffer_views,
            "buffers": [{
                "byteLength": len(combined_bytes),
                "uri": f"data:application/octet-stream;base64,{b64_buf}",
            }],
        }
        if images:
            gltf_doc["images"] = images
            gltf_doc["textures"] = textures
            gltf_doc["samplers"] = samplers

        return json.dumps(gltf_doc, indent=2)

    def _build_contents(self, req: Generate3DEngineRequest, context_data: str) -> List[Any]:
        prompt_text = f"""
ASSET GENERATION MODE: {req.asset_type}
CATEGORY: {req.category}
COLLISION FIDELITY: {req.collision_fidelity}
TARGET POLYGON BUDGET: {req.target_poly_budget} triangles

USER SPECIFICATION:
{req.prompt}
{context_data}

REQUIREMENTS:
- Build a composite 3D asset with 6 to 12 articulated MeshPart sub-parts (`parts` array) grounded at Y = 0.
- Never use 'Block' shapes; every sub-part must use `shape: "MeshPart"` (or specialized curved/beveled MeshPart geometry) with `meshData` vertex/index buffers.
- Include realistic Roblox `Enum.Material` names, PBR roughness/metalness, and RGB colors.
- Generate a complete `--!strict` Luau builder module in `luau_code` that constructs `MeshPart` instances via `AssetService:CreateEditableMesh()`.
"""
        contents: List[Any] = []
        if req.reference_image_base64:
            raw_b64 = req.reference_image_base64.strip()
            mime_type = (req.reference_image_mime_type or "image/png").strip() or "image/png"
            if "," in raw_b64:
                header, raw_b64 = raw_b64.split(",", 1)
                if "jpeg" in header or "jpg" in header:
                    mime_type = "image/jpeg"
                elif "webp" in header:
                    mime_type = "image/webp"
            contents.append(types.Part.from_bytes(data=base64.b64decode(raw_b64), mime_type=mime_type))
        contents.append(prompt_text)
        return contents

    def synthesize_seeded_procedural_asset(self, req: Generate3DEngineRequest) -> Model3DResponse:
        raw_seed = str(req.seed or (req.tree_params or {}).get("seed") or f"{req.prompt}-2026")
        seed_val = 0x811C9DC5
        for ch in raw_seed:
            seed_val ^= ord(ch) & 0xFF
            seed_val = (seed_val * 0x01000193) & 0xFFFFFFFF
        if seed_val == 0:
            seed_val = 0x12345678

        def rng() -> float:
            nonlocal seed_val
            seed_val = (seed_val + 0x6D2B79F5) & 0xFFFFFFFF
            t = ((seed_val ^ (seed_val >> 15)) * (1 | seed_val)) & 0xFFFFFFFF
            t = (t + (((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF)) ^ t
            return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

        combined = f"{req.category} {req.prompt}".lower()
        is_tree = any(k in combined for k in ("tree", "árbol", "arbol", "vegeta", "pine", "oak", "willow", "canopy")) or bool(req.tree_params)
        raw_name = req.name or ("ProceduralRobloxTree" if is_tree else "".join(c for c in req.prompt.title() if c.isalnum())[:28] or "ProceduralAsset3D")
        safe_name = "".join(c for c in raw_name if c.isalnum() or c == "_")[:28] or "ProceduralAsset3D"

        tp = req.tree_params or {}
        height = max(4.0, min(45.0, float(tp.get("height", 14.0))))
        trunk_thick = max(0.4, min(6.0, float(tp.get("trunkThickness", 1.6))))
        branch_count = max(1, min(12, int(tp.get("branchCount", 4))))
        trunk_mat = str(tp.get("trunkMaterial", "Wood"))
        leaf_mat = str(tp.get("leafMaterial", "Grass"))
        trunk_col = str(tp.get("trunkColor", "#5c4033"))
        leaf_col = str(tp.get("leafColor", "#2d6a4f"))

        parts_specs: List[MeshPart3DSpec] = []
        if is_tree:
            flare_h = round(max(0.6, height * 0.08), 4)
            trunk_h = round(height * 0.56, 4)
            parts_specs.append(
                MeshPart3DSpec(
                    partId="part_1_rootflare",
                    name="RootFlare",
                    parentPath="Root",
                    shape="MeshPart",
                    size=[round(trunk_thick * 1.45, 4), flare_h, round(trunk_thick * 1.45, 4)],
                    position=[0.0, round(flare_h * 0.5, 4), 0.0],
                    rotation=[0.0, 0.0, 0.0],
                    color=trunk_col,
                    material=trunk_mat,
                    roughness=0.85,
                    metalness=0.05,
                    canCollide=True,
                    anchored=True,
                    collisionFidelity=req.collision_fidelity,
                )
            )
            parts_specs.append(
                MeshPart3DSpec(
                    partId="part_2_trunk",
                    name="MainTrunk",
                    parentPath="Root",
                    shape="MeshPart",
                    size=[trunk_thick, trunk_h, trunk_thick],
                    position=[0.0, round(flare_h * 0.85 + trunk_h * 0.5, 4), 0.0],
                    rotation=[0.0, round(rng() * 360.0, 4), 0.0],
                    color=trunk_col,
                    material=trunk_mat,
                    roughness=0.82,
                    metalness=0.04,
                    canCollide=True,
                    anchored=True,
                    collisionFidelity=req.collision_fidelity,
                )
            )
            for b_idx in range(branch_count):
                angle = (b_idx / max(1, branch_count)) * math.pi * 2.0 + (rng() - 0.5) * 0.35
                b_len = round(max(1.4, height * 0.22 * (0.9 + rng() * 0.2)), 4)
                b_thk = round(max(0.28, trunk_thick * 0.42), 4)
                bx = round(math.cos(angle) * (trunk_thick * 0.4 + b_len * 0.35), 4)
                by = round(flare_h + trunk_h * 0.65 + (b_idx / max(1, branch_count)) * (trunk_h * 0.25), 4)
                bz = round(math.sin(angle) * (trunk_thick * 0.4 + b_len * 0.35), 4)
                parts_specs.append(
                    MeshPart3DSpec(
                        partId=f"part_branch_{b_idx + 1}",
                        name=f"Branch_{b_idx + 1}",
                        parentPath="Root/Branches",
                        shape="MeshPart",
                        size=[b_thk, b_len, b_thk],
                        position=[bx, by, bz],
                        rotation=[round(math.sin(angle) * 40.0, 4), round(math.degrees(angle), 4), round(-math.cos(angle) * 40.0, 4)],
                        color=trunk_col,
                        material=trunk_mat,
                        roughness=0.8,
                        metalness=0.04,
                        canCollide=True,
                        anchored=True,
                        collisionFidelity=req.collision_fidelity,
                    )
                )
            crown_w = round(max(2.6, height * 0.52), 4)
            crown_h = round(max(2.2, height * 0.42), 4)
            crown_y = round(flare_h + trunk_h * 0.88 + crown_h * 0.26, 4)
            parts_specs.append(
                MeshPart3DSpec(
                    partId="part_canopy_main",
                    name="CanopyCrown_Main",
                    parentPath="Root/Canopy",
                    shape="MeshPart",
                    size=[crown_w, crown_h, crown_w],
                    position=[0.0, crown_y, 0.0],
                    rotation=[0.0, round(rng() * 360.0, 4), 0.0],
                    color=leaf_col,
                    material=leaf_mat,
                    roughness=0.72,
                    metalness=0.02,
                    canCollide=True,
                    anchored=True,
                    collisionFidelity=req.collision_fidelity,
                )
            )
        else:
            parts_specs = [
                MeshPart3DSpec(
                    partId="part_1_base",
                    name="BaseFoundation",
                    parentPath="Root",
                    shape="MeshPart",
                    size=[round(3.4 + rng(), 4), 0.8, round(3.4 + rng(), 4)],
                    position=[0.0, 0.4, 0.0],
                    rotation=[0.0, 0.0, 0.0],
                    color="#475569",
                    material="Metal",
                    roughness=0.5,
                    metalness=0.5,
                    canCollide=True,
                    anchored=True,
                    collisionFidelity=req.collision_fidelity,
                ),
                MeshPart3DSpec(
                    partId="part_2_core",
                    name="PrimaryCoreBody",
                    parentPath="Root",
                    shape="MeshPart",
                    size=[round(2.4 + rng() * 0.6, 4), 3.6, round(2.4 + rng() * 0.6, 4)],
                    position=[0.0, 2.6, 0.0],
                    rotation=[0.0, round(rng() * 90.0, 4), 0.0],
                    color="#64748b",
                    material="Slate",
                    roughness=0.6,
                    metalness=0.35,
                    canCollide=True,
                    anchored=True,
                    collisionFidelity=req.collision_fidelity,
                ),
            ]

        parts_with_mesh = self.ensure_mesh_data_on_parts(safe_name, parts_specs)
        luau_code = self.build_luau_from_parts(safe_name, parts_with_mesh, req.collision_fidelity)
        total_tris = sum(len(p.meshData.faces) for p in parts_with_mesh if p.meshData)
        return Model3DResponse(
            id=f"asset-proc-{abs(hash(raw_seed)) % 100000000}",
            name=safe_name,
            category="Trees & Vegetation" if is_tree else req.category,
            asset_type=req.asset_type,
            generation_mode="procedural",
            seed=raw_seed,
            poly_count=total_tris,
            collision_fidelity=req.collision_fidelity,
            rojo_target_folder="src/shared/Assets3D",
            file_name=f"{safe_name}.luau",
            description=f"Asset 3D procedural determinista (seed={raw_seed}, {len(parts_with_mesh)} sub-mallas).",
            pbr_profile=PBRProfileSpec(
                albedo_hex=leaf_col if is_tree else "#475569",
                roughness=0.75 if is_tree else 0.5,
                metalness=0.04 if is_tree else 0.5,
                roblox_material=leaf_mat if is_tree else "Metal",
            ),
            parts=parts_with_mesh,
            luau_code=luau_code,
        )

    def generate_3d_asset(
        self,
        req: Generate3DEngineRequest,
        context_data: str = "",
        save_luau_fn: Optional[Callable[[str, str, str], str]] = None,
        save_library_fn: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
    ) -> Model3DResponse:
        uploaded_parts = self.extract_parts_from_uploaded_meshes(
            model_name=req.prompt[:32] or "UploadedMeshAsset",
            uploaded_mesh_obj=req.uploaded_mesh_obj,
            uploaded_sub_meshes=req.uploaded_sub_meshes,
            collision_fidelity=req.collision_fidelity,
        )
        if uploaded_parts:
            safe_name = "".join(c for c in req.prompt.title() if c.isalnum())[:28] or "UploadedMeshAsset"
            luau_code = self.build_luau_from_parts(safe_name, uploaded_parts, req.collision_fidelity)
            total_tris = sum(len(p.meshData.faces) for p in uploaded_parts if p.meshData)
            parsed = Model3DResponse(
                id=f"asset-{int(time.time() * 1000)}",
                name=safe_name,
                category=req.category,
                asset_type=req.asset_type,
                poly_count=total_tris,
                collision_fidelity=req.collision_fidelity,
                rojo_target_folder="src/shared/Assets3D",
                file_name=f"{safe_name}.luau",
                description=f"Extracted {len(uploaded_parts)} true MeshParts ({total_tris} triangles) from uploaded 3D mesh.",
                pbr_profile=PBRProfileSpec(),
                parts=uploaded_parts,
                luau_code=luau_code,
            )
            if req.save_to_rojo and save_luau_fn:
                parsed.saved_path = save_luau_fn(parsed.rojo_target_folder, parsed.file_name, parsed.luau_code)
            if req.save_to_library and save_library_fn:
                save_library_fn(parsed.model_dump())
            return parsed

        use_procedural = (
            req.generation_mode == "procedural"
            or req.seed is not None
            or req.tree_params is not None
            or not self.client
        )
        if use_procedural:
            parsed = self.synthesize_seeded_procedural_asset(req)
            if req.save_to_rojo and save_luau_fn:
                parsed.saved_path = save_luau_fn(parsed.rojo_target_folder, parsed.file_name, parsed.luau_code)
            if req.save_to_library and save_library_fn:
                save_library_fn(parsed.model_dump())
            return parsed

        model_name = self.resolve_model(req.model_tier)
        contents = self._build_contents(req, context_data)

        response = self.client.models.generate_content(
            model=model_name,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=GENERATION_3D_SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                response_schema=Model3DResponse,
            ),
        )

        parsed = Model3DResponse.model_validate_json(response.text or "{}")
        parsed.id = f"asset-{int(time.time() * 1000)}"
        parsed.parts = self.ensure_mesh_data_on_parts(parsed.name, parsed.parts)
        parsed.luau_code = self.build_luau_from_parts(parsed.name, parsed.parts, parsed.collision_fidelity)

        if req.save_to_rojo and save_luau_fn:
            parsed.saved_path = save_luau_fn(
                parsed.rojo_target_folder or "src/shared/Assets3D",
                parsed.file_name,
                parsed.luau_code,
            )
        if req.save_to_library and save_library_fn:
            save_library_fn(parsed.model_dump())

        return parsed

    def stream_3d_asset(
        self,
        req: Generate3DEngineRequest,
        context_data: str = "",
        save_luau_fn: Optional[Callable[[str, str, str], str]] = None,
        save_library_fn: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
    ) -> Generator[str, None, None]:
        def sse(payload: Dict[str, Any]) -> str:
            return f"data: {json.dumps(payload)}\n\n"

        uploaded_parts = self.extract_parts_from_uploaded_meshes(
            model_name=req.prompt[:32] or "UploadedMeshAsset",
            uploaded_mesh_obj=req.uploaded_mesh_obj,
            uploaded_sub_meshes=req.uploaded_sub_meshes,
            collision_fidelity=req.collision_fidelity,
        )
        if uploaded_parts:
            safe_name = "".join(c for c in req.prompt.title() if c.isalnum())[:28] or "UploadedMeshAsset"
            luau_code = self.build_luau_from_parts(safe_name, uploaded_parts, req.collision_fidelity)
            total_tris = sum(len(p.meshData.faces) for p in uploaded_parts if p.meshData)
            parsed = Model3DResponse(
                id=f"asset-{int(time.time() * 1000)}",
                name=safe_name,
                category=req.category,
                asset_type=req.asset_type,
                poly_count=total_tris,
                collision_fidelity=req.collision_fidelity,
                rojo_target_folder="src/shared/Assets3D",
                file_name=f"{safe_name}.luau",
                description=f"Extracted {len(uploaded_parts)} true MeshParts ({total_tris} triangles) from uploaded 3D mesh.",
                pbr_profile=PBRProfileSpec(),
                parts=uploaded_parts,
                luau_code=luau_code,
            )
            if req.save_to_rojo and save_luau_fn:
                parsed.saved_path = save_luau_fn(parsed.rojo_target_folder, parsed.file_name, parsed.luau_code)
                yield sse({
                    "type": "rojo_write",
                    "saved": True,
                    "path": parsed.saved_path,
                    "message": "ROJO 3D SYNC CONFIRMADO: Módulo MeshPart escrito en disco",
                })
            if req.save_to_library and save_library_fn:
                save_library_fn(parsed.model_dump())
            asset_dump = parsed.model_dump()
            yield sse({
                "type": "done",
                "status": "complete",
                "progress": 100,
                "message": "Uploaded mesh extracted and serialized to true MeshPart Luau.",
                "result": asset_dump,
                "data": asset_dump,
            })
            return

        use_procedural = (
            req.generation_mode == "procedural"
            or req.seed is not None
            or req.tree_params is not None
            or not self.client
        )
        if use_procedural:
            parsed = self.synthesize_seeded_procedural_asset(req)
            if req.save_to_rojo and save_luau_fn:
                parsed.saved_path = save_luau_fn(parsed.rojo_target_folder, parsed.file_name, parsed.luau_code)
                yield sse({
                    "type": "rojo_write",
                    "saved": True,
                    "path": parsed.saved_path,
                    "message": "ROJO 3D SYNC CONFIRMADO: Módulo MeshPart procedural escrito en disco",
                })
            if req.save_to_library and save_library_fn:
                save_library_fn(parsed.model_dump())
            asset_dump = parsed.model_dump()
            yield sse({
                "type": "done",
                "status": "complete",
                "progress": 100,
                "message": "Asset 3D procedural sintetizado y validado.",
                "result": asset_dump,
                "data": asset_dump,
            })
            return

        model_name = self.resolve_model(req.model_tier)
        yield sse({
            "type": "stage",
            "stage": "context",
            "message": f"Auditando módulos Rojo y preparando presupuesto de {req.target_poly_budget} triángulos...",
            "progress": 14,
        })

        contents = self._build_contents(req, context_data)
        if req.reference_image_base64:
            yield sse({
                "type": "log",
                "level": "info",
                "message": f"Imagen de referencia 2D cargada ({req.reference_image_mime_type or 'image/png'}) para reconstrucción volumétrica 3D.",
            })

        yield sse({
            "type": "stage",
            "stage": "geometry",
            "message": f"Sintetizando mallas MeshPart en Studs con {model_name} (Streaming)...",
            "progress": 32,
        })

        try:
            stream = self.client.models.generate_content_stream(
                model=model_name,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=GENERATION_3D_SYSTEM_INSTRUCTION,
                    response_mime_type="application/json",
                    response_schema=Model3DResponse,
                ),
            )

            accumulated = ""
            chunk_idx = 0
            for chunk in stream:
                piece = chunk.text or ""
                if not piece:
                    continue
                accumulated += piece
                chunk_idx += 1
                prog = min(88, 32 + chunk_idx * 3)
                chunk_event: Dict[str, Any] = {
                    "type": "chunk",
                    "stage": "streaming",
                    "delta": piece,
                    "text": piece,
                    "chars": len(accumulated),
                    "progress": prog,
                }
                if chunk_idx % 4 == 0:
                    chunk_event["message"] = (
                        f"Serializando buffers de vértices/índices EditableMesh ({len(accumulated)} bytes)..."
                    )
                yield sse(chunk_event)

            parsed = Model3DResponse.model_validate_json(accumulated or "{}")
            parsed.id = f"asset-{int(time.time() * 1000)}"
            parsed.parts = self.ensure_mesh_data_on_parts(parsed.name, parsed.parts)
            parsed.luau_code = self.build_luau_from_parts(parsed.name, parsed.parts, parsed.collision_fidelity)

            if req.save_to_rojo and save_luau_fn:
                parsed.saved_path = save_luau_fn(
                    parsed.rojo_target_folder or "src/shared/Assets3D",
                    parsed.file_name,
                    parsed.luau_code,
                )
                yield sse({
                    "type": "rojo_write",
                    "saved": True,
                    "path": parsed.saved_path,
                    "message": f"ROJO 3D SYNC CONFIRMADO: Módulo MeshPart '{parsed.file_name}' sincronizado",
                })
            else:
                yield sse({
                    "type": "rojo_write",
                    "saved": False,
                    "path": None,
                    "message": "Sincronización automática con Rojo omitida por configuración del usuario.",
                })

            if req.save_to_library and save_library_fn:
                save_library_fn(parsed.model_dump())

            asset_dump = parsed.model_dump()
            yield sse({
                "type": "done",
                "status": "complete",
                "progress": 100,
                "message": f"Asset MeshPart 3D '{parsed.name}' generado y sincronizado con Rojo.",
                "result": asset_dump,
                "data": asset_dump,
            })
        except Exception as err:
            err_str = str(err)
            yield sse({"type": "error", "message": err_str, "error": err_str})
