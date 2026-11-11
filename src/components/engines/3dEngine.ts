import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import {
  Forge3DAsset,
  MeshPart3DSpec,
  SubMeshGeometryData,
  generateEditableMeshLuauCode,
} from '../../utils/roblox3DEngine.ts';

export type RobloxCollisionFidelity =
  | 'Default'
  | 'Box'
  | 'Hull'
  | 'PreciseConvexDecomposition';

export type RobloxRenderFidelity = 'Automatic' | 'Precise' | 'Performance';

export type SupportedMeshFormat = 'GLB' | 'GLTF' | 'OBJ' | 'FBX';

export interface MeshPreprocessConfig {
  targetStudHeight?: number;
  maxTrianglesPerMeshPart?: number;
  decimationRatio?: number;
  collisionFidelity?: RobloxCollisionFidelity;
  renderFidelity?: RobloxRenderFidelity;
  doubleSided?: boolean;
  anchorBottomPivot?: boolean;
  autoSplitOversizedMeshes?: boolean;
  rojoTargetFolder?: string;
}

export interface VertexLimitValidationResult {
  isCompliant: boolean;
  totalVertices: number;
  maxVerticesInSingleMesh: number;
  maxAllowedVerticesPerMeshPart: number;
  exceedingMeshes: Array<{
    meshName: string;
    vertexCount: number;
    limit: number;
  }>;
  warnings: string[];
  errors: string[];
}

export interface TriangleCountValidationResult {
  isCompliant: boolean;
  totalTriangles: number;
  maxTrianglesInSingleMesh: number;
  maxAllowedTrianglesPerMeshPart: number;
  exceedingMeshes: Array<{
    meshName: string;
    triangleCount: number;
    limit: number;
  }>;
  zeroTriangleMeshes: string[];
  warnings: string[];
  errors: string[];
}

export interface TextureCoordinateValidationResult {
  hasCompleteUVs: boolean;
  totalMeshesChecked: number;
  meshesWithUVs: string[];
  meshesMissingUVs: string[];
  meshesWithInvalidUVs: string[];
  uvCoverageRatio: number;
  warnings: string[];
  errors: string[];
}

export interface SubMeshLimitDiagnostic {
  meshName: string;
  vertexCount: number;
  maxAllowedVertices: number;
  withinVertexLimit: boolean;
  triangleCount: number;
  maxAllowedTriangles: number;
  withinTriangleLimit: boolean;
  hasUVCoordinates: boolean;
  uvCount: number;
}

export interface MeshLimitsValidationResult {
  isCompliant: boolean;
  totalVertices: number;
  totalTriangles: number;
  subMeshCount: number;
  hasUVCoordinates: boolean;
  exceedsVertexLimit: boolean;
  exceedsTriangleLimit: boolean;
  subMeshDiagnostics: SubMeshLimitDiagnostic[];
  vertexValidation: VertexLimitValidationResult;
  triangleValidation: TriangleCountValidationResult;
  uvValidation: TextureCoordinateValidationResult;
  warnings: string[];
  errors: string[];
}

export interface MeshValidationReport {
  isValid: boolean;
  fileName: string;
  format: SupportedMeshFormat | 'UNKNOWN';
  fileSizeBytes: number;
  totalVertices: number;
  totalTriangles: number;
  subMeshCount: number;
  hasMissingNormals: boolean;
  hasMissingUVs: boolean;
  hasDegenerateBounds: boolean;
  exceedsRobloxSingleMeshLimit: boolean;
  exceedsRobloxVertexLimit: boolean;
  meshLimitsValidation?: MeshLimitsValidationResult;
  vertexValidation?: VertexLimitValidationResult;
  triangleValidation?: TriangleCountValidationResult;
  uvValidation?: TextureCoordinateValidationResult;
  warnings: string[];
  errors: string[];
}

export interface ProcessedSubMeshDescriptor {
  name: string;
  vertexCount: number;
  triangleCount: number;
  hasUVCoordinates: boolean;
  exceedsRobloxLimit: boolean;
  exceedsVertexLimit: boolean;
  studSize: [number, number, number];
  studPosition: [number, number, number];
  studRotation: [number, number, number];
  colorRgb: [number, number, number];
  robloxMaterial: string;
  roughness: number;
  metalness: number;
  collisionFidelity: RobloxCollisionFidelity;
  renderFidelity: RobloxRenderFidelity;
  doubleSided: boolean;
  objChunkPayload: string;
  meshData: SubMeshGeometryData;
}

export interface MeshPartExportPayload {
  modelName: string;
  sourceFormat: SupportedMeshFormat;
  totalVertices: number;
  totalTriangles: number;
  isRobloxCompliant: boolean;
  scaleFactorApplied: number;
  boundingBoxStuds: [number, number, number];
  subMeshParts: ProcessedSubMeshDescriptor[];
  combinedWavefrontObj: string;
  luauMeshPartBuilderCode: string;
  rojoTargetFolder: string;
  fileName: string;
  objFileName: string;
}

export interface BackendMeshPartSyncResponse {
  success: boolean;
  asset: Forge3DAsset;
  saved_path: string | null;
  obj_saved_path?: string | null;
  meshpart_count: number;
  total_triangles: number;
  is_roblox_compliant: boolean;
}

export interface FastAPI3DGenerationRequest {
  prompt: string;
  asset_type?: 'Model3D' | 'Scene3D' | 'PBRMaterial';
  category?: string;
  collision_fidelity?: RobloxCollisionFidelity;
  target_poly_budget?: number;
  reference_image_base64?: string | null;
  model_tier?: 'fast' | 'pro';
  save_to_rojo?: boolean;
}

export type ThreeDProcessingStage =
  | 'idle'
  | 'ingesting'
  | 'validating'
  | 'preprocessing'
  | 'converting_meshpart'
  | 'generating_3d'
  | 'rebuilding_luau'
  | 'fetching_library'
  | 'completed'
  | 'error';

export interface ThreeDEngineRequestState {
  isLoading: boolean;
  stage: ThreeDProcessingStage;
  activeEndpoint: string | null;
  progressMessage: string;
  error: string | null;
  statusCode: number | null;
  lastUpdatedAt: number;
}

export interface FastAPIRequestOptions {
  saveToRojo?: boolean;
  saveToLibrary?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStateChange?: (state: ThreeDEngineRequestState) => void;
  onStreamLog?: (message: string) => void;
}

/**
 * Structured error class for FastAPI 3D conversion and generation endpoints.
 */
export class FastAPIConversionError extends Error {
  public readonly statusCode: number;
  public readonly endpoint: string;
  public readonly detail: string;
  public readonly validationErrors: string[];

  constructor(
    message: string,
    statusCode: number,
    endpoint: string,
    detail?: string,
    validationErrors: string[] = []
  ) {
    super(message);
    this.name = 'FastAPIConversionError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    this.detail = detail || message;
    this.validationErrors = validationErrors;
  }
}

/**
 * Abstract base class for 3D geometry file parsers (.GLB, .GLTF, .OBJ, .FBX).
 */
export abstract class BaseMeshFormatParser {
  public abstract readonly supportedExtensions: string[];
  public abstract readonly formatName: SupportedMeshFormat;

  public abstract parseBuffer(
    buffer: ArrayBuffer,
    fileName: string
  ): Promise<THREE.Object3D>;

  /**
   * Ensures every Mesh in the hierarchy has valid buffered positions, normals, and UVs.
   */
  protected sanitizeLoadedHierarchy(root: THREE.Object3D): THREE.Object3D {
    let meshIndex = 1;
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (!mesh.name || mesh.name.trim() === '') {
          mesh.name = `MeshPart_${meshIndex}`;
        } else {
          mesh.name =
            mesh.name.replace(/[^a-zA-Z0-9_]/g, '_') || `MeshPart_${meshIndex}`;
        }
        meshIndex += 1;

        if (mesh.geometry) {
          if (!mesh.geometry.attributes.normal) {
            mesh.geometry.computeVertexNormals();
          }
          mesh.geometry.computeBoundingBox();
        }
      }
    });
    return root;
  }
}

/**
 * Parser for Khronos glTF 2.0 binary (.glb) and JSON (.gltf) assets.
 */
export class GLBMeshParser extends BaseMeshFormatParser {
  public readonly supportedExtensions = ['glb', 'gltf'];
  public readonly formatName: SupportedMeshFormat = 'GLB';
  private readonly loader = new GLTFLoader();

  public parseBuffer(
    buffer: ArrayBuffer,
    fileName: string
  ): Promise<THREE.Object3D> {
    return new Promise((resolve, reject) => {
      this.loader.parse(
        buffer,
        '',
        (gltf) => {
          const root = gltf.scene || new THREE.Group();
          root.name = fileName.replace(/\.[^/.]+$/, '');
          resolve(this.sanitizeLoadedHierarchy(root));
        },
        (err) => {
          reject(
            new Error(
              `Error al parsear archivo GLB/GLTF '${fileName}': ${
                err instanceof Error ? err.message : String(err)
              }`
            )
          );
        }
      );
    });
  }
}

