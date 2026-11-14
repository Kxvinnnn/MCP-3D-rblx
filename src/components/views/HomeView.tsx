import React, { useState, useRef, useMemo } from 'react';
import {
  Sparkles,
  Upload,
  Play,
  Box,
  Send,
  Plus,
  ArrowRight,
  Search,
  RefreshCw,
  X,
  BookOpen,
  Palette,
  MessageCircle,
} from 'lucide-react';
import { useForge } from '../../context/ForgeContext.tsx';
import {
  parseRBXMXToForgeAsset,
  Forge3DAsset,
} from '../../utils/roblox3DEngine.ts';
import billCipherImg from '../../assets/images/bill_cipher_menu_1794699792613.jpg';

interface HomeViewProps {
  onOpenTutorial?: () => void;
}

const BILL_CIPHER_TIPS: string[] = [
  '¡Hola! Soy Bill. Toca "Crear mi primer modelo" y haz un árbol mágico en un solo clic.',
  '¿Sabías que puedes girar tu modelo 360° en el Editor 3D arrastrando con el ratón?',
  'Si te equivocas al mover una parte, usa el botón Deshacer para volver atrás sin miedo.',
  'En la pestaña Pintar puedes darle brillo de oro, piedra o neón a cualquier parte de tu modelo.',
  'Cuando termines, pulsa "Mandar a Roblox" para llevar tu creación directo a tu mapa.',
];

const CATEGORY_LABELS_ES: Record<string, string> = {
  'Trees & Vegetation': 'Árboles',
  Props: 'Objetos',
  'Rocks & Nature': 'Rocas',
  'Buildings & Structures': 'Edificios',
  'Furniture & Interior': 'Muebles',
  'Scene Elements': 'Escenarios',
  'Stylized Assets': 'Estilizados',
  'Ambient & Decoration': 'Decoración',
};

