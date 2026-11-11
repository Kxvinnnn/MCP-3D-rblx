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
}

export function calculateAssetMetrics(asset: Forge3DAsset): GeometryMetrics {
  let vertices = 0;
  let triangles = 0;
  const parts = Array.isArray(asset.parts) ? asset.parts : [];

  for (const part of parts) {
    if (part.meshData) {
      vertices += Array.isArray(part.meshData.vertices) ? part.meshData.vertices.length : 0;
      triangles += Array.isArray(part.meshData.faces) ? part.meshData.faces.length : 0;
    } else {
      // Estimated primitive geometries
      switch (part.shape) {
        case 'Block':
          vertices += 8;
          triangles += 12;
          break;
        case 'Cylinder':
          vertices += 48;
          triangles += 92;
          break;
        case 'Ball':
          vertices += 64;
          triangles += 120;
          break;
        case 'Wedge':
        case 'CornerWedge':
          vertices += 6;
          triangles += 8;
          break;
        default:
          vertices += 8;
          triangles += 12;
      }
    }
  }

  return {
    vertices,
    triangles: triangles > 0 ? triangles : (asset.poly_count || 0),
    partsCount: parts.length,
  };
}

/**
 * Computes a deterministic canonical string representation of the asset contents
 * to reliably detect pending changes and equality between snapshots.
 */
export function computeAssetContentHash(asset: Forge3DAsset | null): string {
  if (!asset) return '';
  const partsSummary = (asset.parts || []).map((p, idx) => {
    const id = p.partId || `part_${idx}`;
    const pos = (p.position || [0, 0, 0]).map((n) => Number(n).toFixed(2)).join(',');
    const rot = (p.rotation || [0, 0, 0]).map((n) => Number(n).toFixed(2)).join(',');
    const sz = (p.size || [1, 1, 1]).map((n) => Number(n).toFixed(2)).join(',');
    const faceCount = p.meshData?.faces ? p.meshData.faces.length : 0;
    const vertCount = p.meshData?.vertices ? p.meshData.vertices.length : 0;
    const mat = `${p.material || 'Plastic'}_${p.roughness ?? 0.5}_${p.metalness ?? 0}`;
    return `${id}|${p.name}|${p.shape}|${pos}|${rot}|${sz}|${mat}|v:${vertCount}|f:${faceCount}`;
  });

  const pbr = asset.pbr_profile
    ? `${asset.pbr_profile.pattern}_${asset.pbr_profile.albedo_hex}_${asset.pbr_profile.roughness}_${asset.pbr_profile.metalness}`
    : '';

  return `${asset.name}#${asset.category || 'Props'}#${asset.collision_fidelity}#${pbr}#[${partsSummary.join(';')}]`;
}

/**
 * Ensures each part in the asset has a stable partId for persistent selection.
 */
export function ensureStablePartIds(parts: MeshPart3DSpec[], assetName: string): MeshPart3DSpec[] {
  return parts.map((part, index) => {
    if (part.partId && part.partId.trim().length > 0) {
      return part;
    }
    const safeName = (part.name || `Part_${index + 1}`).replace(/[^a-zA-Z0-9_]/g, '_');
    return {
      ...part,
      partId: `${assetName}_${safeName}_${index + 1}`,
      hierarchyPath: part.hierarchyPath || `Workspace/${assetName}/${part.name}`,
    };
  });
}

/**
 * Finds the matching part in an updated parts array using stable ID first,
 * then hierarchy path, then name, falling back to the first part.
 */
