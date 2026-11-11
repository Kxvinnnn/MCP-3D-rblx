import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  Forge3DAsset,
  MeshPart3DSpec,
  OperationHistoryEntry,
} from '../utils/roblox3DEngine.ts';

export type UIMode = 'simple' | 'advanced';

export type PrimaryTab = 'home' | 'create' | 'edit' | 'materials' | 'studio';
export type AdvancedTab = 'agents' | 'script' | 'ui' | 'rojo' | 'context' | 'backend';
export type AppTab = PrimaryTab | AdvancedTab;

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
  backendHealthy: boolean;
}

export interface SyncHistoryItem {
  id: string;
  timestamp: string;
  type: 'push' | 'pull' | 'merge';
  modelName: string;
  partCount: number;
  status: 'success' | 'failed' | 'partial';
  details: string;
}

interface ForgeContextType {
  uiMode: UIMode;
  setUiMode: (mode: UIMode) => void;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;

  // Active Model & Selection
  activeAsset: Forge3DAsset | null;
  setActiveAsset: (asset: Forge3DAsset | null) => void;
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
  pendingChanges: boolean;
  saveAssetToDisk: (saveToRojo?: boolean) => Promise<boolean>;

  // System & Bridge Status
  bridgeStatus: BridgeHealthStatus;
  refreshBridgeStatus: () => Promise<void>;

  // Bidirectional Synchronization
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
  backendHealthy: true,
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

  const [undoStack, setUndoStack] = useState<Forge3DAsset[]>([]);
  const [redoStack, setRedoStack] = useState<Forge3DAsset[]>([]);
  const [operationHistory, setOperationHistory] = useState<OperationHistoryEntry[]>([]);
  const [pendingChanges, setPendingChanges] = useState<boolean>(false);

  const [bridgeStatus, setBridgeStatus] = useState<BridgeHealthStatus>(defaultBridgeStatus);
  const [syncHistory, setSyncHistory] = useState<SyncHistoryItem[]>([]);
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

  const setActiveAsset = useCallback((asset: Forge3DAsset | null) => {
    setActiveAssetState(asset);
    if (asset?.parts && asset.parts.length > 0) {
      setSelectedPart(asset.parts[0]);
    } else {
      setSelectedPart(null);
    }
    setPendingChanges(false);
  }, []);

