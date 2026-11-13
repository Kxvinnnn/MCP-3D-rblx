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
  Layers,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Shield,
  Box,
} from 'lucide-react';
import { useForge } from '../../context/ForgeContext.tsx';
import {
  Forge3DAsset,
  PBRTextureSet,
  generateProceduralPBRTextures,
  convertImageTo3DHeightmapMesh,
} from '../../utils/roblox3DEngine.ts';
import { SseStreamParser, SseMessage } from '../../utils/sseParser.ts';
import { parseNaturalLanguageToTreeParams } from '../../utils/treePromptParser.ts';
import { RobloxWorldViewport3D } from '../RobloxWorldViewport3D.tsx';
import { HelpTooltip, FORGE_GLOSSARY } from '../common/HelpTooltip.tsx';

type WizardStep = 1 | 2 | 3 | 4 | 5;
type ObjectCategory =
  | 'Props'
  | 'Trees & Vegetation'
  | 'Rocks & Nature'
  | 'Buildings & Structures'
  | 'Furniture & Interior'
  | 'Scene Elements'
  | 'Stylized Assets'
  | 'Ambient & Decoration';
type InputMethod = 'text' | 'image' | 'file3d' | 'heightmap';
type DetailLevel = 'low' | 'medium' | 'high' | 'ultra';

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
  const [generationMode, setGenerationMode] = useState<'procedural' | 'ai'>('procedural');
  const [seed, setSeed] = useState<string>('forge-tree-2026');

  // Tree Procedural Parameters (Fase 7 & Etapa 6 + Fase 3 Expansion)
  const [treeHeight, setTreeHeight] = useState<number>(14);
  const [treeWidth, setTreeWidth] = useState<number>(10);
  const [trunkThickness, setTrunkThickness] = useState<number>(1.6);
  const [trunkLean, setTrunkLean] = useState<number>(0);
  const [trunkCurvature, setTrunkCurvature] = useState<number>(0.15);
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
  const [lodLevel, setLodLevel] = useState<0 | 1 | 2>(0);
  const [parsedPromptBadges, setParsedPromptBadges] = useState<string[]>([]);

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
  const [materialStyle, setMaterialStyle] = useState<'BrushedTitanium' | 'HexPlate' | 'CarbonWeave' | 'StoneGrid'>('BrushedTitanium');
  const [saveToRojo, setSaveToRojo] = useState<boolean>(true);

  // Generation states
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStatus, setProgressStatus] = useState<string>('Iniciando...');
  const [activityLogs, setActivityLogs] = useState<string[]>([]);
  const [showTechnicalLogs, setShowTechnicalLogs] = useState<boolean>(false);

  // Result state
  const [generatedAsset, setGeneratedAsset] = useState<Forge3DAsset | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  // Category presets suggestions across all 8 official categories
  const categorySuggestions: Record<ObjectCategory, string[]> = {
    Props: [
      'Cofre del tesoro medieval con cerradura mágica brillante',
      'Barril reforzado con aros de hierro forjado y madera envejecida',
      'Cristal de energía en contenedor de titanio con emisores neón',
    ],
    'Trees & Vegetation': [
      'Árbol roble ancestral con tronco nudoso y copa esférica frondosa',
      'Pino alpino alto con copa cónica escalonada y corteza rugosa',
      'Sauce llorón místico con ramas colgantes y follaje denso',
    ],
    'Rocks & Nature': [
      'Formación rocosa basáltica facetada con cristales incrustados',
      'Peñasco de granito musgoso asentado para terreno natural',
      'Acantilado modular de piedra caliza estratificada',
    ],
    'Buildings & Structures': [
      'Torre de vigilancia medieval con pilares de piedra y tejado a cuatro aguas',
      'Pabellón modular con columnas clásicas y base de hormigón',
      'Puerta fortificada con arco superior y contrafuertes laterales',
    ],
    'Furniture & Interior': [
      'Mesa de banquete de roble macizo con soportes metálicos',
      'Trono tallado con respaldo alto y reposabrazos ornamentados',
      'Estantería de alquimia con compartimentos modulares',
    ],
    'Scene Elements': [
      'Portal dimensional sobre plataforma octogonal de piedra rúnica',
      'Altar ceremonial con escalinata y núcleo energético central',
      'Plataforma de teletransporte con anillos concéntricos',
    ],
    'Stylized Assets': [
      'Tótem estilizado low-poly con grabados luminosos cian',
      'Santuario de fantasía con geometría facetada limpia',
      'Obelisco flotante estilizado con base escalonada',
    ],
    'Ambient & Decoration': [
      'Farol de hierro forjado sobre pedestal con núcleo cálido',
      'Brasero ceremonial encendido con base de bronce',
      'Baliza ambiental futurista con corona emisiva',
    ],
  };

  const polyBudgets: Record<DetailLevel, { tris: number; label: string; desc: string }> = {
    low: { tris: 1800, label: 'Bajo (~1,800 polígonos)', desc: 'Máximo rendimiento, ideal para dispositivos móviles' },
    medium: { tris: 3800, label: 'Medio (~3,800 polígonos)', desc: 'Equilibrio perfecto recomendado para Roblox' },
    high: { tris: 8500, label: 'Alto (~8,500 polígonos)', desc: 'Alta definición para modelos en primer plano' },
    ultra: { tris: 14000, label: 'Ultra (~14,000 polígonos)', desc: 'Modelos héroe complejos con auto-split si supera límites' },
  };

  // Image Upload Handler
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setReferenceImage(dataUrl);
    };
    reader.readAsDataURL(file);
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
    setCurrentStep(3);
    setNotification({ type: 'info', message: 'Generación 3D cancelada.' });
  };

  // Step 4: Execute Generation via robust SSE stream parser
  const handleStartGeneration = async () => {
    setCurrentStep(4);
    setIsGenerating(true);
    setProgressPercent(15);
    setProgressStatus('Iniciando pipeline de generación 3D...');
    setActivityLogs([
      `Iniciando generación para '${category}'...`,
      `Presupuesto: ${polyBudgets[detailLevel].tris} triángulos`,
      `Fidelidad de colisión: ${collisionFidelity}`,
    ]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      const storedToken =
        typeof window !== 'undefined' ? window.localStorage.getItem('forge_security_token') || '' : '';
      if (storedToken) {
        reqHeaders['X-Forge-Token'] = storedToken;
      }

      const response = await fetch('/api/v1/generate-3d-stream', {
        method: 'POST',
        headers: reqHeaders,
        signal: controller.signal,
        body: JSON.stringify({
          prompt: inputMethod === 'text' ? prompt : `Asset de tipo ${category} generado con referencia/relieve`,
          asset_type: 'Model3D',
          category,
          generation_mode: generationMode,
          seed: seed.trim() || 'forge-seed-2026',
          tree_params:
            category === 'Trees & Vegetation'
              ? {
                  seed: seed.trim() || 'forge-tree-2026',
                  height: treeHeight,
                  width: treeWidth,
                  trunkThickness,
                  trunkLean,
                  trunkCurvature,
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
          target_poly_budget: polyBudgets[detailLevel].tris,
          collision_fidelity: collisionFidelity,
          save_to_rojo: saveToRojo,
          save_to_library: true,
          reference_image_base64: referenceImage ? referenceImage.split(',')[1] : undefined,
          reference_image_mime_type: 'image/png',
        }),
      });

      if (!response.ok || !response.body) {
        const errJson = await response.json().catch(() => ({}));
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
          // Log unparseable non-empty payload
          setActivityLogs((prev) => [
            ...prev,
            `[AVISO]: Fragmento no parseable: ${msg.data.slice(0, 80)}`,
          ]);
          return;
        }

        // Explicit treatment of SSE error events
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
            setProgressStatus(`Modelo '${res.name}' construido con éxito.`);
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

      // Final flush of TextDecoder without stream: true
      const finalDecoded = decoder.decode();
      if (finalDecoded) {
        for (const msg of sseParser.feed(finalDecoded)) {
          handleSseMessage(msg);
        }
      }

      // Final flush of SseStreamParser for any remaining buffered event
      for (const msg of sseParser.flush()) {
        handleSseMessage(msg);
      }

      // Structural validation of received 3D asset model using a TypeScript type guard
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
        applyAssetChange(completedAsset, `Generado con IA: ${completedAsset.name}`, 'add_part');
        setActiveAsset(completedAsset);
        fetchAssetLibrary();
        setIsGenerating(false);
        setCurrentStep(5);
        setNotification({
          type: 'success',
          message: `Modelo '${completedAsset.name}' creado con ${completedAsset.parts.length} piezas.`,
        });
      } else {
        throw new Error('La respuesta del motor 3D no devolvió una estructura 3D válida con piezas y nombre.');
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        setIsGenerating(false);
        setProgressStatus('Generación cancelada por el usuario');
        setActivityLogs((prev) => [...prev, '[CANCELADO]: Operación abortada por el usuario.']);
        return;
      }
      setIsGenerating(false);
      setProgressStatus(`Error: ${err.message || 'Error desconocido'}`);
      setActivityLogs((prev) => [...prev, `[ERROR]: ${err.message}`]);
      setNotification({
        type: 'error',
        message: `Error al generar modelo: ${err.message}`,
      });
    } finally {
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12 animate-in fade-in duration-200">
      {/* Wizard Header & Step Indicators */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="inline-flex items-center gap-2 text-cyan-400 text-xs font-semibold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Asistente de Creación Guiada</span>
            </div>
            <h2 className="text-xl font-bold text-white mt-0.5">
              {currentStep === 1 && 'Paso 1: Selecciona el Tipo de Objeto'}
              {currentStep === 2 && 'Paso 2: ¿Cómo deseas crear tu modelo?'}
              {currentStep === 3 && 'Paso 3: Configuración y Optimización'}
              {currentStep === 4 && 'Paso 4: Generando Modelo 3D...'}
              {currentStep === 5 && 'Paso 5: ¡Modelo Creado con Éxito!'}
            </h2>
          </div>

          {/* Stepper Dots / Counter */}
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <span>Paso {currentStep} de 5</span>
            <div className="flex items-center gap-1.5 ml-2">
              {[1, 2, 3, 4, 5].map((stepNum) => (
                <div
                  key={stepNum}
                  className={`w-2.5 h-2.5 rounded-full transition-all ${
                    stepNum === currentStep
                      ? 'w-6 bg-cyan-400'
                      : stepNum < currentStep
                      ? 'bg-cyan-700'
                      : 'bg-slate-800'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* STEP 1: Object Category Selection (8 Official Categories) */}
        {currentStep === 1 && (
          <div className="space-y-6 pt-6">
            <p className="text-slate-300 text-sm">
              Elige una de las 8 categorías oficiales de assets 3D para Roblox. Cada categoría ajusta la jerarquía EditableMesh, pivote en Y=0 y materiales PBR.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { id: 'Trees & Vegetation', title: 'Árboles y Vegetación', desc: 'Árboles parametrizados (tronco, ramas, copa, hojas)', icon: Mountain },
                { id: 'Props', title: 'Objetos y Props', desc: 'Cofres, barriles, herramientas, contenedores', icon: Box },
                { id: 'Rocks & Nature', title: 'Rocas y Naturaleza', desc: 'Peñascos facetados, cristales, formaciones', icon: Mountain },
                { id: 'Buildings & Structures', title: 'Edificios y Estructuras', desc: 'Torres, columnas, arcos, tejados modulares', icon: Layers },
                { id: 'Furniture & Interior', title: 'Mobiliario e Interiores', desc: 'Mesas, sillas, tronos, estanterías', icon: Box },
                { id: 'Scene Elements', title: 'Elementos de Escenario', desc: 'Portales, altares, plataformas, puentes', icon: Sliders },
                { id: 'Stylized Assets', title: 'Modelos Estilizados', desc: 'Tótems low-poly, santuarios, obeliscos', icon: Sparkles },
                { id: 'Ambient & Decoration', title: 'Ambiental y Decoración', desc: 'Faroles, braseros, balizas luminosas', icon: Shield },
              ].map((item) => {
                const isSelected = category === item.id;
                const IconComponent = item.icon;
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      setCategory(item.id as ObjectCategory);
                      const firstSug = categorySuggestions[item.id as ObjectCategory]?.[0];
                      if (firstSug) setPrompt(firstSug);
                    }}
                    className={`p-4 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                      isSelected
                        ? 'bg-cyan-950/40 border-cyan-500 shadow-md shadow-cyan-950/50'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isSelected ? 'bg-cyan-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
                        <IconComponent className="w-4 h-4" />
                      </div>
                      <h3 className={`font-semibold text-sm ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                        {item.title}
                      </h3>
                      <p className="text-slate-400 text-xs leading-relaxed">
                        {item.desc}
                      </p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-end">
                      <span className={`text-[11px] font-medium ${isSelected ? 'text-cyan-400' : 'text-slate-500'}`}>
                        {isSelected ? 'Seleccionado' : 'Elegir'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-4">
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-2 cursor-pointer transition shadow-lg shadow-cyan-900/30"
              >
                <span>Continuar al Paso 2</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Input Method */}
        {currentStep === 2 && (
          <div className="space-y-6 pt-6">
            {/* Input Method Selector Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-950/60 p-1.5 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setInputMethod('text')}
                className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  inputMethod === 'text' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Texto Descriptivo</span>
              </button>

              <button
                type="button"
                onClick={() => setInputMethod('image')}
                className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  inputMethod === 'image' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>Imagen 2D</span>
              </button>

              <button
                type="button"
                onClick={() => setInputMethod('heightmap')}
                className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  inputMethod === 'heightmap' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Mountain className="w-3.5 h-3.5" />
                <span>Relieve Procedural</span>
              </button>

              <button
                type="button"
                onClick={() => setInputMethod('file3d')}
                className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  inputMethod === 'file3d' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Archivo 3D</span>
              </button>
            </div>

            {/* Sub-view: Text Prompt */}
            {inputMethod === 'text' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Describe el objeto con tus propias palabras:
                  </label>
                  <textarea
                    rows={4}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Ejemplo: Torreta defensiva con doble cañón, base octogonal y núcleo luminoso..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none leading-relaxed"
                  />
                </div>

                {/* Inspiration Tags for Category */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-[11px] text-slate-500 font-medium">Sugerencias para {category}:</span>
                    {category === 'Trees & Vegetation' && (
                      <button
                        type="button"
                        onClick={() => {
                          const parsed = parseNaturalLanguageToTreeParams(prompt);
                          const p = parsed.params;
                          if (p.height !== undefined) setTreeHeight(p.height);
                          if (p.width !== undefined) setTreeWidth(p.width);
                          if (p.trunkThickness !== undefined) setTrunkThickness(p.trunkThickness);
                          if (p.trunkLean !== undefined) setTrunkLean(p.trunkLean);
                          if (p.trunkCurvature !== undefined) setTrunkCurvature(p.trunkCurvature);
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
                          setNotification({
                            type: 'success',
                            message:
                              parsed.detectedKeywords.length > 0
                                ? `Parámetros extraídos del texto (${parsed.detectedKeywords.join(', ')}).`
                                : 'No se detectaron modificadores específicos; ajusta los deslizadores en el Paso 3.',
                          });
                        }}
                        className="px-2.5 py-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-700/60 text-[11px] font-semibold text-emerald-300 cursor-pointer transition"
                      >
                        Aplicar texto a parámetros del árbol
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {categorySuggestions[category]?.map((sug, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setPrompt(sug)}
                        className="text-[11px] text-slate-400 hover:text-cyan-300 bg-slate-950 hover:bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg transition text-left cursor-pointer"
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
                  className="border-2 border-dashed border-slate-800 hover:border-cyan-500 rounded-xl p-8 text-center cursor-pointer transition bg-slate-950/40"
                >
                  {referenceImage ? (
                    <div className="space-y-3">
                      <img
                        src={referenceImage}
                        alt="Referencia"
                        className="max-h-48 mx-auto rounded-lg border border-slate-700 object-contain"
                      />
                      <p className="text-xs text-cyan-400 font-medium">
                        Imagen cargada. Haz clic para cambiarla.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <ImageIcon className="w-8 h-8 text-slate-500 mx-auto" />
                      <p className="text-xs font-semibold text-slate-300">
                        Arrastra una imagen o haz clic para seleccionarla
                      </p>
                      <p className="text-[11px] text-slate-500">
                        PNG, JPG o WebP. Se generará un modelo tridimensional basado en sus formas y colores.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Sub-view: Procedural Heightmap */}
            {inputMethod === 'heightmap' && (
              <div className="space-y-4 bg-slate-950/40 p-4 rounded-xl border border-slate-800">
                <p className="text-xs text-slate-300">
                  Genera una malla volumétrica extruyendo un mapa de alturas en 3D para relieves y superficies.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">
                      Profundidad de Extrusión: <span className="text-white font-mono">{heightmapDepth} studs</span>
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={12}
                      step={0.5}
                      value={heightmapDepth}
                      onChange={(e) => setHeightmapDepth(parseFloat(e.target.value))}
                      className="w-full accent-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">
                      Resolución de Malla: <span className="text-white font-mono">{heightmapRes}x{heightmapRes}</span>
                    </label>
                    <input
                      type="range"
                      min={24}
                      max={64}
                      step={8}
                      value={heightmapRes}
                      onChange={(e) => setHeightmapRes(parseInt(e.target.value, 10))}
                      className="w-full accent-cyan-500"
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
                  className="border-2 border-dashed border-slate-800 hover:border-cyan-500 rounded-xl p-8 text-center cursor-pointer transition bg-slate-950/40"
                >
                  <Upload className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-300">
                    Cargar archivo .rbxmx, .glb o .obj existente
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Ideal para diezmar polígonos, reparar normales y añadir materiales PBR a modelos antiguos.
                  </p>
                </div>
              </div>
            )}

            {/* Back / Next Buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Anterior</span>
              </button>

              <button
                type="button"
                onClick={() => setCurrentStep(3)}
                className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-2 cursor-pointer transition shadow-lg shadow-cyan-900/30"
              >
                <span>Continuar al Paso 3</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Simplified Settings & Optimization */}
        {currentStep === 3 && (
          <div className="space-y-6 pt-6">
            <p className="text-slate-300 text-sm">
              Ajusta únicamente los parámetros necesarios. El motor optimizará automáticamente los vértices para evitar lag en Roblox.
            </p>

            {/* Detail Level Selection */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-200">
                Nivel de Detalle Poligonal:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(['low', 'medium', 'high', 'ultra'] as DetailLevel[]).map((lvl) => {
                  const info = polyBudgets[lvl];
                  const isSelected = detailLevel === lvl;
                  return (
                    <div
                      key={lvl}
                      onClick={() => setDetailLevel(lvl)}
                      className={`p-3.5 rounded-xl border cursor-pointer transition ${
                        isSelected
                          ? 'bg-cyan-950/40 border-cyan-500'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-semibold ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                          {info.label}
                        </span>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-cyan-400" />}
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        {info.desc}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Collision Fidelity & Material Style */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-200">
                    Fidelidad de Colisión:
                  </label>
                  <HelpTooltip
                    term={FORGE_GLOSSARY.collisionFidelity.term}
                    explanation={FORGE_GLOSSARY.collisionFidelity.explanation}
                    variant="badge"
                  />
                </div>
                <select
                  value={collisionFidelity}
                  onChange={(e) => setCollisionFidelity(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="Hull">Hull — Caja envolvente rápida (Recomendado)</option>
                  <option value="Box">Box — Cubo simple mínimo</option>
                  <option value="PreciseConvexDecomposition">Precise — Colisión exacta con cada curva</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-200 block">
                  Estilo de Material Inicial:
                </label>
                <select
                  value={materialStyle}
                  onChange={(e) => setMaterialStyle(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="BrushedTitanium">Titanio Cepillado (Metálico moderno)</option>
                  <option value="HexPlate">Blindaje Hexagonal Sci-Fi</option>
                  <option value="CarbonWeave">Fibra de Carbono Mate</option>
                  <option value="StoneGrid">Piedra / Mampostería Granito</option>
                </select>
              </div>
            </div>

            {/* Engine Mode & Seed Reproducibility (Fase 6 y Fase 7) */}
            <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-200 block mb-1.5">
                    Motor de Síntesis 3D:
                  </label>
                  <select
                    value={generationMode}
                    onChange={(e) => setGenerationMode(e.target.value as 'procedural' | 'ai')}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="procedural">
                      Motor 1: Procedural Parametrizado (100% Local / Sin API de pago)
                    </option>
                    <option value="ai">
                      Motor 2: Asistido por IA + Procedural (Usa API si está configurada)
                    </option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-200 block mb-1.5">
                    Semilla Reproducible (Seed — misma semilla = mismo modelo):
                  </label>
                  <input
                    type="text"
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                    placeholder="ej. oak-tree-2026"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* Parámetros específicos de Árboles 3D (Fase 7) */}
              {category === 'Trees & Vegetation' && (
                <div className="pt-3 border-t border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400">
                      Parámetros del Generador de Árboles 3D (Fase 7)
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      Pivote Y=0 • EditableMesh
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">
                        Altura total: <span className="text-white font-mono">{treeHeight} studs</span>
                      </label>
                      <input
                        type="range"
                        min={5}
                        max={36}
                        step={1}
                        value={treeHeight}
                        onChange={(e) => setTreeHeight(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">
                        Grosor de tronco: <span className="text-white font-mono">{trunkThickness} studs</span>
                      </label>
                      <input
                        type="range"
                        min={0.6}
                        max={4.5}
                        step={0.2}
                        value={trunkThickness}
                        onChange={(e) => setTrunkThickness(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">
                        Número de ramas: <span className="text-white font-mono">{branchCount}</span>
                      </label>
                      <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={branchCount}
                        onChange={(e) => setBranchCount(parseInt(e.target.value, 10))}
                        className="w-full accent-emerald-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">
                        Longitud de ramas: <span className="text-white font-mono">{branchLength} studs</span>
                      </label>
                      <input
                        type="range"
                        min={1.5}
                        max={12}
                        step={0.5}
                        value={branchLength}
                        onChange={(e) => setBranchLength(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500 mt-1.5"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">Distribución de ramas:</label>
                      <select
                        value={branchDistribution}
                        onChange={(e) => setBranchDistribution(e.target.value as any)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white"
                      >
                        <option value="tiered">Escalonada (Natural)</option>
                        <option value="whorled">Verticilada (Simétrica)</option>
                        <option value="alternating">Alternada</option>
                        <option value="canopy_top">Alta / Copa superior</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">Forma de copa:</label>
                      <select
                        value={canopyShape}
                        onChange={(e) => setCanopyShape(e.target.value as any)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white"
                      >
                        <option value="spherical">Esférica (Roble / Clásico)</option>
                        <option value="conical">Cónica (Pino / Abeto)</option>
                        <option value="layered">Escalonada (Bonsái / Estilizado)</option>
                        <option value="weeping">Colgante (Sauce llorón)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">
                        Tamaño de copa: <span className="text-white font-mono">{canopySize.toFixed(1)}x</span>
                      </label>
                      <input
                        type="range"
                        min={0.5}
                        max={2.0}
                        step={0.1}
                        value={canopySize}
                        onChange={(e) => setCanopySize(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500 mt-1.5"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">Distribución de hojas:</label>
                      <select
                        value={leafDistribution}
                        onChange={(e) => setLeafDistribution(e.target.value as any)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white"
                      >
                        <option value="balanced">Equilibrada</option>
                        <option value="dense">Densa / Frondosa</option>
                        <option value="clustered">En racimos</option>
                        <option value="sparse">Ligera / Dispersa</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">
                        Cantidad de follaje: <span className="text-white font-mono">{foliageCount}</span>
                      </label>
                      <input
                        type="range"
                        min={1}
                        max={12}
                        step={1}
                        value={foliageCount}
                        onChange={(e) => setFoliageCount(parseInt(e.target.value, 10))}
                        className="w-full accent-emerald-500 mt-1.5"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">Material tronco:</label>
                      <select
                        value={trunkMaterial}
                        onChange={(e) => setTrunkMaterial(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white"
                      >
                        <option value="Wood">Wood</option>
                        <option value="WoodPlanks">WoodPlanks</option>
                        <option value="Slate">Slate</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">Material hojas:</label>
                      <select
                        value={leafMaterial}
                        onChange={(e) => setLeafMaterial(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white"
                      >
                        <option value="Grass">Grass</option>
                        <option value="Fabric">Fabric</option>
                        <option value="SmoothPlastic">SmoothPlastic</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">
                        Variación árbol: <span className="text-white font-mono">{Math.round(treeVariation * 100)}%</span>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={0.8}
                        step={0.05}
                        value={treeVariation}
                        onChange={(e) => setTreeVariation(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500 mt-1.5"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">
                        Variación hojas: <span className="text-white font-mono">{Math.round(leafVariation * 100)}%</span>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={0.8}
                        step={0.05}
                        value={leafVariation}
                        onChange={(e) => setLeafVariation(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500 mt-1.5"
                      />
                    </div>
                  </div>

                  {/* Controles avanzados de curvatura, anchura, colores, densidad y LOD */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-800/60">
                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">
                        Ancho copa: <span className="text-white font-mono">{treeWidth} studs</span>
                      </label>
                      <input
                        type="range"
                        min={4}
                        max={26}
                        step={1}
                        value={treeWidth}
                        onChange={(e) => setTreeWidth(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">
                        Inclinación tronco: <span className="text-white font-mono">{trunkLean}°</span>
                      </label>
                      <input
                        type="range"
                        min={-25}
                        max={25}
                        step={1}
                        value={trunkLean}
                        onChange={(e) => setTrunkLean(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">
                        Curvatura tronco: <span className="text-white font-mono">{Math.round(trunkCurvature * 100)}%</span>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={trunkCurvature}
                        onChange={(e) => setTrunkCurvature(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">
                        Densidad follaje: <span className="text-white font-mono">{foliageDensity.toFixed(2)}x</span>
                      </label>
                      <input
                        type="range"
                        min={0.3}
                        max={2.0}
                        step={0.05}
                        value={foliageDensity}
                        onChange={(e) => setFoliageDensity(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">Color tronco:</label>
                      <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1">
                        <input
                          type="color"
                          value={trunkColor}
                          onChange={(e) => setTrunkColor(e.target.value)}
                          className="w-6 h-5 bg-transparent cursor-pointer"
                        />
                        <span className="text-[11px] font-mono text-slate-300">{trunkColor}</span>
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">Color hojas:</label>
                      <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1">
                        <input
                          type="color"
                          value={leafColor}
                          onChange={(e) => setLeafColor(e.target.value)}
                          className="w-6 h-5 bg-transparent cursor-pointer"
                        />
                        <span className="text-[11px] font-mono text-slate-300">{leafColor}</span>
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">
                        Variación color: <span className="text-white font-mono">{Math.round(colorVariation * 100)}%</span>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={0.6}
                        step={0.05}
                        value={colorVariation}
                        onChange={(e) => setColorVariation(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500 mt-1.5"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-300 block mb-1">LOD Exportación:</label>
                      <select
                        value={lodLevel}
                        onChange={(e) => setLodLevel(Number(e.target.value) as 0 | 1 | 2)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white"
                      >
                        <option value={0}>LOD 0 (Máxima calidad)</option>
                        <option value={1}>LOD 1 (Medio optimizado)</option>
                        <option value={2}>LOD 2 (Ligero / Mobile)</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Save to Rojo Checkbox */}
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-xs font-medium text-white block">
                  Guardar en disco de Rojo (src/shared/Assets3D)
                </span>
                <span className="text-[11px] text-slate-400 block">
                  Permite que Roblox Studio cargue el modelo de inmediato mediante Rojo o el Local Bridge.
                </span>
              </div>
              <input
                type="checkbox"
                checked={saveToRojo}
                onChange={(e) => setSaveToRojo(e.target.checked)}
                className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
              />
            </div>

            {/* Back / Generate Buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Anterior</span>
              </button>

              <button
                type="button"
                onClick={handleStartGeneration}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold flex items-center gap-2 cursor-pointer transition shadow-lg shadow-cyan-900/40"
              >
                <Sparkles className="w-4 h-4 text-cyan-200" />
                <span>
                  {generationMode === 'procedural'
                    ? 'Generar Modelo 3D Procedural'
                    : 'Generar Modelo 3D con IA'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: Live Generation & Progress */}
        {currentStep === 4 && (
          <div className="space-y-6 pt-6">
            <div className="text-center space-y-3 py-6">
              <div className="w-16 h-16 rounded-2xl bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center text-cyan-400 mx-auto animate-pulse">
                <Sparkles className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-white">
                {progressStatus}
              </h3>
              <p className="text-slate-400 text-xs max-w-md mx-auto">
                El motor está calculando la geometría, subdivisiones y materiales. Esto toma solo unos segundos.
              </p>

              {/* Progress Bar */}
              <div className="max-w-md mx-auto mt-4 space-y-1.5">
                <div className="w-full bg-slate-950 rounded-full h-2.5 border border-slate-800 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full transition-all duration-300 rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                  <span>Procesando</span>
                  <span>{progressPercent}%</span>
                </div>
              </div>

              {/* Cancel Button */}
              {isGenerating && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleCancelGeneration}
                    className="py-1.5 px-4 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white text-xs font-medium cursor-pointer transition border border-slate-700/60"
                  >
                    Cancelar generación
                  </button>
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
                <span>Registro de actividad ({activityLogs.length} eventos)</span>
                {showTechnicalLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {showTechnicalLogs && (
                <div className="p-3 border-t border-slate-800 font-mono text-[11px] text-slate-400 space-y-1 max-h-40 overflow-y-auto bg-black/40">
                  {activityLogs.map((log, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-cyan-500">›</span>
                      <span>{log}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 5: Interactive 3D Preview & Direct Actions */}
        {currentStep === 5 && generatedAsset && (
          <div className="space-y-6 pt-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span>{generatedAsset.name}</span>
                </h3>
                <p className="text-slate-400 text-xs">
                  {generatedAsset.parts.length} piezas • {generatedAsset.poly_count.toLocaleString()} triángulos
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setCurrentStep(1);
                  setGeneratedAsset(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 cursor-pointer transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Crear Otro</span>
              </button>
            </div>

            {/* Interactive 3D Canvas Preview */}
            <div className="w-full h-80 rounded-xl overflow-hidden border border-slate-800 bg-black/60 relative">
              <RobloxWorldViewport3D asset={generatedAsset} />
            </div>

            {/* Direct Action Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setActiveAsset(generatedAsset);
                  setActiveTab('edit');
                }}
                className="p-3.5 rounded-xl bg-slate-800 hover:bg-cyan-600 text-slate-200 hover:text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition"
              >
                <Eye className="w-4 h-4" />
                <span>Abrir en Editor 3D</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveAsset(generatedAsset);
                  setActiveTab('materials');
                }}
                className="p-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition"
              >
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span>Aplicar Materiales PBR</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  setActiveAsset(generatedAsset);
                  await pushToStudio(generatedAsset);
                }}
                className="p-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition shadow-lg shadow-emerald-950/40"
              >
                <Send className="w-4 h-4" />
                <span>Enviar a Roblox Studio</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
