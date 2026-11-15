import React, { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  Palette,
  Send,
  Save,
  RotateCcw,
  Layers,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
} from 'lucide-react';
import { useForge } from '../../context/ForgeContext.tsx';
import {
  Forge3DAsset,
  PBRTextureSet,
  generateProceduralPBRTextures,
  resolveRgbTuple,
  recolorPartSpec,
} from '../../utils/roblox3DEngine.ts';
import { RobloxWorldViewport3D } from '../RobloxWorldViewport3D.tsx';
import {
  InteractiveColorWheel,
  rgbToHex,
} from '../common/InteractiveColorWheel.tsx';
import { SIMPLE_ROBLOX_MATERIALS } from './edit/EditInspectorPanel.tsx';
import { forgeFetch } from '../../utils/forgeApiClient.ts';

interface MaterialPreset {
  id: string;
  name: string;
  pattern: string;
  defaultAlbedo: string;
  defaultEmissive: string;
  roughness: number;
  metalness: number;
}

const ADVANCED_PBR_PRESETS: MaterialPreset[] = [
  {
    id: 'titanium',
    name: 'Titanio Hexagonal',
    pattern: 'HexPlate',
    defaultAlbedo: '#06b6d4',
    defaultEmissive: '#38bdf8',
    roughness: 0.25,
    metalness: 0.85,
  },
  {
    id: 'carbon',
    name: 'Fibra de Carbono',
    pattern: 'CarbonWeave',
    defaultAlbedo: '#1e293b',
    defaultEmissive: '#0ea5e9',
    roughness: 0.45,
    metalness: 0.1,
  },
  {
    id: 'stone',
    name: 'Piedra Granito',
    pattern: 'StoneGrid',
    defaultAlbedo: '#78716c',
    defaultEmissive: '#a8a29e',
    roughness: 0.85,
    metalness: 0.05,
  },
  {
    id: 'gold_chrome',
    name: 'Oro Pulido',
    pattern: 'BrushedTitanium',
    defaultAlbedo: '#eab308',
    defaultEmissive: '#fef08a',
    roughness: 0.15,
    metalness: 0.95,
  },
];

