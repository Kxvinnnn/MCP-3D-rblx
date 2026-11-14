import React from 'react';
import {
  Sparkles,
  Scissors,
  Wand2,
  Minimize2,
  CheckCircle2,
  Palette,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { MeshPart3DSpec } from '../../../utils/roblox3DEngine.ts';

interface EditInspectorPanelProps {
  selectedPart: MeshPart3DSpec | null;
  showMeshTools: boolean;
  onToggleMeshTools: () => void;
  onTransformChange: (field: 'position' | 'rotation' | 'size', index: number, value: number) => void;
  onResetTransform: (field: 'position_xz' | 'rotation') => void;
  onOpenMaterials: () => void;
  onSubdivide: () => void;
  onDecimate: () => void;
  onSmooth: () => void;
  onSmartSplit: () => void;
  isVisibleMobile: boolean;
}

export const EditInspectorPanel: React.FC<EditInspectorPanelProps> = ({
  selectedPart,
  showMeshTools,
  onToggleMeshTools,
  onTransformChange,
  onResetTransform,
  onOpenMaterials,
  onSubdivide,
  onDecimate,
  onSmooth,
  onSmartSplit,
  isVisibleMobile,
}) => {
  return (
    <div
      className={`md:col-span-3 lg:col-span-3 flex-col bg-slate-900/85 border border-slate-800 rounded-2xl p-4 overflow-y-auto space-y-4 ${
        isVisibleMobile ? 'flex' : 'hidden md:flex'
      }`}
    >
      {selectedPart ? (
        <>
          <div className="border-b border-slate-800 pb-2.5">
            <span className="text-[10px] uppercase tracking-wider text-cyan-400 font-extrabold block">
              Pieza Seleccionada
            </span>
            <h4 className="font-extrabold text-white text-sm truncate mt-0.5">
              {selectedPart.name}
            </h4>
            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
              <span>{selectedPart.shape}</span>
              <span>·</span>
              <span>Material: {selectedPart.material}</span>
            </div>
          </div>

          {/* Clean Transform Inputs */}
          <div className="space-y-3.5">
            {/* Position */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">Mover lugar (X, Y, Z):</span>
                <button
                  type="button"
                  onClick={() => onResetTransform('position_xz')}
                  className="text-[11px] text-cyan-400 hover:text-cyan-300 font-bold cursor-pointer"
                >
                  Al centro
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {['X', 'Y', 'Z'].map((axis, i) => {
                  const val = Number((selectedPart.position?.[i] ?? 0).toFixed(2));
                  return (
                    <div
                      key={axis}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-2 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-cyan-400">{axis}</span>
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              onTransformChange('position', i, Number((val - 0.5).toFixed(2)))
                            }
                            className="px-1.5 rounded bg-slate-900 hover:bg-slate-800 text-[10px] text-slate-300 cursor-pointer"
                          >
                            -
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onTransformChange('position', i, Number((val + 0.5).toFixed(2)))
                            }
                            className="px-1.5 rounded bg-slate-900 hover:bg-slate-800 text-[10px] text-slate-300 cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <input
                        type="number"
                        step="0.5"
                        value={val}
                        onChange={(e) =>
                          onTransformChange('position', i, parseFloat(e.target.value) || 0)
                        }
                        className="w-full bg-transparent text-xs text-white focus:outline-none font-mono tabular-nums"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Size */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-slate-200 block">
                Tamaño (Ancho, Alto, Largo):
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {['X', 'Y', 'Z'].map((axis, i) => {
                  const val = Number((selectedPart.size?.[i] ?? 1).toFixed(2));
                  return (
                    <div
                      key={axis}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-2 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-violet-400">{axis}</span>
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              onTransformChange(
                                'size',
                                i,
                                Math.max(0.1, Number((val - 0.5).toFixed(2)))
                              )
                            }
                            className="px-1.5 rounded bg-slate-900 hover:bg-slate-800 text-[10px] text-slate-300 cursor-pointer"
                          >
                            -
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onTransformChange('size', i, Number((val + 0.5).toFixed(2)))
                            }
                            className="px-1.5 rounded bg-slate-900 hover:bg-slate-800 text-[10px] text-slate-300 cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <input
                        type="number"
                        step="0.5"
                        min="0.1"
                        value={val}
                        onChange={(e) =>
                          onTransformChange(
                            'size',
                            i,
                            Math.max(0.1, parseFloat(e.target.value) || 0.1)
                          )
                        }
                        className="w-full bg-transparent text-xs text-white focus:outline-none font-mono tabular-nums"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Rotation */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">Girar (Grados):</span>
                <button
                  type="button"
                  onClick={() => onResetTransform('rotation')}
                  className="text-[11px] text-cyan-400 hover:text-cyan-300 font-bold cursor-pointer"
                >
                  Enderezar
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {['X', 'Y', 'Z'].map((axis, i) => {
                  const val = Number((selectedPart.rotation?.[i] ?? 0).toFixed(1));
                  return (
                    <div
                      key={axis}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-2 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-amber-400">{axis}</span>
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => onTransformChange('rotation', i, val - 15)}
                            className="px-1 rounded bg-slate-900 hover:bg-slate-800 text-[10px] text-slate-300 cursor-pointer"
                          >
                            -15
                          </button>
                          <button
                            type="button"
                            onClick={() => onTransformChange('rotation', i, val + 15)}
                            className="px-1 rounded bg-slate-900 hover:bg-slate-800 text-[10px] text-slate-300 cursor-pointer"
                          >
                            +15
                          </button>
                        </div>
                      </div>
                      <input
                        type="number"
                        step="15"
                        value={val}
                        onChange={(e) =>
                          onTransformChange('rotation', i, parseFloat(e.target.value) || 0)
                        }
                        className="w-full bg-transparent text-xs text-white focus:outline-none font-mono tabular-nums"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Primary Next Step CTA: Paint Colors & Materials */}
          <div className="pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onOpenMaterials}
              className="w-full min-h-[44px] py-3 px-4 rounded-xl bg-gradient-to-r from-fuchsia-500 to-amber-500 hover:from-fuchsia-400 hover:to-amber-400 text-white text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer transition shadow-lg forge-btn-press whitespace-nowrap"
            >
              <Palette className="w-4 h-4" />
              <span>¡Pintar Colores! →</span>
            </button>
          </div>

          {/* Collapsible Advanced Mesh Tools */}
          <div className="pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onToggleMeshTools}
              className="w-full py-2 px-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-bold flex items-center justify-between cursor-pointer transition"
            >
              <span>Más herramientas (Avanzado)</span>
              {showMeshTools ? (
                <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-cyan-400" />
              )}
            </button>

            {showMeshTools && (
              <div className="grid grid-cols-2 gap-1.5 pt-2">
                <button
                  type="button"
                  onClick={onSubdivide}
                  className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-300">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Subdividir</span>
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Más suavidad</span>
                </button>

                <button
                  type="button"
                  onClick={onDecimate}
                  className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-blue-300">
                    <Minimize2 className="w-3.5 h-3.5" />
                    <span>Optimizar</span>
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Menos tris</span>
                </button>

                <button
                  type="button"
                  onClick={onSmooth}
                  className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>Suavizar</span>
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Normales</span>
                </button>

                <button
                  type="button"
                  onClick={onSmartSplit}
                  className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                    <Scissors className="w-3.5 h-3.5" />
                    <span>Separar</span>
                  </div>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Dividir piezas</span>
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="py-12 text-center text-slate-400 text-xs space-y-2">
          <CheckCircle2 className="w-6 h-6 text-cyan-400 mx-auto" />
          <p>
            Haz clic en cualquier pieza en la lista izquierda o en el visor 3D para cambiar su
            posición o tamaño.
          </p>
        </div>
      )}
    </div>
  );
};
