import React, { useState } from 'react';
import { ArrowRight, Server, Smartphone, Layout, Share2, ShieldAlert, CheckCircle, Copy, Check } from 'lucide-react';

export const RojoWorkflowGuide: React.FC = () => {
  const [copiedSnippet, setCopiedSnippet] = useState<boolean>(false);

  const sampleHttpSnippet = `--!strict
-- Ejemplo de invocación directa desde Roblox Studio a tu servidor FastAPI
local HttpService = game:GetService("HttpService")

local function generateWithForgeAI(userPrompt: string, scriptType: "Server" | "Client" | "Module")
    local payload = HttpService:JSONEncode({
        prompt = userPrompt,
        script_type = scriptType,
        model_tier = "fast",
        save_to_rojo = true,
    })

    local response = HttpService:RequestAsync({
        Url = "http://127.0.0.1:8000/api/v1/generate-script",
        Method = "POST",
        Headers = { ["Content-Type"] = "application/json" },
        Body = payload,
    })

    if response.Success then
        local data = HttpService:JSONDecode(response.Body)
        print("Script generado:", data.file_name)
        print("Ruta Rojo:", data.rojo_target_folder)
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
      {/* Visual Rojo Mapping */}
      <div className="p-6 rounded-2xl bg-gray-900/90 border border-gray-800 shadow-xl">
        <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
          <Share2 className="w-5 h-5 text-cyan-400" />
          Arquitectura Rojo 7.x: Mapeo de Carpetas a DataModel de Roblox
        </h3>
        <p className="text-xs text-gray-400 mb-6 max-w-2xl leading-relaxed">
          Cuando el backend de FastAPI tiene activo <code className="text-cyan-300">save_to_rojo: true</code>, los archivos se escriben directamente en tu disco local. El daemon de Rojo sincroniza los cambios inmediatamente con Roblox Studio sin que tengas que copiar y pegar código.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Server */}
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

          {/* Client */}
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

          {/* UI */}
          <div className="p-4 rounded-xl bg-gray-950 border border-purple-500/30 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-purple-400 mb-2">
                <Layout className="w-4 h-4" />
                <span className="font-mono text-xs font-bold">src/client/UI/</span>
              </div>
              <p className="text-[11px] text-gray-400 mb-3">
                Módulos de componentes ForgeGUI, pantallas ScreenGui y HUDs responsive.
              </p>
            </div>
            <div className="pt-3 border-t border-gray-800/80 flex items-center gap-2 text-xs font-semibold text-white">
              <ArrowRight className="w-3.5 h-3.5 text-purple-400" />
              <span>StarterGui</span>
            </div>
          </div>

          {/* Shared */}
          <div className="p-4 rounded-xl bg-gray-950 border border-cyan-500/30 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-cyan-400 mb-2">
                <Share2 className="w-4 h-4" />
                <span className="font-mono text-xs font-bold">src/shared/</span>
              </div>
              <p className="text-[11px] text-gray-400 mb-3">
                Módulos Luau compartidos (<code className="text-cyan-300">*.luau</code>), definiciones de tipos y Maid.
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
        {/* Step 1 & 2 */}
        <div className="p-5 rounded-2xl bg-gray-900/80 border border-gray-800 flex flex-col gap-4">
          <h4 className="font-bold text-sm text-white flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            Paso 1: Instalar Plugin en Roblox Studio
          </h4>
          <ol className="text-xs text-gray-300 space-y-2.5 list-decimal pl-4 leading-relaxed">
            <li>
              Copia el contenido del archivo <strong className="text-white">ForgeAIStudioPlugin.server.luau</strong> (disponible en la pestaña Código del Backend).
            </li>
            <li>
              En tu explorador de archivos, colócalo en la carpeta de plugins locales de Roblox Studio:
              <div className="p-2 rounded bg-black/60 font-mono text-[11px] text-cyan-300 my-1">
                Windows: %LocalAppData%\Roblox\Plugins\<br/>
                macOS: ~/Library/Application Support/Roblox/Plugins/
              </div>
              O abre un Script en Studio y dale clic derecho: <em>Save as Local Plugin...</em>
            </li>
            <li>
              Verás un nuevo botón en la barra de herramientas superior de Roblox Studio: <strong className="text-cyan-400">Forge AI</strong>.
            </li>
          </ol>

          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2.5 mt-2">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <div>
              <strong>Requisito Obligatorio:</strong> En Roblox Studio, ve a <em>Game Settings &gt; Security</em> y activa la casilla <strong>"Allow HTTP Requests"</strong> para permitir que <code className="text-white">HttpService</code> se comunique con <code className="text-white">http://127.0.0.1:8000</code>.
            </div>
          </div>
        </div>

        {/* Step 3: Luau HttpService code snippet */}
        <div className="p-5 rounded-2xl bg-gray-900/80 border border-gray-800 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-sm text-white">Consumo Directo vía HttpService</h4>
            <button
              onClick={copyHttpSnippet}
              className="px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-[11px] text-white flex items-center gap-1.5 transition cursor-pointer"
            >
              {copiedSnippet ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedSnippet ? 'Copiado!' : 'Copiar Snippet'}
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Puedes invocar los endpoints de FastAPI desde cualquier script o Command Bar de Roblox Studio:
          </p>
          <div className="bg-[#0b0e14] p-3 rounded-xl border border-gray-800 max-h-52 overflow-auto font-mono text-xs text-gray-300 select-text">
            <pre className="whitespace-pre overflow-x-auto">{sampleHttpSnippet}</pre>
          </div>
        </div>
      </div>
    </div>
  );
};
