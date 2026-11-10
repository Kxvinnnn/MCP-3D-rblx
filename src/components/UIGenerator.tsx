import React, { useState } from 'react';
import { Sparkles, Image as ImageIcon, Upload, Play, Download, Copy, Check, Info, Palette, Folder } from 'lucide-react';
import { RobloxCanvasPreview, UINodeData } from './RobloxCanvasPreview.tsx';
import { FloatingTerminalLog, TerminalLogEntry } from './FloatingTerminalLog.tsx';

interface UIResult {
  file_name: string;
  rojo_target_folder: string;
  luau_code: string;
  ui_tree: UINodeData;
  explanation: string;
  style_theme: string;
  saved_path?: string | null;
}

export const UIGenerator: React.FC = () => {
  const [prompt, setPrompt] = useState<string>(
    'Crea un menú de Tienda de Armas Cyberpunk modal. Contenedor centrado con UDim2.fromScale(0.55, 0.65). Debe incluir una barra superior con título en degradado y botón de cerrar "X", una lista o grid con 3 tarjetas de armas (con precio, botón de comprar "PURCHASE" con efecto hover e icono cuadrado con UIAspectRatioConstraint).'
  );
  const [styleTheme, setStyleTheme] = useState<string>('Dark Cyberpunk');
  const [modelTier, setModelTier] = useState<'fast' | 'pro'>('fast');
  const [saveToRojo, setSaveToRojo] = useState<boolean>(true);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<UIResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [activeCodeTab, setActiveCodeTab] = useState<'luau' | 'json'>('luau');

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

  const themes = [
    { name: 'Dark Cyberpunk', color: 'from-cyan-500 to-indigo-600', desc: 'Neón azul/magenta, bordes brillantes y fondos oscuros' },
    { name: 'Horror / Thriller', color: 'from-red-600 to-zinc-900', desc: 'Tonos sangre, tipografía rústica y viñetas desgastadas' },
    { name: 'Minimalist Clean', color: 'from-slate-400 to-slate-700', desc: 'Diseño sobrio, transparencias de vidrio y tipografía nítida' },
    { name: 'Sci-Fi HUD Hologram', color: 'from-emerald-400 to-cyan-700', desc: 'Líneas técnicas, esquinas cortadas y acentos holográficos' },
    { name: 'RPG Medieval Fantasy', color: 'from-amber-500 to-stone-800', desc: 'Bordes dorados/bronce, pergaminos y botones orlados' },
  ];

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result as string;
      setImageBase64(b64);
      setImagePreview(b64);
      addLog('info', `Imagen de referencia cargada: ${file.name} (${Math.round(file.size / 1024)} KB)`);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setStreamingBuffer('');

    addLog(
      'info',
      `POST /api/v1/generate-ui-stream (style_theme="${styleTheme}", model_tier="${modelTier}", save_to_rojo=${saveToRojo})`
    );

    try {
      const res = await fetch('/api/v1/generate-ui-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          style_theme: styleTheme,
          reference_image_base64: imageBase64,
          save_to_rojo: saveToRojo,
          model_tier: modelTier,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error('Error al conectar con el stream de ForgeGUI');
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
      const msg = err.message || 'Error de conexión con el backend';
      setError(msg);
      addLog('error', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Settings Panel */}
      <div className="lg:col-span-5 flex flex-col gap-5">
        <div className="p-5 rounded-2xl bg-gray-900/80 border border-gray-800 shadow-xl flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base text-white flex items-center gap-2">
              <Palette className="w-4 h-4 text-purple-400" />
              ForgeGUI: Diseñador de Interfaces Roblox
            </h3>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-purple-950 text-purple-300 border border-purple-800">
              UDim2.fromScale
            </span>
          </div>

          {/* Theme Selector */}
          <div>
            <label className="text-xs font-semibold text-gray-300 mb-2 block">
              Tema y Estilo Visual
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {themes.map((t) => {
                const isSelected = styleTheme === t.name;
                return (
                  <button
                    key={t.name}
                    onClick={() => setStyleTheme(t.name)}
                    className={`p-2.5 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-purple-600/20 border-purple-500 text-white shadow'
                        : 'bg-gray-800/40 border-gray-700/60 text-gray-400 hover:text-white hover:bg-gray-800'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full bg-gradient-to-br ${t.color}`} />
                        <span className="text-xs font-bold text-white">{t.name}</span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-0.5">{t.desc}</p>
                    </div>
                    {isSelected && <span className="text-xs text-purple-400 font-bold">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Prompt description */}
          <div>
            <label className="text-xs font-semibold text-gray-300 mb-1.5 block">
              Descripción y Componentes Requeridos
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Describe los elementos: botones, modales, barras de salud, animaciones de apertura..."
              className="w-full rounded-xl bg-gray-950 border border-gray-800 p-3 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500 font-sans leading-relaxed"
            />
          </div>

          {/* Reference Image Upload */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
                Imagen de Referencia o Boceto (Opcional)
              </label>
              {imagePreview && (
                <button
                  onClick={() => {
                    setImageBase64(null);
                    setImagePreview(null);
                  }}
                  className="text-[11px] text-red-400 hover:underline cursor-pointer"
                >
                  Eliminar imagen
                </button>
              )}
            </div>

            {imagePreview ? (
              <div className="relative rounded-xl border border-gray-700 overflow-hidden max-h-36 bg-black flex items-center justify-center">
                <img src={imagePreview} alt="Reference" className="max-h-36 object-contain" />
              </div>
            ) : (
              <label className="border-2 border-dashed border-gray-700 hover:border-purple-500/80 rounded-xl p-3 flex flex-col items-center justify-center cursor-pointer transition bg-gray-950/50 hover:bg-gray-950">
                <Upload className="w-5 h-5 text-gray-400 mb-1" />
                <span className="text-xs text-gray-300 font-medium">Subir captura o wireframe (PNG/JPG)</span>
                <span className="text-[10px] text-gray-500 mt-0.5">Gemini analizará la composición visual</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* Auto-save checkbox */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-gray-950 border border-gray-800">
            <div className="flex items-center gap-2">
              <Folder className="w-4 h-4 text-purple-400" />
              <div className="text-xs">
                <span className="font-semibold text-white">Auto-guardar en Proyecto Rojo (src/client/UI)</span>
                <p className="text-[10px] text-gray-400">Escribe el módulo Luau directamente en tu workspace Rojo</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={saveToRojo}
              onChange={(e) => setSaveToRojo(e.target.checked)}
              className="w-4 h-4 accent-purple-500 rounded cursor-pointer"
            />
          </div>

          {/* Submit button */}
          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 via-pink-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 font-bold text-xs uppercase tracking-wider text-white shadow-xl shadow-purple-600/20 disabled:opacity-50 transition active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generando ForgeGUI & Canvas...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                Generar Interfaz Roblox (Luau & UI Tree)
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

      {/* Right Canvas Preview & Code Inspection */}
      <div className="lg:col-span-7 flex flex-col gap-4">
        {/* Interactive Roblox Canvas simulation */}
        <div className="h-[440px]">
          <RobloxCanvasPreview
            uiTree={result?.ui_tree}
            theme={result?.style_theme || styleTheme}
            fileName={result?.file_name || 'ForgeGUIComponent.luau'}
          />
        </div>

        {/* Code & JSON Tabs */}
        {result && (
          <div className="rounded-xl border border-gray-800 bg-[#0d1117] overflow-hidden shadow-2xl flex flex-col">
            <div className="bg-[#161b22] border-b border-gray-800 px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveCodeTab('luau')}
                  className={`px-3 py-1 rounded text-xs font-mono font-semibold transition ${
                    activeCodeTab === 'luau'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {result.file_name} (Módulo Luau)
                </button>
                <button
                  onClick={() => setActiveCodeTab('json')}
                  className={`px-3 py-1 rounded text-xs font-mono font-semibold transition ${
                    activeCodeTab === 'json'
                      ? 'bg-purple-600 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  ui_tree.json (Roblox Plugin Tree)
                </button>
              </div>

              <div className="flex items-center gap-2">
                {result.saved_path && (
                  <span className="text-[11px] text-emerald-400 font-mono mr-2 hidden sm:inline">
                    💾 {result.saved_path}
                  </span>
                )}
                <button
                  onClick={() =>
                    handleCopy(activeCodeTab === 'luau' ? result.luau_code : JSON.stringify(result.ui_tree, null, 2))
                  }
                  className="px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-white flex items-center gap-1.5 transition cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
            </div>

            <div className="p-4 max-h-[320px] overflow-auto font-mono text-xs text-gray-200 select-text leading-relaxed">
              <pre className="whitespace-pre overflow-x-auto">
                {activeCodeTab === 'luau'
                  ? result.luau_code
                  : JSON.stringify(result.ui_tree, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Floating Terminal Output Log */}
      <FloatingTerminalLog
        title="ForgeGUI Studio • Live Stream & Rojo Sync"
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
