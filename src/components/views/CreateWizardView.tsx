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
import { RobloxWorldViewport3D } from '../RobloxWorldViewport3D.tsx';
import { HelpTooltip, FORGE_GLOSSARY } from '../common/HelpTooltip.tsx';

type WizardStep = 1 | 2 | 3 | 4 | 5;
type ObjectCategory = 'Props' | 'Weapons' | 'Vehicles' | 'Structures' | 'SciFi' | 'Terrain';
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
  const [category, setCategory] = useState<ObjectCategory>('Props');
  const [inputMethod, setInputMethod] = useState<InputMethod>('text');

  // Input states
  const [prompt, setPrompt] = useState<string>(
    'Cofre del tesoro medieval de roble oscuro con herrajes dorados cincelados, cerradura mágica luminosa y gemas incrustadas.'
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

  // Category presets suggestions
  const categorySuggestions: Record<ObjectCategory, string[]> = {
    Props: [
      'Cofre del tesoro medieval con cerradura mágica brillante',
      'Poción de alquimia con frasco de cristal y líquido esmeralda brillante',
      'Antorcha de mazmorra con soporte de hierro forjado y llama animada',
    ],
    Weapons: [
      'Espada de plasma cibernética con hoja energética cian y mango de carbono',
      'Arco élfico de madera ancestral con runas talladas luminosas',
      'Cañón bláster sci-fi pesado con disipadores de calor naranjas',
    ],
    Vehicles: [
      'Deslizador aerodeslizador futurista con propulsores gemelos y cabina acristalada',
      'Tanque blindado táctico con torreta giratoria y orugas de alta resistencia',
      'Dron de exploración espacial con paneles solares y sensor frontal',
    ],
    Structures: [
      'Torre de vigilancia hexagonal con balcón de francotirador y base blindada',
      'Puerta de templo milenario con columnas monolíticas y relieves místicos',
      'Refugio modular de supervivencia con esclusa de aire y antena parabólica',
    ],
    SciFi: [
      'Núcleo de energía de antimateria con anillos de contención en rotación',
      'Terminal de computadora holográfica con teclado flotante y pedestal metálico',
      'Cámara de criogenización con vidrio esmerilado y tubos de refrigerante',
    ],
    Terrain: [
      'Meseta rocosa alienígena con formaciones de cristal púrpura en la cúspide',
      'Cráter de impacto meteórico con bordes escarpados y lava residual',
      'Archipiélago de islas flotantes con cascada de agua suspendida',
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
      const response = await fetch('/api/v1/generate-3d-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: inputMethod === 'text' ? prompt : `Asset de tipo ${category} generado con referencia/relieve`,
          asset_type: 'Model3D',
          category,
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
      let sseBuffer = '';
      let assetCompleted: Forge3DAsset | null = null;

      const processSseBlock = (block: string) => {
        const lines = block.split('\n');
        let eventType = 'message';
        const dataLines: string[] = [];

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith(':')) continue;
          if (line.startsWith('event:')) {
            eventType = line.replace(/^event:\s*/, '').trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.replace(/^data:\s*/, ''));
          }
        }

        if (dataLines.length === 0) return;
        const jsonStr = dataLines.join('\n');

        let payload: any = null;
        try {
          payload = JSON.parse(jsonStr);
        } catch {
          // Log unparseable non-empty payload
          setActivityLogs((prev) => [
            ...prev,
            `[AVISO]: Fragmento no parseable: ${jsonStr.slice(0, 80)}`,
          ]);
          return;
        }

        // Explicit treatment of SSE error events
        if (eventType === 'error' || payload.type === 'error' || payload.error) {
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
        if (done) {
          // Process residual buffer when stream concludes
          if (sseBuffer.trim()) {
            processSseBlock(sseBuffer.trim());
            sseBuffer = '';
          }
          break;
        }

        // Normalize CRLF (\r\n) and legacy CR (\r) to standard \n
        sseBuffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const events = sseBuffer.split('\n\n');
        sseBuffer = events.pop() || '';

        for (const evt of events) {
          if (evt.trim()) {
            processSseBlock(evt);
          }
        }
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

        {/* STEP 1: Object Category Selection */}
        {currentStep === 1 && (
          <div className="space-y-6 pt-6">
            <p className="text-slate-300 text-sm">
              Elige la categoría del objeto. Esto ayuda a optimizar las proporciones en Roblox y las piezas modulares.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { id: 'Props', title: 'Arma / Utilería', desc: 'Cofres, pociones, llaves, antorchas', icon: Box },
                { id: 'Weapons', title: 'Armas & Blásters', desc: 'Espadas, pistolas, arcos, bastones', icon: Sparkles },
                { id: 'Vehicles', title: 'Vehículos', desc: 'Coches, deslizadores, naves, tanques', icon: ArrowRight },
                { id: 'Structures', title: 'Arquitectura', desc: 'Torres, edificios, puertas, refugios', icon: Layers },
                { id: 'SciFi', title: 'Sci-Fi / Gadgets', desc: 'Consolas, reactores, antenas, portales', icon: Sliders },
                { id: 'Terrain', title: 'Terreno / Paisaje', desc: 'Rocas, islas flotantes, cráteres', icon: Mountain },
              ].map((item) => {
                const isSelected = category === item.id;
                const IconComponent = item.icon;
                return (
                  <div
                    key={item.id}
                    onClick={() => setCategory(item.id as ObjectCategory)}
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
                  <span className="text-[11px] text-slate-500 font-medium">Sugerencias para {category}:</span>
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

            {/* Save to Rojo Checkbox */}
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-xs font-medium text-white block">
                  Guardar en disco de Rojo (src/shared/assets)
                </span>
                <span className="text-[11px] text-slate-400 block">
                  Permite que Roblox Studio cargue el modelo de inmediato mediante Rojo.
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
                <span>Generar Modelo 3D con IA</span>
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
