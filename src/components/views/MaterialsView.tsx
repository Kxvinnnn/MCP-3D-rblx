import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Palette,
  Eye,
  CheckCircle2,
  ShieldAlert,
  Send,
  Layers,
  Box,
  Image as ImageIcon,
  Check,
  RotateCcw,
} from 'lucide-react';
import { useForge } from '../../context/ForgeContext.tsx';
import {
  Forge3DAsset,
  PBRTextureSet,
  generateProceduralPBRTextures,
} from '../../utils/roblox3DEngine.ts';
import { RobloxWorldViewport3D } from '../RobloxWorldViewport3D.tsx';
import { HelpTooltip, FORGE_GLOSSARY } from '../common/HelpTooltip.tsx';

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
    selectedPart,
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
      <div className="py-20 text-center space-y-4 max-w-md mx-auto">
        <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 mx-auto">
          <Palette className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-white">No hay modelo cargado para aplicar materiales</h3>
        <p className="text-slate-400 text-xs leading-relaxed">
          Selecciona un modelo desde Inicio o crea uno nuevo para personalizar sus texturas PBR.
        </p>
        <button
          type="button"
          onClick={() => setActiveTab('create')}
          className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition"
        >
          <Sparkles className="w-4 h-4" />
          <span>Crear nuevo modelo</span>
        </button>
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

      // Endpoint /api/v1/assets/publish-pbr
      const res = await fetch('/api/v1/assets/publish-pbr', {
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
      {/* Header & Concept Explanation */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="inline-flex items-center gap-2 text-cyan-400 text-xs font-semibold uppercase tracking-wider">
              <Palette className="w-3.5 h-3.5" />
              <span>Editor de Materiales PBR &amp; SurfaceAppearance</span>
            </div>
            <h2 className="text-xl font-bold text-white mt-0.5">
              Materiales Realistas para {activeAsset.name}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <HelpTooltip
              term={FORGE_GLOSSARY.surfaceAppearance.term}
              explanation={FORGE_GLOSSARY.surfaceAppearance.explanation}
              variant="badge"
            />
          </div>
        </div>

        {/* Status Distinction Banner: Local Saved vs Cloud Published */}
        <div className="mt-4 p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-slate-400 font-medium">Estado de Texturas:</span>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              <span className="text-cyan-300 font-medium">Texturas Guardadas Localmente</span>
            </div>
            <span className="text-slate-600">|</span>
            <span className="text-slate-500">Listas para previsualizar en sesión y en disco Rojo</span>
          </div>

          <div className="text-[11px] text-slate-500">
            * Se asignará un AssetId permanente al publicar el paquete en Roblox Cloud.
          </div>
        </div>
      </div>

      {/* Main Grid: Left Controls (5 cols) | Right 3D Preview & 4 Channels (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: Presets & Color Selectors (5 cols) */}
        <div className="lg:col-span-5 space-y-5">
          {/* Material Presets Carousel / Grid */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
            <span className="text-xs font-bold text-white block">
              1. Presets de Materiales
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
                          className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-inner"
                          style={{ backgroundColor: preset.defaultAlbedo }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 leading-tight line-clamp-2">
                        {preset.description}
                      </p>
                    </div>

                    <div className="mt-2 text-[10px] text-slate-500 font-mono flex items-center justify-between">
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
              2. Color Base y Emisivo
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
                  <span className="font-mono text-cyan-400">{roughness}</span>
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
                  <span className="font-mono text-cyan-400">{metalness}</span>
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

            {/* Application Scope */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <span className="text-xs font-semibold text-slate-300 block">
                Alcance de Aplicación:
              </span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setApplyScope('all')}
                  className={`p-2 rounded-lg border text-center transition cursor-pointer ${
                    applyScope === 'all'
                      ? 'bg-cyan-950/60 border-cyan-500 text-white font-medium'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  Todas las partes ({activeAsset.parts.length})
                </button>

                <button
                  type="button"
                  onClick={() => setApplyScope('selected')}
                  className={`p-2 rounded-lg border text-center transition cursor-pointer ${
                    applyScope === 'selected'
                      ? 'bg-cyan-950/60 border-cyan-500 text-white font-medium'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {selectedPart ? selectedPart.name : 'Pieza actual'}
                </button>
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
                  ? 'Generando SurfaceAppearance...'
                  : 'Generar SurfaceAppearance para Roblox'}
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
                <span>Previsualización 3D en Tiempo Real</span>
              </span>
              <button
                type="button"
                onClick={() => setActiveTab('edit')}
                className="text-xs text-slate-400 hover:text-cyan-300 transition cursor-pointer"
              >
                Abrir en Editor 3D ›
              </button>
            </div>

            <div className="w-full h-64 rounded-xl overflow-hidden border border-slate-800 bg-black/80 relative">
              <RobloxWorldViewport3D asset={activeAsset} />
            </div>
          </div>

          {/* 4 PBR Channel Cards */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-white">
                Inspección de los 4 Canales PBR
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                {MATERIAL_PRESETS.find((p) => p.id === selectedPresetId)?.pattern || 'HexPlate'} • 512x512
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
