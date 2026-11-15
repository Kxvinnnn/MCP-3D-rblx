# Arquitectura del Sistema — NIGHTMARE FORGE / Forge AI Studio

Este documento describe la arquitectura integral de **NIGHTMARE FORGE / Forge AI Studio v2.3.0**: frontend interactivo, gateway Express + Vite, motores de generación 3D híbrida en TypeScript, paridad Python FastAPI, adaptador opcional de modelos 3D externos, evaluación visual multi-vista, hashing canónico e integración con Roblox Studio y Rojo 7.x.

---

## 1. Diagrama de Flujo General del Sistema

```mermaid
flowchart TB
    subgraph UI["Frontend React 19 + Three.js (src/components/)"]
        CW["CreateWizardView.tsx\nAsistente + Telemetria + 5 Vistas"]
        EV["EditView.tsx / EditInspectorPanel.tsx\nEditor de Partes 3D"]
        MV["MaterialsView.tsx / InteractiveColorWheel.tsx\nPBR & Color"]
        SS["StudioSyncView.tsx\nEstado Bridge + Recibos"]
    end

    subgraph GW["Gateway Unificado (server.ts :3000)"]
        API["API REST / SSE\nX-Forge-Token (timingSafeEqual)"]
        DIR["aiGenerationDirector.ts\nGemini Director / Fallback Local"]
        EXT["external3DModelAdapter.ts\nAdapter HTTP GPU Opcional"]
        P3D["procedural3DGenerator.ts\nOrquestador 3D + Provenance"]
        AE["assetEngine.ts & worldAndModelEditorEngine.ts\nExportadores + Biblioteca Atomica"]
        BC["bridgeCoordinatorEngine.ts\nHMAC-SHA256 + Anti-Replay"]
    end

    subgraph ENGINES["Sub-Motores Geometricos y Analiticos"]
        NLP["treePromptParser.ts\nParser ES/EN"]
        IMG["imageReferenceProcessor.ts\nPNG/JPEG -> 16 Cortes + depthProfile16"]
        SPEC["specializedGeometryGenerators.ts\nEdificios / Rocas / Props / Lathe"]
        UNIV["universalFreeform3DEngine.ts\nSemantica -> Grafo -> Mallas -> Eval -> 5 SVGs"]
        VAL["canonicalHash.ts + robloxGeometryValidator.ts"]
    end

    subgraph LOCAL["Entorno Local Windows / Roblox"]
        PY["backend/main.py (:8000)\nParidad Python FastAPI"]
        BR["forge-bridge (127.0.0.1:48720)\nZero-Inbound + TaskStateStore"]
        ROJO["Rojo 7.x (:34872)\nrojo_workspace/default.project.json"]
        STUDIO["Roblox Studio Plugin\nForgeAIStudioPlugin.server.luau"]
    end

    CW & EV & MV & SS -->|HTTP JSON / SSE| API
    API --> DIR & EXT & P3D & AE & BC
    P3D --> NLP & IMG & SPEC & UNIV
    P3D & AE --> VAL
    BC <-->|Polling HMAC-SHA256 saliente| BR
    BR -->|Whitelist archivos| ROJO
    BR <-->|X-Plugin-Token| STUDIO
    ROJO <--> STUDIO
    API -.->|Proxy opcional| PY
```

---

## 2. Diagrama Text-to-3D Híbrido (Con Provenance y Sin Plantillas Rígidas)

```mermaid
flowchart LR
    Prompt["Prompt Textual ES/EN + seed + preset + tree_params"] --> Parser["parseNaturalLanguageToTreeParams()"]
    Prompt --> Semantics["interpretPromptSemantics()\nTaxonomia + Arquetipo + Modificadores ES/EN"]
    Prompt --> AI["AI Director\nGemini 2.5 o Heuristic Baseline"]
    Parser & Semantics & AI --> Prov["Resolucion de Precedencia\nmanual_ui > preset > prompt_nlp > ai_director > default"]
    Prov -->|Trees| Tree["Generador de Arboles\n7 Especies + Asimetria + Estilos"]
    Prov -->|Buildings / Rocks / Chairs / Lamps / Mechanical / Scenes| Spec["Motores Especializados\nCastillo / Futurista / Torre / Icosferas / Engranajes"]
    Prov -->|Animales / Aves / Vehiculos / Naves / Espadas / Freeform| Univ["Motor Libre Universal\nSpline Lofting + Toros + Wings + Limbs"]
    Tree & Spec & Univ --> Norm["Grounding Y=0 + LOD0/1/2 + Particion <= 9,000 verts"]
    Norm --> Hash["computeCanonicalAssetHash()\n(excluye latency_ms y metadata volatil raiz)"]
```

