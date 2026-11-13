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
import {
  computeCanonicalAssetHash,
  computeAppearanceHash,
  computePropertiesHash,
  getAssetIdentityKey,
  toCanonicalJsonValue,
} from '../utils/canonicalHash.ts';
import {
  validateRobloxGeometry,
  isTriangleNonDegenerate3D,
  countValidTrianglesInFace,
} from '../utils/robloxGeometryValidator.ts';
import {
  computeIncrementalDiff,
  ensurePersistentPartIdsForParts,
  partAppearanceHash,
  partPropertiesHash,
} from '../utils/incrementalSync.ts';
import {
  verifyPersistedAssetContent,
  verifyStudioApplicationReceipt,
  reconcileReconstructedModelFromStudio,
  type StudioApplicationReceipt,
  type StudioModelReconstructionComparison,
} from '../utils/receiptVerification.ts';

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
  | 'timeout'
  | 'conflict'
  | 'cancelled';

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
 * Calculates geometry metrics, distinguishing between real mesh vertex/face data
 * (with scale-relative geometric area and index validation via 3D Ear Clipping) and estimated primitive shapes.
 */
export function calculateAssetMetrics(asset: Forge3DAsset): GeometryMetrics {
  let realVertices = 0;
  let realTriangles = 0;
  let estimatedVertices = 0;
  let estimatedTriangles = 0;
  let hasEstimatedGeometry = false;

  const parts = Array.isArray(asset.parts) ? asset.parts : [];

  for (const part of parts) {
    const activeMesh =
      part.meshData && Array.isArray(part.meshData.vertices) && part.meshData.vertices.length > 0
        ? part.meshData
        : part.baseMeshData && Array.isArray(part.baseMeshData.vertices) && part.baseMeshData.vertices.length > 0
        ? part.baseMeshData
        : null;

    if (activeMesh) {
      realVertices += activeMesh.vertices.length;
      const vertices = activeMesh.vertices;
      const faces = activeMesh.faces;

      if (Array.isArray(faces)) {
        if (faces.length > 0 && Array.isArray(faces[0])) {
          // Polygon face array: validate indices and compute non-degenerate triangles via 3D Ear Clipping
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
              Number.isInteger(i0) &&
              Number.isInteger(i1) &&
              Number.isInteger(i2) &&
              i0 >= 0 && i0 < vertices.length &&
              i1 >= 0 && i1 < vertices.length &&
              i2 >= 0 && i2 < vertices.length &&
              i0 !== i1 && i0 !== i2 && i1 !== i2
            ) {
              if (isTriangleNonDegenerate3D(vertices[i0], vertices[i1], vertices[i2])) {
                realTriangles++;
              }
            }
          }
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
 * Computes a 64-character SHA-256 cryptographic digest of the canonical JSON representation
 * of the 3D asset model incorporating all model metadata, PBR profiles, part hierarchy, transforms, visual,
 * physical properties, and vertex/face/normal/UV buffers.
 */
export function computeAssetContentHash(asset: Forge3DAsset | null): string {
  if (!asset) return '';
  return computeCanonicalAssetHash(asset);
}

/**
 * Ensures each part in the asset has a truly persistent, deterministic, order-independent `partId`.
 * Preserves existing `partId`s across renames and reordering, and deterministically derives missing IDs
 * from canonical part content so stabilizing the same model twice yields identical IDs.
 */
export function ensureStablePartIds(parts: MeshPart3DSpec[], assetName: string): MeshPart3DSpec[] {
  return ensurePersistentPartIdsForParts(parts, assetName);
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

export {
  verifyPersistedAssetContent,
  type StudioApplicationReceipt,
  verifyStudioApplicationReceipt,
  type StudioModelReconstructionComparison,
  reconcileReconstructedModelFromStudio,
};

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

  // Local Draft Recovery
  hasRecoverableDraft: boolean;
  draftTimestamp: number | null;
  recoverDraft: () => void;
  discardDraft: () => void;

  // Conflict Resolution
  activeConflict: { localAsset: Forge3DAsset; remoteAsset: Forge3DAsset } | null;
  resolveConflict: (resolution: 'keep_local' | 'accept_remote') => Promise<boolean>;

  // System & Bridge Status
  bridgeStatus: BridgeHealthStatus;
  refreshBridgeStatus: () => Promise<void>;

  // Bidirectional Synchronization
  currentSyncStatus: SyncOperationStatus;
  pushToStudio: (targetAsset?: Forge3DAsset) => Promise<{ success: boolean; appliedInStudio: boolean; message: string; taskId?: string }>;
  reconcileStudioTaskReceipt: (taskId: string) => Promise<{ success: boolean; status: StudioApplicationReceipt['status']; message: string }>;
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

  // Local Draft Recovery state
  const [hasRecoverableDraft, setHasRecoverableDraft] = useState<boolean>(false);
  const [draftTimestamp, setDraftTimestamp] = useState<number | null>(null);

  // Active Conflict state
  const [activeConflict, setActiveConflict] = useState<{ localAsset: Forge3DAsset; remoteAsset: Forge3DAsset } | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const pendingConfirmationsByTaskIdRef = useRef<
    Map<
      string,
      {
        taskId: string;
        operationId: string;
        modelName: string;
        expectedModelHash: string;
        expectedAsset: Forge3DAsset;
        pendingDeletionPartIds: string[];
        resolved: boolean;
      }
    >
  >(new Map());

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Check for recoverable draft on mount
  useEffect(() => {
    try {
      const rawDraft = localStorage.getItem('forge_active_draft');
      if (rawDraft) {
        const parsed = JSON.parse(rawDraft);
        if (parsed && parsed.asset && Array.isArray(parsed.asset.parts)) {
          setHasRecoverableDraft(true);
          setDraftTimestamp(parsed.timestamp || Date.now());
        }
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Unsaved changes confirmation modal state
  const [showUnsavedModal, setShowUnsavedModal] = useState<boolean>(false);
  const [pendingSwitchTarget, setPendingSwitchTarget] = useState<Forge3DAsset | null>(null);
  const pendingSwitchToNullRef = useRef<boolean>(false);
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
   * Safe setActiveAsset with confirmation guard if there are unsaved pending changes.
   * Guards against:
   * 1. Switching to a different asset identity
   * 2. Switching to null (closing the active model) while pendingChanges is true
   * 3. Loading a different version/content of the same asset identity while pendingChanges is true
   */
  const setActiveAsset = useCallback(
    (newAsset: Forge3DAsset | null, force = false) => {
      if (!force && pendingChanges && activeAsset) {
        if (newAsset === null) {
          pendingSwitchToNullRef.current = true;
          setPendingSwitchTarget(null);
          setShowUnsavedModal(true);
          return;
        }

        const isDifferentIdentity =
          getAssetIdentityKey(activeAsset) !== getAssetIdentityKey(newAsset);
        const stabilizedIncoming: Forge3DAsset = {
          ...newAsset,
          parts: ensureStablePartIds(newAsset.parts || [], newAsset.name),
        };
        const isDifferentContent =
          computeAssetContentHash(activeAsset) !== computeAssetContentHash(stabilizedIncoming);

        if (isDifferentIdentity || isDifferentContent) {
          pendingSwitchToNullRef.current = false;
          setPendingSwitchTarget(newAsset);
          setShowUnsavedModal(true);
          return;
        }

        // Same identity AND identical content to current in-memory asset: keep current session & pendingChanges intact
        return;
      }
      pendingSwitchToNullRef.current = false;
      applyActiveAssetDirectly(newAsset);
    },
    [pendingChanges, activeAsset, applyActiveAssetDirectly]
  );

  const confirmSwitchDiscard = useCallback(() => {
    setShowUnsavedModal(false);
    if (pendingSwitchToNullRef.current) {
      pendingSwitchToNullRef.current = false;
      applyActiveAssetDirectly(null);
      setPendingSwitchTarget(null);
      setNotification({
        type: 'info',
        message: 'Cambios descartados. Se cerró el modelo activo.',
      });
    } else if (pendingSwitchTarget) {
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

    try {
      localStorage.removeItem('forge_active_draft');
    } catch {}
    setHasRecoverableDraft(false);
    setDraftTimestamp(null);

    if (pendingSwitchTab) {
      setActiveTab(pendingSwitchTab);
      setPendingSwitchTab(null);
    }
  }, [pendingSwitchTarget, pendingSwitchTab, selectedPart, applyActiveAssetDirectly]);

  const cancelSwitch = useCallback(() => {
    setShowUnsavedModal(false);
    pendingSwitchToNullRef.current = false;
    setPendingSwitchTarget(null);
    setPendingSwitchTab(null);
  }, []);

  /**
   * Recovers local draft while strictly validating baseHash and baseAsset against the current saved/remote version.
   * Never accepts unknown or diverged bases silently.
   */
  const recoverDraft = useCallback(() => {
    try {
      const rawDraft = localStorage.getItem('forge_active_draft');
      if (rawDraft) {
        const parsed = JSON.parse(rawDraft);
        if (parsed && parsed.asset) {
          const stabilizedParts = ensureStablePartIds(parsed.asset.parts || [], parsed.asset.name);
          const stabilizedDraft: Forge3DAsset = {
            ...parsed.asset,
            parts: stabilizedParts,
          };
          const draftHash = computeAssetContentHash(stabilizedDraft);
          const draftIdentity = parsed.identityKey || getAssetIdentityKey(stabilizedDraft);
          const draftBaseHash: string = typeof parsed.baseHash === 'string' ? parsed.baseHash.trim() : '';

          // Find current saved/remote version for this asset identity if available
          let currentSavedAsset: Forge3DAsset | null = null;
          if (
            savedAssetSnapshotRef.current &&
            getAssetIdentityKey(savedAssetSnapshotRef.current) === draftIdentity
          ) {
            currentSavedAsset = savedAssetSnapshotRef.current;
          } else if (
            activeAsset &&
            !pendingChanges &&
            getAssetIdentityKey(activeAsset) === draftIdentity
          ) {
            currentSavedAsset = activeAsset;
          } else {
            const libraryMatch = assetLibrary.find(
              (item) => getAssetIdentityKey(item) === draftIdentity
            );
            if (libraryMatch) {
              currentSavedAsset = {
                ...libraryMatch,
                parts: ensureStablePartIds(libraryMatch.parts || [], libraryMatch.name),
              };
            }
          }

          const currentSavedHash = currentSavedAsset
            ? computeAssetContentHash(currentSavedAsset)
            : '';

          // Case 1: A saved version exists for this asset identity, and the draft either lacks baseHash or its baseHash diverges
          if (
            currentSavedAsset &&
            currentSavedHash &&
            currentSavedHash !== draftHash &&
            (!draftBaseHash || draftBaseHash !== currentSavedHash)
          ) {
            savedAssetSnapshotRef.current = JSON.parse(JSON.stringify(currentSavedAsset));
            savedAssetHashRef.current = currentSavedHash;
            setActiveAssetState(stabilizedDraft);
            setSelectedPart(findMatchingPart(stabilizedParts, null));
            setPendingChanges(true);
            setActiveConflict({
              localAsset: stabilizedDraft,
              remoteAsset: currentSavedAsset,
            });
            const reasonDetail = !draftBaseHash
              ? 'El borrador carece de baseHash verificable frente al modelo guardado actual.'
              : `Base del borrador (${draftBaseHash.slice(0, 8)}) ≠ Versión guardada actual (${currentSavedHash.slice(0, 8)}).`;
            setCurrentSyncStatus({
              state: 'conflict',
              operation: 'merge',
              message:
                'Conflicto de borrador: El modelo guardado cambió o no coincide con la base del borrador local.',
              details: reasonDetail,
              timestamp: new Date().toLocaleTimeString(),
            });
            setNotification({
              type: 'warning',
              message:
                'Conflicto detectado: La versión guardada del modelo no coincide con la base del borrador.',
            });
            setHasRecoverableDraft(false);
            return;
          }

          // Case 2: No saved version in session/library, and draft has no verifiable baseAsset snapshot or missing baseHash
          const hasVerifiableBaseSnapshot =
            parsed.baseAsset &&
            typeof parsed.baseAsset === 'object' &&
            Array.isArray(parsed.baseAsset.parts);

          if (!currentSavedAsset && !hasVerifiableBaseSnapshot) {
            // Do not silently accept an unknown base; flag conflict so user explicitly decides
            const fallbackRemote: Forge3DAsset = {
              ...stabilizedDraft,
              parts: [],
            };
            savedAssetSnapshotRef.current = null;
            savedAssetHashRef.current = '';
            setActiveAssetState(stabilizedDraft);
            setSelectedPart(findMatchingPart(stabilizedParts, null));
            setPendingChanges(true);
            setActiveConflict({
              localAsset: stabilizedDraft,
              remoteAsset: fallbackRemote,
            });
            setCurrentSyncStatus({
              state: 'conflict',
              operation: 'merge',
              message:
                'Borrador con base desconocida: No se encontró el estado base original en la biblioteca ni en el snapshot.',
              details: `baseHash reportado: ${draftBaseHash || 'ausente'}. Confirma para persistir la versión local.`,
              timestamp: new Date().toLocaleTimeString(),
            });
            setNotification({
              type: 'warning',
              message:
                'Borrador de base desconocida: requiere confirmación antes de sobrescribir o sincronizar.',
            });
            setHasRecoverableDraft(false);
            return;
          }

          // Case 3: Verified base (either currentSavedAsset matches draftBaseHash, or parsed.baseAsset matches draftBaseHash)
          if (currentSavedAsset) {
            savedAssetSnapshotRef.current = JSON.parse(JSON.stringify(currentSavedAsset));
            savedAssetHashRef.current = currentSavedHash;
          } else if (hasVerifiableBaseSnapshot) {
            const stabilizedBase: Forge3DAsset = {
              ...parsed.baseAsset,
              parts: ensureStablePartIds(parsed.baseAsset.parts || [], parsed.baseAsset.name || stabilizedDraft.name),
            };
            const computedBaseSnapHash = computeAssetContentHash(stabilizedBase);
            if (draftBaseHash && draftBaseHash !== computedBaseSnapHash) {
              // Base snapshot and baseHash disagree -> conflict
              savedAssetSnapshotRef.current = stabilizedBase;
              savedAssetHashRef.current = computedBaseSnapHash;
              setActiveAssetState(stabilizedDraft);
              setSelectedPart(findMatchingPart(stabilizedParts, null));
              setPendingChanges(true);
              setActiveConflict({
                localAsset: stabilizedDraft,
                remoteAsset: stabilizedBase,
              });
              setCurrentSyncStatus({
                state: 'conflict',
                operation: 'merge',
                message: 'Conflicto de integridad en borrador: baseHash no coincide con baseAsset.',
                timestamp: new Date().toLocaleTimeString(),
              });
              setHasRecoverableDraft(false);
              return;
            }
            savedAssetSnapshotRef.current = stabilizedBase;
            savedAssetHashRef.current = computedBaseSnapHash;
          }

          setActiveAssetState(stabilizedDraft);
          setSelectedPart(findMatchingPart(stabilizedParts, null));
          setUndoStack([]);
          setRedoStack([]);
          setPendingChanges(draftHash !== savedAssetHashRef.current);
          setNotification({
            type: 'info',
            message: 'Borrador no guardado recuperado y verificado contra su base.',
          });
        }
      }
    } catch {
      setNotification({
        type: 'error',
        message: 'No se pudo recuperar el borrador local.',
      });
    }
    setHasRecoverableDraft(false);
  }, [activeAsset, pendingChanges, assetLibrary]);

  const discardDraft = useCallback(() => {
    try {
      localStorage.removeItem('forge_active_draft');
    } catch {}
    setHasRecoverableDraft(false);
    setDraftTimestamp(null);
    setNotification({
      type: 'info',
      message: 'Borrador descartado.',
    });
  }, []);

  // Fetch asset library from backend
  const fetchAssetLibrary = useCallback(async () => {
    if (!isMountedRef.current) return;
    setLoadingLibrary(true);
    try {
      const res = await fetch('/api/v1/assets');
      if (!isMountedRef.current) return;
      if (res.ok) {
        const data = await res.json();
        if (!isMountedRef.current) return;
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
      if (isMountedRef.current) {
        setLoadingLibrary(false);
      }
    }
  }, [activeAsset, applyActiveAssetDirectly]);

  /**
   * Resolves an active local vs remote conflict and synchronizes the chosen resolution
   */
  const resolveConflict = useCallback(
    async (resolution: 'keep_local' | 'accept_remote'): Promise<boolean> => {
      if (!activeConflict) return false;

      if (resolution === 'keep_local') {
        const localToPersist: Forge3DAsset = {
          ...activeConflict.localAsset,
          parts: ensureStablePartIds(activeConflict.localAsset.parts || [], activeConflict.localAsset.name),
        };
        const geoValidation = validateRobloxGeometry(localToPersist);
        if (!geoValidation.isValid) {
          const errorMsg = `No se puede sincronizar la versión local: ${geoValidation.errors.join('; ')}`;
          setCurrentSyncStatus({
            state: 'error',
            operation: 'merge',
            message: errorMsg,
            timestamp: new Date().toLocaleTimeString(),
          });
          setNotification({ type: 'error', message: errorMsg });
          return false;
        }

        try {
          const res = await fetch('/api/v1/assets/rebuild-luau', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              asset: localToPersist,
              save_to_rojo: true,
              save_to_library: true,
            }),
          });

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }

          const data = await res.json();
          const persistedCandidate: Forge3DAsset | undefined = data?.asset
            ? {
                ...data.asset,
                parts: ensureStablePartIds(data.asset.parts || [], data.asset.name),
              }
            : undefined;

          const verification = verifyPersistedAssetContent(localToPersist, persistedCandidate);
          if (!verification.valid || !persistedCandidate) {
            throw new Error(verification.reason || 'El servidor devolvió un modelo inválido.');
          }

          setActiveAssetState(persistedCandidate);
          savedAssetSnapshotRef.current = JSON.parse(JSON.stringify(persistedCandidate));
          savedAssetHashRef.current = computeAssetContentHash(persistedCandidate);
          setPendingChanges(false);
          setActiveConflict(null);

          try {
            localStorage.removeItem('forge_active_draft');
          } catch {}
          setHasRecoverableDraft(false);
          setDraftTimestamp(null);

          fetchAssetLibrary();

          setCurrentSyncStatus({
            state: 'applied_successfully',
            operation: 'merge',
            message: 'Conflicto resuelto: Versión local guardada y sincronizada en Rojo.',
            timestamp: new Date().toLocaleTimeString(),
          });
          setNotification({
            type: 'success',
            message: 'Se conservó y sincronizó la versión local del modelo.',
          });
          return true;
        } catch (err: any) {
          const errMsg = `Error al sincronizar la versión local: ${err?.message || 'Fallo de red'}. El conflicto sigue activo.`;
          setCurrentSyncStatus({
            state: 'error',
            operation: 'merge',
            message: errMsg,
            timestamp: new Date().toLocaleTimeString(),
          });
          setNotification({
            type: 'error',
            message: errMsg,
          });
          return false;
        }
      } else {
        const remote = activeConflict.remoteAsset;
        setActiveConflict(null);
        applyActiveAssetDirectly(remote);
        try {
          localStorage.removeItem('forge_active_draft');
        } catch {}
        setHasRecoverableDraft(false);
        setDraftTimestamp(null);
        setCurrentSyncStatus({
          state: 'applied_successfully',
          operation: 'pull',
          message: 'Conflicto resuelto: Se adoptó la versión remota.',
          timestamp: new Date().toLocaleTimeString(),
        });
        setNotification({
          type: 'success',
          message: 'Se cargó la versión remota y se actualizó la línea base.',
        });
        return true;
      }
    },
    [activeConflict, applyActiveAssetDirectly, fetchAssetLibrary]
  );

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

      if (!isMountedRef.current) return;
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
      if (!isMountedRef.current) return;
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
    (interval as any)?.unref?.();
    return () => clearInterval(interval);
  }, [refreshBridgeStatus, fetchAssetLibrary]);

  // Auto-clear notification after 4 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        if (isMountedRef.current) {
          setNotification(null);
        }
      }, 4000);
      (timer as any)?.unref?.();
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
      const isModified = currentHash !== savedAssetHashRef.current;
      setPendingChanges(isModified);

      // Persist draft to localStorage for crash/reload recovery with baseHash and baseAsset
      if (isModified) {
        try {
          const ts = Date.now();
          localStorage.setItem(
            'forge_active_draft',
            JSON.stringify({
              asset: finalAsset,
              timestamp: ts,
              baseHash: savedAssetHashRef.current,
              baseAsset: savedAssetSnapshotRef.current,
              identityKey: getAssetIdentityKey(finalAsset),
            })
          );
          setHasRecoverableDraft(true);
          setDraftTimestamp(ts);
        } catch {
          // Ignore storage quota errors
        }
      }

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
   * Saves asset to disk / Rojo and updates saved hash baseline only upon verified content persistence
   */
  const saveAssetToDisk = useCallback(
    async (saveToRojo = true): Promise<boolean> => {
      if (!activeAsset) return false;

      const stabilizedActive: Forge3DAsset = {
        ...activeAsset,
        parts: ensureStablePartIds(activeAsset.parts || [], activeAsset.name),
      };

      // Validate geometry before initiating save
      const geoValidation = validateRobloxGeometry(stabilizedActive);
      if (!geoValidation.isValid) {
        const errorMsg = `Validación geométrica falló: ${geoValidation.errors.join('; ')}`;
        setNotification({
          type: 'error',
          message: errorMsg,
        });
        return false;
      }

      try {
        const res = await fetch('/api/v1/assets/rebuild-luau', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asset: stabilizedActive,
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

            // Verify that returned asset content matches the sent asset
            const verification = verifyPersistedAssetContent(stabilizedActive, savedAsset);
            if (!verification.valid) {
              throw new Error(verification.reason || 'El contenido devuelto por el servidor no coincide con el enviado.');
            }

            setActiveAssetState(savedAsset);
            // Update baseline snapshot & hash - pending changes cleanly cleared
            savedAssetSnapshotRef.current = JSON.parse(JSON.stringify(savedAsset));
            savedAssetHashRef.current = computeAssetContentHash(savedAsset);
            setPendingChanges(false);

            // Clean draft on confirmed persistence
            try {
              localStorage.removeItem('forge_active_draft');
            } catch {}
            setHasRecoverableDraft(false);
            setDraftTimestamp(null);

            fetchAssetLibrary();
            setNotification({
              type: 'success',
              message: `Modelo '${savedAsset.name}' guardado y verificado correctamente.`,
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
      if (pendingSwitchToNullRef.current) {
        pendingSwitchToNullRef.current = false;
        applyActiveAssetDirectly(null);
        setPendingSwitchTarget(null);
      } else if (pendingSwitchTarget) {
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
   * Pushes model to Roblox Studio via Local Bridge with pre-flight geometry validation,
   * persisted Rojo verification, and strict Studio receipt verification (appliedPartCount, operationId, modelHash).
   * Does not clear pendingChanges until Studio confirms verifiable application.
   */
  const pushToStudio = useCallback(
    async (
      targetAsset?: Forge3DAsset
    ): Promise<{ success: boolean; appliedInStudio: boolean; message: string; taskId?: string }> => {
      const rawAssetToPush = targetAsset || activeAsset;
      if (!rawAssetToPush) {
        return { success: false, appliedInStudio: false, message: 'No hay ningún modelo activo para enviar.' };
      }

      const assetToPush: Forge3DAsset = {
        ...rawAssetToPush,
        parts: ensureStablePartIds(rawAssetToPush.parts || [], rawAssetToPush.name),
      };

      // Step 0: Pre-flight geometry validation before sending to Rojo or Studio
      const geoValidation = validateRobloxGeometry(assetToPush);
      if (!geoValidation.isValid) {
        const errMsg = `Envío cancelado por geometría inválida: ${geoValidation.errors.join('; ')}`;
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

      const expectedModelHash = computeAssetContentHash(assetToPush);

      // Step 1: Preparing
      setCurrentSyncStatus({
        state: 'preparing',
        operation: 'push',
        message: 'Preparando paquete de partes 3D y verificando integridad...',
        timestamp: new Date().toLocaleTimeString(),
      });

      let rojoSaved = false;
      let persistedRojoAsset: Forge3DAsset | null = null;
      let rebuildError: string | null = null;

      try {
        // Step 2: Ensure saved in Rojo disk with explicit response and content verification
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
            const candidateAsset: Forge3DAsset = {
              ...rebuildData.asset,
              parts: ensureStablePartIds(rebuildData.asset.parts || [], rebuildData.asset.name),
            };
            const verification = verifyPersistedAssetContent(assetToPush, candidateAsset);
            if (verification.valid) {
              rojoSaved = true;
              persistedRojoAsset = candidateAsset;
            } else {
              rebuildError = verification.reason || 'El modelo devuelto por Rojo no coincide con el enviado.';
            }
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

      if (!rojoSaved || !persistedRojoAsset) {
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

      // Step 3: Sending to Bridge with expectedModelHash & expected_part_count
      try {
        setCurrentSyncStatus({
          state: 'sending',
          operation: 'push',
          message: 'Enviando solicitud al puente local (127.0.0.1:48720)...',
          timestamp: new Date().toLocaleTimeString(),
        });

        const baselineForDiff = savedAssetSnapshotRef.current
          ? {
              ...savedAssetSnapshotRef.current,
              parts: ensureStablePartIds(savedAssetSnapshotRef.current.parts || [], savedAssetSnapshotRef.current.name),
            }
          : null;
        const incrementalDiff = baselineForDiff
          ? computeIncrementalDiff(baselineForDiff, assetToPush)
          : null;

        const res = await fetch('/api/v1/bridge/enqueue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'studio.reconstruct_model',
            payload: {
              name: assetToPush.name,
              model_name: assetToPush.name,
              model_hash: expectedModelHash,
              expected_part_count: assetToPush.parts.length,
              parts: assetToPush.parts,
              asset: assetToPush,
              incremental_diff: incrementalDiff,
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

        if (taskStatus === 'queued') {
          // Queued in Bridge: NOT applied yet in Studio -> do NOT mark synchronization as completed
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
        }

        const receiptVerification = verifyStudioApplicationReceipt(
          taskResult,
          taskId,
          assetToPush,
          expectedModelHash
        );

        if (receiptVerification.status === 'awaiting_confirmation') {
          if (taskId && receiptVerification.receipt) {
            pendingConfirmationsByTaskIdRef.current.set(taskId, {
              taskId,
              operationId: receiptVerification.receipt.operationId,
              modelName: assetToPush.name,
              expectedModelHash,
              expectedAsset: JSON.parse(JSON.stringify(persistedRojoAsset)),
              pendingDeletionPartIds: [...receiptVerification.receipt.pendingDeletionPartIds],
              resolved: false,
            });
          }
          const awaitingMsg =
            receiptVerification.reason ||
            `Operación pendiente de confirmación destructiva en Roblox Studio (ID: ${taskId || 'N/A'}).`;
          setCurrentSyncStatus({
            state: 'awaiting_studio',
            operation: 'push',
            taskId,
            message: awaitingMsg,
            details:
              receiptVerification.receipt && receiptVerification.receipt.pendingDeletionPartIds.length > 0
                ? `Piezas pendientes de eliminación: ${receiptVerification.receipt.pendingDeletionPartIds.join(', ')}`
                : 'Confirma o cancela la eliminación destructiva en Roblox Studio.',
            timestamp: new Date().toLocaleTimeString(),
          });

          const awaitingItem: SyncHistoryItem = {
            id: `sync-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: 'push',
            modelName: assetToPush.name,
            partCount: assetToPush.parts.length,
            status: 'awaiting_studio',
            details: awaitingMsg,
            taskId,
          };
          setSyncHistory((prev) => [awaitingItem, ...prev].slice(0, 20));
          setNotification({ type: 'warning', message: awaitingMsg });
          return { success: false, appliedInStudio: false, message: awaitingMsg, taskId };
        }

        if (receiptVerification.status === 'partially_applied') {
          const partialMsg =
            receiptVerification.reason ||
            `Aplicación parcial en Roblox Studio (ID: ${taskId || 'N/A'}).`;
          setCurrentSyncStatus({
            state: 'applied_partially',
            operation: 'push',
            taskId,
            message: partialMsg,
            details:
              receiptVerification.receipt && receiptVerification.receipt.failedPartIds.length > 0
                ? `Piezas fallidas: ${receiptVerification.receipt.failedPartIds.join(', ')}`
                : undefined,
            timestamp: new Date().toLocaleTimeString(),
          });

          const partialItem: SyncHistoryItem = {
            id: `sync-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: 'push',
            modelName: assetToPush.name,
            partCount: assetToPush.parts.length,
            status: 'applied_partially',
            details: partialMsg,
            taskId,
          };
          setSyncHistory((prev) => [partialItem, ...prev].slice(0, 20));
          setNotification({ type: 'warning', message: partialMsg });
          return { success: false, appliedInStudio: false, message: partialMsg, taskId };
        }

        if (receiptVerification.valid && receiptVerification.status === 'completed') {
          // Receipt verified: Studio confirmed exact part count, operationId, verifiedGeometryPartIds, and appliedModelHash
          setActiveAssetState(persistedRojoAsset);
          savedAssetSnapshotRef.current = JSON.parse(JSON.stringify(persistedRojoAsset));
          savedAssetHashRef.current = computeAssetContentHash(persistedRojoAsset);
          setPendingChanges(false);
          try {
            localStorage.removeItem('forge_active_draft');
          } catch {}
          setHasRecoverableDraft(false);
          setDraftTimestamp(null);

          const successMsg = `Modelo '${assetToPush.name}' aplicado y verificado en Roblox Studio (${assetToPush.parts.length} piezas, hash ${expectedModelHash.slice(0, 8)}).`;
          setCurrentSyncStatus({
            state: 'applied_successfully',
            operation: 'push',
            taskId,
            message: successMsg,
            details: taskResult.result?.details || `Operación ${taskId} verificada por el plugin v2.3.0`,
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
        }

        const errMsg =
          receiptVerification.reason ||
          taskResult.error ||
          taskResult.result?.error ||
          'Roblox Studio no pudo aplicar el modelo';
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
   * Reconciles a Studio task receipt after an asynchronous action in Roblox Studio
   * (such as confirming or cancelling a pending destructive deletion).
   * Supports multiple simultaneous pending tasks bound by taskId, operationId, modelName, and pendingDeletionPartIds,
   * and rejects duplicate confirmations or responses belonging to another task.
   */
  const reconcileStudioTaskReceipt = useCallback(
    async (
      taskId: string
    ): Promise<{ success: boolean; status: StudioApplicationReceipt['status']; message: string }> => {
      const trimmedTaskId = typeof taskId === 'string' ? taskId.trim() : '';
      const boundRecord = trimmedTaskId ? pendingConfirmationsByTaskIdRef.current.get(trimmedTaskId) : undefined;

      if (!trimmedTaskId || (!boundRecord && !activeAsset)) {
        return {
          success: false,
          status: 'failed',
          message: 'No hay modelo activo o taskId válido para reconciliar con Roblox Studio.',
        };
      }

      if (boundRecord && boundRecord.resolved) {
        const dupMsg = `La operación '${trimmedTaskId}' ya fue resuelta previamente (confirmada o cancelada) y no admite confirmación duplicada.`;
        return {
          success: false,
          status: 'failed',
          message: dupMsg,
        };
      }

      const targetAsset = boundRecord
        ? boundRecord.expectedAsset
        : {
            ...activeAsset!,
            parts: ensureStablePartIds(activeAsset!.parts || [], activeAsset!.name),
          };
      const expectedModelHash = boundRecord
        ? boundRecord.expectedModelHash
        : computeAssetContentHash(targetAsset);

      try {
        const res = await fetch(`/api/v1/bridge/task/${encodeURIComponent(trimmedTaskId)}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const taskResult = await res.json();
        const verification = verifyStudioApplicationReceipt(
          taskResult,
          trimmedTaskId,
          targetAsset,
          expectedModelHash
        );

        // Additional check when boundRecord exists: verify removedPartIds / failedPartIds match bound pendingDeletionPartIds
        if (boundRecord && verification.receipt) {
          if (
            verification.receipt.operationId !== boundRecord.operationId ||
            verification.receipt.modelName !== boundRecord.modelName
          ) {
            return {
              success: false,
              status: 'failed',
              message: `El recibo devuelto no corresponde a la operación vinculada ('${boundRecord.operationId}' / '${boundRecord.modelName}').`,
            };
          }
        }

        if (verification.valid && verification.status === 'completed') {
          if (boundRecord) {
            boundRecord.resolved = true;
          }
          // Only clear pendingChanges if no other simultaneous task is still awaiting confirmation for the active model
          const hasOtherUnresolved = Array.from(pendingConfirmationsByTaskIdRef.current.values()).some(
            (r) => !r.resolved
          );
          savedAssetSnapshotRef.current = JSON.parse(JSON.stringify(targetAsset));
          savedAssetHashRef.current = expectedModelHash;
          setPendingChanges(hasOtherUnresolved);
          if (!hasOtherUnresolved) {
            try {
              localStorage.removeItem('forge_active_draft');
            } catch {}
            setHasRecoverableDraft(false);
            setDraftTimestamp(null);
          }

          const msg = `Eliminación destructiva confirmada y verificada en Roblox Studio (${targetAsset.parts.length} piezas).`;
          setCurrentSyncStatus({
            state: 'applied_successfully',
            operation: 'push',
            taskId: trimmedTaskId,
            message: msg,
            timestamp: new Date().toLocaleTimeString(),
          });
          setNotification({ type: 'success', message: msg });
          return { success: true, status: 'completed', message: msg };
        }

        if (verification.status === 'partially_applied') {
          if (boundRecord) {
            boundRecord.resolved = true;
          }
          const msg =
            verification.reason ||
            'La operación destructiva fue cancelada o aplicada parcialmente en Roblox Studio. Persisten diferencias locales.';
          setPendingChanges(true);
          setCurrentSyncStatus({
            state: 'applied_partially',
            operation: 'push',
            taskId: trimmedTaskId,
            message: msg,
            timestamp: new Date().toLocaleTimeString(),
          });
          setNotification({ type: 'warning', message: msg });
          return { success: false, status: 'partially_applied', message: msg };
        }

        if (verification.status === 'awaiting_confirmation') {
          const msg =
            verification.reason ||
            'La operación sigue esperando confirmación destructiva en Roblox Studio.';
          setPendingChanges(true);
          return { success: false, status: 'awaiting_confirmation', message: msg };
        }

        const errMsg = verification.reason || 'Fallo al verificar el recibo final de Roblox Studio.';
        setCurrentSyncStatus({
          state: 'error',
          operation: 'push',
          taskId: trimmedTaskId,
          message: errMsg,
          timestamp: new Date().toLocaleTimeString(),
        });
        return { success: false, status: 'failed', message: errMsg };
      } catch (err: any) {
        const errMsg = `No se pudo consultar el estado de la tarea ${trimmedTaskId}: ${err?.message || 'Error de red'}`;
        return { success: false, status: 'failed', message: errMsg };
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

        const remoteHash = computeCanonicalAssetHash(stabilized);
        const localHash = computeCanonicalAssetHash(activeAsset);
        const baselineHash = savedAssetHashRef.current;

        // Conflict check: local has pending unpersisted changes AND remote differs from baseline AND remote differs from local
        if (pendingChanges && baselineHash && remoteHash !== baselineHash && remoteHash !== localHash) {
          setActiveConflict({
            localAsset: activeAsset!,
            remoteAsset: stabilized,
          });

          const conflictMsg = `Conflicto detectado: Modificaciones locales sin guardar chocan con cambios de Roblox Studio.`;
          setCurrentSyncStatus({
            state: 'conflict',
            operation: 'pull',
            message: conflictMsg,
            details: `Local: ${activeAsset?.parts.length || 0} piezas. Remoto: ${stabilized.parts.length} piezas.`,
            timestamp: new Date().toLocaleTimeString(),
          });

          const conflictItem: SyncHistoryItem = {
            id: `sync-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: 'pull',
            modelName: stabilized.name,
            partCount: stabilized.parts.length,
            status: 'conflict',
            details: conflictMsg,
          };
          setSyncHistory((prev) => [conflictItem, ...prev].slice(0, 20));
          setNotification({ type: 'warning', message: conflictMsg });
          return { success: false, message: conflictMsg, asset: stabilized };
        }

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
  }, [activeAsset, pendingChanges, applyAssetChange]);

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
        hasRecoverableDraft,
        draftTimestamp,
        recoverDraft,
        discardDraft,
        activeConflict,
        resolveConflict,
        bridgeStatus,
        refreshBridgeStatus,
        currentSyncStatus,
        pushToStudio,
        reconcileStudioTaskReceipt,
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
