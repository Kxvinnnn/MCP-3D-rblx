import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FolderGit2,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';

interface BridgeStatusResponse {
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
  pendingTasksCount: number;
  pendingTasks: Array<{
    taskId: string;
    operation: string;
    status: string;
    correlationId: string;
    timestamp: string;
  }>;
  recentErrors: Array<{
    taskId: string;
    operation: string;
    error: string;
    timestamp: string;
  }>;
}

export const LocalBridgeStatusPanel: React.FC = () => {
  const [status, setStatus] = useState<BridgeStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [reconnecting, setReconnecting] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchBridgeStatus = async () => {
    try {
      const res = await fetch('/api/v1/bridge/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch {
      // Ignore transient network errors
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBridgeStatus();
    const timer = setInterval(fetchBridgeStatus, 3000);
    return () => clearInterval(timer);
  }, []);

  const handleRequestReconnect = async () => {
    setReconnecting(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/v1/bridge/reconnect', { method: 'POST' });
      if (res.ok) {
        setActionMessage('Solicitud de reconexión y renovación de sesión enviada al puente local.');
        await fetchBridgeStatus();
      }
    } finally {
      setReconnecting(false);
    }
  };

  const handleCheckRojoBuild = async () => {
    setActionMessage('Verificando compilación en el puente local...');
    try {
      const res = await fetch('/api/v1/bridge/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'rojo.check_build',
          payload: {},
          wait_for_completion: true,
          timeout_ms: 12000,
        }),
      });
      const data = await res.json();
      if (data.status === 'completed' && data.result) {
        setActionMessage(
          data.result.valid
            ? `Compilación Rojo verificada (${data.result.checkedFilesCount} módulos Luau validados).`
            : `Errores de compilación detectados: ${(data.result.errors || []).join(', ')}`
        );
      } else {
        setActionMessage(data.error || 'Tarea encolada en el puente.');
      }
      await fetchBridgeStatus();
    } catch (err: any) {
      setActionMessage(`Error al consultar puente: ${err.message}`);
    }
  };

  const bridgeConnected = Boolean(status?.bridgeConnected);
  const studioConnected = Boolean(status?.robloxStudio?.connected);
  const rojoListening = Boolean(status?.rojo?.rojoServerListening);

  return (
    <div className="p-6 rounded-2xl bg-[#0d1117] border border-cyan-500/30 shadow-xl flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
              bridgeConnected
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}
          >
            {bridgeConnected ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white">
                Conexión Local — Forge Local Bridge (Windows 127.0.0.1)
              </h3>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold ${
                  bridgeConnected
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                }`}
              >
                {bridgeConnected ? 'CONECTADO' : 'DESCONECTADO'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Enlace saliente Zero-Inbound entre Google AI Studio / Cloud Run, Rojo 7.x y el Plugin de Roblox Studio (sin exponer rutas locales ni secretos).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCheckRojoBuild}
            disabled={!bridgeConnected}
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-cyan-300 font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Verificar Build Rojo</span>
          </button>

          <button
            type="button"
            onClick={handleRequestReconnect}
            disabled={reconnecting}
            className="px-3.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reconnecting || loading ? 'animate-spin' : ''}`} />
            <span>Solicitar Reconexión</span>
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="p-3 rounded-xl bg-cyan-950/50 border border-cyan-500/40 text-cyan-200 text-xs flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {/* Tarjetas de Estado en Vivo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
          <span className="text-[10px] font-mono uppercase text-slate-400">
            Versión del Puente &amp; Protocolo
          </span>
          <div className="text-sm font-bold text-white mt-1 font-mono flex items-center gap-2">
            <PlugZap className="w-4 h-4 text-cyan-400" />
            <span>
              v{status?.bridgeVersion || '1.0.0'} (Proto v{status?.protocolVersion || '1.0'})
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {status?.lastHeartbeatAt
              ? `Último heartbeat: ${new Date(status.lastHeartbeatAt).toLocaleTimeString()}`
              : 'Esperando conexión desde tu PC Windows...'}
          </p>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
          <span className="text-[10px] font-mono uppercase text-slate-400">
            Proyecto Activo (Rojo)
          </span>
          <div className="text-sm font-bold text-emerald-400 mt-1 font-mono flex items-center gap-1.5">
            <FolderGit2 className="w-4 h-4" />
            <span>{status?.activeProject || status?.rojo?.projectName || 'Sin vincular'}</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {rojoListening
              ? `Servidor Rojo activo (:${status?.rojo?.rojoServePort || 34872}) • ${status?.rojo?.syncedFilesCount || 0} módulos`
              : `Rojo CLI: ${status?.rojo?.rojoVersion || 'En espera de rojo serve'}`}
          </p>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
          <span className="text-[10px] font-mono uppercase text-slate-400">
            Estado de Roblox Studio
          </span>
          <div
            className={`text-sm font-bold mt-1 font-mono flex items-center gap-1.5 ${
              studioConnected ? 'text-emerald-400' : 'text-amber-300'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{studioConnected ? 'Plugin Conectado' : 'Plugin Desconectado'}</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {studioConnected
              ? `Selección: ${status?.robloxStudio?.selectedModelName || 'Ninguna'} (${status?.robloxStudio?.selectedPartCount || 0} partes)`
              : 'Abre Roblox Studio con el Plugin Forge v2.2'}
          </p>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
          <span className="text-[10px] font-mono uppercase text-slate-400">
            Cola de Tareas &amp; Errores
          </span>
          <div className="text-sm font-bold text-purple-300 mt-1 font-mono flex items-center gap-1.5">
            <Clock className="w-4 h-4" />
            <span>{status?.pendingTasksCount || 0} tarea(s) pendiente(s)</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Errores recientes: {(status?.recentErrors || []).length}
          </p>
        </div>
      </div>

      {/* Lista de Tareas Pendientes y Errores Recientes */}
      {((status?.pendingTasks && status.pendingTasks.length > 0) ||
        (status?.recentErrors && status.recentErrors.length > 0)) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-xs font-mono font-bold text-cyan-400 mb-2">
              Tareas Pendientes en Cola ({status?.pendingTasks?.length || 0})
            </div>
            {status?.pendingTasks && status.pendingTasks.length > 0 ? (
              <div className="space-y-1.5 max-h-32 overflow-y-auto font-mono text-[11px]">
                {status.pendingTasks.map((t) => (
                  <div
                    key={t.taskId}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded bg-slate-900 text-slate-200"
                  >
                    <span>{t.operation}</span>
                    <span className="text-amber-300">{t.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No hay tareas pendientes.</p>
            )}
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-xs font-mono font-bold text-rose-400 mb-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Errores Recientes ({status?.recentErrors?.length || 0})</span>
            </div>
            {status?.recentErrors && status.recentErrors.length > 0 ? (
              <div className="space-y-1.5 max-h-32 overflow-y-auto font-mono text-[11px]">
                {status.recentErrors.map((e, idx) => (
                  <div
                    key={`${e.taskId}-${idx}`}
                    className="px-2.5 py-1.5 rounded bg-rose-950/40 border border-rose-500/30 text-rose-200"
                  >
                    <div className="font-bold">{e.operation}</div>
                    <div className="truncate">{e.error}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Sin errores registrados.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
