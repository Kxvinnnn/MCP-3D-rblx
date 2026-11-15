import React, { useState } from 'react';
import {
  Sparkles,
  Scissors,
  Wand2,
  Minimize2,
  CheckCircle2,
  Palette,
  Sliders,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { MeshPart3DSpec, resolveRgbTuple } from '../../../utils/roblox3DEngine.ts';
import {
  InteractiveColorWheel,
  rgbToHex,
} from '../../common/InteractiveColorWheel.tsx';

export interface SimpleMaterialOption {
  id: string;
  label: string;
  hint: string;
}

export const SIMPLE_ROBLOX_MATERIALS: SimpleMaterialOption[] = [
  { id: 'SmoothPlastic', label: 'Suave', hint: 'Liso' },
  { id: 'Wood', label: 'Madera', hint: 'Árbol' },
  { id: 'Grass', label: 'Pasto', hint: 'Hojas' },
  { id: 'Metal', label: 'Metal', hint: 'Brillo' },
  { id: 'Neon', label: 'Neón', hint: 'Brilla' },
  { id: 'Glass', label: 'Cristal', hint: 'Claro' },
];

interface EditInspectorPanelProps {
  selectedPart: MeshPart3DSpec | null;
  totalPartsCount: number;
  paintScope: 'selected' | 'all';
  onChangePaintScope: (scope: 'selected' | 'all') => void;
  liveColorHex: string | null;
  onColorLiveChange: (hex: string, rgb: [number, number, number]) => void;
  onColorCommit: (hex: string, rgb: [number, number, number]) => void;
  onMaterialChange: (material: string) => void;
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
  totalPartsCount,
  paintScope,
  onChangePaintScope,
  liveColorHex,
  onColorLiveChange,
  onColorCommit,
  onMaterialChange,
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
  const [inspectorTab, setInspectorTab] = useState<'color' | 'transform'>('color');

  const partRgb = selectedPart
    ? resolveRgbTuple(
        selectedPart.color,
        undefined,
        (selectedPart as any).colorSpace || (selectedPart as any).colorFormat
      )
    : ([148, 163, 184] as [number, number, number]);

  const currentHex = liveColorHex || rgbToHex(partRgb[0], partRgb[1], partRgb[2]);

  return (
    <div
      className={`flex-1 min-h-0 h-full flex-col bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 overflow-y-auto overflow-x-hidden space-y-3.5 ${
        isVisibleMobile ? 'flex' : 'hidden md:flex'
      }`}
    >
      {selectedPart ? (
        <>
          {/* Selected Piece Summary Header */}
          <div className="border-b border-slate-800 pb-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-cyan-400 font-bold">
                Pieza seleccionada
              </span>
              <span
                className="w-4 h-4 rounded-full border border-white/50 shadow-sm shrink-0"
                style={{ backgroundColor: currentHex }}
              />
            </div>
            <h4 className="font-extrabold text-white text-sm truncate mt-0.5">
              {selectedPart.name}
            </h4>
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5 truncate">
              <span>{selectedPart.shape}</span>
              <span aria-hidden="true">·</span>
              <span>{selectedPart.material || 'SmoothPlastic'}</span>
            </div>
          </div>

          {/* 2-Tab Mode Switcher: Pintar vs Mover y Tamaño */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800 shrink-0">
            <button
              type="button"
              onClick={() => setInspectorTab('color')}
              className={`py-2 px-2 rounded-lg text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition whitespace-nowrap ${
                inspectorTab === 'color'
                  ? 'bg-gradient-to-r from-fuchsia-600 to-amber-500 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Colores</span>
            </button>

            <button
              type="button"
              onClick={() => setInspectorTab('transform')}
              className={`py-2 px-2 rounded-lg text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition whitespace-nowrap ${
                inspectorTab === 'transform'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Tamaño</span>
            </button>
          </div>

          {/* TAB 1: Interactive Kids Color Wheel & Material Selector */}
          {inspectorTab === 'color' && (
            <div className="space-y-3.5">
              {/* Target Scope: Just This Piece vs All Pieces */}
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => onChangePaintScope('selected')}
                  className={`py-2 px-2 rounded-xl border font-bold cursor-pointer transition truncate ${
                    paintScope === 'selected'
                      ? 'bg-cyan-950/70 border-cyan-400 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  Solo esta pieza
                </button>
                <button
                  type="button"
                  onClick={() => onChangePaintScope('all')}
                  className={`py-2 px-2 rounded-xl border font-bold cursor-pointer transition truncate ${
                    paintScope === 'all'
                      ? 'bg-fuchsia-950/70 border-fuchsia-400 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  Todo ({totalPartsCount})
                </button>
              </div>

              {/* Smooth Interactive Rainbow Color Wheel */}
              <div className="bg-slate-950/75 border border-slate-800/90 rounded-2xl p-3">
                <InteractiveColorWheel
                  value={currentHex}
                  size={168}
                  compact
                  title="Círculo de Colores"
                  onChangeLive={onColorLiveChange}
                  onCommit={onColorCommit}
                />
              </div>

              {/* Simple Kid-Friendly Material Buttons */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-slate-300 block">
                  ¿Cómo se siente esta pieza?
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {SIMPLE_ROBLOX_MATERIALS.map((mat) => {
                    const isActive = (selectedPart.material || 'SmoothPlastic') === mat.id;
                    return (
                      <button
                        key={mat.id}
                        type="button"
                        onClick={() => onMaterialChange(mat.id)}
                        className={`py-2 px-1.5 rounded-xl border text-center cursor-pointer transition ${
                          isActive
                            ? 'bg-cyan-950/80 border-cyan-400 text-white shadow-sm'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                        }`}
                      >
                        <span className="text-[11px] font-extrabold block truncate">
                          {mat.label}
                        </span>
                        <span className="text-[10px] text-slate-400 block truncate">
                          {mat.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Optional shortcut to full Paint Studio */}
              <button
                type="button"
                onClick={onOpenMaterials}
                className="w-full py-2.5 px-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-cyan-300 hover:text-cyan-200 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition"
              >
                <Palette className="w-3.5 h-3.5" />
                <span>Abrir Estudio de Pintura Completo</span>
              </button>
            </div>
          )}

          {/* TAB 2: Clean Transform Controls (Never overflows horizontally) */}
          {inspectorTab === 'transform' && (
            <div className="space-y-3.5">
              {/* Position */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-200">Mover lugar:</span>
                  <button
                    type="button"
                    onClick={() => onResetTransform('position_xz')}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 font-bold cursor-pointer whitespace-nowrap"
                  >
                    Al centro
                  </button>
                </div>
                <div className="space-y-1.5">
                  {(['X (Lado)', 'Y (Altura)', 'Z (Frente)'] as const).map((label, i) => {
                    const val = Number((selectedPart.position?.[i] ?? 0).toFixed(2));
                    return (
                      <div
                        key={label}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-2 min-w-0"
                      >
                        <span className="text-[11px] font-bold text-cyan-400 truncate">
                          {label}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              onTransformChange('position', i, Number((val - 0.5).toFixed(2)))
                            }
                            className="w-7 h-7 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-bold text-slate-200 cursor-pointer"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            step="0.5"
                            value={val}
                            onChange={(e) =>
                              onTransformChange('position', i, parseFloat(e.target.value) || 0)
                            }
                            className="w-14 bg-slate-900/70 rounded-lg px-1.5 py-1 text-center text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono tabular-nums"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              onTransformChange('position', i, Number((val + 0.5).toFixed(2)))
                            }
                            className="w-7 h-7 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-bold text-slate-200 cursor-pointer"
                          >
                            +
                          </button>
                        </div>
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
                <div className="space-y-1.5">
                  {(['Ancho (X)', 'Alto (Y)', 'Largo (Z)'] as const).map((label, i) => {
                    const val = Number((selectedPart.size?.[i] ?? 1).toFixed(2));
                    return (
                      <div
                        key={label}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-2 min-w-0"
                      >
                        <span className="text-[11px] font-bold text-violet-400 truncate">
                          {label}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              onTransformChange(
                                'size',
                                i,
                                Math.max(0.1, Number((val - 0.5).toFixed(2)))
                              )
                            }
                            className="w-7 h-7 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-bold text-slate-200 cursor-pointer"
                          >
                            -
                          </button>
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
                            className="w-14 bg-slate-900/70 rounded-lg px-1.5 py-1 text-center text-xs text-white focus:outline-none focus:ring-1 focus:ring-violet-500 font-mono tabular-nums"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              onTransformChange('size', i, Number((val + 0.5).toFixed(2)))
                            }
                            className="w-7 h-7 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-bold text-slate-200 cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Rotation */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-200">Girar (Grados):</span>
                  <button
                    type="button"
                    onClick={() => onResetTransform('rotation')}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 font-bold cursor-pointer whitespace-nowrap"
                  >
                    Enderezar
                  </button>
                </div>
                <div className="space-y-1.5">
                  {(['Inclinar X', 'Girar Y', 'Ladear Z'] as const).map((label, i) => {
                    const val = Number((selectedPart.rotation?.[i] ?? 0).toFixed(1));
                    return (
                      <div
                        key={label}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-2 min-w-0"
                      >
                        <span className="text-[11px] font-bold text-amber-400 truncate">
                          {label}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => onTransformChange('rotation', i, val - 15)}
                            className="px-2 h-7 rounded-lg bg-slate-900 hover:bg-slate-800 text-[11px] font-bold text-slate-200 cursor-pointer"
                          >
                            -15°
                          </button>
                          <input
                            type="number"
                            step="15"
                            value={val}
                            onChange={(e) =>
                              onTransformChange('rotation', i, parseFloat(e.target.value) || 0)
                            }
                            className="w-12 bg-slate-900/70 rounded-lg px-1 py-1 text-center text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono tabular-nums"
                          />
                          <button
                            type="button"
                            onClick={() => onTransformChange('rotation', i, val + 15)}
                            className="px-2 h-7 rounded-lg bg-slate-900 hover:bg-slate-800 text-[11px] font-bold text-slate-200 cursor-pointer"
                          >
                            +15°
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
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
            </div>
          )}
        </>
      ) : (
        <div className="py-12 text-center text-slate-400 text-xs space-y-2">
          <CheckCircle2 className="w-6 h-6 text-cyan-400 mx-auto" />
          <p>
            Haz clic en cualquier pieza de la lista izquierda o en el modelo 3D para pintarla o cambiar su tamaño.
          </p>
        </div>
      )}
    </div>
  );
};
