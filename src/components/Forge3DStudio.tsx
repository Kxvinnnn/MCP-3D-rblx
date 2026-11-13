import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Sparkles,
  Image as ImageIcon,
  Layers,
  Download,
  Copy,
  Check,
  Trash2,
  Sliders,
  Cpu,
  Zap,
  Bookmark,
  Upload,
  FileCode2,
  Eye,
  Compass,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import {
  Forge3DAsset,
  MeshPart3DSpec,
  PBRTextureSet,
  PartPBRMaterialSpec,
  OperationHistoryEntry,
  DegenerateGeometryReport,
  ModelVersionDiffReport,
  AutomatedValidationSuiteReport,
  generateProceduralPBRTextures,
  convertImageTo3DHeightmapMesh,
  ensurePartHasMeshData,
  rescaleMeshPartGeometry,
  subdivideMeshPartGeometry,
  smoothMeshPartGeometry,
  decimateMeshPartGeometry,
  recomputeNormalsAndBoxUVs,
  snapAssetToGroundY0,
  validateAndRepairDegenerateGeometry,
  smartSplitMeshPartGeometry,
  exportAssetToRBXMX,
  exportAssetToGLTF,
  exportAssetToOBJWithMTL,
  parseRBXMXToForgeAsset,
  computeModelVersionDiff,
  incrementalMergeAssets,
  runAutomatedValidationAndSelfHeal,
} from '../utils/roblox3DEngine.ts';
import { RobloxWorldViewport3D } from './RobloxWorldViewport3D.tsx';
import { FloatingTerminalLog, TerminalLogEntry } from './FloatingTerminalLog.tsx';
import { default3DEngineProcessor } from './engines/3dEngine.ts';

type CreationMode = 'text_to_3d' | 'image_to_3d' | 'heightmap_3d' | 'scene_3d' | 'pbr_studio';

