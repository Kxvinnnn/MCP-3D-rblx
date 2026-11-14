import React, { useState, useEffect, useCallback } from 'react';
import {
  Wifi,
  WifiOff,
  Download,
  RefreshCw,
  FolderSync,
  Terminal,
  Copy,
  Check,
  KeyRound,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  forgeFetch,
  getStoredForgeToken,
  setStoredForgeToken,
} from '../utils/forgeApiClient.ts';

interface BridgeStatus {
  online: boolean;
  service?: string;
  version?: string;
  bridgePort?: number;
  projectRoot?: string;
  rojoAssetsDir?: string;
  rojoFilesCount?: number;
  pendingStudioQueue?: number;
  syncedFromStudioCount?: number;
  pluginConnected?: boolean;
  pluginLastSeen?: number | null;
  error?: string;
}

export const LocalBridgeStatusPanel: React.FC = () => {
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ online: false });
  const [mainServerPluginStatus, setMainServerPluginStatus] = useState<{
    connected: boolean;
    pendingQueueCount: number;
    syncedFromStudioCount: number;
    rojoFilesCount?: number;
  }>({ connected: false, pendingQueueCount: 0, syncedFromStudioCount: 0 });
  const [isChecking, setIsChecking] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  // API & Bridge Authentication Token (X-Forge-Token)
  const [apiTokenInput, setApiTokenInput] = useState<string>(() => getStoredForgeToken());
  const [tokenSavedMsg, setTokenSavedMsg] = useState(false);
  const [authRequiredWarning, setAuthRequiredWarning] = useState<string | null>(null);
  const [showAuthConfig, setShowAuthConfig] = useState(false);

  const checkBridgeAndServer = useCallback(async () => {
    setIsChecking(true);
    setAuthRequiredWarning(null);
    const currentBridgeToken = getStoredForgeToken();
    const bridgeHeaders: Record<string, string> = {};
    if (currentBridgeToken) {
      bridgeHeaders['X-Forge-Token'] = currentBridgeToken;
    }

    // 1. Check standalone Local Bridge on 127.0.0.1:44877
    try {
      const res = await fetch('http://127.0.0.1:44877/health', {
        signal: AbortSignal.timeout(1800),
        headers: bridgeHeaders,
      });
      if (res.status === 401 || res.status === 403) {
        setAuthRequiredWarning('El Local Bridge requiere un token X-Forge-Token válido.');
        setShowAuthConfig(true);
        setBridgeStatus({ online: false, error: 'Token requerido (401/403)' });
      } else if (res.ok) {
        const data = await res.json();
        setBridgeStatus({ online: true, ...data });
      } else {
        setBridgeStatus({ online: false });
      }
    } catch {
      setBridgeStatus({ online: false });
    }

    // 2. Check integrated server plugin status on /api/v1/studio/plugin-status
    try {
      const res2 = await forgeFetch('/api/v1/studio/plugin-status');
      if (res2.status === 401 || res2.status === 403) {
        setAuthRequiredWarning(
          'El servidor principal requiere un token X-Forge-Token válido. Ingrésalo abajo.'
        );
        setShowAuthConfig(true);
      } else if (res2.ok) {
        const data2 = await res2.json();
        setMainServerPluginStatus({
          connected: data2.connected || false,
          pendingQueueCount: data2.pendingQueueCount || 0,
          syncedFromStudioCount: data2.syncedFromStudioCount || 0,
        });
      }
    } catch {
      // Ignore network error
    }

    // 3. Check Rojo status on /api/v1/rojo-status
    try {
      const res3 = await forgeFetch('/api/v1/rojo-status');
      if (res3.ok) {
        const data3 = await res3.json();
        setMainServerPluginStatus((prev) => ({
          ...prev,
          rojoFilesCount: data3.count || 0,
        }));
      }
    } catch {
      // Ignore
    }

    setIsChecking(false);
  }, []);

  useEffect(() => {
    checkBridgeAndServer();
    const interval = setInterval(checkBridgeAndServer, 8000);
    return () => clearInterval(interval);
  }, [checkBridgeAndServer]);

  const handleDownloadPlugin = async () => {
    try {
      const res = await forgeFetch('/api/v1/studio/download-plugin');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const code = await res.text();
      const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ForgeAIStudioPlugin.server.luau';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setAuthRequiredWarning(
        `No se pudo descargar el plugin (${err.message || 'Verifica X-Forge-Token'}).`
      );
      setShowAuthConfig(true);
    }
  };

  const handleCopyCommand = () => {
    navigator.clipboard.writeText('cd forge-bridge && npm install && npm start');
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const isAnyPluginConnected = bridgeStatus.pluginConnected || mainServerPluginStatus.connected;

  const handleSaveTokens = () => {
    setStoredForgeToken(apiTokenInput);
    setTokenSavedMsg(true);
    setTimeout(() => setTokenSavedMsg(false), 2500);
    checkBridgeAndServer();
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <FolderSync className="w-4 h-4 text-cyan-400" />
            <span>Estado de Puentes y Plugin de Roblox Studio</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Descarga el plugin oficial para Roblox Studio o supervisa el puente local.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAuthConfig(!showAuthConfig)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition ${
              showAuthConfig || authRequiredWarning
                ? 'bg-amber-950/60 border-amber-500/60 text-amber-200'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5 text-amber-400" />
            <span>Tokens de Seguridad</span>
            {showAuthConfig ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          <button
            type="button"
            onClick={checkBridgeAndServer}
            disabled={isChecking}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 flex items-center gap-1.5 cursor-pointer transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin text-cyan-400' : ''}`} />
            <span>Refrescar</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadPlugin}
            className="px-3.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Descargar Plugin (.luau)</span>
          </button>
        </div>
      </div>

      {/* Collapsible Token Configuration */}
      {showAuthConfig && (
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
              <span>Autenticación X-Forge-Token (Servidor API y Local Bridge)</span>
            </div>
            {authRequiredWarning && (
              <span className="text-[11px] font-semibold text-amber-400">
                {authRequiredWarning}
              </span>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="password"
              value={apiTokenInput}
              onChange={(e) => setApiTokenInput(e.target.value)}
              placeholder="FORGE_SECURITY_TOKEN (X-Forge-Token)"
              className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
            />
            <button
              type="button"
              onClick={handleSaveTokens}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-cyan-600 text-slate-200 hover:text-white text-xs font-semibold cursor-pointer transition flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              {tokenSavedMsg ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <KeyRound className="w-3.5 h-3.5" />}
              <span>{tokenSavedMsg ? 'Token guardado' : 'Guardar Token'}</span>
            </button>
          </div>
        </div>
      )}

      {/* 3 Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Card 1: Local Bridge (Port 44877) */}
        <div
          className={`p-3.5 rounded-xl border ${
            bridgeStatus.online
              ? 'bg-emerald-950/20 border-emerald-500/40'
              : 'bg-slate-950/60 border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-slate-300">
              Forge Local Bridge (:44877)
            </span>
            {bridgeStatus.online ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                <Wifi className="w-3 h-3" /> ACTIVO
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                <WifiOff className="w-3 h-3" /> OFFLINE
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {bridgeStatus.online
              ? `Sincronizando en disco (${bridgeStatus.rojoFilesCount || 0} archivos Rojo).`
              : 'Opcional si usas AI Studio en la nube y quieres conectar con Roblox Studio Desktop.'}
          </p>
        </div>

        {/* Card 2: Roblox Studio Plugin */}
        <div
          className={`p-3.5 rounded-xl border ${
            isAnyPluginConnected
              ? 'bg-cyan-950/20 border-cyan-500/40'
              : 'bg-slate-950/60 border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-slate-300">
              Plugin de Roblox Studio
            </span>
            {isAnyPluginConnected ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-cyan-400">
                <Wifi className="w-3 h-3" /> CONECTADO
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-400">
                EN ESPERA
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed tabular-nums">
            {isAnyPluginConnected
              ? `Plugin activo. En cola: ${
                  bridgeStatus.pendingStudioQueue ?? mainServerPluginStatus.pendingQueueCount
                } · Importados: ${
                  bridgeStatus.syncedFromStudioCount ?? mainServerPluginStatus.syncedFromStudioCount
                }`
              : 'Instala el plugin .luau en Roblox Studio y presiona "Connect".'}
          </p>
        </div>

        {/* Card 3: Rojo Directory */}
        <div className="p-3.5 rounded-xl border bg-slate-950/60 border-slate-800">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-slate-300">
              Repositorio Rojo (Assets3D)
            </span>
            <span className="text-[11px] font-mono tabular-nums text-indigo-400 font-semibold">
              {bridgeStatus.rojoFilesCount ?? mainServerPluginStatus.rojoFilesCount ?? 0} modelos
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Ruta: <code className="text-slate-200">src/shared/Assets3D/</code> lista para{' '}
            <code className="text-cyan-300">rojo serve</code>.
          </p>
        </div>
      </div>

      {/* Quick Start Command if Bridge is Offline */}
      {!bridgeStatus.online && (
        <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Terminal className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              ¿Ejecutas Roblox Studio en tu PC? Inicia el puente local con:{' '}
              <code className="text-cyan-300 font-mono bg-slate-900 px-1.5 py-0.5 rounded">
                cd forge-bridge && npm install && npm start
              </code>
            </span>
          </div>
          <button
            type="button"
            onClick={handleCopyCommand}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 flex items-center gap-1 cursor-pointer self-start sm:self-auto shrink-0"
          >
            {copiedCmd ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copiedCmd ? 'Copiado' : 'Copiar comando'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
