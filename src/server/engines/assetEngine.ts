/**
 * @module assetEngine
 * @description
 * Engine 2/7 — Asset, Multi-Format 3D Serializer & 4-Channel PBR Engine (TypeScript Server Module).
 *
 * RESPONSIBILITIES:
 * 1. Build & Parse Roblox `.RBXMX` XML models (`buildRbxmxFromPartsServer`, `parseRbxmxFromPartsServer`)
 *    preserving full 3×3 CFrame rotation matrices, Roblox Material tokens, 4-channel `SurfaceAppearance`
 *    (`ColorMap`, `NormalMap`, `RoughnessMap`, `MetalnessMap`), and `ForgeMeshGeometryJSON` buffers.
 * 2. Build Wavefront `.OBJ` + `.MTL` material pairs (`buildObjAndMtlFromPartsServer`).
 * 3. Build glTF 2.0 JSON with embedded binary `ARRAY_BUFFER` / `ELEMENT_ARRAY_BUFFER` and PBR textures
 *    (`buildGltfFromPartsServer`).
 * 4. Generate `--!strict` Luau PBR `SurfaceAppearance` + `EditableImage` binder modules
 *    (`generatePBRSurfaceAppearanceLuau`).
 */

import {
  buildStrictLuauFromEditedParts,
  extractGeometryFromProcessedMesh,
  MeshPartInput,
  splitOversizedMeshPartInput,
  SubMeshGeometryInput,
  synthesizeProceduralMeshData,
  validatePublishedRobloxMeshId,
} from './generation3DEngine.ts';

