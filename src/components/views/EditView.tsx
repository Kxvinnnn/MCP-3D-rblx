import React, { useState } from 'react';
import {
  Layers,
  Box,
  Sliders,
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
  Maximize,
  Compass,
  Eye,
  Check,
} from 'lucide-react';
import { useForge } from '../../context/ForgeContext.tsx';
import {
  MeshPart3DSpec,
  Forge3DAsset,
  subdivideMeshPartGeometry,
  smoothMeshPartGeometry,
  decimateMeshPartGeometry,
  recomputeNormalsAndBoxUVs,
  snapAssetToGroundY0,
  smartSplitMeshPartGeometry,
  validateAndRepairDegenerateGeometry,
  exportAssetToRBXMX,
  exportAssetToGLTF,
  exportAssetToOBJWithMTL,
} from '../../utils/roblox3DEngine.ts';
import { RobloxWorldViewport3D } from '../RobloxWorldViewport3D.tsx';
import { HelpTooltip, FORGE_GLOSSARY } from '../common/HelpTooltip.tsx';

export const EditView: React.FC = () => {
  const {
    activeAsset,
    setActiveAsset,
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
      const addedTris = (updatedPart.meshData?.faces.length || 0) - (selectedPart.meshData?.faces.length || 0);
      const updatedAsset: Forge3DAsset = {
        ...activeAsset,
        parts: activeAsset.parts.map((p) => (p.name === selectedPart.name ? updatedPart : p)),
        poly_count: Math.max(100, activeAsset.poly_count + Math.max(0, addedTris)),
      };
      applyAssetChange(
        updatedAsset,
        `Subdividir ${selectedPart.name}`,
        'subdivide'
      );
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
      const removedTris = (selectedPart.meshData?.faces.length || 0) - (updatedPart.meshData?.faces.length || 0);
      const updatedAsset: Forge3DAsset = {
        ...activeAsset,
        parts: activeAsset.parts.map((p) => (p.name === selectedPart.name ? updatedPart : p)),
        poly_count: Math.max(100, activeAsset.poly_count - Math.max(0, removedTris)),
      };
      applyAssetChange(
        updatedAsset,
        `Diezmar ${selectedPart.name}`,
        'decimate'
      );
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
      const updatedPart = smoothMeshPartGeometry(selectedPart, 0.35);
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
      setNotification({ type: 'info', message: 'Selecciona una pieza para validar y reparar su geometría.' });
      return;
    }
    try {
      const { repairedPart, report } = validateAndRepairDegenerateGeometry(selectedPart);
      const updatedAsset: Forge3DAsset = {
        ...activeAsset,
        parts: activeAsset.parts.map((p) => (p.name === selectedPart.name ? repairedPart : p)),
      };
      applyAssetChange(updatedAsset, `Validar y auto-reparar geometría en ${selectedPart.name}`, 'repair_degenerate');
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

  const handleExport = (format: 'rbxmx' | 'gltf' | 'obj') => {
    setExportingFormat(format);
    try {
      if (format === 'rbxmx') {
        const xml = exportAssetToRBXMX(activeAsset);
        const blob = new Blob([xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activeAsset.name}.rbxmx`;
        a.click();
      } else if (format === 'gltf') {
        const gltf = exportAssetToGLTF(activeAsset);
        const blob = new Blob([JSON.stringify(gltf, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activeAsset.name}.gltf`;
        a.click();
      } else if (format === 'obj') {
        const { obj, mtl } = exportAssetToOBJWithMTL(activeAsset);
        const objBlob = new Blob([obj], { type: 'text/plain' });
        const objUrl = URL.createObjectURL(objBlob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = `${activeAsset.name}.obj`;
        a.click();
      }
      setNotification({ type: 'success', message: `Archivo .${format} descargado correctamente.` });
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
        {/* Model Title & Pending State */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center text-cyan-400">
            <Box className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
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
            </div>
            <div className="text-slate-400 text-[11px] font-mono">
              {activeAsset.parts.length} piezas • {activeAsset.poly_count.toLocaleString()} triángulos
            </div>
          </div>
        </div>

        {/* Center: Undo / Redo & Ground Snap */}
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
        </div>

        {/* Right: Save, Export & Push */}
        <div className="flex items-center gap-2">
          {/* Export Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setDownloadDropdown(!downloadDropdown)}
              className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer transition border border-slate-700"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar</span>
            </button>

            {downloadDropdown && (
              <div className="absolute right-0 mt-1 w-44 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl py-1 z-50 text-xs text-slate-200">
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

          {/* Save to Rojo */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="py-1.5 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition shadow-sm"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Guardando...' : 'Guardar'}</span>
          </button>

          {/* Direct Push to Studio */}
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

      {/* Main Split Layout: Left Hierarchy (20%) | Center 3D Viewport (60%) | Right Inspector (20%) */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 min-h-0">
        {/* LEFT COLUMN: Part Hierarchy Tree (2.5 cols / ~20%) */}
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
                    <Box className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-cyan-400' : 'text-slate-500'}`} />
                    <span className="truncate">{part.name}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 shrink-0 ml-1">
                    {part.shape}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Quick Add Part or Repair */}
          <div className="pt-2 border-t border-slate-800 flex gap-2">
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

        {/* CENTER COLUMN: Dominant 3D Viewport (6 cols / ~60%) */}
        <div className="col-span-1 md:col-span-6 lg:col-span-6 rounded-xl overflow-hidden border border-slate-800 bg-black/80 relative flex flex-col">
          <RobloxWorldViewport3D
            asset={activeAsset}
            onPartSelected={(part) => {
              if (part) setSelectedPart(part);
            }}
          />
        </div>

        {/* RIGHT COLUMN: Inspector & EditableMesh Tools (3.5 cols / ~20%) */}
        <div className="hidden md:flex md:col-span-3 lg:col-span-3 flex-col bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 overflow-y-auto space-y-4">
          {selectedPart ? (
            <>
              {/* Part Header */}
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

              {/* Transform Controls: Position, Rotation, Size */}
              <div className="space-y-3">
                <span className="text-xs font-semibold text-slate-200 block">
                  Transformación
                </span>

                {/* Position */}
                <div className="space-y-1">
                  <span className="text-[11px] text-slate-400 block">Posición (X, Y, Z studs):</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['X', 'Y', 'Z'].map((axis, i) => (
                      <div key={axis} className="flex items-center bg-slate-950 border border-slate-800 rounded px-1.5 py-1">
                        <span className="text-[10px] font-mono text-slate-500 mr-1">{axis}</span>
                        <input
                          type="number"
                          step="0.5"
                          value={selectedPart.position?.[i] ?? 0}
                          onChange={(e) => handleTransformChange('position', i, parseFloat(e.target.value) || 0)}
                          className="w-full bg-transparent text-xs text-white focus:outline-none text-right font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Rotation */}
                <div className="space-y-1">
                  <span className="text-[11px] text-slate-400 block">Rotación (grados):</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['X', 'Y', 'Z'].map((axis, i) => (
                      <div key={axis} className="flex items-center bg-slate-950 border border-slate-800 rounded px-1.5 py-1">
                        <span className="text-[10px] font-mono text-slate-500 mr-1">{axis}</span>
                        <input
                          type="number"
                          step="15"
                          value={selectedPart.rotation?.[i] ?? 0}
                          onChange={(e) => handleTransformChange('rotation', i, parseFloat(e.target.value) || 0)}
                          className="w-full bg-transparent text-xs text-white focus:outline-none text-right font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Size */}
                <div className="space-y-1">
                  <span className="text-[11px] text-slate-400 block">Tamaño (studs):</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['X', 'Y', 'Z'].map((axis, i) => (
                      <div key={axis} className="flex items-center bg-slate-950 border border-slate-800 rounded px-1.5 py-1">
                        <span className="text-[10px] font-mono text-slate-500 mr-1">{axis}</span>
                        <input
                          type="number"
                          step="0.5"
                          min="0.1"
                          value={selectedPart.size?.[i] ?? 1}
                          onChange={(e) => handleTransformChange('size', i, Math.max(0.1, parseFloat(e.target.value) || 0.1))}
                          className="w-full bg-transparent text-xs text-white focus:outline-none text-right font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* EditableMesh Geometry Tools */}
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
                  {/* Subdivide */}
                  <button
                    type="button"
                    onClick={handleSubdivide}
                    className="w-full p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-left transition flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                      <div>
                        <span className="text-xs font-medium text-slate-200 block">Subdividir superficie</span>
                        <span className="text-[10px] text-slate-500 block">Aumenta suavidad (más polígonos)</span>
                      </div>
                    </div>
                  </button>

                  {/* Decimate */}
                  <button
                    type="button"
                    onClick={handleDecimate}
                    className="w-full p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-left transition flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Minimize2 className="w-3.5 h-3.5 text-blue-400" />
                      <div>
                        <span className="text-xs font-medium text-slate-200 block">Diezmar / Optimizar</span>
                        <span className="text-[10px] text-slate-500 block">Reduce polígonos para evitar lag</span>
                      </div>
                    </div>
                  </button>

                  {/* Smooth */}
                  <button
                    type="button"
                    onClick={handleSmooth}
                    className="w-full p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-left transition flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Wand2 className="w-3.5 h-3.5 text-emerald-400" />
                      <div>
                        <span className="text-xs font-medium text-slate-200 block">Suavizar normales</span>
                        <span className="text-[10px] text-slate-500 block">Aspecto continuo sin facetas duras</span>
                      </div>
                    </div>
                  </button>

                  {/* Smart Split */}
                  <button
                    type="button"
                    onClick={handleSmartSplit}
                    className="w-full p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-left transition flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Scissors className="w-3.5 h-3.5 text-amber-400" />
                      <div>
                        <span className="text-xs font-medium text-slate-200 block">Separar partes lógicas</span>
                        <span className="text-[10px] text-slate-500 block">Descompone mallas desconectadas</span>
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
    </div>
  );
};
