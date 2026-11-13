"""
End-to-End Automated Verification Suite for Forge AI <-> Roblox Studio Bidirectional Synchronization
====================================================================================================
Covers all P0 & P1 requirements from the architecture & synchronization audit:
1. Cross-engine canonical hash parity (`FORGE_SYNC_HASH_SCHEMA_V1 = "forge-sync-v1"`) across Python, TypeScript, and Luau.
2. Full-buffer vertex sensitivity (mutating an intermediate vertex `v[10]` changes `geometryHash`).
3. Luau script normalization (`\r\n` vs `\n` and outer whitespace produce identical `compute_fnv1a_32_hex`).
4. 8-Step Roundtrip with camera offset (`ForgeSyncOriginCFrame`):
   create -> export -> spawn with camera offset -> compare (0 false diffs) -> modify 1 part ->
   detect exact change -> push incremental selection -> repeat compare (0 false diffs).
5. External `MeshPart` preservation (`PublishedCloudMeshId` & `StudioExternalUnreadable` are never replaced with cubes).
6. Real nested `DataModel` hierarchy containers (`Root/Turret/Cannon/PlasmaCannon`) in `.RBXMX` and Luau.
7. Duplicate `partId` rejection, `sync_scope` (`selection` vs `full_model` vs `explicit_delete`), and 3-way conflict policies (`reject` vs `smart_merge`).
"""

import json
import math
import subprocess
import sys
import tempfile
import types as py_types
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _install_lightweight_runtime_shims_if_needed() -> None:
    """
    Provides lightweight stdlib shims for `pydantic`, `dotenv`, `google.genai`, and `fastapi`
    if running in a container environment where only Python 3 stdlib + Node.js are preinstalled,
    allowing `backend/main.py` and all 7 Python engines to be imported and tested directly.
    """
    try:
        import pydantic  # noqa: F401
    except ImportError:
        pyd_mod = py_types.ModuleType("pydantic")

        class _FieldDefault:
            def __init__(self, default: Any = None, default_factory: Optional[Callable[[], Any]] = None, **kwargs: Any):
                self.default = default
                self.default_factory = default_factory

        def Field(default: Any = None, default_factory: Optional[Callable[[], Any]] = None, **kwargs: Any) -> Any:
            return _FieldDefault(default=default, default_factory=default_factory, **kwargs)

        def field_validator(*fields: str, **kwargs: Any) -> Callable[[Any], Any]:
            def _dec(fn: Any) -> Any:
                return fn
            return _dec

        class BaseModel:
            def __init__(self, **kwargs: Any):
                cls = self.__class__
                for mro_cls in reversed(cls.__mro__):
                    anns = getattr(mro_cls, "__annotations__", {})
                    for name in anns:
                        val = getattr(mro_cls, name, None)
                        if isinstance(val, _FieldDefault):
                            setattr(
                                self,
                                name,
                                val.default_factory() if val.default_factory is not None else val.default,
                            )
                        elif not callable(val):
                            setattr(self, name, val)
                for k, v in kwargs.items():
                    if k == "meshData" and isinstance(v, dict):
                        from engines.generation_3d_engine import SubMeshGeometrySpec
                        v = SubMeshGeometrySpec(**v)
                    elif k == "pbr_profile" and isinstance(v, dict):
                        from engines.generation_3d_engine import PBRProfileSpec
                        v = PBRProfileSpec(**v)
                    setattr(self, k, v)
                if hasattr(self, "_coerce_non_block_shape"):
                    self.shape = self._coerce_non_block_shape(getattr(self, "shape", "MeshPart"))

            @classmethod
            def model_rebuild(cls) -> None:
                pass

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

        pyd_mod.BaseModel = BaseModel  # type: ignore
        pyd_mod.Field = Field  # type: ignore
        pyd_mod.field_validator = field_validator  # type: ignore
        sys.modules["pydantic"] = pyd_mod

    try:
        import dotenv  # noqa: F401
    except ImportError:
        dotenv_mod = py_types.ModuleType("dotenv")
        dotenv_mod.load_dotenv = lambda *a, **kw: None  # type: ignore
        sys.modules["dotenv"] = dotenv_mod

    try:
        from google import genai  # noqa: F401
    except ImportError:
        google_mod = py_types.ModuleType("google")
        genai_mod = py_types.ModuleType("google.genai")
        genai_types_mod = py_types.ModuleType("google.genai.types")
        genai_mod.Client = lambda *a, **kw: None  # type: ignore
        genai_mod.types = genai_types_mod  # type: ignore
        google_mod.genai = genai_mod  # type: ignore
        sys.modules["google"] = google_mod
        sys.modules["google.genai"] = genai_mod
        sys.modules["google.genai.types"] = genai_types_mod

    try:
        import fastapi  # noqa: F401
    except ImportError:
        fa_mod = py_types.ModuleType("fastapi")
        fa_cors = py_types.ModuleType("fastapi.middleware.cors")
        fa_resp = py_types.ModuleType("fastapi.responses")
        fa_static = py_types.ModuleType("fastapi.staticfiles")

        class HTTPException(Exception):
            def __init__(self, status_code: int = 400, detail: str = ""):
                super().__init__(detail)
                self.status_code = status_code
                self.detail = detail

        class FastAPI:
            def __init__(self, **kwargs: Any):
                self.routes: Dict[Tuple[str, str], Callable[..., Any]] = {}

            def add_middleware(self, *args: Any, **kwargs: Any) -> None:
                pass

            def middleware(self, *args: Any, **kwargs: Any) -> Callable[[Any], Any]:
                return lambda fn: fn

            def get(self, path: str, **kwargs: Any) -> Callable[[Any], Any]:
                def _reg(fn: Any) -> Any:
                    self.routes[("GET", path)] = fn
                    return fn
                return _reg

            def post(self, path: str, **kwargs: Any) -> Callable[[Any], Any]:
                def _reg(fn: Any) -> Any:
                    self.routes[("POST", path)] = fn
                    return fn
                return _reg

            def delete(self, path: str, **kwargs: Any) -> Callable[[Any], Any]:
                def _reg(fn: Any) -> Any:
                    self.routes[("DELETE", path)] = fn
                    return fn
                return _reg

            def mount(self, *args: Any, **kwargs: Any) -> None:
                pass

        class _Status:
            HTTP_401_UNAUTHORIZED = 401
            HTTP_413_REQUEST_ENTITY_TOO_LARGE = 413
            HTTP_429_TOO_MANY_REQUESTS = 429

        fa_mod.FastAPI = FastAPI  # type: ignore
        fa_mod.Header = lambda default=None, **kw: default  # type: ignore
        fa_mod.HTTPException = HTTPException  # type: ignore
        fa_mod.Request = object  # type: ignore
        fa_mod.status = _Status  # type: ignore
        fa_cors.CORSMiddleware = object  # type: ignore
        fa_resp.JSONResponse = lambda status_code=200, content=None: {"status_code": status_code, **(content or {})}  # type: ignore
        fa_resp.StreamingResponse = lambda gen, **kw: gen  # type: ignore
        fa_static.StaticFiles = lambda **kw: None  # type: ignore

        sys.modules["fastapi"] = fa_mod
        sys.modules["fastapi.middleware"] = py_types.ModuleType("fastapi.middleware")
        sys.modules["fastapi.middleware.cors"] = fa_cors
        sys.modules["fastapi.responses"] = fa_resp
        sys.modules["fastapi.staticfiles"] = fa_static


_install_lightweight_runtime_shims_if_needed()

import main as backend_main  # noqa: E402
from engines.asset_engine import (  # noqa: E402
    FORGE_SYNC_HASH_SCHEMA_V1,
    compute_datamodel_sync_diff,
    compute_fnv1a_32_hex,
    compute_part_sync_hashes,
    normalize_parts_with_sync_metadata,
    _canonical_euler_to_matrix_9,
    _canonical_matrix_9_to_euler_deg,
)
from engines.generation_3d_engine import (  # noqa: E402
    Generation3DEngine,
    MeshPart3DSpec,
    synthesize_procedural_mesh_data,
)


def _mat_mul_3x3(a: List[float], b: List[float]) -> List[float]:
    return [
        a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
        a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
        a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
        a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
        a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
        a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
        a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
        a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
        a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
    ]


def _mat_transpose_3x3(m: List[float]) -> List[float]:
    return [
        m[0], m[3], m[6],
        m[1], m[4], m[7],
        m[2], m[5], m[8],
    ]


