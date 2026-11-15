/**
 * @module external3DModelAdapter
 * @description
 * Sección 3 — Investigación, Evaluación Técnica y Adaptador de Modelos Especializados Open-Source de Generación 3D.
 *
 * Evalúa comparativamente las principales alternativas open-source actuales:
 * 1. Hunyuan3D-2.0 (Tencent)
 * 2. TRELLIS (Microsoft Research)
 * 3. Stable Fast 3D / SF3D (Stability AI)
 * 4. TripoSR (Tripo AI & Stability AI)
 * 5. OpenLRM / Shap-E
 *
 * Además implementa `External3DModelAdapter`: un adaptador opcional para servidores locales o remotos
 * autohospedados (`FORGE_EXTERNAL_3D_ENDPOINT`) que ejecuten cualquiera de estos modelos open-source,
 * convirtiendo las mallas `.obj` / `.gltf` devueltas en sub-mallas compatibles con Roblox `EditableMesh`.
 * Jamás simula que se ejecutó un modelo externo cuando no está configurado o accesible.
 */

import {
  extractPartsFromUploadedMesh,
  type MeshPartInput,
} from './generation3DEngine.ts';

export interface OpenSource3DModelEvaluation {
  id: 'hunyuan3d_2' | 'trellis' | 'stable_fast_3d' | 'triposr' | 'openlrm_shape';
  name: string;
  organization: string;
  license: string;
  openSource: boolean;
  freeForLocalUse: boolean;
  textTo3DSupport: 'native' | 'via_text_to_image_bridge' | 'native_diffusion';
  imageTo3DSupport: 'native_high_fidelity' | 'native_fast' | 'limited';
  geometricQualityScore10: number;
  textureQualityScore10: number;
  minVramGb: number;
  recommendedGpu: string;
  typicalInferenceSeconds: number;
  localExecutionFeasibility: string;
  inferenceCostUsd: string;
  integrationComplexity: 'low' | 'medium' | 'high';
  robloxEditableMeshNotes: string;
  strengths: string[];
  limitations: string[];
}

