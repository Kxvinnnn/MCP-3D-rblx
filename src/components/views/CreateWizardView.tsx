import React, { useState, useRef } from 'react';
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Image as ImageIcon,
  FileText,
  Upload,
  Mountain,
  Sliders,
  Eye,
  Send,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Palette,
  AlertCircle,
  KeyRound,
  RefreshCw,
} from 'lucide-react';
import { useForge } from '../../context/ForgeContext.tsx';
import { Forge3DAsset } from '../../utils/roblox3DEngine.ts';
import { SseStreamParser, SseMessage } from '../../utils/sseParser.ts';
import { parseNaturalLanguageToTreeParams } from '../../utils/treePromptParser.ts';
import {
  forgeFetch,
  getStoredForgeToken,
  verifyAndSaveForgeToken,
} from '../../utils/forgeApiClient.ts';
import { RobloxWorldViewport3D } from '../RobloxWorldViewport3D.tsx';
import {
  WizardStep,
  ObjectCategory,
  InputMethod,
  DetailLevel,
  TreeArchetypePreset,
  WIZARD_CATEGORY_CARDS,
  TREE_ARCHETYPE_PRESETS,
  CATEGORY_SUGGESTIONS,
  POLY_BUDGETS,
} from './wizard/wizardData.ts';
import { WizardStep3Params } from './wizard/WizardStep3Params.tsx';