  // Fetch library models
  const fetchAssetLibrary = useCallback(async () => {
    setLoadingLibrary(true);
    try {
      const res = await fetch('/api/v1/assets');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.assets)) {
          setAssetLibrary(data.assets);
          if (!activeAsset && data.assets.length > 0) {
            setActiveAsset(data.assets[0]);
          }
        }
      }
    } catch (err) {
      console.warn('Error fetching asset library:', err);
    } finally {
      setLoadingLibrary(false);
    }
  }, [activeAsset, setActiveAsset]);

  // Refresh bridge and system status
  const refreshBridgeStatus = useCallback(async () => {
    try {
      const [bridgeRes, healthRes] = await Promise.allSettled([
        fetch('/api/v1/bridge/status'),
        fetch('/api/v1/health'),
      ]);

      let newStatus: Partial<BridgeHealthStatus> = {};

      if (bridgeRes.status === 'fulfilled' && bridgeRes.value.ok) {
        const bridgeData = await bridgeRes.value.json();
        newStatus = { ...bridgeData };
      }

      if (healthRes.status === 'fulfilled') {
        newStatus.backendHealthy = healthRes.value.ok;
      }

      setBridgeStatus((prev) => ({
        ...prev,
        ...newStatus,
        rojo: {
          ...prev.rojo,
          ...(newStatus.rojo || {}),
        },
        robloxStudio: {
          ...prev.robloxStudio,
          ...(newStatus.robloxStudio || {}),
        },
      }));
    } catch {
      // Ignore transient errors
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

  // Apply a non-destructive change with undo snapshot
  const applyAssetChange = useCallback(
    (
      updatedAsset: Forge3DAsset,
      summary: string,
      operationType: OperationHistoryEntry['operationType'] = 'transform_pos_rot'
    ) => {
      if (!activeAsset) {
        setActiveAsset(updatedAsset);
        return;
      }

      const snapshot = JSON.parse(JSON.stringify(activeAsset)) as Forge3DAsset;
      setUndoStack((prev) => [snapshot, ...prev].slice(0, 25));
      setRedoStack([]); // Clear redo stack on new branch

      const historyEntry: OperationHistoryEntry = {
        id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toLocaleTimeString(),
        operationType,
        partName: selectedPart?.name || 'Modelo Completo',
        summary,
        vertexBefore: activeAsset.poly_count,
        vertexAfter: updatedAsset.poly_count,
        triangleBefore: activeAsset.poly_count,
        triangleAfter: updatedAsset.poly_count,
        snapshot,
      };

      setOperationHistory((prev) => [historyEntry, ...prev].slice(0, 30));
      setActiveAssetState(updatedAsset);
      setPendingChanges(true);

      // Keep selected part in sync with updated asset
      if (selectedPart) {
        const found = updatedAsset.parts.find(
          (p) => (p.partId && p.partId === selectedPart.partId) || p.name === selectedPart.name
        );
        setSelectedPart(found || updatedAsset.parts[0] || null);
      }
    },
    [activeAsset, selectedPart, setActiveAsset]
  );

  const undo = useCallback(() => {
    if (undoStack.length === 0 || !activeAsset) return;
    const [previousState, ...restUndo] = undoStack;
    const currentSnapshot = JSON.parse(JSON.stringify(activeAsset)) as Forge3DAsset;

    setRedoStack((prev) => [currentSnapshot, ...prev]);
    setUndoStack(restUndo);
    setActiveAssetState(previousState);
    if (selectedPart) {
      const found = previousState.parts.find((p) => p.name === selectedPart.name);
      setSelectedPart(found || previousState.parts[0] || null);
    }
    setNotification({ type: 'info', message: 'Acción deshecha con éxito' });
  }, [undoStack, activeAsset, selectedPart]);

  const redo = useCallback(() => {
    if (redoStack.length === 0 || !activeAsset) return;
    const [nextState, ...restRedo] = redoStack;
    const currentSnapshot = JSON.parse(JSON.stringify(activeAsset)) as Forge3DAsset;

    setUndoStack((prev) => [currentSnapshot, ...prev]);
    setRedoStack(restRedo);
    setActiveAssetState(nextState);
    if (selectedPart) {
      const found = nextState.parts.find((p) => p.name === selectedPart.name);
      setSelectedPart(found || nextState.parts[0] || null);
    }
    setNotification({ type: 'info', message: 'Acción rehecha con éxito' });
  }, [redoStack, activeAsset, selectedPart]);

  // Save active asset to disk / Rojo
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
            setActiveAssetState(data.asset);
            setPendingChanges(false);
            fetchAssetLibrary();
            setNotification({
              type: 'success',
              message: `Modelo '${data.asset.name}' guardado correctamente.`,
            });
            return true;
          }
        }
        return false;
      } catch (err: any) {
        setNotification({
          type: 'error',
          message: `Error al guardar: ${err.message || 'Error de conexión'}`,
        });
        return false;
      }
    },
    [activeAsset, fetchAssetLibrary]
  );

  // Push model to Roblox Studio via Bridge
  const pushToStudio = useCallback(
    async (targetAsset?: Forge3DAsset): Promise<{ success: boolean; message: string }> => {
      const assetToPush = targetAsset || activeAsset;
      if (!assetToPush) {
        return { success: false, message: 'No hay ningún modelo activo para enviar.' };
      }

      try {
        // Enqueue bridge task or call studio-push endpoint
        const res = await fetch('/api/v1/assets/studio-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model_name: assetToPush.name,
            parts: assetToPush.parts,
            sync_scope: 'full_model',
            conflict_policy: 'smart_merge',
          }),
        });

        const data = await res.json();
        const success = res.ok && data.success !== false;
        const msg = data.message || (success ? `Modelo '${assetToPush.name}' enviado a Roblox Studio.` : 'Error al enviar a Studio');

        const newHistoryItem: SyncHistoryItem = {
          id: `sync-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          type: 'push',
          modelName: assetToPush.name,
          partCount: assetToPush.parts.length,
          status: success ? 'success' : 'failed',
          details: msg,
        };

        setSyncHistory((prev) => [newHistoryItem, ...prev].slice(0, 20));

        setNotification({
          type: success ? 'success' : 'error',
          message: msg,
        });

        return { success, message: msg };
      } catch (err: any) {
        const errorMsg = err.message || 'Error de red al conectar con el puente de Studio';
        setNotification({ type: 'error', message: errorMsg });
        return { success: false, message: errorMsg };
      }
    },
    [activeAsset]
  );

  // Pull model from Studio
  const pullFromStudio = useCallback(async (): Promise<{
    success: boolean;
    message: string;
    asset?: Forge3DAsset;
  }> => {
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
        applyAssetChange(data.asset, 'Sincronizado desde Roblox Studio', 'incremental_sync');
        const msg = `Se recibieron ${data.asset.parts.length} piezas desde Roblox Studio.`;

        const newPullItem: SyncHistoryItem = {
          id: `sync-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          type: 'pull',
          modelName: data.asset.name,
          partCount: data.asset.parts.length,
          status: 'success',
          details: msg,
        };

        setSyncHistory((prev) => [newPullItem, ...prev].slice(0, 20));

        setNotification({ type: 'success', message: msg });
        return { success: true, message: msg, asset: data.asset };
      } else {
        const errorMsg = data.message || 'No se pudieron extraer cambios desde Roblox Studio.';
        setNotification({ type: 'warning', message: errorMsg });
        return { success: false, message: errorMsg };
      }
    } catch (err: any) {
      const errDetail = err.message || 'Error al comunicar con Roblox Studio.';
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
        bridgeStatus,
        refreshBridgeStatus,
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
