import React, { useState, useEffect } from 'react';
import { Eye, RotateCcw, Sparkles, X, Layers, Box, CheckCircle2 } from 'lucide-react';
import { RobloxWorldViewport3D } from './RobloxWorldViewport3D.tsx';
import { Forge3DAsset } from '../utils/roblox3DEngine.ts';

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
  const [activeTab, setActiveTab] = useState<'preview' | 'viewport3d' | 'tree'>('preview');
  const [eventFeedback, setEventFeedback] = useState<string | null>(null);
  const [sample3DAsset, setSample3DAsset] = useState<Forge3DAsset | null>(null);

  useEffect(() => {
    fetch('/api/v1/assets')
      .then((res) => res.json())
      .then((data) => {
        if (data.assets && data.assets.length > 0) {
          setSample3DAsset(data.assets[0]);
        }
      })
      .catch(() => {});
  }, []);

  const triggerSimulatedEvent = (label: string) => {
    setEventFeedback(`Activated: ${label} (TweenService + Maid conectado)`);
    setTimeout(() => setEventFeedback(null), 2500);
  };

  // Render tree node recursively into visual elements
  const renderNode = (node: UINodeData, key: string = 'root'): React.ReactNode => {
    const props = node.properties || {};
    const className = node.class_name || 'Frame';

    const style: React.CSSProperties = {
      position: 'relative',
      boxSizing: 'border-box',
    };

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

    if (props.CornerRadius && Array.isArray(props.CornerRadius)) {
      style.borderRadius = `${props.CornerRadius[1] || 8}px`;
    } else {
      style.borderRadius = '8px';
    }

    if (props.UIStroke || props.BorderColor3) {
      style.border = '1px solid rgba(56, 189, 248, 0.35)';
    }

    if (
      className === 'UICorner' ||
      className === 'UIStroke' ||
      className === 'UIGradient' ||
      className === 'UIAspectRatioConstraint'
    ) {
      return null;
    }

    if (className === 'ViewportFrame') {
      return (
        <div key={key} className="my-2 rounded-xl overflow-hidden border border-cyan-500/40">
          <div className="bg-slate-900 px-2.5 py-1 text-[10px] font-mono text-cyan-300 flex items-center justify-between">
            <span>ViewportFrame + WorldModel ({node.name})</span>
            <span>WebGL 3D</span>
          </div>
          <RobloxWorldViewport3D asset={sample3DAsset} />
        </div>
      );
    }

    if (className === 'TextButton') {
      return (
        <button
          key={key}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (
              node.name.toLowerCase().includes('close') ||
              props.Text?.toLowerCase()?.includes('close') ||
              props.Text === '✕' ||
              props.Text === 'X'
            ) {
              setIsOpen(false);
            } else {
              triggerSimulatedEvent(node.name || 'TextButton');
            }
          }}
          className="transition-all duration-200 active:scale-95 hover:brightness-125 px-4 py-2 font-semibold text-center cursor-pointer shadow-md"
          style={{
            ...style,
            color: props.TextColor3
              ? Array.isArray(props.TextColor3)
                ? `rgb(${props.TextColor3.join(',')})`
                : '#fff'
              : '#fff',
            backgroundColor: style.backgroundColor || '#2563eb',
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
            color: props.TextColor3
              ? Array.isArray(props.TextColor3)
                ? `rgb(${props.TextColor3.join(',')})`
                : '#f3f4f6'
              : '#f3f4f6',
            fontSize: props.TextSize ? `${Math.min(props.TextSize, 22)}px` : '14px',
            fontWeight: props.Font?.includes('Bold') ? 'bold' : 'normal',
          }}
        >
          {props.Text || node.name}
          {node.children && node.children.map((child, i) => renderNode(child, `${key}-${i}`))}
        </div>
      );
    }

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
          <span className="text-[10px] text-gray-400 font-mono">{className}</span>
        </div>
        {node.children && node.children.map((child, i) => renderNode(child, `${key}-${i}`))}
      </div>
    );
  };

  const renderTreeJSON = (node: UINodeData, depth: number = 0): React.ReactNode => {
    return (
      <div
        key={node.name + depth}
        className="font-mono text-xs my-1"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
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
      {/* Topbar of Roblox Canvas & ViewportFrame */}
      <div className="bg-[#161b22] border-b border-gray-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
          <span className="px-2 py-0.5 rounded bg-gray-800 text-cyan-400 font-mono">StarterGui</span>
          <span>/</span>
          <span className="font-semibold text-white">{fileName.replace('.luau', '')}</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-gray-900 p-0.5 border border-gray-800 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition cursor-pointer ${
                activeTab === 'preview'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              ScreenGui 2D
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('viewport3d')}
              className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition cursor-pointer ${
                activeTab === 'viewport3d'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              ViewportFrame 3D (WorldModel)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('tree')}
              className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition cursor-pointer ${
                activeTab === 'tree'
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Árbol
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsOpen(true)}
            title="Reiniciar Apertura de Modal"
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Viewport Area */}
      {activeTab === 'viewport3d' ? (
        <div className="p-3 bg-[#090d14] flex-1">
          <RobloxWorldViewport3D asset={sample3DAsset} />
        </div>
      ) : (
        <div className="relative flex-1 min-h-[380px] bg-gradient-to-b from-[#0f141c] to-[#07090e] p-6 flex items-center justify-center overflow-auto">
          <div
            className="absolute inset-0 opacity-15 pointer-events-none"
            style={{
              backgroundImage:
                'radial-gradient(circle, #38bdf8 1px, transparent 1px), linear-gradient(to right, #1f2937 1px, transparent 1px), linear-gradient(to bottom, #1f2937 1px, transparent 1px)',
              backgroundSize: '24px 24px, 48px 48px, 48px 48px',
            }}
          />

          <div className="absolute top-2 left-4 right-4 flex items-center justify-between text-white/60 text-[11px] font-mono pointer-events-none z-20">
            <div className="flex items-center gap-3 bg-black/70 px-3 py-1 rounded-lg border border-white/10 tabular-nums">
              <span className="font-bold text-white tracking-widest text-[10px]">ROBLOX</span>
              <span>60 FPS</span>
              <span>Scale: UDim2.fromScale</span>
            </div>
            <div className="flex items-center gap-2 bg-black/70 px-3 py-1 rounded-lg border border-white/10">
              <span className="text-emerald-400">Theme: {theme}</span>
            </div>
          </div>

          {eventFeedback && (
            <div className="absolute bottom-3 left-4 right-4 z-30 bg-emerald-950/90 border border-emerald-500/40 text-emerald-200 px-3 py-1.5 rounded-lg text-xs font-mono flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>{eventFeedback}</span>
            </div>
          )}

          {activeTab === 'preview' ? (
            isOpen ? (
              <div className="relative z-10 w-full max-w-md transition-all duration-300">
                {uiTree ? (
                  <div className="relative">{renderNode(uiTree)}</div>
                ) : (
                  <div className="relative rounded-2xl border border-cyan-500/40 bg-[#121620] p-5 shadow-2xl text-white">
                    <div className="flex items-center justify-between border-b border-cyan-500/20 pb-3 mb-4">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-cyan-400" />
                        <h3 className="font-bold text-base tracking-wide text-cyan-300">
                          FORGE_GUI // {theme.toUpperCase()}
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsOpen(false)}
                        className="p-1 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <p className="text-xs text-gray-300 mb-4 leading-relaxed">
                      Interfaz reactiva con soporte para <code className="text-cyan-300">UDim2.fromScale</code> y vista 3D real mediante <code className="text-purple-300">ViewportFrame + WorldModel</code>.
                    </p>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/30 flex flex-col justify-between">
                        <span className="text-[11px] text-cyan-300 font-mono">ESTRUCTURA ROJO</span>
                        <span className="text-sm font-bold text-white mt-1">src/client/UI</span>
                      </div>
                      <div className="p-3 rounded-xl bg-purple-950/40 border border-purple-500/30 flex flex-col justify-between">
                        <span className="text-[11px] text-purple-300 font-mono">VISOR 3D</span>
                        <span className="text-sm font-bold text-white mt-1">WorldModel Activo</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setActiveTab('viewport3d')}
                        className="flex-1 py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 font-bold text-xs tracking-wider text-slate-950 transition cursor-pointer"
                      >
                        ABRIR VIEWPORTFRAME 3D
                      </button>
                      <button
                        type="button"
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
              <div className="relative z-10 text-center">
                <div className="p-6 rounded-2xl bg-black/80 border border-white/10">
                  <p className="text-sm text-gray-300 mb-3">
                    La ventana modal ha sido cerrada mediante TweenService &amp; Maid.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsOpen(true)}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-bold text-xs text-white shadow-lg transition cursor-pointer"
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
      )}

      {/* Footer bar */}
      <div className="bg-[#161b22] border-t border-gray-800 px-4 py-2 flex items-center justify-between text-[11px] text-gray-400">
        <span className="font-mono text-cyan-400">Escalado: UDim2.fromScale + ViewportFrame 3D</span>
        <span className="font-mono text-purple-400">Compatibilidad: PC / Mobile / Console</span>
      </div>
    </div>
  );
};