/**
 * Parser for Wavefront (.obj) geometry files.
 */
export class OBJMeshParser extends BaseMeshFormatParser {
  public readonly supportedExtensions = ['obj'];
  public readonly formatName: SupportedMeshFormat = 'OBJ';
  private readonly loader = new OBJLoader();

  public async parseBuffer(
    buffer: ArrayBuffer,
    fileName: string
  ): Promise<THREE.Object3D> {
    const text = new TextDecoder('utf-8').decode(buffer);
    const group = this.loader.parse(text);
    group.name = fileName.replace(/\.[^/.]+$/, '');
    return this.sanitizeLoadedHierarchy(group);
  }
}

/**
 * Parser for Autodesk (.fbx) 3D assets.
 */
export class FBXMeshParser extends BaseMeshFormatParser {
  public readonly supportedExtensions = ['fbx'];
  public readonly formatName: SupportedMeshFormat = 'FBX';
  private readonly loader = new FBXLoader();

  public async parseBuffer(
    buffer: ArrayBuffer,
    fileName: string
  ): Promise<THREE.Object3D> {
    const group = this.loader.parse(buffer, '');
    group.name = fileName.replace(/\.[^/.]+$/, '');
    return this.sanitizeLoadedHierarchy(group);
  }
}

/**
 * Preprocessor that prepares Three.js Object3D hierarchies for Roblox Studio MeshParts:
 * 1. Normalizes scale to Roblox Studs and aligns bottom pivot to Y = 0.
 * 2. Performs real spatial vertex-clustering LOD decimation and auto-splits meshes > 10,000 tris.
 * 3. Extracts per-MeshPart vertex/normal/UV/face buffers, Wavefront .OBJ chunks, and
 *    a --!strict Luau EditableMesh + MeshPart builder.
 */
export class RobloxMeshPreprocessor {
  public static readonly ROBLOX_MAX_TRIANGLES_PER_MESHPART = 10000;
  public static readonly ROBLOX_MAX_VERTICES_PER_MESHPART = 20000;

  private readonly defaultConfig: Required<MeshPreprocessConfig> = {
    targetStudHeight: 6.0,
    maxTrianglesPerMeshPart:
      RobloxMeshPreprocessor.ROBLOX_MAX_TRIANGLES_PER_MESHPART,
    decimationRatio: 1.0,
    collisionFidelity: 'Hull',
    renderFidelity: 'Automatic',
    doubleSided: false,
    anchorBottomPivot: true,
    autoSplitOversizedMeshes: true,
    rojoTargetFolder: 'src/shared/Assets3D',
  };

  /**
   * Normalizes the Object3D to target Stud dimensions and grounds its lowest point at Y = 0.
   */
  public normalizeToRobloxStuds(
    root: THREE.Object3D,
    config?: MeshPreprocessConfig
  ): {
    normalizedRoot: THREE.Object3D;
    scaleFactorApplied: number;
    boundingBoxStuds: [number, number, number];
  } {
    const cfg = { ...this.defaultConfig, ...config };
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxAxis = Math.max(size.x, size.y, size.z, 0.001);
    const scaleFactor = cfg.targetStudHeight / maxAxis;
    root.scale.multiplyScalar(scaleFactor);
    root.updateMatrixWorld(true);

    const scaledBox = new THREE.Box3().setFromObject(root);
    const scaledCenter = new THREE.Vector3();
    const scaledSize = new THREE.Vector3();
    scaledBox.getCenter(scaledCenter);
    scaledBox.getSize(scaledSize);

    root.position.x -= scaledCenter.x;
    root.position.z -= scaledCenter.z;
    if (cfg.anchorBottomPivot) {
      root.position.y -= scaledBox.min.y;
    } else {
      root.position.y -= scaledCenter.y;
    }
    root.updateMatrixWorld(true);

    return {
      normalizedRoot: root,
      scaleFactorApplied: Number(scaleFactor.toFixed(4)),
      boundingBoxStuds: [
        Number(scaledSize.x.toFixed(2)),
        Number(scaledSize.y.toFixed(2)),
        Number(scaledSize.z.toFixed(2)),
      ],
    };
  }

  /**
   * Performs real geometric mesh decimation (LOD simplification) via spatial voxel
   * vertex clustering when `decimationRatio < 1.0`. Merges vertices within the same
   * spatial cell, discards degenerate triangles, and recomputes vertex normals.
   */
  public decimateGeometryReal(
    geometry: THREE.BufferGeometry,
    decimationRatio: number
  ): THREE.BufferGeometry {
    const ratio = Math.max(0.1, Math.min(1.0, decimationRatio));
    if (ratio >= 0.99) {
      return geometry;
    }

    const nonIndexed = geometry.index
      ? geometry.toNonIndexed()
      : geometry.clone();
    const posAttr = nonIndexed.getAttribute('position');
    if (!posAttr || posAttr.count < 12) {
      return geometry;
    }

    nonIndexed.computeBoundingBox();
    const bbox = nonIndexed.boundingBox || new THREE.Box3();
    const bSize = new THREE.Vector3();
    bbox.getSize(bSize);
    const maxDim = Math.max(bSize.x, bSize.y, bSize.z, 0.001);

    // Finer grid resolution for higher ratio, coarser grid for stronger decimation
    const gridCells = Math.max(6, Math.round(64 * Math.pow(ratio, 0.75)));
    const cellSize = maxDim / gridCells;

    const uvAttr = nonIndexed.getAttribute('uv');
    const clusterMap = new Map<
      string,
      {
        index: number;
        sumX: number;
        sumY: number;
        sumZ: number;
        sumU: number;
        sumV: number;
        count: number;
      }
    >();
    const vertexClusterIndices = new Int32Array(posAttr.count);

    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);
      const gx = Math.floor((vx - bbox.min.x) / cellSize);
      const gy = Math.floor((vy - bbox.min.y) / cellSize);
      const gz = Math.floor((vz - bbox.min.z) / cellSize);
      const key = `${gx}_${gy}_${gz}`;