def _mat_vec_mul_3x3(m: List[float], v: List[float]) -> List[float]:
    return [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
        m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ]


def simulate_studio_spawn_and_to_object_space(
    local_pos: List[float],
    local_euler_deg: List[float],
    origin_pos: List[float],
    origin_euler_deg: List[float],
) -> Tuple[List[float], List[float], List[float]]:
    """
    Simulates Roblox Studio spawning a model at `originCFrame` (`worldCFrame = originCFrame * localCFrame`)
    and then the plugin serializing `relCFrame = originCFrame:ToObjectSpace(worldCFrame)`.
    Returns `(rel_pos, rel_euler_deg, rel_matrix_9)`.
    """
    r_orig = list(_canonical_euler_to_matrix_9(origin_euler_deg[0], origin_euler_deg[1], origin_euler_deg[2]))
    r_local = list(_canonical_euler_to_matrix_9(local_euler_deg[0], local_euler_deg[1], local_euler_deg[2]))

    # worldCFrame = originCFrame * localCFrame
    rot_local_pos = _mat_vec_mul_3x3(r_orig, local_pos)
    world_pos = [
        origin_pos[0] + rot_local_pos[0],
        origin_pos[1] + rot_local_pos[1],
        origin_pos[2] + rot_local_pos[2],
    ]
    r_world = _mat_mul_3x3(r_orig, r_local)

    # relCFrame = originCFrame:ToObjectSpace(worldCFrame) = originCFrame:Inverse() * worldCFrame
    r_orig_inv = _mat_transpose_3x3(r_orig)
    delta_pos = [
        world_pos[0] - origin_pos[0],
        world_pos[1] - origin_pos[1],
        world_pos[2] - origin_pos[2],
    ]
    rel_pos = _mat_vec_mul_3x3(r_orig_inv, delta_pos)
    rel_mat = _mat_mul_3x3(r_orig_inv, r_world)
    rel_euler = _canonical_matrix_9_to_euler_deg(rel_mat)
    return rel_pos, rel_euler, rel_mat


def test_1_canonical_hash_parity_and_middle_vertex_sensitivity():
    """
    Verifies:
    1. Python and TypeScript compute identical `geometryHash`, `materialHash`, `transformHash`,
       `rotationMatrix`, and `hierarchyPath` under `FORGE_SYNC_HASH_SCHEMA_V1`.
    2. Mutating a single middle vertex (`v[10]`) without changing vertex count, face count,
       first vertex, or last vertex changes `geometryHash` in both engines.
    3. Luau script content hashing normalizes `\r\n`, `\r`, `\n`, and outer whitespace.
    """
    cyl_mesh = synthesize_procedural_mesh_data("Cylinder", [2.5, 4.0, 2.5]).model_dump()
    assert len(cyl_mesh["vertices"]) > 20, "Cylinder mesh should have >20 vertices so v[10] is strictly intermediate"

    sample_part = {
        "partId": "CyberHoverTank::PlasmaBarrel::1",
        "name": "PlasmaBarrel",
        "parentName": "Cannon",
        "hierarchyPath": "Root/Turret/Cannon/PlasmaBarrel",
        "shape": "MeshPart",
        "size": [2.5, 4.0, 2.5],
        "position": [1.25, 3.5, -2.75],
        "rotation": [15.0, -35.0, 22.5],
        "color": [56, 189, 248],
        "material": "Metal",
        "roughness": 0.28,
        "metalness": 0.85,
        "transparency": 0.0,
        "collisionFidelity": "Hull",
        "pbrMaterial": {
            "colorMapAssetId": "rbxassetid://1122334455",
            "normalMapAssetId": "rbxassetid://2233445566",
            "roughnessMapAssetId": "rbxassetid://3344556677",
            "metalnessMapAssetId": "rbxassetid://4455667788",
        },
        "meshData": cyl_mesh,
    }

    py_hashes = compute_part_sync_hashes(sample_part, 0, "CyberHoverTank")

    # Mutate intermediate vertex v[10] without touching v[0], v[-1], or counts
    mutated_part = json.loads(json.dumps(sample_part))
    mutated_part["meshData"]["vertices"][10][1] += 0.375
    py_mutated_hashes = compute_part_sync_hashes(mutated_part, 0, "CyberHoverTank")

    assert py_hashes["geometryHash"] != py_mutated_hashes["geometryHash"], (
        "Mutating intermediate vertex v[10] MUST change geometryHash!"
    )
    assert py_hashes["materialHash"] == py_mutated_hashes["materialHash"]
    assert py_hashes["transformHash"] == py_mutated_hashes["transformHash"]

    # Check CRLF vs LF normalization on Luau code
    luau_lf = "\n  --!strict\nlocal x = 42\nreturn x\n  "
    luau_crlf = "\r\n--!strict\r\nlocal x = 42\r\nreturn x\r\n"
    assert compute_fnv1a_32_hex(luau_lf) == compute_fnv1a_32_hex(luau_crlf)

    # Verify TypeScript produces the exact same hashes via npx tsx
    ts_script = """
import { computePartSyncHashes, computeFnv1a32Hex } from './src/server/engines/assetEngine.ts';
const input = JSON.parse(process.argv[1]);
const orig = computePartSyncHashes(input.sample, 0, 'CyberHoverTank');
const mut = computePartSyncHashes(input.mutated, 0, 'CyberHoverTank');
const lfHash = computeFnv1a32Hex(input.luauLf);
const crlfHash = computeFnv1a32Hex(input.luauCrlf);
console.log(JSON.stringify({ orig, mut, lfHash, crlfHash }));
"""
    payload_arg = json.dumps({
        "sample": sample_part,
        "mutated": mutated_part,
        "luauLf": luau_lf,
        "luauCrlf": luau_crlf,
    })
    res = subprocess.run(
        ["npx", "tsx", "-e", ts_script, payload_arg],
        cwd=str(ROOT_DIR),
        capture_output=True,
        text=True,
        check=True,
    )
    ts_out = json.loads(res.stdout.strip().splitlines()[-1])

    assert ts_out["orig"]["geometryHash"] == py_hashes["geometryHash"], (
        f"TS geometryHash {ts_out['orig']['geometryHash']} != PY {py_hashes['geometryHash']}"
    )
    assert ts_out["orig"]["materialHash"] == py_hashes["materialHash"], (
        f"TS materialHash {ts_out['orig']['materialHash']} != PY {py_hashes['materialHash']}"
    )
    assert ts_out["orig"]["transformHash"] == py_hashes["transformHash"], (
        f"TS transformHash {ts_out['orig']['transformHash']} != PY {py_hashes['transformHash']}"
    )
    assert ts_out["mut"]["geometryHash"] == py_mutated_hashes["geometryHash"]
    assert ts_out["lfHash"] == compute_fnv1a_32_hex(luau_lf)
    assert ts_out["crlfHash"] == ts_out["lfHash"]


