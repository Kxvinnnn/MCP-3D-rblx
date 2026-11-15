import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  synthesizeSeededProcedural3DAsset,
  validateProcedural3DGeometry,
} from '../src/server/engines/procedural3DGenerator.ts';
import { validateAssetAnatomyAndQuality } from '../src/server/engines/anatomicalQualityValidator.ts';
import {
  encodeRgbaToPngDataUri,
  generateServerPbrTextureSet,
} from '../src/server/engines/pbrTextureEngine.ts';
import {
  analyzeMultiViewReferenceImages,
  analyzeReferenceImageBase64,
} from '../src/server/engines/imageReferenceProcessor.ts';
import { evaluateAssetQualityMetrics } from '../src/server/engines/visualBenchmarkSuite.ts';

const BENCHMARK_OUTPUT_DIR = path.resolve(process.cwd(), 'docs', 'benchmarks');

function persistSnapshots(slug: string, asset: Record<string, any>) {
  fs.mkdirSync(BENCHMARK_OUTPUT_DIR, { recursive: true });
  const snaps = asset.multi_angle_snapshots;
  if (!snaps) return;
  const views: Array<[string, string | undefined]> = [
    ['front', snaps.frontSvg],
    ['side', snaps.sideSvg],
    ['back', snaps.backSvg],
    ['isometric', snaps.isometricSvg],
    ['top', snaps.topSvg],
  ];
  for (const [view, svg] of views) {
    if (typeof svg === 'string' && svg.includes('<svg')) {
      fs.writeFileSync(path.join(BENCHMARK_OUTPUT_DIR, `${slug}_${view}.svg`), svg, 'utf-8');
    }
  }
}

function makeTinyTestPngBase64(width: number, height: number, fillR: number, fillG: number, fillB: number): string {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x / (width - 1)) * 2 - 1;
      const ny = (y / (height - 1)) * 2 - 1;
      const inside = nx * nx + ny * ny <= 0.65;
      const idx = (y * width + x) * 4;
      if (inside) {
        rgba[idx] = fillR;
        rgba[idx + 1] = fillG;
        rgba[idx + 2] = fillB;
        rgba[idx + 3] = 255;
      }
    }
  }
  const uri = encodeRgbaToPngDataUri(width, height, rgba);
  return uri.split(',')[1] || '';
}

test('6 Mandatory 3D Asset Cases produce sculpted geometry, real PBR textures, and valid 5-angle SVG snapshots', () => {
  const cases = [
    {
      slug: 'case_a_horse',
      prompt: 'Create a realistic brown horse with sculpted mane, tail, hooves, and athletic musculature',
      category: 'Props',
      visual_style: 'realistic' as const,
      seed: 'studio-case-a-horse',
    },
    {
      slug: 'case_b_cow',
      prompt: 'Create a white and black spotted dairy cow with curved horns and udder',
      category: 'Props',
      visual_style: 'semi_realistic' as const,
      seed: 'studio-case-b-cow',
    },
    {
      slug: 'case_c_fantasy_tree',
      prompt: 'Create a tall glowing fantasy tree with twisted roots and blue crystal foliage',
      category: 'Trees & Vegetation',
      visual_style: 'fantasy' as const,
      seed: 'studio-case-c-tree',
    },
    {
      slug: 'case_d_sports_car',
      prompt: 'Create a sleek cyan metallic futuristic sports car with glass canopy and rear spoiler',
      category: 'Props',
      visual_style: 'sci_fi' as const,
      seed: 'studio-case-d-car',
    },
    {
      slug: 'case_e_medieval_house',
      prompt: 'Create a medieval stone and timber house with pitched roof, wooden door, and warm windows',
      category: 'Buildings & Structures',
      visual_style: 'medieval' as const,
      seed: 'studio-case-e-house',
    },
    {
      slug: 'case_f_arbitrary_telescope',
      prompt: 'Create an ornate brass astronomical telescope mounted on a wooden tripod',
      category: 'Props',
      visual_style: 'stylized' as const,
      seed: 'studio-case-f-telescope',
    },
  ];

  for (const c of cases) {
    const asset = synthesizeSeededProcedural3DAsset({
      prompt: c.prompt,
      category: c.category,
      visual_style: c.visual_style,
      texture_resolution: 256,
      seed: c.seed,
      generation_mode: 'procedural',
    });

    const geom = validateProcedural3DGeometry(asset.parts);
    assert.equal(geom.valid, true, `${c.slug} geometry errors: ${geom.errors.join('; ')}`);
    assert.equal(geom.degenerateTriangles, 0, `${c.slug} has degenerate triangles`);
    assert.equal(geom.editableMeshCompliant, true, `${c.slug} exceeds EditableMesh limits`);

    assert.ok(asset.pbr_textures?.catalog, `${c.slug} missing pbr_textures.catalog`);
    const catalogKeys = Object.keys(asset.pbr_textures.catalog);
    assert.ok(catalogKeys.length >= 1, `${c.slug} has empty PBR catalog`);
    const firstPbr = asset.pbr_textures.catalog[catalogKeys[0]];
    assert.ok(firstPbr.albedoDataUri.startsWith('data:image/png;base64,'));
    assert.ok(firstPbr.normalDataUri.startsWith('data:image/png;base64,'));
    assert.ok(firstPbr.roughnessDataUri.startsWith('data:image/png;base64,'));
    assert.ok(firstPbr.aoDataUri.startsWith('data:image/png;base64,'));

    assert.ok(asset.anatomical_validation, `${c.slug} missing anatomical_validation`);
    assert.ok(
      asset.anatomical_validation.overallScore >= 68,
      `${c.slug} anatomical score too low: ${asset.anatomical_validation.overallScore} (${asset.anatomical_validation.defects.join(', ')})`
    );
    assert.equal(
      asset.anatomical_validation.passed,
      true,
      `${c.slug} failed anatomical validation: ${asset.anatomical_validation.defects.join(', ')}`
    );

    const benchMetrics = evaluateAssetQualityMetrics(asset);
    assert.ok(benchMetrics.overallScore >= 68, `${c.slug} benchmark overallScore=${benchMetrics.overallScore}`);

    persistSnapshots(c.slug, asset);
  }
});