export const EXTERNAL_3D_MODELS_COMPARISON_MATRIX: OpenSource3DModelEvaluation[] = [
  {
    id: 'hunyuan3d_2',
    name: 'Hunyuan3D-2.0 (Hunyuan3D-DiT + Hunyuan3D-Paint)',
    organization: 'Tencent',
    license: 'Tencent Hunyuan3D-2.0 Community License (Código y pesos abiertos)',
    openSource: true,
    freeForLocalUse: true,
    textTo3DSupport: 'native',
    imageTo3DSupport: 'native_high_fidelity',
    geometricQualityScore10: 9.4,
    textureQualityScore10: 9.3,
    minVramGb: 16,
    recommendedGpu: 'NVIDIA RTX 4080 / RTX 4090 / A100 (16–24 GB VRAM)',
    typicalInferenceSeconds: 18,
    localExecutionFeasibility:
      'Ejecutable localmente en estaciones con GPU NVIDIA >= 16 GB VRAM (modo shape-only ~8 GB VRAM; shape + paint ~16 GB VRAM). No ejecutable en contenedores CPU sin GPU dedicada.',
    inferenceCostUsd: '$0.00 en GPU local; ~$0.02–$0.05 por activo en GPU cloud autohospedada (A10G/L4)',
    integrationComplexity: 'medium',
    robloxEditableMeshNotes:
      'Produce mallas densas (50k–200k caras) que requieren decimación QEM y particionado a <= 9,500 triángulos por MeshPart para cumplir los límites de Roblox EditableMesh.',
    strengths: [
      'Excelente fidelidad anatómica y estructural tanto en cuadrúpedos como en vehículos y criaturas.',
      'Síntesis de texturas UV desacoplada (Hunyuan3D-Paint) con alta coherencia multi-vista.',
      'Soporte oficial para servidor FastAPI/Gradio local.',
    ],
    limitations: [
      'Requiere GPU CUDA con 12–16+ GB VRAM para inferencia completa con texturas.',
      'Topología densa tipo marching-cubes que exige post-procesamiento para presupuestos low/mid-poly de Roblox.',
    ],
  },
  {
    id: 'trellis',
    name: 'TRELLIS (Structured 3D Latents — SLAT)',
    organization: 'Microsoft Research',
    license: 'MIT License (100% permisiva y comercial)',
    openSource: true,
    freeForLocalUse: true,
    textTo3DSupport: 'native',
    imageTo3DSupport: 'native_high_fidelity',
    geometricQualityScore10: 9.5,
    textureQualityScore10: 9.1,
    minVramGb: 16,
    recommendedGpu: 'NVIDIA RTX 3090 / RTX 4090 / L40S / A100 (16–24 GB VRAM)',
    typicalInferenceSeconds: 12,
    localExecutionFeasibility:
      'Abierto bajo licencia MIT. Requiere GPU CUDA con soporte spconv/flash-attn y >= 16 GB VRAM.',
    inferenceCostUsd: '$0.00 local; ~$0.015–$0.04 por activo en instancia GPU remota',
    integrationComplexity: 'medium',
    robloxEditableMeshNotes:
      'Su representación latente estructurada (SLAT) exporta directamente mallas GLB con texturas horneadas y buen control de topología.',
    strengths: [
      'Licencia MIT completamente libre.',
      'Genera simultáneamente 3D Gaussians, Radiance Fields y mallas triangulares texturizadas.',
      'Captura aperturas arquitectónicas, patas de animales y estructuras complejas sin colapsar cavidades.',
    ],
    limitations: [
      'Dependencias CUDA específicas (kaolin, nvdiffrast, spconv) que requieren GPU NVIDIA.',
    ],
  },
  {
    id: 'stable_fast_3d',
    name: 'Stable Fast 3D (SF3D)',
    organization: 'Stability AI',
    license: 'Stability AI Community License (Gratis para investigación y empresas < $1M USD ingresos)',
    openSource: true,
    freeForLocalUse: true,
    textTo3DSupport: 'via_text_to_image_bridge',
    imageTo3DSupport: 'native_fast',
    geometricQualityScore10: 8.4,
    textureQualityScore10: 8.8,
    minVramGb: 6,
    recommendedGpu: 'NVIDIA RTX 3060 / RTX 4060 o superior (6–8 GB VRAM)',
    typicalInferenceSeconds: 0.8,
    localExecutionFeasibility:
      'Alta viabilidad en GPUs de consumo (6–8 GB VRAM) con inferencia sub-segundo (~0.5–1.0s).',
    inferenceCostUsd: '$0.00 local; <$0.002 por activo en GPU cloud',
    integrationComplexity: 'low',
    robloxEditableMeshNotes:
      'Produce mallas cuadrangulares/triangulares limpias con UV unwrap nativo y mapas PBR (Albedo, Roughness, Metalness, Normal) ideales para SurfaceAppearance de Roblox.',
    strengths: [
      'Velocidad extrema (< 1 segundo) y bajo consumo de VRAM (6 GB).',
      'Desiluminación (delighting) integrada y exportación nativa de canales PBR.',
    ],
    limitations: [
      'Es puramente Image-to-3D (requiere generar primero una imagen 2D si se parte sólo de texto).',
      'En objetos con oclusión severa (p. ej. las 4 patas vistas de frente) puede fusionar extremidades traseras si la imagen de entrada no es vista 3/4.',
    ],
  },
  {
    id: 'triposr',
    name: 'TripoSR (Large Reconstruction Model)',
    organization: 'Tripo AI & Stability AI',
    license: 'MIT License (100% abierta y gratuita)',
    openSource: true,
    freeForLocalUse: true,
    textTo3DSupport: 'via_text_to_image_bridge',
    imageTo3DSupport: 'native_fast',
    geometricQualityScore10: 8.1,
    textureQualityScore10: 7.9,
    minVramGb: 4,
    recommendedGpu: 'NVIDIA GTX 1660 / RTX 3050 (4–6 GB VRAM) o CPU con fallback lento (~35s)',
    typicalInferenceSeconds: 0.5,
    localExecutionFeasibility:
      'Muy ligera (MIT). Puede ejecutarse en GPUs de 4 GB VRAM en 0.5s o incluso en CPU en ~30–45s.',
    inferenceCostUsd: '$0.00 local',
    integrationComplexity: 'low',
    robloxEditableMeshNotes:
      'Exporta OBJ/GLB con colores por vértice o textura horneada; requiere limpieza de base para asentar exactamente en Y=0.',
    strengths: [
      'Licencia MIT, pesos ligeros (~1.5 GB) y requisitos mínimos de hardware.',
      'Fácil integración como microservicio Python local.',
    ],
    limitations: [
      'Menor nitidez en detalles finos (cuernos pequeños, dedos, radios de rueda) comparado con TRELLIS o Hunyuan3D-2.0.',
    ],
  },
  {
    id: 'openlrm_shape',
    name: 'Shap-E (OpenAI) / OpenLRM',
    organization: 'OpenAI / OpenLRM Contributors',
    license: 'MIT License / Apache-2.0',
    openSource: true,
    freeForLocalUse: true,
    textTo3DSupport: 'native_diffusion',
    imageTo3DSupport: 'limited',
    geometricQualityScore10: 6.5,
    textureQualityScore10: 6.2,
    minVramGb: 6,
    recommendedGpu: 'GPU 6 GB VRAM',
    typicalInferenceSeconds: 9,
    localExecutionFeasibility: 'Ejecutable localmente pero superado en calidad por TRELLIS y Hunyuan3D-2.',
    inferenceCostUsd: '$0.00 local',
    integrationComplexity: 'low',
    robloxEditableMeshNotes: 'Geometría implícita SDF suave pero propensa a artefactos en extremidades delgadas.',
    strengths: ['Generación directa texto-a-3D bajo licencia MIT.'],
    limitations: ['Calidad geométrica y anatómica baja comparada con modelos 2024–2026 (TRELLIS / Hunyuan3D-2).'],
  },
];