      let cluster = clusterMap.get(key);
      if (!cluster) {
        cluster = {
          index: clusterMap.size,
          sumX: 0,
          sumY: 0,
          sumZ: 0,
          sumU: 0,
          sumV: 0,
          count: 0,
        };
        clusterMap.set(key, cluster);
      }
      cluster.sumX += vx;
      cluster.sumY += vy;
      cluster.sumZ += vz;
      if (uvAttr) {
        cluster.sumU += uvAttr.getX(i);
        cluster.sumV += uvAttr.getY(i);
      }
      cluster.count += 1;
      vertexClusterIndices[i] = cluster.index;
    }

    const clusteredVertices = new Float32Array(clusterMap.size * 3);
    const clusteredUVs = uvAttr ? new Float32Array(clusterMap.size * 2) : null;

    clusterMap.forEach((c) => {
      clusteredVertices[c.index * 3] = c.sumX / c.count;
      clusteredVertices[c.index * 3 + 1] = c.sumY / c.count;
      clusteredVertices[c.index * 3 + 2] = c.sumZ / c.count;
      if (clusteredUVs) {
        clusteredUVs[c.index * 2] = c.sumU / c.count;
        clusteredUVs[c.index * 2 + 1] = c.sumV / c.count;
      }
    });

    const survivingIndices: number[] = [];
    for (let i = 0; i < posAttr.count; i += 3) {
      const a = vertexClusterIndices[i];
      const b = vertexClusterIndices[i + 1];
      const c = vertexClusterIndices[i + 2];
      // Keep only non-degenerate triangles where all 3 clustered vertices are distinct
      if (a !== b && b !== c && a !== c) {
        survivingIndices.push(a, b, c);
      }
    }

    if (survivingIndices.length < 3) {
      return geometry;
    }

    const decimated = new THREE.BufferGeometry();
    decimated.setAttribute(
      'position',
      new THREE.BufferAttribute(clusteredVertices, 3)
    );
    if (clusteredUVs) {
      decimated.setAttribute('uv', new THREE.BufferAttribute(clusteredUVs, 2));
    }
    decimated.setIndex(survivingIndices);
    decimated.computeVertexNormals();
    decimated.computeBoundingBox();
    return decimated;
  }

  /**
   * Splits a BufferGeometry into sub-geometries if its triangle count exceeds Roblox's 10,000 limit
   * while preserving vertex positions, normals, and UV texture coordinates.
   */
  public splitOversizedGeometry(
    geometry: THREE.BufferGeometry,
    maxTriangles: number = RobloxMeshPreprocessor.ROBLOX_MAX_TRIANGLES_PER_MESHPART
  ): THREE.BufferGeometry[] {
    const nonIndexed = geometry.index
      ? geometry.toNonIndexed()
      : geometry.clone();
    const posAttr = nonIndexed.getAttribute('position');
    if (!posAttr) return [geometry];

    const totalTris = Math.floor(posAttr.count / 3);
    if (totalTris <= maxTriangles) {
      return [geometry];
    }

    const chunks: THREE.BufferGeometry[] = [];
    const trisPerChunk = Math.max(100, maxTriangles);
    const vertsPerChunk = trisPerChunk * 3;
    const normAttr = nonIndexed.getAttribute('normal');
    const uvAttr = nonIndexed.getAttribute('uv');

    for (
      let startVert = 0;
      startVert < posAttr.count;
      startVert += vertsPerChunk
    ) {
      const endVert = Math.min(startVert + vertsPerChunk, posAttr.count);
      const count = endVert - startVert;

      const subGeom = new THREE.BufferGeometry();
      const subPositions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        subPositions[i * 3] = posAttr.getX(startVert + i);
        subPositions[i * 3 + 1] = posAttr.getY(startVert + i);
        subPositions[i * 3 + 2] = posAttr.getZ(startVert + i);
      }
      subGeom.setAttribute(
        'position',
        new THREE.BufferAttribute(subPositions, 3)
      );

      if (normAttr) {
        const subNormals = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          subNormals[i * 3] = normAttr.getX(startVert + i);
          subNormals[i * 3 + 1] = normAttr.getY(startVert + i);
          subNormals[i * 3 + 2] = normAttr.getZ(startVert + i);
        }
        subGeom.setAttribute(
          'normal',
          new THREE.BufferAttribute(subNormals, 3)
        );
      } else {
        subGeom.computeVertexNormals();
      }

      if (uvAttr) {
        const subUVs = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
          subUVs[i * 2] = uvAttr.getX(startVert + i);
          subUVs[i * 2 + 1] = uvAttr.getY(startVert + i);
        }
        subGeom.setAttribute('uv', new THREE.BufferAttribute(subUVs, 2));
      }

      subGeom.computeBoundingBox();
      chunks.push(subGeom);
    }

    return chunks;
  }

  /**
   * Extracts real local-space vertex, normal, UV, and triangle face buffers
   * from a Mesh so its exact 3D topology is preserved in Three.js and Roblox EditableMesh.
   * Deduplicates corners by the composite key `(position, uv, normal)` so UV seams and
   * hard-edge normal splits from Blender `.OBJ` files remain separate vertices while
   * identical smooth corners share a single unified vertex index.
   */
  public extractSubMeshGeometryData(
    mesh: THREE.Mesh,
    partCenterWorld: THREE.Vector3
  ): SubMeshGeometryData {
    const geom = mesh.geometry;
    const posAttr = geom.getAttribute('position');
    if (!posAttr) {
      return { vertices: [], normals: [], uvs: [], faces: [] };
    }

    const normAttr = geom.getAttribute('normal');
    const uvAttr = geom.getAttribute('uv');
    const indexAttr = geom.getIndex();

    const rawVertices: Array<[number, number, number]> = [];
    const rawNormals: Array<[number, number, number]> = [];
    const rawUvs: Array<[number, number]> = [];

    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);

    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i)
        .applyMatrix4(mesh.matrixWorld)
        .sub(partCenterWorld);
      rawVertices.push([
        Number(v.x.toFixed(4)),
        Number(v.y.toFixed(4)),
        Number(v.z.toFixed(4)),
      ]);

      if (normAttr && i < normAttr.count) {
        n.fromBufferAttribute(normAttr, i)
          .applyNormalMatrix(normalMatrix)
          .normalize();
        rawNormals.push([
          Number(n.x.toFixed(4)),
          Number(n.y.toFixed(4)),
          Number(n.z.toFixed(4)),
        ]);
      } else {
        rawNormals.push([0, 1, 0]);
      }

      if (uvAttr && i < uvAttr.count) {
        rawUvs.push([
          Number(uvAttr.getX(i).toFixed(4)),
          Number(uvAttr.getY(i).toFixed(4)),
        ]);
      } else {
        rawUvs.push([0, 0]);
      }
    }

    const vertices: number[][] = [];
    const normals: number[][] = [];
    const uvs: number[][] = [];
    const faces: number[][] = [];
    const compositeCornerMap = new Map<string, number>();

    const getOrAddUnifiedCorner = (rawIdx: number): number => {
      const safeIdx = Math.max(0, Math.min(rawVertices.length - 1, rawIdx));
      const [px, py, pz] = rawVertices[safeIdx];
      const [u, vCoord] = rawUvs[safeIdx];
      const [nx, ny, nz] = rawNormals[safeIdx];
      const key = `${px},${py},${pz}|${u},${vCoord}|${nx},${ny},${nz}`;
      let unified = compositeCornerMap.get(key);
      if (unified === undefined) {
        unified = vertices.length;
        compositeCornerMap.set(key, unified);
        vertices.push([px, py, pz]);
        uvs.push([u, vCoord]);
        normals.push([nx, ny, nz]);
      }
      return unified;
    };

    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i += 3) {
        const i0 = getOrAddUnifiedCorner(indexAttr.getX(i));
        const i1 = getOrAddUnifiedCorner(indexAttr.getX(i + 1));
        const i2 = getOrAddUnifiedCorner(indexAttr.getX(i + 2));
        if (i0 !== i1 && i1 !== i2 && i0 !== i2) {
          faces.push([i0, i1, i2]);
        }
      }
    } else {
      for (let i = 0; i < posAttr.count; i += 3) {
        if (i + 2 < posAttr.count) {
          const i0 = getOrAddUnifiedCorner(i);
          const i1 = getOrAddUnifiedCorner(i + 1);
          const i2 = getOrAddUnifiedCorner(i + 2);
          if (i0 !== i1 && i1 !== i2 && i0 !== i2) {
            faces.push([i0, i1, i2]);
          }
        }
      }
    }

    return {
      vertices,
      normals,
      uvs,
      faces,
    };
  }

  /**
   * Serializes a single Mesh into a Wavefront .OBJ chunk in world/Stud coordinates,
   * including texture coordinates (vt) and vertex normals (vn) when present.
   */
  public serializeMeshToOBJChunk(
    mesh: THREE.Mesh,
    objectName: string
  ): string {
    const geom = mesh.geometry;
    const posAttr = geom?.getAttribute('position');
    if (!posAttr) return '';

    const uvAttr = geom.getAttribute('uv');
    const normAttr = geom.getAttribute('normal');
    let out = `o ${objectName}\n`;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);

    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
      out += `v ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}\n`;
    }

    const hasMatchingUVs = Boolean(uvAttr && uvAttr.count === posAttr.count);
    if (hasMatchingUVs && uvAttr) {
      for (let i = 0; i < uvAttr.count; i++) {
        out += `vt ${uvAttr.getX(i).toFixed(4)} ${uvAttr.getY(i).toFixed(4)}\n`;
      }
    }

    const hasMatchingNormals = Boolean(
      normAttr && normAttr.count === posAttr.count
    );
    if (hasMatchingNormals && normAttr) {
      for (let i = 0; i < normAttr.count; i++) {
        n.fromBufferAttribute(normAttr, i)
          .applyNormalMatrix(normalMatrix)
          .normalize();
        out += `vn ${n.x.toFixed(4)} ${n.y.toFixed(4)} ${n.z.toFixed(4)}\n`;
      }
    }

    const fmtIdx = (idx1Based: number): string => {
      if (hasMatchingUVs && hasMatchingNormals) {
        return `${idx1Based}/${idx1Based}/${idx1Based}`;
      }
      if (hasMatchingUVs) {
        return `${idx1Based}/${idx1Based}`;
      }
      if (hasMatchingNormals) {
        return `${idx1Based}//${idx1Based}`;
      }
      return `${idx1Based}`;
    };

    const indexAttr = geom.getIndex();
    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i += 3) {
        const a = indexAttr.getX(i) + 1;
        const b = indexAttr.getX(i + 1) + 1;
        const c = indexAttr.getX(i + 2) + 1;
        out += `f ${fmtIdx(a)} ${fmtIdx(b)} ${fmtIdx(c)}\n`;
      }
    } else {
      for (let i = 0; i < posAttr.count; i += 3) {
        out += `f ${fmtIdx(i + 1)} ${fmtIdx(i + 2)} ${fmtIdx(i + 3)}\n`;
      }
    }
    return out;
  }

  /**
   * Builds a complete --!strict Luau module that constructs real Roblox MeshParts
   * using AssetService:CreateEditableMesh() and AssetService:CreateMeshPartAsync(),
   * preserving real vertices, normals, UVs, triangles, CollisionFidelity, RenderFidelity,
   * and SurfaceAppearance.
   */
  public generateRobloxMeshPartLuau(
    modelName: string,
    subMeshes: ProcessedSubMeshDescriptor[]
  ): string {
    return generateEditableMeshLuauCode(
      modelName,
      subMeshes.map((sub) => ({
        name: sub.name,
        size: sub.studSize,
        position: sub.studPosition,
        rotation: sub.studRotation,
        color: sub.colorRgb,
        material: sub.robloxMaterial,
        roughness: sub.roughness,
        metalness: sub.metalness,
        collisionFidelity: sub.collisionFidelity,
        renderFidelity: sub.renderFidelity,
        doubleSided: sub.doubleSided,
        meshData: sub.meshData,
      }))
    );
  }

  /**
   * Executes the full preprocessing pipeline on a loaded Three.js Object3D:
   * - Normalizes scale to Roblox Studs
   * - Applies real geometric LOD decimation when decimationRatio < 1.0
   * - Splits meshes > 10,000 triangles
   * - Preserves real vertex/normal/UV/face buffers (`meshData`) and Wavefront .OBJ
   */
  public preprocessObject3D(
    root: THREE.Object3D,
    modelName: string,
    sourceFormat: SupportedMeshFormat,
    config?: MeshPreprocessConfig
  ): MeshPartExportPayload {
    const cfg = { ...this.defaultConfig, ...config };
    const { normalizedRoot, scaleFactorApplied, boundingBoxStuds } =
      this.normalizeToRobloxStuds(root, cfg);

    const subMeshParts: ProcessedSubMeshDescriptor[] = [];
    let totalVertices = 0;
    let totalTriangles = 0;
    const objChunks: string[] = [
      `# Forge AI Studio - Preprocessed Roblox MeshPart Assembly (${modelName})`,
      `# Source Format: ${sourceFormat} | CollisionFidelity: ${cfg.collisionFidelity}`,
      '',
    ];

    let partCounter = 1;
    const worldBox = new THREE.Box3();
    const partSize = new THREE.Vector3();
    const partCenter = new THREE.Vector3();

    normalizedRoot.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      if (!mesh.geometry) return;

      const mat = Array.isArray(mesh.material)
        ? mesh.material[0]
        : mesh.material;
      const stdMat = mat as THREE.MeshStandardMaterial | undefined;
      const color = stdMat?.color ? stdMat.color : new THREE.Color(0x94a3b8);
      const roughness =
        typeof stdMat?.roughness === 'number' ? stdMat.roughness : 0.35;
      const metalness =
        typeof stdMat?.metalness === 'number' ? stdMat.metalness : 0.65;

      // 1. Real geometric LOD decimation if decimationRatio < 1.0
      const lodGeometry =
        cfg.decimationRatio < 0.99
          ? this.decimateGeometryReal(mesh.geometry, cfg.decimationRatio)
          : mesh.geometry;

      // 2. Auto-split oversized meshes exceeding 10,000 triangles
      const geometries = cfg.autoSplitOversizedMeshes
        ? this.splitOversizedGeometry(lodGeometry, cfg.maxTrianglesPerMeshPart)
        : [lodGeometry];

      geometries.forEach((geom, chunkIdx) => {
        const posAttr = geom.getAttribute('position');
        if (!posAttr) return;

        const uvAttr = geom.getAttribute('uv');
        const hasUVCoordinates = Boolean(uvAttr && uvAttr.count > 0);
        const vCount = posAttr.count;
        const indexAttr = geom.getIndex();
        const triCount = indexAttr
          ? Math.floor(indexAttr.count / 3)
          : Math.floor(vCount / 3);

        const tempMesh = new THREE.Mesh(geom, mesh.material);
        tempMesh.matrixWorld.copy(mesh.matrixWorld);
        worldBox.setFromObject(tempMesh);
        worldBox.getSize(partSize);
        worldBox.getCenter(partCenter);

        const baseName = (mesh.name || `MeshPart_${partCounter}`).replace(
          /[^a-zA-Z0-9_]/g,
          '_'
        );
        const finalName =
          geometries.length > 1 ? `${baseName}_Split${chunkIdx + 1}` : baseName;
        partCounter += 1;

        const objChunk = this.serializeMeshToOBJChunk(tempMesh, finalName);
        objChunks.push(objChunk);

        // Extract real local-space vertices, normals, UVs, and faces relative to partCenter
        const meshData = this.extractSubMeshGeometryData(tempMesh, partCenter);

        const descriptor: ProcessedSubMeshDescriptor = {
          name: finalName,
          vertexCount: vCount,
          triangleCount: triCount,
          hasUVCoordinates,
          exceedsRobloxLimit:
            triCount >
            RobloxMeshPreprocessor.ROBLOX_MAX_TRIANGLES_PER_MESHPART,
          exceedsVertexLimit:
            vCount > RobloxMeshPreprocessor.ROBLOX_MAX_VERTICES_PER_MESHPART,
          studSize: [
            Math.max(0.2, Number(partSize.x.toFixed(2))),
            Math.max(0.2, Number(partSize.y.toFixed(2))),
            Math.max(0.2, Number(partSize.z.toFixed(2))),
          ],
          studPosition: [
            Number(partCenter.x.toFixed(2)),
            Number(partCenter.y.toFixed(2)),
            Number(partCenter.z.toFixed(2)),
          ],
          studRotation: [0, 0, 0], // World rotation baked into extracted vertex positions
          colorRgb: [
            Math.round(color.r * 255),
            Math.round(color.g * 255),
            Math.round(color.b * 255),
          ],
          robloxMaterial: metalness > 0.6 ? 'Metal' : 'SmoothPlastic',
          roughness: Number(roughness.toFixed(2)),
          metalness: Number(metalness.toFixed(2)),
          collisionFidelity: cfg.collisionFidelity,
          renderFidelity: cfg.renderFidelity,
          doubleSided: cfg.doubleSided,
          objChunkPayload: objChunk,
          meshData,
        };

        subMeshParts.push(descriptor);
        totalVertices += vCount;
        totalTriangles += triCount;
      });
    });

    const isRobloxCompliant = subMeshParts.every(
      (p) => !p.exceedsRobloxLimit && !p.exceedsVertexLimit
    );
    const cleanModelName =
      modelName.replace(/[^a-zA-Z0-9_]/g, '') || 'ImportedMesh3D';
    const luauMeshPartBuilderCode = this.generateRobloxMeshPartLuau(
      cleanModelName,
      subMeshParts
    );

    return {
      modelName: cleanModelName,
      sourceFormat,
      totalVertices,
      totalTriangles,
      isRobloxCompliant,
      scaleFactorApplied,
      boundingBoxStuds,
      subMeshParts,
      combinedWavefrontObj: objChunks.join('\n'),
      luauMeshPartBuilderCode,
      rojoTargetFolder: cfg.rojoTargetFolder,
      fileName: `${cleanModelName}_MeshPart.luau`,
      objFileName: `${cleanModelName}.obj`,
    };
  }
}