---

## 3. Diagrama Image-to-3D

```mermaid
flowchart LR
    Ref["Base64 PNG / JPEG"] --> Dec["Decodificacion Binaria Real RGBA"]
    Dec --> Seg["Segmentacion Primer Plano\nAlpha < 45 o Distancia Fondo"]
    Seg --> Scan["16 Cortes Verticales\nwidthProfile16 + depthProfile16 + sliceHex"]
    Scan --> Sym["estimatedSymmetryScore + volumetricConfidence"]
    Scan & Sym --> Fam["inferredObjectFamily\ntree | tower | animal | vehicle | lamp | rock | wide | composite"]
    Fam --> Lathe["generateReferenceImage3DAssetParts()\nbuildLatheSilhouetteMesh(..., depthProfile)"]
    Lathe --> IoU["evaluateReferenceVsModelMetrics()\nsilhouetteMatchIoU + volumetricMatchScore"]
```

---

## 4. Diagrama Motor Híbrido con Proveedor GPU Externo y Fallback Honesto

```mermaid
sequenceDiagram
    participant Client as Frontend / API Caller
    participant Server as Gateway (server.ts)
    participant Ext as FORGE_EXTERNAL_3D_ENDPOINT
    participant Gem as Gemini API (aiGenerationDirector)
    participant Local as procedural3DGenerator (CPU)

    Client->>Server: POST /api/v1/generate-3d (generation_mode='hybrid')
    alt Endpoint externo configurado y accesible
        Server->>Ext: POST /generate (model=trellis|hunyuan3d_2|...)
        Ext-->>Server: OBJ/GLTF mesh
        Server-->>Client: executed_mode='external_3d_model', engine_used='external_3d_model:...'
    else Sin endpoint externo o falla HTTP
        opt GEMINI_API_KEY disponible
            Server->>Gem: Solicita blueprint JSON + arbitrary_components
            Gem-->>Server: Blueprint o fallback si cuota/error
        end
        Server->>Local: synthesizeSeededProcedural3DAsset()
        Local-->>Server: Asset 3D + execution_report (fallback_triggered=true si fallo proveedor)
        Server-->>Client: Asset completo + provenance + warnings + latency_ms
    end
```

---

## 5. Diagrama Exportación y Sincronización con Roblox Studio

```mermaid
flowchart LR
    Parts["Partes Normalizadas\n(EditableMeshBuffers, <= 9,000 verts/MeshPart)"] --> ExpLuau["buildStrictLuauFromEditedParts()\n--!strict + CreateEditableMesh"]
    Parts --> ExpRbxmx["buildRbxmxFromPartsServer()\nXML .rbxmx + ForgeMeshGeometryJSON"]
    Parts --> ExpGltf["buildGltfFromPartsServer()\n.glTF 2.0"]
    Parts --> ExpObj["buildObjAndMtlFromPartsServer()\nWavefront .obj + .mtl"]
    ExpLuau --> Coord["CloudBridgeCoordinator\nEnqueue HMAC-SHA256"]
    Coord -->|Zero-Inbound Poll| Bridge["Forge Local Bridge (127.0.0.1:48720)\nTaskStateStore Atomico"]
    Bridge --> RojoFS["ROJO_PROJECT_PATH/src/shared/Assets3D/\n+ rojo serve :34872"]
    Bridge --> Plugin["ForgeAIStudioPlugin.server.luau\nApply Incremental + Cola Destructiva"]
    Plugin -->|StudioApplicationReceipt + FNV32| Bridge --> Coord
```

---

## 6. Diagrama de Evaluación Visual y Calidad Multi-Ángulo

```mermaid
flowchart TB
    Asset["Asset 3D Generado"] --> Multi["renderMultiAngleSvgSnapshots()\n5 Vistas: Front (+Z), Side (+X), Back (-Z), Top (+Y), Isometric"]
    Asset --> Sem["evaluateSemanticVisualIdentity()\nY=0, 4 Cuadrantes, Simetria, Complejidad, Rasgos"]
    Asset --> Qual["evaluateAssetQualityMetrics()\n11 Dimensiones (0..100) -> overallScore"]
    Asset & Other["Segundo Asset / Prompt B"] --> Pair["compareModelVariationPair()\nDelta BBox, Delta Partes, Overlap Paleta, Distinctness"]
    Multi & Sem & Qual & Pair --> Disk["persistVisualBenchmarkArtifacts('docs/benchmarks')\nbenchmark_report.json + benchmark_summary.md + views/*.svg"]
```