export const HomeView: React.FC<HomeViewProps> = ({ onOpenTutorial }) => {
  const {
    setActiveTab,
    activeAsset,
    setActiveAsset,
    assetLibrary,
    loadingLibrary,
    fetchAssetLibrary,
    bridgeStatus,
    pushToStudio,
    setNotification,
    applyAssetChange,
  } = useForge();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [importingFile, setImportingFile] = useState<boolean>(false);
  const [billTipIndex, setBillTipIndex] = useState<number>(0);
  const [billImageError, setBillImageError] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: assetLibrary.length };
    for (const item of assetLibrary) {
      const cat = item.category || 'Props';
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [assetLibrary]);

  const filteredAssets = useMemo(() => {
    return assetLibrary.filter((asset) => {
      const matchesSearch =
        !searchQuery.trim() ||
        asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        asset.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        asset.category?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory =
        selectedCategory === 'ALL' ||
        (asset.category || 'Props').toLowerCase() === selectedCategory.toLowerCase();
      return matchesSearch && matchesCategory;
    });
  }, [assetLibrary, searchQuery, selectedCategory]);

  const handleOpenInEditor = (asset: Forge3DAsset) => {
    setActiveAsset(asset);
    setActiveTab('edit');
  };

  const handleSendToStudio = async (asset: Forge3DAsset) => {
    setActiveAsset(asset);
    await pushToStudio(asset);
  };

  const handleCycleBillTip = () => {
    setBillTipIndex((prev) => (prev + 1) % BILL_CIPHER_TIPS.length);
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
          message: `¡Listo! Abrimos '${fileName}' con ${parsed.parts.length} partes para editar.`,
        });
      } else {
        const modelName = fileName.replace(/\.[^/.]+$/, '');
        const newAsset: Forge3DAsset = {
          name: modelName,
          category: 'Props',
          asset_type: 'Model3D',
          poly_count: 2400,
          collision_fidelity: 'Hull',
          rojo_target_folder: 'src/shared/assets/models',
          file_name: `${modelName}.luau`,
          description: `Modelo traído desde ${fileName}`,
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
          message: `¡Modelo '${modelName}' listo en el Editor 3D!`,
        });
      }
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: `No se pudo abrir el archivo: ${err.message || 'formato no compatible'}`,
      });
    } finally {
      setImportingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-8 pb-12 animate-slide-up">
      {/* Hidden File Input for Direct Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".rbxmx,.glb,.gltf,.obj"
        className="hidden"
        onChange={handleFileImport}
      />

      {/* Main Welcome Hero featuring Bill Cipher */}
      <section className="relative rounded-3xl overflow-hidden border border-amber-400/25 bg-gradient-to-br from-[#0F172A] via-[#131836] to-[#1E1438] p-6 sm:p-8 shadow-2xl">
        <div className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-amber-400/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-cyan-500/15 blur-3xl" />

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Left: Friendly Welcome & Clear Primary Action */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <p className="text-xs sm:text-sm font-bold text-amber-300 tracking-wide">
                Estudio 3D Súper Fácil para Roblox
              </p>

              <h1 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-[1.1]">
                ¡Crea tus propios{' '}
                <span className="bg-gradient-to-r from-amber-300 via-yellow-200 to-cyan-300 bg-clip-text text-transparent">
                  modelos 3D
                </span>{' '}
                para jugar en Roblox!
              </h1>

              <p className="text-slate-200 text-sm sm:text-base leading-relaxed max-w-xl">
                Elige un árbol, un cofre o inventa lo que tú quieras. Píntalo con tus colores favoritos y llévalo directo a tu mapa de Roblox Studio sin complicaciones.
              </p>

              {/* Clear Primary CTA + Kid-Friendly Guide Button */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('create')}
                  className="min-h-[48px] px-7 py-3.5 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 hover:from-amber-300 hover:to-pink-400 text-slate-950 text-sm sm:text-base font-extrabold flex items-center gap-2.5 cursor-pointer transition shadow-xl shadow-amber-500/25 whitespace-nowrap forge-btn-press"
                >
                  <Sparkles className="w-5 h-5" />
                  <span>¡Crear mi primer modelo!</span>
                  <ArrowRight className="w-5 h-5" />
                </button>

                {onOpenTutorial && (
                  <button
                    type="button"
                    onClick={onOpenTutorial}
                    className="min-h-[48px] px-5 py-3 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-white text-sm font-bold flex items-center gap-2 cursor-pointer transition whitespace-nowrap forge-btn-press"
                  >
                    <BookOpen className="w-4 h-4 text-cyan-300" />
                    <span>Ver guía paso a paso</span>
                  </button>
                )}
              </div>
            </div>

            {/* Clean Quick Resume Bar when a model is already open */}
            {activeAsset && (
              <div className="bg-slate-950/75 border border-cyan-500/35 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-cyan-300 font-bold">
                    <Play className="w-3.5 h-3.5 fill-cyan-300 shrink-0" />
                    <span>Seguimos trabajando en:</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-sm text-white font-bold truncate">
                    <span className="truncate">{activeAsset.name}</span>
                    <span className="text-slate-500 font-normal">·</span>
                    <span className="text-xs text-slate-300 font-normal tabular-nums shrink-0">
                      {activeAsset.parts.length} partes
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveTab('edit')}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap forge-btn-press"
                  >
                    <Box className="w-4 h-4" />
                    <span>Seguir editando</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendToStudio(activeAsset)}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap forge-btn-press"
                  >
                    <Send className="w-4 h-4" />
                    <span>A Roblox</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right: Bill Cipher Mascot Artwork Card */}
          <div className="lg:col-span-5 flex flex-col justify-between items-center bg-slate-950/70 border border-amber-400/35 rounded-3xl p-4 sm:p-5 space-y-3.5 shadow-xl">
            <button
              type="button"
              onClick={handleCycleBillTip}
              className="group relative w-full max-w-[300px] aspect-square rounded-2xl overflow-hidden border-2 border-amber-400/50 bg-[#0B1022] shadow-lg shadow-amber-500/15 cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-300"
              title="Toca a Bill Cipher para escuchar otro consejo"
            >
              {!billImageError ? (
                <img
                  src={billCipherImg}
                  alt="Bill Cipher en el menú principal de Forge AI Studio"
                  referrerPolicy="no-referrer"
                  onError={() => setBillImageError(true)}
                  className="w-full h-full object-cover animate-bill-float group-hover:scale-105 transition-transform duration-300"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-indigo-950 to-slate-950 p-6 text-center space-y-2">
                  <svg
                    viewBox="0 0 120 120"
                    className="w-28 h-28 animate-bill-float"
                    aria-hidden="true"
                  >
                    <rect x="47" y="6" width="26" height="22" rx="3" fill="#111827" />
                    <rect x="38" y="25" width="44" height="6" rx="3" fill="#111827" />
                    <polygon
                      points="60,30 105,104 15,104"
                      fill="#FACC15"
                      stroke="#FEF08A"
                      strokeWidth="3"
                    />
                    <ellipse cx="60" cy="68" rx="16" ry="11" fill="#FFFFFF" />
                    <ellipse cx="60" cy="68" rx="4" ry="9" fill="#0F172A" />
                    <polygon points="50,86 60,91 50,96" fill="#111827" />
                    <polygon points="70,86 60,91 70,96" fill="#111827" />
                  </svg>
                  <span className="text-xs font-bold text-amber-300">Bill Cipher</span>
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
              <span className="pointer-events-none absolute bottom-2.5 inset-x-3 text-center text-xs font-bold text-amber-200">
                Toca a Bill para ver otro truco ({billTipIndex + 1}/{BILL_CIPHER_TIPS.length})
              </span>
            </button>

            {/* Interactive Speech Bubble from Bill Cipher */}
            <button
              type="button"
              onClick={handleCycleBillTip}
              className="w-full text-left bg-amber-400/10 hover:bg-amber-400/15 border border-amber-400/35 rounded-2xl px-4 py-3 flex items-start gap-2.5 cursor-pointer transition"
            >
              <MessageCircle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
              <p className="text-xs sm:text-sm text-amber-100 leading-snug font-medium">
                {BILL_CIPHER_TIPS[billTipIndex]}
              </p>
            </button>
          </div>
        </div>
      </section>

      {/* 3 Big & Simple Ways to Start */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl sm:text-2xl font-extrabold text-white">
            ¿Qué quieres hacer hoy?
          </h2>
          <span className="text-xs text-slate-400 hidden sm:inline">
            Elige cualquiera de las 3 opciones
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Option 1: Create */}
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            className="forge-card-hover group text-left cursor-pointer rounded-2xl bg-gradient-to-br from-violet-950/75 to-slate-900/95 border border-violet-500/40 hover:border-violet-400 p-5 flex flex-col justify-between space-y-4"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center text-white shadow-lg shadow-violet-600/25">
                  <Sparkles className="w-6 h-6" />
                </div>
                <span className="text-xs font-bold text-violet-300">Paso 1</span>
              </div>
              <h3 className="font-extrabold text-white text-lg group-hover:text-violet-200 transition">
                Inventar un modelo 3D
              </h3>
              <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
                Elige un árbol en 1 clic (Roble, Pino, Sauce, Bonsái) o escribe cualquier objeto que quieras crear.
              </p>
            </div>
            <div className="pt-3 border-t border-violet-500/20 flex items-center justify-between text-xs sm:text-sm font-bold text-violet-300">
              <span>Empezar a crear</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </button>

          {/* Option 2: Open from PC */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="forge-card-hover group text-left cursor-pointer rounded-2xl bg-gradient-to-br from-cyan-950/75 to-slate-900/95 border border-cyan-500/40 hover:border-cyan-400 p-5 flex flex-col justify-between space-y-4"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-cyan-600/25">
                  <Upload className="w-6 h-6" />
                </div>
                <span className="text-xs font-bold text-cyan-300">Desde tu PC</span>
              </div>
              <h3 className="font-extrabold text-white text-lg group-hover:text-cyan-200 transition">
                Subir un archivo 3D
              </h3>
              <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
                Abre un modelo guardado en tu computadora (.rbxmx, .glb u .obj) para cambiarle el tamaño o pintarlo.
              </p>
            </div>
            <div className="pt-3 border-t border-cyan-500/20 flex items-center justify-between text-xs sm:text-sm font-bold text-cyan-300">
              <span>{importingFile ? 'Abriendo archivo...' : 'Elegir archivo de mi PC'}</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </button>

          {/* Option 3: Send to Roblox */}
          <button
            type="button"
            onClick={() => setActiveTab('studio')}
            className="forge-card-hover group text-left cursor-pointer rounded-2xl bg-gradient-to-br from-emerald-950/75 to-slate-900/95 border border-emerald-500/40 hover:border-emerald-400 p-5 flex flex-col justify-between space-y-4"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg shadow-emerald-600/25">
                  <Send className="w-6 h-6" />
                </div>
                <span className="text-xs font-bold text-emerald-300">
                  {bridgeStatus.robloxStudio.connected ? 'Conectado' : 'Directo o archivo'}
                </span>
              </div>
              <h3 className="font-extrabold text-white text-lg group-hover:text-emerald-200 transition">
                Llevar a Roblox Studio
              </h3>
              <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
                Manda tus modelos directo a Roblox Studio o descarga el archivo para arrastrarlo a tu juego.
              </p>
            </div>
            <div className="pt-3 border-t border-emerald-500/20 flex items-center justify-between text-xs sm:text-sm font-bold text-emerald-300">
              <span>Abrir Roblox Studio</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </button>
        </div>
      </section>

      {/* Simplified Asset Library ("Tus Creaciones Guardadas") */}
      <section className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-white">
              Tus Creaciones Guardadas ({assetLibrary.length})
            </h2>
            <p className="text-slate-400 text-xs sm:text-sm mt-0.5">
              Toca cualquier creación para verla en 3D, pintarla o mandarla a tu mapa de Roblox.
            </p>
          </div>

          {/* Search + New Model CTA */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar por nombre..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full min-h-[40px] bg-slate-900/90 border border-slate-800 rounded-xl pl-10 pr-8 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  aria-label="Limpiar búsqueda"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={fetchAssetLibrary}
              className="min-h-[40px] min-w-[40px] p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white cursor-pointer transition flex items-center justify-center"
              title="Actualizar lista"
            >
              <RefreshCw className={`w-4 h-4 ${loadingLibrary ? 'animate-spin text-cyan-400' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-xs sm:text-sm font-bold flex items-center gap-1.5 cursor-pointer transition shrink-0 whitespace-nowrap shadow-md"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo Modelo</span>
            </button>
          </div>
        </div>

        {/* Clean Segmented Category Filter Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-900/90 p-1.5 rounded-2xl border border-slate-800 overflow-x-auto text-xs">
          {[
            { id: 'ALL', label: 'Todo' },
            { id: 'Trees & Vegetation', label: 'Árboles' },
            { id: 'Props', label: 'Objetos' },
            { id: 'Rocks & Nature', label: 'Rocas' },
            { id: 'Buildings & Structures', label: 'Edificios' },
            { id: 'Stylized Assets', label: 'Estilizados' },
          ].map((cat) => {
            const count = categoryCounts[cat.id] || 0;
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`min-h-[36px] px-3.5 py-1.5 rounded-xl font-bold transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-cyan-500 text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                }`}
              >
                <span>{cat.label}</span>
                {count > 0 && (
                  <span className={`text-[11px] tabular-nums ${isSelected ? 'text-slate-900' : 'text-slate-400'}`}>
                    ({count})
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Clean, Uncluttered Cards Grid */}
        {loadingLibrary ? (
          <div className="py-16 text-center text-slate-300 text-sm bg-slate-900/40 border border-slate-800/80 rounded-2xl">
            Buscando tus creaciones...
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-800 p-10 text-center space-y-4 bg-slate-900/30">
            <div className="space-y-1">
              <h3 className="font-bold text-white text-lg">
                {assetLibrary.length === 0
                  ? 'Todavía no tienes creaciones guardadas'
                  : 'No encontramos nada con ese nombre'}
              </h3>
              <p className="text-slate-400 text-xs sm:text-sm max-w-md mx-auto">
                {assetLibrary.length === 0
                  ? '¡Crea tu primer árbol o cofre en segundos y aparecerá aquí!'
                  : 'Prueba limpiar el buscador para ver todas tus creaciones.'}
              </p>
            </div>
            {assetLibrary.length === 0 ? (
              <button
                type="button"
                onClick={() => setActiveTab('create')}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 text-xs sm:text-sm font-extrabold inline-flex items-center gap-2 cursor-pointer transition shadow-lg"
              >
                <Sparkles className="w-4 h-4" />
                <span>Crear mi primer modelo</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('ALL');
                }}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs sm:text-sm font-bold cursor-pointer transition"
              >
                Ver todas las creaciones
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAssets.map((asset, index) => {
              const partCount = asset.parts?.length || 1;
              const isCurrentActive = activeAsset?.name === asset.name;
              const catLabel =
                CATEGORY_LABELS_ES[asset.category || 'Props'] || asset.category || 'Objetos';
              const primaryColorHex = asset.pbr_profile?.albedo_hex || '#38bdf8';

              return (
                <div
                  key={asset.name + index}
                  onClick={() => handleOpenInEditor(asset)}
                  className={`forge-card-hover group cursor-pointer rounded-2xl bg-slate-900/90 hover:bg-slate-900 border p-5 flex flex-col justify-between space-y-4 ${
                    isCurrentActive
                      ? 'border-cyan-400 shadow-lg shadow-cyan-950/40'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-2.5">
                    {/* Unboxed Clean Metadata Line */}
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full border border-white/25 shrink-0"
                          style={{ backgroundColor: primaryColorHex }}
                          title={`Color principal: ${primaryColorHex}`}
                        />
                        <span className="font-semibold text-slate-300 truncate">{catLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums shrink-0">
                          {partCount} {partCount === 1 ? 'parte' : 'partes'}
                        </span>
                      </div>

                      {isCurrentActive && (
                        <span className="text-xs font-bold text-cyan-300 shrink-0">
                          Abierto
                        </span>
                      )}
                    </div>

                    <h4
                      className="font-extrabold text-white text-base sm:text-lg group-hover:text-cyan-300 transition truncate"
                      title={asset.name}
                    >
                      {asset.name}
                    </h4>

                    <p className="text-slate-300 text-xs line-clamp-2 leading-relaxed">
                      {asset.description || 'Modelo 3D listo para editar, pintar o mandar a Roblox Studio.'}
                    </p>
                  </div>

                  {/* Clean Clear Action Buttons */}
                  <div
                    className="border-t border-slate-800/80 pt-3 flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenInEditor(asset)}
                      className="flex-1 min-h-[40px] py-2 px-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition whitespace-nowrap forge-btn-press"
                    >
                      <Box className="w-4 h-4" />
                      <span>Editar 3D</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveAsset(asset);
                        setActiveTab('materials');
                      }}
                      className="min-h-[40px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-fuchsia-600 text-slate-200 hover:text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap forge-btn-press"
                      title="Pintar colores y materiales"
                    >
                      <Palette className="w-4 h-4" />
                      <span>Pintar</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSendToStudio(asset)}
                      className="min-h-[40px] px-3 py-2 rounded-xl bg-emerald-600/25 hover:bg-emerald-500 border border-emerald-500/40 text-emerald-200 hover:text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap forge-btn-press"
                      title="Enviar directo a Roblox Studio"
                    >
                      <Send className="w-4 h-4" />
                      <span className="hidden sm:inline">Roblox</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