/**
 * ThreeDEngineProcessor:
 * Handles 3D file ingestion (GLB/GLTF/OBJ/FBX), validation of mesh structures against
 * Roblox Studio MeshPart standards (vertex limits, <10,000 triangle counts, and UV
 * texture coordinate presence), and provides async interface methods for calling the
 * FastAPI endpoints (/api/v1/assets/process-meshpart, /api/v1/generate-3d,
 * /api/v1/generate-3d-stream, /api/v1/assets/rebuild-luau, /api/v1/assets/publish-pbr)
 * that handle conversion to real Roblox MeshPart geometry.
 */
export class ThreeDEngineProcessor {
  public static readonly MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
  public static readonly DEFAULT_REQUEST_TIMEOUT_MS = 60000; // 60 seconds
  public static readonly ROBLOX_MAX_TRIANGLES_PER_MESHPART =
    RobloxMeshPreprocessor.ROBLOX_MAX_TRIANGLES_PER_MESHPART;
  public static readonly ROBLOX_MAX_VERTICES_PER_MESHPART =
    RobloxMeshPreprocessor.ROBLOX_MAX_VERTICES_PER_MESHPART;

  private readonly parsers: Map<string, BaseMeshFormatParser> = new Map();
  private readonly preprocessor: RobloxMeshPreprocessor;
  private defaultConfig: MeshPreprocessConfig = {};
  private requestState: ThreeDEngineRequestState = {
    isLoading: false,
    stage: 'idle',
    activeEndpoint: null,
    progressMessage: 'Listo para procesar geometría 3D.',
    error: null,
    statusCode: null,
    lastUpdatedAt: Date.now(),
  };
  private readonly stateListeners: Set<
    (state: ThreeDEngineRequestState) => void
  > = new Set();
  private activeAbortController: AbortController | null = null;

  constructor(preprocessorConfig?: MeshPreprocessConfig) {
    this.preprocessor = new RobloxMeshPreprocessor();
    const registeredParsers: BaseMeshFormatParser[] = [
      new GLBMeshParser(),
      new OBJMeshParser(),
      new FBXMeshParser(),
    ];

    for (const parser of registeredParsers) {
      for (const ext of parser.supportedExtensions) {
        this.parsers.set(ext.toLowerCase(), parser);
      }
    }
    if (preprocessorConfig) {
      this.defaultConfig = preprocessorConfig;
    }
  }

  public getRequestState(): ThreeDEngineRequestState {
    return { ...this.requestState };
  }

  public isLoading(): boolean {
    return this.requestState.isLoading;
  }

  public getLastError(): string | null {
    return this.requestState.error;
  }