export interface External3DAdapterStatus {
  configured: boolean;
  endpointUrl: string | null;
  preferredModel: 'trellis' | 'hunyuan3d_2' | 'stable_fast_3d' | 'triposr' | 'none';
  localGpuAvailable: boolean;
  reasonIfUnavailable: string;
}

export function getExternal3DAdapterStatus(): External3DAdapterStatus {
  const endpoint = String(process.env.FORGE_EXTERNAL_3D_ENDPOINT || '').trim() || null;
  const preferredRaw = String(process.env.FORGE_EXTERNAL_3D_MODEL || 'trellis')
    .trim()
    .toLowerCase();
  const preferredModel: External3DAdapterStatus['preferredModel'] =
    preferredRaw === 'hunyuan3d_2' ||
    preferredRaw === 'stable_fast_3d' ||
    preferredRaw === 'triposr' ||
    preferredRaw === 'trellis'
      ? preferredRaw
      : 'trellis';

  if (!endpoint) {
    return {
      configured: false,
      endpointUrl: null,
      preferredModel: 'none',
      localGpuAvailable: false,
      reasonIfUnavailable:
        'Variable FORGE_EXTERNAL_3D_ENDPOINT no configurada y el contenedor actual no dispone de GPU CUDA (16 GB VRAM requeridos para TRELLIS/Hunyuan3D-2). Se utiliza el Motor Universal de Síntesis Geométrica Compositiva en 5 Etapas (spline-lofting + anatomía articulada).',
    };
  }

  return {
    configured: true,
    endpointUrl: endpoint,
    preferredModel,
    localGpuAvailable: false,
    reasonIfUnavailable: '',
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function groundAndCenterExternalParts(parts: MeshPartInput[], fromRawObj: boolean): MeshPartInput[] {
  const recentered: MeshPartInput[] = parts.map((p): MeshPartInput => {
    const verts = p.meshData?.vertices;
    if (!p.meshData || !Array.isArray(verts) || verts.length === 0) return p;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const v of verts) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }

    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const spanX = Math.max(0.2, round4(maxX - minX));
    const spanY = Math.max(0.2, round4(maxY - minY));
    const spanZ = Math.max(0.2, round4(maxZ - minZ));

    const needsRecenter =
      Math.abs(cx) > 1e-4 || Math.abs(cy) > 1e-4 || Math.abs(cz) > 1e-4;
    const centeredVerts: [number, number, number][] = needsRecenter
      ? verts.map((v) => [round4(v[0] - cx), round4(v[1] - cy), round4(v[2] - cz)])
      : verts;

    const basePos = Array.isArray(p.position) ? p.position : [0, spanY * 0.5, 0];
    const nextPos: [number, number, number] = fromRawObj
      ? [round4(cx), round4(cy), round4(cz)]
      : [round4(Number(basePos[0] ?? 0) + cx), round4(Number(basePos[1] ?? 0) + cy), round4(Number(basePos[2] ?? 0) + cz)];

    return {
      ...p,
      size: [spanX, spanY, spanZ],
      position: nextPos,
      meshData: {
        ...p.meshData,
        vertices: centeredVerts,
      },
    };
  });

  let globalMinY = Infinity;
  for (const p of recentered) {
    const py = Number(p.position?.[1] ?? 0);
    const verts = p.meshData?.vertices;
    if (Array.isArray(verts) && verts.length > 0) {
      for (const v of verts) {
        const wy = py + Number(v[1] ?? 0);
        if (wy < globalMinY) globalMinY = wy;
      }
    } else {
      const sy = Number(p.size?.[1] ?? 1);
      const bottom = py - sy * 0.5;
      if (bottom < globalMinY) globalMinY = bottom;
    }
  }
  const shiftY = Number.isFinite(globalMinY) ? -globalMinY : 0;

  return recentered.map((p) => ({
    ...p,
    position: [
      round4(Number(p.position?.[0] ?? 0)),
      round4(Number(p.position?.[1] ?? 0) + shiftY),
      round4(Number(p.position?.[2] ?? 0)),
    ],
  }));
}