export const CreateWizardView: React.FC = () => {
  const {
    setActiveTab,
    setActiveAsset,
    pushToStudio,
    applyAssetChange,
    setNotification,
    fetchAssetLibrary,
  } = useForge();

  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [category, setCategory] = useState<ObjectCategory>('Trees & Vegetation');
  const [inputMethod, setInputMethod] = useState<InputMethod>('text');
  const [generationMode, setGenerationMode] = useState<'procedural' | 'hybrid' | 'ai' | 'image_to_3d'>('hybrid');
  const [seed, setSeed] = useState<string>('forge-tree-2026');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('ancient-oak');
  const [showAdvancedTreeParams, setShowAdvancedTreeParams] = useState<boolean>(false);
  const [loadingBenchmarkId, setLoadingBenchmarkId] = useState<string | null>(null);

  // Tree Procedural Parameters (23 configurable parameters)
  const [treeHeight, setTreeHeight] = useState<number>(14);
  const [treeWidth, setTreeWidth] = useState<number>(10);
  const [trunkThickness, setTrunkThickness] = useState<number>(1.6);
  const [trunkLean, setTrunkLean] = useState<number>(0);
  const [trunkCurvature, setTrunkCurvature] = useState<number>(0.15);
  const [rootFlareScale, setRootFlareScale] = useState<number>(1.0);
  const [branchCount, setBranchCount] = useState<number>(4);
  const [branchLength, setBranchLength] = useState<number>(4.0);
  const [branchDistribution, setBranchDistribution] = useState<'tiered' | 'whorled' | 'alternating' | 'canopy_top'>('tiered');
  const [canopyShape, setCanopyShape] = useState<'spherical' | 'conical' | 'layered' | 'weeping'>('spherical');
  const [canopySize, setCanopySize] = useState<number>(1.0);
  const [leafDistribution, setLeafDistribution] = useState<'dense' | 'balanced' | 'sparse' | 'clustered'>('balanced');
  const [foliageCount, setFoliageCount] = useState<number>(4);
  const [foliageDensity, setFoliageDensity] = useState<number>(1.0);
  const [trunkMaterial, setTrunkMaterial] = useState<string>('Wood');
  const [leafMaterial, setLeafMaterial] = useState<string>('Grass');
  const [trunkColor, setTrunkColor] = useState<string>('#6e482b');
  const [leafColor, setLeafColor] = useState<string>('#34843d');
  const [treeVariation, setTreeVariation] = useState<number>(0.25);
  const [leafVariation, setLeafVariation] = useState<number>(0.25);
  const [colorVariation, setColorVariation] = useState<number>(0.2);
  const [lodLevel] = useState<0 | 1 | 2>(0);
  const [parsedPromptBadges, setParsedPromptBadges] = useState<string[]>([]);
  const [treeParamsManuallyEdited, setTreeParamsManuallyEdited] = useState<boolean>(false);

  // Input states
  const [prompt, setPrompt] = useState<string>(
    'Árbol roble ancestral para Roblox con tronco robusto texturizado, raíces expuestas en Y=0 y copa frondosa.'
  );
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [heightmapDepth, setHeightmapDepth] = useState<number>(3.5);
  const [heightmapRes, setHeightmapRes] = useState<number>(48);

  // Settings states
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('medium');
  const [collisionFidelity, setCollisionFidelity] = useState<'Hull' | 'Box' | 'PreciseConvexDecomposition'>('Hull');
  const [saveToRojo] = useState<boolean>(true);

  // Generation states
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStatus, setProgressStatus] = useState<string>('Iniciando...');
  const [activityLogs, setActivityLogs] = useState<string[]>([]);
  const [showTechnicalLogs, setShowTechnicalLogs] = useState<boolean>(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [authTokenRequired, setAuthTokenRequired] = useState<boolean>(false);
  const [manualTokenInput, setManualTokenInput] = useState<string>(() => getStoredForgeToken());
  const [tokenValidationError, setTokenValidationError] = useState<string | null>(null);
  const [isSavingToken, setIsSavingToken] = useState<boolean>(false);

  // Result state
  const [generatedAsset, setGeneratedAsset] = useState<Forge3DAsset | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const applyTreePreset = (preset: TreeArchetypePreset) => {
    setSelectedPresetId(preset.id);
    setPrompt(preset.prompt);
    setSeed(preset.seed);
    setTreeHeight(preset.height);
    setTreeWidth(preset.width);
    setTrunkThickness(preset.trunkThickness);
    setTrunkLean(preset.trunkLean);
    setTrunkCurvature(preset.trunkCurvature);
    setRootFlareScale(preset.rootFlareScale);
    setBranchCount(preset.branchCount);
    setBranchLength(preset.branchLength);
    setBranchDistribution(preset.branchDistribution);
    setCanopyShape(preset.canopyShape);
    setCanopySize(preset.canopySize);
    setLeafDistribution(preset.leafDistribution);
    setFoliageCount(preset.foliageCount);
    setFoliageDensity(preset.foliageDensity);
    setTrunkColor(preset.trunkColor);
    setLeafColor(preset.leafColor);
    setTreeParamsManuallyEdited(true);
    setNotification({
      type: 'info',
      message: `Estilo '${preset.label}' listo (${preset.height} studs). ¡Haz clic en Crear Modelo 3D!`,
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setReferenceImage(dataUrl);
      setGenerationMode('image_to_3d');
    };
    reader.readAsDataURL(file);
  };

  const handleLoadBenchmarkCase = async (caseId: string) => {
    setLoadingBenchmarkId(caseId);
    try {
      const res = await forgeFetch('/api/v1/benchmarks/generate-case', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_id: caseId,
          save_to_rojo: true,
          save_to_library: true,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.asset) {
        setGeneratedAsset(data.asset);
        applyAssetChange(data.asset, `Benchmark: ${data.asset.name}`, 'add_part');
        setActiveAsset(data.asset);
        fetchAssetLibrary();
        setCurrentStep(5);
        setNotification({
          type: 'success',
          message: `Benchmark '${data.benchmark?.title || data.asset.name}' cargado (${data.asset.parts.length} piezas, ${data.asset.poly_count} tris).`,
        });
      }
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: `Error cargando benchmark: ${err.message}`,
      });
    } finally {
      setLoadingBenchmarkId(null);
    }
  };

  const abortControllerRef = useRef<AbortController | null>(null);

  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setProgressStatus('Generación cancelada');
    setActivityLogs((prev) => [...prev, 'Operación cancelada por el usuario.']);
    setCurrentStep(2);
    setNotification({ type: 'info', message: 'Generación 3D cancelada.' });
  };

  const applyParsedTreePromptToState = (rawPrompt: string) => {
    const parsed = parseNaturalLanguageToTreeParams(rawPrompt);
    const p = parsed.params;
    if (p.height !== undefined) setTreeHeight(p.height);
    if (p.width !== undefined) setTreeWidth(p.width);
    if (p.trunkThickness !== undefined) setTrunkThickness(p.trunkThickness);
    if (p.trunkLean !== undefined) setTrunkLean(p.trunkLean);
    if (p.trunkCurvature !== undefined) setTrunkCurvature(p.trunkCurvature);
    if (p.rootFlareScale !== undefined) setRootFlareScale(p.rootFlareScale);
    if (p.branchCount !== undefined) setBranchCount(p.branchCount);
    if (p.branchLength !== undefined) setBranchLength(p.branchLength);
    if (p.branchDistribution) setBranchDistribution(p.branchDistribution);
    if (p.canopyShape) setCanopyShape(p.canopyShape);
    if (p.canopySize !== undefined) setCanopySize(p.canopySize);
    if (p.leafDistribution) setLeafDistribution(p.leafDistribution);
    if (p.foliageCount !== undefined) setFoliageCount(p.foliageCount);
    if (p.foliageDensity !== undefined) setFoliageDensity(p.foliageDensity);
    if (p.trunkMaterial) setTrunkMaterial(p.trunkMaterial);
    if (p.leafMaterial) setLeafMaterial(p.leafMaterial);
    if (p.trunkColor) setTrunkColor(p.trunkColor);
    if (p.leafColor) setLeafColor(p.leafColor);
    if (p.variation !== undefined) setTreeVariation(p.variation);
    if (p.leafVariation !== undefined) setLeafVariation(p.leafVariation);
    if (p.colorVariation !== undefined) setColorVariation(p.colorVariation);
    if (p.detailLevel) setDetailLevel(p.detailLevel);
    setParsedPromptBadges(parsed.detectedKeywords);
    return parsed;
  };

  const handleStartGeneration = async () => {
    if (category === 'Trees & Vegetation' && inputMethod === 'text' && !treeParamsManuallyEdited) {
      applyParsedTreePromptToState(prompt);
    }

    setCurrentStep(4);
    setIsGenerating(true);
    setGenerationError(null);
    setAuthTokenRequired(false);
    setTokenValidationError(null);
    setProgressPercent(15);
    setProgressStatus('Construyendo tu modelo 3D...');
    setActivityLogs([
      `Iniciando generación para '${category}'...`,
      `Presupuesto: ${POLY_BUDGETS[detailLevel].tris} triángulos`,
      `Fidelidad de colisión: ${collisionFidelity}`,
    ]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const effectiveSeed =
      seed.trim() && seed.trim() !== 'forge-tree-2026' && seed.trim() !== 'forge-seed-2026'
        ? seed.trim()
        : `forge-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString(36).slice(-4)}`;

    try {
      const response = await forgeFetch('/api/v1/generate-3d-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: inputMethod === 'text' ? prompt : `Asset de tipo ${category} generado con referencia/relieve`,
          asset_type: category === 'Ambient & Decoration' && prompt.toLowerCase().includes('escena') ? 'Scene3D' : 'Model3D',
          category,
          generation_mode: inputMethod === 'image' && referenceImage ? 'image_to_3d' : generationMode,
          seed: effectiveSeed,
          manually_edited_fields: treeParamsManuallyEdited
            ? ['height', 'width', 'trunkThickness', 'trunkLean', 'trunkCurvature', 'rootFlareScale', 'branchCount', 'branchLength', 'canopyShape', 'leafColor', 'trunkColor']
            : [],
          tree_params:
            category === 'Trees & Vegetation'
              ? {
                  seed: effectiveSeed,
                  height: treeHeight,
                  width: treeWidth,
                  trunkThickness,
                  trunkLean,
                  trunkCurvature,
                  rootFlareScale,
                  branchCount,
                  branchLength,
                  branchDistribution,
                  canopyShape,
                  canopySize,
                  leafDistribution,
                  foliageCount,
                  foliageDensity,
                  trunkMaterial,
                  leafMaterial,
                  trunkColor,
                  leafColor,
                  variation: treeVariation,
                  leafVariation,
                  colorVariation,
                  detailLevel,
                  lodLevel,
                }
              : undefined,
          lodLevel,
          detailLevel,
          target_poly_budget: POLY_BUDGETS[detailLevel].tris,
          collision_fidelity: collisionFidelity,
          save_to_rojo: saveToRojo,
          save_to_library: true,
          reference_image_base64: referenceImage ? referenceImage.split(',')[1] : undefined,
          reference_image_mime_type: 'image/png',
        }),
      });

      if (!response.ok || !response.body) {
        const errJson = await response.json().catch(() => ({}));
        if (response.status === 401) {
          setAuthTokenRequired(true);
        }
        throw new Error(errJson.detail || errJson.error || `Error del servidor HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const sseParser = new SseStreamParser();
      let assetCompleted: Forge3DAsset | null = null;

      const handleSseMessage = (msg: SseMessage) => {
        let payload: any = null;
        try {
          payload = JSON.parse(msg.data);
        } catch {
          return;
        }

        if (msg.event === 'error' || payload.type === 'error' || payload.error) {
          const errMsg = payload.error || payload.message || 'Error en la generación 3D';
          throw new Error(errMsg);
        }

        if (payload.type === 'stage') {
          setProgressStatus(payload.message || 'Procesando...');
          if (payload.stage === 'init') setProgressPercent(20);
          else if (payload.stage === 'geometry' || payload.stage === 'synthesis') setProgressPercent(50);
          else if (payload.stage === 'materials' || payload.stage === 'pbr') setProgressPercent(75);
          else if (payload.stage === 'validation') setProgressPercent(90);
          setActivityLogs((prev) => [...prev, payload.message]);
        } else if (payload.type === 'log') {
          setActivityLogs((prev) => [...prev, payload.message]);
        } else if (payload.type === 'rojo_write') {
          setActivityLogs((prev) => [
            ...prev,
            payload.saved
              ? `Guardado en disco Rojo: ${payload.path}`
              : `Rojo: ${payload.message}`,
          ]);
        } else if (payload.type === 'done' || payload.type === 'complete') {
          const res = payload.data || payload.result;
          if (res) {
            assetCompleted = res;
            setProgressPercent(100);
            setProgressStatus(`¡Modelo '${res.name}' construido con éxito!`);
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const msg of sseParser.feed(text)) {
          handleSseMessage(msg);
        }
      }

      const finalDecoded = decoder.decode();
      if (finalDecoded) {
        for (const msg of sseParser.feed(finalDecoded)) {
          handleSseMessage(msg);
        }
      }

      for (const msg of sseParser.flush()) {
        handleSseMessage(msg);
      }

      const isValidForgeAsset = (obj: any): obj is Forge3DAsset => {
        return (
          obj &&
          typeof obj === 'object' &&
          typeof obj.name === 'string' &&
          obj.name.trim().length > 0 &&
          Array.isArray(obj.parts) &&
          obj.parts.length > 0 &&
          obj.parts.every((p: any) => p && typeof p === 'object' && typeof p.name === 'string')
        );
      };

      if (isValidForgeAsset(assetCompleted)) {
        const completedAsset: Forge3DAsset = assetCompleted;
        setGeneratedAsset(completedAsset);
        applyAssetChange(completedAsset, `Generado: ${completedAsset.name}`, 'add_part');
        setActiveAsset(completedAsset);
        fetchAssetLibrary();
        setIsGenerating(false);
        setCurrentStep(5);
        setNotification({
          type: 'success',
          message: `¡Modelo '${completedAsset.name}' creado con ${completedAsset.parts.length} piezas!`,
        });
      } else {
        throw new Error('La respuesta del motor 3D no devolvió una estructura 3D válida.');
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        setIsGenerating(false);
        setProgressStatus('Generación cancelada por el usuario');
        return;
      }
      const errMsg = err.message || 'Error desconocido';
      setIsGenerating(false);
      setGenerationError(errMsg);
      setProgressStatus(`Error: ${errMsg}`);
      setActivityLogs((prev) => [...prev, `Error: ${errMsg}`]);
      setNotification({
        type: 'error',
        message: `Error al generar modelo: ${errMsg}`,
      });
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleSaveTokenAndRetry = async () => {
    setIsSavingToken(true);
    setTokenValidationError(null);
    const result = await verifyAndSaveForgeToken(manualTokenInput);
    setIsSavingToken(false);
    if (!result.ok) {
      setTokenValidationError(result.error || 'Token inválido.');
      return;
    }
    await handleStartGeneration();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12 animate-slide-up">
      {/* Colorful Wizard Container */}
      <div className="bg-slate-900/85 border border-violet-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl">
        {/* Interactive Clickable Step Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <p className="text-xs font-bold text-violet-300">
              Creador Guiado 3D
            </p>
            <h2 className="text-xl sm:text-2xl font-extrabold text-white mt-1">
              {currentStep === 1 && 'Paso 1: ¿Qué quieres construir hoy?'}
              {currentStep === 2 && 'Paso 2: Elige un estilo o escribe tu idea'}
              {currentStep === 3 && 'Paso 3: Cambia el tamaño y los colores'}
              {currentStep === 4 && '¡Armando tu modelo 3D...!'}
              {currentStep === 5 && '¡Tu modelo 3D quedó listo!'}
            </h2>
          </div>

          {/* Clickable Step Tabs */}
          <div className="flex items-center gap-1.5 bg-slate-950/90 p-1.5 rounded-2xl border border-slate-800 overflow-x-auto">
            {[
              { step: 1 as WizardStep, label: '1. ¿Qué crear?' },
              { step: 2 as WizardStep, label: '2. Estilo' },
              { step: 3 as WizardStep, label: '3. Tamaño y Color' },
              ...(generatedAsset ? [{ step: 5 as WizardStep, label: '¡Listo!' }] : []),
            ].map((item) => {
              const isCurrent = currentStep === item.step;
              return (
                <button
                  key={item.step}
                  type="button"
                  disabled={isGenerating}
                  onClick={() => setCurrentStep(item.step)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                    isCurrent
                      ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  } ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* STEP 1: Colorful Object Category Selection */}
        {currentStep === 1 && (
          <div className="space-y-6 pt-6">
            <p className="text-slate-300 text-sm">
              Haz clic en una categoría para seleccionarla (o haz <strong>doble clic</strong> para avanzar directamente al siguiente paso):
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {WIZARD_CATEGORY_CARDS.map((item) => {
                const isSelected = category === item.id;
                const IconComponent = item.icon;
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      setCategory(item.id);
                      const firstSug = CATEGORY_SUGGESTIONS[item.id]?.[0];
                      if (firstSug) setPrompt(firstSug);
                    }}
                    onDoubleClick={() => {
                      setCategory(item.id);
                      setCurrentStep(2);
                    }}
                    className={`forge-card-hover p-4 rounded-2xl border cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? `${item.activeBorder} shadow-lg`
                        : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div
                          className={`w-10 h-10 rounded-xl bg-gradient-to-br ${item.gradient} flex items-center justify-center text-white shadow-md`}
                        >
                          <IconComponent className="w-5 h-5" />
                        </div>
                        {isSelected && <CheckCircle2 className="w-5 h-5 text-white" />}
                      </div>
                      <h3 className="font-extrabold text-sm text-white">
                        {item.title}
                      </h3>
                      <p className="text-slate-400 text-xs leading-relaxed">
                        {item.desc}
                      </p>
                    </div>

                    <div className="mt-4 pt-2 border-t border-white/10 flex items-center justify-between">
                      <span className={`text-[11px] font-bold ${isSelected ? 'text-white' : 'text-slate-500'}`}>
                        {isSelected ? '✓ Seleccionado' : 'Clic para elegir'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* FASE 7: 8 Canonical Visual Benchmarks Quick Loader */}
            <div className="bg-slate-950/90 border border-cyan-500/30 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="text-xs font-extrabold text-cyan-300 uppercase tracking-wider block">
                    Suite de Benchmarks Visuales 3D (8 Casos Canónicos)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Inspecciona al instante los 8 modelos de referencia con geometría especializada, LODs y jerarquía:
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'stylized_tree', label: '1. Árbol Roble', sub: 'Raíces + Sub-ramas' },
                  { id: 'fantasy_tree', label: '2. Árbol Fantástico', sub: 'Cristales Neón' },
                  { id: 'detailed_rock', label: '3. Roca Detallada', sub: 'Icosfera + Estratos' },
                  { id: 'modular_building', label: '4. Edificio Modular', sub: 'Arco + Ventanas + Tejado' },
                  { id: 'ergonomic_chair', label: '5. Silla / Trono', sub: 'Patas + Cojín + Brazos' },
                  { id: 'street_lamp', label: '6. Lámpara / Farol', sub: 'Poste + Cristal + Luz' },
                  { id: 'mechanical_gearbox', label: '7. Objeto Mecánico', sub: 'Engranajes Dentados' },
                  { id: 'coherent_scene', label: '8. Escenario 3D', sub: 'Multi-Asset Zonas' },
                ].map((bm) => (
                  <button
                    key={bm.id}
                    type="button"
                    disabled={loadingBenchmarkId !== null}
                    onClick={() => handleLoadBenchmarkCase(bm.id)}
                    className="p-2.5 rounded-xl bg-slate-900 hover:bg-cyan-950/50 border border-slate-800 hover:border-cyan-500/50 text-left transition cursor-pointer disabled:opacity-50"
                  >
                    <div className="text-xs font-bold text-white truncate">
                      {loadingBenchmarkId === bm.id ? 'Cargando...' : bm.label}
                    </div>
                    <div className="text-[10px] text-cyan-400 font-mono truncate">{bm.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* MISIÓN CRÍTICA: Universal Freeform Generalization Suite (Vaca + 7 Objetos Libres) */}
            <div className="bg-slate-950/90 border border-emerald-500/35 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="text-xs font-extrabold text-emerald-300 uppercase tracking-wider block">
                    Generación Libre de Objetos Arbitrarios (Vaca Anatómica + 7 Pruebas de Generalización)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Genera e inspecciona en 3D real animales cuadrúpedos, criaturas aladas, vehículos y estatuas sin plantillas rígidas:
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'bovine_cow_acceptance', label: 'Vaca Adulta (Obligatorio)', sub: '4 Patas + Manchas B/N + Cuernos' },
                  { id: 'generalization_horse', label: '1. Caballo Adulto', sub: 'Cuello Arqueado + Crin + Cascos' },
                  { id: 'generalization_dog', label: '2. Perro Anatómico', sub: 'Tórax + Hocico + 4 Patas' },
                  { id: 'generalization_dragon', label: '3. Dragón Alado', sub: '2 Alas + Cuernos + 4 Patas' },
                  { id: 'generalization_motorcycle', label: '4. Motocicleta 3D', sub: '2 Ruedas Toroidales + Motor' },
                  { id: 'generalization_human_statue', label: '5. Estatua Humana', sub: 'Pedestal + 2 Brazos + 2 Piernas' },
                  { id: 'generalization_fantasy_tree', label: '6. Árbol Fantástico', sub: 'Raíces + Cristales + Copa' },
                  { id: 'generalization_medieval_house', label: '7. Casa Medieval', sub: 'Fachada + Arco + Tejado' },
                ].map((bm) => (
                  <button
                    key={bm.id}
                    type="button"
                    disabled={loadingBenchmarkId !== null}
                    onClick={() => handleLoadBenchmarkCase(bm.id)}
                    className="p-2.5 rounded-xl bg-slate-900 hover:bg-emerald-950/50 border border-slate-800 hover:border-emerald-500/50 text-left transition cursor-pointer disabled:opacity-50"
                  >
                    <div className="text-xs font-bold text-white truncate">
                      {loadingBenchmarkId === bm.id ? 'Generando...' : bm.label}
                    </div>
                    <div className="text-[10px] text-emerald-400 font-mono truncate">{bm.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-xs sm:text-sm font-extrabold flex items-center gap-2 cursor-pointer transition shadow-xl shadow-violet-600/30 whitespace-nowrap forge-btn-press"
              >
                <span>Siguiente: Elegir Estilo</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: 1-Click Presets & Simple Description */}
        {currentStep === 2 && (
          <div className="space-y-6 pt-6">
            {/* 1-Click Tree Archetype Presets when Trees & Vegetation is active */}
            {category === 'Trees & Vegetation' && (
              <div className="bg-gradient-to-br from-emerald-950/60 via-slate-950/90 to-slate-950 border border-emerald-500/40 rounded-2xl p-5 space-y-3.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="text-sm font-extrabold text-emerald-300 block">
                      Estilos de Árboles Listos en 1 Clic
                    </span>
                    <span className="text-xs text-slate-300">
                      Elige cualquiera de estos 5 árboles preconfigurados y pulsa el botón morado de abajo para crearlo al instante:
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {TREE_ARCHETYPE_PRESETS.map((preset) => {
                    const isSelected = selectedPresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyTreePreset(preset)}
                        className={`forge-card-hover p-3.5 rounded-2xl border text-left cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'bg-emerald-900/40 border-emerald-400 shadow-lg shadow-emerald-950/50'
                            : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="w-4 h-4 rounded-full border border-white/30 shadow-sm shrink-0"
                                style={{ backgroundColor: preset.leafColor }}
                              />
                              <span
                                className="w-3 h-3 rounded-full border border-white/30 shrink-0"
                                style={{ backgroundColor: preset.trunkColor }}
                              />
                            </div>
                            <span className="text-[10px] font-mono text-emerald-300 font-bold tabular-nums">
                              {preset.height} studs
                            </span>
                          </div>
                          <div className="text-xs font-extrabold text-white leading-tight">
                            {preset.label}
                          </div>
                          <div className="text-[11px] text-slate-300 leading-snug">
                            {preset.subtitle}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Simple Input Method Selector Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-950/80 p-1.5 rounded-2xl border border-slate-800">
              {[
                { id: 'text', label: 'Escribir Idea', icon: FileText },
                { id: 'image', label: 'Subir Imagen 2D', icon: ImageIcon },
                { id: 'heightmap', label: 'Relieve 3D', icon: Mountain },
                { id: 'file3d', label: 'Archivo 3D', icon: Upload },
              ].map((m) => {
                const Icon = m.icon;
                const active = inputMethod === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setInputMethod(m.id as InputMethod)}
                    className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Sub-view: Text Prompt */}
            {inputMethod === 'text' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-200 mb-1.5">
                    Describe cómo quieres tu modelo 3D:
                  </label>
                  <textarea
                    rows={3}
                    value={prompt}
                    onChange={(e) => {
                      setPrompt(e.target.value);
                      setTreeParamsManuallyEdited(false);
                    }}
                    placeholder="Ejemplo: Árbol de fantasía con copa rojiza frondosa, tronco curvado y raíces expuestas..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-fuchsia-500 resize-none leading-relaxed"
                  />
                </div>

                {/* Inspiration Tags */}
                <div className="space-y-2">
                  <span className="text-[11px] text-slate-400 font-semibold block">
                    O toca una de estas ideas rápidas para rellenar el texto:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORY_SUGGESTIONS[category]?.map((sug, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setPrompt(sug);
                          setTreeParamsManuallyEdited(false);
                        }}
                        className="text-xs text-slate-200 hover:text-white bg-slate-950 hover:bg-violet-950/60 border border-slate-800 hover:border-violet-500/50 px-3.5 py-2 rounded-xl transition text-left cursor-pointer"
                      >
                        {sug}
                      </button>
                    ))}
                  </div>
                  {parsedPromptBadges.length > 0 && category === 'Trees & Vegetation' && (
                    <div className="text-[11px] text-emerald-400 font-mono">
                      Rasgos detectados: {parsedPromptBadges.join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Sub-view: Image 2D */}
            {inputMethod === 'image' && (
              <div className="space-y-4">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleImageUpload}
                />
                <div
                  onClick={() => imageInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-800 hover:border-fuchsia-500 rounded-2xl p-8 text-center cursor-pointer transition bg-slate-950/40"
                >
                  {referenceImage ? (
                    <div className="space-y-3">
                      <img
                        src={referenceImage}
                        alt="Referencia"
                        className="max-h-48 mx-auto rounded-lg border border-slate-700 object-contain"
                      />
                      <p className="text-xs text-fuchsia-400 font-bold">
                        Imagen cargada. Haz clic para cambiarla.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <ImageIcon className="w-8 h-8 text-fuchsia-400 mx-auto" />
                      <p className="text-xs font-bold text-slate-200">
                        Haz clic para subir una imagen PNG, JPG o WebP
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Se construirá un modelo 3D inspirado en los colores y silueta de tu imagen.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Sub-view: Procedural Heightmap */}
            {inputMethod === 'heightmap' && (
              <div className="space-y-4 bg-slate-950/60 p-5 rounded-2xl border border-slate-800">
                <p className="text-xs text-slate-300">
                  Genera un terreno o relieve 3D extruyendo alturas automáticamente:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">
                      Altura del Relieve:{' '}
                      <span className="text-white font-mono tabular-nums">{heightmapDepth} studs</span>
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={12}
                      step={0.5}
                      value={heightmapDepth}
                      onChange={(e) => setHeightmapDepth(parseFloat(e.target.value))}
                      className="w-full accent-fuchsia-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">
                      Detalle de Malla:{' '}
                      <span className="text-white font-mono tabular-nums">{heightmapRes}x{heightmapRes}</span>
                    </label>
                    <input
                      type="range"
                      min={24}
                      max={64}
                      step={8}
                      value={heightmapRes}
                      onChange={(e) => setHeightmapRes(parseInt(e.target.value, 10))}
                      className="w-full accent-fuchsia-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Sub-view: 3D File */}
            {inputMethod === 'file3d' && (
              <div className="space-y-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".rbxmx,.glb,.obj"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setPrompt(`Modelo optimizado derivado de ${file.name}`);
                      setNotification({ type: 'info', message: `Archivo ${file.name} listo para transformar.` });
                    }
                  }}
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-800 hover:border-fuchsia-500 rounded-2xl p-8 text-center cursor-pointer transition bg-slate-950/40"
                >
                  <Upload className="w-8 h-8 text-cyan-400 mx-auto mb-2" />
                  <p className="text-xs font-bold text-slate-200">
                    Subir archivo .rbxmx, .glb o .obj existente
                  </p>
                </div>
              </div>
            )}

            {/* Clear Action Bar: Primary = Create Now! Secondary = Customize Details */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Cambiar Tipo</span>
              </button>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (category === 'Trees & Vegetation' && inputMethod === 'text' && !treeParamsManuallyEdited) {
                      applyParsedTreePromptToState(prompt);
                    }
                    setCurrentStep(3);
                  }}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
                >
                  <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Personalizar Tamaño y Colores (Opcional)</span>
                </button>

                <button
                  type="button"
                  onClick={handleStartGeneration}
                  className="px-6 py-3 rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white text-xs sm:text-sm font-extrabold flex items-center gap-2 cursor-pointer transition hover:scale-[1.02] shadow-xl shadow-fuchsia-600/30 whitespace-nowrap forge-btn-press"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>¡Crear Modelo 3D Ahora!</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Simplified Essential Controls + Optional Collapsible Advanced Section */}
        {currentStep === 3 && (
          <WizardStep3Params
            category={category}
            treeHeight={treeHeight}
            onChangeTreeHeight={(val) => {
              setTreeParamsManuallyEdited(true);
              setTreeHeight(val);
            }}
            treeWidth={treeWidth}
            onChangeTreeWidth={(val) => {
              setTreeParamsManuallyEdited(true);
              setTreeWidth(val);
            }}
            leafColor={leafColor}
            onChangeLeafColor={(val) => {
              setTreeParamsManuallyEdited(true);
              setLeafColor(val);
            }}
            trunkColor={trunkColor}
            onChangeTrunkColor={(val) => {
              setTreeParamsManuallyEdited(true);
              setTrunkColor(val);
            }}
            showAdvancedTreeParams={showAdvancedTreeParams}
            onToggleAdvancedTreeParams={() => setShowAdvancedTreeParams(!showAdvancedTreeParams)}
            trunkThickness={trunkThickness}
            onChangeTrunkThickness={setTrunkThickness}
            trunkCurvature={trunkCurvature}
            onChangeTrunkCurvature={setTrunkCurvature}
            rootFlareScale={rootFlareScale}
            onChangeRootFlareScale={setRootFlareScale}
            branchCount={branchCount}
            onChangeBranchCount={setBranchCount}
            canopyShape={canopyShape}
            onChangeCanopyShape={setCanopyShape}
            foliageDensity={foliageDensity}
            onChangeFoliageDensity={setFoliageDensity}
            detailLevel={detailLevel}
            onChangeDetailLevel={setDetailLevel}
            generationMode={generationMode}
            onChangeGenerationMode={setGenerationMode}
            collisionFidelity={collisionFidelity}
            onChangeCollisionFidelity={setCollisionFidelity}
            seed={seed}
            onChangeSeed={setSeed}
            onBack={() => setCurrentStep(2)}
            onGenerate={handleStartGeneration}
          />
        )}

        {/* STEP 4: Live Generation & Progress */}
        {currentStep === 4 && (
          <div className="space-y-6 pt-6">
            <div className="text-center space-y-3 py-8">
              <div
                className={`w-16 h-16 rounded-2xl flex items-center justify-center text-white mx-auto shadow-xl ${
                  generationError && !isGenerating
                    ? 'bg-gradient-to-br from-rose-600 to-amber-600 shadow-rose-600/30'
                    : 'bg-gradient-to-br from-violet-600 to-fuchsia-600 animate-pulse shadow-fuchsia-600/30'
                }`}
              >
                {generationError && !isGenerating ? (
                  <AlertCircle className="w-8 h-8" />
                ) : (
                  <Sparkles className="w-8 h-8" />
                )}
              </div>
              <h3 className="text-lg font-extrabold text-white">{progressStatus}</h3>
              <p className="text-slate-300 text-xs sm:text-sm max-w-md mx-auto">
                {generationError && !isGenerating
                  ? authTokenRequired
                    ? 'Este servidor está protegido con FORGE_SECURITY_TOKEN. Ingresa el token configurado para continuar o vuelve atrás.'
                    : 'No se pudo completar la construcción del modelo 3D. Puedes reintentar o ajustar tus opciones.'
                  : 'Uniendo todas las partes 3D y preparando los colores para que funcionen perfecto en Roblox Studio.'}
              </p>

              {/* Progress Bar */}
              <div className="max-w-md mx-auto mt-4 space-y-1.5">
                <div className="w-full bg-slate-950 rounded-full h-3 border border-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 rounded-full ${
                      generationError && !isGenerating
                        ? 'bg-gradient-to-r from-rose-500 to-amber-500'
                        : 'bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400'
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                  <span>
                    {generationError && !isGenerating ? 'Proceso detenido' : 'Construyendo geometría 3D'}
                  </span>
                  <span>{progressPercent}%</span>
                </div>
              </div>

              {isGenerating && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleCancelGeneration}
                    className="py-1.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition"
                  >
                    Cancelar
                  </button>
                </div>
              )}

              {!isGenerating && generationError && (
                <div className="max-w-md mx-auto pt-4 space-y-3">
                  {authTokenRequired && (
                    <div className="bg-slate-950/90 border border-amber-500/40 rounded-2xl p-4 text-left space-y-2.5">
                      <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>Token de acceso requerido (X-Forge-Token)</span>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="password"
                          value={manualTokenInput}
                          onChange={(e) => setManualTokenInput(e.target.value)}
                          placeholder="Pega tu FORGE_SECURITY_TOKEN"
                          className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                        />
                        <button
                          type="button"
                          disabled={isSavingToken}
                          onClick={handleSaveTokenAndRetry}
                          className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 text-xs font-extrabold cursor-pointer transition whitespace-nowrap"
                        >
                          {isSavingToken ? 'Verificando...' : 'Guardar y reintentar'}
                        </button>
                      </div>
                      {tokenValidationError && (
                        <p className="text-[11px] text-rose-400 font-medium">
                          {tokenValidationError}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setGenerationError(null);
                        setAuthTokenRequired(false);
                        setCurrentStep(2);
                      }}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Volver al estilo</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleStartGeneration}
                      className="px-5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition shadow-lg"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Reintentar</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Collapsible Activity Log */}
            <div className="bg-slate-950 border border-slate-800/80 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowTechnicalLogs(!showTechnicalLogs)}
                className="w-full px-4 py-2.5 text-xs text-slate-400 hover:text-slate-200 flex items-center justify-between cursor-pointer"
              >
                <span>Detalles técnicos ({activityLogs.length} pasos)</span>
                {showTechnicalLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {showTechnicalLogs && (
                <div className="p-3 border-t border-slate-800 font-mono text-[11px] text-slate-400 space-y-1 max-h-40 overflow-y-auto bg-black/40">
                  {activityLogs.map((log, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-fuchsia-400">›</span>
                      <span>{log}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 5: Interactive 3D Preview & Clear Next Actions */}
        {currentStep === 5 && generatedAsset && (
          <div className="space-y-6 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-extrabold text-white flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span>{generatedAsset.name}</span>
                </h3>
                <p className="text-slate-300 text-xs tabular-nums mt-0.5">
                  {generatedAsset.parts.length} partes listas · Apoyado en el suelo para Roblox
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setCurrentStep(2);
                  setGeneratedAsset(null);
                }}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
              >
                <RotateCcw className="w-3.5 h-3.5 text-violet-400" />
                <span>Crear Otro Modelo</span>
              </button>
            </div>

            {/* Engine Execution Report & AI Director Blueprint Diagnostics */}
            {(generatedAsset as any).execution_report && (
              <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-violet-950/80 border border-violet-500/40 text-[11px] font-bold text-violet-300 font-mono">
                      Modo solicitado: {(generatedAsset as any).execution_report.requested_mode}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-cyan-950/80 border border-cyan-500/40 text-[11px] font-bold text-cyan-300 font-mono">
                      Modo ejecutado: {(generatedAsset as any).execution_report.executed_mode}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-[11px] font-bold text-emerald-300 font-mono">
                      Triángulos: {generatedAsset.poly_count} / Budget: {(generatedAsset as any).poly_budget_requested || POLY_BUDGETS[detailLevel].tris}
                    </span>
                    {(generatedAsset as any).director_blueprint?.objectFamily && (
                      <span className="px-2.5 py-1 rounded-lg bg-fuchsia-950/80 border border-fuchsia-500/40 text-[11px] font-bold text-fuchsia-300 font-mono">
                        Motor geométrico: {(generatedAsset as any).director_blueprint.objectFamily}
                      </span>
                    )}
                  </div>
                </div>
                {(generatedAsset as any).execution_report.fallback_triggered && (
                  <div className="text-xs text-amber-300 bg-amber-950/40 border border-amber-500/40 rounded-xl px-3 py-2 font-medium">
                    Aviso explícito: {(generatedAsset as any).execution_report.fallback_reason} (Semilla determinista conservada: {(generatedAsset as any).execution_report.seed}).
                  </div>
                )}
              </div>
            )}

            {/* Reference Image 2D vs 3D Model Quantitative Comparison Panel (FASE 5) */}
            {(generatedAsset as any).reference_image_analysis && (generatedAsset as any).reference_comparison_metrics && (
              <div className="bg-slate-950/90 border border-fuchsia-500/30 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs font-extrabold text-fuchsia-300 uppercase tracking-wider">
                    Comparación Reconstrucción Imagen 2D vs Modelo 3D
                  </span>
                  <span className="text-xs font-mono text-emerald-400 font-bold">
                    Coincidencia de Silueta (IoU): {Math.round((generatedAsset as any).reference_comparison_metrics.silhouetteMatchIoU * 100)}%
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Proporción (Alto/Ancho)</span>
                    <span className="text-white font-mono font-bold">
                      Img: {(generatedAsset as any).reference_comparison_metrics.aspectRatioReference} · 3D: {(generatedAsset as any).reference_comparison_metrics.aspectRatioModel}
                    </span>
                  </div>
                  <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Simetría Detectada</span>
                    <span className="text-white font-mono font-bold">
                      {Math.round((generatedAsset as any).reference_image_analysis.symmetryScore * 100)}% ({(generatedAsset as any).reference_image_analysis.inferredFamily})
                    </span>
                  </div>
                  <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-400 block text-[11px] mb-1">Paleta Extraída de Imagen</span>
                    <div className="flex items-center gap-1.5">
                      {((generatedAsset as any).reference_image_analysis.dominantHexColors || []).map((hex: string, idx: number) => (
                        <span
                          key={idx}
                          className="w-5 h-5 rounded-md border border-white/30"
                          style={{ backgroundColor: hex }}
                          title={hex}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Interactive 3D Canvas Preview */}
            <div className="w-full h-96 rounded-2xl overflow-hidden border border-slate-800 bg-black/60 relative">
              <RobloxWorldViewport3D asset={generatedAsset} />
            </div>

            {/* SECCIÓN 7: Evaluación Visual Multi-Ángulo y Fidelidad Semántica 3D */}
            {(generatedAsset as any).visual_identity_evaluation && (generatedAsset as any).multi_angle_snapshots && (
              <div className="bg-slate-950/90 border border-emerald-500/35 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="text-xs font-extrabold text-emerald-300 uppercase tracking-wider block">
                      Evaluación Visual Multi-Ángulo y Fidelidad Semántica 3D
                    </span>
                    <span className="text-[11px] text-slate-300">
                      {(generatedAsset as any).visual_identity_evaluation.diagnosticSummary}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-950 border border-emerald-500/40 text-xs font-mono font-bold text-emerald-300">
                      Score Semántico: {(generatedAsset as any).visual_identity_evaluation.overallScore}/100
                    </span>
                    {(generatedAsset as any).engine_used && (
                      <span className="px-2.5 py-1 rounded-lg bg-cyan-950 border border-cyan-500/40 text-[11px] font-mono font-bold text-cyan-300">
                        {(generatedAsset as any).engine_used}
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { key: 'frontSvgDataUri', label: '1. Vista Frontal (+Z)' },
                    { key: 'sideSvgDataUri', label: '2. Perfil Lateral (+X)' },
                    { key: 'isometricSvgDataUri', label: '3. Vista 3/4 Isométrica' },
                    { key: 'topSvgDataUri', label: '4. Vista Superior (+Y)' },
                  ].map((view) => (
                    <div
                      key={view.key}
                      className="bg-slate-900 border border-slate-800 rounded-xl p-2 space-y-1.5"
                    >
                      <img
                        src={(generatedAsset as any).multi_angle_snapshots[view.key]}
                        alt={view.label}
                        className="w-full h-36 object-contain rounded-lg bg-slate-950"
                      />
                      <div className="text-[11px] font-bold text-slate-300 text-center font-mono">
                        {view.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3 Colorful Next-Step Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setActiveAsset(generatedAsset);
                  setActiveTab('edit');
                }}
                className="min-h-[48px] p-4 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 cursor-pointer transition shadow-lg whitespace-nowrap forge-btn-press"
              >
                <Eye className="w-4 h-4" />
                <span>Ver y Editar en 3D</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveAsset(generatedAsset);
                  setActiveTab('materials');
                }}
                className="min-h-[48px] p-4 rounded-2xl bg-gradient-to-r from-fuchsia-500 to-amber-500 hover:from-fuchsia-400 hover:to-amber-400 text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 cursor-pointer transition shadow-lg whitespace-nowrap forge-btn-press"
              >
                <Palette className="w-4 h-4" />
                <span>Pintar Colores</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  setActiveAsset(generatedAsset);
                  await pushToStudio(generatedAsset);
                }}
                className="min-h-[48px] p-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 cursor-pointer transition shadow-lg whitespace-nowrap forge-btn-press"
              >
                <Send className="w-4 h-4" />
                <span>Mandar a Roblox</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