  public clearError(): void {
    this.updateRequestState({
      isLoading: false,
      stage: 'idle',
      activeEndpoint: null,
      progressMessage: 'Estado de error limpiado.',
      error: null,
      statusCode: null,
    });
  }

  public subscribeToRequestState(
    listener: (state: ThreeDEngineRequestState) => void
  ): () => void {
    this.stateListeners.add(listener);
    listener(this.getRequestState());
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public cancelActiveRequest(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
      this.updateRequestState({
        isLoading: false,
        stage: 'error',
        activeEndpoint: null,
        progressMessage: 'Petición al backend FastAPI cancelada por el usuario.',
        error: 'Operación cancelada.',
        statusCode: 499,
      });
    }
  }

  private updateRequestState(
    patch: Partial<Omit<ThreeDEngineRequestState, 'lastUpdatedAt'>>,
    onStateChange?: (state: ThreeDEngineRequestState) => void
  ): ThreeDEngineRequestState {
    this.requestState = {
      ...this.requestState,
      ...patch,
      lastUpdatedAt: Date.now(),
    };
    const snapshot = this.getRequestState();
    this.stateListeners.forEach((listener) => listener(snapshot));
    if (onStateChange) {
      onStateChange(snapshot);
    }
    return snapshot;
  }

  private async parseFastAPIErrorResponse(
    response: Response,
    endpoint: string,
    fallbackMessage: string
  ): Promise<FastAPIConversionError> {
    let rawBody: Record<string, unknown> = {};
    try {
      rawBody = (await response.json()) as Record<string, unknown>;
    } catch {
      // Non-JSON response body
    }

    const validationErrors: string[] = [];
    let detailMessage = '';

    if (Array.isArray(rawBody.detail)) {
      for (const item of rawBody.detail) {
        if (item && typeof item === 'object') {
          const entry = item as { loc?: Array<string | number>; msg?: string };
          const locPath = Array.isArray(entry.loc)
            ? entry.loc.join('.')
            : 'body';
          const msg = entry.msg || 'Valor inválido';
          validationErrors.push(`${locPath}: ${msg}`);
        }
      }
      detailMessage = validationErrors.join(' | ');
    } else if (typeof rawBody.detail === 'string') {
      detailMessage = rawBody.detail;
    } else if (typeof rawBody.error === 'string') {
      detailMessage = rawBody.error;
    } else if (typeof rawBody.message === 'string') {
      detailMessage = rawBody.message;
    }

    const finalMessage =
      detailMessage ||
      `${fallbackMessage} (HTTP ${response.status} ${response.statusText || ''})`.trim();

    return new FastAPIConversionError(
      finalMessage,
      response.status,
      endpoint,
      detailMessage || finalMessage,
      validationErrors
    );
  }

