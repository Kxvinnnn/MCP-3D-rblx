import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Upload,
  Box,
  Layers,
  Shield,
  UserCheck,
  RotateCcw,
} from 'lucide-react';
import {
  Forge3DAsset,
  MeshPart3DSpec,
  buildThreeGroupFromAsset,
  buildRobloxR15ScaleDummy,
  generateProceduralPBRTextures,
  exportObject3DToOBJ,
  convertImageTo3DHeightmapMesh,
} from '../utils/roblox3DEngine.ts';
import { default3DEngineProcessor } from './engines/3dEngine.ts';

interface RobloxWorldViewport3DProps {
  asset: Forge3DAsset | null;
  heightmapImageDataUrl?: string | null;
  onPartSelected?: (part: MeshPart3DSpec | null) => void;
  onPreprocessedAssetReady?: (asset: Forge3DAsset) => void;
  onImportedModelStats?: (stats: {
    fileName: string;
    triangles: number;
    vertices: number;
    meshCount: number;
    exceedsRobloxLimit: boolean;
    studDimensions: [number, number, number];
  }) => void;
}

// Pre-allocated math helpers at module scope (Zero GC in render loop)
const _targetCamPos = new THREE.Vector3(9, 6.5, 11);
const _targetLookAt = new THREE.Vector3(0, 2.2, 0);
const _partOffsetVec = new THREE.Vector3();
const _box3 = new THREE.Box3();
const _boxSize = new THREE.Vector3();
const _boxCenter = new THREE.Vector3();

