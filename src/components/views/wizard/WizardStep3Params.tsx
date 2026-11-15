import React from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Dices,
  Lock,
  Sparkles,
  Unlock,
} from 'lucide-react';
import { HelpTooltip, FORGE_GLOSSARY } from '../../common/HelpTooltip.tsx';
import { DetailLevel, ObjectCategory, POLY_BUDGETS } from './wizardData.ts';

interface WizardStep3ParamsProps {
  category: ObjectCategory;
  treeHeight: number;
  onChangeTreeHeight: (val: number) => void;
  treeWidth: number;
  onChangeTreeWidth: (val: number) => void;
  leafColor: string;
  onChangeLeafColor: (val: string) => void;
  trunkColor: string;
  onChangeTrunkColor: (val: string) => void;
  showAdvancedTreeParams: boolean;
  onToggleAdvancedTreeParams: () => void;
  trunkThickness: number;
  onChangeTrunkThickness: (val: number) => void;
  trunkCurvature: number;
  onChangeTrunkCurvature: (val: number) => void;
  rootFlareScale: number;
  onChangeRootFlareScale: (val: number) => void;
  branchCount: number;
  onChangeBranchCount: (val: number) => void;
  canopyShape: 'spherical' | 'conical' | 'layered' | 'weeping';
  onChangeCanopyShape: (val: 'spherical' | 'conical' | 'layered' | 'weeping') => void;
  foliageDensity: number;
  onChangeFoliageDensity: (val: number) => void;
  detailLevel: DetailLevel;
  onChangeDetailLevel: (val: DetailLevel) => void;
  generationMode: 'procedural' | 'hybrid' | 'ai' | 'image_to_3d';
  onChangeGenerationMode: (val: 'procedural' | 'hybrid' | 'ai' | 'image_to_3d') => void;
  collisionFidelity: 'Hull' | 'Box' | 'PreciseConvexDecomposition';
  onChangeCollisionFidelity: (val: 'Hull' | 'Box' | 'PreciseConvexDecomposition') => void;
  seed: string;
  onChangeSeed: (val: string) => void;
  seedLocked: boolean;
  onToggleSeedLocked: () => void;
  onBack: () => void;
  onGenerate: () => void;
}

