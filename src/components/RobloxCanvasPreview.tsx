import React, { useState } from 'react';
import { Eye, RotateCcw, Sparkles, X, Layers, Maximize2 } from 'lucide-react';

export interface UINodeData {
  class_name: string;
  name: string;
  properties?: Record<string, any>;
  children?: UINodeData[];
}

interface RobloxCanvasPreviewProps {
  uiTree?: UINodeData | null;
  theme?: string;
  fileName?: string;
}

export const RobloxCanvasPreview: React.FC<RobloxCanvasPreviewProps> = ({
  uiTree,
  theme = 'Dark Cyberpunk',
  fileName = 'ForgeGuiComponent.luau',
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'preview' | 'tree'>('preview');

  // Render tree node recursively into visual elements
  const renderNode = (node: UINodeData, key: string = 'root'): React.ReactNode => {
    const props = node.properties || {};
    const className = node.class_name || 'Frame';

    // Parse size and position if available
    let style: React.CSSProperties = {
      position: 'relative',
      boxSizing: 'border-box',
    };

    // Background color
    if (props.BackgroundColor3) {
      if (Array.isArray(props.BackgroundColor3)) {
        const [r, g, b] = props.BackgroundColor3;
        style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
      } else if (typeof props.BackgroundColor3 === 'string') {
        style.backgroundColor = props.BackgroundColor3;
      }
    }

    if (props.BackgroundTransparency !== undefined) {
      style.opacity = 1 - Number(props.BackgroundTransparency);
    }

    // Corner radius
    if (props.CornerRadius && Array.isArray(props.CornerRadius)) {
      style.borderRadius = `${props.CornerRadius[1] || 8}px`;
    } else {
      style.borderRadius = '8px';
    }

    // Stroke
    if (props.UIStroke || props.BorderColor3) {
      style.border = '1px solid rgba(139, 92, 246, 0.4)';
    }

    if (className === 'UICorner' || className === 'UIStroke' || className === 'UIGradient' || className === 'UIAspectRatioConstraint') {
      return null;
    }

    if (className === 'TextButton') {
      return (
        <button
          key={key}
          onClick={(e) => {
            e.stopPropagation();
            if (node.name.toLowerCase().includes('close') || props.Text?.toLowerCase()?.includes('close') || props.Text === '✕' || props.Text === 'X') {
              setIsOpen(false);
            }
          }}
          className="transition-all duration-200 active:scale-95 hover:brightness-125 px-4 py-2 font-semibold text-center cursor-pointer shadow-md"
          style={{
            ...style,
            color: props.TextColor3 ? (Array.isArray(props.TextColor3) ? `rgb(${props.TextColor3.join(',')})` : '#fff') : '#fff',
            backgroundColor: style.backgroundColor || '#3b82f6',
          }}
        >
          {props.Text || node.name || 'Button'}
          {node.children && node.children.map((child, i) => renderNode(child, `${key}-${i}`))}
        </button>
      );
    }

    if (className === 'TextLabel') {
      return (
        <div
          key={key}
          className="leading-snug select-none"
          style={{
            ...style,
            color: props.TextColor3 ? (Array.isArray(props.TextColor3) ? `rgb(${props.TextColor3.join(',')})` : '#f3f4f6') : '#f3f4f6',
            fontSize: props.TextSize ? `${Math.min(props.TextSize, 22)}px` : '14px',
            fontWeight: props.Font?.includes('Bold') ? 'bold' : 'normal',
          }}
        >
          {props.Text || node.name}
          {node.children && node.children.map((child, i) => renderNode(child, `${key}-${i}`))}
        </div>
      );
    }

    // Container / Frame
    return (
      <div
        key={key}
        className="flex flex-col gap-2 p-3 overflow-hidden shadow-xl"
        style={{
          ...style,
          minHeight: '40px',
        }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1 mb-1">
          <span className="text-xs font-mono font-bold tracking-wider uppercase text-cyan-400">
            {node.name}
          </span>
          <span className="text-[10px] text-gray-400 font-mono">
            {className}
          </span>
        </div>
        {node.children && node.children.map((child, i) => renderNode(child, `${key}-${i}`))}
      </div>
    );
  };

  // Render tree node as JSON inspect list
  const renderTreeJSON = (node: UINodeData, depth: number = 0): React.ReactNode => {
    return (
      <div key={node.name + depth} className="font-mono text-xs my-1" style={{ paddingLeft: `${depth * 16}px` }}>
        <div className="flex items-center gap-2 py-0.5 text-gray-300">
          <span className="text-cyan-400 font-bold">{node.class_name}</span>
          <span className="text-purple-300">"{node.name}"</span>
          {node.properties && Object.keys(node.properties).length > 0 && (
            <span className="text-gray-400 text-[11px]">
              ({Object.keys(node.properties).length} props)
            </span>
          )}
        </div>
        {node.children && node.children.map((child, idx) => renderTreeJSON(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-[#0d1117] overflow-hidden shadow-2xl flex flex-col h-full">
      {/* Topbar of Roblox Canvas Simulation */}
      <div className="bg-[#161b22] border-b border-gray-800 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
          </div>
          <div className="h-4 w-px bg-gray-700" />
          <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
            <span className="px-2 py-0.5 rounded bg-gray-800 text-cyan-400 font-mono">StarterGui</span>
            <span>/</span>
            <span className="font-semibold text-white">{fileName.replace('.luau', '')}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-gray-900 p-0.5 border border-gray-800 text-xs">
            <button
              onClick={() => setActiveTab('preview')}
              className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition ${
                activeTab === 'preview'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Vista Previa
            </button>
            <button
              onClick={() => setActiveTab('tree')}
              className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition ${
                activeTab === 'tree'
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Árbol de Instancias
            </button>
          </div>

          <button
            onClick={() => setIsOpen(true)}
            title="Reiniciar Apertura de Modal"
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Viewport Simulation Area */}
      <div className="relative flex-1 min-h-[380px] bg-gradient-to-b from-[#0f141c] to-[#07090e] p-6 flex items-center justify-center overflow-auto">
        {/* Background Grid simulating Roblox Baseplate or 3D World */}
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(circle, #38bdf8 1px, transparent 1px), linear-gradient(to right, #1f2937 1px, transparent 1px), linear-gradient(to bottom, #1f2937 1px, transparent 1px)',
            backgroundSize: '24px 24px, 48px 48px, 48px 48px',
          }}
        />

        {/* Roblox Studio CoreGui Topbar Simulation */}
        <div className="absolute top-2 left-4 right-4 flex items-center justify-between text-white/50 text-[11px] font-mono pointer-events-none z-20">
          <div className="flex items-center gap-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
            <span className="font-bold text-white tracking-widest text-[10px]">ROBLOX</span>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>60 FPS</span>
            <span>Ping: 14ms</span>
          </div>
          <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
            <span className="text-emerald-400">Theme: {theme}</span>
          </div>
        </div>

        {activeTab === 'preview' ? (
          isOpen ? (
            <div className="relative z-10 w-full max-w-md transition-all duration-300 animate-in fade-in zoom-in-95">
              {uiTree ? (
                <div className="relative">
                  {renderNode(uiTree)}
                </div>
              ) : (
                /* Default Interactive Fallback Mockup */
                <div className="relative rounded-2xl border border-cyan-500/40 bg-[#121620]/95 backdrop-blur-xl p-5 shadow-2xl text-white">
                  <div className="flex items-center justify-between border-b border-cyan-500/20 pb-3 mb-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-cyan-400" />
                      <h3 className="font-bold text-base tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-300 to-indigo-400">
                        FORGE_GUI // {theme.toUpperCase()}
                      </h3>
                    </div>
                    <button
                      onClick={() => setIsOpen(false)}
                      className="p-1 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <p className="text-xs text-gray-300 mb-4 leading-relaxed">
                    Interfaz reactiva renderizada según los estándares Luau: posicionamiento responsive con <code className="text-cyan-300">UDim2.fromScale</code>, <code className="text-purple-300">UICorner</code> para curvatura y <code className="text-emerald-300">UIStroke</code> con gradientes.
                  </p>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/30 flex flex-col justify-between">
                      <span className="text-[11px] text-cyan-300 font-mono">ESTRUCTURA ROJO</span>
                      <span className="text-sm font-bold text-white mt-1">src/client/UI</span>
                    </div>
                    <div className="p-3 rounded-xl bg-purple-950/40 border border-purple-500/30 flex flex-col justify-between">
                      <span className="text-[11px] text-purple-300 font-mono">LIFECYCLE</span>
                      <span className="text-sm font-bold text-white mt-1">Maid & Tweens</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => alert("Evento Luau simulado con éxito")}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 font-bold text-xs tracking-wider text-black transition shadow-lg shadow-cyan-500/20 active:scale-95 cursor-pointer"
                    >
                      ACCIONAR COMPONENTE
                    </button>
                    <button
                      onClick={() => setIsOpen(false)}
                      className="py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-gray-300 transition cursor-pointer"
                    >
                      Cerrar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="relative z-10 text-center animate-in fade-in">
              <div className="p-6 rounded-2xl bg-black/60 border border-white/10 backdrop-blur-md">
                <p className="text-sm text-gray-300 mb-3">La ventana modal ha sido cerrada mediante TweenService & Maid.</p>
                <button
                  onClick={() => setIsOpen(true)}
                  className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-bold text-xs text-white shadow-lg transition"
                >
                  Abrir GUI Nuevamente (:Open())
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="relative z-10 w-full max-h-[340px] overflow-auto bg-gray-950/90 rounded-xl p-4 border border-gray-800">
            <div className="text-xs font-bold text-cyan-400 mb-3 flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Jerarquía de Instancias de Roblox Studio
            </div>
            {uiTree ? (
              renderTreeJSON(uiTree)
            ) : (
              <div className="text-xs text-gray-400 italic">
                Genera una interfaz para inspeccionar el árbol jerárquico de instancias.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer bar */}
      <div className="bg-[#161b22] border-t border-gray-800 px-4 py-2 flex items-center justify-between text-[11px] text-gray-400">
        <span className="font-mono text-cyan-400">Escalado: UDim2.fromScale(100% Responsive)</span>
        <span className="font-mono text-purple-400">Compatibilidad: PC / Mobile / Console</span>
      </div>
    </div>
  );
};