function escapeXmlServer(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXmlServer(str: string): string {
  return String(str)
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

export function eulerDegToRotationMatrixServer(rxDeg: number, ryDeg: number, rzDeg: number): number[] {
  const rx = (rxDeg * Math.PI) / 180;
  const ry = (ryDeg * Math.PI) / 180;
  const rz = (rzDeg * Math.PI) / 180;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cy * cz,
    -cy * sz,
    sy,
    sx * sy * cz + cx * sz,
    -sx * sy * sz + cx * cz,
    -sx * cy,
    -cx * sy * cz + sx * sz,
    cx * sy * sz + sx * cz,
    cx * cy,
  ];
}

export function rotationMatrixToEulerDegServer(m: number[]): [number, number, number] {
  const [r00 = 1, r01 = 0, r02 = 0, r10 = 0, r11 = 1, r12 = 0, , , r22 = 1] = m;
  const sy = Math.max(-1, Math.min(1, r02));
  const ry = Math.asin(sy);
  let rx = 0;
  let rz = 0;
  if (Math.abs(r02) < 0.99999) {
    rx = Math.atan2(-r12, r22);
    rz = Math.atan2(-r01, r00);
  } else {
    rx = Math.atan2(r10, r11);
    rz = 0;
  }
  const toDeg = (rad: number) => Number(((rad * 180) / Math.PI).toFixed(2));
  return [toDeg(rx), toDeg(ry), toDeg(rz)];
}

export function buildRbxmxFromPartsServer(
  modelName: string,
  parts: MeshPartInput[],
  collisionFidelity: string = 'Hull',
  category: string = '3D Asset',
  luauCodeOverride?: string
): string {
  const safeName = modelName.replace(/[^a-zA-Z0-9_]/g, '') || 'ForgeModel3D';
  const robloxMaterialEnum: Record<string, number> = {
    SmoothPlastic: 256,
    Metal: 1088,
    Neon: 1584,
    Glass: 1568,
    ForceField: 1588,
    DiamondPlate: 1056,
    CorrodedMetal: 1040,
    Foil: 1072,
    Concrete: 816,
    Slate: 800,
    Granite: 832,
    Brick: 848,
    Marble: 784,
    Cobblestone: 864,
    Wood: 512,
    WoodPlanks: 528,
    Fabric: 1312,
    Sand: 1296,
    Ice: 1536,
    Grass: 1280,
  };
  const cfEnumMap: Record<string, number> = {
    Box: 0,
    Hull: 1,
    Default: 2,
    PreciseConvexDecomposition: 3,
  };

  const expandedParts: MeshPartInput[] = [];
  parts.forEach((p, idx) => {
    const [sx = 2, sy = 2, sz = 2] = p.size || [2, 2, 2];
    const resolvedMesh = extractGeometryFromProcessedMesh(
      { ...p, studSize: [sx, sy, sz] },
      `${safeName}.obj`,
      safeName
    );
    const basePart: MeshPartInput = {
      ...p,
      name: p.name || `MeshPart_${idx + 1}`,
      shape: 'MeshPart',
      meshId: validatePublishedRobloxMeshId(p.meshId || resolvedMesh.meshId),
      assetId: validatePublishedRobloxMeshId(p.assetId || resolvedMesh.assetId),
      meshData: resolvedMesh,
    };
    expandedParts.push(...splitOversizedMeshPartInput(basePart));
  });

  const reconstructorLuau =
    luauCodeOverride || buildStrictLuauFromEditedParts(safeName, expandedParts, collisionFidelity);

  const autoRunnerLuau = [
    '--!strict',
    `-- Auto-Executed Geometry Reconstructor for ${safeName} (.RBXMX Import / Studio / Runtime)`,
    'local model = script.Parent',
    'if model and model:IsA("Model") and not model:GetAttribute("ForgeEditableMeshReconstructed") then',
    '    local reconstructorModule = model:FindFirstChild("ForgeStudioReconstructor")',
    '    if reconstructorModule and reconstructorModule:IsA("ModuleScript") then',
    '        local ok, builder = pcall(require, reconstructorModule)',
    '        if ok and type(builder) == "table" and type(builder.ReconstructInPlace) == "function" then',
    '            local okRun, r1, r2, r3 = xpcall(function()',
    '                return builder.ReconstructInPlace(model)',
    '            end, debug.traceback)',
    '            if okRun then',
    '                local count = if type(r1) == "number" then r1 else (if type(r2) == "number" then r2 else 0)',
    '                local allOk = if type(r2) == "boolean" then r2 else (if type(r1) == "boolean" then r1 else (count > 0))',
    '                model:SetAttribute("ForgeEditableMeshReconstructed", allOk)',
    '                model:SetAttribute("ForgeReconstructionVerified", allOk)',
    '                model:SetAttribute("ForgeReconstructedPartCount", count)',
    '            else',
    '                warn("[ForgeAI .RBXMX Reconstructor] Error reconstructing EditableMesh:", r1)',
    '            end',
    '        end',
    '    end',
    'end',
  ].join('\n');

  const lines: string[] = [
    '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">',
    '  <Meta name="ExplicitAutoJoints">true</Meta>',
    '  <External>null</External>',
    '  <External>nil</External>',
    '  <Item class="Model" referent="RBX_MODEL_ROOT">',
    '    <Properties>',
    `      <string name="Name">${escapeXmlServer(safeName)}</string>`,
    '      <Ref name="PrimaryPart">RBX_PART_1</Ref>',
    '    </Properties>',
  ];

  expandedParts.forEach((p, idx) => {
    const refId = `RBX_PART_${idx + 1}`;
    const [sx = 2, sy = 2, sz = 2] = p.size || [2, 2, 2];
    const [px = 0, py = 1, pz = 0] = p.position || [0, 1, 0];
    const [rx = 0, ry = 0, rz = 0] = p.rotation || [0, 0, 0];
    const [cr = 148, cg = 163, cb = 184] = p.color || [148, 163, 184];
    const rotMat = eulerDegToRotationMatrixServer(rx, ry, rz);
    const matToken = robloxMaterialEnum[p.material] ?? 1088;
    const cfToken = cfEnumMap[p.collisionFidelity || collisionFidelity] ?? 1;
    const md = p.meshData || synthesizeProceduralMeshData('MeshPart', [sx, sy, sz]);
    const validMeshId = validatePublishedRobloxMeshId(p.meshId || md.meshId);
    const validTexId = validatePublishedRobloxMeshId(p.textureId);

    const pbr = (p as any).pbrMaterial || {};
    const validColorMap = validatePublishedRobloxMeshId(pbr.colorMapAssetId);
    const validNormalMap = validatePublishedRobloxMeshId(pbr.normalMapAssetId);
    const validRoughMap = validatePublishedRobloxMeshId(pbr.roughnessMapAssetId);
    const validMetalMap = validatePublishedRobloxMeshId(pbr.metalnessMapAssetId);

    const serializedMeshJson = JSON.stringify({
      vertices: md.vertices,
      normals: md.normals,
      uvs: md.uvs,
      faces: md.faces,
      size: [sx, sy, sz],
      position: [px, py, pz],
      rotation: [rx, ry, rz],
      color: [cr, cg, cb],
      material: p.material,
      roughness: p.roughness,
      metalness: p.metalness,
      transparency: p.transparency,
      canCollide: p.canCollide,
      anchored: p.anchored,
      collisionFidelity: p.collisionFidelity || collisionFidelity,
      pbrMaterial: (p as any).pbrMaterial || undefined,
    });

    lines.push(
      `    <Item class="MeshPart" referent="${refId}">`,
      '      <Properties>',
      `        <string name="Name">${escapeXmlServer(p.name || `MeshPart_${idx + 1}`)}</string>`,
      `        <bool name="Anchored">${p.anchored !== false ? 'true' : 'false'}</bool>`,
      `        <bool name="CanCollide">${p.canCollide !== false ? 'true' : 'false'}</bool>`,
      `        <token name="CollisionFidelity">${cfToken}</token>`,
      '        <token name="RenderFidelity">1</token>',
      `        <token name="Material">${matToken}</token>`,
      `        <float name="Transparency">${Number(p.transparency ?? 0).toFixed(3)}</float>`,
      `        <float name="Reflectance">${(Number(p.metalness ?? 0.5) * 0.35).toFixed(3)}</float>`,
      '        <Color3 name="Color3uint8">',
      `          <R>${(cr / 255).toFixed(4)}</R>`,
      `          <G>${(cg / 255).toFixed(4)}</G>`,
      `          <B>${(cb / 255).toFixed(4)}</B>`,
      '        </Color3>',
      '        <Vector3 name="size">',
      `          <X>${Number(sx).toFixed(4)}</X>`,
      `          <Y>${Number(sy).toFixed(4)}</Y>`,
      `          <Z>${Number(sz).toFixed(4)}</Z>`,
      '        </Vector3>',
      '        <Vector3 name="InitialSize">',
      `          <X>${Number(sx).toFixed(4)}</X>`,
      `          <Y>${Number(sy).toFixed(4)}</Y>`,
      `          <Z>${Number(sz).toFixed(4)}</Z>`,
      '        </Vector3>',
      '        <CoordinateFrame name="CFrame">',
      `          <X>${Number(px).toFixed(4)}</X>`,
      `          <Y>${Number(py).toFixed(4)}</Y>`,
      `          <Z>${Number(pz).toFixed(4)}</Z>`,
      `          <R00>${rotMat[0].toFixed(6)}</R00>`,
      `          <R01>${rotMat[1].toFixed(6)}</R01>`,
      `          <R02>${rotMat[2].toFixed(6)}</R02>`,
      `          <R10>${rotMat[3].toFixed(6)}</R10>`,
      `          <R11>${rotMat[4].toFixed(6)}</R11>`,
      `          <R12>${rotMat[5].toFixed(6)}</R12>`,
      `          <R20>${rotMat[6].toFixed(6)}</R20>`,
      `          <R21>${rotMat[7].toFixed(6)}</R21>`,
      `          <R22>${rotMat[8].toFixed(6)}</R22>`,
      '        </CoordinateFrame>',
      validMeshId
        ? `        <Content name="MeshId"><url>${escapeXmlServer(validMeshId)}</url></Content>`
        : '        <Content name="MeshId"><null></null></Content>',
      validTexId
        ? `        <Content name="TextureID"><url>${escapeXmlServer(validTexId)}</url></Content>`
        : '        <Content name="TextureID"><null></null></Content>',
      '      </Properties>',
      `      <Item class="SurfaceAppearance" referent="${refId}_PBR">`,
      '        <Properties>',
      `          <string name="Name">${escapeXmlServer(p.name || `MeshPart_${idx + 1}`)}_PBRSurface</string>`,
      '          <token name="AlphaMode">0</token>',
      validColorMap
        ? `          <Content name="ColorMap"><url>${escapeXmlServer(validColorMap)}</url></Content>`
        : '          <Content name="ColorMap"><null></null></Content>',
      validNormalMap
        ? `          <Content name="NormalMap"><url>${escapeXmlServer(validNormalMap)}</url></Content>`
        : '          <Content name="NormalMap"><null></null></Content>',
      validRoughMap
        ? `          <Content name="RoughnessMap"><url>${escapeXmlServer(validRoughMap)}</url></Content>`
        : '          <Content name="RoughnessMap"><null></null></Content>',
      validMetalMap
        ? `          <Content name="MetalnessMap"><url>${escapeXmlServer(validMetalMap)}</url></Content>`
        : '          <Content name="MetalnessMap"><null></null></Content>',
      '        </Properties>',
      '      </Item>',
      `      <Item class="StringValue" referent="${refId}_GEOM">`,
      '        <Properties>',
      '          <string name="Name">ForgeMeshGeometryJSON</string>',
      `          <string name="Value">${escapeXmlServer(serializedMeshJson)}</string>`,
      '        </Properties>',
      '      </Item>',
      '    </Item>'
    );
  });

  lines.push(
    '    <Item class="StringValue" referent="RBX_FORGE_META">',
    '      <Properties>',
    '        <string name="Name">ForgeAssetCategory</string>',
    `        <string name="Value">${escapeXmlServer(category)}</string>`,
    '      </Properties>',
    '    </Item>',
    '    <Item class="ModuleScript" referent="RBX_FORGE_RECONSTRUCTOR">',
    '      <Properties>',
    '        <string name="Name">ForgeStudioReconstructor</string>',
    `        <ProtectedString name="Source"><![CDATA[${reconstructorLuau.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]></ProtectedString>`,
    '      </Properties>',
    '    </Item>',
    '    <Item class="Script" referent="RBX_FORGE_AUTORUNNER">',
    '      <Properties>',
    '        <string name="Name">ForgeAutoReconstructRunner</string>',
    '        <token name="RunContext">0</token>',
    `        <ProtectedString name="Source"><![CDATA[${autoRunnerLuau.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]></ProtectedString>`,
    '      </Properties>',
    '    </Item>',
    '  </Item>',
    '</roblox>'
  );

  return lines.join('\n');
}

/**
 * Server-side `.RBXMX` XML parser for Pillar C Bidirectional Sync (`/api/v1/assets/pull-from-rojo`).
 * Recovers full CFrames (Position + Euler Rotation from 3x3 rotation matrix), Sizes, Colors,
 * Roblox Material enums, 4-channel `SurfaceAppearance` maps, and `ForgeMeshGeometryJSON` buffers.
 */
export function parseRbxmxFromPartsServer(
  rbxmxText: string,
  fallbackName: string = 'Model3D',
  defaultCollisionFidelity: string = 'Hull'
): {
  modelName: string;
  parts: MeshPartInput[];
  luauCode: string | null;
  polyCount: number;
} {
  const tokenToMaterial: Record<number, string> = {
    256: 'SmoothPlastic',
    1088: 'Metal',
    1584: 'Neon',
    1568: 'Glass',
    1588: 'ForceField',
    1056: 'DiamondPlate',
    1040: 'CorrodedMetal',
    1072: 'Foil',
    816: 'Concrete',
    800: 'Slate',
    832: 'Granite',
    848: 'Brick',
    784: 'Marble',
    864: 'Cobblestone',
    512: 'Wood',
    528: 'WoodPlanks',
    1312: 'Fabric',
    1296: 'Sand',
    1536: 'Ice',
    1280: 'Grass',
  };
  const tokenToCf: Record<number, 'Box' | 'Hull' | 'Default' | 'PreciseConvexDecomposition'> = {
    0: 'Box',
    1: 'Hull',
    2: 'Default',
    3: 'PreciseConvexDecomposition',
  };

  let modelName = fallbackName;
  const modelNameMatch = rbxmxText.match(
    /<Item\s+class="Model"[^>]*>[\s\S]*?<Properties>[\s\S]*?<string\s+name="Name">([^<]+)<\/string>/i
  );
  if (modelNameMatch?.[1]) {
    modelName = unescapeXmlServer(modelNameMatch[1].trim()) || fallbackName;
  }

  let luauCode: string | null = null;
  const moduleRegex =
    /<Item\s+class="ModuleScript"[^>]*>[\s\S]*?<string\s+name="Name">ForgeStudioReconstructor<\/string>[\s\S]*?<ProtectedString\s+name="Source"><!\[CDATA\[([\s\S]*?)\]\]><\/ProtectedString>/i;
  const modMatch = rbxmxText.match(moduleRegex);
  if (modMatch?.[1]) {
    luauCode = modMatch[1].trim();
  }

  const parts: MeshPartInput[] = [];
  const startRegex = /<Item\s+class="(MeshPart|Part|WedgePart|CornerWedgePart|TrussPart)"[^>]*>/gi;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = startRegex.exec(rbxmxText)) !== null) {
    starts.push(m.index);
  }

  for (let i = 0; i < starts.length; i++) {
    const startIdx = starts[i];
    const endIdx = i + 1 < starts.length ? starts[i + 1] : rbxmxText.length;
    const block = rbxmxText.slice(startIdx, endIdx);

    const nameMatch = block.match(/<string\s+name="Name">([^<]+)<\/string>/i);
    const partName = nameMatch?.[1] ? unescapeXmlServer(nameMatch[1].trim()) : `MeshPart_${i + 1}`;

    const sizeBlock = block.match(/<Vector3\s+name="(?:size|Size)">([\s\S]*?)<\/Vector3>/i)?.[1] || '';
    const sx = Number(sizeBlock.match(/<X>([^<]+)<\/X>/i)?.[1] ?? 2);
    const sy = Number(sizeBlock.match(/<Y>([^<]+)<\/Y>/i)?.[1] ?? 2);
    const sz = Number(sizeBlock.match(/<Z>([^<]+)<\/Z>/i)?.[1] ?? 2);

    const cfBlock = block.match(/<CoordinateFrame\s+name="CFrame">([\s\S]*?)<\/CoordinateFrame>/i)?.[1] || '';
    const px = Number(cfBlock.match(/<X>([^<]+)<\/X>/i)?.[1] ?? 0);
    const py = Number(cfBlock.match(/<Y>([^<]+)<\/Y>/i)?.[1] ?? 1);
    const pz = Number(cfBlock.match(/<Z>([^<]+)<\/Z>/i)?.[1] ?? 0);
    const r00 = Number(cfBlock.match(/<R00>([^<]+)<\/R00>/i)?.[1] ?? 1);
    const r01 = Number(cfBlock.match(/<R01>([^<]+)<\/R01>/i)?.[1] ?? 0);
    const r02 = Number(cfBlock.match(/<R02>([^<]+)<\/R02>/i)?.[1] ?? 0);
    const r10 = Number(cfBlock.match(/<R10>([^<]+)<\/R10>/i)?.[1] ?? 0);
    const r11 = Number(cfBlock.match(/<R11>([^<]+)<\/R11>/i)?.[1] ?? 1);
    const r12 = Number(cfBlock.match(/<R12>([^<]+)<\/R12>/i)?.[1] ?? 0);
    const r20 = Number(cfBlock.match(/<R20>([^<]+)<\/R20>/i)?.[1] ?? 0);
    const r21 = Number(cfBlock.match(/<R21>([^<]+)<\/R21>/i)?.[1] ?? 0);
    const r22 = Number(cfBlock.match(/<R22>([^<]+)<\/R22>/i)?.[1] ?? 1);
    let rotation: [number, number, number] = rotationMatrixToEulerDegServer([
      r00, r01, r02, r10, r11, r12, r20, r21, r22,
    ]);

    let color: [number, number, number] = [148, 163, 184];
    const colBlock = block.match(/<Color3\s+name="(?:Color3uint8|Color)">([\s\S]*?)<\/Color3>/i)?.[1];
    if (colBlock) {
      let cr = Number(colBlock.match(/<R>([^<]+)<\/R>/i)?.[1] ?? 0.58);
      let cg = Number(colBlock.match(/<G>([^<]+)<\/G>/i)?.[1] ?? 0.64);
      let cb = Number(colBlock.match(/<B>([^<]+)<\/B>/i)?.[1] ?? 0.72);
      if (cr <= 1 && cg <= 1 && cb <= 1) {
        cr = Math.round(cr * 255);
        cg = Math.round(cg * 255);
        cb = Math.round(cb * 255);
      }
      color = [
        Math.max(0, Math.min(255, Math.round(cr))),
        Math.max(0, Math.min(255, Math.round(cg))),
        Math.max(0, Math.min(255, Math.round(cb))),
      ];
    }

    const matTok = Number(block.match(/<token\s+name="Material">(\d+)<\/token>/i)?.[1] ?? 1088);
    let material = tokenToMaterial[matTok] || 'Metal';

    const cfTok = Number(block.match(/<token\s+name="CollisionFidelity">(\d+)<\/token>/i)?.[1] ?? 1);
    const collisionFidelity =
      tokenToCf[cfTok] ||
      (defaultCollisionFidelity as 'Box' | 'Hull' | 'Default' | 'PreciseConvexDecomposition') ||
      'Hull';

    const transparency = Number(block.match(/<float\s+name="Transparency">([^<]+)<\/float>/i)?.[1] ?? 0);
    const reflectance = Number(block.match(/<float\s+name="Reflectance">([^<]+)<\/float>/i)?.[1] ?? 0.2);
    const anchored = (block.match(/<bool\s+name="Anchored">([^<]+)<\/bool>/i)?.[1] ?? 'true') !== 'false';
    const canCollide = (block.match(/<bool\s+name="CanCollide">([^<]+)<\/bool>/i)?.[1] ?? 'true') !== 'false';

    const meshIdRaw = block.match(/<Content\s+name="MeshId">\s*<url>([^<]+)<\/url>/i)?.[1];
    const texIdRaw = block.match(/<Content\s+name="TextureID">\s*<url>([^<]+)<\/url>/i)?.[1];
    const meshId = validatePublishedRobloxMeshId(meshIdRaw ? unescapeXmlServer(meshIdRaw) : undefined) || undefined;
    const textureId = validatePublishedRobloxMeshId(texIdRaw ? unescapeXmlServer(texIdRaw) : undefined) || undefined;

    let pbrMaterial: Record<string, any> | undefined;
    const saBlock = block.match(/<Item\s+class="SurfaceAppearance"[^>]*>([\s\S]*?)<\/Item>/i)?.[1];
    if (saBlock) {
      const cmap = validatePublishedRobloxMeshId(
        saBlock.match(/<Content\s+name="ColorMap">\s*<url>([^<]+)<\/url>/i)?.[1]
      );
      const nmap = validatePublishedRobloxMeshId(
        saBlock.match(/<Content\s+name="NormalMap">\s*<url>([^<]+)<\/url>/i)?.[1]
      );
      const rmap = validatePublishedRobloxMeshId(
        saBlock.match(/<Content\s+name="RoughnessMap">\s*<url>([^<]+)<\/url>/i)?.[1]
      );
      const mmap = validatePublishedRobloxMeshId(
        saBlock.match(/<Content\s+name="MetalnessMap">\s*<url>([^<]+)<\/url>/i)?.[1]
      );
      if (cmap || nmap || rmap || mmap) {
        pbrMaterial = {
          materialName: `${partName}_PBR`,
          colorMapAssetId: cmap || undefined,
          normalMapAssetId: nmap || undefined,
          roughnessMapAssetId: rmap || undefined,
          metalnessMapAssetId: mmap || undefined,
        };
      }
    }

    let meshData: SubMeshGeometryInput | undefined;
    let roughness = 0.35;
    let metalness = Math.min(1, Math.max(0, Number((reflectance / 0.35).toFixed(2))));

    const geomMatch = block.match(
      /<string\s+name="Name">ForgeMeshGeometryJSON<\/string>\s*<string\s+name="Value">([\s\S]*?)<\/string>/i
    );
    if (geomMatch?.[1]) {
      try {
        const parsedGeom = JSON.parse(unescapeXmlServer(geomMatch[1].trim()));
        if (parsedGeom && Array.isArray(parsedGeom.vertices) && Array.isArray(parsedGeom.faces)) {
          meshData = extractGeometryFromProcessedMesh(
            {
              name: partName,
              studSize: [sx, sy, sz],
              meshData: parsedGeom,
            },
            `${modelName}.obj`,
            modelName
          );
          if (typeof parsedGeom.roughness === 'number') roughness = parsedGeom.roughness;
          if (typeof parsedGeom.metalness === 'number') metalness = parsedGeom.metalness;
          if (typeof parsedGeom.material === 'string') material = parsedGeom.material;
          if (Array.isArray(parsedGeom.rotation) && parsedGeom.rotation.length === 3) {
            rotation = [
              Number(parsedGeom.rotation[0]),
              Number(parsedGeom.rotation[1]),
              Number(parsedGeom.rotation[2]),
            ];
          }
          if (parsedGeom.pbrMaterial && typeof parsedGeom.pbrMaterial === 'object') {
            pbrMaterial = { ...(pbrMaterial || {}), ...parsedGeom.pbrMaterial };
          }
        }
      } catch {
        // Fallback to synthesized geometry below
      }
    }

    if (!meshData) {
      meshData = synthesizeProceduralMeshData('MeshPart', [sx, sy, sz]);
      meshData.objFileName = `${modelName}.obj`;
      if (meshId) {
        meshData.meshId = meshId;
        meshData.assetId = meshId;
      }
    }

    parts.push({
      name: partName,
      shape: 'MeshPart',
      meshId,
      assetId: meshId,
      textureId,
      size: [Number(sx.toFixed(3)), Number(sy.toFixed(3)), Number(sz.toFixed(3))],
      position: [Number(px.toFixed(3)), Number(py.toFixed(3)), Number(pz.toFixed(3))],
      rotation,
      color,
      material,
      roughness,
      metalness,
      transparency: Number(transparency.toFixed(3)),
      canCollide,
      anchored,
      collisionFidelity,
      meshData,
      ...(pbrMaterial ? { pbrMaterial } : {}),
    } as MeshPartInput);
  }

  const polyCount = parts.reduce((sum, p) => sum + (p.meshData?.faces?.length || 0), 0);
  return {
    modelName,
    parts,
    luauCode,
    polyCount,
  };
}