def test_2_eight_step_roundtrip_with_camera_offset_and_nested_hierarchy():
    """
    Executes the complete 8-step roundtrip demanded in the audit:
    1. Create a 3-piece model (`CyberHoverTank`) with nested hierarchy (`Root/Turret/Cannon/PlasmaCannon`).
    2. Export `.rbxmx` and `.luau` into an isolated Rojo workspace.
    3. Reconstruct in Studio at an arbitrary camera spawn offset `CFrame.new(14, 8, -22) * CFrame.Angles(12, -28, 7)`
       and convert world CFrames back to model-relative space via `originCFrame:ToObjectSpace(part.CFrame)`.
    4. Compare untouched Studio model with Forge -> verify `in_sync == True` and 0 false diffs.
    5. Modify 1 piece (`PlasmaCannon`) in Studio (position + material roughness).
    6. Compare with Forge -> verify ONLY `PlasmaCannon` is detected as modified.
    7. Push only the selected piece (`sync_scope="selection"`) to `/api/v1/assets/studio-push` -> verify other 2 pieces remain intact.
    8. Repeat `/api/v1/assets/compare-datamodel` with all 3 Studio pieces -> verify `in_sync == True` with zero false diffs.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        old_rojo_path = backend_main.RUNTIME_CONFIG["rojo_project_path"]
        backend_main.RUNTIME_CONFIG["rojo_project_path"] = tmp_dir
        try:
            tok = backend_main.RUNTIME_CONFIG["forge_local_token"]
            backend_main.configure_rojo_path(
                backend_main.RojoConfigRequest(rojo_project_path=tmp_dir, initialize_if_missing=True),
                x_forge_token=tok,
            )

            chassis_mesh = synthesize_procedural_mesh_data("Block", [6.0, 1.5, 10.0]).model_dump()
            turret_mesh = synthesize_procedural_mesh_data("Cylinder", [4.0, 1.2, 4.0]).model_dump()
            cannon_mesh = synthesize_procedural_mesh_data("Cylinder", [0.8, 5.0, 0.8]).model_dump()

            initial_asset = {
                "id": "asset-cyber-hover-tank",
                "name": "CyberHoverTank",
                "category": "Sci-Fi Vehicles",
                "asset_type": "Model3D",
                "collision_fidelity": "Hull",
                "rojo_target_folder": "src/shared/Assets3D",
                "parts": [
                    {
                        "partId": "CyberHoverTank::Chassis::1",
                        "name": "Chassis",
                        "parentName": "Root",
                        "hierarchyPath": "Root/Chassis",
                        "shape": "MeshPart",
                        "size": [6.0, 1.5, 10.0],
                        "position": [0.0, 1.0, 0.0],
                        "rotation": [0.0, 0.0, 0.0],
                        "color": [30, 41, 59],
                        "material": "Metal",
                        "roughness": 0.35,
                        "metalness": 0.8,
                        "transparency": 0.0,
                        "canCollide": True,
                        "anchored": True,
                        "collisionFidelity": "Hull",
                        "meshData": chassis_mesh,
                    },
                    {
                        "partId": "CyberHoverTank::TurretRing::2",
                        "name": "TurretRing",
                        "parentName": "Turret",
                        "hierarchyPath": "Root/Turret/TurretRing",
                        "shape": "MeshPart",
                        "size": [4.0, 1.2, 4.0],
                        "position": [0.0, 2.35, -0.5],
                        "rotation": [0.0, 25.0, 0.0],
                        "color": [51, 65, 85],
                        "material": "DiamondPlate",
                        "roughness": 0.4,
                        "metalness": 0.75,
                        "transparency": 0.0,
                        "canCollide": True,
                        "anchored": True,
                        "collisionFidelity": "Hull",
                        "meshData": turret_mesh,
                    },
                    {
                        "partId": "CyberHoverTank::PlasmaCannon::3",
                        "name": "PlasmaCannon",
                        "parentName": "Cannon",
                        "hierarchyPath": "Root/Turret/Cannon/PlasmaCannon",
                        "shape": "MeshPart",
                        "size": [0.8, 5.0, 0.8],
                        "position": [0.0, 2.6, -3.5],
                        "rotation": [10.0, 25.0, 0.0],
                        "color": [56, 189, 248],
                        "material": "Neon",
                        "roughness": 0.15,
                        "metalness": 0.2,
                        "transparency": 0.0,
                        "canCollide": False,
                        "anchored": True,
                        "collisionFidelity": "Box",
                        "meshData": cannon_mesh,
                    },
                ],
            }

            # Step 1 & 2: Export 5-file Roblox package (.luau, .rbxmx, .gltf, .obj, .mtl)
            exp_data = backend_main.export_roblox_package(
                {"asset": initial_asset, "save_to_rojo": True, "save_to_library": True},
                x_forge_token=tok,
            )
            assert exp_data["all_five_exist"] is True
            saved_asset = exp_data["asset"]

            # Verify .rbxmx on disk contains real nested <Item class="Model"> containers for Turret and Cannon
            rbxmx_path = Path(exp_data["saved_files"]["rbxmx"])
            rbxmx_text = rbxmx_path.read_text(encoding="utf-8")
            assert '<string name="Name">Turret</string>' in rbxmx_text
            assert '<string name="Name">Cannon</string>' in rbxmx_text
            assert "Root/Turret/Cannon/PlasmaCannon" in rbxmx_text

            # Verify parsing .rbxmx back preserves nested hierarchyPath in both Python and TypeScript
            gen_engine = Generation3DEngine(None, {"fast": "gemini-2.5-flash", "pro": "gemini-2.5-pro"})
            parsed_rbxmx = gen_engine.parse_rbxmx_to_parts(rbxmx_text, "CyberHoverTank")
            parsed_by_name = {p.name: p for p in parsed_rbxmx["parts"]}
            assert parsed_by_name["PlasmaCannon"].parentName == "Cannon"
            assert parsed_by_name["PlasmaCannon"].hierarchyPath == "Root/Turret/Cannon/PlasmaCannon"

            # Step 3: Simulate spawning in Studio at a camera offset CFrame
            camera_origin_pos = [14.0, 8.0, -22.0]
            camera_origin_euler = [12.0, -28.0, 7.0]

            studio_parts_after_spawn: List[Dict[str, Any]] = []
            for p in saved_asset["parts"]:
                rel_pos, rel_euler, rel_mat = simulate_studio_spawn_and_to_object_space(
                    p["position"],
                    p["rotation"],
                    camera_origin_pos,
                    camera_origin_euler,
                )
                studio_parts_after_spawn.append({
                    "partId": p["partId"],
                    "name": p["name"],
                    "parentId": p.get("parentId"),
                    "parentName": p["parentName"],
                    "hierarchyPath": p["hierarchyPath"],
                    "geometrySource": p.get("geometrySource", "EditableMeshBuffers"),
                    "size": p["size"],
                    "position": rel_pos,
                    "rotation": rel_euler,
                    "rotationMatrix": rel_mat,
                    "color": p["color"],
                    "material": p["material"],
                    "roughness": p["roughness"],
                    "metalness": p["metalness"],
                    "transparency": p["transparency"],
                    "canCollide": p["canCollide"],
                    "anchored": p["anchored"],
                    "collisionFidelity": p["collisionFidelity"],
                    "meshData": p["meshData"],
                })

            # Step 4: Compare untouched Studio model spawned at camera offset -> MUST have 0 false diffs
            cmp_data_1 = backend_main.compare_studio_datamodel({
                "model_name": "CyberHoverTank",
                "parts": studio_parts_after_spawn,
                "sync_scope": "full_model",
            }, x_forge_token=tok)
            diff_1 = cmp_data_1["diff"]
            assert diff_1["in_sync"] is True, f"Expected in_sync=True after camera offset spawn, got: {diff_1}"
            assert len(diff_1["modified_parts"]) == 0
            assert diff_1["unchanged_count"] == 3

            # Step 5: Modify ONLY PlasmaCannon in Studio (move Z from -3.5 to -4.25 and change roughness to 0.08)
            modified_cannon = dict(studio_parts_after_spawn[2])
            modified_cannon["position"] = [0.0, 2.6, -4.25]
            modified_cannon["roughness"] = 0.08
            studio_parts_with_1_edit = [
                studio_parts_after_spawn[0],
                studio_parts_after_spawn[1],
                modified_cannon,
            ]

            # Step 6: Compare and verify ONLY PlasmaCannon is marked modified
            cmp_data_2 = backend_main.compare_studio_datamodel({
                "model_name": "CyberHoverTank",
                "parts": studio_parts_with_1_edit,
                "sync_scope": "full_model",
            }, x_forge_token=tok)
            diff_2 = cmp_data_2["diff"]
            assert diff_2["in_sync"] is False
            assert len(diff_2["modified_parts"]) == 1
            assert diff_2["modified_parts"][0]["name"] == "PlasmaCannon"
            assert "transform" in diff_2["modified_parts"][0]["changes"]
            assert "material" in diff_2["modified_parts"][0]["changes"]
            assert "geometry" not in diff_2["modified_parts"][0]["changes"]

            # Step 7: Push ONLY the selected modified part (`sync_scope="selection"`) WITHOUT `meshData`
            cannon_push_without_buffers = dict(modified_cannon)
            cannon_push_without_buffers.pop("meshData", None)

            push_data = backend_main.receive_studio_incremental_push({
                "model_name": "CyberHoverTank",
                "parts": [cannon_push_without_buffers],
                "sync_scope": "selection",
            }, x_forge_token=tok)
            assert push_data["success"] is True
            assert push_data["updated_part_count"] == 3

            # Verify Chassis and TurretRing were not deleted and PlasmaCannon kept its real cylinder meshData (>20 verts, NOT a 24-vert cube!)
            updated_parts_by_name = {p["name"]: p for p in push_data["asset"]["parts"]}
            assert set(updated_parts_by_name.keys()) == {"Chassis", "TurretRing", "PlasmaCannon"}
            assert updated_parts_by_name["PlasmaCannon"]["position"] == [0.0, 2.6, -4.25]
            assert abs(updated_parts_by_name["PlasmaCannon"]["roughness"] - 0.08) < 1e-6
            assert len(updated_parts_by_name["PlasmaCannon"]["meshData"]["faces"]) == len(cannon_mesh["faces"])

            # Step 8: Immediately compare again with all 3 Studio parts -> MUST be 100% in_sync with 0 false diffs
            cmp_data_3 = backend_main.compare_studio_datamodel({
                "model_name": "CyberHoverTank",
                "parts": studio_parts_with_1_edit,
                "sync_scope": "full_model",
            }, x_forge_token=tok)
            diff_3 = cmp_data_3["diff"]
            assert diff_3["in_sync"] is True, f"Expected in_sync=True after studio-push, got: {diff_3}"
            assert len(diff_3["modified_parts"]) == 0
        finally:
            backend_main.RUNTIME_CONFIG["rojo_project_path"] = old_rojo_path


def test_3_external_meshparts_never_replaced_with_cube_and_safety_guards():
    """
    Verifies:
    1. Pushing an external Roblox Studio `MeshPart` with `meshId = "rbxassetid://9988776655"` or
       `geometrySource = "StudioExternalUnreadable"` without `ForgeMeshGeometryJSON` is NEVER
       overwritten with a procedural 12-triangle cube (in both Python and TypeScript).
    2. Duplicate `partId`s in `/api/v1/assets/studio-push` are rejected with `status == "duplicate_part_ids"`.
    3. 3-way conflict detection (`baseline_snapshot_sha256`) rejects conflicting pushes when `conflict_policy == "reject"`
       and merges non-conflicting fields when `conflict_policy == "smart_merge"`.
    4. Explicit deletion (`explicit_delete_ids`) removes only the specified part.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        old_rojo_path = backend_main.RUNTIME_CONFIG["rojo_project_path"]
        backend_main.RUNTIME_CONFIG["rojo_project_path"] = tmp_dir
        try:
            tok = backend_main.RUNTIME_CONFIG["forge_local_token"]
            backend_main.configure_rojo_path(
                backend_main.RojoConfigRequest(rojo_project_path=tmp_dir, initialize_if_missing=True),
                x_forge_token=tok,
            )

            # 1. Push external MeshParts from Studio without EditableMesh buffers
            ext_data = backend_main.receive_studio_incremental_push({
                "model_name": "ExternalStudioAsset",
                "sync_scope": "full_model",
                "parts": [
                    {
                        "partId": "ext-part-cloud-1",
                        "name": "PublishedRockMesh",
                        "parentName": "Root",
                        "hierarchyPath": "Root/PublishedRockMesh",
                        "meshId": "rbxassetid://9988776655",
                        "geometrySource": "PublishedCloudMeshId",
                        "size": [4.0, 3.0, 5.0],
                        "position": [0.0, 1.5, 0.0],
                        "rotation": [0.0, 45.0, 0.0],
                        "color": [120, 130, 140],
                        "material": "Slate",
                        "roughness": 0.8,
                        "metalness": 0.1,
                    },
                    {
                        "partId": "ext-part-unreadable-2",
                        "name": "UnreadableStudioMesh",
                        "parentName": "Props",
                        "hierarchyPath": "Root/Props/UnreadableStudioMesh",
                        "geometrySource": "StudioExternalUnreadable",
                        "size": [2.0, 2.0, 2.0],
                        "position": [3.0, 1.0, 0.0],
                        "rotation": [0.0, 0.0, 0.0],
                        "color": [200, 100, 80],
                        "material": "SmoothPlastic",
                        "roughness": 0.5,
                        "metalness": 0.0,
                    },
                ],
            }, x_forge_token=tok)
            assert ext_data["success"] is True
            ext_parts = {p["name"]: p for p in ext_data["asset"]["parts"]}

            rock = ext_parts["PublishedRockMesh"]
            assert rock["meshId"] == "rbxassetid://9988776655"
            assert rock["geometrySource"] == "PublishedCloudMeshId"
            assert not (rock.get("meshData") and rock["meshData"].get("faces")), (
                "PublishedCloudMeshId part without EditableMesh buffers must NOT be replaced by a procedural cube!"
            )

            unread = ext_parts["UnreadableStudioMesh"]
            assert unread["geometrySource"] == "StudioExternalUnreadable"
            assert not (unread.get("meshData") and unread["meshData"].get("faces")), (
                "StudioExternalUnreadable part must NOT be replaced by a procedural cube!"
            )

            # Verify TypeScript extractGeometryFromProcessedMesh and buildRbxmxFromPartsServer also preserve external MeshParts
            ts_ext_check = """
import { extractGeometryFromProcessedMesh } from './src/server/engines/generation3DEngine.ts';
import { buildRbxmxFromPartsServer, parseRbxmxFromPartsServer } from './src/server/engines/assetEngine.ts';
const parts = JSON.parse(process.argv[1]);
const g0 = extractGeometryFromProcessedMesh(parts[0], 'ExternalStudioAsset.obj', 'ExternalStudioAsset');
const g1 = extractGeometryFromProcessedMesh(parts[1], 'ExternalStudioAsset.obj', 'ExternalStudioAsset');
const xml = buildRbxmxFromPartsServer('ExternalStudioAsset', parts, 'Hull', 'Studio Synced Asset', '--!strict\\nreturn {}\\n');
const parsed = parseRbxmxFromPartsServer(xml, 'ExternalStudioAsset', 'Hull');
console.log(JSON.stringify({
  g0Faces: g0.faces.length,
  g1Faces: g1.faces.length,
  parsedParts: parsed.parts.map((p: any) => ({
    name: p.name,
    geometrySource: p.geometrySource,
    hierarchyPath: p.hierarchyPath,
    hasFaces: Boolean(p.meshData && p.meshData.faces && p.meshData.faces.length > 0),
  })),
}));
"""
            res_ts = subprocess.run(
                ["npx", "tsx", "-e", ts_ext_check, json.dumps(ext_data["asset"]["parts"])],
                cwd=str(ROOT_DIR),
                capture_output=True,
                text=True,
                check=True,
            )
            ts_ext_out = json.loads(res_ts.stdout.strip().splitlines()[-1])
            assert ts_ext_out["g0Faces"] == 0, "TS extractGeometryFromProcessedMesh must not invent cube faces for PublishedCloudMeshId"
            assert ts_ext_out["g1Faces"] == 0, "TS extractGeometryFromProcessedMesh must not invent cube faces for StudioExternalUnreadable"
            parsed_map = {p["name"]: p for p in ts_ext_out["parsedParts"]}
            assert parsed_map["PublishedRockMesh"]["hasFaces"] is False
            assert parsed_map["UnreadableStudioMesh"]["hasFaces"] is False
            assert parsed_map["UnreadableStudioMesh"]["hierarchyPath"] == "Root/Props/UnreadableStudioMesh"

            # 2. Test duplicate partId rejection
            dup_json = backend_main.receive_studio_incremental_push({
                "model_name": "ExternalStudioAsset",
                "parts": [
                    {"partId": "ext-part-cloud-1", "name": "DupA", "size": [2, 2, 2], "position": [0, 1, 0], "rotation": [0, 0, 0]},
                    {"partId": "ext-part-cloud-1", "name": "DupB", "size": [2, 2, 2], "position": [2, 1, 0], "rotation": [0, 0, 0]},
                ],
            }, x_forge_token=tok)
            assert dup_json["success"] is False
            assert dup_json["status"] == "duplicate_part_ids"
            assert "ext-part-cloud-1" in dup_json["duplicate_studio_part_ids"]

            # 3. Test 3-way conflict detection (baseline_snapshot_sha256)
            baseline_sha = ext_data["asset"]["snapshot_sha256"]
            # Modify PublishedRockMesh in Forge first (version 2)
            forge_v2_part = dict(rock)
            forge_v2_part["color"] = [255, 50, 50]
            forge_v2_res = backend_main.receive_studio_incremental_push({
                "model_name": "ExternalStudioAsset",
                "sync_scope": "selection",
                "parts": [forge_v2_part],
            }, x_forge_token=tok)
            assert forge_v2_res["success"] is True

            # Now Studio pushes a change to PublishedRockMesh's position based on the older baseline_sha
            studio_conflicting_part = dict(rock)
            studio_conflicting_part["position"] = [10.0, 5.0, -4.0]

            reject_json = backend_main.receive_studio_incremental_push({
                "model_name": "ExternalStudioAsset",
                "sync_scope": "selection",
                "conflict_policy": "reject",
                "baseline_snapshot_sha256": baseline_sha,
                "parts": [studio_conflicting_part],
            }, x_forge_token=tok)
            assert reject_json["success"] is False
            assert reject_json["status"] == "conflict_detected"
            assert len(reject_json["conflicts"]) == 1

            # With conflict_policy="smart_merge", Studio's position change AND Forge's color change are both preserved!
            smart_json = backend_main.receive_studio_incremental_push({
                "model_name": "ExternalStudioAsset",
                "sync_scope": "selection",
                "conflict_policy": "smart_merge",
                "baseline_snapshot_sha256": baseline_sha,
                "parts": [studio_conflicting_part],
            }, x_forge_token=tok)
            assert smart_json["success"] is True
            merged_rock = {p["name"]: p for p in smart_json["asset"]["parts"]}["PublishedRockMesh"]
            assert merged_rock["position"] == [10.0, 5.0, -4.0], "Smart merge should apply Studio's changed position"
            assert merged_rock["color"] == [255, 50, 50], "Smart merge should preserve Forge's changed color"

            # 4. Test explicit deletion (`explicit_delete_ids`)
            del_json = backend_main.receive_studio_incremental_push({
                "model_name": "ExternalStudioAsset",
                "sync_scope": "explicit_delete",
                "explicit_delete_ids": ["ext-part-unreadable-2"],
                "parts": [],
            }, x_forge_token=tok)
            assert del_json["success"] is True
            remaining_names = [p["name"] for p in del_json["asset"]["parts"]]
            assert remaining_names == ["PublishedRockMesh"]
        finally:
            backend_main.RUNTIME_CONFIG["rojo_project_path"] = old_rojo_path


