import React, { useState } from 'react';
import { Play, Copy, Check, Download, Sparkles, Folder, Cpu, FileCode2, Info } from 'lucide-react';
import { FloatingTerminalLog, TerminalLogEntry } from './FloatingTerminalLog.tsx';

interface ScriptResult {
  file_name: string;
  rojo_target_folder: string;
  luau_code: string;
  dependencies: string[];
  explanation: string;
  saved_path?: string | null;
}

export const ScriptGenerator: React.FC = () => {
  const [prompt, setPrompt] = useState<string>(
    'Crea un sistema de inventario seguro en el servidor. Debe cargar datos de DataStoreService con manejo de reintentos (pcall), escuchar RemoteEvents para agregar y remover items verificando que pertenezcan al jugador, y utilizar el patrón Maid para limpiar conexiones al desconectarse el jugador.'
  );
  const [scriptType, setScriptType] = useState<'Server' | 'Client' | 'Module'>('Server');
  const [modelTier, setModelTier] = useState<'fast' | 'pro'>('fast');
  const [saveToRojo, setSaveToRojo] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Real-time terminal log state
  const [logs, setLogs] = useState<TerminalLogEntry[]>([]);
  const [streamingBuffer, setStreamingBuffer] = useState<string>('');

  const addLog = (level: TerminalLogEntry['level'], message: string) => {
    const now = new Date();
    const timestamp = now.toTimeString().split(' ')[0];
    setLogs((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random()}`,
        timestamp,
        level,
        message,
      },
    ]);
  };

  const presets = [
    {
      title: 'Inventario DataStore & Maid',
      type: 'Server' as const,
      tier: 'pro' as const,
      text: 'Crea un DataManager para el servidor con DataStoreService. Carga datos de inventario del jugador al unirse (Players.PlayerAdded), guarda al salir (Players.PlayerRemoving) y periódicamente con task.delay. Usa el patrón Maid para gestionar conexiones y variables temporales.',
    },
    {
      title: 'Combate Melee con Hitbox Raycast',
      type: 'Server' as const,
      tier: 'fast' as const,
      text: 'Crea un sistema de hitbox para espadas en el servidor. Usa WorldRoot:Blockcast o Raycast con RaycastParams exclusivos. Valida la distancia máxima entre el atacante y la víctima para evitar exploits y aplica daño con Humanoid:TakeDamage.',
    },
    {
      title: 'Controlador de Cámara & Dash (Client)',
      type: 'Client' as const,
      tier: 'fast' as const,
      text: 'Crea un módulo en cliente para dash (esquiva rápida) con UserInputService y TweenService. Debe escuchar la tecla Q o doble toque, aplicar una fuerza de LinearVelocity, animar la cámara y limpiar todas las conexiones con Maid.',
    },
    {
      title: 'Network RemoteProvider (Shared)',
      type: 'Module' as const,
      tier: 'pro' as const,
      text: 'Crea un módulo compartido NetworkProvider que defina, cree automáticamente y exponga RemoteEvents fuertemente tipados en ReplicatedStorage.Network. Incluye tipado estático con export type y verificación de tipos.',
    },
  ];

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setStreamingBuffer('');

    addLog(
      'info',
      `POST /api/v1/generate-script-stream (script_type="${scriptType}", model_tier="${modelTier}", save_to_rojo=${saveToRojo})`
    );

    try {
      const res = await fetch('/api/v1/generate-script-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          script_type: scriptType,
          model_tier: modelTier,
          save_to_rojo: saveToRojo,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error('Error al conectar con el stream del backend');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split('\n\n');
        sseBuffer = events.pop() || '';

        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.replace(/^data:\s*/, '');
          try {
            const payload = JSON.parse(jsonStr);
            if (payload.type === 'log') {
              addLog(payload.level || 'info', payload.message);
            } else if (payload.type === 'chunk') {
              setStreamingBuffer((prev) => prev + (payload.text || ''));
            } else if (payload.type === 'done') {
              setResult(payload.result);
            } else if (payload.type === 'error') {
              addLog('error', payload.message);
              setError(payload.message);
            }
          } catch {
            // ignore partial line parse errors
          }
        }
      }
    } catch (err: any) {
      const msg = err.message || 'Error de conexión';
      setError(msg);
      addLog('error', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (!result?.luau_code) return;
    navigator.clipboard.writeText(result.luau_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadCode = () => {
    if (!result?.luau_code) return;
    const blob = new Blob([result.luau_code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.file_name || 'script.luau';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Input Configuration Column */}
      <div className="lg:col-span-5 flex flex-col gap-5">
        <div className="p-5 rounded-2xl bg-gray-900/80 border border-gray-800 shadow-xl flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              Generador de Arquitectura Luau
            </h3>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800">
              --!strict Enforced
            </span>
          </div>

          {/* Script Type Selector */}
          <div>
            <label className="text-xs font-semibold text-gray-300 mb-2 block">
              Tipo de Script / Entorno de Ejecución Roblox
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['Server', 'Client', 'Module'] as const).map((type) => {
                const isSelected = scriptType === type;
                const pathHint = type === 'Server' ? 'src/server' : type === 'Client' ? 'src/client' : 'src/shared';
                return (
                  <button
                    key={type}
                    onClick={() => setScriptType(type)}
                    className={`p-2.5 rounded-xl border text-center transition cursor-pointer flex flex-col items-center justify-center ${
                      isSelected
                        ? 'bg-blue-600/30 border-blue-500 text-white shadow-lg shadow-blue-500/10'
                        : 'bg-gray-800/60 border-gray-700/60 text-gray-400 hover:text-white hover:bg-gray-800'
                    }`}
                  >
                    <span className="text-xs font-bold">{type}</span>
                    <span className="text-[10px] font-mono text-cyan-400 mt-0.5">{pathHint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Model Tier Selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-300">
                Modelo Gemini Dinámico
              </label>
              <span className="text-[11px] text-gray-400 font-mono">
                {modelTier === 'pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setModelTier('fast')}
                className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                  modelTier === 'fast'
                    ? 'bg-emerald-600/20 border-emerald-500/50 text-white'
                    : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                  <Cpu className="w-3.5 h-3.5" />
                  Fast Tier
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">Iteraciones rápidas, UI y utilidades</div>
              </button>

              <button
                onClick={() => setModelTier('pro')}
                className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                  modelTier === 'pro'
                    ? 'bg-purple-600/20 border-purple-500/50 text-white'
                    : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-bold text-purple-400">
                  <Sparkles className="w-3.5 h-3.5" />
                  Pro Tier (Razonamiento)
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">Arquitectura profunda y réplica</div>
              </button>
            </div>
          </div>

          {/* Prompt Presets */}
          <div>
            <label className="text-xs font-semibold text-gray-400 mb-1.5 block">
              Plantillas de Prompts de Arquitectura
            </label>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.title}
                  onClick={() => {
                    setPrompt(p.text);
                    setScriptType(p.type);
                    setModelTier(p.tier);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-[11px] text-gray-300 hover:text-white transition cursor-pointer border border-gray-700/60"
                >
                  {p.title}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Textarea */}
          <div>
            <label className="text-xs font-semibold text-gray-300 mb-1.5 block">
              Instrucciones / Requerimientos del Sistema
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="Escribe los requerimientos de tu script Luau..."
              className="w-full rounded-xl bg-gray-950 border border-gray-800 p-3 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500 font-sans leading-relaxed"
            />
          </div>

          {/* Auto-save checkbox */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-gray-950 border border-gray-800">
            <div className="flex items-center gap-2">
              <Folder className="w-4 h-4 text-purple-400" />
              <div className="text-xs">
                <span className="font-semibold text-white">Auto-guardar en Proyecto Rojo</span>
                <p className="text-[10px] text-gray-400">Escribe automáticamente el archivo en tu workspace local</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={saveToRojo}
              onChange={(e) => setSaveToRojo(e.target.checked)}
              className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
            />
          </div>

          {/* Submit Button */}
          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 font-bold text-xs uppercase tracking-wider text-white shadow-xl shadow-blue-600/20 disabled:opacity-50 transition active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generando con Gemini Structured Outputs...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                Generar Script Luau
              </>
            )}
          </button>

          {error && (
            <div className="p-3 rounded-xl bg-red-950/50 border border-red-500/40 text-red-300 text-xs flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <div>{error}</div>
            </div>
          )}
        </div>
      </div>

      {/* Right Result Column */}
      <div className="lg:col-span-7 flex flex-col gap-4">
        {result ? (
          <div className="flex flex-col gap-4 animate-in fade-in">
            {/* Meta badges */}
            <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 flex flex-wrap items-center justify-between gap-3 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                  <FileCode2 className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-white">{result.file_name}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800 font-mono">
                      {result.rojo_target_folder}
                    </span>
                  </div>
                  {result.saved_path && (
                    <p className="text-[11px] text-emerald-400 font-mono mt-0.5">
                      💾 Guardado en: {result.saved_path}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyCode}
                  className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-medium text-white flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copiado!' : 'Copiar'}
                </button>
                <button
                  onClick={handleDownloadCode}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descargar .luau
                </button>
              </div>
            </div>

            {/* Dependencies and explanation */}
            <div className="p-4 rounded-xl bg-gray-900/60 border border-gray-800 flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Dependencias:</span>
                <div className="flex flex-wrap gap-1.5">
                  {result.dependencies.map((dep) => (
                    <span key={dep} className="px-2 py-0.5 rounded-md bg-gray-800 text-purple-300 font-mono text-[11px]">
                      {dep}
                    </span>
                  ))}
                </div>
              </div>

              <p className="text-xs text-gray-300 leading-relaxed bg-black/30 p-2.5 rounded-lg border border-gray-800/80">
                <strong className="text-cyan-400">Explicación Arquitectónica: </strong>
                {result.explanation}
              </p>
            </div>

            {/* Luau Code Viewer */}
            <div className="rounded-xl border border-gray-800 bg-[#0a0d13] overflow-hidden shadow-2xl flex flex-col">
              <div className="bg-[#121620] px-4 py-2 border-b border-gray-800 flex items-center justify-between text-xs text-gray-400">
                <span className="font-mono text-cyan-400 font-semibold">{result.file_name}</span>
                <span className="font-mono text-[11px] text-emerald-400">--!strict • task library • Maid pattern</span>
              </div>
              <div className="p-4 overflow-auto max-h-[520px] font-mono text-xs text-gray-200 leading-relaxed select-text">
                <pre className="whitespace-pre overflow-x-auto">{result.luau_code}</pre>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full min-h-[460px] rounded-2xl border border-dashed border-gray-800 flex flex-col items-center justify-center p-8 text-center text-gray-500">
            <div className="w-12 h-12 rounded-2xl bg-gray-900 border border-gray-800 flex items-center justify-center text-gray-400 mb-3">
              <FileCode2 className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-gray-300 mb-1">Sin Script Generado</h4>
            <p className="text-xs text-gray-500 max-w-sm mb-4">
              Selecciona un preset o escribe tus requerimientos a la izquierda para generar código Luau estricto, con soporte de Rojo y la librería moderna <code className="text-cyan-400">task</code>.
            </p>
          </div>
        )}
      </div>

      {/* Floating Terminal Output Log */}
      <FloatingTerminalLog
        title="Script Generator • Live Stream & Rojo Sync"
        logs={logs}
        streamingBuffer={streamingBuffer}
        isStreaming={loading}
        onClear={() => {
          setLogs([]);
          setStreamingBuffer('');
        }}
      />
    </div>
  );
};