  private async requestFastAPI<TResponse>(
    endpoint: string,
    method: 'GET' | 'POST',
    stage: ThreeDProcessingStage,
    progressMessage: string,
    body?: unknown,
    options: FastAPIRequestOptions = {}
  ): Promise<TResponse> {
    const timeoutMs =
      options.timeoutMs ?? ThreeDEngineProcessor.DEFAULT_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    this.activeAbortController = controller;

    const externalAbortHandler = () => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', externalAbortHandler, {
          once: true,
        });
      }
    }

    const timeoutId = globalThis.setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    this.updateRequestState(
      {
        isLoading: true,
        stage,
        activeEndpoint: endpoint,
        progressMessage,
        error: null,
        statusCode: null,
      },
      options.onStateChange
    );

    try {
      const response = await fetch(endpoint, {
        method,
        headers:
          method === 'POST'
            ? {
                'Content-Type': 'application/json',
                Accept: 'application/json',
              }
            : { Accept: 'application/json' },
        body:
          method === 'POST' && body !== undefined
            ? JSON.stringify(body)
            : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const apiError = await this.parseFastAPIErrorResponse(
          response,
          endpoint,
          `Error en el servicio FastAPI (${endpoint})`
        );
        this.updateRequestState(
          {
            isLoading: false,
            stage: 'error',
            activeEndpoint: endpoint,
            progressMessage: `Error en ${endpoint}: ${apiError.message}`,
            error: apiError.message,
            statusCode: apiError.statusCode,
          },
          options.onStateChange
        );
        throw apiError;
      }

      const data = (await response.json()) as TResponse;

      this.updateRequestState(
        {
          isLoading: false,
          stage: 'completed',
          activeEndpoint: null,
          progressMessage: `Operación completada exitosamente (${endpoint}).`,
          error: null,
          statusCode: response.status,
        },
        options.onStateChange
      );

      return data;
    } catch (err) {
      if (err instanceof FastAPIConversionError) {
        throw err;
      }

      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      const friendlyMessage = isAbort
        ? `Tiempo de espera agotado o petición cancelada hacia ${endpoint} (${Math.round(
            timeoutMs / 1000
          )}s).`
        : err instanceof Error
        ? err.message
        : `Error de red al conectar con el backend FastAPI (${endpoint}).`;

      const statusCode = isAbort ? 408 : 503;

      this.updateRequestState(
        {
          isLoading: false,
          stage: 'error',
          activeEndpoint: endpoint,
          progressMessage: friendlyMessage,
          error: friendlyMessage,
          statusCode,
        },
        options.onStateChange
      );

      throw new FastAPIConversionError(
        friendlyMessage,
        statusCode,
        endpoint,
        friendlyMessage
      );
    } finally {
      globalThis.clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener('abort', externalAbortHandler);
      }
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
      }
    }
  }

  public getParserForFile(fileName: string): BaseMeshFormatParser {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const parser = this.parsers.get(ext);
    if (!parser) {
      throw new Error(
        `Formato 3D '.${ext}' no soportado. Usa archivos .GLB, .GLTF, .OBJ o .FBX.`
      );
    }
    return parser;
  }

  public async ingestFile(file: File): Promise<THREE.Object3D> {
    const parser = this.getParserForFile(file.name);
    const buffer = await file.arrayBuffer();
    return parser.parseBuffer(buffer, file.name);
  }

  public validateVertexLimits(
    rootObject: THREE.Object3D,
    maxVerticesPerMeshPart: number = ThreeDEngineProcessor.ROBLOX_MAX_VERTICES_PER_MESHPART
  ): VertexLimitValidationResult {
    let totalVertices = 0;
    let maxVerticesInSingleMesh = 0;
    const exceedingMeshes: Array<{
      meshName: string;
      vertexCount: number;
      limit: number;
    }> = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    rootObject.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const meshName = mesh.name || 'UnnamedMeshPart';
        const posAttr = mesh.geometry?.getAttribute('position');
        const vCount = posAttr ? posAttr.count : 0;

        totalVertices += vCount;
        if (vCount > maxVerticesInSingleMesh) {
          maxVerticesInSingleMesh = vCount;
        }

        if (vCount === 0) {
          errors.push(`La sub-malla '${meshName}' tiene 0 vértices.`);
        } else if (vCount > maxVerticesPerMeshPart) {
          exceedingMeshes.push({
            meshName,
            vertexCount: vCount,
            limit: maxVerticesPerMeshPart,
          });
          warnings.push(
            `La sub-malla '${meshName}' contiene ${vCount.toLocaleString()} vértices (límite recomendado por MeshPart: ${maxVerticesPerMeshPart.toLocaleString()}). Se subdividirá automáticamente.`
          );
        }
      }
    });

    if (totalVertices === 0) {
      errors.push('El modelo 3D no contiene vértices válidos.');
    }

    return {
      isCompliant: exceedingMeshes.length === 0 && errors.length === 0,
      totalVertices,
      maxVerticesInSingleMesh,
      maxAllowedVerticesPerMeshPart: maxVerticesPerMeshPart,
      exceedingMeshes,
      warnings,
      errors,
    };
  }

  public validateTriangleCounts(
    rootObject: THREE.Object3D,
    maxTrianglesPerMeshPart: number = ThreeDEngineProcessor.ROBLOX_MAX_TRIANGLES_PER_MESHPART
  ): TriangleCountValidationResult {
    let totalTriangles = 0;
    let maxTrianglesInSingleMesh = 0;
    const exceedingMeshes: Array<{
      meshName: string;
      triangleCount: number;
      limit: number;
    }> = [];
    const zeroTriangleMeshes: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    rootObject.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const meshName = mesh.name || 'UnnamedMeshPart';
        const posAttr = mesh.geometry?.getAttribute('position');
        const indexAttr = mesh.geometry?.getIndex();
        const vCount = posAttr ? posAttr.count : 0;
        const tCount = indexAttr
          ? Math.floor(indexAttr.count / 3)
          : Math.floor(vCount / 3);

        totalTriangles += tCount;
        if (tCount > maxTrianglesInSingleMesh) {
          maxTrianglesInSingleMesh = tCount;
        }

        if (tCount <= 0) {
          zeroTriangleMeshes.push(meshName);
          errors.push(
            `La sub-malla '${meshName}' no contiene triángulos válidos (0 caras).`
          );
        } else if (tCount > maxTrianglesPerMeshPart) {
          exceedingMeshes.push({
            meshName,
            triangleCount: tCount,
            limit: maxTrianglesPerMeshPart,
          });
          warnings.push(
            `La sub-malla '${meshName}' tiene ${tCount.toLocaleString()} triángulos y supera el límite de ${maxTrianglesPerMeshPart.toLocaleString()} triángulos por MeshPart en Roblox Studio; se dividirá automáticamente.`
          );
        }
      }
    });

    if (totalTriangles === 0) {
      errors.push('El modelo 3D tiene 0 triángulos totales.');
    }

    return {
      isCompliant: exceedingMeshes.length === 0 && errors.length === 0,
      totalTriangles,
      maxTrianglesInSingleMesh,
      maxAllowedTrianglesPerMeshPart: maxTrianglesPerMeshPart,
      exceedingMeshes,
      zeroTriangleMeshes,
      warnings,
      errors,
    };
  }

  public validateTextureCoordinates(
    rootObject: THREE.Object3D
  ): TextureCoordinateValidationResult {
    const meshesWithUVs: string[] = [];
    const meshesMissingUVs: string[] = [];
    const meshesWithInvalidUVs: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    let totalMeshesChecked = 0;

    rootObject.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        totalMeshesChecked += 1;
        const mesh = child as THREE.Mesh;
        const meshName = mesh.name || `MeshPart_${totalMeshesChecked}`;
        const posAttr = mesh.geometry?.getAttribute('position');
        const uvAttr = mesh.geometry?.getAttribute('uv');

        if (!uvAttr || uvAttr.count === 0) {
          meshesMissingUVs.push(meshName);
          warnings.push(
            `La sub-malla '${meshName}' no incluye coordenadas de textura UV (atributo 'uv'). Las texturas PBR SurfaceAppearance requerirán mapeo UV.`
          );
          return;
        }

        let hasNaNOrInfinite = false;
        for (let i = 0; i < uvAttr.count; i++) {
          const u = uvAttr.getX(i);
          const v = uvAttr.getY(i);
          if (!Number.isFinite(u) || !Number.isFinite(v)) {
            hasNaNOrInfinite = true;
            break;
          }
        }

        if (hasNaNOrInfinite) {
          meshesWithInvalidUVs.push(meshName);
          warnings.push(
            `La sub-malla '${meshName}' contiene coordenadas UV no finitas (NaN/Infinity).`
          );
        } else if (posAttr && uvAttr.count !== posAttr.count) {
          meshesWithInvalidUVs.push(meshName);
          warnings.push(
            `La sub-malla '${meshName}' tiene desajuste entre cantidad de UVs (${uvAttr.count}) y vértices (${posAttr.count}).`
          );
        } else {
          meshesWithUVs.push(meshName);
        }
      }
    });

    const uvCoverageRatio =
      totalMeshesChecked > 0
        ? Number((meshesWithUVs.length / totalMeshesChecked).toFixed(2))
        : 0;

    return {
      hasCompleteUVs:
        totalMeshesChecked > 0 &&
        meshesMissingUVs.length === 0 &&
        meshesWithInvalidUVs.length === 0,
      totalMeshesChecked,
      meshesWithUVs,
      meshesMissingUVs,
      meshesWithInvalidUVs,
      uvCoverageRatio,
      warnings,
      errors,
    };
  }

  /**
   * Validates vertex counts, triangle limits (<10,000 tris per MeshPart), and UV texture
   * coordinate presence across a 3D hierarchy based on Roblox MeshPart constraints.
   */
  public validateMeshLimits(
    rootObject: THREE.Object3D,
    options?: {
      maxVerticesPerMeshPart?: number;
      maxTrianglesPerMeshPart?: number;
      requireUVs?: boolean;
    }
  ): MeshLimitsValidationResult {
    const maxVerticesLimit =
      options?.maxVerticesPerMeshPart ??
      ThreeDEngineProcessor.ROBLOX_MAX_VERTICES_PER_MESHPART;
    const maxTrianglesLimit =
      options?.maxTrianglesPerMeshPart ??
      ThreeDEngineProcessor.ROBLOX_MAX_TRIANGLES_PER_MESHPART;

    const vertexValidation = this.validateVertexLimits(
      rootObject,
      maxVerticesLimit
    );
    const triangleValidation = this.validateTriangleCounts(
      rootObject,
      maxTrianglesLimit
    );
    const uvValidation = this.validateTextureCoordinates(rootObject);

    const subMeshDiagnostics: SubMeshLimitDiagnostic[] = [];
    let meshIdx = 0;
    rootObject.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        meshIdx += 1;
        const mesh = child as THREE.Mesh;
        const meshName = mesh.name || `MeshPart_${meshIdx}`;
        const posAttr = mesh.geometry?.getAttribute('position');
        const indexAttr = mesh.geometry?.getIndex();
        const uvAttr = mesh.geometry?.getAttribute('uv');

        const vertexCount = posAttr ? posAttr.count : 0;
        const triangleCount = indexAttr
          ? Math.floor(indexAttr.count / 3)
          : Math.floor(vertexCount / 3);
        const uvCount = uvAttr ? uvAttr.count : 0;
        const hasUVCoordinates = uvCount > 0 && uvCount === vertexCount;

        subMeshDiagnostics.push({
          meshName,
          vertexCount,
          maxAllowedVertices: maxVerticesLimit,
          withinVertexLimit: vertexCount > 0 && vertexCount <= maxVerticesLimit,
          triangleCount,
          maxAllowedTriangles: maxTrianglesLimit,
          withinTriangleLimit:
            triangleCount > 0 && triangleCount <= maxTrianglesLimit,
          hasUVCoordinates,
          uvCount,
        });
      }
    });

    const warnings: string[] = [
      ...vertexValidation.warnings,
      ...triangleValidation.warnings,
      ...uvValidation.warnings,
    ];
    const errors: string[] = [
      ...vertexValidation.errors,
      ...triangleValidation.errors,
      ...uvValidation.errors,
    ];

    if (options?.requireUVs && !uvValidation.hasCompleteUVs) {
      errors.push(
        `El modelo requiere coordenadas UV completas para SurfaceAppearance PBR, pero faltan UVs en: ${uvValidation.meshesMissingUVs.join(', ')}.`
      );
    }

    const exceedsVertexLimit = !vertexValidation.isCompliant;
    const exceedsTriangleLimit = !triangleValidation.isCompliant;
    const hasUVCoordinates = uvValidation.hasCompleteUVs;

    return {
      isCompliant:
        vertexValidation.isCompliant &&
        triangleValidation.isCompliant &&
        errors.length === 0,
      totalVertices: vertexValidation.totalVertices,
      totalTriangles: triangleValidation.totalTriangles,
      subMeshCount: uvValidation.totalMeshesChecked,
      hasUVCoordinates,
      exceedsVertexLimit,
      exceedsTriangleLimit,
      subMeshDiagnostics,
      vertexValidation,
      triangleValidation,
      uvValidation,
      warnings,
      errors,
    };
  }

  public validateMeshStructure(
    file: File,
    rootObject?: THREE.Object3D
  ): MeshValidationReport {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const parser = this.parsers.get(ext);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!parser) {
      errors.push(
        `Extensión '.${ext}' no soportada. Se requiere .GLB, .GLTF, .OBJ o .FBX.`
      );
    }
    if (file.size === 0) {
      errors.push('El archivo 3D está vacío (0 bytes).');
    }
    if (file.size > ThreeDEngineProcessor.MAX_FILE_SIZE_BYTES) {
      errors.push('El archivo supera el límite de seguridad de 15 MB.');
    }

    let totalVertices = 0;
    let totalTriangles = 0;
    let subMeshCount = 0;
    let hasMissingNormals = false;
    let hasMissingUVs = false;
    let hasDegenerateBounds = false;
    let exceedsRobloxSingleMeshLimit = false;
    let exceedsRobloxVertexLimit = false;
    let meshLimitsValidation: MeshLimitsValidationResult | undefined;
    let vertexValidation: VertexLimitValidationResult | undefined;
    let triangleValidation: TriangleCountValidationResult | undefined;
    let uvValidation: TextureCoordinateValidationResult | undefined;

    if (rootObject) {
      const box = new THREE.Box3().setFromObject(rootObject);
      const size = new THREE.Vector3();
      box.getSize(size);
      if (size.lengthSq() < 1e-8) {
        hasDegenerateBounds = true;
        errors.push(
          'La geometría 3D tiene dimensiones degeneradas (bounding box nulo).'
        );
      }

      rootObject.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          subMeshCount += 1;
          const mesh = child as THREE.Mesh;
          const normAttr = mesh.geometry?.getAttribute('normal');
          if (!normAttr) {
            hasMissingNormals = true;
          }
        }
      });

      if (subMeshCount === 0) {
        errors.push(
          'El archivo 3D no contiene ninguna malla (Mesh) con geometría.'
        );
      } else {
        meshLimitsValidation = this.validateMeshLimits(rootObject);
        vertexValidation = meshLimitsValidation.vertexValidation;
        triangleValidation = meshLimitsValidation.triangleValidation;
        uvValidation = meshLimitsValidation.uvValidation;

        totalVertices = meshLimitsValidation.totalVertices;
        totalTriangles = meshLimitsValidation.totalTriangles;
        exceedsRobloxVertexLimit = meshLimitsValidation.exceedsVertexLimit;
        exceedsRobloxSingleMeshLimit = meshLimitsValidation.exceedsTriangleLimit;
        hasMissingUVs = !meshLimitsValidation.hasUVCoordinates;

        warnings.push(...meshLimitsValidation.warnings);
        errors.push(...meshLimitsValidation.errors);
      }
    }

    return {
      isValid: errors.length === 0,
      fileName: file.name,
      format: parser ? parser.formatName : 'UNKNOWN',
      fileSizeBytes: file.size,
      totalVertices,
      totalTriangles,
      subMeshCount,
      hasMissingNormals,
      hasMissingUVs,
      hasDegenerateBounds,
      exceedsRobloxSingleMeshLimit,
      exceedsRobloxVertexLimit,
      meshLimitsValidation,
      vertexValidation,
      triangleValidation,
      uvValidation,
      warnings,
      errors,
    };
  }

  public validateGeometryForRoblox(
    file: File,
    rootObject?: THREE.Object3D
  ): MeshValidationReport {
    return this.validateMeshStructure(file, rootObject);
  }

  public async processFile(
    file: File,
    config?: MeshPreprocessConfig,
    onStateChange?: (state: ThreeDEngineRequestState) => void
  ): Promise<{
    threeObject: THREE.Object3D;
    validation: MeshValidationReport;
    exportPayload: MeshPartExportPayload;
  }> {
    try {
      this.updateRequestState(
        {
          isLoading: true,
          stage: 'ingesting',
          activeEndpoint: null,
          progressMessage: `Ingiriendo archivo 3D '${file.name}'...`,
          error: null,
          statusCode: null,
        },
        onStateChange
      );

      const parser = this.getParserForFile(file.name);
      const rawObject = await this.ingestFile(file);

      this.updateRequestState(
        {
          isLoading: true,
          stage: 'validating',
          activeEndpoint: null,
          progressMessage: `Validando límites de vértices, <10k triángulos y coordenadas UV para '${file.name}'...`,
        },
        onStateChange
      );

      const validation = this.validateMeshStructure(file, rawObject);

      if (!validation.isValid) {
        const validationErrorMsg = validation.errors.join(' ');
        this.updateRequestState(
          {
            isLoading: false,
            stage: 'error',
            activeEndpoint: null,
            progressMessage: validationErrorMsg,
            error: validationErrorMsg,
            statusCode: 422,
          },
          onStateChange
        );
        throw new FastAPIConversionError(
          validationErrorMsg,
          422,
          'local/validateMeshStructure',
          validationErrorMsg,
          validation.errors
        );
      }

      this.updateRequestState(
        {
          isLoading: true,
          stage: 'preprocessing',
          activeEndpoint: null,
          progressMessage: `Normalizando escala a Studs, aplicando LOD y extrayendo geometría real (${validation.totalTriangles.toLocaleString()} tris)...`,
        },
        onStateChange
      );

      const mergedConfig = { ...this.defaultConfig, ...config };
      const baseName = file.name.replace(/\.[^/.]+$/, '');

      const exportPayload = this.preprocessor.preprocessObject3D(
        rawObject,
        baseName,
        parser.formatName,
        mergedConfig
      );

      this.updateRequestState(
        {
          isLoading: false,
          stage: 'completed',
          activeEndpoint: null,
          progressMessage: `Pre-procesamiento completado (${exportPayload.subMeshParts.length} MeshParts con geometría real conservada).`,
          error: null,
          statusCode: 200,
        },
        onStateChange
      );

      return {
        threeObject: rawObject,
        validation,
        exportPayload,
      };
    } catch (err) {
      if (!(err instanceof FastAPIConversionError)) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Error inesperado al procesar el archivo 3D.';
        this.updateRequestState(
          {
            isLoading: false,
            stage: 'error',
            activeEndpoint: null,
            progressMessage: msg,
            error: msg,
            statusCode: 400,
          },
          onStateChange
        );
      }
      throw err;
    }
  }

  /**
   * Converts a preprocessed MeshPartExportPayload into a Forge3DAsset while
   * preserving `shape: 'MeshPart'` and the real `meshData` (vertices, normals, UVs, faces).
   */
  public toForge3DAsset(payload: MeshPartExportPayload): Forge3DAsset {
    const parts: MeshPart3DSpec[] = payload.subMeshParts.map((sub) => ({
      name: sub.name,
      shape: 'MeshPart',
      size: sub.studSize,
      position: sub.studPosition,
      rotation: sub.studRotation,
      color: sub.colorRgb,
      material: sub.robloxMaterial,
      roughness: sub.roughness,
      metalness: sub.metalness,
      transparency: 0,
      canCollide: true,
      anchored: true,
      collisionFidelity: sub.collisionFidelity,
      renderFidelity: sub.renderFidelity,
      doubleSided: sub.doubleSided,
      meshData: sub.meshData,
    }));

    return {
      id: `meshpart-${Date.now()}`,
      name: payload.modelName,
      category: `Imported ${payload.sourceFormat}`,
      asset_type: 'Model3D',
      poly_count: payload.totalTriangles,
      collision_fidelity:
        payload.subMeshParts[0]?.collisionFidelity || 'Hull',
      rojo_target_folder: payload.rojoTargetFolder,
      file_name: payload.fileName,
      obj_file_name: payload.objFileName,
      description: `MeshPart 3D con geometría real desde ${payload.sourceFormat} (${payload.subMeshParts.length} MeshParts, ${payload.totalTriangles} tris, ${payload.totalVertices} vértices, escala ${payload.scaleFactorApplied}x a Studs).`,
      pbr_profile: {
        albedo_hex: '#38bdf8',
        roughness: payload.subMeshParts[0]?.roughness ?? 0.35,
        metalness: payload.subMeshParts[0]?.metalness ?? 0.65,
        emissive_hex: '#06b6d4',
        roblox_material:
          payload.subMeshParts[0]?.robloxMaterial || 'Metal',
        pattern: 'hex_plate',
      },
      parts,
      luau_code: payload.luauMeshPartBuilderCode,
    };
  }

  /**
   * API Request Handler: Calls FastAPI POST /api/v1/assets/process-meshpart
   * to persist both the real Wavefront .OBJ geometry and the --!strict EditableMesh/MeshPart
   * Luau module in Rojo and the Reusable Asset Library.
   */
  public async convertToRobloxMeshParts(
    payload: MeshPartExportPayload,
    options: FastAPIRequestOptions = {}
  ): Promise<BackendMeshPartSyncResponse> {
    if (
      !payload ||
      !Array.isArray(payload.subMeshParts) ||
      payload.subMeshParts.length === 0
    ) {
      const msg =
        'El payload de exportación MeshPart está vacío o no contiene sub-mallas válidas.';
      this.updateRequestState(
        {
          isLoading: false,
          stage: 'error',
          activeEndpoint: '/api/v1/assets/process-meshpart',
          progressMessage: msg,
          error: msg,
          statusCode: 400,
        },
        options.onStateChange
      );
      throw new FastAPIConversionError(
        msg,
        400,
        '/api/v1/assets/process-meshpart',
        msg
      );
    }

    return this.requestFastAPI<BackendMeshPartSyncResponse>(
      '/api/v1/assets/process-meshpart',
      'POST',
      'converting_meshpart',
      `Enviando ${payload.subMeshParts.length} MeshParts (${payload.totalTriangles.toLocaleString()} tris + archivo .OBJ) a FastAPI...`,
      {
        payload,
        save_to_rojo: options.saveToRojo ?? true,
        save_to_library: options.saveToLibrary ?? true,
      },
      options
    );
  }

  public async exportToBackendMeshParts(
    payload: MeshPartExportPayload,
    options: FastAPIRequestOptions = {}
  ): Promise<BackendMeshPartSyncResponse> {
    return this.convertToRobloxMeshParts(payload, options);
  }

  public async generate3DMeshPartWithFastAPI(
    request: FastAPI3DGenerationRequest,
    options: FastAPIRequestOptions = {}
  ): Promise<Forge3DAsset> {
    if (!request.prompt || !request.prompt.trim()) {
      const msg =
        'Se requiere un prompt descriptivo para generar el modelo 3D en FastAPI.';
      this.updateRequestState(
        {
          isLoading: false,
          stage: 'error',
          activeEndpoint: '/api/v1/generate-3d',
          progressMessage: msg,
          error: msg,
          statusCode: 400,
        },
        options.onStateChange
      );
      throw new FastAPIConversionError(msg, 400, '/api/v1/generate-3d', msg);
    }

    return this.requestFastAPI<Forge3DAsset>(
      '/api/v1/generate-3d',
      'POST',
      'generating_3d',
      `Generando jerarquía 3D MeshPart en FastAPI ('${request.prompt.slice(0, 48)}...')...`,
      request,
      options
    );
  }

  /**
   * API Request Handler (Streaming SSE / NDJSON): Calls FastAPI POST /api/v1/generate-3d-stream
   * with real-time progress logs, loading state updates, and error handling.
   */
  public async stream3DMeshPartWithFastAPI(
    request: FastAPI3DGenerationRequest,
    options: FastAPIRequestOptions = {}
  ): Promise<Forge3DAsset> {
    const endpoint = '/api/v1/generate-3d-stream';
    const timeoutMs =
      options.timeoutMs ?? ThreeDEngineProcessor.DEFAULT_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    this.activeAbortController = controller;

    const timeoutId = globalThis.setTimeout(
      () => controller.abort(),
      timeoutMs
    );

    this.updateRequestState(
      {
        isLoading: true,
        stage: 'generating_3d',
        activeEndpoint: endpoint,
        progressMessage: 'Iniciando stream de generación 3D con FastAPI...',
        error: null,
        statusCode: null,
      },
      options.onStateChange
    );

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        const apiError = await this.parseFastAPIErrorResponse(
          response,
          endpoint,
          'Error al iniciar el stream 3D en FastAPI'
        );
        this.updateRequestState(
          {
            isLoading: false,
            stage: 'error',
            activeEndpoint: endpoint,
            progressMessage: apiError.message,
            error: apiError.message,
            statusCode: apiError.statusCode,
          },
          options.onStateChange
        );
        throw apiError;
      }

      if (!response.body) {
        throw new FastAPIConversionError(
          'El servidor FastAPI no devolvió un stream legible.',
          500,
          endpoint
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let finalAsset: Forge3DAsset | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          if (!trimmed) continue;
          const jsonStr = trimmed.startsWith('data:')
            ? trimmed.replace(/^data:\s*/, '')
            : trimmed;
          try {
            const event = JSON.parse(jsonStr) as {
              type: string;
              message?: string;
              data?: Forge3DAsset;
            };

            if (
              (event.type === 'log' || event.type === 'rojo_write') &&
              event.message
            ) {
              options.onStreamLog?.(event.message);
              this.updateRequestState(
                {
                  isLoading: true,
                  stage: 'generating_3d',
                  activeEndpoint: endpoint,
                  progressMessage: event.message,
                },
                options.onStateChange
              );
            } else if (event.type === 'error') {
              throw new FastAPIConversionError(
                event.message || 'Error durante el stream 3D en FastAPI.',
                500,
                endpoint
              );
            } else if (
              (event.type === 'done' || event.type === 'result') &&
              event.data
            ) {
              finalAsset = event.data;
            }
          } catch (parseErr) {
            if (parseErr instanceof FastAPIConversionError) {
              throw parseErr;
            }
          }
        }
      }

      if (!finalAsset) {
        throw new FastAPIConversionError(
          'El stream 3D finalizó sin devolver un asset MeshPart válido.',
          500,
          endpoint
        );
      }

      this.updateRequestState(
        {
          isLoading: false,
          stage: 'completed',
          activeEndpoint: null,
          progressMessage: `Modelo 3D '${finalAsset.name}' generado y sincronizado.`,
          error: null,
          statusCode: 200,
        },
        options.onStateChange
      );

      return finalAsset;
    } catch (err) {
      const apiErr =
        err instanceof FastAPIConversionError
          ? err
          : new FastAPIConversionError(
              err instanceof Error
                ? err.message
                : 'Error en el stream de generación 3D.',
              500,
              endpoint
            );

      this.updateRequestState(
        {
          isLoading: false,
          stage: 'error',
          activeEndpoint: endpoint,
          progressMessage: apiErr.message,
          error: apiErr.message,
          statusCode: apiErr.statusCode,
        },
        options.onStateChange
      );
      throw apiErr;
    } finally {
      globalThis.clearTimeout(timeoutId);
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
      }
    }
  }

  public async rebuildMeshPartLuauOnFastAPI(
    asset: Forge3DAsset,
    options: FastAPIRequestOptions = {}
  ): Promise<{ asset: Forge3DAsset }> {
    return this.requestFastAPI<{ asset: Forge3DAsset }>(
      '/api/v1/assets/rebuild-luau',
      'POST',
      'rebuilding_luau',
      `Recompilando módulo Luau --!strict para '${asset.name}' en FastAPI...`,
      {
        asset,
        save_to_rojo: options.saveToRojo ?? true,
        save_to_library: options.saveToLibrary ?? true,
      },
      options
    );
  }

  /**
   * API Request Handler: Calls FastAPI POST /api/v1/assets/publish-pbr
   * to persist procedural PBR textures (Albedo, Normal, Roughness PNGs) into the Rojo workspace
   * and generate a --!strict SurfaceAppearance binder module.
   */
  public async publishPBRToRojo(
    pbrPayload: {
      material_name: string;
      pattern: string;
      albedo_hex: string;
      emissive_hex: string;
      roughness: number;
      metalness: number;
      albedo_data_url: string;
      normal_data_url: string;
      roughness_data_url: string;
      metalness_data_url?: string;
      target_asset_id?: string;
      target_part_name?: string;
      color_map_asset_id?: string;
      normal_map_asset_id?: string;
      roughness_map_asset_id?: string;
      metalness_map_asset_id?: string;
      roblox_open_cloud_api_key?: string;
      creator_user_id?: string;
    },
    options: FastAPIRequestOptions = {}
  ): Promise<{
    success: boolean;
    status:
      | 'local_saved'
      | 'cloud_publishing'
      | 'cloud_published'
      | 'partially_published'
      | 'failed'
      | 'asset_not_found';
    material_name: string;
    saved_textures: string[] | Record<string, string>;
    local_files?: Record<string, string | null>;
    verified_cloud_uris?: Record<string, string | null>;
    published_channels?: string[];
    missing_channels?: string[];
    decode_errors?: Record<string, string>;
    channel_status?: Record<string, string>;
    is_cloud_published?: boolean;
    luau_binder_path: string;
    luau_code: string;
    updated_asset?: Forge3DAsset | null;
  }> {
    return this.requestFastAPI(
      '/api/v1/assets/publish-pbr',
      'POST',
      'converting_meshpart',
      `Exportando 4 mapas PBR (ColorMap, NormalMap, RoughnessMap, MetalnessMap) y SurfaceAppearance para '${pbrPayload.material_name}' a Rojo...`,
      pbrPayload,
      options
    );
  }

  public async fetchAssetLibraryFromFastAPI(
    options: FastAPIRequestOptions = {}
  ): Promise<{ assets: Forge3DAsset[] }> {
    return this.requestFastAPI<{ assets: Forge3DAsset[] }>(
      '/api/v1/assets/library',
      'GET',
      'fetching_library',
      'Consultando biblioteca de assets 3D desde FastAPI...',
      undefined,
      options
    );
  }

  public async buildWorldSceneWithFastAPI(
    sceneRequest: {
      scene_name: string;
      biome: string;
      lighting_preset: string;
      placements: Array<{
        asset_id: string;
        name: string;
        category: string;
        position: [number, number, number];
        rotation_y: number;
        scale: number;
      }>;
      save_to_rojo?: boolean;
    },
    options: FastAPIRequestOptions = {}
  ): Promise<{
    scene_name: string;
    file_name: string;
    rojo_target_folder: string;
    luau_code: string;
    saved_path?: string | null;
  }> {
    return this.requestFastAPI(
      '/api/v1/world/build-scene',
      'POST',
      'converting_meshpart',
      `Construyendo escenario 3D '${sceneRequest.scene_name}' en FastAPI...`,
      {
        ...sceneRequest,
        save_to_rojo: sceneRequest.save_to_rojo ?? options.saveToRojo ?? true,
      },
      options
    );
  }

  public async checkFastAPIHealth(
    options: FastAPIRequestOptions = {}
  ): Promise<{
    status: string;
    rojo_path: string;
    context_loaded: boolean;
  }> {
    return this.requestFastAPI(
      '/api/v1/health',
      'GET',
      'fetching_library',
      'Verificando estado del servicio FastAPI y conexión Rojo...',
      undefined,
      options
    );
  }

  public async processAndSyncWithBackend(
    file: File,
    config?: MeshPreprocessConfig,
    syncOptions: FastAPIRequestOptions = {}
  ): Promise<{
    threeObject: THREE.Object3D;
    validation: MeshValidationReport;
    exportPayload: MeshPartExportPayload;
    backendResponse: BackendMeshPartSyncResponse;
  }> {
    const { threeObject, validation, exportPayload } = await this.processFile(
      file,
      config,
      syncOptions.onStateChange
    );
    const backendResponse = await this.convertToRobloxMeshParts(
      exportPayload,
      syncOptions
    );
    return {
      threeObject,
      validation,
      exportPayload,
      backendResponse,
    };
  }
}

export { ThreeDEngineProcessor as Roblox3DEngineProcessor };
export const default3DEngineProcessor = new ThreeDEngineProcessor();
