import React, { useState, useRef } from 'react';
import {
  Sparkles,
  Upload,
  Play,
  Box,
  Layers,
  Send,
  Eye,
  Plus,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  ShieldCheck,
  Search,
} from 'lucide-react';
import { useForge } from '../../context/ForgeContext.tsx';
import { parseRBXMXToForgeAsset, Forge3DAsset } from '../../utils/roblox3DEngine.ts';
import { HelpTooltip, FORGE_GLOSSARY } from '../common/HelpTooltip.tsx';

export const HomeView: React.FC = () => {
  const {
    setActiveTab,
    setActiveAsset,
    assetLibrary,
    loadingLibrary,
    bridgeStatus,
    pushToStudio,
    setNotification,
    applyAssetChange,
  } = useForge();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [importingFile, setImportingFile] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Filter models
  const filteredAssets = assetLibrary.filter((asset) => {
    const matchesSearch =
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === 'ALL' ||
      asset.category?.toLowerCase() === selectedCategory.toLowerCase();
    return matchesSearch && matchesCategory;
  });

  const handleOpenInEditor = (asset: Forge3DAsset) => {
    setActiveAsset(asset);
    setActiveTab('edit');
  };

  const handleOpenMaterials = (asset: Forge3DAsset) => {
    setActiveAsset(asset);
    setActiveTab('materials');
  };

  const handleSendToStudio = async (asset: Forge3DAsset) => {
    setActiveAsset(asset);
    await pushToStudio(asset);
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportingFile(true);
    try {
      const fileName = file.name;
      const ext = fileName.split('.').pop()?.toLowerCase();

      if (ext === 'rbxmx') {
        const text = await file.text();
        const parsed = parseRBXMXToForgeAsset(text, fileName.replace(/\.[^/.]+$/, ''));
        applyAssetChange(parsed, `Importado desde archivo ${fileName}`, 'add_part');
        setActiveAsset(parsed);
        setActiveTab('edit');
        setNotification({
          type: 'success',
          message: `Archivo '${fileName}' importado correctamente con ${parsed.parts.length} piezas.`,
        });
      } else {
        // Para otros formatos 3D (.glb, .obj), estructurar asset contenedor
        const modelName = fileName.replace(/\.[^/.]+$/, '');
        const newAsset: Forge3DAsset = {
          name: modelName,
          category: 'Props',
          asset_type: 'Model3D',
          poly_count: 2400,
          collision_fidelity: 'Hull',
          rojo_target_folder: 'src/shared/assets/models',
          file_name: `${modelName}.luau`,
          description: `Modelo importado desde ${fileName}`,
          pbr_profile: {
            pattern: 'BrushedTitanium',
            albedo_hex: '#475569',
            emissive_hex: '#06b6d4',
            roughness: 0.35,
            metalness: 0.7,
            roblox_material: 'Metal',
          },
          parts: [
            {
              name: `${modelName}_Root`,
              shape: 'MeshPart',
              size: [4, 4, 4],
              position: [0, 2, 0],
              rotation: [0, 0, 0],
              color: [71, 85, 105],
              material: 'Metal',
              roughness: 0.35,
              metalness: 0.7,
              transparency: 0,
              canCollide: true,
              anchored: false,
              collisionFidelity: 'Hull',
            },
          ],
          luau_code: `-- Imported ${fileName}\nreturn {}\n`,
        };
        applyAssetChange(newAsset, `Importado ${fileName}`, 'add_part');
        setActiveAsset(newAsset);
        setActiveTab('edit');
        setNotification({
          type: 'success',
          message: `Modelo '${modelName}' cargado en el editor 3D.`,
        });
      }
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: `Error al importar: ${err.message || 'Formato no soportado'}`,
      });
    } finally {
      setImportingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-200">
      {/* Hidden File Input for Direct Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".rbxmx,.glb,.gltf,.obj"
        className="hidden"
        onChange={handleFileImport}
      />

      {/* Top System Health Bar */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-2 text-slate-400">
          <span className="font-semibold text-slate-200">Estado del Sistema:</span>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          {/* Roblox Studio */}
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                bridgeStatus.robloxStudio.connected ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' : 'bg-slate-600'
              }`}
            />
            <span className="text-slate-300">Roblox Studio:</span>
            <span className={bridgeStatus.robloxStudio.connected ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
              {bridgeStatus.robloxStudio.connected ? 'Conectado' : 'Esperando Plugin'}
            </span>
          </div>

          {/* Local Bridge */}
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                bridgeStatus.bridgeConnected ? 'bg-cyan-400 shadow-sm shadow-cyan-400/50' : 'bg-amber-400'
              }`}
            />
            <span className="text-slate-300">Puente Local (127.0.0.1:48720):</span>
            <span className={bridgeStatus.bridgeConnected ? 'text-cyan-400 font-medium' : 'text-amber-400'}>
              {bridgeStatus.bridgeConnected ? 'Activo' : 'En espera'}
            </span>
          </div>

          {/* Rojo */}
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                bridgeStatus.rojo.rojoServerListening ? 'bg-emerald-400' : 'bg-slate-600'
              }`}
            />
            <span className="text-slate-300">Rojo (Puerto 34872):</span>
            <span className={bridgeStatus.rojo.rojoServerListening ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
              {bridgeStatus.rojo.rojoServerListening ? 'Sincronizando' : 'Inactivo'}
            </span>
          </div>

          {/* Backend API */}
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                bridgeStatus.backend.status === 'connected'
                  ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50'
                  : bridgeStatus.backend.status === 'checking' || bridgeStatus.backend.status === 'unknown'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-red-400'
              }`}
            />
            <span className="text-slate-300">Backend API:</span>
            <span
              className={`font-medium ${
                bridgeStatus.backend.status === 'connected'
                  ? 'text-emerald-400'
                  : bridgeStatus.backend.status === 'checking' || bridgeStatus.backend.status === 'unknown'
                  ? 'text-amber-400'
                  : 'text-red-400'
              }`}
            >
              {bridgeStatus.backend.status === 'connected'
                ? `Operativo (${bridgeStatus.backend.latencyMs ?? 15}ms)`
                : bridgeStatus.backend.status === 'checking'
                ? 'Comprobando...'
                : bridgeStatus.backend.status === 'unknown'
                ? 'Iniciando...'
                : 'No disponible'}
            </span>
          </div>
        </div>
      </div>

      {/* Hero Welcome & Essential Question */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-900/90 via-slate-900/50 to-slate-950/80 border border-slate-800 p-8 md:p-10">
        <div className="max-w-2xl space-y-3">
          <div className="inline-flex items-center gap-2 text-cyan-400 text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-4 h-4" />
            <span>Estudio Profesional de Creación 3D para Roblox</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">
            ¿Qué deseas crear hoy?
          </h1>
          <p className="text-slate-400 text-sm md:text-base leading-relaxed">
            Genera modelos 3D optimizados, edita su geometría con{' '}
            <HelpTooltip
              term={FORGE_GLOSSARY.editableMesh.term}
              explanation={FORGE_GLOSSARY.editableMesh.explanation}
              variant="inline"
            >
              EditableMesh
            </HelpTooltip>
            , aplica materiales{' '}
            <HelpTooltip
              term={FORGE_GLOSSARY.surfaceAppearance.term}
              explanation={FORGE_GLOSSARY.surfaceAppearance.explanation}
              variant="inline"
            >
              SurfaceAppearance
            </HelpTooltip>{' '}
            y sincronízalos con tu juego en Roblox Studio sin fricción.
          </p>
        </div>

        {/* 3 Prominent Quick Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          {/* Card 1: Crear con IA */}
          <div
            onClick={() => setActiveTab('create')}
            className="group cursor-pointer rounded-xl bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 hover:border-cyan-500/50 p-5 transition duration-200 flex flex-col justify-between"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-lg bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-white text-base group-hover:text-cyan-300 transition">
                Crear nuevo modelo con IA
              </h3>
              <p className="text-slate-400 text-xs leading-relaxed">
                Asistente paso a paso: describe lo que imaginas con texto, sube una imagen 2D o genera un terreno en relieve.
              </p>
            </div>
            <div className="mt-5 flex items-center gap-2 text-xs font-medium text-cyan-400 group-hover:text-cyan-300">
              <span>Iniciar asistente</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition" />
            </div>
          </div>

          {/* Card 2: Importar archivo 3D */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="group cursor-pointer rounded-xl bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 hover:border-blue-500/50 p-5 transition duration-200 flex flex-col justify-between"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-lg bg-blue-950/80 border border-blue-800/60 flex items-center justify-center text-blue-400 group-hover:scale-105 transition">
                <Upload className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-white text-base group-hover:text-blue-300 transition">
                Importar archivo 3D
              </h3>
              <p className="text-slate-400 text-xs leading-relaxed">
                Carga archivos <span className="font-mono text-slate-300">.rbxmx</span>, <span className="font-mono text-slate-300">.glb</span> o <span className="font-mono text-slate-300">.obj</span> para inspeccionarlos y editarlos.
              </p>
            </div>
            <div className="mt-5 flex items-center gap-2 text-xs font-medium text-blue-400 group-hover:text-blue-300">
              <span>{importingFile ? 'Importando...' : 'Examinar archivo local'}</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition" />
            </div>
          </div>

          {/* Card 3: Conectar Roblox Studio */}
          <div
            onClick={() => setActiveTab('studio')}
            className="group cursor-pointer rounded-xl bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 hover:border-emerald-500/50 p-5 transition duration-200 flex flex-col justify-between"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition">
                <Send className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-white text-base group-hover:text-emerald-300 transition">
                Roblox Studio &amp; Puente
              </h3>
              <p className="text-slate-400 text-xs leading-relaxed">
                Gestiona la sincronización en vivo con el Plugin v2.3.0, resuelve diferencias y transfiere modelos con 1 clic.
              </p>
            </div>
            <div className="mt-5 flex items-center gap-2 text-xs font-medium text-emerald-400 group-hover:text-emerald-300">
              <span>Abrir centro de sincronización</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition" />
            </div>
          </div>
        </div>
      </div>

      {/* Recent Models & Asset Library Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Box className="w-5 h-5 text-cyan-400" />
              <span>Modelos Recientes y Biblioteca</span>
            </h2>
            <p className="text-slate-400 text-xs mt-0.5">
              Accede rápidamente a tus modelos guardados o continúa editando donde lo dejaste.
            </p>
          </div>

          {/* Search & Category Filter */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar modelo..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-44 sm:w-56"
              />
            </div>

            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer transition shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nuevo</span>
            </button>
          </div>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs text-slate-400">
          {['ALL', 'Props', 'Weapons', 'Vehicles', 'Structures', 'SciFi'].map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-md transition cursor-pointer whitespace-nowrap ${
                selectedCategory === cat
                  ? 'bg-slate-800 text-cyan-400 font-semibold border border-slate-700'
                  : 'hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              {cat === 'ALL' ? 'Todos' : cat}
            </button>
          ))}
        </div>

        {/* Asset Cards Grid */}
        {loadingLibrary ? (
          <div className="py-16 text-center text-slate-500 text-xs">
            Cargando modelos de la biblioteca...
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 p-12 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-600 mx-auto">
              <Box className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-slate-300 text-sm">
                No hay modelos disponibles todavía
              </h3>
              <p className="text-slate-500 text-xs max-w-sm mx-auto">
                Crea tu primer modelo con el asistente de IA o importa un archivo 3D desde tu equipo.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition shadow-lg shadow-cyan-900/30"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Crear mi primer modelo</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAssets.map((asset, index) => {
              const partCount = asset.parts?.length || 1;
              const polyCount = asset.poly_count || 0;
              const isSavedRojo = !!asset.saved_path;

              return (
                <div
                  key={asset.name + index}
                  className="group rounded-xl bg-slate-900/70 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 p-4 transition duration-150 flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-3">
                    {/* Top Row: Category & Status */}
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="font-medium text-slate-300">{asset.category || 'Props'}</span>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        {isSavedRojo ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>En disco Rojo</span>
                          </span>
                        ) : (
                          <span className="text-slate-500">Sesión Local</span>
                        )}
                      </div>
                    </div>

                    {/* Asset Name & Description */}
                    <div>
                      <h4 className="font-bold text-white text-sm group-hover:text-cyan-300 transition line-clamp-1">
                        {asset.name}
                      </h4>
                      <p className="text-slate-400 text-xs line-clamp-2 mt-1 leading-relaxed">
                        {asset.description || 'Modelo 3D optimizado para Roblox'}
                      </p>
                    </div>

                    {/* Metadata Specs */}
                    <div className="flex items-center gap-4 text-xs text-slate-400 pt-1 font-mono">
                      <div className="flex items-center gap-1">
                        <Layers className="w-3.5 h-3.5 text-slate-500" />
                        <span>{partCount} {partCount === 1 ? 'parte' : 'partes'}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Box className="w-3.5 h-3.5 text-slate-500" />
                        <span className="tabular-nums">{polyCount.toLocaleString()} tris</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div className="border-t border-slate-800/80 pt-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenInEditor(asset)}
                      className="flex-1 py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-cyan-600 text-slate-200 hover:text-white text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Editar 3D</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenMaterials(asset)}
                      className="py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium cursor-pointer transition"
                      title="Materiales PBR"
                    >
                      PBR
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSendToStudio(asset)}
                      className="py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-emerald-600 text-slate-300 hover:text-white text-xs font-medium cursor-pointer transition"
                      title="Enviar a Roblox Studio"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