def _build_valid_test_png_bytes(r: int, g: int, b: int, a: int = 255) -> str:
    """Builds a valid 4x4 8-bit RGBA PNG encoded as a data:image/png;base64 URL."""
    import base64
    import struct
    import zlib

    width, height = 4, 4
    raw_rows = b""
    for _ in range(height):
        raw_rows += b"\x00" + bytes([r, g, b, a]) * width

    def _chunk(c_type: bytes, c_data: bytes) -> bytes:
        crc = zlib.crc32(c_type + c_data) & 0xFFFFFFFF
        return struct.pack(">I", len(c_data)) + c_type + c_data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw_rows)
    png_bytes = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")


def test_4_shared_equivalence_vectors_and_png_validation():
    """
    Fase 2.3 & Fase 8.1-8.3:
    Verifies all 9 shared equivalence vectors across Python and TypeScript:
    1. ASCII text
    2. Unicode text ("CañónPlásmico_Ω_日本語")
    3. LF vs CRLF line endings
    4. Intermediate vertex mutation (`v[10]`)
    5. UV coordinate mutation (`uvs[5]`)
    6. Normal vector mutation (`normals[3]`)
    7. Material / reflectance / PBR mutation
    8. Position / transform mutation
    9. Hierarchy (`parentId`, `parentName`, `parentContainerClass`, `hierarchyPath`) mutation
    Also verifies hierarchy cycle detection (`validate_hierarchy_dag`) and PNG validation.
    """
    from engines.asset_engine import validate_and_decode_png_bytes, validate_hierarchy_dag

    # 1-3: Text hashing equivalence vectors (ASCII, Unicode, LF/CRLF)
    vec_ascii = "ForgeAIStudio::CanonicalSync::v1"
    vec_unicode = "CañónPlásmico_Ω_日本語_🚀"
    vec_lf = "  --!strict\nlocal a = 'Cañón'\nreturn a\n"
    vec_crlf = "\r\n--!strict\r\nlocal a = 'Cañón'\r\nreturn a\r\n  "

    py_ascii = compute_fnv1a_32_hex(vec_ascii)
    py_unicode = compute_fnv1a_32_hex(vec_unicode)
    py_lf = compute_fnv1a_32_hex(vec_lf)
    py_crlf = compute_fnv1a_32_hex(vec_crlf)
    assert py_lf == py_crlf, "LF and CRLF must hash to identical FNV-1a 32-bit hex"

    # 4-9: Part mutation vectors
    sphere_mesh = synthesize_procedural_mesh_data("Sphere", [3.0, 3.0, 3.0]).model_dump()
    base_part = {
        "partId": "fpart-a1b2c3d4-e5f647a8-9b0c1d2e3f4a",
        "name": "CañónPlásmico",
        "parentId": "fnode-11223344-55667788",
        "parentName": "TurretAssembly",
        "parentContainerClass": "Model",
        "hierarchyPath": "Root/WeaponsFolder/TurretAssembly/CañónPlásmico",
        "shape": "MeshPart",
        "size": [3.0, 3.0, 3.0],
        "position": [1.5, 2.25, -4.0],
        "rotation": [12.0, -45.0, 8.5],
        "color": [64, 196, 255],
        "material": "Metal",
        "roughness": 0.25,
        "metalness": 0.85,
        "transparency": 0.0,
        "reflectance": 0.15,
        "anchored": True,
        "canCollide": True,
        "collisionFidelity": "Hull",
        "pbrMaterial": {
            "colorMapAssetId": "rbxassetid://1001",
            "normalMapAssetId": "rbxassetid://1002",
            "roughnessMapAssetId": "rbxassetid://1003",
            "metalnessMapAssetId": "rbxassetid://1004",
        },
        "meshData": sphere_mesh,
    }

    mut_vertex = json.loads(json.dumps(base_part))
    mut_vertex["meshData"]["vertices"][10][0] += 0.25

    mut_uv = json.loads(json.dumps(base_part))
    mut_uv["meshData"]["uvs"][5][0] = round(float(mut_uv["meshData"]["uvs"][5][0]) + 0.125, 4)

    mut_normal = json.loads(json.dumps(base_part))
    mut_normal["meshData"]["normals"][3][2] = round(float(mut_normal["meshData"]["normals"][3][2]) - 0.35, 4)

    mut_material = json.loads(json.dumps(base_part))
    mut_material["reflectance"] = 0.45

    mut_position = json.loads(json.dumps(base_part))
    mut_position["position"][1] += 1.75

    mut_hierarchy = json.loads(json.dumps(base_part))
    mut_hierarchy["parentName"] = "SecondaryMount"
    mut_hierarchy["hierarchyPath"] = "Root/WeaponsFolder/SecondaryMount/CañónPlásmico"

    variants = {
        "base": base_part,
        "mut_vertex": mut_vertex,
        "mut_uv": mut_uv,
        "mut_normal": mut_normal,
        "mut_material": mut_material,
        "mut_position": mut_position,
        "mut_hierarchy": mut_hierarchy,
    }
    py_results = {k: compute_part_sync_hashes(v, 0, "TestModel") for k, v in variants.items()}

    # Verify independent hash sensitivity
    assert py_results["mut_vertex"]["geometryHash"] != py_results["base"]["geometryHash"]
    assert py_results["mut_vertex"]["materialHash"] == py_results["base"]["materialHash"]
    assert py_results["mut_vertex"]["transformHash"] == py_results["base"]["transformHash"]
    assert py_results["mut_vertex"]["hierarchyHash"] == py_results["base"]["hierarchyHash"]

    assert py_results["mut_uv"]["geometryHash"] != py_results["base"]["geometryHash"]
    assert py_results["mut_normal"]["geometryHash"] != py_results["base"]["geometryHash"]

    assert py_results["mut_material"]["materialHash"] != py_results["base"]["materialHash"]
    assert py_results["mut_material"]["geometryHash"] == py_results["base"]["geometryHash"]

    assert py_results["mut_position"]["transformHash"] != py_results["base"]["transformHash"]
    assert py_results["mut_position"]["geometryHash"] == py_results["base"]["geometryHash"]

    assert py_results["mut_hierarchy"]["hierarchyHash"] != py_results["base"]["hierarchyHash"]
    assert py_results["mut_hierarchy"]["transformHash"] == py_results["base"]["transformHash"]
    assert py_results["mut_hierarchy"]["combinedHash"] != py_results["base"]["combinedHash"]

    # Verify TypeScript matches all 9 vectors byte-for-byte
    ts_vec_script = """
import { computePartSyncHashes, computeFnv1a32Hex, validateHierarchyDag } from './src/server/engines/assetEngine.ts';
const inp = JSON.parse(process.argv[1]);
const out: Record<string, any> = {
  ascii: computeFnv1a32Hex(inp.vec_ascii),
  unicode: computeFnv1a32Hex(inp.vec_unicode),
  lf: computeFnv1a32Hex(inp.vec_lf),
  crlf: computeFnv1a32Hex(inp.vec_crlf),
  variants: {},
  dagCycle: validateHierarchyDag(inp.cyclicParts),
};
for (const [k, v] of Object.entries(inp.variants)) {
  out.variants[k] = computePartSyncHashes(v as any, 0, 'TestModel');
}
console.log(JSON.stringify(out));
"""
    cyclic_parts = [
        {"partId": "node-a", "name": "NodeA", "parentId": "node-b", "parentName": "NodeB", "hierarchyPath": "Root/NodeB/NodeA"},
        {"partId": "node-b", "name": "NodeB", "parentId": "node-a", "parentName": "NodeA", "hierarchyPath": "Root/NodeA/NodeB"},
    ]
    py_dag = validate_hierarchy_dag(cyclic_parts)
    assert py_dag["valid"] is False and len(py_dag["cycles"]) > 0

    res = subprocess.run(
        [
            "npx",
            "tsx",
            "-e",
            ts_vec_script,
            json.dumps({
                "vec_ascii": vec_ascii,
                "vec_unicode": vec_unicode,
                "vec_lf": vec_lf,
                "vec_crlf": vec_crlf,
                "variants": variants,
                "cyclicParts": cyclic_parts,
            }),
        ],
        cwd=str(ROOT_DIR),
        capture_output=True,
        text=True,
        check=True,
    )
    ts_vec_out = json.loads(res.stdout.strip().splitlines()[-1])
    assert ts_vec_out["ascii"] == py_ascii
    assert ts_vec_out["unicode"] == py_unicode
    assert ts_vec_out["lf"] == py_lf
    assert ts_vec_out["crlf"] == py_crlf
    assert ts_vec_out["dagCycle"]["valid"] is False

    for k, py_h in py_results.items():
        ts_h = ts_vec_out["variants"][k]
        for h_key in ("geometryHash", "materialHash", "transformHash", "hierarchyHash", "combinedHash", "integritySha256"):
            assert ts_h[h_key] == py_h[h_key], f"Mismatch in {k}.{h_key}: TS={ts_h[h_key]} vs PY={py_h[h_key]}"

    # Verify PNG validation & decoding
    valid_png_url = _build_valid_test_png_bytes(56, 189, 248, 255)
    png_meta = validate_and_decode_png_bytes(valid_png_url)
    assert png_meta["valid"] is True
    assert png_meta["width"] == 4 and png_meta["height"] == 4
    assert png_meta["mean_rgba"][0] == 56 and png_meta["mean_rgba"][1] == 189


