import React, { useMemo, useState } from 'react';
import {
  Layers,
  Box,
  RotateCcw,
  RotateCw,
  Save,
  Download,
  Send,
  Sparkles,
  AlertTriangle,
  Move,
  Check,
  Ruler,
  ShieldCheck,
} from 'lucide-react';
import { useForge } from '../../context/ForgeContext.tsx';
import {
  MeshPart3DSpec,
  Forge3DAsset,
  subdivideMeshPartGeometry,
  smoothMeshPartGeometry,
  decimateMeshPartGeometry,
  snapAssetToGroundY0,
  smartSplitMeshPartGeometry,
  validateAndRepairDegenerateGeometry,
  exportAssetToRBXMX,
  exportAssetToGLTF,
  exportAssetToOBJWithMTL,
  generateEditableMeshLuauCode,
  resolveRgbTuple,
  computeAssetStudDimensions,
  triggerBlobDownload,
} from '../../utils/roblox3DEngine.ts';
import { validateRobloxGeometry } from '../../utils/robloxGeometryValidator.ts';
import { RobloxWorldViewport3D } from '../RobloxWorldViewport3D.tsx';
import { EditInspectorPanel } from './edit/EditInspectorPanel.tsx';

export const EditView: React.FC = () => {
  const {
    activeAsset,
    setActiveAsset,
    assetLibrary,
    selectedPart,
    setSelectedPart,
    applyAssetChange,
    undo,
    redo,
    canUndo,
    canRedo,
    undoStack,
    pendingChanges,
    saveAssetToDisk,
    pushToStudio,
    setNotification,
    setActiveTab,
  } = useForge();

  const [saving, setSaving] = useState(false);
  const [downloadDropdown, setDownloadDropdown] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const [showMeshTools, setShowMeshTools] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'viewport' | 'hierarchy' | 'inspector'>('viewport');

  const validationReport = useMemo(
    () => (activeAsset ? validateRobloxGeometry(activeAsset) : null),
    [activeAsset]
  );

  const dimensions = useMemo(
    () => (activeAsset ? computeAssetStudDimensions(activeAsset) : null),
    [activeAsset]
  );

  if (!activeAsset) {
    return (
      <div className="py-12 px-6 text-center space-y-5 max-w-xl mx-auto bg-slate-900/75 border border-cyan-500/30 rounded-3xl my-6 shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center text-white mx-auto shadow-lg shadow-cyan-500/30 animate-float">
          <Box className="w-8 h-8" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-xl font-extrabold text-white">Elige un modelo 3D para editar</h3>
          <p className="text-slate-300 text-xs leading-relaxed max-w-md mx-auto">
            Selecciona uno de tus modelos guardados aquí abajo o crea uno nuevo con el asistente.
          </p>
        </div>

        {assetLibrary.length > 0 && (
          <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4 text-left space-y-2 max-w-md mx-auto">
            <span className="text-xs font-bold text-cyan-300 block">
              Tus modelos disponibles ({assetLibrary.length}):
            </span>
            <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
              {assetLibrary.slice(0, 6).map((item) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => setActiveAsset(item)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-cyan-950/50 border border-slate-800 hover:border-cyan-500/50 flex items-center justify-between text-xs cursor-pointer transition"
                >
                  <span className="font-bold text-white truncate">{item.name}</span>
                  <span className="text-[11px] font-mono text-cyan-300 shrink-0 ml-2">
                    {item.parts?.length || 0} pzs · {(item.poly_count || 0).toLocaleString()} tris
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
            Ir a la Biblioteca
          </button>
        </div>
      </div>
    );
  }

  // --- Geometry Operations (EditableMesh) ---

  const handleSubdivide = () => {
    if (!selectedPart) return;
    try {
      const updatedPart = subdivideMeshPartGeometry(selectedPart);
      const addedTris =
        (updatedPart.meshData?.faces.length || 0) - (selectedPart.meshData?.faces.length || 0);
      const updatedAsset: Forge3DAsset = {
        ...activeAsset,
        parts: activeAsset.parts.map((p) => (p.name === selectedPart.name ? updatedPart : p)),
        poly_count: Math.max(12, activeAsset.poly_count + Math.max(0, addedTris)),
      };
      applyAssetChange(updatedAsset, `Subdividir ${selectedPart.name}`, 'subdivide');
      setNotification({
        type: 'success',
        message: 'Malla subdividida: mayor suavidad aplicada.',
      });
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Error al subdividir' });
    }
  };

  const handleDecimate = () => {
    if (!selectedPart) return;
    try {
      const updatedPart = decimateMeshPartGeometry(selectedPart, 0.4);
      const removedTris =
        (selectedPart.meshData?.faces.length || 0) - (updatedPart.meshData?.faces.length || 0);
      const updatedAsset: Forge3DAsset = {
        ...activeAsset,
        parts: activeAsset.parts.map((p) => (p.name === selectedPart.name ? updatedPart : p)),
        poly_count: Math.max(12, activeAsset.poly_count - Math.max(0, removedTris)),
      };
      applyAssetChange(updatedAsset, `Diezmar ${selectedPart.name}`, 'decimate');
      setNotification({
        type: 'success',
        message: 'Malla optimizada: menos polígonos para mayor velocidad.',
      });
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Error al diezmar' });
    }
  };

  const handleSmooth = () => {
    if (!selectedPart) return;
    try {
      const updatedPart = smoothMeshPartGeometry(selectedPart, 1, 0.35);
      const updatedAsset: Forge3DAsset = {
        ...activeAsset,
        parts: activeAsset.parts.map((p) => (p.name === selectedPart.name ? updatedPart : p)),
      };
      applyAssetChange(updatedAsset, `Suavizar normales en ${selectedPart.name}`, 'smooth');
      setNotification({
        type: 'success',
        message: 'Superficie suavizada.',
      });
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Error al suavizar' });
    }
  };

  const handleSnapGround = () => {
    try {
      const snapped = snapAssetToGroundY0(activeAsset);
      applyAssetChange(snapped, 'Alinear base al suelo Y = 0', 'ground_y0');
      setNotification({
        type: 'success',
        message: 'Modelo apoyado exactamente sobre el suelo (Y = 0).',
      });
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Error al alinear' });
    }
  };

  const handleSmartSplit = () => {
    if (!selectedPart) return;
    try {
      const { splitParts } = smartSplitMeshPartGeometry(selectedPart);
      if (splitParts.length <= 1) {
        setNotification({
          type: 'info',
          message: 'La pieza ya es una sola unidad continua.',
        });
        return;
      }
      const otherParts = activeAsset.parts.filter((p) => p.name !== selectedPart.name);
      const updatedAsset: Forge3DAsset = {
        ...activeAsset,
        parts: [...otherParts, ...splitParts],
      };
      applyAssetChange(
        updatedAsset,
        `Separar ${selectedPart.name} en ${splitParts.length} piezas`,
        'smart_split'
      );
      setNotification({
        type: 'success',
        message: `Pieza dividida en ${splitParts.length} partes.`,
      });
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Error al separar' });
    }
  };

  const handleRepairGeometry = () => {
    if (!selectedPart) {
      setNotification({
        type: 'info',
        message: 'Selecciona una pieza primero.',
      });
      return;
    }
    try {
      const { repairedPart, report } = validateAndRepairDegenerateGeometry(selectedPart);
      const updatedAsset: Forge3DAsset = {
        ...activeAsset,
        parts: activeAsset.parts.map((p) => (p.name === selectedPart.name ? repairedPart : p)),
      };
      applyAssetChange(
        updatedAsset,
        `Auto-reparar geometría en ${selectedPart.name}`,
        'repair_degenerate'
      );
      setNotification({
        type: 'success',
        message: report.isClean
          ? 'Geometría perfecta: sin errores.'
          : `Se repararon ${report.zeroAreaTriangles} caras degeneradas.`,
      });
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Error en validación' });
    }
  };

  // --- Transform Updates ---

  const handleTransformChange = (
    field: 'position' | 'rotation' | 'size',
    index: number,
    value: number
  ) => {
    if (!selectedPart) return;
    const currentArray = [...(selectedPart[field] || [0, 0, 0])];
    currentArray[index] = value;

    const updatedPart: MeshPart3DSpec = {
      ...selectedPart,
      [field]: currentArray,
    };

    const updatedAsset: Forge3DAsset = {
      ...activeAsset,
      parts: activeAsset.parts.map((p) => (p.name === selectedPart.name ? updatedPart : p)),
    };

    applyAssetChange(
      updatedAsset,
      `Modificar ${field} [${index}] de ${selectedPart.name}`,
      'transform_pos_rot'
    );
  };

  const handleResetTransform = (field: 'position_xz' | 'rotation') => {
    if (!selectedPart) return;
    const updatedPart: MeshPart3DSpec =
      field === 'position_xz'
        ? { ...selectedPart, position: [0, selectedPart.position?.[1] ?? 1, 0] }
        : { ...selectedPart, rotation: [0, 0, 0] };

    const updatedAsset: Forge3DAsset = {
      ...activeAsset,
      parts: activeAsset.parts.map((p) => (p.name === selectedPart.name ? updatedPart : p)),
    };

    applyAssetChange(
      updatedAsset,
      field === 'position_xz'
        ? `Centrar ${selectedPart.name} en X=0, Z=0`
        : `Restablecer rotación de ${selectedPart.name}`,
      'transform_pos_rot'
    );
  };

  // --- Export Actions ---

  const handleExport = (format: 'rbxmx' | 'gltf' | 'obj' | 'luau') => {
    setExportingFormat(format);
    try {
      const report = validateRobloxGeometry(activeAsset);
      if (!report.isValid) {
        throw new Error(
          `No se puede exportar modelo inválido: ${report.errors[0] || 'revisa geometría'}`
        );
      }

      const safeBase = (activeAsset.name || 'ForgeModel3D').replace(/[^a-zA-Z0-9_-]/g, '_');

      if (format === 'rbxmx') {
        const xml = exportAssetToRBXMX(activeAsset);
        if (!xml.includes('<roblox')) throw new Error('Salida .rbxmx inválida');
        triggerBlobDownload(xml, 'application/xml', `${safeBase}.rbxmx`);
        setNotification({
          type: 'success',
          message: `Archivo ${safeBase}.rbxmx descargado. ¡Arrástralo dentro de Roblox Studio!`,
        });
      } else if (format === 'gltf') {
        const gltf = exportAssetToGLTF(activeAsset);
        triggerBlobDownload(gltf, 'model/gltf+json', `${safeBase}.gltf`);
        setNotification({ type: 'success', message: `Archivo .gltf descargado.` });
      } else if (format === 'obj') {
        const { obj, mtl, objFileName, mtlFileName } = exportAssetToOBJWithMTL(activeAsset);
        triggerBlobDownload(obj, 'text/plain', objFileName);
        setTimeout(() => {
          triggerBlobDownload(mtl, 'text/plain', mtlFileName);
        }, 180);
        setNotification({
          type: 'success',
          message: `Archivos ${objFileName} + ${mtlFileName} descargados.`,
        });
      } else if (format === 'luau') {
        const luau = generateEditableMeshLuauCode(
          activeAsset.name,
          activeAsset.parts.map((p) => ({
            name: p.name,
            size: [p.size[0] ?? 2, p.size[1] ?? 2, p.size[2] ?? 2],
            position: [p.position[0] ?? 0, p.position[1] ?? 1, p.position[2] ?? 0],
            rotation: [p.rotation[0] ?? 0, p.rotation[1] ?? 0, p.rotation[2] ?? 0],
            color: resolveRgbTuple(p.color, undefined, (p as any).colorSpace || (p as any).colorFormat),
            colorSpace: 'rgb8',
            material: p.material || 'Metal',
            roughness: p.roughness ?? 0.35,
            metalness: p.metalness ?? 0.65,
            collisionFidelity: p.collisionFidelity || 'Hull',
            renderFidelity: p.renderFidelity || 'Precise',
            doubleSided: p.doubleSided,
            meshId: p.meshId,
            assetId: p.assetId,
            meshData: p.meshData,
          }))
        );
        triggerBlobDownload(luau, 'text/plain', `${safeBase}.luau`);
        setNotification({
          type: 'success',
          message: `Script ${safeBase}.luau descargado.`,
        });
      }
    } catch (err: any) {
      setNotification({ type: 'error', message: `Error al exportar: ${err.message}` });
    } finally {
      setExportingFormat(null);
      setDownloadDropdown(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    await saveAssetToDisk(true);
    setSaving(false);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] min-h-[640px] space-y-3 animate-slide-up">
      {/* Clean & Colorful Top Workspace Bar */}
      <div className="bg-slate-900/90 border border-cyan-500/30 rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0 shadow-lg">
        {/* Left: Model Title & Dimensions */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center text-white shadow-md">
            <Box className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-extrabold text-white text-sm">{activeAsset.name}</span>
              <span className="text-slate-600">·</span>
              {pendingChanges ? (
                <span className="text-[11px] text-amber-400 font-bold">
                  Sin guardar
                </span>
              ) : (
                <span className="text-[11px] text-emerald-400 font-bold flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  Guardado
                </span>
              )}
            </div>
            <div className="text-slate-400 text-[11px] font-mono tabular-nums flex flex-wrap items-center gap-2 mt-0.5">
              <span>{activeAsset.parts.length} piezas</span>
              <span>·</span>
              <span>{activeAsset.poly_count.toLocaleString()} tris</span>
              {dimensions && (
                <>
                  <span>·</span>
                  <span className="text-cyan-300 flex items-center gap-1">
                    <Ruler className="w-3 h-3" />
                    {dimensions.width} × {dimensions.height} × {dimensions.depth} studs
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Center: Simple Undo / Redo & Align to Floor */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            title={`Deshacer (${undoStack.length})`}
            className={`px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 text-xs font-semibold cursor-pointer ${
              canUndo
                ? 'text-slate-200 hover:bg-slate-800 hover:text-white'
                : 'text-slate-600 cursor-not-allowed'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Deshacer</span>
          </button>

          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            title="Rehacer"
            className={`px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 text-xs font-semibold cursor-pointer ${
              canRedo
                ? 'text-slate-200 hover:bg-slate-800 hover:text-white'
                : 'text-slate-600 cursor-not-allowed'
            }`}
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Rehacer</span>
          </button>

          <div className="w-px h-4 bg-slate-800 mx-1" />

          <button
            type="button"
            onClick={handleSnapGround}
            title="Apoyar la base del modelo exactamente sobre el suelo (Y = 0)"
            className="px-2.5 py-1.5 rounded-lg text-cyan-300 hover:bg-cyan-950/60 transition flex items-center gap-1 text-xs font-bold cursor-pointer"
          >
            <Move className="w-3.5 h-3.5 text-cyan-400" />
            <span>Poner en Suelo (Y=0)</span>
          </button>
        </div>

        {/* Right: Download, Save & Send to Roblox */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              disabled={Boolean(exportingFormat)}
              onClick={() => setDownloadDropdown(!downloadDropdown)}
              className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition border border-slate-700"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Descargar</span>
            </button>

            {downloadDropdown && (
              <div className="absolute right-0 mt-1 w-52 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl py-1.5 z-50 text-xs text-slate-200">
                <button
                  type="button"
                  onClick={() => handleExport('rbxmx')}
                  className="w-full px-3.5 py-2 text-left hover:bg-slate-800 flex items-center justify-between cursor-pointer font-semibold"
                >
                  <span>Roblox (.rbxmx)</span>
                  <span className="text-[10px] text-emerald-400 font-bold">Recomendado</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('gltf')}
                  className="w-full px-3.5 py-2 text-left hover:bg-slate-800 cursor-pointer"
                >
                  <span>Blender / 3D (.gltf)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('obj')}
                  className="w-full px-3.5 py-2 text-left hover:bg-slate-800 cursor-pointer"
                >
                  <span>Wavefront (.obj + .mtl)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('luau')}
                  className="w-full px-3.5 py-2 text-left hover:bg-slate-800 cursor-pointer"
                >
                  <span>Script Luau (.luau)</span>
                </button>
              </div>
            )}
          </div>

          {pendingChanges && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? '...' : 'Guardar'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => pushToStudio(activeAsset)}
            className="py-2 px-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition shadow-md shadow-emerald-600/20"
          >
            <Send className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Enviar a Roblox</span>
          </button>
        </div>
      </div>

      {/* Responsive Mobile/Tablet Panel Switcher */}
      <div className="flex md:hidden items-center gap-1.5 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800 shrink-0">
        <button
          type="button"
          onClick={() => setMobilePanel('viewport')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
            mobilePanel === 'viewport' ? 'bg-cyan-600 text-white' : 'text-slate-400'
          }`}
        >
          Visor 3D
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel('hierarchy')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
            mobilePanel === 'hierarchy' ? 'bg-cyan-600 text-white' : 'text-slate-400'
          }`}
        >
          Piezas ({activeAsset.parts.length})
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel('inspector')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
            mobilePanel === 'inspector' ? 'bg-cyan-600 text-white' : 'text-slate-400'
          }`}
        >
          Ajustes
        </button>
      </div>

      {/* Main Split Layout: Left Parts List | Center 3D Viewport | Right Simple Inspector */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 min-h-0">
        {/* LEFT COLUMN: Clean Parts List */}
        <div
          className={`md:col-span-3 lg:col-span-3 flex-col bg-slate-900/85 border border-slate-800 rounded-2xl p-3.5 overflow-hidden ${
            mobilePanel === 'hierarchy' ? 'flex' : 'hidden md:flex'
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-2">
            <span className="font-bold text-xs text-white flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>Piezas del Modelo</span>
            </span>
            <span className="text-[11px] font-mono tabular-nums text-cyan-300 font-bold">
              {activeAsset.parts.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 text-xs">
            {activeAsset.parts.map((part, index) => {
              const isSelected = selectedPart?.name === part.name;
              const rgb = resolveRgbTuple(part.color, undefined, (part as any).colorSpace || (part as any).colorFormat);
              return (
                <div
                  key={part.name + index}
                  onClick={() => {
                    setSelectedPart(part);
                    if (mobilePanel === 'hierarchy') setMobilePanel('inspector');
                  }}
                  className={`p-2.5 rounded-xl cursor-pointer transition flex items-center justify-between ${
                    isSelected
                      ? 'bg-gradient-to-r from-cyan-950/90 to-indigo-950/80 text-white border border-cyan-400/70 font-bold shadow-sm'
                      : 'hover:bg-slate-800/70 text-slate-300 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className="w-3 h-3 rounded-full border border-white/30 shrink-0"
                      style={{ backgroundColor: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` }}
                    />
                    <span className="truncate">{part.name}</span>
                  </div>
                  <span className="text-[10px] font-mono tabular-nums text-slate-400 shrink-0 ml-1">
                    {part.material}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Simple Validation Badge */}
          {validationReport && (
            <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
              <span className="text-slate-400 flex items-center gap-1.5">
                {validationReport.isValid ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                )}
                <span>{validationReport.isValid ? 'Listo para Roblox' : 'Revisar malla'}</span>
              </span>
              <button
                type="button"
                onClick={handleRepairGeometry}
                className="text-cyan-400 hover:text-cyan-300 font-bold cursor-pointer"
              >
                Reparar
              </button>
            </div>
          )}
        </div>

        {/* CENTER COLUMN: Interactive 3D Viewport */}
        <div
          className={`col-span-1 md:col-span-6 lg:col-span-6 rounded-2xl overflow-hidden border border-slate-800 bg-black/80 relative flex-col ${
            mobilePanel === 'viewport' ? 'flex' : 'hidden md:flex'
          }`}
        >
          <RobloxWorldViewport3D
            asset={activeAsset}
            onPartSelected={(part) => {
              if (part) setSelectedPart(part);
            }}
          />
        </div>

        {/* RIGHT COLUMN: Clean Inspector + Collapsible Advanced Mesh Tools */}
        <EditInspectorPanel
          selectedPart={selectedPart}
          showMeshTools={showMeshTools}
          onToggleMeshTools={() => setShowMeshTools(!showMeshTools)}
          onTransformChange={handleTransformChange}
          onResetTransform={handleResetTransform}
          onOpenMaterials={() => setActiveTab('materials')}
          onSubdivide={handleSubdivide}
          onDecimate={handleDecimate}
          onSmooth={handleSmooth}
          onSmartSplit={handleSmartSplit}
          isVisibleMobile={mobilePanel === 'inspector'}
        />
      </div>
    </div>
  );
};