test('Case A Horse has sculpted non-SmoothPlastic anatomy, Mane_Forelock, and vertexColors', () => {
  const horse = synthesizeSeededProcedural3DAsset({
    prompt: 'Create a brown horse',
    category: 'Props',
    seed: 'horse-anatomy-check',
  });
  const partNames = new Set(horse.parts.map((p: any) => p.name));
  assert.ok(partNames.has('TorsoBody_Main'));
  assert.ok(partNames.has('Mane_DorsalCrest'));
  assert.ok(partNames.has('Mane_Forelock'));
  assert.ok(partNames.has('Tail_Main'));

  const smoothPlasticParts = horse.parts.filter((p: any) => p.material === 'SmoothPlastic');
  assert.equal(smoothPlasticParts.length, 0, 'Horse should not use SmoothPlastic for fur/hooves');

  const torso = horse.parts.find((p: any) => p.name === 'TorsoBody_Main');
  assert.ok(Array.isArray(torso.meshData?.vertexColors) && torso.meshData.vertexColors.length > 0);
});

test('Uncheatable validator rejects a SmoothPlastic cylinder-box fake horse vs sculpted horse', () => {
  const fakeBoxVerts: [number, number, number][] = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  const fakeHorse = {
    prompt: 'Create a horse',
    parts: [
      {
        name: 'TorsoBody_Main',
        position: [0, 4, 0],
        size: [2, 2, 2],
        material: 'SmoothPlastic',
        color: '#8b4513',
        meshData: { vertices: fakeBoxVerts, faces: [[0, 1, 2]] },
      },
      {
        name: 'Head_Cranium',
        position: [0, 8, 4], // Floating > 0.45 studs away
        size: [1, 1, 1],
        material: 'SmoothPlastic',
        color: '#8b4513',
        meshData: { vertices: fakeBoxVerts, faces: [[0, 1, 2]] },
      },
    ],
  };

  const fakeReport = validateAssetAnatomyAndQuality(fakeHorse as any);
  assert.equal(fakeReport.passed, false);
  assert.ok(fakeReport.overallScore < 55, `Fake horse scored too high: ${fakeReport.overallScore}`);

  const realHorse = synthesizeSeededProcedural3DAsset({
    prompt: 'Create a horse',
    category: 'Props',
    seed: 'real-vs-fake-horse',
  });
  const realReport = validateAssetAnatomyAndQuality(realHorse);
  assert.equal(realReport.passed, true);
  assert.ok(realReport.overallScore > fakeReport.overallScore + 25);
});