export function buildObjAndMtlFromPartsServer(
  modelName: string,
  parts: MeshPartInput[]
): { obj: string; mtl: string; objFileName: string; mtlFileName: string } {
  const safeName = modelName.replace(/[^a-zA-Z0-9_]/g, '') || 'ForgeModel3D';
  const objFileName = `${safeName}.obj`;
  const mtlFileName = `${safeName}.mtl`;

  const expandedParts: MeshPartInput[] = [];
  parts.forEach((p, idx) => {
    const [sx = 2, sy = 2, sz = 2] = p.size || [2, 2, 2];
    const resolvedMesh = extractGeometryFromProcessedMesh(
      { ...p, studSize: [sx, sy, sz] },
      objFileName,
      safeName
    );
    expandedParts.push(
      ...splitOversizedMeshPartInput({
        ...p,
        name: p.name || `MeshPart_${idx + 1}`,
        meshData: resolvedMesh,
      })
    );
  });

  const objLines: string[] = [
    `# Wavefront OBJ exported from Forge AI Studio: ${safeName}`,
    `mtllib ${mtlFileName}`,
    '',
  ];
  const mtlLines: string[] = [
    `# Wavefront MTL Material Library for ${safeName}`,
    '',
  ];

  let globalVertexOffset = 1;
  expandedParts.forEach((p, idx) => {
    const partLabel = (p.name || `MeshPart_${idx + 1}`).replace(/[^a-zA-Z0-9_]/g, '_');
    const matName = `Mat_${partLabel}_${idx + 1}`;
    const [cr = 148, cg = 163, cb = 184] = p.color || [148, 163, 184];
    const [px = 0, py = 1, pz = 0] = p.position || [0, 1, 0];
    const [rx = 0, ry = 0, rz = 0] = p.rotation || [0, 0, 0];
    const rotMat = eulerDegToRotationMatrixServer(rx, ry, rz);
    const md = p.meshData || synthesizeProceduralMeshData('MeshPart', p.size || [2, 2, 2]);

    mtlLines.push(
      `newmtl ${matName}`,
      `Kd ${(cr / 255).toFixed(4)} ${(cg / 255).toFixed(4)} ${(cb / 255).toFixed(4)}`,
      'Ka 0.1000 0.1000 0.1000',
      `Ks ${Number(p.metalness ?? 0.5).toFixed(4)} ${Number(p.metalness ?? 0.5).toFixed(4)} ${Number(p.metalness ?? 0.5).toFixed(4)}`,
      `Ns ${Math.max(1, (1 - Number(p.roughness ?? 0.35)) * 250).toFixed(2)}`,
      `d ${(1 - Number(p.transparency ?? 0)).toFixed(4)}`,
      'illum 2',
      ''
    );

    objLines.push(`o ${partLabel}`, `g ${partLabel}`, `usemtl ${matName}`);

    for (const [vx, vy, vz] of md.vertices) {
      const wx = rotMat[0] * vx + rotMat[1] * vy + rotMat[2] * vz + px;
      const wy = rotMat[3] * vx + rotMat[4] * vy + rotMat[5] * vz + py;
      const wz = rotMat[6] * vx + rotMat[7] * vy + rotMat[8] * vz + pz;
      objLines.push(`v ${wx.toFixed(5)} ${wy.toFixed(5)} ${wz.toFixed(5)}`);
    }

    for (const [u, v] of md.uvs) {
      objLines.push(`vt ${Number(u).toFixed(5)} ${Number(v).toFixed(5)}`);
    }

    for (const [nx, ny, nz] of md.normals) {
      const wnx = rotMat[0] * nx + rotMat[1] * ny + rotMat[2] * nz;
      const wny = rotMat[3] * nx + rotMat[4] * ny + rotMat[5] * nz;
      const wnz = rotMat[6] * nx + rotMat[7] * ny + rotMat[8] * nz;
      objLines.push(`vn ${wnx.toFixed(5)} ${wny.toFixed(5)} ${wnz.toFixed(5)}`);
    }

    for (const [f0, f1, f2] of md.faces) {
      const i0 = f0 + globalVertexOffset;
      const i1 = f1 + globalVertexOffset;
      const i2 = f2 + globalVertexOffset;
      objLines.push(`f ${i0}/${i0}/${i0} ${i1}/${i1}/${i1} ${i2}/${i2}/${i2}`);
    }

    objLines.push('');
    globalVertexOffset += md.vertices.length;
  });

  return {
    obj: objLines.join('\n'),
    mtl: mtlLines.join('\n'),
    objFileName,
    mtlFileName,
  };
}

