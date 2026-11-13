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
  Scissors,
  Wand2,
  Minimize2,
  CheckCircle2,
  AlertTriangle,
  Move,
  Check,
  GitCompare,
  Ruler,
  ShieldCheck,
  X,
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
} from '../../utils/roblox3DEngine.ts';
import { validateRobloxGeometry } from '../../utils/robloxGeometryValidator.ts';
import { RobloxWorldViewport3D } from '../RobloxWorldViewport3D.tsx';
import { HelpTooltip, FORGE_GLOSSARY } from '../common/HelpTooltip.tsx';

function computeAssetStudDimensions(asset: Forge3DAsset): {
  width: number;
  height: number;
  depth: number;
  minY: number;
  maxY: number;
} {
  if (!asset.parts || asset.parts.length === 0) {
    return { width: 0, height: 0, depth: 0, minY: 0, maxY: 0 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const part of asset.parts) {
    const [px = 0, py = 0, pz = 0] = part.position || [0, 0, 0];
    const [sx = 2, sy = 2, sz = 2] = part.size || [2, 2, 2];
    const verts = part.meshData?.vertices || [];
    if (verts.length > 0) {
      for (const v of verts) {
        const vx = px + Number(v[0] ?? 0);
        const vy = py + Number(v[1] ?? 0);
        const vz = pz + Number(v[2] ?? 0);
        if (vx < minX) minX = vx;
        if (vx > maxX) maxX = vx;
        if (vy < minY) minY = vy;
        if (vy > maxY) maxY = vy;
        if (vz < minZ) minZ = vz;
        if (vz > maxZ) maxZ = vz;
      }
    } else {
      minX = Math.min(minX, px - sx / 2);
      maxX = Math.max(maxX, px + sx / 2);
      minY = Math.min(minY, py - sy / 2);
      maxY = Math.max(maxY, py + sy / 2);
      minZ = Math.min(minZ, pz - sz / 2);
      maxZ = Math.max(maxZ, pz + sz / 2);
    }
  }

  return {
    width: Number(Math.max(0, maxX - minX).toFixed(2)),
    height: Number(Math.max(0, maxY - minY).toFixed(2)),
    depth: Number(Math.max(0, maxZ - minZ).toFixed(2)),
    minY: Number((Number.isFinite(minY) ? minY : 0).toFixed(2)),
    maxY: Number((Number.isFinite(maxY) ? maxY : 0).toFixed(2)),
  };
}

function triggerBlobDownload(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const EditView: React.FC = () => {
  const {
    activeAsset,
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
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareTargetId, setCompareTargetId] = useState<string>('');
  const [compareLodLevel, setCompareLodLevel] = useState<0 | 1 | 2>(1);

  const validationReport = useMemo(
    () => (activeAsset ? validateRobloxGeometry(activeAsset) : null),
    [activeAsset]
  );

  const dimensions = useMemo(
    () => (activeAsset ? computeAssetStudDimensions(activeAsset) : null),
    [activeAsset]
  );

  const comparisonTarget = useMemo(() => {
    if (!activeAsset) return null;
    if (compareTargetId && compareTargetId !== 'lod_preview') {
      return assetLibrary.find((a) => (a.id || a.name) === compareTargetId) || null;
    }
    return null;
  }, [activeAsset, assetLibrary, compareTargetId]);

  const lodVariantStats = useMemo(() => {
    if (!activeAsset) return null;
    let totalVerts = 0;
    let totalTris = 0;
    for (const p of activeAsset.parts || []) {
      const lods = p.meshData?.lodLevels || [];
      const found = lods.find((l) => l.level === compareLodLevel);
      if (found) {
        totalVerts += found.vertexCount;
        totalTris += found.triangleCount;
      } else {
        totalVerts += p.meshData?.vertices?.length || 0;
        totalTris += p.meshData?.faces?.length || 12;
      }
    }
    return { totalVerts, totalTris };
  }, [activeAsset, compareLodLevel]);

  if (!activeAsset) {
    return (
      <div className="py-20 text-center space-y-4 max-w-md mx-auto">
        <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 mx-auto">
          <Box className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-white">No hay modelo cargado para editar</h3>
        <p className="text-slate-400 text-xs leading-relaxed">
          Selecciona un modelo desde la pantalla de Inicio o crea uno nuevo con el asistente de IA.
        </p>
        <button
          type="button"
          onClick={() => setActiveTab('create')}
          className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition"
        >
          <Sparkles className="w-4 h-4" />
          <span>Crear un nuevo modelo</span>
        </button>
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
        message: 'Malla subdividida: resolución aumentada para mayor suavidad.',
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
        message: 'Malla optimizada: polígonos reducidos para mejor rendimiento.',
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
        message: 'Normales y curvatura suavizadas para iluminación continua.',
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
        message: 'Base del modelo colocada exactamente en el plano del suelo (Y = 0 studs).',
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
          message: 'La pieza ya es monolítica y no contiene componentes geométricos desconectados.',
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
        message: `Pieza dividida en ${splitParts.length} partes lógicas separadas.`,
      });
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Error al separar' });
    }
  };

  const handleRepairGeometry = () => {
    if (!selectedPart) {
      setNotification({
        type: 'info',
        message: 'Selecciona una pieza para validar y reparar su geometría.',
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
        `Validar y auto-reparar geometría en ${selectedPart.name}`,
        'repair_degenerate'
      );
      setNotification({
        type: 'success',
        message: report.isClean
          ? 'Geometría limpia: sin caras degeneradas.'
          : `Reparación completa: ${report.zeroAreaTriangles} caras degeneradas reparadas.`,
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
        setNotification({ type: 'success', message: `Archivo .rbxmx descargado correctamente.` });
      } else if (format === 'gltf') {
        const gltf = exportAssetToGLTF(activeAsset);
        triggerBlobDownload(gltf, 'model/gltf+json', `${safeBase}.gltf`);
        setNotification({ type: 'success', message: `Archivo .gltf descargado correctamente.` });
      } else if (format === 'obj') {
        const { obj, mtl, objFileName, mtlFileName } = exportAssetToOBJWithMTL(activeAsset);
        triggerBlobDownload(obj, 'text/plain', objFileName);
        setTimeout(() => {
          triggerBlobDownload(mtl, 'text/plain', mtlFileName);
        }, 180);
        setNotification({
          type: 'success',
          message: `Paquete Wavefront ${objFileName} + ${mtlFileName} descargado.`,
        });
      } else if (format === 'luau') {
        const luau = generateEditableMeshLuauCode(
          activeAsset.name,
          activeAsset.parts.map((p) => ({
            name: p.name,
            size: [p.size[0] ?? 2, p.size[1] ?? 2, p.size[2] ?? 2],
            position: [p.position[0] ?? 0, p.position[1] ?? 1, p.position[2] ?? 0],
            rotation: [p.rotation[0] ?? 0, p.rotation[1] ?? 0, p.rotation[2] ?? 0],
            color: resolveRgbTuple(p.color),
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
          message: `Script EditableMesh ${safeBase}.luau descargado correctamente.`,
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
    <div className="flex flex-col h-[calc(100vh-140px)] min-h-[640px] space-y-3 animate-in fade-in duration-200">
      {/* Top Workspace Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
        {/* Model Title, Dimensions & Validation Status */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center text-cyan-400">
            <Box className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-white text-sm">{activeAsset.name}</span>
              {pendingChanges ? (
                <span className="text-[10px] text-amber-400 bg-amber-950/40 border border-amber-800/40 px-2 py-0.5 rounded-full">
                  Cambios sin guardar
                </span>
              ) : (
                <span className="text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  Guardado
                </span>
              )}
              {validationReport && (
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                    validationReport.isValid
                      ? 'text-emerald-300 bg-emerald-950/50 border-emerald-700/50'
                      : 'text-red-300 bg-red-950/50 border-red-700/50'
                  }`}
                >
                  {validationReport.isValid ? (
                    <ShieldCheck className="w-3 h-3" />
                  ) : (
                    <AlertTriangle className="w-3 h-3" />
                  )}
                  {validationReport.isValid
                    ? 'Geometría Válida'
                    : `${validationReport.errors.length} Errores`}
                </span>
              )}
            </div>
            <div className="text-slate-400 text-[11px] font-mono flex flex-wrap items-center gap-2 mt-0.5">
              <span>{activeAsset.parts.length} piezas</span>
              <span>•</span>
              <span>{(validationReport?.totalVertices ?? 0).toLocaleString()} vértices</span>
              <span>•</span>
              <span>{activeAsset.poly_count.toLocaleString()} triángulos</span>
              {dimensions && (
                <>
                  <span>•</span>
                  <span className="text-cyan-300 flex items-center gap-1">
                    <Ruler className="w-3 h-3" />
                    {dimensions.width} × {dimensions.height} × {dimensions.depth} studs
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Center: Undo / Redo & Ground Snap & Variant Compare */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            title={`Deshacer (${undoStack.length} disponibles)`}
            className={`p-1.5 rounded-md transition flex items-center gap-1 text-xs cursor-pointer ${
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
            className={`p-1.5 rounded-md transition flex items-center gap-1 text-xs cursor-pointer ${
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
            title="Colocar la base del modelo exactamente en el suelo (Y = 0)"
            className="p-1.5 rounded-md text-slate-300 hover:text-cyan-300 hover:bg-slate-800 transition flex items-center gap-1 text-xs cursor-pointer"
          >
            <Move className="w-3.5 h-3.5 text-cyan-400" />
            <span>Alinear al suelo</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCompareModal(true)}
            title="Comparar métricas entre variantes / LODs / modelos guardados"
            className="p-1.5 rounded-md text-slate-300 hover:text-purple-300 hover:bg-slate-800 transition flex items-center gap-1 text-xs cursor-pointer"
          >
            <GitCompare className="w-3.5 h-3.5 text-purple-400" />
            <span className="hidden lg:inline">Comparar Variantes</span>
          </button>
        </div>

        {/* Right: Save, Export & Push */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              disabled={Boolean(exportingFormat)}
              onClick={() => setDownloadDropdown(!downloadDropdown)}
              className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer transition border border-slate-700"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar</span>
            </button>

            {downloadDropdown && (
              <div className="absolute right-0 mt-1 w-48 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl py-1 z-50 text-xs text-slate-200">
                <button
                  type="button"
                  onClick={() => handleExport('rbxmx')}
                  className="w-full px-3 py-2 text-left hover:bg-slate-800 flex items-center justify-between cursor-pointer"
                >
                  <span>Roblox (.rbxmx)</span>
                  <span className="text-[10px] text-cyan-400 font-mono">Recomendado</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('luau')}
                  className="w-full px-3 py-2 text-left hover:bg-slate-800 cursor-pointer"
                >
                  <span>EditableMesh (.luau)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('gltf')}
                  className="w-full px-3 py-2 text-left hover:bg-slate-800 cursor-pointer"
                >
                  <span>glTF 2.0 (.gltf)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('obj')}
                  className="w-full px-3 py-2 text-left hover:bg-slate-800 cursor-pointer"
                >
                  <span>Wavefront (.obj + .mtl)</span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="py-1.5 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition shadow-sm"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Guardando...' : 'Guardar'}</span>
          </button>

          <button
            type="button"
            onClick={() => pushToStudio(activeAsset)}
            className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition shadow-sm"
          >
            <Send className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Enviar a Studio</span>
          </button>
        </div>
      </div>

      {/* Main Split Layout: Left Hierarchy | Center 3D Viewport | Right Inspector */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 min-h-0">
        {/* LEFT COLUMN */}
        <div className="hidden md:flex md:col-span-3 lg:col-span-3 flex-col bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
            <span className="font-semibold text-xs text-white flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>Jerarquía de Partes</span>
            </span>
            <span className="text-[11px] font-mono text-slate-500">
              {activeAsset.parts.length} piezas
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 pr-1 text-xs">
            {activeAsset.parts.map((part, index) => {
              const isSelected = selectedPart?.name === part.name;
              return (
                <div
                  key={part.name + index}
                  onClick={() => setSelectedPart(part)}
                  className={`p-2 rounded-lg cursor-pointer transition flex items-center justify-between ${
                    isSelected
                      ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-800/80 font-medium'
                      : 'hover:bg-slate-800/70 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Box
                      className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-cyan-400' : 'text-slate-500'}`}
                    />
                    <span className="truncate">{part.name}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 shrink-0 ml-1">
                    {part.meshData?.faces?.length ? `${part.meshData.faces.length}t` : part.shape}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Geometry Validation Status Card */}
          {validationReport && (
            <div className="mt-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300">Validación Roblox Studio</span>
                {validationReport.isValid ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                )}
              </div>
              <div className="text-slate-400 font-mono">
                {validationReport.isValid
                  ? `EditableMesh OK (${validationReport.totalVertices}v / ${validationReport.totalTriangles}t)`
                  : validationReport.errors[0]}
              </div>
              {validationReport.warnings.length > 0 && (
                <div className="text-amber-300 font-mono truncate" title={validationReport.warnings[0]}>
                  Aviso: {validationReport.warnings[0]}
                </div>
              )}
            </div>
          )}

          {/* Quick Repair */}
          <div className="pt-2 border-t border-slate-800 flex gap-2 mt-2">
            <button
              type="button"
              onClick={handleRepairGeometry}
              className="flex-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] flex items-center justify-center gap-1 cursor-pointer transition"
              title="Detectar y corregir caras degeneradas"
            >
              <Wand2 className="w-3 h-3 text-cyan-400" />
              <span>Auto-Reparar</span>
            </button>
          </div>
        </div>

        {/* CENTER COLUMN */}
        <div className="col-span-1 md:col-span-6 lg:col-span-6 rounded-xl overflow-hidden border border-slate-800 bg-black/80 relative flex flex-col">
          <RobloxWorldViewport3D
            asset={activeAsset}
            onPartSelected={(part) => {
              if (part) setSelectedPart(part);
            }}
          />
        </div>

        {/* RIGHT COLUMN */}
        <div className="hidden md:flex md:col-span-3 lg:col-span-3 flex-col bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 overflow-y-auto space-y-4">
          {selectedPart ? (
            <>
              <div className="border-b border-slate-800 pb-2">
                <span className="text-[10px] uppercase tracking-wider text-cyan-400 font-bold block">
                  Pieza Seleccionada
                </span>
                <h4 className="font-bold text-white text-sm truncate mt-0.5">
                  {selectedPart.name}
                </h4>
                <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                  <span>Forma: {selectedPart.shape}</span>
                  <span>•</span>
                  <span>{selectedPart.material}</span>
                </div>
              </div>

              <div className="space-y-3">
                <span className="text-xs font-semibold text-slate-200 block">
                  Transformación
                </span>

                <div className="space-y-1">
                  <span className="text-[11px] text-slate-400 block">Posición (X, Y, Z studs):</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['X', 'Y', 'Z'].map((axis, i) => (
                      <div
                        key={axis}
                        className="flex items-center bg-slate-950 border border-slate-800 rounded px-1.5 py-1"
                      >
                        <span className="text-[10px] font-mono text-slate-500 mr-1">{axis}</span>
                        <input
                          type="number"
                          step="0.5"
                          value={selectedPart.position?.[i] ?? 0}
                          onChange={(e) =>
                            handleTransformChange('position', i, parseFloat(e.target.value) || 0)
                          }
                          className="w-full bg-transparent text-xs text-white focus:outline-none text-right font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] text-slate-400 block">Rotación (grados):</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['X', 'Y', 'Z'].map((axis, i) => (
                      <div
                        key={axis}
                        className="flex items-center bg-slate-950 border border-slate-800 rounded px-1.5 py-1"
                      >
                        <span className="text-[10px] font-mono text-slate-500 mr-1">{axis}</span>
                        <input
                          type="number"
                          step="15"
                          value={selectedPart.rotation?.[i] ?? 0}
                          onChange={(e) =>
                            handleTransformChange('rotation', i, parseFloat(e.target.value) || 0)
                          }
                          className="w-full bg-transparent text-xs text-white focus:outline-none text-right font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] text-slate-400 block">Tamaño (studs):</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['X', 'Y', 'Z'].map((axis, i) => (
                      <div
                        key={axis}
                        className="flex items-center bg-slate-950 border border-slate-800 rounded px-1.5 py-1"
                      >
                        <span className="text-[10px] font-mono text-slate-500 mr-1">{axis}</span>
                        <input
                          type="number"
                          step="0.5"
                          min="0.1"
                          value={selectedPart.size?.[i] ?? 1}
                          onChange={(e) =>
                            handleTransformChange(
                              'size',
                              i,
                              Math.max(0.1, parseFloat(e.target.value) || 0.1)
                            )
                          }
                          className="w-full bg-transparent text-xs text-white focus:outline-none text-right font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">
                    Herramientas de Geometría
                  </span>
                  <HelpTooltip
                    term={FORGE_GLOSSARY.editableMesh.term}
                    explanation={FORGE_GLOSSARY.editableMesh.explanation}
                    variant="badge"
                  />
                </div>

                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={handleSubdivide}
                    className="w-full p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-left transition flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                      <div>
                        <span className="text-xs font-medium text-slate-200 block">
                          Subdividir superficie
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          Aumenta suavidad (más polígonos)
                        </span>
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={handleDecimate}
                    className="w-full p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-left transition flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Minimize2 className="w-3.5 h-3.5 text-blue-400" />
                      <div>
                        <span className="text-xs font-medium text-slate-200 block">
                          Diezmar / Optimizar
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          Reduce polígonos para evitar lag
                        </span>
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={handleSmooth}
                    className="w-full p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-left transition flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Wand2 className="w-3.5 h-3.5 text-emerald-400" />
                      <div>
                        <span className="text-xs font-medium text-slate-200 block">
                          Suavizar normales
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          Aspecto continuo sin facetas duras
                        </span>
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={handleSmartSplit}
                    className="w-full p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-left transition flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Scissors className="w-3.5 h-3.5 text-amber-400" />
                      <div>
                        <span className="text-xs font-medium text-slate-200 block">
                          Separar partes lógicas
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          Descompone mallas desconectadas
                        </span>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-slate-500 text-xs">
              Haz clic en cualquier pieza en el visor 3D o en la jerarquía para ver y modificar sus propiedades.
            </div>
          )}
        </div>
      </div>

      {/* Variant & LOD Comparison Modal */}
      {showCompareModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <GitCompare className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-bold text-white">
                  Comparador de Variantes y Presupuesto LOD
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCompareModal(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">
                  Comparar contra variante guardada o LOD:
                </label>
                <select
                  value={compareTargetId || 'lod_preview'}
                  onChange={(e) => setCompareTargetId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white"
                >
                  <option value="lod_preview">Variante LOD del modelo actual</option>
                  {assetLibrary
                    .filter((a) => (a.id || a.name) !== (activeAsset.id || activeAsset.name))
                    .map((a) => (
                      <option key={a.id || a.name} value={a.id || a.name}>
                        {a.name} ({a.poly_count} tris)
                      </option>
                    ))}
                </select>
              </div>

              {(!compareTargetId || compareTargetId === 'lod_preview') && (
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    Nivel LOD a comparar:
                  </label>
                  <select
                    value={compareLodLevel}
                    onChange={(e) => setCompareLodLevel(Number(e.target.value) as 0 | 1 | 2)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white"
                  >
                    <option value={0}>LOD 0 (Máximo detalle)</option>
                    <option value={1}>LOD 1 (Medio / Equilibrado)</option>
                    <option value={2}>LOD 2 (Bajo / Rendimiento)</option>
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-slate-950 border border-cyan-800/50 space-y-1.5">
                <div className="text-[11px] font-bold text-cyan-400">
                  Activo: {activeAsset.name}
                </div>
                <div className="font-mono text-slate-300">
                  Piezas: {activeAsset.parts.length}
                </div>
                <div className="font-mono text-slate-300">
                  Vértices: {(validationReport?.totalVertices ?? 0).toLocaleString()}
                </div>
                <div className="font-mono text-slate-300">
                  Triángulos: {(validationReport?.totalTriangles ?? activeAsset.poly_count).toLocaleString()}
                </div>
                <div className="font-mono text-slate-400">
                  Dimensiones: {dimensions?.width} × {dimensions?.height} × {dimensions?.depth} studs
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-purple-800/50 space-y-1.5">
                {comparisonTarget ? (
                  <>
                    <div className="text-[11px] font-bold text-purple-400">
                      Biblioteca: {comparisonTarget.name}
                    </div>
                    <div className="font-mono text-slate-300">
                      Piezas: {comparisonTarget.parts?.length || 0}
                    </div>
                    <div className="font-mono text-slate-300">
                      Vértices:{' '}
                      {(
                        comparisonTarget.parts?.reduce(
                          (acc: number, p: MeshPart3DSpec) => acc + (p.meshData?.vertices?.length || 0),
                          0
                        ) || 0
                      ).toLocaleString()}
                    </div>
                    <div className="font-mono text-slate-300">
                      Triángulos: {(comparisonTarget.poly_count || 0).toLocaleString()}
                    </div>
                    <div className="font-mono text-slate-400">
                      Delta tris:{' '}
                      {(comparisonTarget.poly_count || 0) -
                        (validationReport?.totalTriangles ?? activeAsset.poly_count)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-[11px] font-bold text-purple-400">
                      LOD {compareLodLevel} ({activeAsset.name})
                    </div>
                    <div className="font-mono text-slate-300">
                      Piezas: {activeAsset.parts.length}
                    </div>
                    <div className="font-mono text-slate-300">
                      Vértices: {(lodVariantStats?.totalVerts ?? 0).toLocaleString()}
                    </div>
                    <div className="font-mono text-slate-300">
                      Triángulos: {(lodVariantStats?.totalTris ?? 0).toLocaleString()}
                    </div>
                    <div className="font-mono text-emerald-400">
                      Reducción:{' '}
                      {validationReport && validationReport.totalTriangles > 0
                        ? `${Math.max(
                            0,
                            Math.round(
                              (1 -
                                (lodVariantStats?.totalTris ?? 0) /
                                  validationReport.totalTriangles) *
                                100
                            )
                          )}% menos polígonos`
                        : '0%'}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