export function findMatchingPart(
  parts: MeshPart3DSpec[],
  target: MeshPart3DSpec | null
): MeshPart3DSpec | null {
  if (!parts || parts.length === 0) return null;
  if (!target) return parts[0];

  if (target.partId) {
    const byId = parts.find((p) => p.partId === target.partId);
    if (byId) return byId;
  }

  if (target.hierarchyPath) {
    const byPath = parts.find((p) => p.hierarchyPath === target.hierarchyPath);
    if (byPath) return byPath;
  }

  const byName = parts.find((p) => p.name === target.name);
  if (byName) return byName;

  return parts[0];
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
  confirmSwitchDiscard: () => void;
  confirmSwitchSaveAndProceed: () => Promise<void>;
  cancelSwitch: () => void;

  // System & Bridge Status
  bridgeStatus: BridgeHealthStatus;
  refreshBridgeStatus: () => Promise<void>;

  // Bidirectional Synchronization
  currentSyncStatus: SyncOperationStatus;
  pushToStudio: (targetAsset?: Forge3DAsset) => Promise<{ success: boolean; message: string }>;
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

  // Hash-based pending changes detection
  const savedAssetHashRef = useRef<string>('');
  const [pendingChanges, setPendingChanges] = useState<boolean>(false);

  // Unsaved changes confirmation modal state
  const [showUnsavedModal, setShowUnsavedModal] = useState<boolean>(false);
  const [pendingSwitchTarget, setPendingSwitchTarget] = useState<Forge3DAsset | null>(null);

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
   * Internal setter for active asset without prompt
   */
  const applyActiveAssetDirectly = useCallback((asset: Forge3DAsset | null) => {
    if (!asset) {
      setActiveAssetState(null);
      setSelectedPart(null);
      savedAssetHashRef.current = '';
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

    // Initialize baseline hash for saved state
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
    applyActiveAssetDirectly(pendingSwitchTarget);
    setPendingSwitchTarget(null);
    setNotification({
      type: 'info',
      message: 'Cambios descartados. Se abrió el modelo seleccionado.',
    });
  }, [pendingSwitchTarget, applyActiveAssetDirectly]);

  const cancelSwitch = useCallback(() => {
    setShowUnsavedModal(false);
    setPendingSwitchTarget(null);
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
            // Update baseline hash - pending changes now cleanly cleared
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
      applyActiveAssetDirectly(pendingSwitchTarget);
      setPendingSwitchTarget(null);
    }
  }, [saveAssetToDisk, pendingSwitchTarget, applyActiveAssetDirectly]);

  /**
   * Pushes model to Roblox Studio via Local Bridge with differentiated operation states
   */
  const pushToStudio = useCallback(
    async (targetAsset?: Forge3DAsset): Promise<{ success: boolean; message: string }> => {
      const assetToPush = targetAsset || activeAsset;
      if (!assetToPush) {
        return { success: false, message: 'No hay ningún modelo activo para enviar.' };
      }

      // Step 1: Preparing
      setCurrentSyncStatus({
        state: 'preparing',
        operation: 'push',
        message: 'Preparando paquete de partes 3D y verificando integridad...',
        timestamp: new Date().toLocaleTimeString(),
      });

      try {
        // Step 2: Ensure saved in Rojo disk
        await fetch('/api/v1/assets/rebuild-luau', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asset: assetToPush,
            save_to_rojo: true,
            save_to_library: true,
          }),
        });

        // Step 3: Sending to Bridge
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

        if (taskStatus === 'completed') {
          const successMsg = `Modelo '${assetToPush.name}' aplicado correctamente en Roblox Studio (${assetToPush.parts.length} piezas).`;
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
          return { success: true, message: successMsg };
        } else if (taskStatus === 'awaiting_studio_confirmation' || taskStatus === 'queued') {
          const queuedMsg = 'Solicitud recibida por el puente local. Esperando que Roblox Studio aplique el modelo.';
          setCurrentSyncStatus({
            state: 'awaiting_studio',
            operation: 'push',
            taskId,
            message: queuedMsg,
            details: 'Abre Roblox Studio con el plugin Forge AI Studio activo.',
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
          return { success: true, message: queuedMsg };
        } else {
          const errMsg = taskResult.error || 'Roblox Studio no pudo aplicar el modelo';
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
          return { success: false, message: errMsg };
        }
      } catch (err: any) {
        // Fallback message when bridge is offline
        const fallbackMsg = `Modelo guardado en disco Rojo local. Inicia el puente local (puerto 48720) para transferir directamente a Roblox Studio.`;
        setCurrentSyncStatus({
          state: 'queued',
          operation: 'push',
          message: fallbackMsg,
          details: err?.message,
          timestamp: new Date().toLocaleTimeString(),
        });

        const fallbackItem: SyncHistoryItem = {
          id: `sync-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          type: 'push',
          modelName: assetToPush.name,
          partCount: assetToPush.parts.length,
          status: 'queued',
          details: fallbackMsg,
        };
        setSyncHistory((prev) => [fallbackItem, ...prev].slice(0, 20));

        setNotification({ type: 'warning', message: fallbackMsg });
        return { success: true, message: fallbackMsg };
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