export function buildGltfFromPartsServer(
  modelName: string,
  parts: MeshPartInput[],
  pbrTextures?: {
    albedoDataUrl?: string;
    normalDataUrl?: string;
    roughnessDataUrl?: string;
  }
): string {
  const safeName = modelName.replace(/[^a-zA-Z0-9_]/g, '') || 'ForgeModel3D';
  const expandedParts: MeshPartInput[] = [];
  parts.forEach((p, idx) => {
    const [sx = 2, sy = 2, sz = 2] = p.size || [2, 2, 2];
    const resolvedMesh = extractGeometryFromProcessedMesh(
      { ...p, studSize: [sx, sy, sz] },
      `${safeName}.obj`,
      safeName
    );
    expandedParts.push(
      ...splitOversizedMeshPartInput({
        ...p,
        name: p.name || `MeshPart_${idx + 1}`,
        meshData: resolvedMesh,
      })
    );
  });

  const nodes: any[] = [];
  const meshes: any[] = [];
  const materials: any[] = [];
  const bufferViews: any[] = [];
  const accessors: any[] = [];
  const images: any[] = [];
  const samplers: any[] = [];
  const textures: any[] = [];
  const binaryChunks: Buffer[] = [];
  let byteOffset = 0;

  let baseColorTexIdx: number | undefined;
  let normalTexIdx: number | undefined;
  let metallicRoughnessTexIdx: number | undefined;

  if (pbrTextures) {
    const texDefs: Array<[string | undefined, string, 'albedo' | 'normal' | 'roughness']> = [
      [pbrTextures.albedoDataUrl, `${safeName}_ColorMap`, 'albedo'],
      [pbrTextures.normalDataUrl, `${safeName}_NormalMap`, 'normal'],
      [pbrTextures.roughnessDataUrl, `${safeName}_RoughnessMap`, 'roughness'],
    ];
    for (const [dataUrl, texName, role] of texDefs) {
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
        if (samplers.length === 0) {
          samplers.push({
            magFilter: 9729,
            minFilter: 9987,
            wrapS: 10497,
            wrapT: 10497,
          });
        }
        const imgIdx = images.length;
        images.push({ name: texName, uri: dataUrl });
        const texIdx = textures.length;
        textures.push({ name: texName, sampler: 0, source: imgIdx });
        if (role === 'albedo') baseColorTexIdx = texIdx;
        if (role === 'normal') normalTexIdx = texIdx;
        if (role === 'roughness') metallicRoughnessTexIdx = texIdx;
      }
    }
  }

  expandedParts.forEach((p, idx) => {
    const md = p.meshData || synthesizeProceduralMeshData('MeshPart', p.size || [2, 2, 2]);
    const vertCount = md.vertices.length;
    if (vertCount === 0 || md.faces.length === 0) return;

    const posBuf = Buffer.alloc(vertCount * 12);
    const normBuf = Buffer.alloc(vertCount * 12);
    const uvBuf = Buffer.alloc(vertCount * 8);

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < vertCount; i++) {
      const [vx, vy, vz] = md.vertices[i] || [0, 0, 0];
      const [nx, ny, nz] = (md.normals && md.normals[i]) || [0, 1, 0];
      const [u, v] = (md.uvs && md.uvs[i]) || [0, 0];
      posBuf.writeFloatLE(vx, i * 12);
      posBuf.writeFloatLE(vy, i * 12 + 4);
      posBuf.writeFloatLE(vz, i * 12 + 8);
      normBuf.writeFloatLE(nx, i * 12);
      normBuf.writeFloatLE(ny, i * 12 + 4);
      normBuf.writeFloatLE(nz, i * 12 + 8);
      uvBuf.writeFloatLE(u, i * 8);
      uvBuf.writeFloatLE(v, i * 8 + 4);

      if (vx < minX) minX = vx;
      if (vy < minY) minY = vy;
      if (vz < minZ) minZ = vz;
      if (vx > maxX) maxX = vx;
      if (vy > maxY) maxY = vy;
      if (vz > maxZ) maxZ = vz;
    }

    const validFaces = md.faces.filter(
      (f) => f[0] < vertCount && f[1] < vertCount && f[2] < vertCount
    );
    const indexCount = validFaces.length * 3;
    const idxBuf = Buffer.alloc(indexCount * 4);
    validFaces.forEach(([i0, i1, i2], fIdx) => {
      idxBuf.writeUInt32LE(i0, fIdx * 12);
      idxBuf.writeUInt32LE(i1, fIdx * 12 + 4);
      idxBuf.writeUInt32LE(i2, fIdx * 12 + 8);
    });

    const posViewIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: posBuf.byteLength, target: 34962 });
    binaryChunks.push(posBuf);
    byteOffset += posBuf.byteLength;

    const normViewIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: normBuf.byteLength, target: 34962 });
    binaryChunks.push(normBuf);
    byteOffset += normBuf.byteLength;

    const uvViewIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: uvBuf.byteLength, target: 34962 });
    binaryChunks.push(uvBuf);
    byteOffset += uvBuf.byteLength;

    const idxViewIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: idxBuf.byteLength, target: 34963 });
    binaryChunks.push(idxBuf);
    byteOffset += idxBuf.byteLength;

    const posAccIdx = accessors.length;
    accessors.push({
      bufferView: posViewIdx,
      componentType: 5126,
      count: vertCount,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });

    const normAccIdx = accessors.length;
    accessors.push({
      bufferView: normViewIdx,
      componentType: 5126,
      count: vertCount,
      type: 'VEC3',
    });

    const uvAccIdx = accessors.length;
    accessors.push({
      bufferView: uvViewIdx,
      componentType: 5126,
      count: vertCount,
      type: 'VEC2',
    });

    const idxAccIdx = accessors.length;
    accessors.push({
      bufferView: idxViewIdx,
      componentType: 5125,
      count: indexCount,
      type: 'SCALAR',
    });

    const [cr = 148, cg = 163, cb = 184] = p.color || [148, 163, 184];
    const pbrSpec: any = {
      baseColorFactor: [
        Number((cr / 255).toFixed(4)),
        Number((cg / 255).toFixed(4)),
        Number((cb / 255).toFixed(4)),
        Number((1 - Number(p.transparency ?? 0)).toFixed(4)),
      ],
      metallicFactor: Number(Number(p.metalness ?? 0.5).toFixed(4)),
      roughnessFactor: Number(Number(p.roughness ?? 0.35).toFixed(4)),
    };
    if (baseColorTexIdx !== undefined) {
      pbrSpec.baseColorTexture = { index: baseColorTexIdx };
    }
    if (metallicRoughnessTexIdx !== undefined) {
      pbrSpec.metallicRoughnessTexture = { index: metallicRoughnessTexIdx };
    }

    const matEntry: any = {
      name: `${p.name || `MeshPart_${idx + 1}`}_PBR`,
      pbrMetallicRoughness: pbrSpec,
      doubleSided: true,
    };
    if (normalTexIdx !== undefined) {
      matEntry.normalTexture = { index: normalTexIdx };
    }

    const matIdx = materials.length;
    materials.push(matEntry);

    const meshIdx = meshes.length;
    meshes.push({
      name: p.name || `MeshPart_${idx + 1}`,
      primitives: [
        {
          attributes: {
            POSITION: posAccIdx,
            NORMAL: normAccIdx,
            TEXCOORD_0: uvAccIdx,
          },
          indices: idxAccIdx,
          material: matIdx,
          mode: 4,
        },
      ],
    });

    const [px = 0, py = 1, pz = 0] = p.position || [0, 1, 0];
    const [rx = 0, ry = 0, rz = 0] = p.rotation || [0, 0, 0];
    const hx = (rx * Math.PI) / 360;
    const hy = (ry * Math.PI) / 360;
    const hz = (rz * Math.PI) / 360;
    const cx = Math.cos(hx), sx = Math.sin(hx);
    const cy = Math.cos(hy), sy = Math.sin(hy);
    const cz = Math.cos(hz), sz = Math.sin(hz);

    nodes.push({
      name: p.name || `MeshPart_${idx + 1}`,
      mesh: meshIdx,
      translation: [px, py, pz],
      rotation: [
        Number((sx * cy * cz - cx * sy * sz).toFixed(6)),
        Number((cx * sy * cz + sx * cy * sz).toFixed(6)),
        Number((cx * cy * sz - sx * sy * cz).toFixed(6)),
        Number((cx * cy * cz + sx * sy * sz).toFixed(6)),
      ],
    });
  });

  const combinedBuffer = Buffer.concat(binaryChunks);
  const dataUri = `data:application/octet-stream;base64,${combinedBuffer.toString('base64')}`;

  const gltfDoc: any = {
    asset: {
      version: '2.0',
      generator: 'Forge AI Studio 3D Pipeline (Roblox Studio + Blender + glTF 2.0)',
    },
    scene: 0,
    scenes: [
      {
        name: safeName,
        nodes: nodes.map((_, i) => i),
      },
    ],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [
      {
        byteLength: byteOffset,
        uri: dataUri,
      },
    ],
  };

  if (images.length > 0) gltfDoc.images = images;
  if (samplers.length > 0) gltfDoc.samplers = samplers;
  if (textures.length > 0) gltfDoc.textures = textures;

  return JSON.stringify(gltfDoc, null, 2);
}