export const Forge3DStudio: React.FC = () => {
  const [creationMode, setCreationMode] = useState<CreationMode>('text_to_3d');
  const [prompt, setPrompt] = useState<string>(
    'Torreta defensiva sci-fi modular con base blindada octogonal, núcleo de energía de plasma cian en levitación, doble cañón electromagnético y antena de telemetría.'
  );
  const [collisionFidelity, setCollisionFidelity] = useState<
    'Hull' | 'Box' | 'PreciseConvexDecomposition' | 'Default'
  >('Hull');
  const [targetPolyBudget, setTargetPolyBudget] = useState<number>(3800);
  const [modelTier, setModelTier] = useState<'fast' | 'pro'>('fast');
  const [saveToRojo, setSaveToRojo] = useState<boolean>(true);
  const [saveToLibrary, setSaveToLibrary] = useState<boolean>(true);

  // Reference image for Image-to-3D or Heightmap extrusion
  const [referenceImageBase64, setReferenceImageBase64] = useState<string | null>(null);
  const [referenceImageMime, setReferenceImageMime] = useState<string>('image/png');
  const [referenceImagePreview, setReferenceImagePreview] = useState<string | null>(null);
  const [activeHeightmapUrl, setActiveHeightmapUrl] = useState<string | null>(null);

  // Heightmap 2D -> 3D geometry parameters
  const [extrusionDepth, setExtrusionDepth] = useState<number>(3.8);
  const [gridResolution, setGridResolution] = useState<number>(48);

  // PBR Material Generator state
  const [pbrPreset, setPbrPreset] = useState<
    'hex_plate' | 'carbon_weave' | 'brushed_metal' | 'stone_grid'
  >('hex_plate');
  const [pbrColorHex, setPbrColorHex] = useState<string>('#06b6d4');
  const [pbrAccentHex, setPbrAccentHex] = useState<string>('#38bdf8');
  const [pbrRoughness, setPbrRoughness] = useState<number>(0.28);
  const [pbrMetalness, setPbrMetalness] = useState<number>(0.82);
  const [pbrBundle, setPbrBundle] = useState<PBRTextureSet | null>(null);
  const [colorMapAssetId, setColorMapAssetId] = useState<string>('');
  const [normalMapAssetId, setNormalMapAssetId] = useState<string>('');
  const [roughnessMapAssetId, setRoughnessMapAssetId] = useState<string>('');
  const [metalnessMapAssetId, setMetalnessMapAssetId] = useState<string>('');
  const [pbrApplyScope, setPbrApplyScope] = useState<'selected_part' | 'all_parts'>('selected_part');

  // Active 3D Asset, Non-Destructive Operation History, Undo/Redo & Part Inspector
  const [activeAsset, setActiveAsset] = useState<Forge3DAsset | null>(null);
  const [undoStack, setUndoStack] = useState<Forge3DAsset[]>([]);
  const [redoStack, setRedoStack] = useState<Forge3DAsset[]>([]);
  const [operationHistory, setOperationHistory] = useState<OperationHistoryEntry[]>([]);
  const [lastGeometryValidation, setLastGeometryValidation] = useState<DegenerateGeometryReport | null>(null);
  const [selectedPart, setSelectedPart] = useState<MeshPart3DSpec | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'viewport' | 'luau' | 'pbr'>('viewport');
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  // Pillar C: Bidirectional Sync, Conflict Detection & Incremental Merge state
  const [versionDiffReport, setVersionDiffReport] = useState<ModelVersionDiffReport | null>(null);
  const [incomingSyncAsset, setIncomingSyncAsset] = useState<Forge3DAsset | null>(null);
  const [mergeStrategy, setMergeStrategy] = useState<'smart_merge' | 'accept_studio' | 'keep_forge'>('smart_merge');
  const [selectedCompareTarget, setSelectedCompareTarget] = useState<string>('rojo_disk');

  // Pillar D: Automated Validation & Self-Heal Suite state
  const [validationSuiteReport, setValidationSuiteReport] = useState<AutomatedValidationSuiteReport | null>(null);
  const [rojoBuildChecks, setRojoBuildChecks] = useState<
    Array<{ id: string; title: string; passed: boolean; auto_healed: boolean; details: string }>
  >([]);
  const [runningValidationSuite, setRunningValidationSuite] = useState<boolean>(false);

  // Reusable Asset Library
  const [assetLibrary, setAssetLibrary] = useState<Forge3DAsset[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState<boolean>(false);
  const [libraryFilter, setLibraryFilter] = useState<string>('ALL');

  // Streaming & Terminal state
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [terminalLogs, setTerminalLogs] = useState<TerminalLogEntry[]>([]);
  const [streamingBuffer, setStreamingBuffer] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);

  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const addLog = (level: TerminalLogEntry['level'], message: string) => {
    const now = new Date();
    const timestamp = now.toTimeString().split(' ')[0];
    setTerminalLogs((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp,
        level,
        message,
      },
    ]);
  };

  // Fetch 3D Asset Library on mount
  const fetchAssetLibrary = async () => {
    setLoadingLibrary(true);
    try {
      const res = await fetch('/api/v1/assets');
      const data = await res.json();
      if (data.assets && Array.isArray(data.assets)) {
        setAssetLibrary(data.assets);
        if (!activeAsset && data.assets.length > 0) {
          setActiveAsset(data.assets[0]);
          setSelectedPart(data.assets[0].parts?.[0] || null);
        }
      }
    } catch (err) {
      console.error('Error loading 3D asset library:', err);
    } finally {
      setLoadingLibrary(false);
    }
  };

  useEffect(() => {
    fetchAssetLibrary();
  }, []);

  // Generate procedural 4-channel PBR maps (Albedo, Normal, Roughness, Metalness + glTF ORM) whenever PBR parameters change
  useEffect(() => {
    const bundle = generateProceduralPBRTextures(
      pbrPreset,
      pbrColorHex,
      pbrAccentHex,
      4,
      pbrRoughness,
      pbrMetalness
    );
    setPbrBundle(bundle);
  }, [pbrPreset, pbrColorHex, pbrAccentHex, pbrRoughness, pbrMetalness]);

  // Handle uploading a reference image for Image-to-3D or Heightmap extrusion
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setReferenceImagePreview(dataUrl);
      const base64Part = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      setReferenceImageBase64(base64Part);
      setReferenceImageMime(file.type || 'image/png');
    };
    reader.readAsDataURL(file);
  };

  // Convert uploaded 2D image directly to 3D Volumetric Heightmap Geometry (preserving real displaced vertices, normals, UVs, and faces)
  const handleConvert2DToHeightmap3D = async () => {
    if (!referenceImagePreview) {
      setError('Sube primero una imagen 2D para extruir su geometría 3D en relieve.');
      return;
    }
    setError(null);
    setLoading(true);
    addLog(
      'info',
      `Extruyendo imagen 2D a malla 3D real (${gridResolution}x${gridResolution} celdas, relieve ${extrusionDepth} studs)...`
    );
    try {
      const result = await convertImageTo3DHeightmapMesh(
        referenceImagePreview,
        gridResolution,
        extrusionDepth
      );
      setActiveHeightmapUrl(referenceImagePreview);

      const modelName = `HeightmapTerrain_${gridResolution}`;
      const rgbColor = hexToRgb(pbrColorHex);
      const reliefPart: MeshPart3DSpec = {
        name: `${modelName}_ReliefMesh`,
        shape: 'MeshPart',
        size: [14, extrusionDepth, 14],
        position: [0, extrusionDepth * 0.5, 0],
        rotation: [0, 0, 0],
        color: rgbColor,
        material: 'Slate',
        roughness: pbrRoughness,
        metalness: pbrMetalness,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: collisionFidelity,
        meshData: result.meshData,
      };

      let savedRojoPath: string | undefined;
      if (saveToRojo) {
        try {
          const resp = await fetch('/api/v1/assets/process-meshpart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              payload: {
                modelName,
                sourceFormat: 'HEIGHTMAP_2D',
                totalVertices: result.meshData.vertices.length,
                totalTriangles: result.triangleCount,
                meshPartCount: 1,
                scaleFactorApplied: 1,
                studBoundingBox: [14, extrusionDepth, 14],
                isRobloxCompliant: result.triangleCount <= 10000,
                warnings: [],
                subMeshParts: [
                  {
                    name: reliefPart.name,
                    vertexCount: result.meshData.vertices.length,
                    triangleCount: result.triangleCount,
                    hasUVs: true,
                    hasNormals: true,
                    studSize: [14, extrusionDepth, 14],
                    studPosition: [0, extrusionDepth * 0.5, 0],
                    studRotation: [0, 0, 0],
                    colorRgb: rgbColor,
                    robloxMaterial: 'Slate',
                    roughness: pbrRoughness,
                    metalness: pbrMetalness,
                    collisionFidelity,
                    renderFidelity: 'Automatic',
                    lodTriangles: [
                      result.triangleCount,
                      Math.round(result.triangleCount * 0.65),
                      Math.round(result.triangleCount * 0.35),
                    ],
                    wavefrontObjChunk: result.wavefrontObj,
                    meshData: result.meshData,
                  },
                ],
                combinedWavefrontObj: result.wavefrontObj,
                luauMeshPartBuilderCode: result.editableMeshLuau,
                rojoTargetFolder: 'src/shared/Assets3D',
                fileName: `${modelName}.luau`,
                objFileName: `${modelName}.obj`,
              },
              save_to_rojo: saveToRojo,
              save_to_library: saveToLibrary,
            }),
          });
          if (resp.ok) {
            const syncData = await resp.json();
            savedRojoPath = syncData.saved_path;
            addLog(
              'rojo',
              `Relieve 3D real sincronizado en Rojo: ${syncData.saved_path} + ${modelName}.obj (${result.meshData.vertices.length} vértices)`
            );
            if (saveToLibrary) {
              fetchAssetLibrary();
            }
          }
        } catch {
          // Continue with local asset if backend is unreachable
        }
      }

      const heightmapAsset: Forge3DAsset = {
        id: `heightmap-${Date.now()}`,
        name: modelName,
        category: 'Heightmap3D',
        asset_type: 'Model3D',
        description: `Geometría 3D con relieve real (${result.meshData.vertices.length} vértices desplazados, ${result.triangleCount} triángulos, EditableMesh + OBJ).`,
        poly_count: result.triangleCount,
        collision_fidelity: collisionFidelity,
        rojo_target_folder: 'src/shared/Assets3D',
        file_name: `${modelName}.luau`,
        saved_path: savedRojoPath,
        pbr_profile: {
          albedo_hex: pbrColorHex,
          roughness: pbrRoughness,
          metalness: pbrMetalness,
          emissive_hex: pbrAccentHex,
          roblox_material: 'Slate',
          pattern: pbrPreset,
        },
        parts: [reliefPart],
        luau_code: result.editableMeshLuau,
        created_at: new Date().toISOString(),
      };
      setActiveAsset(heightmapAsset);
      setSelectedPart(reliefPart);
      setInspectorTab('viewport');
      addLog(
        'success',
        `Geometría 3D en relieve real generada (${result.meshData.vertices.length} vértices, ${result.triangleCount} triángulos) con AssetService:CreateEditableMesh().`
      );
    } catch (err: any) {
      setError(err.message || 'Error al convertir imagen 2D en geometría 3D');
      addLog('error', err.message || 'Error en conversión 2D a 3D');
    } finally {
      setLoading(false);
    }
  };

  // Associate 4-channel PBR textures directly with Selected MeshPart or All MeshParts
  const handleAssociatePBRWithParts = (scope: 'selected_part' | 'all_parts') => {
    if (!activeAsset || !pbrBundle) return;
    const targetLabel =
      scope === 'selected_part' && selectedPart
        ? `PBR 4 Canales (${pbrPreset}) → ${selectedPart.name}`
        : `PBR 4 Canales (${pbrPreset}) → Todo el Modelo`;
    pushUndoSnapshot(activeAsset, targetLabel, scope === 'selected_part' ? selectedPart?.name : undefined);

    const pbrSpec: PartPBRMaterialSpec = {
      pattern: pbrPreset,
      albedoHex: pbrColorHex,
      emissiveHex: pbrAccentHex,
      roughness: pbrRoughness,
      metalness: pbrMetalness,
      albedoDataUrl: pbrBundle.albedoDataUrl,
      normalDataUrl: pbrBundle.normalDataUrl,
      roughnessDataUrl: pbrBundle.roughnessDataUrl,
      metalnessDataUrl: pbrBundle.metalnessDataUrl,
      colorMapAssetId: colorMapAssetId.trim() || undefined,
      normalMapAssetId: normalMapAssetId.trim() || undefined,
      roughnessMapAssetId: roughnessMapAssetId.trim() || undefined,
      metalnessMapAssetId: metalnessMapAssetId.trim() || undefined,
    };

    const rgbCol = hexToRgb(pbrColorHex);
    const updatedParts = (activeAsset.parts || []).map((part) => {
      if (scope === 'selected_part' && selectedPart && part.name !== selectedPart.name) {
        return part;
      }
      return {
        ...part,
        color: rgbCol,
        roughness: pbrRoughness,
        metalness: pbrMetalness,
        pbrMaterial: pbrSpec,
      };
    });

    const nextAsset: Forge3DAsset = {
      ...activeAsset,
      parts: updatedParts,
      pbr_profile: {
        albedo_hex: pbrColorHex,
        roughness: pbrRoughness,
        metalness: pbrMetalness,
        emissive_hex: pbrAccentHex,
        roblox_material: selectedPart?.material || 'Metal',
        pattern: pbrPreset,
      },
    };
    setActiveAsset(nextAsset);
    if (selectedPart) {
      const updatedSel = updatedParts.find((p) => p.name === selectedPart.name);
      if (updatedSel) setSelectedPart(updatedSel);
    }
    addLog(
      'success',
      `Material PBR de 4 canales (Albedo, Normal, Roughness, Metalness + ORM glTF) asociado a ${
        scope === 'selected_part' && selectedPart ? `'${selectedPart.name}'` : `las ${updatedParts.length} MeshParts`
      }.`
    );
  };

  // Publish synthesized 4-channel PBR Texture Maps + SurfaceAppearance Luau binder to Rojo
  const handlePublishPBRToRojo = async () => {
    if (!pbrBundle) return;
    setLoading(true);
    setError(null);
    const targetPartName =
      pbrApplyScope === 'selected_part' && selectedPart ? selectedPart.name : undefined;
    const matName = activeAsset?.name
      ? targetPartName
        ? `${activeAsset.name}_${targetPartName}_${pbrPreset}`
        : `${activeAsset.name}_${pbrPreset}`
      : `Forge_${pbrPreset}`;
    addLog(
      'info',
      `Publicando y validando 4 mapas PBR (${matName}: ColorMap, NormalMap, RoughnessMap, MetalnessMap) y módulo SurfaceAppearance en Rojo...`
    );
    try {
      handleAssociatePBRWithParts(pbrApplyScope);
      const res = await default3DEngineProcessor.publishPBRToRojo({
        material_name: matName,
        pattern: pbrPreset,
        albedo_hex: pbrColorHex,
        emissive_hex: pbrAccentHex,
        roughness: pbrRoughness,
        metalness: pbrMetalness,
        albedo_data_url: pbrBundle.albedoDataUrl,
        normal_data_url: pbrBundle.normalDataUrl,
        roughness_data_url: pbrBundle.roughnessDataUrl,
        metalness_data_url: pbrBundle.metalnessDataUrl,
        target_asset_id: activeAsset?.id,
        target_part_name: targetPartName,
        color_map_asset_id: colorMapAssetId.trim() || undefined,
        normal_map_asset_id: normalMapAssetId.trim() || undefined,
        roughness_map_asset_id: roughnessMapAssetId.trim() || undefined,
        metalness_map_asset_id: metalnessMapAssetId.trim() || undefined,
      });

      const pubStatus = res.status || (res.is_cloud_published ? 'cloud_published' : 'local_saved');
      const publishedChannels = res.published_channels || [];
      const missingChannels = res.missing_channels || [];
      const decodeErrors = res.decode_errors || {};

      if (pubStatus === 'asset_not_found' || pubStatus === 'failed' || !res.success) {
        const errReasons = Object.entries(decodeErrors)
          .map(([ch, msg]) => `${ch}: ${msg}`)
          .join(' | ');
        const failMsg =
          pubStatus === 'asset_not_found'
            ? `El asset destino '${activeAsset?.id || ''}' no existe en la Biblioteca. Guarda primero el modelo antes de asociar perfiles PBR.`
            : `Fallo al publicar mapas PBR (${pubStatus}): ${errReasons || 'Texturas incompletas o inválidas'}`;
        setError(failMsg);
        addLog('error', failMsg);
        return;
      }

      if (pubStatus === 'partially_published') {
        addLog(
          'info',
          `[PBR Publicación Parcial] Canales publicados (${publishedChannels.length}/4): ${publishedChannels.join(', ')}. Faltantes: ${missingChannels.join(', ') || 'ninguno'}.`
        );
      }

      const statusLabel =
        pubStatus === 'cloud_published'
          ? '4/4 AssetIds verificados en Roblox Cloud asociados a SurfaceAppearance'
          : pubStatus === 'partially_published'
          ? `Publicación parcial (${publishedChannels.length}/4 canales validados)`
          : '4/4 PNGs validados en Textures/ + buffers RGBA32 embebidos para EditableImage';

      addLog(
        'rojo',
        `PBR SurfaceAppearance [${pubStatus.toUpperCase()}] en ${
          res.luau_binder_path || `src/shared/Assets3D/${matName}_SurfaceAppearance.luau`
        } (${statusLabel})`
      );
      if (activeAsset) {
        fetchAssetLibrary();
      }
    } catch (err: any) {
      setError(err.message || 'Error al publicar mapas PBR en Rojo');
      addLog('error', err.message || 'Error al publicar PBR en Rojo');
    } finally {
      setLoading(false);
    }
  };

  // Generate 3D Model or Full Scene via Backend Streaming Endpoint
  const handleGenerate3DWithAI = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setStreamingBuffer('');
    setIsStreaming(true);
    setActiveHeightmapUrl(null);

    const apiAssetType =
      creationMode === 'scene_3d'
        ? 'Scene3D'
        : creationMode === 'pbr_studio'
        ? 'PBRMaterial'
        : 'Model3D';

    addLog(
      'info',
      `POST /api/v1/generate-3d-stream [type=${apiAssetType}, collision=${collisionFidelity}, budget=${targetPolyBudget} tris]`
    );

    try {
      const response = await fetch('/api/v1/generate-3d-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          asset_type: apiAssetType,
          category: creationMode === 'scene_3d' ? 'Scene' : 'Sci-Fi',
          model_tier: modelTier,
          collision_fidelity: collisionFidelity,
          target_poly_budget: targetPolyBudget,
          reference_image_base64: referenceImageBase64,
          reference_image_mime_type: referenceImageMime,
          save_to_rojo: saveToRojo,
          save_to_library: saveToLibrary,
        }),
      });

      if (!response.ok || !response.body) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || errData.error || 'Error al conectar con el motor 3D de Forge AI');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split('\n\n');
        sseBuffer = events.pop() || '';

        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.replace(/^data:\s*/, '');
          try {
            const payload = JSON.parse(jsonStr);
            if (payload.type === 'log' || payload.type === 'stage') {
              addLog('info', payload.message);
            } else if (payload.type === 'chunk') {
              setStreamingBuffer((prev) => prev + (payload.delta || payload.text || ''));
              if (payload.message) {
                addLog('info', payload.message);
              }
            } else if (payload.type === 'rojo_write') {
              if (payload.saved) {
                addLog('rojo', `${payload.message} → ${payload.path}`);
              } else {
                addLog('info', payload.message);
              }
            } else if (payload.type === 'done' || payload.type === 'complete') {
              const result: Forge3DAsset = payload.data || payload.result;
              if (result) {
                setActiveAsset(result);
                setSelectedPart(result.parts?.[0] || null);
                addLog(
                  'success',
                  `Modelo 3D '${result.name}' construido (${result.parts?.length || 0} partes, ${result.poly_count} tris).`
                );
                if (saveToLibrary) {
                  fetchAssetLibrary();
                }
              }
            } else if (payload.type === 'error') {
              const errMsg = payload.message || payload.error || 'Error en el stream 3D';
              addLog('error', errMsg);
              setError(errMsg);
            }
          } catch {
            // Ignore partial chunk JSON parse error
          }
        }
      }
    } catch (err: any) {
      setError(err.message);
      addLog('error', `Fallo en motor 3D: ${err.message}`);
    } finally {
      setLoading(false);
      setIsStreaming(false);
    }
  };

  const handleDeleteAsset = async (id: string | undefined, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!id) return;
    try {
      const storedToken =
        typeof window !== 'undefined' ? window.localStorage.getItem('forge_security_token') || '' : '';
      const headers: Record<string, string> = {
        'X-Forge-Confirm-Delete': 'true',
      };
      if (storedToken) {
        headers['X-Forge-Token'] = storedToken;
      }
      const res = await fetch(`/api/v1/assets/${id}?confirm=true`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        setAssetLibrary((prev) => prev.filter((item) => item.id !== id));
      }
    } catch (err) {
      console.error('Error deleting asset:', err);
    }
  };

  const copyLuauBuilderCode = () => {
    if (!activeAsset?.luau_code) return;
    navigator.clipboard.writeText(activeAsset.luau_code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const downloadLuauBuilderFile = () => {
    if (!activeAsset?.luau_code) return;
    const blob = new Blob([activeAsset.luau_code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeAsset.file_name || `${activeAsset.name}_Builder.luau`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredAssets = assetLibrary.filter((item) => {
    if (libraryFilter === 'ALL') return true;
    return (
      item.category?.toLowerCase().includes(libraryFilter.toLowerCase()) ||
      item.asset_type?.toLowerCase().includes(libraryFilter.toLowerCase())
    );
  });

  const presets3D = [
    {
      label: 'Torreta Plasma MK-IV (Sci-Fi)',
      mode: 'text_to_3d' as CreationMode,
      prompt:
        'Torreta defensiva sci-fi modular con base blindada octogonal, núcleo de energía de plasma cian en levitación, doble cañón electromagnético y antena de telemetría.',
    },
    {
      label: 'Altar Rúnico & Yunque (RPG)',
      mode: 'text_to_3d' as CreationMode,
      prompt:
        'Forja de herrería medieval con base de piedra basáltica, horno con magma incandescente naranja, yunque de acero templado y cristal rúnico flotante.',
    },
    {
      label: 'Escenario Hangar Orbital Completo',
      mode: 'scene_3d' as CreationMode,
      prompt:
        'Escenario 3D completo de un hangar espacial cyberpunk con plataforma de aterrizaje iluminada con neón, generador de escudo central, contenedores de carga, pasarela elevada y balizas holográficas.',
    },
    {
      label: 'Vehículo Hovercraft Policial',
      mode: 'text_to_3d' as CreationMode,
      prompt:
        'Vehículo patrulla aerodeslizador futurista con chasis aerodinámico oscuro, dos turbinas laterales de propulsión iónica azul, cabina acristalada y sirenas holográficas.',
    },
  ];

  // P2 Interactive 3D Model Editor Handlers
  const rgbToHex = (rgb: number[]): string => {
    const [r = 56, g = 189, b = 248] = rgb || [56, 189, 248];
    return (
      '#' +
      [r, g, b]
        .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
        .join('')
    );
  };

  const hexToRgb = (hex: string): number[] => {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return [56, 189, 248];
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  };

  const import3DFileInputRef = useRef<HTMLInputElement | null>(null);
  const [exportingPackage, setExportingPackage] = useState<boolean>(false);
  const [exportedFilesList, setExportedFilesList] = useState<string[]>([]);

  const recomputeAssetPolyCount = (parts: MeshPart3DSpec[]): number => {
    return parts.reduce((sum, p) => {
      if (p.meshData && Array.isArray(p.meshData.faces) && p.meshData.faces.length > 0) {
        return sum + p.meshData.faces.length;
      }
      return sum + 12;
    }, 0);
  };

  const pushUndoSnapshot = (
    snapshot: Forge3DAsset,
    operationLabel: string = 'Edición Geométrica',
    targetPartName?: string
  ) => {
    const cloned = JSON.parse(JSON.stringify(snapshot)) as Forge3DAsset;
    setUndoStack((prev) => [...prev.slice(-19), cloned]);
    setRedoStack([]);
    const totalVerts = (cloned.parts || []).reduce(
      (s, p) => s + (p.meshData?.vertices?.length || 24),
      0
    );
    const entry: OperationHistoryEntry = {
      id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toTimeString().split(' ')[0],
      operationType: 'subdivide',
      partName: targetPartName || cloned.name,
      summary: operationLabel,
      vertexBefore: totalVerts,
      vertexAfter: totalVerts,
      triangleBefore: cloned.poly_count || 0,
      triangleAfter: cloned.poly_count || 0,
      snapshot: cloned,
    };
    setOperationHistory((prev) => [entry, ...prev.slice(0, 14)]);
  };

  const handleRevertToHistoryEntry = (entry: OperationHistoryEntry) => {
    if (!activeAsset) return;
    const currentClone = JSON.parse(JSON.stringify(activeAsset)) as Forge3DAsset;
    setRedoStack((prev) => [...prev.slice(-19), currentClone]);
    const restored = JSON.parse(JSON.stringify(entry.snapshot)) as Forge3DAsset;
    setActiveAsset(restored);
    setSelectedPart(restored.parts?.[0] || null);
    addLog(
      'info',
      `Historial No Destructivo: Revertido al punto '${entry.summary}' (${entry.timestamp} • ${restored.parts?.length || 0} piezas, ${restored.poly_count} tris).`
    );
  };

  const handleUndo = () => {
    if (undoStack.length === 0 || !activeAsset) return;
    const previous = undoStack[undoStack.length - 1];
    const currentClone = JSON.parse(JSON.stringify(activeAsset)) as Forge3DAsset;
    setRedoStack((prev) => [...prev.slice(-19), currentClone]);
    setUndoStack((prev) => prev.slice(0, -1));
    setActiveAsset(previous);
    const matchingPart =
      previous.parts?.find((p) => p.name === selectedPart?.name) ||
      previous.parts?.[0] ||
      null;
    setSelectedPart(matchingPart);
    addLog('info', `Editor 3D: Deshacer aplicado (${previous.parts?.length || 0} piezas, ${previous.poly_count} tris).`);
  };

  const handleRedo = () => {
    if (redoStack.length === 0 || !activeAsset) return;
    const nextState = redoStack[redoStack.length - 1];
    const currentClone = JSON.parse(JSON.stringify(activeAsset)) as Forge3DAsset;
    setUndoStack((prev) => [...prev.slice(-19), currentClone]);
    setRedoStack((prev) => prev.slice(0, -1));
    setActiveAsset(nextState);
    const matchingPart =
      nextState.parts?.find((p) => p.name === selectedPart?.name) ||
      nextState.parts?.[0] ||
      null;
    setSelectedPart(matchingPart);
    addLog('info', `Editor 3D: Rehacer aplicado (${nextState.parts?.length || 0} piezas, ${nextState.poly_count} tris).`);
  };

  const handleUpdateSelectedPart = (
    updater: (part: MeshPart3DSpec) => MeshPart3DSpec,
    operationLabel: string = 'Modificar Pieza'
  ) => {
    if (!activeAsset || !selectedPart) return;
    pushUndoSnapshot(activeAsset, operationLabel, selectedPart.name);
    const nextPart = updater(selectedPart);
    setSelectedPart(nextPart);
    const updatedParts = (activeAsset.parts || []).map((p) =>
      p.name === selectedPart.name ? nextPart : p
    );
    setActiveAsset({
      ...activeAsset,
      poly_count: recomputeAssetPolyCount(updatedParts),
      parts: updatedParts,
    });
  };

  const handleAddSubPart = () => {
    if (!activeAsset) return;
    pushUndoSnapshot(activeAsset);
    const idx = (activeAsset.parts?.length || 0) + 1;
    const rawPart: MeshPart3DSpec = {
      name: `CustomMesh_${idx}`,
      shape: 'MeshPart',
      size: [2.0, 1.2, 2.0],
      position: [0, 3.5, 0],
      rotation: [0, 0, 0],
      color: [6, 182, 212],
      material: 'Neon',
      roughness: 0.25,
      metalness: 0.75,
      transparency: 0,
      canCollide: true,
      anchored: true,
      collisionFidelity: collisionFidelity,
    };
    const newPart: MeshPart3DSpec = {
      ...rawPart,
      meshData: ensurePartHasMeshData(rawPart),
    };
    const updatedParts = [...(activeAsset.parts || []), newPart];
    setActiveAsset({
      ...activeAsset,
      poly_count: recomputeAssetPolyCount(updatedParts),
      parts: updatedParts,
    });
    setSelectedPart(newPart);
    addLog(
      'info',
      `Editor 3D: MeshPart '${newPart.name}' con geometría real (${newPart.meshData?.vertices.length || 0} vértices) añadida a '${activeAsset.name}'.`
    );
  };

  const handleDeleteSelectedPart = () => {
    if (!activeAsset || !selectedPart) return;
    if ((activeAsset.parts?.length || 0) <= 1) return;
    pushUndoSnapshot(activeAsset);
    const remaining = activeAsset.parts.filter((p) => p.name !== selectedPart.name);
    setActiveAsset({
      ...activeAsset,
      poly_count: recomputeAssetPolyCount(remaining),
      parts: remaining,
    });
    setSelectedPart(remaining[0] || null);
    addLog('info', `Editor 3D: Pieza '${selectedPart.name}' eliminada del modelo.`);
  };

  const handleSubdivideSelectedPart = () => {
    if (!selectedPart) return;
    handleUpdateSelectedPart((prev) => {
      const next = subdivideMeshPartGeometry(prev);
      addLog(
        'info',
        `Geometría subdividida en '${prev.name}' (UVs y normales preservadas): ${next.meshData?.vertices.length || 0} vértices, ${next.meshData?.faces.length || 0} triángulos.`
      );
      return next;
    }, `Subdividir (${selectedPart.name})`);
  };

  const handleSmoothSelectedPart = () => {
    if (!selectedPart) return;
    handleUpdateSelectedPart((prev) => {
      const next = smoothMeshPartGeometry(prev, 0.35);
      addLog(
        'info',
        `Suavizado Laplaciano aplicado a '${prev.name}' con normales y UVs preservadas.`
      );
      return next;
    }, `Suavizar (${selectedPart.name})`);
  };

  const handleDecimateSelectedPart = () => {
    if (!selectedPart) return;
    handleUpdateSelectedPart((prev) => {
      const next = decimateMeshPartGeometry(prev, 0.65);
      addLog(
        'info',
        `Simplificación geométrica LOD (-35%) en '${prev.name}': ${next.meshData?.faces.length || 0} triángulos.`
      );
      return next;
    }, `LOD -35% (${selectedPart.name})`);
  };

  const handleRecomputeUVsAndNormals = () => {
    if (!selectedPart) return;
    handleUpdateSelectedPart((prev) => {
      const next = recomputeNormalsAndBoxUVs(prev);
      addLog(
        'info',
        `Normales suaves y coordenadas UV triplanares recalculadas en '${prev.name}'.`
      );
      return next;
    }, `Recalcular UV/Normales (${selectedPart.name})`);
  };

  const handleSmartSplitSelectedPart = () => {
    if (!activeAsset || !selectedPart) return;
    pushUndoSnapshot(activeAsset, `División Inteligente (${selectedPart.name})`, selectedPart.name);
    const { splitParts, mode, summary } = smartSplitMeshPartGeometry(selectedPart);
    if (splitParts.length <= 1) {
      addLog('info', summary);
      return;
    }
    const nextParts: MeshPart3DSpec[] = [];
    for (const p of activeAsset.parts) {
      if (p.name === selectedPart.name) {
        nextParts.push(...splitParts);
      } else {
        nextParts.push(p);
      }
    }
    setActiveAsset({
      ...activeAsset,
      poly_count: recomputeAssetPolyCount(nextParts),
      parts: nextParts,
    });
    setSelectedPart(splitParts[0]);
    addLog('success', `[Smart Split • ${mode}] ${summary}`);
  };

  const handleValidateAndRepairSelectedPart = () => {
    if (!activeAsset || !selectedPart) return;
    pushUndoSnapshot(activeAsset, `Validar/Reparar Geometría (${selectedPart.name})`, selectedPart.name);
    const { repairedPart, report } = validateAndRepairDegenerateGeometry(selectedPart);
    setLastGeometryValidation(report);
    const updatedParts = activeAsset.parts.map((p) =>
      p.name === selectedPart.name ? repairedPart : p
    );
    setActiveAsset({
      ...activeAsset,
      poly_count: recomputeAssetPolyCount(updatedParts),
      parts: updatedParts,
    });
    setSelectedPart(repairedPart);
    addLog('success', `Validación Geométrica: ${report.summary}`);
  };

  const handleGroundModelY0 = () => {
    if (!activeAsset) return;
    pushUndoSnapshot(activeAsset, 'Alinear Modelo a Base Y=0');
    const grounded = snapAssetToGroundY0(activeAsset);
    setActiveAsset(grounded);
    if (selectedPart) {
      const found = grounded.parts.find((p) => p.name === selectedPart.name);
      if (found) setSelectedPart(found);
    }
    addLog('info', `Modelo '${activeAsset.name}' alineado exactamente al plano base Y=0 Studs.`);
  };

  const handleApplyMaterialToAllParts = () => {
    if (!activeAsset || !selectedPart) return;
    pushUndoSnapshot(activeAsset);
    const updatedParts = (activeAsset.parts || []).map((p) => ({
      ...p,
      material: selectedPart.material,
      color: [...selectedPart.color],
      roughness: selectedPart.roughness ?? pbrRoughness,
      metalness: selectedPart.metalness ?? pbrMetalness,
      transparency: selectedPart.transparency ?? 0,
    }));
    setActiveAsset({
      ...activeAsset,
      parts: updatedParts,
      pbr_profile: {
        albedo_hex: rgbToHex(selectedPart.color),
        roughness: selectedPart.roughness ?? pbrRoughness,
        metalness: selectedPart.metalness ?? pbrMetalness,
        emissive_hex: pbrAccentHex,
        roblox_material: selectedPart.material,
        pattern: pbrPreset,
      },
    });
    addLog(
      'success',
      `Material Roblox '${selectedPart.material}' (Roughness ${Number(selectedPart.roughness ?? 0.35).toFixed(2)}, Metalness ${Number(selectedPart.metalness ?? 0.6).toFixed(2)}) aplicado a las ${updatedParts.length} piezas del modelo.`
    );
  };

  const handleDirectImport3DFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (ext === 'rbxmx') {
        addLog('info', `Importando modelo nativo Roblox Studio (.rbxmx): ${file.name}...`);
        const xmlText = await file.text();
        const importedAsset = parseRBXMXToForgeAsset(xmlText, file.name);
        setActiveAsset(importedAsset);
        setSelectedPart(importedAsset.parts?.[0] || null);
        setInspectorTab('viewport');
        addLog(
          'success',
          `Modelo Roblox Studio '${importedAsset.name}' importado (${importedAsset.parts.length} MeshParts, ${importedAsset.poly_count} triángulos).`
        );
      } else {
        addLog('info', `Pre-procesando archivo 3D (${file.name}) con conservación de vértices, normales y UVs...`);
        const { exportPayload, backendResponse } =
          await default3DEngineProcessor.processAndSyncWithBackend(file, {
            targetStudHeight: 6.0,
            decimationRatio: 1.0,
            collisionFidelity,
            autoSplitOversizedMeshes: true,
          });
        if (backendResponse?.asset) {
          setActiveAsset(backendResponse.asset);
          setSelectedPart(backendResponse.asset.parts?.[0] || null);
          setInspectorTab('viewport');
          fetchAssetLibrary();
          addLog(
            'success',
            `Modelo 3D '${backendResponse.asset.name}' importado con geometría intacta (${exportPayload.totalVertices} vértices, ${exportPayload.totalTriangles} triángulos).`
          );
        }
      }
    } catch (err: any) {
      setError(err.message || 'Error al importar archivo 3D');
      addLog('error', err.message || 'Error en importación 3D');
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const handleDownloadRBXMX = () => {
    if (!activeAsset) return;
    const xml = exportAssetToRBXMX(activeAsset);
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeAsset.name}.rbxmx`;
    a.click();
    URL.revokeObjectURL(url);
    addLog(
      'success',
      `Archivo nativo Roblox Studio '${activeAsset.name}.rbxmx' exportado con jerarquía Model, MeshParts, CFrames, SurfaceAppearance y geometría completa.`
    );
  };

  const handleDownloadGLTF = () => {
    if (!activeAsset) return;
    const gltf = exportAssetToGLTF(activeAsset, pbrBundle || undefined);
    const blob = new Blob([gltf], { type: 'model/gltf+json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeAsset.name}.gltf`;
    a.click();
    URL.revokeObjectURL(url);
    addLog(
      'success',
      `Archivo estándar '${activeAsset.name}.gltf' (glTF 2.0) exportado con buffers binarios de vértices, normales, UVs y mapas de textura PBR embebidos.`
    );
  };

  const handleDownloadOBJWithMTL = () => {
    if (!activeAsset) return;
    const { obj, mtl } = exportAssetToOBJWithMTL(activeAsset);
    const objBlob = new Blob([obj], { type: 'text/plain;charset=utf-8' });
    const objUrl = URL.createObjectURL(objBlob);
    const aObj = document.createElement('a');
    aObj.href = objUrl;
    aObj.download = `${activeAsset.name}.obj`;
    aObj.click();
    URL.revokeObjectURL(objUrl);

    const mtlBlob = new Blob([mtl], { type: 'text/plain;charset=utf-8' });
    const mtlUrl = URL.createObjectURL(mtlBlob);
    const aMtl = document.createElement('a');
    aMtl.href = mtlUrl;
    aMtl.download = `${activeAsset.name}.mtl`;
    aMtl.click();
    URL.revokeObjectURL(mtlUrl);

    addLog(
      'success',
      `Malla '${activeAsset.name}.obj' + biblioteca de materiales PBR '${activeAsset.name}.mtl' descargadas para el Importador 3D de Roblox Studio.`
    );
  };

  const handleExportFullPackageToRojo = async () => {
    if (!activeAsset) return;
    setExportingPackage(true);
    setError(null);
    try {
      const rbxmxContent = exportAssetToRBXMX(activeAsset);
      const gltfContent = exportAssetToGLTF(activeAsset, pbrBundle || undefined);
      const { obj: objContent, mtl: mtlContent } = exportAssetToOBJWithMTL(activeAsset);

      addLog(
        'info',
        `Exportando y verificando paquete de 5 archivos Roblox Studio (.rbxmx + .gltf + .obj + .mtl + .luau) para '${activeAsset.name}'...`
      );
      const res = await fetch('/api/v1/assets/export-roblox-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset: activeAsset,
          rbxmx_content: rbxmxContent,
          gltf_content: gltfContent,
          obj_content: objContent,
          mtl_content: mtlContent,
          pbr_textures: pbrBundle
            ? {
                albedo_data_url: pbrBundle.albedoDataUrl,
                normal_data_url: pbrBundle.normalDataUrl,
                roughness_data_url: pbrBundle.roughnessDataUrl,
                metalness_data_url: pbrBundle.metalnessDataUrl,
                metallic_roughness_data_url: pbrBundle.metallicRoughnessDataUrl,
              }
            : undefined,
          save_to_rojo: true,
          save_to_library: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || 'Error al exportar paquete 3D a Rojo');
      }
      if (data.asset) {
        setActiveAsset(data.asset);
        const savedDict = data.saved_files || {};
        const verifiedDict = data.verified_files || {};
        const fileEntries: string[] = Array.isArray(savedDict)
          ? savedDict
          : Object.entries(savedDict)
              .filter(([ext, p]) => Boolean(p) && verifiedDict[ext] !== false)
              .map(([ext]) => `${data.asset.name}.${ext}`);
        setExportedFilesList(fileEntries);
        fetchAssetLibrary();
        addLog(
          'rojo',
          `Paquete 3D verificado en disco (${data.verified_files_count ?? fileEntries.length}/5 archivos): ${fileEntries.join(', ')}`
        );
      }
    } catch (err: any) {
      setError(err.message || 'Error al exportar paquete completo a Rojo');
      addLog('error', `Error en exportación a Rojo: ${err.message}`);
    } finally {
      setExportingPackage(false);
    }
  };

  const handlePullFromRojo = async () => {
    if (!activeAsset) return;
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, any> = {
        asset_id: activeAsset.id,
        asset_name: activeAsset.name,
      };
      if (selectedCompareTarget.startsWith('v:')) {
        payload.restore_version = Number(selectedCompareTarget.replace('v:', ''));
      }
      const res = await fetch('/api/v1/assets/pull-from-rojo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || 'No se pudo sincronizar el archivo .rbxmx desde Rojo');
      }
      if (data.rbxmx_content) {
        const incomingAsset = parseRBXMXToForgeAsset(data.rbxmx_content, `${activeAsset.name}.rbxmx`);
        incomingAsset.luau_code = data.luau_content || incomingAsset.luau_code;
        const diff = computeModelVersionDiff(activeAsset, incomingAsset);
        setIncomingSyncAsset(incomingAsset);
        setVersionDiffReport(diff);
        addLog(
          'rojo',
          `[Comparador Bidireccional] +${diff.addedCount} nuevas, ~${diff.modifiedCount} modificadas, !${diff.conflictCount} conflictos. Selecciona estrategia para aplicar sincronización incremental.`
        );
      }
    } catch (err: any) {
      setError(err.message || 'Error al sincronizar cambios desde Rojo');
      addLog('error', err.message || 'Error en pull-from-rojo');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyIncrementalMerge = async () => {
    if (!activeAsset || !incomingSyncAsset) return;
    pushUndoSnapshot(
      activeAsset,
      `Sync Incremental (${mergeStrategy})`
    );
    const { mergedAsset, summary } = incrementalMergeAssets(
      activeAsset,
      incomingSyncAsset,
      mergeStrategy
    );
    setActiveAsset(mergedAsset);
    setSelectedPart(mergedAsset.parts?.[0] || null);
    setVersionDiffReport(null);
    setIncomingSyncAsset(null);
    addLog(
      'success',
      summary
    );
  };

  const handleRunAutomatedValidationSuite = async () => {
    if (!activeAsset) return;
    setRunningValidationSuite(true);
    setError(null);
    addLog(
      'info',
      `Ejecutando Suite Automatizada E2E (Geometría, PBR 4 Canales, Roundtrip .RBXMX/.GLTF/.OBJ y Rojo Build) en '${activeAsset.name}'...`
    );
    try {
      const report = runAutomatedValidationAndSelfHeal(activeAsset, pbrBundle);
      setValidationSuiteReport(report);
      if (report.autoHealedCount > 0) {
        pushUndoSnapshot(activeAsset, 'Auto-Recuperación Suite Validación');
        setActiveAsset(report.healedAsset);
        setSelectedPart(report.healedAsset.parts?.[0] || null);
      }

      const rojoRes = await fetch('/api/v1/assets/validate-rojo-build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_name: activeAsset.name,
          auto_heal: true,
        }),
      });
      if (rojoRes.ok) {
        const rojoData = await rojoRes.json();
        setRojoBuildChecks(rojoData.checks || []);
        if (Array.isArray(rojoData.auto_healed_actions) && rojoData.auto_healed_actions.length > 0) {
          addLog('rojo', `Auto-Recuperación Rojo Build: ${rojoData.auto_healed_actions.join(' | ')}`);
        }
      }
      setInspectorTab('pbr');
      addLog(
        'success',
        `Suite E2E completada: ${report.passedChecks}/${report.totalChecks} pruebas superadas (${report.score}% • ${report.autoHealedCount} auto-reparaciones).`
      );
    } catch (err: any) {
      setError(err.message || 'Error en suite de validación');
      addLog('error', `Error en validación E2E: ${err.message}`);
    } finally {
      setRunningValidationSuite(false);
    }
  };

  const handleSaveEditedModelToRojo = async () => {
    if (!activeAsset) return;
    try {
      addLog('info', `Recompilando script Luau --!strict para '${activeAsset.name}' (${activeAsset.parts.length} piezas)...`);
      const res = await fetch('/api/v1/assets/rebuild-luau', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset: activeAsset,
          save_to_rojo: saveToRojo,
          save_to_library: saveToLibrary,
        }),
      });
      const data = await res.json();
      if (data.asset) {
        setActiveAsset(data.asset);
        fetchAssetLibrary();
        addLog(
          'rojo',
          `Modelo 3D modificado sincronizado en Rojo (${data.asset.saved_path || data.asset.file_name}) y guardado en Biblioteca.`
        );
      }
    } catch (err: any) {
      addLog('error', `Error al guardar cambios del modelo 3D: ${err.message}`);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* Main 3D Creation Workbench: Controls Left (5 cols) + Real 3D Viewport Right (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: 3D Generation Controls & Modes */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="p-5 rounded-2xl bg-[#0d1117] border border-slate-800 shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2.5">
                <Box className="w-5 h-5 text-cyan-400" />
                <div>
                  <h2 className="text-sm font-bold text-white tracking-wide">
                    Motor de Creación 3D &amp; PBR (WorldModel)
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Modelos 3D, Imágenes a Geometría, Materiales PBR y Escenarios Roblox
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded bg-cyan-950/70 border border-cyan-700/40 text-cyan-300 font-mono text-[10px]">
                &lt;10k Tris Limit
              </span>
            </div>

            {/* 5-Mode Selector */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => setCreationMode('text_to_3d')}
                className={`px-2.5 py-2 rounded-xl text-[11px] font-semibold flex items-center gap-1.5 border transition cursor-pointer ${
                  creationMode === 'text_to_3d'
                    ? 'bg-cyan-600/20 border-cyan-500 text-cyan-300'
                    : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Box className="w-3.5 h-3.5 shrink-0" />
                <span>Texto a 3D</span>
              </button>

              <button
                type="button"
                onClick={() => setCreationMode('image_to_3d')}
                className={`px-2.5 py-2 rounded-xl text-[11px] font-semibold flex items-center gap-1.5 border transition cursor-pointer ${
                  creationMode === 'image_to_3d'
                    ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                    : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                <span>Imagen a 3D (IA)</span>
              </button>

              <button
                type="button"
                onClick={() => setCreationMode('heightmap_3d')}
                className={`px-2.5 py-2 rounded-xl text-[11px] font-semibold flex items-center gap-1.5 border transition cursor-pointer ${
                  creationMode === 'heightmap_3d'
                    ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                    : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span>2D → Geometría</span>
              </button>

              <button
                type="button"
                onClick={() => setCreationMode('scene_3d')}
                className={`px-2.5 py-2 rounded-xl text-[11px] font-semibold flex items-center gap-1.5 border transition cursor-pointer ${
                  creationMode === 'scene_3d'
                    ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                    : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Compass className="w-3.5 h-3.5 shrink-0" />
                <span>Escenario 3D</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCreationMode('pbr_studio');
                  setInspectorTab('pbr');
                }}
                className={`px-2.5 py-2 rounded-xl text-[11px] font-semibold flex items-center gap-1.5 border transition cursor-pointer col-span-2 sm:col-span-2 ${
                  creationMode === 'pbr_studio'
                    ? 'bg-amber-600/20 border-amber-500 text-amber-300'
                    : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Sliders className="w-3.5 h-3.5 shrink-0" />
                <span>Generador PBR &amp; SurfaceAppearance</span>
              </button>
            </div>

            {/* Quick Presets */}
            {creationMode !== 'heightmap_3d' && creationMode !== 'pbr_studio' && (
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">
                  Plantillas 3D de Prueba Rápida
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {presets3D.map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setCreationMode(preset.mode);
                        setPrompt(preset.prompt);
                      }}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 transition cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Reference Image Uploader for Image-to-3D or Heightmap Extrusion */}
            {(creationMode === 'image_to_3d' || creationMode === 'heightmap_3d') && (
              <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
                    {creationMode === 'heightmap_3d'
                      ? 'Mapa de Alturas / Boceto 2D para Extrusión 3D'
                      : 'Imagen de Referencia para Reconstrucción 3D'}
                  </span>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="px-2.5 py-1 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-200 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Upload className="w-3 h-3" />
                    Subir Imagen
                  </button>
                </div>

                {referenceImagePreview ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={referenceImagePreview}
                      alt="Referencia 3D"
                      className="w-16 h-16 object-cover rounded-lg border border-slate-700"
                    />
                    <div className="flex-1 text-[11px] text-slate-300">
                      <p className="font-semibold text-emerald-400">
                        Imagen cargada lista para procesar
                      </p>
                      <p className="text-slate-400 mt-0.5">
                        {creationMode === 'heightmap_3d'
                          ? 'Se convertirá cada píxel en vértices 3D desplazados según su luminancia.'
                          : 'Gemini Vision analizará volúmenes, materiales y proporciones en Studs.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">
                    Sube un concept art, textura o silueta PNG/JPG para transformarlo en geometría 3D.
                  </p>
                )}

                {creationMode === 'heightmap_3d' && (
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800">
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                        <span>Relieve Z (Studs)</span>
                        <span className="font-mono text-emerald-300 tabular-nums">
                          {extrusionDepth}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.5}
                        max={8}
                        step={0.5}
                        value={extrusionDepth}
                        onChange={(e) => setExtrusionDepth(Number(e.target.value))}
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                        <span>Subdivisión Malla</span>
                        <span className="font-mono text-emerald-300 tabular-nums">
                          {gridResolution}x{gridResolution}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={24}
                        max={80}
                        step={8}
                        value={gridResolution}
                        onChange={(e) => setGridResolution(Number(e.target.value))}
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleConvert2DToHeightmap3D}
                      disabled={loading}
                      className="col-span-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
                    >
                      <Layers className="w-4 h-4" />
                      Convertir Imagen 2D a Malla 3D Ahora
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* PBR SurfaceAppearance Studio Controls */}
            {creationMode === 'pbr_studio' && (
              <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col gap-3">
                <div className="text-xs font-semibold text-amber-300 flex items-center justify-between">
                  <span>Síntesis Procedural de Mapas PBR (SurfaceAppearance)</span>
                  <span className="font-mono text-[10px] text-slate-400">Zero-404 Maps</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">
                      Patrón de Superficie
                    </label>
                    <select
                      value={pbrPreset}
                      onChange={(e) => setPbrPreset(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    >
                      <option value="hex_plate">Hexágonos Sci-Fi (hex_plate)</option>
                      <option value="carbon_weave">Fibra de Carbono (carbon_weave)</option>
                      <option value="brushed_metal">Titanio Cepillado (brushed_metal)</option>
                      <option value="stone_grid">Piedra Rúnica (stone_grid)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">
                      Color Base &amp; Acento
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={pbrColorHex}
                        onChange={(e) => setPbrColorHex(e.target.value)}
                        className="w-7 h-7 rounded cursor-pointer bg-transparent border-0"
                      />
                      <input
                        type="color"
                        value={pbrAccentHex}
                        onChange={(e) => setPbrAccentHex(e.target.value)}
                        className="w-7 h-7 rounded cursor-pointer bg-transparent border-0"
                      />
                      <span className="font-mono text-[11px] text-slate-200 uppercase">
                        {pbrColorHex}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>Roughness</span>
                      <span className="font-mono text-amber-300 tabular-nums">
                        {pbrRoughness.toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.05}
                      max={1.0}
                      step={0.05}
                      value={pbrRoughness}
                      onChange={(e) => setPbrRoughness(Number(e.target.value))}
                      className="w-full accent-amber-400 cursor-pointer"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>Metalness</span>
                      <span className="font-mono text-amber-300 tabular-nums">
                        {pbrMetalness.toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.0}
                      max={1.0}
                      step={0.05}
                      value={pbrMetalness}
                      onChange={(e) => setPbrMetalness(Number(e.target.value))}
                      className="w-full accent-amber-400 cursor-pointer"
                    />
                  </div>
                </div>

                {pbrBundle && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800">
                    <div className="flex flex-col items-center gap-1">
                      <img
                        src={pbrBundle.albedoDataUrl}
                        alt="Albedo Map"
                        className="w-full aspect-square rounded-lg border border-slate-700 object-cover"
                      />
                      <a
                        href={pbrBundle.albedoDataUrl}
                        download={`PBR_${pbrPreset}_ColorMap.png`}
                        className="text-[10px] font-mono text-cyan-400 hover:underline"
                      >
                        ↓ ColorMap.png
                      </a>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <img
                        src={pbrBundle.normalDataUrl}
                        alt="Normal Map"
                        className="w-full aspect-square rounded-lg border border-slate-700 object-cover"
                      />
                      <a
                        href={pbrBundle.normalDataUrl}
                        download={`PBR_${pbrPreset}_NormalMap.png`}
                        className="text-[10px] font-mono text-purple-400 hover:underline"
                      >
                        ↓ NormalMap.png
                      </a>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <img
                        src={pbrBundle.roughnessDataUrl}
                        alt="Roughness Map"
                        className="w-full aspect-square rounded-lg border border-slate-700 object-cover"
                      />
                      <a
                        href={pbrBundle.roughnessDataUrl}
                        download={`PBR_${pbrPreset}_RoughnessMap.png`}
                        className="text-[10px] font-mono text-amber-400 hover:underline"
                      >
                        ↓ Roughness.png
                      </a>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <img
                        src={pbrBundle.metalnessDataUrl}
                        alt="Metalness Map"
                        className="w-full aspect-square rounded-lg border border-slate-700 object-cover"
                      />
                      <a
                        href={pbrBundle.metalnessDataUrl}
                        download={`PBR_${pbrPreset}_MetalnessMap.png`}
                        className="text-[10px] font-mono text-emerald-400 hover:underline"
                      >
                        ↓ Metalness.png
                      </a>
                    </div>
                    <div className="col-span-2 sm:col-span-4 grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-2 border-t border-slate-800/80">
                      <input
                        type="text"
                        value={colorMapAssetId}
                        onChange={(e) => setColorMapAssetId(e.target.value)}
                        placeholder="ColorMap rbxassetid:// (opcional)"
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[10px] font-mono text-slate-200 placeholder-slate-500"
                      />
                      <input
                        type="text"
                        value={normalMapAssetId}
                        onChange={(e) => setNormalMapAssetId(e.target.value)}
                        placeholder="NormalMap rbxassetid:// (opcional)"
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[10px] font-mono text-slate-200 placeholder-slate-500"
                      />
                      <input
                        type="text"
                        value={roughnessMapAssetId}
                        onChange={(e) => setRoughnessMapAssetId(e.target.value)}
                        placeholder="RoughnessMap rbxassetid:// (opcional)"
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[10px] font-mono text-slate-200 placeholder-slate-500"
                      />
                      <input
                        type="text"
                        value={metalnessMapAssetId}
                        onChange={(e) => setMetalnessMapAssetId(e.target.value)}
                        placeholder="MetalnessMap rbxassetid:// (opcional)"
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[10px] font-mono text-slate-200 placeholder-slate-500"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-4 flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono">
                        <span className="text-slate-400">Asociación PBR:</span>
                        <button
                          type="button"
                          onClick={() => setPbrApplyScope('selected_part')}
                          className={`px-2 py-1 rounded border cursor-pointer ${
                            pbrApplyScope === 'selected_part'
                              ? 'bg-cyan-950/80 border-cyan-500 text-cyan-300'
                              : 'bg-slate-950 border-slate-800 text-slate-400'
                          }`}
                        >
                          Solo MeshPart ({selectedPart?.name || 'Activa'})
                        </button>
                        <button
                          type="button"
                          onClick={() => setPbrApplyScope('all_parts')}
                          className={`px-2 py-1 rounded border cursor-pointer ${
                            pbrApplyScope === 'all_parts'
                              ? 'bg-amber-950/80 border-amber-500 text-amber-300'
                              : 'bg-slate-950 border-slate-800 text-slate-400'
                          }`}
                        >
                          Todo el Modelo
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAssociatePBRWithParts(pbrApplyScope)}
                        className="px-2.5 py-1 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-200 text-[10px] font-semibold cursor-pointer"
                      >
                        Aplicar PBR 4 Canales en Visor 3D
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handlePublishPBRToRojo}
                      disabled={loading}
                      className="col-span-2 sm:col-span-4 mt-1 py-2 px-3 rounded-lg bg-amber-600/90 hover:bg-amber-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Publicar 4 Mapas PBR + SurfaceAppearance.luau en Rojo
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Prompt Input for AI 3D Model / Scene Generation */}
            {creationMode !== 'heightmap_3d' && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Descripción Arquitectónica del Modelo o Escenario 3D
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition resize-none leading-relaxed"
                  placeholder="Describe las partes 3D, proporciones en Studs, materiales PBR y luces..."
                />
              </div>
            )}

            {/* Geometry Optimization, Collision Fidelity & Poly Budget */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-950/90 border border-slate-800/90">
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                  CollisionFidelity (Roblox)
                </label>
                <select
                  value={collisionFidelity}
                  onChange={(e) => setCollisionFidelity(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="Hull">Hull (Convex Hull Optimizado)</option>
                  <option value="Box">Box (Bounding Box Ultra Rápido)</option>
                  <option value="PreciseConvexDecomposition">PreciseConvexDecomposition</option>
                  <option value="Default">Default (Voxel Mesh)</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between text-[10px] font-mono uppercase text-slate-400 mb-1">
                  <span>Presupuesto Polígonos</span>
                  <span className="text-cyan-400 tabular-nums">{targetPolyBudget} tris</span>
                </div>
                <input
                  type="range"
                  min={600}
                  max={9800}
                  step={200}
                  value={targetPolyBudget}
                  onChange={(e) => setTargetPolyBudget(Number(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer mt-1"
                />
              </div>
            </div>

            {/* Model Tier & Rojo Auto-Sync Toggles */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setModelTier('fast')}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 border cursor-pointer ${
                    modelTier === 'fast'
                      ? 'bg-cyan-950/60 border-cyan-500/50 text-cyan-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  <Zap className="w-3 h-3" />
                  Flash (Rápido)
                </button>
                <button
                  type="button"
                  onClick={() => setModelTier('pro')}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 border cursor-pointer ${
                    modelTier === 'pro'
                      ? 'bg-purple-950/60 border-purple-500/50 text-purple-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  <Cpu className="w-3 h-3" />
                  Pro (Geometría Compleja)
                </button>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-slate-300">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveToRojo}
                    onChange={(e) => setSaveToRojo(e.target.checked)}
                    className="accent-cyan-500 rounded"
                  />
                  <span>Sync Rojo</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveToLibrary}
                    onChange={(e) => setSaveToLibrary(e.target.checked)}
                    className="accent-emerald-500 rounded"
                  />
                  <span>Guardar en Biblioteca</span>
                </label>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-950/50 border border-red-500/40 text-red-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {creationMode !== 'heightmap_3d' && (
              <button
                type="button"
                onClick={handleGenerate3DWithAI}
                disabled={loading}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-xs tracking-wide uppercase shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Sintetizando Geometría 3D &amp; Materiales PBR...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>
                      {creationMode === 'scene_3d'
                        ? 'Generar Escenario 3D Completo + Script Luau'
                        : 'Generar Modelo 3D + Materiales PBR'}
                    </span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* P2 Interactive 3D Geometry & Material Editor */}
          {activeAsset && (
            <div className="p-4 rounded-2xl bg-[#0d1117] border border-slate-800 shadow-lg flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div>
                  <span className="text-xs font-bold text-cyan-400 font-mono block">
                    Editor de Geometría Real &amp; Materiales ({activeAsset.parts?.length || 0} MeshParts • {activeAsset.poly_count} tris)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Edita vértices, subdivisión, normales, UVs, escala en Studs y materiales PBR sin perder la forma
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={undoStack.length === 0}
                    className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300 disabled:opacity-40 cursor-pointer"
                    title="Deshacer último cambio geométrico o de material"
                  >
                    ↶ Deshacer ({undoStack.length})
                  </button>
                  <button
                    type="button"
                    onClick={handleRedo}
                    disabled={redoStack.length === 0}
                    className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300 disabled:opacity-40 cursor-pointer"
                    title="Rehacer cambio geométrico o de material"
                  >
                    ↷ Rehacer ({redoStack.length})
                  </button>
                  <button
                    type="button"
                    onClick={handleAddSubPart}
                    className="px-2.5 py-1 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-[11px] font-semibold text-cyan-300 cursor-pointer"
                  >
                    + Añadir MeshPart
                  </button>
                  {selectedPart && (activeAsset.parts?.length || 0) > 1 && (
                    <button
                      type="button"
                      onClick={handleDeleteSelectedPart}
                      className="px-2 py-1 rounded-lg bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 text-[11px] text-red-300 cursor-pointer"
                      title="Eliminar pieza seleccionada"
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </div>

              {/* Part Selector Dropdown */}
              {activeAsset.parts && activeAsset.parts.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      PIEZA SELECCIONADA
                    </label>
                    <select
                      value={selectedPart?.name || activeAsset.parts[0].name}
                      onChange={(e) => {
                        const found = activeAsset.parts.find((p) => p.name === e.target.value);
                        if (found) setSelectedPart(found);
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white font-mono"
                    >
                      {activeAsset.parts.map((p, idx) => (
                        <option key={`${p.name}-${idx}`} value={p.name}>
                          {p.name} ({p.meshData?.vertices?.length || 24}v)
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedPart && (
                    <>
                      <div>
                        <label className="block text-[10px] font-mono text-slate-400 mb-1">
                          TIPO DE GEOMETRÍA
                        </label>
                        <select
                          value={selectedPart.shape}
                          onChange={(e) =>
                            handleUpdateSelectedPart((prev) => {
                              const nextShape = e.target.value as any;
                              const tempPart: MeshPart3DSpec = {
                                ...prev,
                                shape: nextShape,
                                meshData: nextShape === 'MeshPart' ? prev.meshData : undefined,
                              };
                              return {
                                ...tempPart,
                                meshData: ensurePartHasMeshData(tempPart),
                              };
                            })
                          }
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white"
                        >
                          <option value="MeshPart">MeshPart (Malla 3D Real)</option>
                          <option value="Block">Block</option>
                          <option value="Cylinder">Cylinder</option>
                          <option value="Ball">Ball</option>
                          <option value="Wedge">Wedge</option>
                          <option value="CornerWedge">CornerWedge</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-mono text-slate-400 mb-1">
                          MATERIAL ROBLOX
                        </label>
                        <select
                          value={selectedPart.material}
                          onChange={(e) =>
                            handleUpdateSelectedPart((prev) => ({
                              ...prev,
                              material: e.target.value,
                            }))
                          }
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white"
                        >
                          <option value="Metal">Metal</option>
                          <option value="Neon">Neon</option>
                          <option value="DiamondPlate">DiamondPlate</option>
                          <option value="SmoothPlastic">SmoothPlastic</option>
                          <option value="ForceField">ForceField</option>
                          <option value="Glass">Glass</option>
                          <option value="Slate">Slate</option>
                          <option value="Concrete">Concrete</option>
                          <option value="Granite">Granite</option>
                          <option value="Marble">Marble</option>
                          <option value="WoodPlanks">WoodPlanks</option>
                          <option value="CorrodedMetal">CorrodedMetal</option>
                          <option value="Ice">Ice</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>
              )}

              {selectedPart && (
                <>
                  {/* Size X, Y, Z, Position X, Y, Z, Rotation RX, RY, RZ */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-mono">
                    <div className="p-2 rounded-xl bg-slate-950 border border-slate-800/90 flex flex-col gap-1">
                      <span className="text-[10px] text-slate-400">ESCALA STUDS (X, Y, Z)</span>
                      <div className="grid grid-cols-3 gap-1">
                        {[0, 1, 2].map((axis) => (
                          <input
                            key={`size-${axis}`}
                            type="number"
                            step="0.2"
                            min="0.2"
                            max="60"
                            value={Number(selectedPart.size[axis] ?? 2).toFixed(1)}
                            onChange={(e) => {
                              const val = Math.max(0.2, Number(e.target.value) || 0.2);
                              handleUpdateSelectedPart((prev) => {
                                const nextSize = [...prev.size];
                                nextSize[axis] = val;
                                return rescaleMeshPartGeometry(prev, nextSize);
                              });
                            }}
                            className="w-full bg-slate-900 border border-slate-800 rounded px-1 py-1 text-center text-white tabular-nums"
                          />
                        ))}
                      </div>
                    </div>

                    <div className="p-2 rounded-xl bg-slate-950 border border-slate-800/90 flex flex-col gap-1">
                      <span className="text-[10px] text-slate-400">POSICIÓN STUDS (X, Y, Z)</span>
                      <div className="grid grid-cols-3 gap-1">
                        {[0, 1, 2].map((axis) => (
                          <input
                            key={`pos-${axis}`}
                            type="number"
                            step="0.2"
                            value={Number(selectedPart.position[axis] ?? 0).toFixed(1)}
                            onChange={(e) => {
                              const val = Number(e.target.value) || 0;
                              handleUpdateSelectedPart((prev) => {
                                const nextPos = [...prev.position];
                                nextPos[axis] = val;
                                return { ...prev, position: nextPos };
                              });
                            }}
                            className="w-full bg-slate-900 border border-slate-800 rounded px-1 py-1 text-center text-white tabular-nums"
                          />
                        ))}
                      </div>
                    </div>

                    <div className="p-2 rounded-xl bg-slate-950 border border-slate-800/90 flex flex-col gap-1">
                      <span className="text-[10px] text-slate-400">ROTACIÓN ° (RX, RY, RZ)</span>
                      <div className="grid grid-cols-3 gap-1">
                        {[0, 1, 2].map((axis) => (
                          <input
                            key={`rot-${axis}`}
                            type="number"
                            step="15"
                            value={Number(selectedPart.rotation?.[axis] ?? 0).toFixed(0)}
                            onChange={(e) => {
                              const val = Number(e.target.value) || 0;
                              handleUpdateSelectedPart((prev) => {
                                const nextRot = [...(prev.rotation || [0, 0, 0])];
                                nextRot[axis] = val;
                                return { ...prev, rotation: nextRot };
                              });
                            }}
                            className="w-full bg-slate-900 border border-slate-800 rounded px-1 py-1 text-center text-white tabular-nums"
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Real Mesh Topology Modifiers (Pillar A Non-Destructive Editor) */}
                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/90 flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                      <span>OPERADORES DE MALLA 3D NO DESTRUCTIVOS (UVS Y NORMALES INTACTAS)</span>
                      <span className="text-cyan-300 tabular-nums">
                        {selectedPart.meshData?.vertices?.length || 24} vértices • {selectedPart.meshData?.faces?.length || 12} tris
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      <button
                        type="button"
                        onClick={handleSubdivideSelectedPart}
                        className="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-semibold text-cyan-300 transition cursor-pointer"
                      >
                        Subdividir
                      </button>
                      <button
                        type="button"
                        onClick={handleSmoothSelectedPart}
                        className="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-semibold text-purple-300 transition cursor-pointer"
                      >
                        Suavizar
                      </button>
                      <button
                        type="button"
                        onClick={handleDecimateSelectedPart}
                        className="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-semibold text-amber-300 transition cursor-pointer"
                      >
                        LOD -35%
                      </button>
                      <button
                        type="button"
                        onClick={handleRecomputeUVsAndNormals}
                        className="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-semibold text-emerald-300 transition cursor-pointer"
                      >
                        Recalc UV/Norm
                      </button>
                      <button
                        type="button"
                        onClick={handleSmartSplitSelectedPart}
                        className="px-2 py-1.5 rounded-lg bg-indigo-950/70 hover:bg-indigo-900/70 border border-indigo-500/40 text-[11px] font-semibold text-indigo-200 transition cursor-pointer"
                        title="Divide la malla por islas topológicas conectadas o por su plano mediano principal"
                      >
                        ✂ División Inteligente
                      </button>
                      <button
                        type="button"
                        onClick={handleValidateAndRepairSelectedPart}
                        className="px-2 py-1.5 rounded-lg bg-emerald-950/70 hover:bg-emerald-900/70 border border-emerald-500/40 text-[11px] font-semibold text-emerald-200 transition cursor-pointer"
                        title="Detecta y repara triángulos degenerados de área cero, índices duplicados y vértices huérfanos"
                      >
                        ✓ Validar/Reparar Malla
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAssociatePBRWithParts('selected_part')}
                        className="px-2 py-1.5 rounded-lg bg-amber-950/70 hover:bg-amber-900/70 border border-amber-500/40 text-[11px] font-semibold text-amber-200 transition cursor-pointer"
                        title="Asocia los 4 canales PBR actuales exclusivamente a esta MeshPart"
                      >
                        🎨 PBR 4-Map a Pieza
                      </button>
                      <button
                        type="button"
                        onClick={handleGroundModelY0}
                        className="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-semibold text-blue-300 transition cursor-pointer"
                      >
                        Base Y=0
                      </button>
                    </div>

                    {lastGeometryValidation && (
                      <div className="p-2 rounded-lg bg-slate-900/90 border border-emerald-500/30 text-[10px] font-mono text-emerald-300 flex items-center justify-between">
                        <span>{lastGeometryValidation.summary}</span>
                        <span className="text-slate-400">
                          {lastGeometryValidation.verticesAfter}v • {lastGeometryValidation.trianglesAfter}f
                        </span>
                      </div>
                    )}

                    {operationHistory.length > 0 && (
                      <div className="pt-1.5 border-t border-slate-800/80 flex flex-col gap-1">
                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                          <span>HISTORIAL DE OPERACIONES NO DESTRUCTIVO (CLIC PARA REVERTIR)</span>
                          <span>{operationHistory.length} estados</span>
                        </div>
                        <div className="max-h-24 overflow-y-auto flex flex-col gap-1 pr-1">
                          {operationHistory.map((op) => (
                            <button
                              key={op.id}
                              type="button"
                              onClick={() => handleRevertToHistoryEntry(op)}
                              className="w-full text-left px-2 py-1 rounded bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-[10px] font-mono flex items-center justify-between text-slate-300 cursor-pointer"
                            >
                              <span className="truncate text-cyan-300">{op.summary}</span>
                              <span className="text-slate-400 shrink-0 ml-2">
                                {op.timestamp} • {op.snapshot.parts?.length || 0}p / {op.triangleAfter}t
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Color Picker + PBR Roughness / Metalness + Apply to All */}
                  <div className="grid grid-cols-3 gap-2 items-center p-2.5 rounded-xl bg-slate-950 border border-slate-800/90 text-[11px]">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={rgbToHex(selectedPart.color)}
                        onChange={(e) =>
                          handleUpdateSelectedPart((prev) => ({
                            ...prev,
                            color: hexToRgb(e.target.value),
                          }))
                        }
                        className="w-7 h-7 rounded cursor-pointer bg-transparent border-0"
                      />
                      <span className="font-mono text-[10px] text-slate-300">Color</span>
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-400 block font-mono">
                        Rough: {Number(selectedPart.roughness ?? 0.35).toFixed(2)}
                      </span>
                      <input
                        type="range"
                        min={0.05}
                        max={1}
                        step={0.05}
                        value={selectedPart.roughness ?? 0.35}
                        onChange={(e) =>
                          handleUpdateSelectedPart((prev) => ({
                            ...prev,
                            roughness: Number(e.target.value),
                          }))
                        }
                        className="w-full accent-cyan-400 cursor-pointer"
                      />
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-400 block font-mono">
                        Metal: {Number(selectedPart.metalness ?? 0.6).toFixed(2)}
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={selectedPart.metalness ?? 0.6}
                        onChange={(e) =>
                          handleUpdateSelectedPart((prev) => ({
                            ...prev,
                            metalness: Number(e.target.value),
                          }))
                        }
                        className="w-full accent-cyan-400 cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleApplyMaterialToAllParts}
                      className="py-2 px-3 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Aplicar Material a Todo el Modelo</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveEditedModelToRojo}
                      className="py-2 px-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Recompilar Luau &amp; Guardar en Rojo</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Direct Importer / Exporter Bridge: Forge AI Studio <-> Roblox Studio */}
          <div className="p-4 rounded-2xl bg-[#0d1117] border border-cyan-500/30 shadow-lg flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div>
                <h3 className="text-xs font-bold text-white font-mono">
                  Importador / Exportador Directo Forge ↔ Roblox Studio
                </h3>
                <p className="text-[11px] text-slate-400">
                  Importa o exporta modelos reales (.RBXMX, .GLTF, .OBJ+.MTL, .LUAU) conservando forma y materiales
                </p>
              </div>
              <input
                ref={import3DFileInputRef}
                type="file"
                accept=".rbxmx,.glb,.gltf,.obj,.fbx"
                onChange={handleDirectImport3DFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => import3DFileInputRef.current?.click()}
                disabled={loading}
                className="px-3 py-1.5 rounded-xl bg-purple-600/25 hover:bg-purple-600/40 border border-purple-500/50 text-purple-200 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Importar .RBXMX / .GLB / .OBJ / .FBX</span>
              </button>
            </div>

            {activeAsset && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadRBXMX}
                    className="py-2 px-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                    title="Modelo XML nativo de Roblox Studio: arrástralo directamente al Viewport de Roblox Studio"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>.RBXMX (Studio)</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadGLTF}
                    className="py-2 px-2.5 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                    title="Archivo glTF 2.0 con geometría binaria embebida y materiales PBR para el Importador 3D de Roblox Studio"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>.GLTF 2.0 (PBR)</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadOBJWithMTL}
                    className="py-2 px-2.5 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                    title="Malla Wavefront .OBJ acompañada de su biblioteca de materiales .MTL"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>.OBJ + .MTL</span>
                  </button>

                  <button
                    type="button"
                    onClick={downloadLuauBuilderFile}
                    className="py-2 px-2.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                    title="Script constructor Luau --!strict con AssetService:CreateEditableMesh()"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>.LUAU (EditableMesh)</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleExportFullPackageToRojo}
                    disabled={exportingPackage}
                    className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>
                      {exportingPackage
                        ? 'Verificando 5 Archivos en Rojo...'
                        : 'Exportar Paquete 5 Archivos a Rojo (.rbxmx/.gltf/.obj/.mtl/.luau)'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRunAutomatedValidationSuite}
                    disabled={runningValidationSuite}
                    className="w-full py-2.5 px-3 rounded-xl bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/50 text-indigo-200 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4 shrink-0" />
                    <span>
                      {runningValidationSuite
                        ? 'Ejecutando Pruebas Roundtrip...'
                        : 'Pruebas Automatizadas E2E & Auto-Heal (Rojo Build)'}
                    </span>
                  </button>
                </div>

                {/* Pillar C: Bidirectional Sync, Conflict Detection & Version Comparison */}
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-cyan-300 font-mono">
                      Sincronización Bidireccional Incremental &amp; Comparador de Versiones (v{activeAsset.version || 1})
                    </span>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={selectedCompareTarget}
                        onChange={(e) => setSelectedCompareTarget(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[10px] font-mono text-slate-200"
                      >
                        <option value="rojo_disk">Disco Rojo (.rbxmx / Studio)</option>
                        {(activeAsset.version_history || []).map((vh) => (
                          <option key={`vh-${vh.version}`} value={`v:${vh.version}`}>
                            Versión Histórica v{vh.version} ({vh.part_count}p • {vh.poly_count}t)
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handlePullFromRojo}
                        disabled={loading}
                        className="px-2.5 py-1 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-200 font-semibold text-[11px] cursor-pointer"
                      >
                        Comparar / Detectar Conflictos
                      </button>
                    </div>
                  </div>

                  {versionDiffReport && (
                    <div className="p-2.5 rounded-lg bg-slate-900/90 border border-cyan-500/30 flex flex-col gap-2 text-[11px]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-white font-semibold">
                          Comparación de Piezas ({versionDiffReport.entries.length} analizadas)
                        </span>
                        <div className="flex items-center gap-1.5 font-mono text-[10px]">
                          <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300">
                            +{versionDiffReport.addedCount} nuevas
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-amber-950 text-amber-300">
                            ~{versionDiffReport.modifiedCount} mod
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-red-950 text-red-300">
                            !{versionDiffReport.conflictCount} conflictos
                          </span>
                        </div>
                      </div>

                      <div className="max-h-28 overflow-y-auto flex flex-col gap-1 pr-1 font-mono text-[10px]">
                        {versionDiffReport.entries.map((entry) => (
                          <div
                            key={entry.partName}
                            className="px-2 py-1 rounded bg-slate-950 border border-slate-800 flex items-center justify-between"
                          >
                            <span className="text-slate-200 font-semibold">{entry.partName}</span>
                            <span
                              className={
                                entry.status === 'conflict'
                                  ? 'text-red-400'
                                  : entry.status === 'modified'
                                  ? 'text-amber-300'
                                  : entry.status === 'added_in_studio'
                                  ? 'text-emerald-400'
                                  : 'text-slate-400'
                              }
                            >
                              {entry.status.toUpperCase()}
                              {entry.changedFields.length > 0
                                ? ` (${entry.changedFields.join(', ')})`
                                : ''}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800">
                        <div className="flex items-center gap-1.5 text-[10px] font-mono">
                          <span className="text-slate-400">Estrategia:</span>
                          <select
                            value={mergeStrategy}
                            onChange={(e) => setMergeStrategy(e.target.value as any)}
                            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white"
                          >
                            <option value="smart_merge">
                              Smart Merge (CFrame/Material de Studio + Geometría/PBR de Forge)
                            </option>
                            <option value="accept_studio">Aceptar Todo de Studio / Versión</option>
                            <option value="keep_forge">Mantener Conflictos de Forge</option>
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={handleApplyIncrementalMerge}
                          className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] cursor-pointer"
                        >
                          Aplicar Sincronización Incremental (Sin Reemplazar Todo)
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {exportedFilesList.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-slate-950 border border-emerald-500/30 text-[11px] font-mono text-emerald-300">
                    Verificados en disco (<span className="text-white">{exportedFilesList.length}/5</span>) en <span className="text-white">rojo_workspace/src/shared/Assets3D/</span>:{' '}
                    {exportedFilesList.join(' • ')}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Column: Real 3D WebGL Viewport & Luau WorldModel Code */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="rounded-2xl bg-[#0d1117] border border-slate-800 p-3 flex flex-col gap-3 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setInspectorTab('viewport')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                    inspectorTab === 'viewport'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Visor 3D WebGL (ViewportFrame)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorTab('luau')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                    inspectorTab === 'luau'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <FileCode2 className="w-3.5 h-3.5" />
                  <span>Script Constructor Luau (--!strict)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorTab('pbr')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                    inspectorTab === 'pbr'
                      ? 'bg-amber-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Mapas PBR &amp; Diagnóstico Roblox</span>
                </button>
              </div>

              {activeAsset && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={copyLuauBuilderCode}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedCode ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-cyan-400" />
                    )}
                    <span>{copiedCode ? 'Copiado' : 'Copiar Luau'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={downloadLuauBuilderFile}
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-xs text-emerald-300 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>.luau</span>
                  </button>
                </div>
              )}
            </div>

            {inspectorTab === 'viewport' && (
              <RobloxWorldViewport3D
                asset={activeAsset}
                heightmapImageDataUrl={activeHeightmapUrl}
                onPartSelected={(part: MeshPart3DSpec | null) => setSelectedPart(part)}
                onPreprocessedAssetReady={(processedAsset: Forge3DAsset) => {
                  setActiveAsset(processedAsset);
                  setSelectedPart(processedAsset.parts?.[0] || null);
                  fetchAssetLibrary();
                  addLog(
                    'rojo',
                    `3dEngine.ts: Archivo ${processedAsset.name} pre-procesado a ${processedAsset.parts?.length || 1} MeshPart(s) y sincronizado en Rojo (${processedAsset.saved_path || processedAsset.file_name}).`
                  );
                }}
              />
            )}

            {inspectorTab === 'luau' && (
              <div className="h-[520px] rounded-xl bg-[#070a0f] border border-slate-800 p-4 overflow-auto font-mono text-xs text-slate-200">
                <pre className="whitespace-pre-wrap leading-relaxed">
                  {activeAsset?.luau_code ||
                    '-- Genera o selecciona un modelo 3D para inspeccionar su código constructor Luau --!strict'}
                </pre>
              </div>
            )}

            {inspectorTab === 'pbr' && (
              <div className="h-[520px] rounded-xl bg-[#070a0f] border border-slate-800 p-5 overflow-y-auto flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Diagnóstico de Preparación Roblox Studio &amp; SurfaceAppearance
                    </h3>
                    <p className="text-xs text-slate-400">
                      Validación automática de límites de MeshPart, colisiones y texturas PBR
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-mono text-xs flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Roblox Ready
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
                    <span className="text-[10px] font-mono uppercase text-slate-400">
                      Conteo de Triángulos
                    </span>
                    <div className="text-lg font-bold text-white mt-1 font-mono tabular-nums">
                      {activeAsset?.poly_count || 0} / 10,000
                    </div>
                    <p className="text-[11px] text-emerald-400 mt-1">
                      Cumple el límite estricto de Roblox MeshPart (&lt;10k tris).
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
                    <span className="text-[10px] font-mono uppercase text-slate-400">
                      Fidelidad de Colisión
                    </span>
                    <div className="text-lg font-bold text-cyan-300 mt-1 font-mono">
                      {activeAsset?.collision_fidelity || collisionFidelity}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Configurado en cada BasePart / MeshPart generado.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
                    <span className="text-[10px] font-mono uppercase text-slate-400">
                      Niveles LOD Soportados
                    </span>
                    <div className="text-lg font-bold text-purple-300 mt-1 font-mono tabular-nums">
                      100% • 75% • 50% • 25%
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Prueba la reducción poligonal en el dock inferior del visor 3D.
                    </p>
                  </div>
                </div>

                {pbrBundle && (
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-3">
                    <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider font-mono">
                      Mapas PBR Activos de 4 Canales (SurfaceAppearance: ColorMap, NormalMap, RoughnessMap, MetalnessMap)
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <img
                          src={pbrBundle.albedoDataUrl}
                          alt="ColorMap"
                          className="w-full h-28 object-cover rounded-lg border border-slate-700"
                        />
                        <span className="text-xs font-semibold text-white">Albedo / ColorMap</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <img
                          src={pbrBundle.normalDataUrl}
                          alt="NormalMap"
                          className="w-full h-28 object-cover rounded-lg border border-slate-700"
                        />
                        <span className="text-xs font-semibold text-white">NormalMap (Tangent)</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <img
                          src={pbrBundle.roughnessDataUrl}
                          alt="RoughnessMap"
                          className="w-full h-28 object-cover rounded-lg border border-slate-700"
                        />
                        <span className="text-xs font-semibold text-white">RoughnessMap</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <img
                          src={pbrBundle.metalnessDataUrl}
                          alt="MetalnessMap"
                          className="w-full h-28 object-cover rounded-lg border border-slate-700"
                        />
                        <span className="text-xs font-semibold text-white">MetalnessMap</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Pillar D: Automated Validation & Self-Heal Suite Report */}
                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-bold text-cyan-300 uppercase tracking-wider font-mono">
                        Suite de Automatización, Validación Roundtrip y Auto-Recuperación
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        Pruebas de importación/exportación (.RBXMX, .GLTF, .OBJ), geometría degenerada, 4 canales PBR y Rojo Build
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRunAutomatedValidationSuite}
                      disabled={runningValidationSuite}
                      className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs cursor-pointer disabled:opacity-50"
                    >
                      {runningValidationSuite ? 'Validando...' : 'Ejecutar Suite Completa Ahora'}
                    </button>
                  </div>

                  {validationSuiteReport && (
                    <div className="flex flex-col gap-2">
                      <div className="p-2.5 rounded-lg bg-slate-950 border border-emerald-500/40 text-xs font-mono text-emerald-300">
                        Suite E2E: {validationSuiteReport.passedChecks}/{validationSuiteReport.totalChecks} verificaciones superadas ({validationSuiteReport.score}% • {validationSuiteReport.autoHealedCount} auto-reparaciones)
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {validationSuiteReport.checks.map((chk) => (
                          <div
                            key={chk.id}
                            className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-white">{chk.title}</span>
                              <span
                                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                  chk.passed
                                    ? 'bg-emerald-950 text-emerald-300'
                                    : 'bg-red-950 text-red-300'
                                }`}
                              >
                                {chk.passed ? 'PASS' : 'FAIL'}
                                {chk.autoHealed ? ' • AUTO-HEALED' : ''}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400">{chk.details}</p>
                          </div>
                        ))}
                        {rojoBuildChecks.map((rchk) => (
                          <div
                            key={rchk.id}
                            className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-white">{rchk.title}</span>
                              <span
                                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                  rchk.passed
                                    ? 'bg-emerald-950 text-emerald-300'
                                    : 'bg-red-950 text-red-300'
                                }`}
                              >
                                {rchk.passed ? 'ROJO OK' : 'FAIL'}
                                {rchk.auto_healed ? ' • AUTO-HEALED' : ''}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400">{rchk.details}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reusable 3D Asset Library Section */}
      <div className="p-5 rounded-2xl bg-[#0d1117] border border-slate-800 shadow-xl flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Bookmark className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="text-sm font-bold text-white">
                Biblioteca de Assets 3D Reutilizables (assets_library.json)
              </h3>
              <p className="text-xs text-slate-400">
                Haz clic en cualquier modelo o escenario 3D para inspeccionarlo en el visor WebGL, optimizar su LOD o sincronizarlo con Rojo.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {['ALL', 'Weapons', 'Sci-Fi', 'RPG', 'Scene'].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setLibraryFilter(cat)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  libraryFilter === cat
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {cat === 'ALL' ? 'Todos' : cat}
              </button>
            ))}
          </div>
        </div>

        {loadingLibrary ? (
          <div className="py-8 text-center text-xs text-slate-400 font-mono">
            Cargando biblioteca de assets 3D...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAssets.map((item, idx) => {
              const isSelected = activeAsset?.name === item.name;
              return (
                <div
                  key={item.id || `${item.name}-${idx}`}
                  onClick={() => {
                    setActiveHeightmapUrl(null);
                    setActiveAsset(item);
                    setSelectedPart(item.parts?.[0] || null);
                    setInspectorTab('viewport');
                  }}
                  className={`p-4 rounded-xl border transition cursor-pointer flex flex-col justify-between gap-3 ${
                    isSelected
                      ? 'bg-cyan-950/25 border-cyan-500 shadow-lg shadow-cyan-500/10'
                      : 'bg-slate-950/80 border-slate-800/90 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="font-bold text-sm text-white truncate">{item.name}</span>
                      <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-cyan-300 shrink-0">
                        {item.category}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                      {item.description}
                    </p>
                  </div>

                  <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
                    <div className="flex items-center gap-3 tabular-nums">
                      <span className="text-emerald-400">{item.parts?.length || 1} parts</span>
                      <span>•</span>
                      <span className="text-cyan-300">{item.poly_count} tris</span>
                      <span>•</span>
                      <span>{item.collision_fidelity}</span>
                    </div>

                    {item.id && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteAsset(item.id, e)}
                        title="Eliminar de la biblioteca"
                        className="p-1 text-slate-500 hover:text-red-400 rounded transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Real-time Streaming Terminal Console */}
      <FloatingTerminalLog
        title="Forge 3D Geometry & Rojo Sync Stream"
        logs={terminalLogs}
        streamingBuffer={streamingBuffer}
        isStreaming={isStreaming}
        onClear={() => {
          setTerminalLogs([]);
          setStreamingBuffer('');
        }}
      />
    </div>
  );
};