export async function executeExternal3DGeneration(params: {
  prompt: string;
  modelName?: string;
  referenceImageBase64?: string;
  targetPolyBudget?: number;
  collisionFidelity?: string;
  model?: string;
}): Promise<{
  success: boolean;
  parts?: MeshPartInput[];
  errorReason?: string;
  modelUsed: string;
  latencyMs?: number;
}> {
  const status = getExternal3DAdapterStatus();
  if (!status.configured || !status.endpointUrl) {
    return {
      success: false,
      errorReason: status.reasonIfUnavailable,
      modelUsed: status.preferredModel,
    };
  }

  const startedAt = Date.now();
  const safeModelName =
    String(params.modelName || params.prompt || 'ExternalModel3D')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .slice(0, 28) || 'ExternalModel3D';
  const collisionFidelity = params.collisionFidelity || 'Hull';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(status.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, model/obj',
        ...(process.env.FORGE_EXTERNAL_3D_TOKEN
          ? { Authorization: `Bearer ${process.env.FORGE_EXTERNAL_3D_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        prompt: params.prompt,
        image_base64: params.referenceImageBase64,
        target_poly_budget: params.targetPolyBudget || 3000,
        model: params.model || status.preferredModel,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const latencyMs = Date.now() - startedAt;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        success: false,
        errorReason: `Endpoint externo HTTP ${res.status}: ${errText.slice(0, 140)}`,
        modelUsed: status.preferredModel,
        latencyMs,
      };
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const rawBodyText = await res.text();

    let json: any = null;
    if (!contentType.includes('model/obj') && rawBodyText.trim().startsWith('{')) {
      try {
        json = JSON.parse(rawBodyText);
      } catch {
        json = null;
      }
    }

    if (json && Array.isArray(json.parts) && json.parts.length > 0) {
      return {
        success: true,
        parts: groundAndCenterExternalParts(json.parts, false),
        modelUsed: String(json.model_used || json.model || status.preferredModel),
        latencyMs,
      };
    }

    const objPayload =
      typeof json?.obj_text === 'string'
        ? json.obj_text
        : typeof json?.mesh_obj === 'string'
        ? json.mesh_obj
        : typeof json?.obj === 'string'
        ? json.obj
        : !json && /(^|\n)\s*v\s+[-0-9.]/.test(rawBodyText) && /(^|\n)\s*f\s+\d/.test(rawBodyText)
        ? rawBodyText
        : null;

    if (objPayload) {
      const objParts = extractPartsFromUploadedMesh(
        safeModelName,
        objPayload,
        undefined,
        collisionFidelity
      );
      if (objParts.length > 0) {
        return {
          success: true,
          parts: groundAndCenterExternalParts(objParts, true),
          modelUsed: String(json?.model_used || json?.model || status.preferredModel),
          latencyMs,
        };
      }
    }

    const subMeshes = Array.isArray(json?.sub_meshes)
      ? json.sub_meshes
      : Array.isArray(json?.meshes)
      ? json.meshes
      : json && Array.isArray(json.vertices) && Array.isArray(json.faces)
      ? [
          {
            name: `${safeModelName}_ExternalMesh`,
            vertices: json.vertices,
            faces: json.faces,
            normals: json.normals,
            uvs: json.uvs,
            color: json.color,
            material: json.material,
          },
        ]
      : json?.mesh && Array.isArray(json.mesh.vertices) && Array.isArray(json.mesh.faces)
      ? [
          {
            name: `${safeModelName}_ExternalMesh`,
            vertices: json.mesh.vertices,
            faces: json.mesh.faces,
            normals: json.mesh.normals,
            uvs: json.mesh.uvs,
          },
        ]
      : null;

    if (subMeshes && subMeshes.length > 0) {
      const extracted = extractPartsFromUploadedMesh(
        safeModelName,
        undefined,
        subMeshes,
        collisionFidelity
      );
      if (extracted.length > 0) {
        return {
          success: true,
          parts: groundAndCenterExternalParts(extracted, false),
          modelUsed: String(json?.model_used || json?.model || status.preferredModel),
          latencyMs,
        };
      }
    }

    return {
      success: false,
      errorReason: 'Respuesta del servicio 3D externo no devolvió partes ni malla (.obj / vertices+faces) válidas.',
      modelUsed: status.preferredModel,
      latencyMs,
    };
  } catch (err: any) {
    return {
      success: false,
      errorReason: err.message || 'Error de red al conectar con el servidor 3D externo.',
      modelUsed: status.preferredModel,
      latencyMs: Date.now() - startedAt,
    };
  }
}