export function generatePBRSurfaceAppearanceLuau(
  materialName: string,
  targetFolder: string,
  roughness: number,
  metalness: number,
  albedoHex: string,
  cloudAssetIds?: {
    colorMapId?: string;
    normalMapId?: string;
    roughnessMapId?: string;
    metalnessMapId?: string;
  }
): string {
  const safeMat = materialName.replace(/[^a-zA-Z0-9_]/g, '') || 'ForgePBRMaterial';
  const validColor = validatePublishedRobloxMeshId(cloudAssetIds?.colorMapId);
  const validNormal = validatePublishedRobloxMeshId(cloudAssetIds?.normalMapId);
  const validRoughness = validatePublishedRobloxMeshId(cloudAssetIds?.roughnessMapId);
  const validMetalness = validatePublishedRobloxMeshId(cloudAssetIds?.metalnessMapId);

  const hexClean = String(albedoHex || '#38bdf8').replace('#', '').trim();
  const rVal = hexClean.length === 6 ? parseInt(hexClean.slice(0, 2), 16) || 56 : 56;
  const gVal = hexClean.length === 6 ? parseInt(hexClean.slice(2, 4), 16) || 189 : 189;
  const bVal = hexClean.length === 6 ? parseInt(hexClean.slice(4, 6), 16) || 248 : 248;

  const lines: string[] = [
    '--!strict',
    `-- Generated by Forge AI Asset Engine: PBR SurfaceAppearance + EditableImage (${safeMat})`,
    `-- Local Rojo PNG Maps: ${targetFolder}/${safeMat}_ColorMap.png, _NormalMap.png, _RoughnessMap.png, _MetalnessMap.png`,
    'local AssetService = game:GetService("AssetService")',
    '',
    `local ${safeMat}PBR = {}`,
    '',
    'local function createProceduralEditableTexture(r: number, g: number, b: number, rough: number): Content?',
    '    local ok, content = pcall(function()',
    '        local width, height = 64, 64',
    '        local editableImage = AssetService:CreateEditableImage({ Size = Vector2.new(width, height) })',
    '        local pixels = buffer.create(width * height * 4)',
    '        for y = 0, height - 1 do',
    '            for x = 0, width - 1 do',
    '                local idx = (y * width + x) * 4',
    '                local grain = math.floor(math.sin(x * 0.45) * math.cos(y * 0.45) * 14 * (1 - rough * 0.5))',
    '                buffer.writeu8(pixels, idx + 0, math.clamp(r + grain, 0, 255))',
    '                buffer.writeu8(pixels, idx + 1, math.clamp(g + grain, 0, 255))',
    '                buffer.writeu8(pixels, idx + 2, math.clamp(b + grain, 0, 255))',
    '                buffer.writeu8(pixels, idx + 3, 255)',
    '            end',
    '        end',
    '        editableImage:WritePixelsBuffer(Vector2.zero, Vector2.new(width, height), pixels)',
    '        return Content.fromObject(editableImage)',
    '    end)',
    '    if ok then return content end',
    '    return nil',
    'end',
    '',
    `function ${safeMat}PBR.Apply(targetPart: BasePart): SurfaceAppearance`,
    '    local existing = targetPart:FindFirstChildOfClass("SurfaceAppearance")',
    '    if existing then',
    '        existing:Destroy()',
    '    end',
    '    local surface = Instance.new("SurfaceAppearance")',
    `    surface.Name = "${safeMat}_SurfaceAppearance"`,
    '    surface.AlphaMode = Enum.AlphaMode.Overlay',
    `    targetPart.Color = Color3.fromRGB(${rVal}, ${gVal}, ${bVal})`,
  ];

  if (validColor) lines.push(`    surface.ColorMap = "${validColor}"`);
  if (validNormal) lines.push(`    surface.NormalMap = "${validNormal}"`);
  if (validRoughness) lines.push(`    surface.RoughnessMap = "${validRoughness}"`);
  if (validMetalness) lines.push(`    surface.MetalnessMap = "${validMetalness}"`);

  if (!validColor) {
    lines.push(
      '    -- When no published Cloud ColorMap ID is supplied yet, synthesize runtime EditableImage texture:',
      `    local runtimeColorContent = createProceduralEditableTexture(${rVal}, ${gVal}, ${bVal}, ${Number(roughness).toFixed(2)})`,
      '    if runtimeColorContent and targetPart:IsA("MeshPart") then',
      '        pcall(function()',
      '            (targetPart :: any).TextureContent = runtimeColorContent',
      '        end)',
      '    end'
    );
  }

  lines.push(
    `    targetPart:SetAttribute("PBR_MaterialName", "${safeMat}")`,
    `    targetPart:SetAttribute("PBR_Roughness", ${Number(roughness).toFixed(2)})`,
    `    targetPart:SetAttribute("PBR_Metalness", ${Number(metalness).toFixed(2)})`,
    `    targetPart:SetAttribute("PBR_AlbedoHex", "${albedoHex}")`,
    `    targetPart:SetAttribute("PBR_LocalColorMapPath", "${targetFolder}/${safeMat}_ColorMap.png")`,
    `    targetPart:SetAttribute("PBR_LocalNormalMapPath", "${targetFolder}/${safeMat}_NormalMap.png")`,
    `    targetPart:SetAttribute("PBR_LocalRoughnessMapPath", "${targetFolder}/${safeMat}_RoughnessMap.png")`,
    `    targetPart:SetAttribute("PBR_LocalMetalnessMapPath", "${targetFolder}/${safeMat}_MetalnessMap.png")`,
    `    targetPart:SetAttribute("PBR_HasPublishedCloudIds", ${Boolean(validColor || validNormal || validRoughness || validMetalness) ? 'true' : 'false'})`,
    '    surface.Parent = targetPart',
    '    return surface',
    'end',
    '',
    `return ${safeMat}PBR`
  );
  return lines.join('\n');
}