export const RobloxWorldViewport3D: React.FC<RobloxWorldViewport3DProps> = ({
  asset,
  heightmapImageDataUrl,
  onPartSelected,
  onPreprocessedAssetReady,
  onImportedModelStats,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);

  // Interactive HUD state (consolidated into Collapsible Bottom Dock)
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [explodedFactor, setExplodedFactor] = useState<number>(0);
  const [lodRatio, setLodRatio] = useState<number>(1.0);
  const [wireframe, setWireframe] = useState<boolean>(false);
  const [showCollisions, setShowCollisions] = useState<boolean>(false);
  const [showR15Dummy, setShowR15Dummy] = useState<boolean>(false);
  const [pbrPattern, setPbrPattern] = useState<string>('BrushedTitanium');
  const [stats, setStats] = useState<{ tris: number; parts: number; status: string }>({
    tris: 0,
    parts: 0,
    status: 'Roblox WorldModel Ready',
  });
  const [selectedPartName, setSelectedPartName] = useState<string | null>(null);

  // Refs for Three.js objects so UI updates never tear down the WebGL context
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const subjectGroupRef = useRef<THREE.Group | null>(null);
  const r15DummyRef = useRef<THREE.Group | null>(null);
  const requestRenderRef = useRef<(() => void) | null>(null);
  const cameraTransitionActiveRef = useRef<boolean>(false);
  const explodedCurrentRef = useRef<number>(0);
  const explodedTargetRef = useRef<number>(0);
  const isSoftwareGlRef = useRef<boolean>(false);

  // Initialize WebGLRenderer & Studio Scene once
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();
    isSoftwareGlRef.current = isSoftwareGl;

    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 520;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f17);
    scene.fog = new THREE.FogExp2(0x0b0f17, 0.018);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 300);
    camera.position.set(9, 6.5, 11);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    rendererRef.current = renderer;

    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    // Studio Environment Map (RoomEnvironment + PMREMGenerator)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // 3-Point Warm/Cool Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.85);
    hemiLight.position.set(0, 25, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.2);
    keyLight.position.set(12, 18, 14);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 45;
    const d = 12;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.35);
    rimLight.position.set(-12, 10, -12);
    scene.add(rimLight);

    // Ground Baseplate & Soft Radial Contact Shadow Plane (Offset on Y to prevent Z-fighting)
    const baseplateGeom = new THREE.PlaneGeometry(64, 64);
    baseplateGeom.rotateX(-Math.PI / 2);
    const baseplateMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.85,
      metalness: 0.15,
    });
    const baseplate = new THREE.Mesh(baseplateGeom, baseplateMat);
    baseplate.position.y = -0.02;
    baseplate.receiveShadow = !isSoftwareGl;
    scene.add(baseplate);

    const gridHelper = new THREE.GridHelper(36, 36, 0x1e3a8a, 0x1e293b);
    gridHelper.position.y = 0.0;
    scene.add(gridHelper);

    // Radial Contact Shadow Texture under the model
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sCtx = shadowCanvas.getContext('2d')!;
    const grad = sCtx.createRadialGradient(64, 64, 6, 64, 64, 60);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    sCtx.fillStyle = grad;
    sCtx.fillRect(0, 0, 128, 128);
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const contactShadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    contactShadowPlane.position.y = 0.01;
    scene.add(contactShadowPlane);

    // Subject Holder Group & R15 Scale Reference Dummy
    const subjectGroup = new THREE.Group();
    scene.add(subjectGroup);
    subjectGroupRef.current = subjectGroup;

    const r15Dummy = buildRobloxR15ScaleDummy();
    r15Dummy.visible = false;
    scene.add(r15Dummy);
    r15DummyRef.current = r15Dummy;

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 2.2, 0);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 + 0.08;
    controls.minDistance = 2.5;
    controls.maxDistance = 45;
    controlsRef.current = controls;

    // Coalesced On-Demand Render Loop with Software-WebGL fenceSync guard
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    const timer = new THREE.Timer();
    timer.connect(document);

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestRender() {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((timestamp) => {
        renderDirty = false;
        timer.update(timestamp);
        const dt = Math.min(timer.getDelta(), 0.1);

        // Smooth camera transition damping if active
        if (cameraTransitionActiveRef.current) {
          camera.position.x = THREE.MathUtils.damp(camera.position.x, _targetCamPos.x, 7, dt);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, _targetCamPos.y, 7, dt);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, _targetCamPos.z, 7, dt);
          controls.target.x = THREE.MathUtils.damp(controls.target.x, _targetLookAt.x, 7, dt);
          controls.target.y = THREE.MathUtils.damp(controls.target.y, _targetLookAt.y, 7, dt);
          controls.target.z = THREE.MathUtils.damp(controls.target.z, _targetLookAt.z, 7, dt);

          if (camera.position.distanceToSquared(_targetCamPos) < 0.01) {
            cameraTransitionActiveRef.current = false;
          } else {
            renderDirty = true;
          }
        }

        // Smooth Exploded-View Damping
        if (Math.abs(explodedCurrentRef.current - explodedTargetRef.current) > 0.002) {
          explodedCurrentRef.current = THREE.MathUtils.damp(
            explodedCurrentRef.current,
            explodedTargetRef.current,
            8,
            dt
          );
          const rootModel = subjectGroup.children[0];
          if (rootModel) {
            rootModel.children.forEach((child, idx) => {
              const partSpec = child.userData?.partSpec as MeshPart3DSpec | undefined;
              if (partSpec && partSpec.position) {
                const [bx, by, bz] = partSpec.position;
                _partOffsetVec.set(bx, by - 1.5, bz);
                if (_partOffsetVec.lengthSq() < 0.01) {
                  _partOffsetVec.set(0, idx * 0.45, 0);
                } else {
                  _partOffsetVec.normalize().multiplyScalar(1.8);
                }
                child.position.set(
                  bx + _partOffsetVec.x * explodedCurrentRef.current,
                  by + Math.max(0, _partOffsetVec.y) * explodedCurrentRef.current,
                  bz + _partOffsetVec.z * explodedCurrentRef.current
                );
              }
            });
          }
          renderDirty = true;
        }

        controls.update();
        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (renderDirty) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    requestRenderRef.current = requestRender;

    controls.addEventListener('start', () => {
      cameraTransitionActiveRef.current = false;
    });
    controls.addEventListener('change', requestRender);

    // Raycasting on click to inspect individual Roblox BaseParts
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handlePointerDown = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const hits = raycaster.intersectObjects(subjectGroup.children, true);
      if (hits.length > 0) {
        const hitMesh = hits[0].object as THREE.Mesh;
        const spec = hitMesh.userData?.partSpec as MeshPart3DSpec | undefined;
        setSelectedPartName(hitMesh.name || 'MeshPart');
        if (onPartSelected) onPartSelected(spec || null);
      }
    };
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);

    const handleResize = () => {
      if (!mount) return;
      const w = mount.clientWidth || 800;
      const h = mount.clientHeight || 520;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };
    window.addEventListener('resize', handleResize);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }
    requestRender();

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      timer.dispose();
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Rebuild or update 3D subject when asset, LOD, wireframe, collision hull, or PBR pattern changes
  useEffect(() => {
    const subjectGroup = subjectGroupRef.current;
    const renderer = rendererRef.current;
    if (!subjectGroup || !renderer || !asset) return;

    // Clear previous children cleanly
    while (subjectGroup.children.length > 0) {
      const child = subjectGroup.children[0];
      subjectGroup.remove(child);
    }

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const pbrTextures = generateProceduralPBRTextures(
      pbrPattern || asset.pbr_profile?.pattern || 'BrushedTitanium',
      asset.pbr_profile?.albedo_hex || '#334155',
      asset.pbr_profile?.emissive_hex || '#06b6d4',
      maxAniso
    );

    const { group, triangleCount, partCount } = buildThreeGroupFromAsset(asset, {
      lodRatio,
      wireframe,
      showCollisions,
      isSoftwareGl: isSoftwareGlRef.current,
      pbrTextures,
    });

    subjectGroup.add(group);
    setStats({
      tris: triangleCount,
      parts: partCount,
      status: triangleCount <= 10000 ? 'Roblox MeshPart Ready (<10k tris)' : 'Auto-Split Needed (>10k tris)',
    });

    requestRenderRef.current?.();
  }, [asset, lodRatio, wireframe, showCollisions, pbrPattern]);

  // Convert 2D Reference Image to 3D Heightmap Relief Mesh when requested
  useEffect(() => {
    const subjectGroup = subjectGroupRef.current;
    if (!subjectGroup || !heightmapImageDataUrl) return;

    convertImageTo3DHeightmapMesh(heightmapImageDataUrl, Math.round(48 * lodRatio), 2.4)
      .then(({ mesh, triangleCount }) => {
        while (subjectGroup.children.length > 0) {
          subjectGroup.remove(subjectGroup.children[0]);
        }
        subjectGroup.add(mesh);
        setStats({
          tris: triangleCount,
          parts: 1,
          status: 'Image-to-3D Volumetric Mesh Active',
        });
        requestRenderRef.current?.();
      })
      .catch((err) => console.error('Image-to-3D error:', err));
  }, [heightmapImageDataUrl, lodRatio]);

  // Toggle R15 Scale Reference Dummy
  useEffect(() => {
    if (r15DummyRef.current) {
      r15DummyRef.current.visible = showR15Dummy;
      requestRenderRef.current?.();
    }
  }, [showR15Dummy]);

  // Update Exploded-View Target
  useEffect(() => {
    explodedTargetRef.current = explodedFactor;
    requestRenderRef.current?.();
  }, [explodedFactor]);

  // Camera Presets with smooth damping
  const setCameraPreset = (preset: 'iso' | 'front' | 'top' | 'closeup') => {
    if (preset === 'iso') {
      _targetCamPos.set(9, 6.5, 11);
      _targetLookAt.set(0, 2.2, 0);
    } else if (preset === 'front') {
      _targetCamPos.set(0, 3.2, 12);
      _targetLookAt.set(0, 2.4, 0);
    } else if (preset === 'top') {
      _targetCamPos.set(0, 16, 0.01);
      _targetLookAt.set(0, 0, 0);
    } else if (preset === 'closeup') {
      _targetCamPos.set(4.8, 3.6, 5.5);
      _targetLookAt.set(0, 2.3, 0);
    }
    cameraTransitionActiveRef.current = true;
    requestRenderRef.current?.();
  };

  // Import external GLB, GLTF, OBJ, or FBX 3D file via Roblox3DEngineProcessor (src/components/engines/3dEngine.ts)
  const handleImport3DFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !subjectGroupRef.current) return;

    try {
      setStats((prev) => ({
        ...prev,
        status: `Pre-procesando ${file.name} a Roblox MeshParts...`,
      }));

      const { threeObject, exportPayload, backendResponse } =
        await default3DEngineProcessor.processAndSyncWithBackend(file, {
          targetStudHeight: 6.0,
          decimationRatio: lodRatio,
          collisionFidelity: asset?.collision_fidelity || 'Hull',
          autoSplitOversizedMeshes: true,
        });

      const subjectGroup = subjectGroupRef.current;
      while (subjectGroup.children.length > 0) {
        subjectGroup.remove(subjectGroup.children[0]);
      }

      threeObject.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = child as THREE.Mesh;
          m.castShadow = !isSoftwareGlRef.current;
          m.receiveShadow = !isSoftwareGlRef.current;
        }
      });

      subjectGroup.add(threeObject);

      setStats({
        tris: exportPayload.totalTriangles,
        parts: exportPayload.subMeshParts.length,
        status: exportPayload.isRobloxCompliant
          ? `${exportPayload.sourceFormat} Pre-procesado y Sincronizado en Rojo (${exportPayload.subMeshParts.length} MeshParts, ${exportPayload.totalTriangles} tris)`
          : `Auto-dividido en ${exportPayload.subMeshParts.length} MeshParts (<10k tris)`,
      });

      if (onImportedModelStats) {
        onImportedModelStats({
          fileName: file.name,
          triangles: exportPayload.totalTriangles,
          vertices: exportPayload.totalVertices,
          meshCount: exportPayload.subMeshParts.length,
          exceedsRobloxLimit: !exportPayload.isRobloxCompliant,
          studDimensions: exportPayload.boundingBoxStuds,
        });
      }

      if (onPreprocessedAssetReady && backendResponse?.asset) {
        onPreprocessedAssetReady(backendResponse.asset);
      }

      requestRenderRef.current?.();
    } catch (err: any) {
      setStats((prev) => ({
        ...prev,
        status: `Error al procesar archivo 3D: ${err.message || err}`,
      }));
    }
  };

  // Export current 3D scene model to .OBJ for Roblox Studio MeshPart import
  const handleDownloadOBJ = () => {
    if (!subjectGroupRef.current) return;
    const objText = exportObject3DToOBJ(subjectGroupRef.current);
    const blob = new Blob([objText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(asset?.name || 'RobloxModel').replace(/\s+/g, '_')}.obj`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative w-full h-full min-h-[540px] rounded-xl border border-slate-800 bg-[#0b0f17] overflow-hidden flex flex-col">
      {/* Top Minimal Spec Header (No Pulsating Dots, No Clutter) */}
      <div className="z-10 px-4 py-2.5 bg-[#0f172a] border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-xs text-slate-300">
          <span className="font-semibold text-white">
            {asset?.name || 'Roblox 3D WorldModel Viewport'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums text-sky-400">
            {stats.tris.toLocaleString()} Triángulos
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums text-slate-400">
            {stats.parts} MeshParts
          </span>
          {selectedPartName && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-amber-300 font-mono">
                Seleccionado: {selectedPartName}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap shrink-0">
            <Upload className="w-3.5 h-3.5 text-sky-400" />
            <span>Importar GLB / GLTF / OBJ / FBX</span>
            <input
              type="file"
              accept=".glb,.gltf,.obj,.fbx"
              onChange={handleImport3DFile}
              className="hidden"
            />
          </label>

          <button
            onClick={handleDownloadOBJ}
            className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar .OBJ (Roblox MeshPart)</span>
          </button>
        </div>
      </div>

      {/* Dedicated Isolated WebGL Canvas Container (100% Unobstructed Center) */}
      <div ref={canvasMountRef} className="relative flex-1 w-full h-full min-h-[460px]" />

      {/* Unified Collapsible Bottom Control Dock (No backdrop-blur over WebGL, No side cards) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 w-[94%] max-w-[920px] flex flex-col items-center">
        <button
          onClick={() => setDockCollapsed(!dockCollapsed)}
          className="px-3.5 py-1 rounded-t-lg bg-[#0f172a] border border-b-0 border-slate-700 text-[11px] font-medium text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5 text-sky-400" />
              <span>Mostrar Controles 3D</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5 text-sky-400" />
              <span>Modo Zen (Ocultar Controles)</span>
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div className="w-full rounded-xl bg-[#0f172a] border border-slate-700/90 px-4 py-3 shadow-2xl flex flex-wrap items-center justify-between gap-4">
            {/* Exploded View Slider */}
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-medium text-slate-300 whitespace-nowrap">
                Vista Explosionada
              </span>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={explodedFactor}
                onChange={(e) => setExplodedFactor(parseFloat(e.target.value))}
                className="w-24 accent-sky-500 cursor-pointer"
              />
            </div>

            {/* LOD / Polygon Optimization */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-400 mr-1 whitespace-nowrap">
                LOD Polígonos:
              </span>
              {[1.0, 0.75, 0.5, 0.25].map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => setLodRatio(ratio)}
                  className={`px-2 py-1 rounded text-xs font-mono tabular-nums transition cursor-pointer whitespace-nowrap shrink-0 ${
                    lodRatio === ratio
                      ? 'bg-sky-600 text-white font-semibold'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {Math.round(ratio * 100)}%
                </button>
              ))}
            </div>

            {/* PBR Material Pattern Switcher */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-400 whitespace-nowrap">
                PBR:
              </span>
              {(['BrushedTitanium', 'HexGridCarbon', 'WeatheredStone', 'CyberPanel'] as const).map(
                (pat) => (
                  <button
                    key={pat}
                    onClick={() => setPbrPattern(pat)}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer whitespace-nowrap shrink-0 ${
                      pbrPattern === pat
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {pat.replace(/([A-Z])/g, ' $1').trim()}
                  </button>
                )
              )}
            </div>

            {/* Viewport Inspection Toggles & Camera Presets */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setWireframe(!wireframe)}
                className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 transition cursor-pointer whitespace-nowrap shrink-0 ${
                  wireframe ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Malla</span>
              </button>

              <button
                onClick={() => setShowCollisions(!showCollisions)}
                className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 transition cursor-pointer whitespace-nowrap shrink-0 ${
                  showCollisions ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Colisiones</span>
              </button>

              <button
                onClick={() => setShowR15Dummy(!showR15Dummy)}
                className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 transition cursor-pointer whitespace-nowrap shrink-0 ${
                  showR15Dummy ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Escala R15</span>
              </button>

              <button
                onClick={() => {
                  setExplodedFactor(0);
                  setCameraPreset('iso');
                }}
                title="Restablecer Cámara"
                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
