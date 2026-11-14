import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Palette,
  Eye,
  Send,
  Box,
  Image as ImageIcon,
  Save,
} from 'lucide-react';
import { useForge } from '../../context/ForgeContext.tsx';
import {
  Forge3DAsset,
  PBRTextureSet,
  generateProceduralPBRTextures,
} from '../../utils/roblox3DEngine.ts';
import { RobloxWorldViewport3D } from '../RobloxWorldViewport3D.tsx';
import { HelpTooltip, FORGE_GLOSSARY } from '../common/HelpTooltip.tsx';
import { forgeFetch } from '../../utils/forgeApiClient.ts';

interface MaterialPreset {
  id: string;
  name: string;
  pattern: string;
  defaultAlbedo: string;
  defaultEmissive: string;
  roughness: number;
  metalness: number;
  description: string;
}

const MATERIAL_PRESETS: MaterialPreset[] = [
  {
    id: 'titanium',
    name: 'Titanio Hexagonal',
    pattern: 'HexPlate',
    defaultAlbedo: '#06b6d4',
    defaultEmissive: '#38bdf8',
    roughness: 0.25,
    metalness: 0.85,
    description: 'Blindaje sci-fi con placas hexagonales y alta reflectividad metálica.',
  },
  {
    id: 'carbon',
    name: 'Fibra de Carbono',
    pattern: 'CarbonWeave',
    defaultAlbedo: '#1e293b',
    defaultEmissive: '#0ea5e9',
    roughness: 0.45,
    metalness: 0.1,
    description: 'Tejido entrelazado de polímero reforzado con brillo mate satinado.',
  },
  {
    id: 'brushed_metal',
    name: 'Metal Cepillado',
    pattern: 'BrushedTitanium',
    defaultAlbedo: '#64748b',
    defaultEmissive: '#94a3b8',
    roughness: 0.35,
    metalness: 0.9,
    description: 'Acero inoxidable industrial con líneas finas de cepillado horizontal.',
  },
  {
    id: 'stone',
    name: 'Piedra Granito',
    pattern: 'StoneGrid',
    defaultAlbedo: '#78716c',
    defaultEmissive: '#a8a29e',
    roughness: 0.85,
    metalness: 0.05,
    description: 'Superficie pétrea porosa con relieve rugoso y nula conductividad.',
  },
  {
    id: 'gold_chrome',
    name: 'Oro Pulido',
    pattern: 'BrushedTitanium',
    defaultAlbedo: '#eab308',
    defaultEmissive: '#fef08a',
    roughness: 0.15,
    metalness: 0.95,
    description: 'Acabado espejo dorado de lujo para accesorios y reliquias.',
  },
  {
    id: 'obsidian',
    name: 'Obsidiana Volcánica',
    pattern: 'HexPlate',
    defaultAlbedo: '#0f172a',
    defaultEmissive: '#818cf8',
    roughness: 0.12,
    metalness: 0.3,
    description: 'Vidrio volcánico oscuro con reflejos nítidos y relieve fractal.',
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
    saveAssetToDisk,
    pushToStudio,
    setNotification,
    setActiveTab,
  } = useForge();

  const [selectedPresetId, setSelectedPresetId] = useState<string>('titanium');
  const [albedoHex, setAlbedoHex] = useState<string>('#06b6d4');
  const [emissiveHex, setEmissiveHex] = useState<string>('#38bdf8');
  const [roughness, setRoughness] = useState<number>(0.25);
  const [metalness, setMetalness] = useState<number>(0.85);
  const [applyScope, setApplyScope] = useState<'all' | 'selected'>('all');

  const [pbrTextures, setPbrTextures] = useState<PBRTextureSet | null>(null);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);

  // Generate real PBR texture cards whenever preset/colors change
  useEffect(() => {
    const preset = MATERIAL_PRESETS.find((p) => p.id === selectedPresetId);
    const pattern = preset?.pattern || 'HexPlate';
    const textures = generateProceduralPBRTextures(pattern, albedoHex, emissiveHex, 8);
    setPbrTextures(textures);
  }, [selectedPresetId, albedoHex, emissiveHex]);

  if (!activeAsset) {
    return (
      <div className="py-12 px-6 text-center space-y-5 max-w-xl mx-auto bg-slate-900/60 border border-slate-800 rounded-2xl my-6">
        <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-cyan-400 mx-auto">
          <Palette className="w-7 h-7" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-lg font-bold text-white">No hay modelo cargado para pintar materiales</h3>
          <p className="text-slate-400 text-xs leading-relaxed max-w-md mx-auto">
            Selecciona un modelo de tu biblioteca aquí mismo o crea uno nuevo con el asistente 3D.
          </p>
        </div>

        {assetLibrary.length > 0 && (
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 text-left space-y-2 max-w-md mx-auto">
            <span className="text-xs font-semibold text-slate-300 block">
              Abrir rápidamente desde tu biblioteca ({assetLibrary.length}):
            </span>
            <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
              {assetLibrary.slice(0, 6).map((item) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => setActiveAsset(item)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-between text-xs cursor-pointer transition"
                >
                  <span className="font-semibold text-white truncate">{item.name}</span>
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
            className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition"
          >
            <Sparkles className="w-4 h-4" />
            <span>Crear nuevo modelo</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer transition"
          >
            Ver toda la biblioteca
          </button>
        </div>
      </div>
    );
  }

  const handleSelectPreset = (preset: MaterialPreset) => {
    setSelectedPresetId(preset.id);
    setAlbedoHex(preset.defaultAlbedo);
    setEmissiveHex(preset.defaultEmissive);
    setRoughness(preset.roughness);
    setMetalness(preset.metalness);
  };

  const handleApplyMaterialToAsset = () => {
    const preset = MATERIAL_PRESETS.find((p) => p.id === selectedPresetId);
    const pattern = preset?.pattern || 'HexPlate';

    const newPbrProfile = {
      albedo_hex: albedoHex,
      roughness,
      metalness,
      emissive_hex: emissiveHex,
      roblox_material: metalness > 0.5 ? 'Metal' : 'SmoothPlastic',
      pattern,
      color_map_asset_id: '',
      normal_map_asset_id: '',
      roughness_map_asset_id: '',
      metalness_map_asset_id: '',
    };

    let updatedAsset: Forge3DAsset;

    if (applyScope === 'all' || !selectedPart) {
      updatedAsset = {
        ...activeAsset,
        pbr_profile: newPbrProfile,
        parts: activeAsset.parts.map((part) => ({
          ...part,
          roughness,
          metalness,
          pbrMaterial: {
            pattern,
            albedoHex,
            emissiveHex,
            roughness,
            metalness,
            albedoDataUrl: pbrTextures?.albedoDataUrl,
            normalDataUrl: pbrTextures?.normalDataUrl,
            roughnessDataUrl: pbrTextures?.roughnessDataUrl,
            metalnessDataUrl: pbrTextures?.metalnessDataUrl,
          },
        })),
      };
      applyAssetChange(
        updatedAsset,
        `Aplicar material '${preset?.name}' a todo el modelo`,
        'material_pbr'
      );
      setNotification({
        type: 'success',
        message: `Material '${preset?.name}' aplicado a todas las ${activeAsset.parts.length} piezas.`,
      });
    } else {
      updatedAsset = {
        ...activeAsset,
        parts: activeAsset.parts.map((part) =>
          part.name === selectedPart.name
            ? {
                ...part,
                roughness,
                metalness,
                pbrMaterial: {
                  pattern,
                  albedoHex,
                  emissiveHex,
                  roughness,
                  metalness,
                  albedoDataUrl: pbrTextures?.albedoDataUrl,
                  normalDataUrl: pbrTextures?.normalDataUrl,
                  roughnessDataUrl: pbrTextures?.roughnessDataUrl,
                  metalnessDataUrl: pbrTextures?.metalnessDataUrl,
                },
              }
            : part
        ),
      };
      applyAssetChange(
        updatedAsset,
        `Aplicar material '${preset?.name}' a ${selectedPart.name}`,
        'material_pbr'
      );
      setNotification({
        type: 'success',
        message: `Material aplicado a la pieza '${selectedPart.name}'.`,
      });
    }
  };

  const handleGenerateSurfaceAppearance = async () => {
    setIsPublishing(true);
    handleApplyMaterialToAsset();

    try {
      const preset = MATERIAL_PRESETS.find((p) => p.id === selectedPresetId);
      const pattern = preset?.pattern || 'HexPlate';

      const res = await forgeFetch('/api/v1/assets/publish-pbr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_name: activeAsset.name,
          pbr_profile: {
            albedo_hex: albedoHex,
            emissive_hex: emissiveHex,
            roughness,
            metalness,
            pattern,
          },
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setNotification({
          type: 'success',
          message:
            data.status === 'cloud_published'
              ? 'SurfaceAppearance publicada en Roblox Cloud con IDs oficiales.'
              : 'Texturas PBR guardadas localmente en disco para Roblox Studio.',
        });
      }
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: `Error al publicar PBR: ${err.message}`,
      });
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-200">
      {/* Header & Top Action Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="inline-flex items-center gap-2 text-cyan-400 text-xs font-semibold uppercase tracking-wider">
              <Palette className="w-3.5 h-3.5" />
              <span>Editor de Materiales PBR &amp; SurfaceAppearance</span>
            </div>
            <h2 className="text-xl font-bold text-white mt-0.5">
              Materiales Realistas para {activeAsset.name}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <HelpTooltip
              term={FORGE_GLOSSARY.surfaceAppearance.term}
              explanation={FORGE_GLOSSARY.surfaceAppearance.explanation}
              variant="badge"
            />
            <button
              type="button"
              onClick={handleApplyMaterialToAsset}
              className="px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Aplicar Material</span>
            </button>
            <button
              type="button"
              onClick={() => saveAssetToDisk(true)}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5 text-cyan-400" />
              <span>Guardar</span>
            </button>
            <button
              type="button"
              onClick={() => pushToStudio(activeAsset)}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Enviar a Studio</span>
            </button>
          </div>
        </div>

        {/* Clean Unboxed Status Line */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-2 flex-wrap">
            <span>Estado de Texturas:</span>
            <strong className="text-cyan-300 font-semibold">Texturas PBR en sesión local y carpeta Rojo</strong>
            <span className="text-slate-700">·</span>
            <span>Haz clic en una pieza del visor 3D o usa el selector inferior para pintar por partes.</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Left Controls (5 cols) | Right 3D Preview & 4 Channels (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: Scope, Presets & Sliders (5 cols) */}
        <div className="lg:col-span-5 space-y-5">
          {/* Application Scope + Inline Part Selector */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
            <span className="text-xs font-bold text-white block">
              1. ¿Dónde deseas aplicar el material?
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => setApplyScope('all')}
                className={`p-2.5 rounded-xl border text-center transition cursor-pointer font-semibold ${
                  applyScope === 'all'
                    ? 'bg-cyan-950/60 border-cyan-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Todo el modelo ({activeAsset.parts.length} pzs)
              </button>

              <button
                type="button"
                onClick={() => {
                  setApplyScope('selected');
                  if (!selectedPart && activeAsset.parts.length > 0) {
                    setSelectedPart(activeAsset.parts[0]);
                  }
                }}
                className={`p-2.5 rounded-xl border text-center transition cursor-pointer font-semibold ${
                  applyScope === 'selected'
                    ? 'bg-cyan-950/60 border-cyan-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Una pieza específica
              </button>
            </div>

            {applyScope === 'selected' && (
              <div className="pt-1">
                <label className="text-[11px] text-slate-400 block mb-1">
                  Selecciona la pieza del modelo:
                </label>
                <select
                  aria-label="Seleccionar pieza para aplicar material"
                  value={selectedPart?.name || activeAsset.parts[0]?.name || ''}
                  onChange={(e) => {
                    const found = activeAsset.parts.find((p) => p.name === e.target.value);
                    if (found) setSelectedPart(found);
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 cursor-pointer"
                >
                  {activeAsset.parts.map((part, idx) => (
                    <option key={part.name + idx} value={part.name}>
                      {idx + 1}. {part.name} ({part.material || 'Metal'})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Material Presets Grid */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
            <span className="text-xs font-bold text-white block">
              2. Elige un Acabado Predefinido (Preset)
            </span>

            <div className="grid grid-cols-2 gap-2.5">
              {MATERIAL_PRESETS.map((preset) => {
                const isSelected = selectedPresetId === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => handleSelectPreset(preset)}
                    className={`p-3 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                      isSelected
                        ? 'bg-cyan-950/40 border-cyan-500 shadow-sm'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900/60'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`text-xs font-semibold ${isSelected ? 'text-cyan-300' : 'text-slate-200'}`}>
                          {preset.name}
                        </span>
                        <div
                          className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-inner shrink-0"
                          style={{ backgroundColor: preset.defaultAlbedo }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 leading-tight line-clamp-2">
                        {preset.description}
                      </p>
                    </div>

                    <div className="mt-2 text-[10px] text-slate-500 font-mono tabular-nums flex items-center justify-between">
                      <span>R: {preset.roughness}</span>
                      <span>M: {preset.metalness}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Color & Accent Palettes */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
            <span className="text-xs font-bold text-white block">
              3. Color Base, Rugosidad y Metalicidad
            </span>

            <div className="grid grid-cols-2 gap-3">
              {/* Albedo / Base Color */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 block">Color Albedo / Base:</label>
                <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl p-2">
                  <input
                    type="color"
                    value={albedoHex}
                    onChange={(e) => setAlbedoHex(e.target.value)}
                    className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                  />
                  <input
                    type="text"
                    value={albedoHex}
                    onChange={(e) => setAlbedoHex(e.target.value)}
                    className="w-full bg-transparent text-xs text-white font-mono uppercase focus:outline-none"
                  />
                </div>
              </div>

              {/* Emissive / Accent Color */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 block">Color Emisivo / Acento:</label>
                <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl p-2">
                  <input
                    type="color"
                    value={emissiveHex}
                    onChange={(e) => setEmissiveHex(e.target.value)}
                    className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                  />
                  <input
                    type="text"
                    value={emissiveHex}
                    onChange={(e) => setEmissiveHex(e.target.value)}
                    className="w-full bg-transparent text-xs text-white font-mono uppercase focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Sliders for Roughness and Metalness */}
            <div className="space-y-3 pt-2">
              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>Rugosidad (Roughness / Brillo difuso):</span>
                  <span className="font-mono tabular-nums text-cyan-400">{roughness}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={roughness}
                  onChange={(e) => setRoughness(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>Metalicidad (Metalness / Conductividad):</span>
                  <span className="font-mono tabular-nums text-cyan-400">{metalness}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={metalness}
                  onChange={(e) => setMetalness(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500"
                />
              </div>
            </div>

            {/* Primary Action Button */}
            <button
              type="button"
              onClick={handleGenerateSurfaceAppearance}
              disabled={isPublishing}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition shadow-lg shadow-cyan-900/30"
            >
              <Sparkles className="w-4 h-4 text-cyan-200" />
              <span>
                {isPublishing
                  ? 'Aplicando y guardando SurfaceAppearance...'
                  : 'Aplicar y Guardar SurfaceAppearance PBR'}
              </span>
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: 3D Preview (Top) & 4-Channel PBR Inspector (Bottom) (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Real-time 3D Viewport Preview */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-cyan-400" />
                <span>Previsualización 3D Interactiva</span>
              </span>
              <button
                type="button"
                onClick={() => setActiveTab('edit')}
                className="text-xs text-slate-300 hover:text-cyan-300 flex items-center gap-1 transition cursor-pointer font-semibold"
              >
                <Box className="w-3.5 h-3.5 text-cyan-400" />
                <span>Abrir en Editor 3D ›</span>
              </button>
            </div>

            <div className="w-full h-72 rounded-xl overflow-hidden border border-slate-800 bg-black/80 relative">
              <RobloxWorldViewport3D
                asset={activeAsset}
                onPartSelected={(part) => {
                  if (part) {
                    setSelectedPart(part);
                    setApplyScope('selected');
                  }
                }}
              />
            </div>
          </div>

          {/* 4 PBR Channel Cards */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-white">
                Inspección de los 4 Canales PBR (SurfaceAppearance)
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                {MATERIAL_PRESETS.find((p) => p.id === selectedPresetId)?.pattern || 'HexPlate'} · 512x512
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Channel 1: Color / Albedo */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-200">ColorMap</span>
                  <span className="text-slate-500 font-mono text-[10px]">Albedo</span>
                </div>
                <div className="w-full aspect-square rounded-lg overflow-hidden border border-slate-800 bg-black/60 flex items-center justify-center">
                  {pbrTextures?.albedoDataUrl ? (
                    <img
                      src={pbrTextures.albedoDataUrl}
                      alt="ColorMap"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="w-6 h-6 text-slate-600" />
                  )}
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">
                  Color difuso y patrones gráficos base.
                </p>
              </div>

              {/* Channel 2: Normal (Bump / Relief) */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-200">NormalMap</span>
                  <span className="text-slate-500 font-mono text-[10px]">Relieve</span>
                </div>
                <div className="w-full aspect-square rounded-lg overflow-hidden border border-slate-800 bg-black/60 flex items-center justify-center">
                  {pbrTextures?.normalDataUrl ? (
                    <img
                      src={pbrTextures.normalDataUrl}
                      alt="NormalMap"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="w-6 h-6 text-slate-600" />
                  )}
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">
                  Simula profundidad y detalle poligonal sin lag.
                </p>
              </div>

              {/* Channel 3: Roughness (Glossiness) */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-200">Roughness</span>
                  <span className="text-slate-500 font-mono text-[10px]">Rugosidad</span>
                </div>
                <div className="w-full aspect-square rounded-lg overflow-hidden border border-slate-800 bg-black/60 flex items-center justify-center">
                  {pbrTextures?.roughnessDataUrl ? (
                    <img
                      src={pbrTextures.roughnessDataUrl}
                      alt="RoughnessMap"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="w-6 h-6 text-slate-600" />
                  )}
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">
                  Controla la dispersión de luz y micro-brillo.
                </p>
              </div>

              {/* Channel 4: Metalness (Conductivity) */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-200">Metalness</span>
                  <span className="text-slate-500 font-mono text-[10px]">Metálico</span>
                </div>
                <div className="w-full aspect-square rounded-lg overflow-hidden border border-slate-800 bg-black/60 flex items-center justify-center">
                  {pbrTextures?.metalnessDataUrl ? (
                    <img
                      src={pbrTextures.metalnessDataUrl}
                      alt="MetalnessMap"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="w-6 h-6 text-slate-600" />
                  )}
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">
                  Distingue metales conductores de dieléctricos.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