export const MaterialsView: React.FC = () => {
  const {
    activeAsset,
    setActiveAsset,
    assetLibrary,
    selectedPart,
    setSelectedPart,
    applyAssetChange,
    undo,
    canUndo,
    pendingChanges,
    saveAssetToDisk,
    pushToStudio,
    setNotification,
    setActiveTab,
  } = useForge();

  const [paintScope, setPaintScope] = useState<'selected' | 'same_material' | 'all'>('selected');
  const [liveColorHex, setLiveColorHex] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'paint' | 'viewport' | 'parts'>('paint');

  // Collapsible Advanced PBR section (hidden by default so kids see a clean, fun painter)
  const [showAdvancedPbr, setShowAdvancedPbr] = useState<boolean>(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('titanium');
  const [pbrTextures, setPbrTextures] = useState<PBRTextureSet | null>(null);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  const activeTargetPart = useMemo(() => {
    if (!activeAsset || activeAsset.parts.length === 0) return null;
    if (selectedPart) {
      return activeAsset.parts.find((p) => p.name === selectedPart.name) || activeAsset.parts[0];
    }
    return activeAsset.parts[0];
  }, [activeAsset, selectedPart]);

  const activePartRgb = useMemo<[number, number, number]>(() => {
    if (!activeTargetPart) return [59, 130, 246];
    return resolveRgbTuple(
      activeTargetPart.color,
      undefined,
      (activeTargetPart as any).colorSpace || (activeTargetPart as any).colorFormat
    );
  }, [activeTargetPart]);

  const currentHex =
    liveColorHex || rgbToHex(activePartRgb[0], activePartRgb[1], activePartRgb[2]);

  // Compute target part names for 60fps live preview
  const targetPartNames = useMemo<string[] | null>(() => {
    if (!activeAsset || !activeTargetPart) return null;
    if (paintScope === 'all') return null;
    if (paintScope === 'same_material') {
      const targetMat = activeTargetPart.material || 'SmoothPlastic';
      return activeAsset.parts
        .filter((p) => (p.material || 'SmoothPlastic') === targetMat)
        .map((p) => p.name);
    }
    return [activeTargetPart.name];
  }, [activeAsset, activeTargetPart, paintScope]);

  // Generate PBR preview textures only when advanced accordion is opened
  useEffect(() => {
    if (!showAdvancedPbr) return;
    const preset = ADVANCED_PBR_PRESETS.find((p) => p.id === selectedPresetId);
    const pattern = preset?.pattern || 'HexPlate';
    const textures = generateProceduralPBRTextures(
      pattern,
      currentHex,
      preset?.defaultEmissive || '#38bdf8',
      8
    );
    setPbrTextures(textures);
  }, [showAdvancedPbr, selectedPresetId, currentHex]);

  if (!activeAsset) {
    return (
      <div className="py-12 px-6 text-center space-y-5 max-w-xl mx-auto bg-slate-900/75 border border-fuchsia-500/30 rounded-3xl my-6 shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-amber-500 flex items-center justify-center text-white mx-auto shadow-lg">
          <Palette className="w-8 h-8" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-xl font-extrabold text-white">
            Elige un modelo para empezar a pintar
          </h3>
          <p className="text-slate-300 text-xs leading-relaxed max-w-md mx-auto">
            Selecciona uno de tus modelos guardados o crea uno nuevo para pintarlo pieza por pieza con el círculo de colores.
          </p>
        </div>

        {assetLibrary.length > 0 && (
          <div className="bg-slate-950/85 border border-slate-800 rounded-2xl p-4 text-left space-y-2 max-w-md mx-auto">
            <span className="text-xs font-bold text-fuchsia-300 block">
              Tus modelos ({assetLibrary.length}):
            </span>
            <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
              {assetLibrary.slice(0, 6).map((item) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => setActiveAsset(item)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-fuchsia-950/50 border border-slate-800 hover:border-fuchsia-400/50 flex items-center justify-between text-xs cursor-pointer transition"
                >
                  <span className="font-bold text-white truncate">{item.name}</span>
                  <span className="text-[11px] font-mono text-slate-400 shrink-0 ml-2">
                    {item.parts?.length || 0} pzs
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer transition shadow-lg"
          >
            <Sparkles className="w-4 h-4" />
            <span>Crear Nuevo Modelo</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer transition"
          >
            Ir al Menú
          </button>
        </div>
      </div>
    );
  }

  const handleColorLiveChange = (hex: string) => {
    setLiveColorHex(hex);
  };

  const handleColorCommit = (_hex: string, rgb: [number, number, number]) => {
    setLiveColorHex(null);
    if (!activeTargetPart) return;

    const targetSet = targetPartNames ? new Set(targetPartNames) : null;
    const updatedAsset: Forge3DAsset = {
      ...activeAsset,
      parts: activeAsset.parts.map((part) => {
        const shouldPaint =
          paintScope === 'all' || (targetSet ? targetSet.has(part.name) : part.name === activeTargetPart.name);
        return shouldPaint ? recolorPartSpec(part, rgb) : part;
      }),
    };

    const summary =
      paintScope === 'all'
        ? `Pintar todo el modelo (${activeAsset.parts.length} piezas)`
        : paintScope === 'same_material'
        ? `Pintar piezas de ${activeTargetPart.material || 'SmoothPlastic'}`
        : `Pintar ${activeTargetPart.name}`;

    applyAssetChange(updatedAsset, summary, 'material_pbr');
  };

  const handleSelectMaterial = (materialId: string) => {
    setLiveColorHex(null);
    if (!activeTargetPart) return;
    const targetSet = targetPartNames ? new Set(targetPartNames) : null;

    const updatedAsset: Forge3DAsset = {
      ...activeAsset,
      parts: activeAsset.parts.map((part) => {
        const shouldUpdate =
          paintScope === 'all' || (targetSet ? targetSet.has(part.name) : part.name === activeTargetPart.name);
        if (!shouldUpdate) return part;
        const partRgb = resolveRgbTuple(
          part.color,
          undefined,
          (part as any).colorSpace || (part as any).colorFormat
        );
        return recolorPartSpec(part, partRgb, materialId);
      }),
    };

    applyAssetChange(updatedAsset, `Cambiar acabado a ${materialId}`, 'material_pbr');
  };

  const handleApplyAdvancedPbr = async () => {
    setIsPublishing(true);
    const preset = ADVANCED_PBR_PRESETS.find((p) => p.id === selectedPresetId) || ADVANCED_PBR_PRESETS[0];
    const targetSet = targetPartNames ? new Set(targetPartNames) : null;
    const textures = generateProceduralPBRTextures(
      preset.pattern,
      currentHex,
      preset.defaultEmissive,
      8
    );

    const updatedAsset: Forge3DAsset = {
      ...activeAsset,
      pbr_profile: {
        albedo_hex: currentHex,
        roughness: preset.roughness,
        metalness: preset.metalness,
        emissive_hex: preset.defaultEmissive,
        roblox_material: preset.metalness > 0.5 ? 'Metal' : 'SmoothPlastic',
        pattern: preset.pattern,
        color_map_asset_id: '',
        normal_map_asset_id: '',
        roughness_map_asset_id: '',
        metalness_map_asset_id: '',
      },
      parts: activeAsset.parts.map((part) => {
        const shouldUpdate =
          paintScope === 'all' || (targetSet ? targetSet.has(part.name) : part.name === activeTargetPart?.name);
        if (!shouldUpdate) return part;
        return {
          ...part,
          roughness: preset.roughness,
          metalness: preset.metalness,
          pbrMaterial: {
            pattern: preset.pattern,
            albedoHex: currentHex,
            emissiveHex: preset.defaultEmissive,
            roughness: preset.roughness,
            metalness: preset.metalness,
            albedoDataUrl: textures.albedoDataUrl,
            normalDataUrl: textures.normalDataUrl,
            roughnessDataUrl: textures.roughnessDataUrl,
            metalnessDataUrl: textures.metalnessDataUrl,
          },
        };
      }),
    };

    applyAssetChange(updatedAsset, `Aplicar textura PBR '${preset.name}'`, 'material_pbr');

    try {
      const res = await forgeFetch('/api/v1/assets/publish-pbr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_name: activeAsset.name,
          pbr_profile: updatedAsset.pbr_profile,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setNotification({
          type: 'success',
          message:
            data.status === 'cloud_published'
              ? 'Texturas PBR publicadas en Roblox Cloud.'
              : 'Texturas PBR guardadas para Roblox Studio.',
        });
      }
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: `Error al guardar PBR: ${err.message}`,
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    await saveAssetToDisk(true);
    setSaving(false);
  };

  const sameMaterialCount = activeTargetPart
    ? activeAsset.parts.filter(
        (p) => (p.material || 'SmoothPlastic') === (activeTargetPart.material || 'SmoothPlastic')
      ).length
    : 0;

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] min-h-[640px] space-y-3 animate-slide-up">
      {/* Clean & Friendly Top Bar */}
      <div className="bg-slate-900/90 border border-fuchsia-500/30 rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0 shadow-lg">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500 to-amber-500 flex items-center justify-center text-white shadow-md shrink-0">
            <Palette className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-extrabold text-white text-sm truncate">
              Pintar: {activeAsset.name}
            </h2>
            <p className="text-[11px] text-slate-400 truncate">
              Toca una pieza en el 3D o en la lista y gira el círculo de colores
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className={`px-3 py-2 rounded-xl border border-slate-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap ${
              canUndo
                ? 'bg-slate-950 hover:bg-slate-800 text-slate-200'
                : 'bg-slate-950/40 text-slate-600 cursor-not-allowed'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Deshacer</span>
          </button>

          {pendingChanges && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? '...' : 'Guardar'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => pushToStudio(activeAsset)}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition shadow-md whitespace-nowrap"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Enviar a Roblox</span>
          </button>
        </div>
      </div>

      {/* Responsive Mobile Tab Switcher */}
      <div className="flex md:hidden items-center gap-1.5 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800 shrink-0">
        <button
          type="button"
          onClick={() => setMobilePanel('paint')}
          className={`flex-1 py-2 rounded-lg text-xs font-bold cursor-pointer transition ${
            mobilePanel === 'paint' ? 'bg-fuchsia-600 text-white' : 'text-slate-400'
          }`}
        >
          Colores
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel('viewport')}
          className={`flex-1 py-2 rounded-lg text-xs font-bold cursor-pointer transition ${
            mobilePanel === 'viewport' ? 'bg-cyan-600 text-white' : 'text-slate-400'
          }`}
        >
          Vista 3D
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel('parts')}
          className={`flex-1 py-2 rounded-lg text-xs font-bold cursor-pointer transition ${
            mobilePanel === 'parts' ? 'bg-violet-600 text-white' : 'text-slate-400'
          }`}
        >
          Piezas ({activeAsset.parts.length})
        </button>
      </div>

      {/* Main 3-Column Studio */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 min-h-0">
        {/* LEFT COLUMN: Piece Picker List */}
        <div
          className={`md:col-span-3 lg:col-span-3 flex-col bg-slate-900/85 border border-slate-800 rounded-2xl p-3.5 overflow-hidden ${
            mobilePanel === 'parts' ? 'flex' : 'hidden md:flex'
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-2 shrink-0">
            <span className="font-bold text-xs text-white flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-fuchsia-400" />
              <span>Piezas del Modelo</span>
            </span>
            <span className="text-[11px] font-mono tabular-nums text-fuchsia-300 font-bold">
              {activeAsset.parts.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 text-xs">
            {activeAsset.parts.map((part, index) => {
              const isSelected = activeTargetPart?.name === part.name;
              const isInBatch =
                paintScope === 'all' ||
                (paintScope === 'same_material' && targetPartNames?.includes(part.name));
              const rgb = resolveRgbTuple(
                part.color,
                undefined,
                (part as any).colorSpace || (part as any).colorFormat
              );
              const partDisplayColor =
                liveColorHex && (isSelected || isInBatch)
                  ? liveColorHex
                  : `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

              return (
                <button
                  key={part.name + index}
                  type="button"
                  onClick={() => {
                    setLiveColorHex(null);
                    setSelectedPart(part);
                    if (mobilePanel === 'parts') setMobilePanel('paint');
                  }}
                  className={`w-full p-2.5 rounded-xl cursor-pointer transition flex items-center justify-between text-left ${
                    isSelected
                      ? 'bg-gradient-to-r from-fuchsia-950/90 to-violet-950/80 text-white border border-fuchsia-400/70 font-bold shadow-sm'
                      : isInBatch
                      ? 'bg-slate-800/80 text-slate-100 border border-fuchsia-500/30'
                      : 'hover:bg-slate-800/70 text-slate-300 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-4 h-4 rounded-full border border-white/40 shrink-0 shadow-sm"
                      style={{ backgroundColor: partDisplayColor }}
                    />
                    <span className="truncate">{part.name}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 shrink-0 ml-1">
                    {part.material || 'Plástico'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* CENTER COLUMN: Interactive 3D Viewport */}
        <div
          className={`col-span-1 md:col-span-5 lg:col-span-5 rounded-2xl overflow-hidden border border-slate-800 bg-black/80 relative flex-col ${
            mobilePanel === 'viewport' ? 'flex' : 'hidden md:flex'
          }`}
        >
          <RobloxWorldViewport3D
            asset={activeAsset}
            compactHeader
            highlightedPartName={activeTargetPart?.name || null}
            livePartPreview={
              liveColorHex
                ? {
                    applyToAll: paintScope === 'all',
                    partNames: targetPartNames,
                    hex: liveColorHex,
                  }
                : null
            }
            onPartSelected={(part) => {
              if (part) {
                setLiveColorHex(null);
                setSelectedPart(part);
              }
            }}
          />
        </div>

        {/* RIGHT COLUMN: Kids Interactive Color Wheel & Material Studio */}
        <div
          className={`md:col-span-4 lg:col-span-4 flex-col bg-slate-900/90 border border-slate-800 rounded-2xl p-4 overflow-y-auto space-y-4 ${
            mobilePanel === 'paint' ? 'flex' : 'hidden md:flex'
          }`}
        >
          {/* Current Piece & Scope Selector */}
          <div className="space-y-2.5 border-b border-slate-800 pb-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[11px] font-bold text-fuchsia-300 block">
                  {paintScope === 'all'
                    ? 'Pintando todo el modelo'
                    : paintScope === 'same_material'
                    ? `Pintando piezas de ${activeTargetPart?.material || 'este tipo'}`
                    : 'Pintando esta pieza:'}
                </span>
                <h3 className="text-base font-extrabold text-white truncate">
                  {paintScope === 'all'
                    ? `${activeAsset.parts.length} piezas juntas`
                    : activeTargetPart?.name || 'Modelo'}
                </h3>
              </div>

              <div
                className="w-9 h-9 rounded-xl border-2 border-white/60 shadow-md shrink-0"
                style={{ backgroundColor: currentHex }}
              />
            </div>

            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => setPaintScope('selected')}
                className={`py-2 px-2 rounded-xl border font-bold cursor-pointer transition truncate ${
                  paintScope === 'selected'
                    ? 'bg-fuchsia-950/70 border-fuchsia-400 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Solo 1 pieza
              </button>
              <button
                type="button"
                onClick={() => setPaintScope('same_material')}
                className={`py-2 px-2 rounded-xl border font-bold cursor-pointer transition truncate ${
                  paintScope === 'same_material'
                    ? 'bg-cyan-950/70 border-cyan-400 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Similares ({sameMaterialCount})
              </button>
              <button
                type="button"
                onClick={() => setPaintScope('all')}
                className={`py-2 px-2 rounded-xl border font-bold cursor-pointer transition truncate ${
                  paintScope === 'all'
                    ? 'bg-amber-950/70 border-amber-400 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Todo ({activeAsset.parts.length})
              </button>
            </div>
          </div>

          {/* Interactive Rainbow Color Wheel */}
          <div className="bg-slate-950/75 border border-slate-800/90 rounded-2xl p-4">
            <InteractiveColorWheel
              value={currentHex}
              size={200}
              title="Círculo de Colores"
              onChangeLive={handleColorLiveChange}
              onCommit={handleColorCommit}
            />
          </div>

          {/* Kid-Friendly Roblox Material Finish Picker */}
          <div className="space-y-2">
            <span className="text-xs font-extrabold text-white block">
              Elige el estilo del material:
            </span>
            <div className="grid grid-cols-3 gap-2">
              {SIMPLE_ROBLOX_MATERIALS.map((mat) => {
                const isActive = (activeTargetPart?.material || 'SmoothPlastic') === mat.id;
                return (
                  <button
                    key={mat.id}
                    type="button"
                    onClick={() => handleSelectMaterial(mat.id)}
                    className={`py-2.5 px-2 rounded-xl border text-center cursor-pointer transition ${
                      isActive
                        ? 'bg-cyan-950/80 border-cyan-400 text-white shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <span className="text-xs font-extrabold block truncate">{mat.label}</span>
                    <span className="text-[10px] text-slate-400 block truncate">{mat.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Collapsible Advanced PBR Options */}
          <div className="pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowAdvancedPbr(!showAdvancedPbr)}
              className="w-full py-2.5 px-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-bold flex items-center justify-between cursor-pointer transition"
            >
              <span>Texturas Avanzadas (PBR Roblox Studio)</span>
              {showAdvancedPbr ? (
                <ChevronUp className="w-4 h-4 text-cyan-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-cyan-400" />
              )}
            </button>

            {showAdvancedPbr && (
              <div className="mt-3 space-y-3 bg-slate-950/80 border border-slate-800 rounded-2xl p-3.5">
                <div className="grid grid-cols-2 gap-2">
                  {ADVANCED_PBR_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setSelectedPresetId(preset.id)}
                      className={`p-2 rounded-xl border text-left text-xs cursor-pointer transition ${
                        selectedPresetId === preset.id
                          ? 'bg-cyan-950/60 border-cyan-400 text-white font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>

                {pbrTextures && (
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: 'Color', src: pbrTextures.albedoDataUrl },
                      { label: 'Relieve', src: pbrTextures.normalDataUrl },
                      { label: 'Rugoso', src: pbrTextures.roughnessDataUrl },
                      { label: 'Metal', src: pbrTextures.metalnessDataUrl },
                    ].map((mapItem) => (
                      <div key={mapItem.label} className="space-y-1 text-center">
                        <div className="aspect-square rounded-lg overflow-hidden border border-slate-800 bg-black flex items-center justify-center">
                          {mapItem.src ? (
                            <img
                              src={mapItem.src}
                              alt={mapItem.label}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <ImageIcon className="w-4 h-4 text-slate-600" />
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 block">{mapItem.label}</span>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  disabled={isPublishing}
                  onClick={handleApplyAdvancedPbr}
                  className="w-full py-2.5 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {isPublishing ? 'Guardando texturas...' : 'Aplicar Textura PBR'}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