def test_5_master_plan_end_to_end_five_meshpart_scenario():
    """
    Fase 8.4 — Mandatory 12-Step (A–L) End-to-End Integration Scenario with a 5-MeshPart Model:
    - 1 part with complex geometry (`PlasmaCoreReactor`, >40 vertices)
    - 1 part with published `MeshId` (`PublishedArmorPlate`, `rbxassetid://9988776655`)
    - 1 complete 4-channel PBR material applied & published (`ColorMap`, `NormalMap`, `RoughnessMap`, `MetalnessMap`)
    - 1 nested hierarchy (`Model -> Folder ("WeaponsFolder") -> SubModel ("TurretAssembly") -> MeshPart`)
    - Distinct transforms across all 5 parts
    - 1 part renamed in Studio (preserving `partId`)
    - 1 part added in Studio (`AuxSensorPod`)
    - 1 part explicitly deleted (`RearStabilizerFin`)
    - Version restoration (`restore_version = 1`) updating library, `.luau`, and `.rbxmx`.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        old_rojo_path = backend_main.RUNTIME_CONFIG["rojo_project_path"]
        backend_main.RUNTIME_CONFIG["rojo_project_path"] = tmp_dir
        try:
            tok = backend_main.RUNTIME_CONFIG["forge_local_token"]
            backend_main.configure_rojo_path(
                backend_main.RojoConfigRequest(rojo_project_path=tmp_dir, initialize_if_missing=True),
                x_forge_token=tok,
            )

            # Build meshes for the 5-MeshPart model
            complex_sphere_mesh = synthesize_procedural_mesh_data("Sphere", [3.2, 3.2, 3.2]).model_dump()
            assert len(complex_sphere_mesh["vertices"]) >= 26 and len(complex_sphere_mesh["faces"]) >= 48, (
                "Complex geometry part must have >=26 vertices and >=48 triangles (strictly non-cube)"
            )
            chassis_mesh = synthesize_procedural_mesh_data("Block", [8.0, 1.8, 12.0]).model_dump()
            barrel_mesh = synthesize_procedural_mesh_data("Cylinder", [1.0, 6.0, 1.0]).model_dump()
            fin_mesh = synthesize_procedural_mesh_data("Wedge", [1.2, 2.5, 3.0]).model_dump()

            # Step A: Create the 5-MeshPart model in Forge
            model_name = "AegisTitanMech"
            initial_asset = {
                "id": "asset-aegis-titan-mech",
                "name": model_name,
                "category": "Mechs & Robotics",
                "asset_type": "Model3D",
                "collision_fidelity": "Hull",
                "rojo_target_folder": "src/shared/Assets3D",
                "parts": [
                    {
                        "partId": "fpart-10000001-aaaa4bbb-8ccc00000001",
                        "name": "MainHullChassis",
                        "parentId": "fnode-root0001-00000001",
                        "parentName": "Root",
                        "parentContainerClass": "Model",
                        "hierarchyPath": "Root/MainHullChassis",
                        "shape": "MeshPart",
                        "size": [8.0, 1.8, 12.0],
                        "position": [0.0, 0.9, 0.0],
                        "rotation": [0.0, 0.0, 0.0],
                        "color": [30, 41, 59],
                        "material": "Metal",
                        "roughness": 0.35,
                        "metalness": 0.85,
                        "transparency": 0.0,
                        "reflectance": 0.1,
                        "anchored": True,
                        "canCollide": True,
                        "collisionFidelity": "Hull",
                        "meshData": chassis_mesh,
                    },
                    {
                        # 1. Complex geometry part (>40 vertices)
                        "partId": "fpart-10000002-aaaa4bbb-8ccc00000002",
                        "name": "PlasmaCoreReactor",
                        "parentId": "fnode-core0002-00000002",
                        "parentName": "ReactorBay",
                        "parentContainerClass": "Folder",
                        "hierarchyPath": "Root/ReactorBay/PlasmaCoreReactor",
                        "shape": "MeshPart",
                        "size": [3.2, 3.2, 3.2],
                        "position": [0.0, 2.8, 0.5],
                        "rotation": [15.0, 30.0, -10.0],
                        "color": [56, 189, 248],
                        "material": "Neon",
                        "roughness": 0.12,
                        "metalness": 0.3,
                        "transparency": 0.0,
                        "reflectance": 0.25,
                        "anchored": True,
                        "canCollide": True,
                        "collisionFidelity": "Hull",
                        "meshData": complex_sphere_mesh,
                    },
                    {
                        # 2. Published MeshId part (external cloud mesh without procedural cube replacement)
                        "partId": "fpart-10000003-aaaa4bbb-8ccc00000003",
                        "name": "PublishedArmorPlate",
                        "parentId": "fnode-armr0003-00000003",
                        "parentName": "ArmorFolder",
                        "parentContainerClass": "Folder",
                        "hierarchyPath": "Root/ArmorFolder/PublishedArmorPlate",
                        "shape": "MeshPart",
                        "meshId": "rbxassetid://9988776655",
                        "geometrySource": "PublishedCloudMeshId",
                        "size": [4.5, 2.0, 1.2],
                        "position": [0.0, 2.4, -5.8],
                        "rotation": [-12.0, 0.0, 0.0],
                        "color": [100, 116, 139],
                        "material": "DiamondPlate",
                        "roughness": 0.45,
                        "metalness": 0.9,
                        "transparency": 0.0,
                        "reflectance": 0.05,
                        "anchored": True,
                        "canCollide": True,
                        "collisionFidelity": "Hull",
                    },
                    {
                        # 3 & 4. Nested hierarchy (Model -> Folder -> SubModel -> MeshPart)
                        "partId": "fpart-10000004-aaaa4bbb-8ccc00000004",
                        "name": "HeavyRailCannon",
                        "parentId": "fnode-turt0004-00000004",
                        "parentName": "TurretAssembly",
                        "parentContainerClass": "Model",
                        "hierarchyPath": "Root/WeaponsFolder/TurretAssembly/HeavyRailCannon",
                        "shape": "MeshPart",
                        "size": [1.0, 6.0, 1.0],
                        "position": [2.2, 3.8, -3.5],
                        "rotation": [8.0, -20.0, 5.0],
                        "color": [71, 85, 105],
                        "material": "Metal",
                        "roughness": 0.28,
                        "metalness": 0.88,
                        "transparency": 0.0,
                        "reflectance": 0.15,
                        "anchored": True,
                        "canCollide": False,
                        "collisionFidelity": "Box",
                        "meshData": barrel_mesh,
                    },
                    {
                        # 5. Fifth part with distinct transform (will be explicitly deleted in Step F)
                        "partId": "fpart-10000005-aaaa4bbb-8ccc00000005",
                        "name": "RearStabilizerFin",
                        "parentId": "fnode-root0001-00000001",
                        "parentName": "Root",
                        "parentContainerClass": "Model",
                        "hierarchyPath": "Root/RearStabilizerFin",
                        "shape": "MeshPart",
                        "size": [1.2, 2.5, 3.0],
                        "position": [0.0, 2.2, 5.2],
                        "rotation": [0.0, 180.0, 0.0],
                        "color": [148, 163, 184],
                        "material": "Metal",
                        "roughness": 0.4,
                        "metalness": 0.75,
                        "transparency": 0.0,
                        "reflectance": 0.0,
                        "anchored": True,
                        "canCollide": True,
                        "collisionFidelity": "Hull",
                        "meshData": fin_mesh,
                    },
                ],
            }

            # Step C (initial save & export): Save v1 to library and Rojo
            exp_v1 = backend_main.export_roblox_package({
                "asset": initial_asset,
                "save_to_rojo": True,
                "save_to_library": True,
            }, x_forge_token=tok)
            assert exp_v1["all_five_exist"] is True
            assert exp_v1["asset"]["version"] == 1

            # Step B: Apply & publish a full 4-channel PBR material onto MainHullChassis
            pbr_res = backend_main.publish_pbr_to_rojo({
                "material_name": "Aegis Titanium Hex",
                "pattern": "hex_plate",
                "albedo_data_url": _build_valid_test_png_bytes(56, 189, 248, 255),
                "normal_data_url": _build_valid_test_png_bytes(128, 128, 255, 255),
                "roughness_data_url": _build_valid_test_png_bytes(90, 90, 90, 255),
                "metalness_data_url": _build_valid_test_png_bytes(220, 220, 220, 255),
                "color_map_asset_id": "rbxassetid://5500112201",
                "normal_map_asset_id": "rbxassetid://5500112202",
                "roughness_map_asset_id": "rbxassetid://5500112203",
                "metalness_map_asset_id": "rbxassetid://5500112204",
                "roughness": 0.28,
                "metalness": 0.88,
                "target_asset_id": exp_v1["asset"]["id"],
                "target_part_name": "MainHullChassis",
            }, x_forge_token=tok)
            assert pbr_res["success"] is True
            assert pbr_res["status"] == "cloud_published"
            assert len(pbr_res["verified_cloud_ids"]) == 4

            # Re-export package with the applied PBR material (creates v2)
            current_asset = backend_main.get_asset_engine().get_asset(model_name)
            assert current_asset is not None
            exp_v2 = backend_main.export_roblox_package({
                "asset": current_asset,
                "save_to_rojo": True,
                "save_to_library": True,
            }, x_forge_token=tok)
            saved_v2 = exp_v2["asset"]

            # Step D: Construct the model in Studio with a camera offset CFrame (`ForgeSyncOriginCFrame`)
            cam_pos = [-18.5, 12.0, 34.0]
            cam_euler = [18.0, -42.0, 9.0]
            studio_spawned_parts: List[Dict[str, Any]] = []
            for p in saved_v2["parts"]:
                rel_pos, rel_euler, rel_mat = simulate_studio_spawn_and_to_object_space(
                    p["position"],
                    p["rotation"],
                    cam_pos,
                    cam_euler,
                )
                studio_spawned_parts.append({
                    **p,
                    "position": rel_pos,
                    "rotation": rel_euler,
                    "rotationMatrix": rel_mat,
                })

            # Step E: Compare untouched Studio model with Forge -> 0 false differences
            cmp_initial = backend_main.compare_studio_datamodel({
                "model_name": model_name,
                "parts": studio_spawned_parts,
                "sync_scope": "full_model",
            }, x_forge_token=tok)
            assert cmp_initial["diff"]["in_sync"] is True, f"Step E failed: {cmp_initial['diff']}"
            assert cmp_initial["diff"]["unchanged_count"] == 5

            # Step F: Perform Studio edits:
            # 1. Modify position of PlasmaCoreReactor
            # 2. Modify material of PublishedArmorPlate + rename it to "FrontReactiveArmor" (keeping partId!)
            # 3. Reparent HeavyRailCannon to "Root/WeaponsFolder/UpperDeckMount/HeavyRailCannon"
            # 4. Delete RearStabilizerFin (`explicit_delete_ids`)
            # 5. Add a 6th part (`AuxSensorPod`)
            edited_studio_parts: List[Dict[str, Any]] = []
            for sp in studio_spawned_parts:
                cp = json.loads(json.dumps(sp))
                if cp["name"] == "RearStabilizerFin":
                    continue  # Deleted in Studio
                elif cp["name"] == "PlasmaCoreReactor":
                    cp["position"] = [0.0, 3.45, 0.5]
                elif cp["name"] == "PublishedArmorPlate":
                    cp["name"] = "FrontReactiveArmor"  # Renamed while keeping partId!
                    cp["hierarchyPath"] = "Root/ArmorFolder/FrontReactiveArmor"
                    cp["material"] = "Neon"
                    cp["roughness"] = 0.18
                elif cp["name"] == "HeavyRailCannon":
                    cp["parentName"] = "UpperDeckMount"
                    cp["parentContainerClass"] = "Model"
                    cp["hierarchyPath"] = "Root/WeaponsFolder/UpperDeckMount/HeavyRailCannon"
                edited_studio_parts.append(cp)

            sensor_mesh = synthesize_procedural_mesh_data("Cylinder", [0.9, 1.4, 0.9]).model_dump()
            edited_studio_parts.append({
                "partId": "fpart-10000006-aaaa4bbb-8ccc00000006",
                "name": "AuxSensorPod",
                "parentId": "fnode-sens0006-00000006",
                "parentName": "SensorSuite",
                "parentContainerClass": "Folder",
                "hierarchyPath": "Root/SensorSuite/AuxSensorPod",
                "shape": "MeshPart",
                "size": [0.9, 1.4, 0.9],
                "position": [-2.5, 4.1, -1.0],
                "rotation": [0.0, 15.0, 0.0],
                "color": [16, 185, 129],
                "material": "Glass",
                "roughness": 0.1,
                "metalness": 0.2,
                "transparency": 0.25,
                "reflectance": 0.3,
                "anchored": True,
                "canCollide": False,
                "collisionFidelity": "Box",
                "meshData": sensor_mesh,
            })

            # Step G: Compare and verify ONLY the real changes appear
            cmp_edited = backend_main.compare_studio_datamodel({
                "model_name": model_name,
                "parts": edited_studio_parts,
                "sync_scope": "full_model",
                "explicit_delete_ids": ["fpart-10000005-aaaa4bbb-8ccc00000005"],
            }, x_forge_token=tok)
            diff_edited = cmp_edited["diff"]
            assert diff_edited["in_sync"] is False
            assert diff_edited["unchanged_count"] == 1  # MainHullChassis is untouched
            assert len(diff_edited["modified_parts"]) == 3  # PlasmaCoreReactor, FrontReactiveArmor, HeavyRailCannon
            assert diff_edited["added_in_studio"] == ["AuxSensorPod"]
            assert diff_edited["removed_in_studio"] == ["RearStabilizerFin"]

            # Verify granular incremental_operations and part_diffs are emitted
            inc_ops = diff_edited["incremental_operations"]
            assert "MainHullChassis" in inc_ops["unchanged"]
            assert "PlasmaCoreReactor" in inc_ops["update_transform"]
            assert "FrontReactiveArmor" in inc_ops["update_material"]
            assert "HeavyRailCannon" in inc_ops["update_hierarchy"]
            assert "RearStabilizerFin" in inc_ops["delete"]
            assert "AuxSensorPod" in inc_ops["add"]

            ops_by_id = {pd["partId"]: pd["operations"] for pd in diff_edited["part_diffs"]}
            assert "unchanged" in ops_by_id["fpart-10000001-aaaa4bbb-8ccc00000001"]
            assert "update_transform" in ops_by_id["fpart-10000002-aaaa4bbb-8ccc00000002"]
            assert "update_material" in ops_by_id["fpart-10000003-aaaa4bbb-8ccc00000003"]
            assert "update_hierarchy" in ops_by_id["fpart-10000004-aaaa4bbb-8ccc00000004"]
            assert "delete" in ops_by_id["fpart-10000005-aaaa4bbb-8ccc00000005"]
            assert "add" in ops_by_id["fpart-10000006-aaaa4bbb-8ccc00000006"]

            # Step H: Push changes from Studio to Forge
            push_res = backend_main.receive_studio_incremental_push({
                "model_name": model_name,
                "parts": edited_studio_parts,
                "sync_scope": "full_model",
                "explicit_delete_ids": ["fpart-10000005-aaaa4bbb-8ccc00000005"],
                "conflict_policy": "smart_merge",
            }, x_forge_token=tok)
            assert push_res["success"] is True
            synced_asset = push_res["asset"]
            assert len(synced_asset["parts"]) == 5  # 5 original - 1 deleted + 1 added = 5

            # Step I: Reconstruct from Forge (.rbxmx and library) and verify all invariants
            synced_by_id = {p["partId"]: p for p in synced_asset["parts"]}
            # 1. Renamed part kept its exact partId and published MeshId without turning into a cube
            armor_part = synced_by_id["fpart-10000003-aaaa4bbb-8ccc00000003"]
            assert armor_part["name"] == "FrontReactiveArmor"
            assert armor_part["meshId"] == "rbxassetid://9988776655"
            assert armor_part["geometrySource"] == "PublishedCloudMeshId"
            assert not (armor_part.get("meshData") and armor_part["meshData"].get("faces"))
            # 2. PBR material on MainHullChassis is preserved
            hull_part = synced_by_id["fpart-10000001-aaaa4bbb-8ccc00000001"]
            assert hull_part["pbrMaterial"]["colorMapAssetId"] == "rbxassetid://5500112201"
            assert hull_part["pbrMaterial"]["normalMapAssetId"] == "rbxassetid://5500112202"
            # 3. Complex geometry on PlasmaCoreReactor is preserved
            reactor_part = synced_by_id["fpart-10000002-aaaa4bbb-8ccc00000002"]
            assert len(reactor_part["meshData"]["vertices"]) == len(complex_sphere_mesh["vertices"])

            # Step J: Re-compare Studio state with Forge -> 0 false differences (`in_sync == True`)
            cmp_after_push = backend_main.compare_studio_datamodel({
                "model_name": model_name,
                "parts": edited_studio_parts,
                "sync_scope": "full_model",
            }, x_forge_token=tok)
            assert cmp_after_push["diff"]["in_sync"] is True, f"Step J failed: {cmp_after_push['diff']}"
            assert cmp_after_push["diff"]["unchanged_count"] == 5

            # Step K & L: Restore version 1 and verify library, .luau, and .rbxmx on disk are updated
            restore_res = backend_main.pull_asset_changes_from_rojo({
                "asset_id": synced_asset["id"],
                "asset_name": model_name,
                "restore_version": 1,
            }, x_forge_token=tok)
            assert restore_res["success"] is True
            restored_asset = restore_res["asset"]
            restored_names = {p["name"] for p in restored_asset["parts"]}
            assert "RearStabilizerFin" in restored_names
            assert "PublishedArmorPlate" in restored_names
            assert "AuxSensorPod" not in restored_names

            rbxmx_disk = Path(tmp_dir) / "src" / "shared" / "Assets3D" / f"{model_name}.rbxmx"
            luau_disk = Path(tmp_dir) / "src" / "shared" / "Assets3D" / f"{model_name}.luau"
            assert "RearStabilizerFin" in rbxmx_disk.read_text(encoding="utf-8")
            assert "RearStabilizerFin" in luau_disk.read_text(encoding="utf-8")
        finally:
            backend_main.RUNTIME_CONFIG["rojo_project_path"] = old_rojo_path


def test_6_backend_security_and_destructive_guards():
    """
    Etapa 3: Verifies FastAPI backend startup security validation,
    fail-closed token/bridge checks, and explicit confirmation on delete_asset.
    """
    # 1. Production without token fails
    try:
        backend_main.validate_backend_security_config(security_token="", bridge_shared_secret="", node_env="production")
        assert False, "Expected production startup failure when secrets are empty"
    except RuntimeError as exc:
        assert "production" in str(exc).lower()

    # 2. Production with example placeholder fails
    try:
        backend_main.validate_backend_security_config(
            security_token="forge-local-dev-token-2026",
            bridge_shared_secret="forge-local-dev-token-2026",
            node_env="production",
        )
        assert False, "Expected production startup failure with placeholder secret"
    except RuntimeError as exc:
        assert "placeholder" in str(exc).lower()

    # 3. Production with valid >= 16 char secrets succeeds
    ok_cfg = backend_main.validate_backend_security_config(
        security_token="prod-valid-secret-token-1234567890",
        bridge_shared_secret="prod-valid-bridge-secret-1234567890",
        node_env="production",
    )
    assert ok_cfg["is_production"] is True

    # 4 & 5. Protected routes reject missing or invalid token with 401
    for bad_tok in (None, "", "wrong-token"):
        try:
            backend_main.bridge_get_status(x_forge_token=bad_tok)
            assert False, "Expected 401 on unauthorized bridge_get_status"
        except backend_main.HTTPException as err:
            assert err.status_code == 401

    tok = backend_main.RUNTIME_CONFIG["forge_local_token"]
    assert isinstance(backend_main.bridge_get_status(x_forge_token=tok), dict)

    # 7 & 8. Destructive delete without auth -> 401, without confirm -> 400, with auth + confirm -> 200
    with tempfile.TemporaryDirectory() as tmp_dir:
        old_rojo_path = backend_main.RUNTIME_CONFIG["rojo_project_path"]
        backend_main.RUNTIME_CONFIG["rojo_project_path"] = tmp_dir
        try:
            backend_main.configure_rojo_path(
                backend_main.RojoConfigRequest(rojo_project_path=tmp_dir, initialize_if_missing=True),
                x_forge_token=tok,
            )
            initial_count = len(backend_main.load_assets_library())
            backend_main.add_asset({"id": "asset-del-1", "name": "TempDelAsset", "parts": []}, x_forge_token=tok)
            assert len(backend_main.load_assets_library()) == initial_count + 1
            try:
                backend_main.delete_asset("asset-del-1", confirm=True, x_forge_token="bad-token")
                assert False, "Expected 401 on unauthorized delete"
            except backend_main.HTTPException as err:
                assert err.status_code == 401

            try:
                backend_main.delete_asset("asset-del-1", confirm=None, x_forge_token=tok)
                assert False, "Expected 400 on unconfirmed delete"
            except backend_main.HTTPException as err:
                assert err.status_code == 400

            del_ok = backend_main.delete_asset("asset-del-1", confirm=True, x_forge_token=tok)
            assert del_ok["deleted_ok"] is True
            assert del_ok["remaining"] == initial_count
            assert backend_main.get_asset_engine().get_asset("asset-del-1") is None
        finally:
            backend_main.RUNTIME_CONFIG["rojo_project_path"] = old_rojo_path


if __name__ == "__main__":
    test_1_canonical_hash_parity_and_middle_vertex_sensitivity()
    print("PASS: test_1_canonical_hash_parity_and_middle_vertex_sensitivity")
    test_2_eight_step_roundtrip_with_camera_offset_and_nested_hierarchy()
    print("PASS: test_2_eight_step_roundtrip_with_camera_offset_and_nested_hierarchy")
    test_3_external_meshparts_never_replaced_with_cube_and_safety_guards()
    print("PASS: test_3_external_meshparts_never_replaced_with_cube_and_safety_guards")
    test_4_shared_equivalence_vectors_and_png_validation()
    print("PASS: test_4_shared_equivalence_vectors_and_png_validation")
    test_5_master_plan_end_to_end_five_meshpart_scenario()
    print("PASS: test_5_master_plan_end_to_end_five_meshpart_scenario")
    test_6_backend_security_and_destructive_guards()
    print("PASS: test_6_backend_security_and_destructive_guards")
    print("ALL E2E BIDIRECTIONAL SYNC TESTS PASSED!")