export const WizardStep3Params: React.FC<WizardStep3ParamsProps> = ({
  category,
  treeHeight,
  onChangeTreeHeight,
  treeWidth,
  onChangeTreeWidth,
  leafColor,
  onChangeLeafColor,
  trunkColor,
  onChangeTrunkColor,
  showAdvancedTreeParams,
  onToggleAdvancedTreeParams,
  trunkThickness,
  onChangeTrunkThickness,
  trunkCurvature,
  onChangeTrunkCurvature,
  rootFlareScale,
  onChangeRootFlareScale,
  branchCount,
  onChangeBranchCount,
  canopyShape,
  onChangeCanopyShape,
  foliageDensity,
  onChangeFoliageDensity,
  detailLevel,
  onChangeDetailLevel,
  generationMode,
  onChangeGenerationMode,
  collisionFidelity,
  onChangeCollisionFidelity,
  seed,
  onChangeSeed,
  seedLocked,
  onToggleSeedLocked,
  onBack,
  onGenerate,
}) => {
  return (
    <div className="space-y-6 pt-6">
      {/* Essential Controls (Only 4 simple visual cards for Trees) */}
      {category === 'Trees & Vegetation' && (
        <div className="bg-slate-950/80 p-5 rounded-2xl border border-emerald-500/30 space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <span className="text-sm font-extrabold text-emerald-300 block">
                Ajustes Principales de tu Árbol
              </span>
              <span className="text-xs text-slate-400">
                Cambia el tamaño y los colores principales fácilmente:
              </span>
            </div>
          </div>

          {/* 4 Simple Visual Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800">
              <label className="text-xs font-bold text-slate-200 flex justify-between mb-2">
                <span>Altura del Árbol</span>
                <span className="text-emerald-400 font-mono">{treeHeight} studs</span>
              </label>
              <input
                type="range"
                min={5}
                max={36}
                step={1}
                value={treeHeight}
                onChange={(e) => onChangeTreeHeight(parseFloat(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>

            <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800">
              <label className="text-xs font-bold text-slate-200 flex justify-between mb-2">
                <span>Ancho de Copa</span>
                <span className="text-emerald-400 font-mono">{treeWidth} studs</span>
              </label>
              <input
                type="range"
                min={4}
                max={26}
                step={1}
                value={treeWidth}
                onChange={(e) => onChangeTreeWidth(parseFloat(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>

            <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800">
              <label className="text-xs font-bold text-slate-200 block mb-2">
                Color de las Hojas:
              </label>
              <div className="flex items-center gap-2.5 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5">
                <input
                  type="color"
                  value={leafColor}
                  onChange={(e) => onChangeLeafColor(e.target.value)}
                  className="w-7 h-6 bg-transparent cursor-pointer"
                />
                <span className="text-xs font-mono text-white">{leafColor}</span>
              </div>
            </div>

            <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800">
              <label className="text-xs font-bold text-slate-200 block mb-2">
                Color del Tronco:
              </label>
              <div className="flex items-center gap-2.5 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5">
                <input
                  type="color"
                  value={trunkColor}
                  onChange={(e) => onChangeTrunkColor(e.target.value)}
                  className="w-7 h-6 bg-transparent cursor-pointer"
                />
                <span className="text-xs font-mono text-white">{trunkColor}</span>
              </div>
            </div>
          </div>

          {/* Optional Collapsible Accordion for the remaining technical parameters */}
          <div className="border-t border-slate-800/80 pt-3">
            <button
              type="button"
              onClick={onToggleAdvancedTreeParams}
              className="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-bold flex items-center justify-between cursor-pointer transition"
            >
              <span>
                {showAdvancedTreeParams
                  ? 'Ocultar ajustes avanzados de ramas, raíces y variación'
                  : 'Ver más ajustes avanzados del árbol (Ramas, Raíces, Curvatura - Opcional)'}
              </span>
              {showAdvancedTreeParams ? (
                <ChevronUp className="w-4 h-4 text-emerald-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-emerald-400" />
              )}
            </button>

            {showAdvancedTreeParams && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-4">
                <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                  <label className="text-xs text-slate-300 flex justify-between mb-1">
                    <span>Grosor de tronco</span>
                    <span className="text-white font-mono">{trunkThickness}st</span>
                  </label>
                  <input
                    type="range"
                    min={0.6}
                    max={4.5}
                    step={0.2}
                    value={trunkThickness}
                    onChange={(e) => onChangeTrunkThickness(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>

                <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                  <label className="text-xs text-slate-300 flex justify-between mb-1">
                    <span>Curvatura tronco</span>
                    <span className="text-white font-mono">{Math.round(trunkCurvature * 100)}%</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={trunkCurvature}
                    onChange={(e) => onChangeTrunkCurvature(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>

                <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                  <label className="text-xs text-slate-300 flex justify-between mb-1">
                    <span>Raíces visibles (Y=0)</span>
                    <span className="text-white font-mono">{rootFlareScale.toFixed(1)}x</span>
                  </label>
                  <input
                    type="range"
                    min={0.7}
                    max={2.2}
                    step={0.1}
                    value={rootFlareScale}
                    onChange={(e) => onChangeRootFlareScale(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>

                <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                  <label className="text-xs text-slate-300 flex justify-between mb-1">
                    <span>Número de ramas</span>
                    <span className="text-white font-mono">{branchCount}</span>
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={branchCount}
                    onChange={(e) => onChangeBranchCount(parseInt(e.target.value, 10))}
                    className="w-full accent-emerald-500"
                  />
                </div>

                <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                  <label className="text-xs text-slate-300 block mb-1">Forma de copa:</label>
                  <select
                    value={canopyShape}
                    onChange={(e) => onChangeCanopyShape(e.target.value as typeof canopyShape)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-xs text-white"
                  >
                    <option value="spherical">Esférica (Roble)</option>
                    <option value="conical">Cónica (Pino)</option>
                    <option value="layered">Escalonada (Bonsái)</option>
                    <option value="weeping">Colgante (Sauce)</option>
                  </select>
                </div>

                <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                  <label className="text-xs text-slate-300 flex justify-between mb-1">
                    <span>Densidad de hojas</span>
                    <span className="text-white font-mono">{foliageDensity.toFixed(2)}x</span>
                  </label>
                  <input
                    type="range"
                    min={0.3}
                    max={2.0}
                    step={0.05}
                    value={foliageDensity}
                    onChange={(e) => onChangeFoliageDensity(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Simple Detail Level Cards */}
      <div className="space-y-2">
        <label className="block text-xs font-bold text-slate-200">
          Calidad Visual (Cantidad de Polígonos):
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(['low', 'medium', 'high', 'ultra'] as DetailLevel[]).map((lvl) => {
            const info = POLY_BUDGETS[lvl];
            const isSelected = detailLevel === lvl;
            return (
              <div
                key={lvl}
                onClick={() => onChangeDetailLevel(lvl)}
                className={`p-3.5 rounded-2xl border cursor-pointer transition ${
                  isSelected
                    ? 'bg-violet-950/50 border-violet-400 shadow-md'
                    : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                    {info.label}
                  </span>
                  {isSelected && <CheckCircle2 className="w-4 h-4 text-violet-400 shrink-0" />}
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {info.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Engine & Seed Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
        <div>
          <label className="text-xs font-bold text-slate-200 block mb-1.5">
            Modo de Generación:
          </label>
          <select
            value={generationMode}
            onChange={(e) =>
              onChangeGenerationMode(e.target.value as 'procedural' | 'hybrid' | 'ai' | 'image_to_3d')
            }
            className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
          >
            <option value="procedural">Procedural (Local Determinista)</option>
            <option value="hybrid">Híbrido (Director IA + Motores Geométricos)</option>
            <option value="ai">IA Completa (Proveedor Configurado)</option>
            <option value="image_to_3d">Image-to-3D (Silueta 2D a Volumen 3D)</option>
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-slate-200">
              Colisión en Roblox:
            </label>
            <HelpTooltip
              term={FORGE_GLOSSARY.collisionFidelity.term}
              explanation={FORGE_GLOSSARY.collisionFidelity.explanation}
              variant="badge"
            />
          </div>
          <select
            value={collisionFidelity}
            onChange={(e) => onChangeCollisionFidelity(e.target.value as typeof collisionFidelity)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
          >
            <option value="Hull">Hull (Rápida y Recomendada)</option>
            <option value="Box">Box (Caja simple)</option>
            <option value="PreciseConvexDecomposition">Precise (Exacta)</option>
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-slate-200">
              Semilla (Variación):
            </label>
            <span className="text-[10px] font-semibold text-slate-400">
              {seedLocked ? 'Fija (manual)' : 'Automática (nueva en cada creación)'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={seed}
              onChange={(e) => onChangeSeed(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs text-white font-mono"
            />
            <button
              type="button"
              onClick={onToggleSeedLocked}
              className={`p-2.5 rounded-xl border cursor-pointer transition flex items-center gap-1 text-[11px] font-bold ${
                seedLocked
                  ? 'bg-amber-950/60 border-amber-500/40 text-amber-300 hover:bg-amber-900/60'
                  : 'bg-emerald-950/50 border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/50'
              }`}
              title={
                seedLocked
                  ? 'Semilla bloqueada (haz clic para variar automáticamente en cada creación)'
                  : 'Variación automática activa (haz clic para fijar esta semilla)'
              }
            >
              {seedLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => onChangeSeed(`forge-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString(36).slice(-4)}`)}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 cursor-pointer transition"
              title="Generar nueva semilla aleatoria y fijarla"
            >
              <Dices className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Back / Generate Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-800">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver</span>
        </button>

        <button
          type="button"
          onClick={onGenerate}
          className="px-7 py-3 rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white text-xs sm:text-sm font-extrabold flex items-center gap-2 cursor-pointer transition shadow-xl shadow-fuchsia-600/30 whitespace-nowrap forge-btn-press"
        >
          <Sparkles className="w-4 h-4" />
          <span>¡Generar Mi Modelo 3D!</span>
        </button>
      </div>
    </div>
  );
};
