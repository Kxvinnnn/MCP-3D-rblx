import React, { useState, useEffect } from 'react';
import { Copy, Check, Download, FileCode, Terminal, FolderTree, Cpu, ShieldCheck } from 'lucide-react';

export const BackendExplorer: React.FC = () => {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string>('main.py');
  const [copied, setCopied] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetch('/api/v1/files')
      .then((res) => res.json())
      .then((data) => {
        if (data.files) {
          setFiles(data.files);
        }
      })
      .catch((err) => console.error('Error fetching backend files:', err))
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = () => {
    const code = files[selectedFile] || '';
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSingle = (fileName: string) => {
    const content = files[fileName] || '';
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName.split('/').pop() || 'file.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  const fileDescriptions: Record<string, string> = {
    'AI_ARCHITECTURE_MAP.md': 'Índice de auto-comprensión para IA: tabla 1:1 de motores, invariantes P0 y podador de contexto.',
    'README.md': 'Documentación principal del repositorio: arquitectura de 7 motores, capacidades 3D, roadmap P0-P3 y despliegue.',
    'docs/ARCHITECTURE.md': 'Diseño profundo de los 7 motores modulares, visor 3D WebGL (Three.js) y flujo multi-agente P3.',
    'docs/API_REFERENCE.md': 'Especificación técnica completa de todos los endpoints REST y Server-Sent Events (SSE).',
    'docs/ROBLOX_PLUGIN_AND_ROJO_GUIDE.md': 'Manual de integración con Rojo 7.x y uso del plugin ForgeAIStudioPlugin.server.luau v2.3.0.',
    'main.py': 'Orquestador central FastAPI que coordina los 7 motores independientes y el plugin de Roblox Studio.',
    'engines/context_pruner.py': 'Podador de contexto IA por dominio (Python): reduce ~65% el contexto extra enviado a Gemini.',
    'engines/rojo_bridge.py': 'Motor Rojo Bridge (Python): sandboxing de rutas, default.project.json, manifiesto SHA-256 y auditoría.',
    'engines/generation_3d_engine.py': 'Motor 3D Generation (Python): buffers de geometría EditableMesh, auto-split >9k tris y Luau --!strict.',
    'engines/asset_engine.py': 'Motor Asset Engine (Python): serializador/parser .RBXMX, glTF 2.0, .OBJ/.MTL y PBR Open Cloud.',
    'engines/world_engine.py': 'Motor World Engine (Python): escenarios completos, biomas de iluminación, atmósfera y posicionamiento.',
    'engines/luau_engine.py': 'Motor Luau Engine (Python): arquitectura de scripts Server/Client/Module --!strict y ciclo de vida Maid.',
    'engines/ui_engine.py': 'Motor UI Engine (Python): interfaces ScreenGui responsive (UDim2.fromScale), ViewportFrame y TweenService.',
    'engines/agents_engine.py': 'Motor de Agentes Especializados (Python P3): pipeline autónomo de 7 agentes colaborativos.',
    'src/server/engines/contextPrunerEngine.ts': 'Podador de contexto IA por dominio (TS) + manifiesto de contratos AI_MODULE_CONTRACTS.',
    'src/server/engines/generation3DEngine.ts': 'Motor 1/7 (TS): Geometría 3D, parser .OBJ, splitter >9k tris y generador Luau EditableMesh.',
    'src/server/engines/assetEngine.ts': 'Motor 2/7 (TS): Serializador/parser .RBXMX, exportador glTF 2.0, .OBJ/.MTL y PBR SurfaceAppearance.',
    'src/server/engines/luauEngine.ts': 'Motor 3/7 (TS): Enrutamiento Server/Client/Module y contratos --!strict + Maid.',
    'src/server/engines/uiEngine.ts': 'Motor 4/7 (TS): Reglas y validador ForgeGUI (UDim2.fromScale, ViewportFrame, TweenService).',
    'src/server/engines/worldEngine.ts': 'Motor 5/7 (TS): Presets de biomas lumínicos y generador de escenarios WorldEngine.',
    'src/server/engines/rojoBridge.ts': 'Motor 6/7 (TS): Sandboxing de rutas Rojo y sanitizador de seguridad Luau.',
    'src/server/engines/agentsEngine.ts': 'Motor 7/7 (TS): Orquestador autónomo de 7 agentes especializados (P3).',
    'src/components/engines/3dEngine.ts': 'Jerarquía de clases frontend (GLBMeshParser, OBJMeshParser, Roblox3DEngineProcessor) para WebGL/Roblox.',
    'requirements.txt': 'Dependencias Python 3.11+: fastapi, uvicorn, pydantic, python-dotenv, google-genai.',
    '.env.example': 'Configuración de entorno para GEMINI_API_KEY, ROJO_PROJECT_PATH y tiers de modelos.',
    'project_context.md': 'Plantilla de contexto local con mapeo Rojo, estándares Luau, Maid pattern y tokens de UI.',
    'roblox_plugin/ForgeAIStudioPlugin.server.luau': 'Plugin oficial de Roblox Studio v2.3.0 con reconstrucción EditableMesh in-place y PBR.',
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Architecture Overview Banner */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-gray-900/90 border border-gray-800 flex items-start gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">SDK Oficial google-genai</h4>
            <p className="text-xs text-gray-400 mt-1">Usa <code className="text-emerald-300">from google import genai</code> y <code className="text-emerald-300">client = genai.Client()</code>.</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-gray-900/90 border border-gray-800 flex items-start gap-3">
          <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">Structured Outputs</h4>
            <p className="text-xs text-gray-400 mt-1">Pydantic models directos en <code className="text-blue-300">response_schema</code> sin parseos manuales.</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-gray-900/90 border border-gray-800 flex items-start gap-3">
          <div className="p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400">
            <FolderTree className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">Rojo 7.x Auto-Sync</h4>
            <p className="text-xs text-gray-400 mt-1">Escritura automática en <code className="text-purple-300">src/server</code>, <code className="text-purple-300">src/client</code>, <code className="text-purple-300">src/shared</code>.</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-gray-900/90 border border-gray-800 flex items-start gap-3">
          <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">HttpService Ready</h4>
            <p className="text-xs text-gray-400 mt-1">Endpoints REST compatibles con <code className="text-cyan-300">HttpService:RequestAsync</code>.</p>
          </div>
        </div>
      </div>

      {/* Main Code Viewer Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left file tree */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <div className="p-4 rounded-xl bg-gray-900/80 border border-gray-800">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-gray-400 tracking-wider uppercase flex items-center gap-2">
                <FolderTree className="w-4 h-4 text-cyan-400" />
                Estructura del Servidor Local
              </span>
              <span className="text-[11px] text-gray-500 font-mono">forge-roblox-backend/</span>
            </div>

            <div className="flex flex-col gap-1.5">
              {Object.keys(files).map((fileName) => {
                const isSelected = selectedFile === fileName;
                const isPlugin = fileName.includes('roblox_plugin');
                return (
                  <button
                    key={fileName}
                    onClick={() => setSelectedFile(fileName)}
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg text-left transition ${
                      isSelected
                        ? 'bg-blue-600/20 border border-blue-500/40 text-white'
                        : 'hover:bg-gray-800/60 text-gray-300 border border-transparent'
                    }`}
                  >
                    <FileCode className={`w-4 h-4 mt-0.5 shrink-0 ${isSelected ? 'text-blue-400' : isPlugin ? 'text-purple-400' : 'text-gray-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-semibold truncate">{fileName}</span>
                      </div>
                      <p className="text-[11px] text-gray-400 truncate mt-0.5">
                        {fileDescriptions[fileName] || 'Archivo de configuración'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quickstart instructions box */}
          <div className="p-4 rounded-xl bg-[#0e131f] border border-cyan-500/30">
            <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs mb-2">
              <Terminal className="w-4 h-4" />
              INSTRUCCIONES DE DESPLIEGUE LOCAL
            </div>
            <p className="text-xs text-gray-300 mb-3 leading-relaxed">
              Ejecuta estos comandos en tu terminal en la carpeta donde descargues estos archivos:
            </p>
            <div className="bg-black/80 rounded-lg p-3 font-mono text-xs text-gray-300 space-y-1.5 select-all border border-gray-800">
              <p className="text-gray-500"># 1. Crear y activar entorno virtual</p>
              <p className="text-emerald-400">python -m venv venv</p>
              <p className="text-emerald-400">source venv/bin/activate  # En Windows: .\venv\Scripts\activate</p>
              <p className="text-gray-500 mt-2"># 2. Instalar dependencias</p>
              <p className="text-emerald-400">pip install -r requirements.txt</p>
              <p className="text-gray-500 mt-2"># 3. Configurar tu API Key y Rojo Path</p>
              <p className="text-emerald-400">cp .env.example .env</p>
              <p className="text-gray-500 mt-2"># 4. Iniciar servidor FastAPI</p>
              <p className="text-cyan-300 font-bold">uvicorn main:app --reload --port 8000</p>
            </div>
          </div>
        </div>

        {/* Right Code Content Viewer */}
        <div className="lg:col-span-8 flex flex-col rounded-xl bg-[#0b0e14] border border-gray-800 overflow-hidden shadow-2xl">
          {/* Header */}
          <div className="bg-[#121620] border-b border-gray-800 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-cyan-400 font-bold">{selectedFile}</span>
              <span className="text-gray-500 text-xs">•</span>
              <span className="text-xs text-gray-400 hidden sm:inline">
                {fileDescriptions[selectedFile]}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-medium text-gray-200 flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copiado!' : 'Copiar Código'}
              </button>

              <button
                onClick={() => handleDownloadSingle(selectedFile)}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Descargar Archivo
              </button>
            </div>
          </div>

          {/* Code Body */}
          <div className="p-4 flex-1 overflow-auto max-h-[620px] bg-[#080b10] font-mono text-xs leading-relaxed text-gray-300">
            {loading ? (
              <div className="text-gray-500 py-10 text-center animate-pulse">Cargando código fuente...</div>
            ) : (
              <pre className="whitespace-pre overflow-x-auto select-text font-mono">
                {files[selectedFile] || '# Archivo vacío o no encontrado'}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