test('7 Prompt, Style, Seed, PBR & Multi-View Image-to-3D Variations behave deterministically and distinctly', () => {
  // 1. Color change
  const blueTree = synthesizeSeededProcedural3DAsset({
    prompt: 'Create an ancient tree with glowing blue leaves',
    category: 'Trees & Vegetation',
    seed: 'var-tree-color',
  });
  const crimsonTree = synthesizeSeededProcedural3DAsset({
    prompt: 'Create an ancient tree with crimson red leaves',
    category: 'Trees & Vegetation',
    seed: 'var-tree-color',
  });
  assert.notEqual(blueTree.contentHash, crimsonTree.contentHash);

  // 2. Size change
  const tallTree = synthesizeSeededProcedural3DAsset({
    prompt: 'Create a giant towering 30 stud pine tree',
    category: 'Trees & Vegetation',
    seed: 'var-tree-size',
  });
  const smallBonsai = synthesizeSeededProcedural3DAsset({
    prompt: 'Create a tiny miniature bonsai tree',
    category: 'Trees & Vegetation',
    seed: 'var-tree-size',
  });
  assert.notEqual(tallTree.contentHash, smallBonsai.contentHash);

  // 3. Visual style change
  const realisticCar = synthesizeSeededProcedural3DAsset({
    prompt: 'Create a sleek sports car',
    visual_style: 'realistic',
    seed: 'var-style-car',
  });
  const cartoonCar = synthesizeSeededProcedural3DAsset({
    prompt: 'Create a sleek sports car',
    visual_style: 'cartoon',
    seed: 'var-style-car',
  });
  assert.equal(realisticCar.visual_style, 'realistic');
  assert.equal(cartoonCar.visual_style, 'cartoon');
  assert.notEqual(realisticCar.contentHash, cartoonCar.contentHash);

  // 4. Seed change
  const seed1 = synthesizeSeededProcedural3DAsset({
    prompt: 'Create a pine tree',
    category: 'Trees & Vegetation',
    seed: 'seed-alpha-1',
  });
  const seed2 = synthesizeSeededProcedural3DAsset({
    prompt: 'Create a pine tree',
    category: 'Trees & Vegetation',
    seed: 'seed-beta-2',
  });
  assert.notEqual(seed1.geometryHash, seed2.geometryHash);

  // 5. Anatomical horn feature change
  const longHornCow = synthesizeSeededProcedural3DAsset({
    prompt: 'Create a bull cow with long curved horns',
    seed: 'var-cow-horns',
  });
  const standardCow = synthesizeSeededProcedural3DAsset({
    prompt: 'Create a spotted dairy cow',
    seed: 'var-cow-horns',
  });
  assert.notEqual(longHornCow.contentHash, standardCow.contentHash);

  // 6. Single-image vs multi-image Image-to-3D uncertainty report
  const view1B64 = makeTinyTestPngBase64(24, 24, 180, 90, 60);
  const view2B64 = makeTinyTestPngBase64(24, 24, 160, 85, 55);
  const singleAnalysis = analyzeReferenceImageBase64(view1B64);
  const multiAnalysis = analyzeMultiViewReferenceImages([view1B64, view2B64]);
  assert.equal(singleAnalysis.validImageDecoded, true);
  assert.equal(singleAnalysis.uncertaintyReport?.viewCount, 1);
  assert.equal(singleAnalysis.uncertaintyReport?.hiddenSidesInferred, true);
  assert.equal(multiAnalysis.uncertaintyReport?.viewCount, 2);
  assert.ok(
    (multiAnalysis.uncertaintyReport?.confidence ?? 0) >
      (singleAnalysis.uncertaintyReport?.confidence ?? 1)
  );

  // 7. Server PBR texture set at 256px and 512px
  const pbr512 = generateServerPbrTextureSet(
    {
      id: 'horse_coat_512',
      pattern: 'organic_fur_coat',
      baseColorHex: '#7c4a2d',
      roughnessBase: 0.8,
      metallicBase: 0.02,
      style: 'realistic',
    },
    512
  );
  assert.equal(pbr512.resolution, 512);
  assert.ok(pbr512.albedoDataUri.startsWith('data:image/png;base64,'));
  assert.ok(pbr512.normalDataUri.startsWith('data:image/png;base64,'));
  assert.ok(pbr512.surfaceAppearance.ColorMap.startsWith('data:image/png;base64,'));
});
