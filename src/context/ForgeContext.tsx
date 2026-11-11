import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import {
  Forge3DAsset,
  MeshPart3DSpec,
  OperationHistoryEntry,
} from '../utils/roblox3DEngine.ts';

export type UIMode = 'simple' | 'advanced';

export type PrimaryTab = 'home' | 'create' | 'edit' | 'materials' | 'studio';
export type AdvancedTab = 'agents' | 'script' | 'ui' | 'rojo' | 'context' | 'backend';
export type AppTab = PrimaryTab | AdvancedTab;

export type BackendHealthState = 'unknown' | 'checking' | 'connected' | 'disconnected' | 'error';

export interface BackendDiagnostics {
  status: BackendHealthState;
  statusCode?: number;
  lastCheckedAt: string | null;
  latencyMs?: number;
  error?: string | null;
}

export interface BridgeHealthStatus {
  bridgeConnected: boolean;
  bridgeVersion: string;
  protocolVersion: string;
  sessionActive: boolean;
  lastHeartbeatAt: string | null;
  activeProject: string | null;
  rojo: {
    projectName: string | null;
    projectConnected: boolean;
    defaultProjectJsonFound: boolean;
    rojoCliInstalled: boolean;
    rojoVersion: string | null;
    rojoServePort: number;
    rojoServerListening: boolean;
    syncedFilesCount: number;
  };
  robloxStudio: {
    connected: boolean;
    lastSeenAt: string | null;
    pluginVersion: string | null;
    placeName: string | null;
    selectedModelName: string | null;
    selectedPartCount: number;
    pendingDestructiveConfirmations: number;
  };
  backend: BackendDiagnostics;
}

export type SyncOperationState =
  | 'idle'
  | 'preparing'
  | 'sending'
  | 'queued'
  | 'awaiting_studio'
  | 'processing'
  | 'applied_successfully'
  | 'applied_partially'
  | 'rejected'
  | 'error'
  | 'timeout';

export interface SyncOperationStatus {
  state: SyncOperationState;
  operation: 'push' | 'pull' | 'merge';
  taskId?: string;
  correlationId?: string;
  message: string;
  details?: string;
  timestamp: string;
}

export interface SyncHistoryItem {
  id: string;
  timestamp: string;
  type: 'push' | 'pull' | 'merge';
  modelName: string;
  partCount: number;
  status: SyncOperationState;
  details: string;
  taskId?: string;
}

export interface GeometryMetrics {
  vertices: number;
  triangles: number;
  partsCount: number;
  realVertices: number;
  realTriangles: number;
  estimatedVertices: number;
  estimatedTriangles: number;
  hasEstimatedGeometry: boolean;
}

/**
 * Computes the 3D surface area of a triangle formed by 3 vertices.
 */
