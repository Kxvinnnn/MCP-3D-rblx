import React, { useState, useEffect } from 'react';
import {
  ArrowRight,
  Server,
  Smartphone,
  Layout,
  Share2,
  ShieldAlert,
  ShieldCheck,
  CheckCircle,
  Copy,
  Check,
  FolderSync,
  RefreshCw,
  FileCheck2,
  Lock,
  Terminal,
  AlertTriangle,
} from 'lucide-react';
import { LocalBridgeStatusPanel } from './LocalBridgeStatusPanel.tsx';

interface RojoStatusData {
  project_path: string;
  project_exists: boolean;
  default_project_json_exists: boolean;
  default_project_name: string | null;
  rojo_cli_installed: boolean;
  rojo_cli_version: string | null;
  rojo_server_listening: boolean;
  rojo_port: number;
  synced_files_count: number;
}

interface SyncManifestFile {
  relative_path: string;
  size_bytes: number;
  sha256: string;
  modified_at: string;
}

export const RojoWorkflowGuide: React.FC = () => {
  const [copiedSnippet, setCopiedSnippet] = useState<boolean>(false);
  const [rojoStatus, setRojoStatus] = useState<RojoStatusData | null>(null);
  const [manifestFiles, setManifestFiles] = useState<SyncManifestFile[]>([]);
  const [customPathInput, setCustomPathInput] = useState<string>('');
  const [configuring, setConfiguring] = useState<boolean>(false);
  const [configFeedback, setConfigFeedback] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<boolean>(true);

  const fetchRojoDiagnostics = async () => {
    setLoadingStatus(true);
    try {
      const [statusRes, manifestRes] = await Promise.all([
        fetch('/api/v1/rojo/status'),
        fetch('/api/v1/rojo/sync-manifest'),
      ]);
      const statusData = await statusRes.json();
      const manifestData = await manifestRes.json();
      setRojoStatus(statusData);
      setCustomPathInput(statusData.project_path || '');
      setManifestFiles(manifestData.files || []);
    } catch (err) {
      console.error('Error fetching Rojo status:', err);
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchRojoDiagnostics();
  }, []);

  const handleConfigureRojoProject = async () => {
    if (!customPathInput.trim()) return;
    setConfiguring(true);
    setConfigFeedback(null);
    setConfigError(null);
    try {
      const res = await fetch('/api/v1/rojo/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: customPathInput.trim(),
          create_if_missing: true,
          init_default_project_json: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Error al configurar ruta del proyecto Rojo');
      }
      setRojoStatus(data);
      setConfigFeedback(
        `Proyecto Rojo configurado y default.project.json verificado (${data.synced_files_count} archivos .luau sincronizados).`
      );
      const manifestRes = await fetch('/api/v1/rojo/sync-manifest');
      const manifestData = await manifestRes.json();
      setManifestFiles(manifestData.files || []);
    } catch (err: any) {
      setConfigError(err.message);
    } finally {
      setConfiguring(false);
    }
  };

  const sampleHttpSnippet = `--!strict
-- Invocación desde Roblox Studio al Backend Unificado (Script, UI o Modelo 3D)
local HttpService = game:GetService("HttpService")

local function generate3DOrScriptWithForgeAI(userPrompt: string, scriptType: "Server" | "Client" | "Module")
    local payload = HttpService:JSONEncode({
        prompt = userPrompt,
        script_type = scriptType,
        model_tier = "fast",
        save_to_rojo = true,
    })

    local response = HttpService:RequestAsync({
        Url = "http://127.0.0.1:8000/api/v1/generate-script",
        Method = "POST",
        Headers = {
            ["Content-Type"] = "application/json",
            -- ["X-Forge-Token"] = "tu_token_local_opcional"
        },
        Body = payload,
    })

    if response.Success then
        local data = HttpService:JSONDecode(response.Body)
        print("Archivo escrito en Rojo:", data.rojo_saved_path)
        return data.luau_code
    else
        warn("Error en Forge AI backend:", response.StatusMessage)
        return nil
    end
end`;

  const copyHttpSnippet = () => {
    navigator.clipboard.writeText(sampleHttpSnippet);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Fase 8: Conexión Local — Forge Local Bridge */}
      <LocalBridgeStatusPanel />

      {/* Live Rojo Project Configurator & Diagnostics */}
      <div className="p-6 rounded-2xl bg-[#0d1117] border border-slate-800 shadow-xl flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <FolderSync className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="text-base font-bold text-white">
                Configuración Real del Proyecto Rojo &amp; Verificador de Sincronización
              </h3>
              <p className="text-xs text-slate-400">
                Selecciona la carpeta de cualquier proyecto Rojo local, detecta <code className="text-cyan-300">default.project.json</code> y verifica con SHA-256 los archivos sincronizados con Roblox Studio.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={fetchRojoDiagnostics}
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingStatus ? 'animate-spin' : ''}`} />
            <span>Actualizar Diagnóstico</span>
          </button>
        </div>

        {/* Path Input & Configure Action */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex-1">
            <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
              Ruta del Proyecto Rojo (ROJO_PROJECT_PATH)
            </label>
            <input
              type="text"
              value={customPathInput}
              onChange={(e) => setCustomPathInput(e.target.value)}
              placeholder="/ruta/a/tu/proyecto_rojo"
              className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2 text-xs font-mono text-cyan-200 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <button
            type="button"
            onClick={handleConfigureRojoProject}
            disabled={configuring}
            className="sm:mt-5 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer shrink-0 disabled:opacity-50"
          >
            <CheckCircle className="w-4 h-4" />
            <span>{configuring ? 'Configurando...' : 'Vincular Carpeta & Crear default.project.json'}</span>
          </button>
        </div>

        {configFeedback && (
          <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{configFeedback}</span>
          </div>
        )}

        {configError && (
          <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-red-200 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{configError}</span>
          </div>
        )}

        {/* 4 Diagnostic Cards */}
        {rojoStatus && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] font-mono uppercase text-slate-400">
                default.project.json
              </span>
              <div className="text-sm font-bold text-emerald-400 mt-1 font-mono flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4" />
                {rojoStatus.default_project_json_exists
                  ? rojoStatus.default_project_name || 'Detectado'
                  : 'No encontrado'}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Mapeo completo de Server, Client, UI y Shared.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] font-mono uppercase text-slate-400">
                Binario Rojo CLI
              </span>
              <div className="text-sm font-bold text-cyan-300 mt-1 font-mono">
                {rojoStatus.rojo_cli_installed
                  ? rojoStatus.rojo_cli_version
                  : 'Modo Directo FS (Sin CLI en contenedor)'}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                En tu PC local ejecuta <code className="text-slate-200">rojo serve</code>.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] font-mono uppercase text-slate-400">
                Servidor Rojo (Puerto {rojoStatus.rojo_port})
              </span>
              <div className="text-sm font-bold text-purple-300 mt-1 font-mono">
                {rojoStatus.rojo_server_listening
                  ? `Activo en 127.0.0.1:${rojoStatus.rojo_port}`
                  : `Listo para rojo serve (:${rojoStatus.rojo_port})`}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Plugin Studio verifica manifest SHA-256 en vivo.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] font-mono uppercase text-slate-400">
                Archivos .luau Sincronizados
              </span>
              <div className="text-lg font-bold text-white mt-1 font-mono tabular-nums">
                {rojoStatus.synced_files_count} archivos
              </div>
              <p className="text-[11px] text-emerald-400 mt-1">
                Verificados en disco dentro del proyecto.
              </p>
            </div>
          </div>
        )}

        {/* Sync Manifest File Table */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/90 overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs">
            <span className="font-mono font-bold text-cyan-400 flex items-center gap-1.5">
              <FileCheck2 className="w-4 h-4" />
              Manifiesto de Sincronización en Disco (/api/v1/rojo/sync-manifest)
            </span>
            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
              {manifestFiles.length} archivos verificados con SHA-256
            </span>
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-slate-800/60 font-mono text-xs">
            {manifestFiles.map((file) => (
              <div
                key={file.relative_path}
                className="px-4 py-2 flex items-center justify-between gap-4 hover:bg-slate-900/40"
              >
                <span className="text-slate-200 truncate">{file.relative_path}</span>
                <div className="flex items-center gap-4 text-[11px] text-slate-400 shrink-0 tabular-nums">
                  <span>{file.size_bytes} B</span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-emerald-400">
                    sha256:{file.sha256}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Security Hardening Summary Card */}
      <div className="p-5 rounded-2xl bg-[#0d1117] border border-slate-800 shadow-xl flex flex-col gap-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          Blindaje de Seguridad Activo en Backend (FastAPI + Gateway Unificado)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="font-bold text-cyan-300 mb-1 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              Anti-Path Traversal &amp; Sandboxing
            </div>
            <p className="text-slate-400 leading-relaxed">
              <code className="text-slate-200">resolve_safe_project_path()</code> bloquea cualquier intento de escribir fuera de <code className="text-slate-200">ROJO_PROJECT_PATH</code> o en carpetas no autorizadas.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="font-bold text-purple-300 mb-1 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Validación de Código Luau &amp; Payload
            </div>
            <p className="text-slate-400 leading-relaxed">
              Inyección automática de <code className="text-slate-200">--!strict</code>, bloqueo de patrones peligrosos (<code className="text-slate-200">loadstring</code>, <code className="text-slate-200">getfenv</code>) y límite de payload de 15 MB.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="font-bold text-emerald-300 mb-1 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" />
              Rate Limiting, CORS &amp; X-Forge-Token
            </div>
            <p className="text-slate-400 leading-relaxed">
              Límite de 30 peticiones/min por IP, CORS restringido a orígenes locales y soporte de autenticación por cabecera <code className="text-slate-200">X-Forge-Token</code>.
            </p>
          </div>
        </div>
      </div>

      {/* Visual Rojo Mapping */}
      <div className="p-6 rounded-2xl bg-[#0d1117] border border-gray-800 shadow-xl">
        <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
          <Share2 className="w-5 h-5 text-cyan-400" />
          Arquitectura Rojo 7.x: Mapeo de Carpetas a DataModel de Roblox
        </h3>
        <p className="text-xs text-gray-400 mb-6 max-w-2xl leading-relaxed">
          Cuando <code className="text-cyan-300">save_to_rojo: true</code> está activo, los scripts y modelos 3D se escriben directamente en tu proyecto Rojo y son verificados mediante el manifiesto SHA-256.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-gray-950 border border-blue-500/30 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-blue-400 mb-2">
                <Server className="w-4 h-4" />
                <span className="font-mono text-xs font-bold">src/server/</span>
              </div>
              <p className="text-[11px] text-gray-400 mb-3">
                Archivos <code className="text-blue-300">*.server.luau</code> o módulos exclusivos de servidor.
              </p>
            </div>
            <div className="pt-3 border-t border-gray-800/80 flex items-center gap-2 text-xs font-semibold text-white">
              <ArrowRight className="w-3.5 h-3.5 text-blue-400" />
              <span>ServerScriptService</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-gray-950 border border-emerald-500/30 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-emerald-400 mb-2">
                <Smartphone className="w-4 h-4" />
                <span className="font-mono text-xs font-bold">src/client/</span>
              </div>
              <p className="text-[11px] text-gray-400 mb-3">
                Archivos <code className="text-emerald-300">*.client.luau</code> para controladores y lógica local.
              </p>
            </div>
            <div className="pt-3 border-t border-gray-800/80 flex items-center gap-2 text-xs font-semibold text-white">
              <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
              <span>StarterPlayerScripts</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-gray-950 border border-purple-500/30 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-purple-400 mb-2">
                <Layout className="w-4 h-4" />
                <span className="font-mono text-xs font-bold">src/client/UI/</span>
              </div>
              <p className="text-[11px] text-gray-400 mb-3">
                Módulos de componentes ForgeGUI, ScreenGui y ViewportFrames 3D.
              </p>
            </div>
            <div className="pt-3 border-t border-gray-800/80 flex items-center gap-2 text-xs font-semibold text-white">
              <ArrowRight className="w-3.5 h-3.5 text-purple-400" />
              <span>StarterGui</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-gray-950 border border-cyan-500/30 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-cyan-400 mb-2">
                <Share2 className="w-4 h-4" />
                <span className="font-mono text-xs font-bold">src/shared/Assets3D/</span>
              </div>
              <p className="text-[11px] text-gray-400 mb-3">
                Constructores de modelos 3D, escenarios, Maid, RemoteProvider y tipos.
              </p>
            </div>
            <div className="pt-3 border-t border-gray-800/80 flex items-center gap-2 text-xs font-semibold text-white">
              <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
              <span>ReplicatedStorage</span>
            </div>
          </div>
        </div>
      </div>

      {/* Step by step Setup Guide */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-5 rounded-2xl bg-[#0d1117] border border-gray-800 flex flex-col gap-4">
          <h4 className="font-bold text-sm text-white flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            Plugin Roblox Studio v2.0 (Scripts + Modelos 3D + Optimizador Selection)
          </h4>
          <ol className="text-xs text-gray-300 space-y-2.5 list-decimal pl-4 leading-relaxed">
            <li>
              El nuevo <strong className="text-white">ForgeAIStudioPlugin.server.luau v2.0</strong> incluye selector dinámico <code className="text-cyan-300">Server | Client | Module</code> (ya no fuerza Server), generador e importador de modelos 3D en <code className="text-cyan-300">Workspace</code>, optimizador de <code className="text-cyan-300">Selection</code> y verificador de sincronización Rojo.
            </li>
            <li>
              Guárdalo en tu carpeta local de plugins de Roblox Studio:
              <div className="p-2 rounded bg-black/60 font-mono text-[11px] text-cyan-300 my-1">
                Windows: %LocalAppData%\Roblox\Plugins\<br />
                macOS: ~/Library/Application Support/Roblox/Plugins/
              </div>
            </li>
          </ol>

          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2.5 mt-1">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <div>
              <strong>Requisito Obligatorio:</strong> En Roblox Studio, activa <em>Game Settings &gt; Security &gt; Allow HTTP Requests</em>.
            </div>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-[#0d1117] border border-gray-800 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-sm text-white">Consumo Directo vía HttpService</h4>
            <button
              type="button"
              onClick={copyHttpSnippet}
              className="px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-[11px] text-white flex items-center gap-1.5 transition cursor-pointer"
            >
              {copiedSnippet ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copiedSnippet ? 'Copiado!' : 'Copiar Snippet'}
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Invoca el backend unificado desde el plugin o la Command Bar de Roblox Studio:
          </p>
          <div className="bg-[#0b0e14] p-3 rounded-xl border border-gray-800 max-h-52 overflow-auto font-mono text-xs text-gray-300 select-text">
            <pre className="whitespace-pre overflow-x-auto">{sampleHttpSnippet}</pre>
          </div>
        </div>
      </div>
    </div>
  );
};
