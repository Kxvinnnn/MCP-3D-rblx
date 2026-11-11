import React, { useState } from 'react';
import {
  Send,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  FolderGit2,
  PlugZap,
  Layers,
  Box,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Cpu,
  Sliders,
} from 'lucide-react';
import { useForge } from '../../context/ForgeContext.tsx';
import { HelpTooltip, FORGE_GLOSSARY } from '../common/HelpTooltip.tsx';
import { LocalBridgeStatusPanel } from '../LocalBridgeStatusPanel.tsx';

export const StudioSyncView: React.FC = () => {
  const {
    activeAsset,
    bridgeStatus,
    refreshBridgeStatus,
    pushToStudio,
    pullFromStudio,
    syncHistory,
    setNotification,
    uiMode,
  } = useForge();

  const [conflictPolicy, setConflictPolicy] = useState<'smart_merge' | 'keep_forge' | 'accept_studio'>('smart_merge');
  const [isPushing, setIsPushing] = useState<boolean>(false);
  const [isPulling, setIsPulling] = useState<boolean>(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState<boolean>(uiMode === 'advanced');
  const [copiedScript, setCopiedScript] = useState<boolean>(false);

  const isConnected = bridgeStatus.robloxStudio.connected;
  const isBridgeActive = bridgeStatus.bridgeConnected;

  const handlePush = async () => {
    if (!activeAsset) {
      setNotification({ type: 'warning', message: 'No hay un modelo activo para enviar.' });
      return;
    }
    setIsPushing(true);
    await pushToStudio(activeAsset);
    setIsPushing(false);
  };

  const handlePull = async () => {
    setIsPulling(true);
    await pullFromStudio();
    setIsPulling(false);
  };

  const pluginInstallScript = `-- Coloca este script en Roblox Studio (ServerScriptService o Plugin):
local HttpService = game:GetService("HttpService")
print("[Forge Plugin v2.2.0] Conectando con Forge Local Bridge en 127.0.0.1:48720...")
`;

  const handleCopyPluginCode = () => {
    navigator.clipboard.writeText(pluginInstallScript);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
    setNotification({ type: 'info', message: 'Instrucciones copiadas al portapapeles.' });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12 animate-in fade-in duration-200">
      {/* Header */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="inline-flex items-center gap-2 text-cyan-400 text-xs font-semibold uppercase tracking-wider">
              <PlugZap className="w-3.5 h-3.5" />
              <span>Centro de Control de Integración</span>
            </div>
            <h2 className="text-xl font-bold text-white mt-0.5">
              Sincronización Bidireccional con Roblox Studio
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshBridgeStatus}
              className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Actualizar Estado</span>
            </button>
          </div>
        </div>

        {/* Studio Connection Card with Visual Status */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Roblox Studio Card */}
          <div className={`p-4 rounded-xl border flex flex-col justify-between ${
            isConnected
              ? 'bg-emerald-950/20 border-emerald-800/60'
              : 'bg-slate-950/60 border-slate-800'
          }`}>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">Roblox Studio</span>
                <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' : 'bg-slate-600'}`} />
              </div>
              <div className="text-lg font-bold text-white">
                {isConnected ? 'Plugin Conectado' : 'Esperando Plugin'}
              </div>
              <p className="text-[11px] text-slate-400">
                {isConnected
                  ? `Plugin v${bridgeStatus.robloxStudio.pluginVersion || '2.2.0'} activo en ${bridgeStatus.robloxStudio.placeName || 'Lugar actual'}`
                  : 'Abre Roblox Studio con el plugin Forge AI v2.2.0 activo.'}
              </p>
            </div>
          </div>

          {/* Local Bridge Card */}
          <div className={`p-4 rounded-xl border flex flex-col justify-between ${
            isBridgeActive
              ? 'bg-cyan-950/20 border-cyan-800/60'
              : 'bg-amber-950/20 border-amber-800/60'
          }`}>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">Puente Local</span>
                <span className={`w-2.5 h-2.5 rounded-full ${isBridgeActive ? 'bg-cyan-400' : 'bg-amber-400'}`} />
              </div>
              <div className="text-lg font-bold text-white">
                {isBridgeActive ? '127.0.0.1:48720' : 'En Espera'}
              </div>
              <p className="text-[11px] text-slate-400">
                {isBridgeActive
                  ? 'Protocolo seguro HMAC activo sin exponer datos de red.'
                  : 'Inicia el puente local en Windows con npm run bridge.'}
              </p>
            </div>
          </div>

          {/* Rojo Server Card */}
          <div className={`p-4 rounded-xl border flex flex-col justify-between ${
            bridgeStatus.rojo.rojoServerListening
              ? 'bg-emerald-950/20 border-emerald-800/60'
              : 'bg-slate-950/60 border-slate-800'
          }`}>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">Rojo Server</span>
                <span className={`w-2.5 h-2.5 rounded-full ${bridgeStatus.rojo.rojoServerListening ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              </div>
              <div className="text-lg font-bold text-white">
                {bridgeStatus.rojo.rojoServerListening ? 'Puerto 34872 Activo' : 'Inactivo'}
              </div>
              <p className="text-[11px] text-slate-400">
                {bridgeStatus.rojo.syncedFilesCount > 0
                  ? `${bridgeStatus.rojo.syncedFilesCount} archivos sincronizados en disco.`
                  : 'Sincronización de carpetas de archivos de proyecto.'}
              </p>
            </div>
          </div>
        </div>

        {/* Quick Connection Help if Disconnected */}
        {!isConnected && (
          <div className="mt-4 p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-xs font-bold text-white block">
                ¿No estás conectado a Roblox Studio?
              </span>
              <p className="text-xs text-slate-400">
                Instala el archivo <span className="font-mono text-cyan-300">ForgeAIStudioPlugin.server.luau</span> en la carpeta de Plugins locales de Studio o cópialo a tu proyecto.
              </p>
            </div>

            <button
              type="button"
              onClick={handleCopyPluginCode}
              className="py-2 px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer transition shrink-0"
            >
              {copiedScript ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedScript ? 'Copiado' : 'Copiar Script'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Real-time Studio Selection Inspector */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <span className="text-xs font-bold text-white flex items-center gap-2">
            <Box className="w-4 h-4 text-cyan-400" />
            <span>Selección Activa en Roblox Studio (studio.get_selection)</span>
          </span>
          <span className="text-[11px] text-slate-400 font-mono">
            En vivo
          </span>
        </div>

        {bridgeStatus.robloxStudio.selectedModelName ? (
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs text-slate-400 block">Modelo seleccionado en Studio:</span>
              <span className="text-sm font-bold text-emerald-400 font-mono block">
                {bridgeStatus.robloxStudio.selectedModelName}
              </span>
              <span className="text-[11px] text-slate-500">
                {bridgeStatus.robloxStudio.selectedPartCount} piezas seleccionadas en el DataModel
              </span>
            </div>

            <button
              type="button"
              onClick={handlePull}
              disabled={isPulling}
              className="py-2 px-3.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isPulling ? 'Importando...' : 'Traer esta selección'}</span>
            </button>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-400 text-center">
            {isConnected
              ? 'Selecciona cualquier Model o MeshPart en Roblox Studio para inspeccionarlo aquí en tiempo real.'
              : 'Conecta el plugin en Roblox Studio para ver la selección activa.'}
          </div>
        )}
      </div>

      {/* 2 Main Synchronization Action Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* PUSH Button */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-xl bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
              <Send className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-white text-base">
              Enviar a Roblox Studio (Push)
            </h3>
            <p className="text-slate-400 text-xs leading-relaxed">
              Transfiere el modelo activo ({activeAsset?.name || 'Ninguno'}) desde Forge AI Studio directamente al Workspace de Roblox Studio.
            </p>
          </div>

          <button
            type="button"
            onClick={handlePush}
            disabled={isPushing || !activeAsset}
            className={`w-full py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition shadow-lg ${
              activeAsset
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-950/50'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            <Send className="w-4 h-4" />
            <span>{isPushing ? 'Enviando al DataModel...' : 'Enviar Modelo al DataModel de Studio'}</span>
          </button>
        </div>

        {/* PULL Button */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-xl bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center text-cyan-400">
              <Download className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-white text-base">
              Traer de Roblox Studio (Pull)
            </h3>
            <p className="text-slate-400 text-xs leading-relaxed">
              Lee el modelo o selección actual en Roblox Studio y cárgalo en Forge para editar geometría o aplicar texturas PBR.
            </p>
          </div>

          <button
            type="button"
            onClick={handlePull}
            disabled={isPulling}
            className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition border border-slate-700 shadow-lg"
          >
            <Download className="w-4 h-4" />
            <span>{isPulling ? 'Extrayendo de Studio...' : 'Traer Cambios desde Roblox Studio'}</span>
          </button>
        </div>
      </div>

      {/* Conflict Resolution Strategy Selector */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white">
              Estrategia de Resolución de Conflictos
            </span>
            <HelpTooltip
              term={FORGE_GLOSSARY.smartMerge.term}
              explanation={FORGE_GLOSSARY.smartMerge.explanation}
              variant="badge"
            />
          </div>
          <span className="text-[11px] text-slate-500">
            Regla de sincronización
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {
              id: 'smart_merge',
              title: 'Fusión Inteligente (Recomendado)',
              desc: 'Combina cambios de posición en Studio con nuevas mallas creadas en Forge.',
            },
            {
              id: 'keep_forge',
              title: 'Conservar Forge AI Studio',
              desc: 'Sobrescribe los cambios de Studio con el modelo de Forge.',
            },
            {
              id: 'accept_studio',
              title: 'Conservar Roblox Studio',
              desc: 'Adopta fielmente el estado actual del juego en Studio.',
            },
          ].map((item) => {
            const isSelected = conflictPolicy === item.id;
            return (
              <div
                key={item.id}
                onClick={() => setConflictPolicy(item.id as any)}
                className={`p-3.5 rounded-xl border cursor-pointer transition ${
                  isSelected
                    ? 'bg-cyan-950/40 border-cyan-500'
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-semibold ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                    {item.title}
                  </span>
                  {isSelected && <CheckCircle2 className="w-4 h-4 text-cyan-400" />}
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {item.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Sync History */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <span className="text-xs font-bold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-400" />
            <span>Historial de Sincronizaciones Recientes</span>
          </span>
          <span className="text-[11px] text-slate-500 font-mono">
            {syncHistory.length} operaciones
          </span>
        </div>

        {syncHistory.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-950 text-center text-xs text-slate-500">
            No se han realizado operaciones de sincronización en esta sesión todavía.
          </div>
        ) : (
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {syncHistory.map((item) => (
              <div
                key={item.id}
                className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${
                      item.type === 'push'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                        : 'bg-cyan-950 text-cyan-400 border border-cyan-800/60'
                    }`}
                  >
                    {item.type}
                  </span>
                  <div>
                    <span className="font-semibold text-white block">{item.modelName}</span>
                    <span className="text-[11px] text-slate-400 block">{item.details}</span>
                  </div>
                </div>

                <div className="text-right text-[11px] text-slate-500 font-mono">
                  <span>{item.timestamp}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Collapsible Advanced Tools Drawer */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvancedTools(!showAdvancedTools)}
          className="w-full px-6 py-4 flex items-center justify-between text-xs font-bold text-slate-300 hover:text-white cursor-pointer transition"
        >
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <span>Herramientas Avanzadas &amp; Diagnóstico de Puente Local</span>
          </div>
          {showAdvancedTools ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showAdvancedTools && (
          <div className="p-6 border-t border-slate-800 bg-slate-950/40">
            <LocalBridgeStatusPanel />
          </div>
        )}
      </div>
    </div>
  );
};