function computeTriangleArea3D(v0: number[], v1: number[], v2: number[]): number {
  if (!v0 || !v1 || !v2 || v0.length < 3 || v1.length < 3 || v2.length < 3) return 0;
  const ax = v1[0] - v0[0];
  const ay = v1[1] - v0[1];
  const az = v1[2] - v0[2];

  const bx = v2[0] - v0[0];
  const by = v2[1] - v0[1];
  const bz = v2[2] - v0[2];

  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;

  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/**
 * Validates face vertex index bounds, cleans duplicate vertices, and computes
 * non-degenerate triangles for polygons.
 */
function countValidTrianglesInFace(face: number[], vertices: number[][]): number {
  if (!Array.isArray(face) || face.length < 3) return 0;

  const vLen = vertices.length;
  const cleaned: number[] = [];

  for (let i = 0; i < face.length; i++) {
    const idx = face[i];
    if (typeof idx !== 'number' || isNaN(idx) || idx < 0 || idx >= vLen || !Number.isInteger(idx)) {
      return 0; // Invalid index found; reject degenerate face
    }
    if (cleaned.length === 0 || cleaned[cleaned.length - 1] !== idx) {
      cleaned.push(idx);
    }
  }

  // Remove circular duplicate if closing vertex equals opening vertex
  if (cleaned.length > 1 && cleaned[0] === cleaned[cleaned.length - 1]) {
    cleaned.pop();
  }

  if (cleaned.length < 3) return 0;

  let validTris = 0;
  const v0 = vertices[cleaned[0]];

  for (let i = 1; i < cleaned.length - 1; i++) {
    const idx1 = cleaned[i];
    const idx2 = cleaned[i + 1];
    if (cleaned[0] !== idx1 && cleaned[0] !== idx2 && idx1 !== idx2) {
      const v1 = vertices[idx1];
      const v2 = vertices[idx2];
      const area = computeTriangleArea3D(v0, v1, v2);
      if (area > 1e-7) {
        validTris++;
      }
    }
  }

  return validTris;
}

/**
 * Calculates geometry metrics, distinguishing between real mesh vertex/face data
 * (with geometric area and index validation) and estimated primitive shapes.
 */
export function calculateAssetMetrics(asset: Forge3DAsset): GeometryMetrics {
  let realVertices = 0;
  let realTriangles = 0;
  let estimatedVertices = 0;
  let estimatedTriangles = 0;
  let hasEstimatedGeometry = false;

  const parts = Array.isArray(asset.parts) ? asset.parts : [];

  for (const part of parts) {
    if (part.meshData && Array.isArray(part.meshData.vertices) && part.meshData.vertices.length > 0) {
      realVertices += part.meshData.vertices.length;
      const vertices = part.meshData.vertices;
      const faces = part.meshData.faces;

      if (Array.isArray(faces)) {
        if (faces.length > 0 && Array.isArray(faces[0])) {
          // Polygon face array: validate indices and compute non-degenerate triangles
          for (const face of faces as number[][]) {
            realTriangles += countValidTrianglesInFace(face, vertices);
          }
        } else if (faces.length > 0 && typeof faces[0] === 'number') {
          // Flat index array where every 3 indices form 1 triangle
          const flat = faces as unknown as number[];
          for (let i = 0; i + 2 < flat.length; i += 3) {
            const i0 = flat[i];
            const i1 = flat[i + 1];
            const i2 = flat[i + 2];
            if (
              i0 >= 0 && i0 < vertices.length &&
              i1 >= 0 && i1 < vertices.length &&
              i2 >= 0 && i2 < vertices.length &&
              i0 !== i1 && i0 !== i2 && i1 !== i2
            ) {
              const area = computeTriangleArea3D(vertices[i0], vertices[i1], vertices[i2]);
              if (area > 1e-7) {
                realTriangles++;
              }
            }
          }
        } else {
          realTriangles += faces.length;
        }
      }
    } else {
      // Primitive Roblox geometry estimation
      hasEstimatedGeometry = true;
      switch (part.shape) {
        case 'Block':
          estimatedVertices += 8;
          estimatedTriangles += 12;
          break;
        case 'Cylinder':
          estimatedVertices += 48;
          estimatedTriangles += 92;
          break;
        case 'Ball':
          estimatedVertices += 64;
          estimatedTriangles += 120;
          break;
        case 'Wedge':
        case 'CornerWedge':
          estimatedVertices += 6;
          estimatedTriangles += 8;
          break;
        default:
          estimatedVertices += 8;
          estimatedTriangles += 12;
      }
    }
  }

  const totalVertices = realVertices + estimatedVertices;
  const totalTriangles = realTriangles + estimatedTriangles;

  return {
    vertices: totalVertices,
    triangles: totalTriangles > 0 ? totalTriangles : (asset.poly_count || 0),
    partsCount: parts.length,
    realVertices,
    realTriangles,
    estimatedVertices,
    estimatedTriangles,
    hasEstimatedGeometry,
  };
}

/**
 * Computes a deterministic canonical string representation of the asset contents
 * incorporating all model metadata, PBR profiles, part hierarchy, transforms, visual,
 * physical properties, and vertex/face/normal/UV buffers.
 */
export function computeAssetContentHash(asset: Forge3DAsset | null): string {
  if (!asset) return '';

  const partsSummary = (asset.parts || []).map((p, idx) => {
    const id = p.partId || `part_${idx}`;
    const hier = `${p.parentId || ''}/${p.parentName || ''}/${p.hierarchyPath || ''}`;
    const pos = (p.position || [0, 0, 0]).map((n) => Number(n).toFixed(3)).join(',');
    const rot = (p.rotation || [0, 0, 0]).map((n) => Number(n).toFixed(3)).join(',');
    const sz = (p.size || [1, 1, 1]).map((n) => Number(n).toFixed(3)).join(',');
    const col = (p.color || [163, 162, 165]).join(',');
    const trans = Number(p.transparency ?? 0).toFixed(3);
    const anch = p.anchored ? '1' : '0';
    const coll = p.canCollide !== false ? '1' : '0';
    const doubleSided = p.doubleSided ? '1' : '0';
    const castShadow = p.castShadow !== false ? '1' : '0';
    const collFid = p.collisionFidelity || 'Default';
    const rendFid = p.renderFidelity || 'Automatic';
    const meshRef = `${p.meshId || ''}:${p.assetId || ''}:${p.textureId || ''}`;
    const mat = `${p.material || 'Plastic'}_${Number(p.roughness ?? 0.5).toFixed(3)}_${Number(p.metalness ?? 0).toFixed(3)}_${Number(p.reflectance ?? 0).toFixed(3)}`;

    // Part-level PBR specs
    let partPbrStr = 'none';
    if (p.pbrMaterial) {
      const pm = p.pbrMaterial;
      partPbrStr = `${pm.pattern || ''}_${pm.albedoHex || ''}_${pm.emissiveHex || ''}_${pm.roughness ?? ''}_${pm.metalness ?? ''}_${pm.colorMapAssetId || ''}_${pm.normalMapAssetId || ''}_${pm.roughnessMapAssetId || ''}_${pm.metalnessMapAssetId || ''}_${pm.albedoDataUrl ? pm.albedoDataUrl.length : 0}_${pm.normalDataUrl ? pm.normalDataUrl.length : 0}`;
    }

    // Canonical representation of mesh geometry data (coordinates, faces, normals, uvs)
    let meshHash = 'none';
    if (p.meshData) {
      const vCoords = Array.isArray(p.meshData.vertices)
        ? p.meshData.vertices.map((v: number[]) => (Array.isArray(v) ? v.map((c) => Number(c).toFixed(3)).join(',') : String(v))).join(';')
        : '';
      const fIndices = Array.isArray(p.meshData.faces)
        ? p.meshData.faces.map((f: any) => (Array.isArray(f) ? f.join(',') : String(f))).join(';')
        : '';
      const nCoords = Array.isArray(p.meshData.normals)
        ? p.meshData.normals.map((n: number[]) => (Array.isArray(n) ? n.map((c) => Number(c).toFixed(2)).join(',') : String(n))).join(';')
        : '';
      const uvCoords = Array.isArray(p.meshData.uvs)
        ? p.meshData.uvs.map((uv: number[]) => (Array.isArray(uv) ? uv.map((c) => Number(c).toFixed(3)).join(',') : String(uv))).join(';')
        : '';

      meshHash = `v[${p.meshData.vertices?.length || 0}:${vCoords}]_f[${p.meshData.faces?.length || 0}:${fIndices}]_n[${nCoords}]_uv[${uvCoords}]_${p.meshData.objFileName || ''}`;
    }

    return `${id}|${p.name}|${p.shape}|${hier}|${pos}|${rot}|${sz}|${col}|t:${trans}|a:${anch}|c:${coll}|ds:${doubleSided}|cs:${castShadow}|cf:${collFid}|rf:${rendFid}|${mat}|${meshRef}|pbr:${partPbrStr}|mesh:${meshHash}`;
  });

  const pbr = asset.pbr_profile
    ? `${asset.pbr_profile.pattern}_${asset.pbr_profile.albedo_hex}_${asset.pbr_profile.emissive_hex || ''}_${asset.pbr_profile.roughness}_${asset.pbr_profile.metalness}_${asset.pbr_profile.roblox_material || ''}_${asset.pbr_profile.color_map_asset_id || ''}_${asset.pbr_profile.normal_map_asset_id || ''}_${asset.pbr_profile.roughness_map_asset_id || ''}_${asset.pbr_profile.metalness_map_asset_id || ''}_${asset.pbr_profile.albedo_asset_path || ''}_${asset.pbr_profile.normal_asset_path || ''}`
    : '';

  const meta = `${asset.name}#${asset.category || 'Props'}#${asset.asset_type || 'Model3D'}#${asset.collision_fidelity || 'Hull'}#${asset.description || ''}#${asset.rojo_target_folder || ''}#${asset.file_name || ''}`;

  return `${meta}#pbr:${pbr}#[${partsSummary.join(';;')}]`;
}

/**
 * Ensures each part in the asset has a truly persistent, stable partId.
 * Preserves existing partIds across renames and reordering.
 */
export function ensureStablePartIds(parts: MeshPart3DSpec[], assetName: string): MeshPart3DSpec[] {
  return parts.map((part, index) => {
    if (part.partId && typeof part.partId === 'string' && part.partId.trim().length > 0) {
      return part;
    }
    // Generate an intrinsic persistent ID
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const safeName = (part.name || `Part_${index + 1}`).replace(/[^a-zA-Z0-9_]/g, '_');
    return {
      ...part,
      partId: `pid_${safeName}_${Date.now().toString(36)}_${randomSuffix}`,
      hierarchyPath: part.hierarchyPath || `Workspace/${assetName}/${part.name}`,
    };
  });
}

/**
 * Finds the matching part in an updated parts array using stable ID first,
 * then hierarchy path and name.
 * If the part no longer exists, returns NULL instead of silently picking an arbitrary part.
 */
export function findMatchingPart(
  parts: MeshPart3DSpec[],
  target: MeshPart3DSpec | null
): MeshPart3DSpec | null {
  if (!parts || parts.length === 0 || !target) return null;

  if (target.partId) {
    const byId = parts.find((p) => p.partId === target.partId);
    if (byId) return byId;
  }

  if (target.hierarchyPath) {
    const byPath = parts.find((p) => p.hierarchyPath === target.hierarchyPath && p.name === target.name);
    if (byPath) return byPath;
  }

  const byName = parts.find((p) => p.name === target.name);
  if (byName) return byName;

  // Explicitly return null if no matching part exists
  return null;
}

interface ForgeContextType {
  uiMode: UIMode;
  setUiMode: (mode: UIMode) => void;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;

  // Active Model & Selection
  activeAsset: Forge3DAsset | null;
  setActiveAsset: (asset: Forge3DAsset | null, force?: boolean) => void;
  selectedPart: MeshPart3DSpec | null;
  setSelectedPart: (part: MeshPart3DSpec | null) => void;

  // Asset Library
  assetLibrary: Forge3DAsset[];
  loadingLibrary: boolean;
  fetchAssetLibrary: () => Promise<void>;

  // Undo / Redo & Non-destructive history
  undoStack: Forge3DAsset[];
  redoStack: Forge3DAsset[];
  operationHistory: OperationHistoryEntry[];
  applyAssetChange: (
    updatedAsset: Forge3DAsset,
    summary: string,
    operationType?: OperationHistoryEntry['operationType']
  ) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Pending Changes Management
  pendingChanges: boolean;
  saveAssetToDisk: (saveToRojo?: boolean) => Promise<boolean>;
  showUnsavedModal: boolean;
  pendingSwitchTarget: Forge3DAsset | null;
  pendingSwitchTab: AppTab | null;
  safeNavigateTab: (tab: AppTab) => void;
  confirmSwitchDiscard: () => void;
  confirmSwitchSaveAndProceed: () => Promise<void>;
  cancelSwitch: () => void;

  // System & Bridge Status
  bridgeStatus: BridgeHealthStatus;
  refreshBridgeStatus: () => Promise<void>;

  // Bidirectional Synchronization
  currentSyncStatus: SyncOperationStatus;
  pushToStudio: (targetAsset?: Forge3DAsset) => Promise<{ success: boolean; appliedInStudio: boolean; message: string; taskId?: string }>;
  pullFromStudio: () => Promise<{ success: boolean; message: string; asset?: Forge3DAsset }>;
  syncHistory: SyncHistoryItem[];

  // Global Toast / Notice
  notification: { type: 'info' | 'success' | 'warning' | 'error'; message: string } | null;
  setNotification: (notif: { type: 'info' | 'success' | 'warning' | 'error'; message: string } | null) => void;
}

const defaultBridgeStatus: BridgeHealthStatus = {
  bridgeConnected: false,
  bridgeVersion: '1.0.0',
  protocolVersion: '1.0',
  sessionActive: false,
  lastHeartbeatAt: null,
  activeProject: null,
  rojo: {
    projectName: null,
    projectConnected: false,
    defaultProjectJsonFound: false,
    rojoCliInstalled: false,
    rojoVersion: null,
    rojoServePort: 34872,
    rojoServerListening: false,
    syncedFilesCount: 0,
  },
  robloxStudio: {
    connected: false,
    lastSeenAt: null,
    pluginVersion: null,
    placeName: null,
    selectedModelName: null,
    selectedPartCount: 0,
    pendingDestructiveConfirmations: 0,
  },
  backend: {
    status: 'unknown',
    statusCode: undefined,
    lastCheckedAt: null,
    latencyMs: undefined,
    error: null,
  },
};

const ForgeContext = createContext<ForgeContextType | null>(null);

export const ForgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [uiMode, setUiModeState] = useState<UIMode>(() => {
    try {
      const saved = localStorage.getItem('forge_ui_mode');
      return saved === 'advanced' ? 'advanced' : 'simple';
    } catch {
      return 'simple';
    }
  });

  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [activeAsset, setActiveAssetState] = useState<Forge3DAsset | null>(null);
  const [selectedPart, setSelectedPart] = useState<MeshPart3DSpec | null>(null);
  const [assetLibrary, setAssetLibrary] = useState<Forge3DAsset[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState<boolean>(false);

  // Undo / Redo & Immutable History
  const [undoStack, setUndoStack] = useState<Forge3DAsset[]>([]);
  const [redoStack, setRedoStack] = useState<Forge3DAsset[]>([]);
  const [operationHistory, setOperationHistory] = useState<OperationHistoryEntry[]>([]);

  // Hash-based pending changes detection & snapshot of last persisted asset
  const savedAssetHashRef = useRef<string>('');
  const savedAssetSnapshotRef = useRef<Forge3DAsset | null>(null);
  const [pendingChanges, setPendingChanges] = useState<boolean>(false);

  // Unsaved changes confirmation modal state
  const [showUnsavedModal, setShowUnsavedModal] = useState<boolean>(false);
  const [pendingSwitchTarget, setPendingSwitchTarget] = useState<Forge3DAsset | null>(null);
  const [pendingSwitchTab, setPendingSwitchTab] = useState<AppTab | null>(null);

  // System & Bridge Status with differentiated backend health
  const [bridgeStatus, setBridgeStatus] = useState<BridgeHealthStatus>(defaultBridgeStatus);

  // Detailed Synchronization state
  const [currentSyncStatus, setCurrentSyncStatus] = useState<SyncOperationStatus>({
    state: 'idle',
    operation: 'push',
    message: 'Listo',
    timestamp: new Date().toLocaleTimeString(),
  });
  const [syncHistory, setSyncHistory] = useState<SyncHistoryItem[]>([]);

  // Notifications
  const [notification, setNotification] = useState<{
    type: 'info' | 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  const setUiMode = (mode: UIMode) => {
    setUiModeState(mode);
    try {
      localStorage.setItem('forge_ui_mode', mode);
    } catch {
      // Ignore storage errors
    }
  };

  /**
   * Safe tab navigation guard that intercepts navigation when pending changes exist
   */
  const safeNavigateTab = useCallback(
    (targetTab: AppTab) => {
      if (pendingChanges && (activeTab === 'edit' || activeTab === 'materials') && targetTab !== activeTab) {
        setPendingSwitchTab(targetTab);
        setShowUnsavedModal(true);
        return;
      }
      setActiveTab(targetTab);
    },
    [pendingChanges, activeTab]
  );

  /**
   * Internal setter for active asset without prompt
   */
  const applyActiveAssetDirectly = useCallback((asset: Forge3DAsset | null) => {
    if (!asset) {
      setActiveAssetState(null);
      setSelectedPart(null);
      savedAssetHashRef.current = '';
      savedAssetSnapshotRef.current = null;
      setPendingChanges(false);
      setUndoStack([]);
      setRedoStack([]);
      return;
    }

    const stabilizedParts = ensureStablePartIds(asset.parts || [], asset.name);
    const stabilizedAsset: Forge3DAsset = {
      ...asset,
      parts: stabilizedParts,
    };

    setActiveAssetState(stabilizedAsset);
    setSelectedPart(findMatchingPart(stabilizedParts, null));

    // Store baseline snapshot and hash for saved state
    savedAssetSnapshotRef.current = JSON.parse(JSON.stringify(stabilizedAsset));
    const hash = computeAssetContentHash(stabilizedAsset);
    savedAssetHashRef.current = hash;
    setPendingChanges(false);
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  /**
   * Safe setActiveAsset with confirmation guard if there are unsaved pending changes
   */
  const setActiveAsset = useCallback(
    (newAsset: Forge3DAsset | null, force = false) => {
      if (!force && pendingChanges && activeAsset && newAsset && activeAsset.name !== newAsset.name) {
        setPendingSwitchTarget(newAsset);
        setShowUnsavedModal(true);
        return;
      }
      applyActiveAssetDirectly(newAsset);
    },
    [pendingChanges, activeAsset, applyActiveAssetDirectly]
  );

  const confirmSwitchDiscard = useCallback(() => {
    setShowUnsavedModal(false);
    if (pendingSwitchTarget) {
      applyActiveAssetDirectly(pendingSwitchTarget);
      setPendingSwitchTarget(null);
      setNotification({
        type: 'info',
        message: 'Cambios descartados. Se abrió el modelo seleccionado.',
      });
    } else if (savedAssetSnapshotRef.current) {
      // Revert in-memory active asset to the exact persisted baseline snapshot
      const restored = JSON.parse(JSON.stringify(savedAssetSnapshotRef.current)) as Forge3DAsset;
      setActiveAssetState(restored);
      setSelectedPart(findMatchingPart(restored.parts, selectedPart));
      setUndoStack([]);
      setRedoStack([]);
      setPendingChanges(false);
      setNotification({
        type: 'info',
        message: 'Modificaciones descartadas. Se restauró el último estado guardado.',
      });
    } else {
      setPendingChanges(false);
    }

    if (pendingSwitchTab) {
      setActiveTab(pendingSwitchTab);
      setPendingSwitchTab(null);
    }
  }, [pendingSwitchTarget, pendingSwitchTab, selectedPart, applyActiveAssetDirectly]);

  const cancelSwitch = useCallback(() => {
    setShowUnsavedModal(false);
    setPendingSwitchTarget(null);
    setPendingSwitchTab(null);
  }, []);

  // Fetch asset library from backend
  const fetchAssetLibrary = useCallback(async () => {
    setLoadingLibrary(true);
    try {
      const res = await fetch('/api/v1/assets');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.assets)) {
          setAssetLibrary(data.assets);
          if (!activeAsset && data.assets.length > 0) {
            applyActiveAssetDirectly(data.assets[0]);
          }
        }
      }
    } catch (err) {
      console.warn('Error fetching asset library:', err);
    } finally {
      setLoadingLibrary(false);
    }
  }, [activeAsset, applyActiveAssetDirectly]);

  /**
   * Refreshes bridge and checks backend connectivity with real timing and status codes
   */
  const refreshBridgeStatus = useCallback(async () => {
    const startTime = performance.now();
    try {
      const [bridgeRes, healthRes] = await Promise.allSettled([
        fetch('/api/v1/bridge/status'),
        fetch('/api/v1/health'),
      ]);

      const latencyMs = Math.round(performance.now() - startTime);
      let updatedBridge: Partial<BridgeHealthStatus> = {};
      let backendDiag: BackendDiagnostics = {
        status: 'checking',
        lastCheckedAt: new Date().toLocaleTimeString(),
        latencyMs,
      };

      if (healthRes.status === 'fulfilled') {
        const hRes = healthRes.value;
        if (hRes.ok) {
          backendDiag = {
            status: 'connected',
            statusCode: hRes.status,
            lastCheckedAt: new Date().toLocaleTimeString(),
            latencyMs,
            error: null,
          };
        } else {
          backendDiag = {
            status: 'error',
            statusCode: hRes.status,
            lastCheckedAt: new Date().toLocaleTimeString(),
            latencyMs,
            error: `Error HTTP ${hRes.status}: ${hRes.statusText}`,
          };
        }
      } else {
        backendDiag = {
          status: 'disconnected',
          statusCode: undefined,
          lastCheckedAt: new Date().toLocaleTimeString(),
          latencyMs,
          error: healthRes.reason?.message || 'Servidor backend inaccesible',
        };
      }

      if (bridgeRes.status === 'fulfilled' && bridgeRes.value.ok) {
        const bridgeData = await bridgeRes.value.json();
        updatedBridge = { ...bridgeData };
      }

      setBridgeStatus((prev) => ({
        ...prev,
        ...updatedBridge,
        backend: backendDiag,
        rojo: {
          ...prev.rojo,
          ...(updatedBridge.rojo || {}),
        },
        robloxStudio: {
          ...prev.robloxStudio,
          ...(updatedBridge.robloxStudio || {}),
        },
      }));
    } catch (err: any) {
      setBridgeStatus((prev) => ({
        ...prev,
        backend: {
          status: 'disconnected',
          lastCheckedAt: new Date().toLocaleTimeString(),
          error: err?.message || 'Error de red',
        },
      }));
    }
  }, []);

  // Poll bridge status every 4 seconds
  useEffect(() => {
    refreshBridgeStatus();
    fetchAssetLibrary();
    const interval = setInterval(refreshBridgeStatus, 4000);
    return () => clearInterval(interval);
  }, [refreshBridgeStatus, fetchAssetLibrary]);

  // Auto-clear notification after 4 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  /**
   * Applies an asset change with accurate geometry metrics and deep snapshot cloning
   */
  const applyAssetChange = useCallback(
    (
      updatedAsset: Forge3DAsset,
      summary: string,
      operationType: OperationHistoryEntry['operationType'] = 'transform_pos_rot'
    ) => {
      if (!activeAsset) {
        applyActiveAssetDirectly(updatedAsset);
        return;
      }

      // Deep clean snapshot to prevent mutable reference contamination
      const snapshot = JSON.parse(JSON.stringify(activeAsset)) as Forge3DAsset;
      setUndoStack((prev) => [snapshot, ...prev].slice(0, 25));
      setRedoStack([]); // Clear redo stack on new operation branch

      const beforeMetrics = calculateAssetMetrics(activeAsset);
      const afterMetrics = calculateAssetMetrics(updatedAsset);

      const stabilizedParts = ensureStablePartIds(updatedAsset.parts || [], updatedAsset.name);
      const finalAsset: Forge3DAsset = {
        ...updatedAsset,
        parts: stabilizedParts,
      };

      const historyEntry: OperationHistoryEntry = {
        id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toLocaleTimeString(),
        operationType,
        partName: selectedPart?.name || 'Modelo Completo',
        summary,
        vertexBefore: beforeMetrics.vertices,
        vertexAfter: afterMetrics.vertices,
        triangleBefore: beforeMetrics.triangles,
        triangleAfter: afterMetrics.triangles,
        snapshot,
      };

      setOperationHistory((prev) => [historyEntry, ...prev].slice(0, 30));
      setActiveAssetState(finalAsset);

      // Check current hash against saved baseline
      const currentHash = computeAssetContentHash(finalAsset);
      setPendingChanges(currentHash !== savedAssetHashRef.current);

      // Preserve selection using stable identifiers
      if (selectedPart) {
        setSelectedPart(findMatchingPart(stabilizedParts, selectedPart));
      }
    },
    [activeAsset, selectedPart, applyActiveAssetDirectly]
  );

  const undo = useCallback(() => {
    if (undoStack.length === 0 || !activeAsset) return;
    const [previousState, ...restUndo] = undoStack;
    const currentSnapshot = JSON.parse(JSON.stringify(activeAsset)) as Forge3DAsset;

    setRedoStack((prev) => [currentSnapshot, ...prev]);
    setUndoStack(restUndo);
    setActiveAssetState(previousState);

    // Re-check hash after undo
    const newHash = computeAssetContentHash(previousState);
    setPendingChanges(newHash !== savedAssetHashRef.current);

    if (selectedPart) {
      setSelectedPart(findMatchingPart(previousState.parts, selectedPart));
    }
    setNotification({ type: 'info', message: 'Operación deshecha' });
  }, [undoStack, activeAsset, selectedPart]);

  const redo = useCallback(() => {
    if (redoStack.length === 0 || !activeAsset) return;
    const [nextState, ...restRedo] = redoStack;
    const currentSnapshot = JSON.parse(JSON.stringify(activeAsset)) as Forge3DAsset;

    setUndoStack((prev) => [currentSnapshot, ...prev]);
    setRedoStack(restRedo);
    setActiveAssetState(nextState);

    // Re-check hash after redo
    const newHash = computeAssetContentHash(nextState);
    setPendingChanges(newHash !== savedAssetHashRef.current);

    if (selectedPart) {
      setSelectedPart(findMatchingPart(nextState.parts, selectedPart));
    }
    setNotification({ type: 'info', message: 'Operación rehecha' });
  }, [redoStack, activeAsset, selectedPart]);

  /**
   * Saves asset to disk / Rojo and updates saved hash baseline only upon true persistence
   */
  const saveAssetToDisk = useCallback(
    async (saveToRojo = true): Promise<boolean> => {
      if (!activeAsset) return false;
      try {
        const res = await fetch('/api/v1/assets/rebuild-luau', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asset: activeAsset,
            save_to_rojo: saveToRojo,
            save_to_library: true,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.asset) {
            const savedAsset: Forge3DAsset = {
              ...data.asset,
              parts: ensureStablePartIds(data.asset.parts || [], data.asset.name),
            };

            setActiveAssetState(savedAsset);
            // Update baseline snapshot & hash - pending changes cleanly cleared
            savedAssetSnapshotRef.current = JSON.parse(JSON.stringify(savedAsset));
            savedAssetHashRef.current = computeAssetContentHash(savedAsset);
            setPendingChanges(false);

            fetchAssetLibrary();
            setNotification({
              type: 'success',
              message: `Modelo '${savedAsset.name}' guardado correctamente.`,
            });
            return true;
          }
        }
        throw new Error(`Respuesta no exitosa (${res.status})`);
      } catch (err: any) {
        // Retain changes on failure
        setNotification({
          type: 'error',
          message: `Error al guardar modelo: ${err.message || 'Error de conexión'}. Los cambios se mantienen en sesión.`,
        });
        return false;
      }
    },
    [activeAsset, fetchAssetLibrary]
  );

  const confirmSwitchSaveAndProceed = useCallback(async () => {
    const success = await saveAssetToDisk(true);
    if (success) {
      setShowUnsavedModal(false);
      if (pendingSwitchTarget) {
        applyActiveAssetDirectly(pendingSwitchTarget);
        setPendingSwitchTarget(null);
      }
      if (pendingSwitchTab) {
        setActiveTab(pendingSwitchTab);
        setPendingSwitchTab(null);
      }
    }
  }, [saveAssetToDisk, pendingSwitchTarget, pendingSwitchTab, applyActiveAssetDirectly]);

  /**
   * Pushes model to Roblox Studio via Local Bridge with strictly verified operation states
   */
  const pushToStudio = useCallback(
    async (
      targetAsset?: Forge3DAsset
    ): Promise<{ success: boolean; appliedInStudio: boolean; message: string; taskId?: string }> => {
      const assetToPush = targetAsset || activeAsset;
      if (!assetToPush) {
        return { success: false, appliedInStudio: false, message: 'No hay ningún modelo activo para enviar.' };
      }

      // Step 1: Preparing
      setCurrentSyncStatus({
        state: 'preparing',
        operation: 'push',
        message: 'Preparando paquete de partes 3D y verificando integridad...',
        timestamp: new Date().toLocaleTimeString(),
      });

      let rojoSaved = false;
      let rebuildError: string | null = null;

      try {
        // Step 2: Ensure saved in Rojo disk with explicit response check
        const rebuildRes = await fetch('/api/v1/assets/rebuild-luau', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asset: assetToPush,
            save_to_rojo: true,
            save_to_library: true,
          }),
        });

        if (rebuildRes.ok) {
          const rebuildData = await rebuildRes.json();
          if (rebuildData.asset) {
            rojoSaved = true;
            savedAssetSnapshotRef.current = JSON.parse(JSON.stringify(rebuildData.asset));
            savedAssetHashRef.current = computeAssetContentHash(rebuildData.asset);
            setPendingChanges(false);
          } else {
            rebuildError = 'El backend no devolvió el asset guardado.';
          }
        } else {
          const errData = await rebuildRes.json().catch(() => ({}));
          rebuildError = errData.error || `HTTP ${rebuildRes.status}`;
        }
      } catch (err: any) {
        rebuildError = err.message || 'Error de red al guardar en disco Rojo';
      }

      if (!rojoSaved) {
        const errMsg = `Fallo al guardar en disco Rojo: ${rebuildError || 'Error desconocido'}. Envío a Studio cancelado.`;
        setCurrentSyncStatus({
          state: 'error',
          operation: 'push',
          message: errMsg,
          timestamp: new Date().toLocaleTimeString(),
        });
        const errItem: SyncHistoryItem = {
          id: `sync-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          type: 'push',
          modelName: assetToPush.name,
          partCount: assetToPush.parts.length,
          status: 'error',
          details: errMsg,
        };
        setSyncHistory((prev) => [errItem, ...prev].slice(0, 20));
        setNotification({ type: 'error', message: errMsg });
        return { success: false, appliedInStudio: false, message: errMsg };
      }

      // Step 3: Sending to Bridge
      try {
        setCurrentSyncStatus({
          state: 'sending',
          operation: 'push',
          message: 'Enviando solicitud al puente local (127.0.0.1:48720)...',
          timestamp: new Date().toLocaleTimeString(),
        });

        const res = await fetch('/api/v1/bridge/enqueue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'studio.reconstruct_model',
            payload: {
              model_name: assetToPush.name,
              parts: assetToPush.parts,
              conflict_policy: 'smart_merge',
              target_parent: 'Workspace',
            },
            wait_for_completion: true,
            timeout_ms: 18000,
          }),
        });

        if (!res.ok) {
          throw new Error(`Puente local devolvió estado HTTP ${res.status}`);
        }

        const taskResult = await res.json();
        const taskId = taskResult.taskId;
        const taskStatus = taskResult.status;

        // ONLY completed is a true success applied in Studio
        if (taskStatus === 'completed' && taskResult.result?.status !== 'error') {
          const successMsg = `Modelo '${assetToPush.name}' aplicado y verificado en Roblox Studio (${assetToPush.parts.length} piezas).`;
          setCurrentSyncStatus({
            state: 'applied_successfully',
            operation: 'push',
            taskId,
            message: successMsg,
            details: taskResult.result?.details || 'Completado por el plugin v2.2.0',
            timestamp: new Date().toLocaleTimeString(),
          });

          const successItem: SyncHistoryItem = {
            id: `sync-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: 'push',
            modelName: assetToPush.name,
            partCount: assetToPush.parts.length,
            status: 'applied_successfully',
            details: successMsg,
            taskId,
          };
          setSyncHistory((prev) => [successItem, ...prev].slice(0, 20));
          setNotification({ type: 'success', message: successMsg });
          return { success: true, appliedInStudio: true, message: successMsg, taskId };
        } else if (taskStatus === 'awaiting_studio_confirmation' || taskStatus === 'queued') {
          // Queued in Bridge: NOT applied yet in Studio
          const queuedMsg = `Solicitud en cola en el puente local (ID: ${taskId || 'N/A'}). Pendiente de ejecución en Studio.`;
          setCurrentSyncStatus({
            state: 'awaiting_studio',
            operation: 'push',
            taskId,
            message: queuedMsg,
            details: 'Abre Roblox Studio con el plugin Forge AI Studio activo para procesar la cola.',
            timestamp: new Date().toLocaleTimeString(),
          });

          const queuedItem: SyncHistoryItem = {
            id: `sync-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: 'push',
            modelName: assetToPush.name,
            partCount: assetToPush.parts.length,
            status: 'awaiting_studio',
            details: queuedMsg,
            taskId,
          };
          setSyncHistory((prev) => [queuedItem, ...prev].slice(0, 20));
          setNotification({ type: 'info', message: queuedMsg });
          return { success: false, appliedInStudio: false, message: queuedMsg, taskId };
        } else {
          const errMsg = taskResult.error || taskResult.result?.error || 'Roblox Studio no pudo aplicar el modelo';
          setCurrentSyncStatus({
            state: 'error',
            operation: 'push',
            taskId,
            message: errMsg,
            timestamp: new Date().toLocaleTimeString(),
          });

          const errorItem: SyncHistoryItem = {
            id: `sync-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: 'push',
            modelName: assetToPush.name,
            partCount: assetToPush.parts.length,
            status: 'error',
            details: errMsg,
            taskId,
          };
          setSyncHistory((prev) => [errorItem, ...prev].slice(0, 20));
          setNotification({ type: 'error', message: errMsg });
          return { success: false, appliedInStudio: false, message: errMsg, taskId };
        }
      } catch (err: any) {
        // Differentiate bridge failure: Model was saved to Rojo, but bridge transfer failed
        const bridgeMsg = `Modelo guardado en disco Rojo, pero el puente local (puerto 48720) no respondió: ${err?.message || 'Inicia npm run bridge'}.`;
        setCurrentSyncStatus({
          state: 'error',
          operation: 'push',
          message: bridgeMsg,
          details: err?.message,
          timestamp: new Date().toLocaleTimeString(),
        });

        const fallbackItem: SyncHistoryItem = {
          id: `sync-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          type: 'push',
          modelName: assetToPush.name,
          partCount: assetToPush.parts.length,
          status: 'error',
          details: bridgeMsg,
        };
        setSyncHistory((prev) => [fallbackItem, ...prev].slice(0, 20));
        setNotification({ type: 'warning', message: bridgeMsg });
        return { success: false, appliedInStudio: false, message: bridgeMsg };
      }
    },
    [activeAsset]
  );

  /**
   * Pulls model from Roblox Studio via Bridge or Rojo with differentiated states
   */
  const pullFromStudio = useCallback(async (): Promise<{
    success: boolean;
    message: string;
    asset?: Forge3DAsset;
  }> => {
    setCurrentSyncStatus({
      state: 'sending',
      operation: 'pull',
      message: 'Consultando selección activa en Roblox Studio...',
      timestamp: new Date().toLocaleTimeString(),
    });

    try {
      const res = await fetch('/api/v1/assets/pull-from-rojo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_name: activeAsset?.name || 'StudioModel',
        }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.asset) {
        const stabilized = {
          ...data.asset,
          parts: ensureStablePartIds(data.asset.parts || [], data.asset.name),
        };

        applyAssetChange(stabilized, 'Sincronizado desde Roblox Studio', 'incremental_sync');
        const msg = `Se recibieron ${stabilized.parts.length} piezas desde Roblox Studio con éxito.`;

        setCurrentSyncStatus({
          state: 'applied_successfully',
          operation: 'pull',
          message: msg,
          timestamp: new Date().toLocaleTimeString(),
        });

        const pullItem: SyncHistoryItem = {
          id: `sync-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          type: 'pull',
          modelName: stabilized.name,
          partCount: stabilized.parts.length,
          status: 'applied_successfully',
          details: msg,
        };
        setSyncHistory((prev) => [pullItem, ...prev].slice(0, 20));

        setNotification({ type: 'success', message: msg });
        return { success: true, message: msg, asset: stabilized };
      } else {
        const errorMsg = data.message || 'No se pudieron extraer cambios desde Roblox Studio.';
        setCurrentSyncStatus({
          state: 'applied_partially',
          operation: 'pull',
          message: errorMsg,
          timestamp: new Date().toLocaleTimeString(),
        });

        setNotification({ type: 'warning', message: errorMsg });
        return { success: false, message: errorMsg };
      }
    } catch (err: any) {
      const errDetail = err.message || 'Error al comunicar con Roblox Studio.';
      setCurrentSyncStatus({
        state: 'error',
        operation: 'pull',
        message: errDetail,
        timestamp: new Date().toLocaleTimeString(),
      });

      setNotification({ type: 'error', message: errDetail });
      return { success: false, message: errDetail };
    }
  }, [activeAsset, applyAssetChange]);

  return (
    <ForgeContext.Provider
      value={{
        uiMode,
        setUiMode,
        activeTab,
        setActiveTab,
        safeNavigateTab,
        activeAsset,
        setActiveAsset,
        selectedPart,
        setSelectedPart,
        assetLibrary,
        loadingLibrary,
        fetchAssetLibrary,
        undoStack,
        redoStack,
        operationHistory,
        applyAssetChange,
        undo,
        redo,
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        pendingChanges,
        saveAssetToDisk,
        showUnsavedModal,
        pendingSwitchTarget,
        pendingSwitchTab,
        confirmSwitchDiscard,
        confirmSwitchSaveAndProceed,
        cancelSwitch,
        bridgeStatus,
        refreshBridgeStatus,
        currentSyncStatus,
        pushToStudio,
        pullFromStudio,
        syncHistory,
        notification,
        setNotification,
      }}
    >
      {children}
    </ForgeContext.Provider>
  );
};

export const useForge = (): ForgeContextType => {
  const context = useContext(ForgeContext);
  if (!context) {
    throw new Error('useForge must be used within a ForgeProvider');
  }
  return context;
};
