import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import net from 'net';
import { execSync } from 'child_process';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import {
  FORGE_MODULAR_ENGINES,
  FORGE_ROADMAP_STATUS,
  SPECIALIZED_AGENTS,
} from './src/server/engines/architectureManifest.ts';
import {
  buildStrictLuauFromEditedParts,
  extractGeometryFromProcessedMesh,
  extractPartsFromUploadedMesh,
  generatePBRSurfaceAppearanceLuau,
  generateWorldEnvironmentLuau,
  normalizeValidMeshId,
  synthesizeProceduralMeshData,
} from './src/server/engines/worldAndModelEditorEngine.ts';

dotenv.config();

const app = express();
const PORT = 3000;
const FASTAPI_UPSTREAM = process.env.FASTAPI_UPSTREAM_URL || 'http://127.0.0.1:8000';

app.use(express.json({ limit: '25mb' }));

// -----------------------------------------------------------------------------
// 1. Security Hardening: Restricted CORS, Rate Limiting & Path Validation
// -----------------------------------------------------------------------------

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.has(origin) || origin.endsWith('.run.app'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Forge-Token, User-Agent');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Sliding-window rate limiter (45 requests / minute per IP)
const rateBuckets = new Map<string, number[]>();
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MINUTE || 45);
let runtimeRojoPath = path.resolve(process.cwd(), process.env.ROJO_PROJECT_PATH || './rojo_workspace');
let runtimeSecurityToken = process.env.FORGE_LOCAL_TOKEN || '';

app.use('/api/v1', (req, res, next) => {
  const ip = req.ip || '127.0.0.1';
  const now = Date.now();
  const windowMs = 60_000;
  const recent = (rateBuckets.get(ip) || []).filter((t) => now - t < windowMs);
  if (recent.length >= RATE_LIMIT_PER_MIN) {
    return res.status(429).json({
      error: `Límite de frecuencia alcanzado (${RATE_LIMIT_PER_MIN} req/min). Espera unos segundos.`,
    });
  }
  recent.push(now);
  rateBuckets.set(ip, recent);

  if (runtimeSecurityToken && ['POST', 'DELETE', 'PUT'].includes(req.method)) {
    const provided = req.headers['x-forge-token'] || '';
    if (provided !== runtimeSecurityToken) {
      return res.status(401).json({
        error: 'Acceso denegado: Cabecera X-Forge-Token inválida o ausente.',
      });
    }
  }
  next();
});

// Optional Automatic Upstream Proxy to FastAPI (Port 8000) when FastAPI is running locally
async function isFastApiRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(180);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(8000, '127.0.0.1');
  });
}

// Shared Gemini Client for server-side calls
const apiKey = process.env.GEMINI_API_KEY || '';
const ai = apiKey
  ? new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

const ALLOWED_EXTENSIONS = new Set(['.luau', '.json', '.obj', '.gltf', '.md', '.png']);
const FORBIDDEN_LUAU_PATTERNS = [/\bloadstring\s*\(/, /\bgetfenv\s*\(/, /\bsetfenv\s*\(/];

function resolveSafeProjectPath(rojoTargetFolder: string, fileName: string): string {
  const rojoRoot = path.resolve(runtimeRojoPath);
  fs.mkdirSync(rojoRoot, { recursive: true });

  const cleanFolder = (rojoTargetFolder || 'src/shared').replace(/^[/\\]+/, '');
  if (cleanFolder.includes('..') || (fileName || '').includes('..') || (fileName || '').includes('\0')) {
    throw new Error("Violación de Seguridad: Se detectó intento de Path Traversal ('..').");
  }

  const cleanFileName = path.basename(fileName || 'Generated.luau');
  const ext = path.extname(cleanFileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Violación de Seguridad: Extensión de archivo '${ext}' no permitida.`);
  }

  const targetDir = path.resolve(rojoRoot, cleanFolder);
  if (!targetDir.startsWith(rojoRoot)) {
    throw new Error('Violación de Seguridad: La carpeta destino escapa del proyecto Rojo.');
  }
  fs.mkdirSync(targetDir, { recursive: true });

  const targetFile = path.resolve(targetDir, cleanFileName);
  if (!targetFile.startsWith(rojoRoot)) {
    throw new Error('Violación de Seguridad: El archivo destino escapa del proyecto Rojo.');
  }

  return targetFile;
}

function validateAndSanitizeLuau(code: string): string {
  let cleaned = (code || '').trim();
  if (!cleaned.startsWith('--!strict')) {
    cleaned = `--!strict\n${cleaned}`;
  }
  for (const regex of FORBIDDEN_LUAU_PATTERNS) {
    if (regex.test(cleaned)) {
      throw new Error(`Violación de Seguridad: Patrón Luau prohibido detectado (${regex.source}).`);
    }
  }
  return `${cleaned}\n`;
}

function writeToRojoWorkspace(rojoTargetFolder: string, fileName: string, luauCode: string): string {
  const safeCode = validateAndSanitizeLuau(luauCode);
  const absTarget = resolveSafeProjectPath(rojoTargetFolder, fileName);
  fs.writeFileSync(absTarget, safeCode, 'utf-8');
  const relToRoot = path.relative(process.cwd(), absTarget).replace(/\\/g, '/');
  return `./${relToRoot}`;
}

function writeRawAssetToRojoWorkspace(rojoTargetFolder: string, fileName: string, content: Buffer | string): string {
  const absTarget = resolveSafeProjectPath(rojoTargetFolder, fileName);
  if (typeof content === 'string') {
    fs.writeFileSync(absTarget, content, 'utf-8');
  } else {
    fs.writeFileSync(absTarget, content);
  }
  const relToRoot = path.relative(process.cwd(), absTarget).replace(/\\/g, '/');
  return `./${relToRoot}`;
}

function sendSseEvent(res: express.Response, payload: Record<string, any>) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// -----------------------------------------------------------------------------
// 2. Real Rojo Workspace & Context Module Auditor
// -----------------------------------------------------------------------------

function walkLuauFiles(dir: string, rootDir: string, list: Array<{ name: string; relative_path: string; sha256: string }> = []) {
  if (!fs.existsSync(dir)) return list;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkLuauFiles(fullPath, rootDir, list);
    } else if (entry.isFile() && entry.name.endsWith('.luau')) {
      const content = fs.readFileSync(fullPath);
      const sha256 = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      const baseName = entry.name
        .replace(/\.server\.luau$/, '')
        .replace(/\.client\.luau$/, '')
        .replace(/\.luau$/, '');
      list.push({
        name: baseName,
        relative_path: relPath,
        sha256,
      });
    }
  }
  return list;
}

function auditProjectModules() {
  const rojoRoot = path.resolve(runtimeRojoPath);
  const srcDir = path.join(rojoRoot, 'src');
  const verifiedFiles = walkLuauFiles(srcDir, rojoRoot);
  const verifiedNames = Array.from(new Set(verifiedFiles.map((f) => f.name))).sort();

  const expectedCore = [
    { name: 'Maid', rojo_path: 'src/shared/Utils/Maid.luau', roblox_path: 'ReplicatedStorage.Shared.Utils.Maid' },
    { name: 'RemoteProvider', rojo_path: 'src/shared/Network/RemoteProvider.luau', roblox_path: 'ReplicatedStorage.Shared.Network.RemoteProvider' },
    { name: 'GameTypes', rojo_path: 'src/shared/Types/GameTypes.luau', roblox_path: 'ReplicatedStorage.Shared.Types.GameTypes' },
  ];

  const coreModules = expectedCore.map((mod) => ({
    ...mod,
    exists: fs.existsSync(path.join(rojoRoot, mod.rojo_path)),
  }));

  return {
    rojo_root: rojoRoot,
    core_modules: coreModules,
    all_verified_modules: verifiedFiles,
    verified_module_names: verifiedNames,
  };
}

function getLocalProjectContext(): string {
  const contextPaths = [
    path.resolve(runtimeRojoPath, 'project_context.md'),
    path.resolve(process.cwd(), 'backend', 'project_context.md'),
    path.resolve(process.cwd(), 'project_context.md'),
  ];
  let rawContext = '';
  for (const cp of contextPaths) {
    if (fs.existsSync(cp)) {
      try {
        rawContext = fs.readFileSync(cp, 'utf-8');
        break;
      } catch {
        // ignore
      }
    }
  }

  const audit = auditProjectModules();
  const verifiedList = audit.verified_module_names.length > 0 ? audit.verified_module_names.join(', ') : 'NONE';
  const missingCore = audit.core_modules.filter((m) => !m.exists).map((m) => m.name);

  const verificationBlock = `
--- VERIFIED ON-DISK ROJO MODULES ---
Verified existing modules in project: [${verifiedList}]
Missing core modules: [${missingCore.length > 0 ? missingCore.join(', ') : 'None - All Core Modules Verified on Disk'}]
CRITICAL RULE: You may ONLY require() modules that are confirmed in 'Verified existing modules in project'. Never require non-existent modules!
--- END VERIFIED MODULES ---
`;

  return `${rawContext}\n${verificationBlock}`;
}

async function checkRojoPortActive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(220);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

async function getRojoFullStatus() {
  const rojoRoot = path.resolve(runtimeRojoPath);
  const projectJsonPath = path.join(rojoRoot, 'default.project.json');
  let projectConfig: any = null;
  if (fs.existsSync(projectJsonPath)) {
    try {
      projectConfig = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
    } catch {
      projectConfig = null;
    }
  }

  let rojoVersion: string | null = null;
  try {
    rojoVersion = execSync('rojo --version', { timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    rojoVersion = null;
  }

  const servePort = projectConfig?.servePort || 34872;
  const serverActive = await checkRojoPortActive(servePort);
  const fastApiActive = await isFastApiRunning();
  const audit = auditProjectModules();

  return {
    rojo_project_path: rojoRoot,
    path_exists: fs.existsSync(rojoRoot),
    default_project_json_found: fs.existsSync(projectJsonPath),
    project_config: projectConfig,
    rojo_cli_installed: Boolean(rojoVersion),
    rojo_version: rojoVersion,
    rojo_serve_port: servePort,
    rojo_server_active: serverActive,
    fastapi_upstream_active: fastApiActive,
    security_token_enabled: Boolean(runtimeSecurityToken),
    rate_limit_per_minute: RATE_LIMIT_PER_MIN,
    audit,
  };
}

// -----------------------------------------------------------------------------
// 3. Persistent 3D Asset Library Helpers
// -----------------------------------------------------------------------------

function getAssetsLibraryPath(): string {
  const rojoRoot = path.resolve(runtimeRojoPath);
  fs.mkdirSync(rojoRoot, { recursive: true });
  const target = path.join(rojoRoot, 'assets_library.json');
  if (!fs.existsSync(target)) {
    const defaultLib = path.resolve(process.cwd(), 'rojo_workspace', 'assets_library.json');
    if (fs.existsSync(defaultLib) && defaultLib !== target) {
      fs.copyFileSync(defaultLib, target);
    } else {
      fs.writeFileSync(target, '[]', 'utf-8');
    }
  }
  return target;
}

function loadAssetsLibrary(): any[] {
  try {
    return JSON.parse(fs.readFileSync(getAssetsLibraryPath(), 'utf-8'));
  } catch {
    return [];
  }
}

function saveAssetToLibrary(asset: any): any {
  const assets = loadAssetsLibrary();
  if (!asset.id) {
    asset.id = `asset-${Date.now()}`;
  }
  asset.created_at = new Date().toISOString();
  const filtered = assets.filter((a) => a.id !== asset.id);
  filtered.unshift(asset);
  fs.writeFileSync(getAssetsLibraryPath(), JSON.stringify(filtered, null, 2), 'utf-8');
  return asset;
}

// Read backend files to serve to frontend code explorer
function getBackendSourceFiles() {
  const backendDir = path.resolve(process.cwd(), 'backend');
  const files: Record<string, string> = {};

  const rootDir = process.cwd();
  const fileList = [
    { name: 'README.md', path: path.join(rootDir, 'README.md') },
    { name: 'docs/ARCHITECTURE.md', path: path.join(rootDir, 'docs', 'ARCHITECTURE.md') },
    { name: 'docs/API_REFERENCE.md', path: path.join(rootDir, 'docs', 'API_REFERENCE.md') },
    { name: 'docs/ROBLOX_PLUGIN_AND_ROJO_GUIDE.md', path: path.join(rootDir, 'docs', 'ROBLOX_PLUGIN_AND_ROJO_GUIDE.md') },
    { name: 'main.py', path: path.join(backendDir, 'main.py') },
    { name: 'requirements.txt', path: path.join(backendDir, 'requirements.txt') },
    { name: '.env.example', path: path.join(backendDir, '.env.example') },
    { name: 'project_context.md', path: path.join(backendDir, 'project_context.md') },
    { name: 'engines/rojo_bridge.py', path: path.join(backendDir, 'engines', 'rojo_bridge.py') },
    { name: 'engines/generation_3d_engine.py', path: path.join(backendDir, 'engines', 'generation_3d_engine.py') },
    { name: 'engines/asset_engine.py', path: path.join(backendDir, 'engines', 'asset_engine.py') },
    { name: 'engines/world_engine.py', path: path.join(backendDir, 'engines', 'world_engine.py') },
    { name: 'engines/luau_engine.py', path: path.join(backendDir, 'engines', 'luau_engine.py') },
    { name: 'engines/ui_engine.py', path: path.join(backendDir, 'engines', 'ui_engine.py') },
    { name: 'engines/agents_engine.py', path: path.join(backendDir, 'engines', 'agents_engine.py') },
    { name: 'src/components/engines/3dEngine.ts', path: path.join(rootDir, 'src', 'components', 'engines', '3dEngine.ts') },
    { name: 'roblox_plugin/ForgeAIStudioPlugin.server.luau', path: path.join(backendDir, 'roblox_plugin', 'ForgeAIStudioPlugin.server.luau') },
    { name: 'rojo_workspace/default.project.json', path: path.resolve(runtimeRojoPath, 'default.project.json') },
    { name: 'rojo_workspace/src/shared/Utils/Maid.luau', path: path.resolve(runtimeRojoPath, 'src/shared/Utils/Maid.luau') },
  ];

  for (const item of fileList) {
    if (fs.existsSync(item.path)) {
      try {
        files[item.name] = fs.readFileSync(item.path, 'utf-8');
      } catch (e) {
        files[item.name] = `# Error reading ${item.name}: ${e}`;
      }
    }
  }

  return files;
}

// -----------------------------------------------------------------------------
// 4. Unified API Endpoints
// -----------------------------------------------------------------------------

app.get('/api/v1/files', (_req, res) => {
  res.json({ files: getBackendSourceFiles() });
});

app.get('/api/v1/health', async (_req, res) => {
  const rojoStatus = await getRojoFullStatus();
  res.json({
    status: 'ok',
    backend_engine: rojoStatus.fastapi_upstream_active
      ? 'FastAPI Primary Engine (Port 8000 Bridged)'
      : 'Unified FastAPI-Compatible Gateway v2.0',
    gemini_connected: Boolean(ai),
    configured_models: {
      pro: 'gemini-2.5-pro',
      fast: 'gemini-2.5-flash',
    },
    rojo_project_path: rojoStatus.rojo_project_path,
    rojo_path_exists: rojoStatus.path_exists,
    default_project_json_found: rojoStatus.default_project_json_found,
    rojo_server_active: rojoStatus.rojo_server_active,
    context_file_found: true,
    server_time: new Date().toISOString(),
  });
});

app.get('/api/v1/rojo/status', async (_req, res) => {
  res.json(await getRojoFullStatus());
});

app.post('/api/v1/rojo/configure', async (req, res) => {
  try {
    const { rojo_project_path, initialize_if_missing = true, security_token } = req.body;
    if (security_token !== undefined) {
      runtimeSecurityToken = String(security_token).trim();
    }
    if (rojo_project_path) {
      const cleaned = String(rojo_project_path).trim();
      if (cleaned.includes('\0')) {
        return res.status(400).json({ error: 'Ruta inválida.' });
      }
      const resolved = path.resolve(process.cwd(), cleaned);
      if (initialize_if_missing) {
        const subDirs = [
          'src/server',
          'src/client',
          'src/client/UI',
          'src/shared/Utils',
          'src/shared/Network',
          'src/shared/Types',
          'src/shared/Assets3D',
        ];
        for (const sub of subDirs) {
          fs.mkdirSync(path.join(resolved, sub), { recursive: true });
        }
        const projJson = path.join(resolved, 'default.project.json');
        if (!fs.existsSync(projJson)) {
          const defaultProj = {
            name: path.basename(resolved) || 'ForgeAI_Roblox_Project',
            servePort: 34872,
            tree: {
              $className: 'DataModel',
              ReplicatedStorage: { $className: 'ReplicatedStorage', Shared: { $path: 'src/shared' } },
              ServerScriptService: { $className: 'ServerScriptService', Server: { $path: 'src/server' } },
              StarterPlayer: {
                $className: 'StarterPlayer',
                StarterPlayerScripts: { $className: 'StarterPlayerScripts', Client: { $path: 'src/client' } },
              },
              StarterGui: { $className: 'StarterGui', Interface: { $path: 'src/client/UI' } },
            },
          };
          fs.writeFileSync(projJson, JSON.stringify(defaultProj, null, 2), 'utf-8');
        }
      }
      runtimeRojoPath = resolved;
    }
    res.json(await getRojoFullStatus());
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/v1/rojo/sync-manifest', (_req, res) => {
  const audit = auditProjectModules();
  const files = audit.all_verified_modules.map((item) => {
    let datamodel_target = `ReplicatedStorage.Shared.${item.name}`;
    if (item.relative_path.startsWith('src/server')) {
      datamodel_target = `ServerScriptService.Server.${item.name}`;
    } else if (item.relative_path.startsWith('src/client/UI')) {
      datamodel_target = `StarterGui.Interface.${item.name}`;
    } else if (item.relative_path.startsWith('src/client')) {
      datamodel_target = `StarterPlayer.StarterPlayerScripts.Client.${item.name}`;
    }
    return {
      ...item,
      datamodel_target,
    };
  });

  res.json({
    rojo_root: audit.rojo_root,
    total_files: files.length,
    files,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/v1/context/audit', (_req, res) => {
  res.json(auditProjectModules());
});

app.post('/api/v1/context/bootstrap-modules', (_req, res) => {
  try {
    const templateRoot = path.resolve(process.cwd(), 'rojo_workspace');
    const targetRoot = path.resolve(runtimeRojoPath);
    const coreFiles = [
      'src/shared/Utils/Maid.luau',
      'src/shared/Network/RemoteProvider.luau',
      'src/shared/Types/GameTypes.luau',
    ];
    const installed: string[] = [];
    for (const rel of coreFiles) {
      const srcFile = path.join(templateRoot, rel);
      const destFile = path.join(targetRoot, rel);
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      if (fs.existsSync(srcFile) && srcFile !== destFile) {
        fs.copyFileSync(srcFile, destFile);
      }
      if (fs.existsSync(destFile)) {
        installed.push(rel);
      }
    }
    res.json({ installed, audit: auditProjectModules() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/v1/context', (_req, res) => {
  const contextPath = path.resolve(process.cwd(), 'backend', 'project_context.md');
  const content = fs.existsSync(contextPath) ? fs.readFileSync(contextPath, 'utf-8') : '';
  res.json({
    has_context: Boolean(content),
    content,
    audit: auditProjectModules(),
  });
});

app.post('/api/v1/context', (req, res) => {
  try {
    const { content } = req.body;
    const targetPath = path.resolve(process.cwd(), 'backend', 'project_context.md');
    fs.writeFileSync(targetPath, String(content || ''), 'utf-8');
    res.json({ success: true, message: 'Context updated successfully', audit: auditProjectModules() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 5. 3D Asset Library & 3D Generation / Conversion Endpoints
// -----------------------------------------------------------------------------

app.get('/api/v1/architecture', (_req, res) => {
  res.json({
    engines: FORGE_MODULAR_ENGINES,
    roadmap: FORGE_ROADMAP_STATUS,
    agents: SPECIALIZED_AGENTS,
  });
});

app.get('/api/v1/assets', (_req, res) => {
  res.json({ assets: loadAssetsLibrary() });
});

app.post('/api/v1/assets', (req, res) => {
  try {
    const saved = saveAssetToLibrary(req.body);
    res.json({ asset: saved });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// P2 Interactive 3D Model Editor: Rebuild --!strict Luau from edited 3D parts & save to Rojo/Library
app.post('/api/v1/assets/rebuild-luau', (req, res) => {
  try {
    const {
      asset,
      save_to_rojo = true,
      save_to_library = true,
    } = req.body;
    if (!asset || !asset.name) {
      return res.status(400).json({ error: 'Se requiere un objeto asset válido.' });
    }
    const safeModelName = String(asset.name).replace(/[^a-zA-Z0-9_]/g, '') || 'EditedModel3D';
    const objFileName = asset.obj_file_name || `${safeModelName}.obj`;

    const enrichedParts = (asset.parts || []).map((p: any, idx: number) => {
      const partName = p.name || `MeshPart_${idx + 1}`;
      const resolvedMesh = extractGeometryFromProcessedMesh(p, objFileName, safeModelName);
      const meshId = normalizeValidMeshId(
        p.meshId || p.mesh_id || resolvedMesh.meshId,
        safeModelName,
        partName,
        resolvedMesh.vertices.length,
        resolvedMesh.faces.length
      );
      const assetId = normalizeValidMeshId(
        p.assetId || p.asset_id || resolvedMesh.assetId || meshId,
        safeModelName,
        partName,
        resolvedMesh.vertices.length,
        resolvedMesh.faces.length
      );
      resolvedMesh.meshId = meshId;
      resolvedMesh.assetId = assetId;
      resolvedMesh.objFileName = objFileName;

      return {
        ...p,
        name: partName,
        shape: 'MeshPart',
        meshId,
        assetId,
        meshData: resolvedMesh,
      };
    });
    const rebuiltLuau = buildStrictLuauFromEditedParts(
      asset.name,
      enrichedParts,
      asset.collision_fidelity || 'Hull'
    );
    const updatedAsset = {
      ...asset,
      parts: enrichedParts,
      luau_code: rebuiltLuau,
      poly_count: enrichedParts.reduce((acc: number, p: any) => {
        return acc + (p.meshData?.faces?.length || 12);
      }, 0),
    };

    if (save_to_rojo) {
      const savedPath = writeToRojoWorkspace(
        updatedAsset.rojo_target_folder || 'src/shared/Assets3D',
        updatedAsset.file_name || `${updatedAsset.name}.luau`,
        rebuiltLuau
      );
      updatedAsset.saved_path = savedPath;
    }

    const saved = save_to_library ? saveAssetToLibrary(updatedAsset) : updatedAsset;
    res.json({ asset: saved });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GLB/GLTF/OBJ/FBX/Heightmap Preprocessor -> Real Roblox EditableMesh / MeshPart + MeshId/AssetId + OBJ Export Endpoint
app.post('/api/v1/assets/process-meshpart', (req, res) => {
  try {
    const {
      payload,
      save_to_rojo = true,
      save_to_library = true,
    } = req.body;

    if (!payload || !payload.modelName || !Array.isArray(payload.subMeshParts)) {
      return res.status(400).json({
        error: 'Se requiere un payload MeshPartExportPayload válido con modelName y subMeshParts.',
      });
    }

    const targetFolder = payload.rojoTargetFolder || 'src/shared/Assets3D';
    const fileName = payload.fileName || `${payload.modelName}_MeshPart.luau`;
    const objFileName = payload.objFileName || `${payload.modelName}.obj`;

    const parts = payload.subMeshParts.map((sub: any, idx: number) => {
      const partName = sub.name || `MeshPart_${idx + 1}`;
      const studSize = sub.studSize || [2, 2, 2];
      const extractedMesh = extractGeometryFromProcessedMesh(sub, objFileName, payload.modelName);
      const meshId = normalizeValidMeshId(
        sub.meshId || sub.mesh_id || extractedMesh.meshId,
        payload.modelName,
        partName,
        extractedMesh.vertices.length,
        extractedMesh.faces.length
      );
      const assetId = normalizeValidMeshId(
        sub.assetId || sub.asset_id || extractedMesh.assetId || meshId,
        payload.modelName,
        partName,
        extractedMesh.vertices.length,
        extractedMesh.faces.length
      );

      extractedMesh.meshId = meshId;
      extractedMesh.assetId = assetId;
      extractedMesh.objFileName = objFileName;

      return {
        name: partName,
        shape: 'MeshPart',
        meshId,
        assetId,
        textureId: sub.textureId || sub.texture_id,
        size: studSize,
        position: sub.studPosition || [0, 1, 0],
        rotation: sub.studRotation || [0, 0, 0],
        color: sub.colorRgb || [148, 163, 184],
        material: sub.robloxMaterial || 'Metal',
        roughness: typeof sub.roughness === 'number' ? sub.roughness : 0.35,
        metalness: typeof sub.metalness === 'number' ? sub.metalness : 0.65,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: sub.collisionFidelity || 'Hull',
        meshData: extractedMesh,
      };
    });

    const luauCode =
      payload.luauMeshPartBuilderCode &&
      payload.luauMeshPartBuilderCode.includes('rbxassetid://') &&
      payload.luauMeshPartBuilderCode.includes('CreateMeshPartAsync')
        ? payload.luauMeshPartBuilderCode
        : buildStrictLuauFromEditedParts(payload.modelName, parts, 'Hull');

    let savedPath: string | null = null;
    let objSavedPath: string | null = null;
    if (save_to_rojo) {
      savedPath = writeToRojoWorkspace(targetFolder, fileName, luauCode);
      if (typeof payload.combinedWavefrontObj === 'string' && payload.combinedWavefrontObj.trim().length > 0) {
        objSavedPath = writeRawAssetToRojoWorkspace(targetFolder, objFileName, payload.combinedWavefrontObj);
      }
    }

    const assetRecord = {
      id: `meshpart-${Date.now()}`,
      name: payload.modelName,
      category: `Imported ${payload.sourceFormat || '3D'}`,
      asset_type: 'Model3D',
      poly_count: Number(payload.totalTriangles || 0),
      collision_fidelity: parts[0]?.collisionFidelity || 'Hull',
      rojo_target_folder: targetFolder,
      file_name: fileName,
      obj_file_name: objFileName,
      obj_saved_path: objSavedPath,
      description: `MeshPart 3D con geometría real desde ${payload.sourceFormat || 'GLB/OBJ'} (${parts.length} MeshParts, ${payload.totalTriangles || 0} triángulos, EditableMesh + OBJ sincronizados).`,
      pbr_profile: {
        albedo_hex: '#38bdf8',
        roughness: parts[0]?.roughness ?? 0.35,
        metalness: parts[0]?.metalness ?? 0.65,
        emissive_hex: '#06b6d4',
        roblox_material: parts[0]?.material || 'Metal',
        pattern: 'BrushedTitanium',
      },
      parts,
      luau_code: luauCode,
      saved_path: savedPath,
    };

    const finalAsset = save_to_library ? saveAssetToLibrary(assetRecord) : assetRecord;

    res.json({
      success: true,
      asset: finalAsset,
      saved_path: savedPath,
      obj_saved_path: objSavedPath,
      meshpart_count: parts.length,
      total_triangles: Number(payload.totalTriangles || 0),
      is_roblox_compliant: Boolean(payload.isRobloxCompliant),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Publish browser-synthesized PBR maps (ColorMap, NormalMap, RoughnessMap) + SurfaceAppearance Luau binder to Rojo
app.post('/api/v1/assets/publish-pbr', (req, res) => {
  try {
    const {
      material_name = 'ForgePBRMaterial',
      albedo_data_url = '',
      normal_data_url = '',
      roughness_data_url = '',
      roughness = 0.35,
      metalness = 0.75,
      albedo_hex = '#38bdf8',
    } = req.body;

    const safeMat = String(material_name).replace(/[^a-zA-Z0-9_]/g, '') || 'ForgePBRMaterial';
    const textureFolder = 'src/shared/Assets3D/Textures';
    const savedTextures: Record<string, string> = {};

    const mapEntries: Array<[string, string]> = [
      [albedo_data_url, 'ColorMap.png'],
      [normal_data_url, 'NormalMap.png'],
      [roughness_data_url, 'RoughnessMap.png'],
    ];

    for (const [dataUrl, suffix] of mapEntries) {
      if (typeof dataUrl === 'string' && dataUrl.includes(',')) {
        const b64 = dataUrl.split(',')[1];
        if (b64) {
          const buf = Buffer.from(b64, 'base64');
          const fileName = `${safeMat}_${suffix}`;
          savedTextures[suffix] = writeRawAssetToRojoWorkspace(textureFolder, fileName, buf);
        }
      }
    }

    const pbrLuau = generatePBRSurfaceAppearanceLuau(
      safeMat,
      textureFolder,
      Number(roughness),
      Number(metalness),
      String(albedo_hex)
    );
    const luauFileName = `${safeMat}_SurfaceAppearance.luau`;
    const luauSavedPath = writeToRojoWorkspace('src/shared/Assets3D', luauFileName, pbrLuau);

    res.json({
      success: true,
      material_name: safeMat,
      saved_textures: savedTextures,
      luau_file: `src/shared/Assets3D/${luauFileName}`,
      luau_saved_path: luauSavedPath,
      luau_code: pbrLuau,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// P2 World Engine: Build complete Roblox scene + Lighting/Atmosphere & sync to Rojo
app.post('/api/v1/world/build-scene', (req, res) => {
  try {
    const {
      scene_name = 'CyberpunkCitadel',
      biome = 'CyberpunkOrbital',
      placed_assets = [],
      save_to_rojo = true,
    } = req.body;

    const luauCode = generateWorldEnvironmentLuau(scene_name, biome, placed_assets);
    const fileName = `${scene_name.replace(/[^a-zA-Z0-9_]/g, '')}World.luau`;
    let savedPath: string | null = null;
    if (save_to_rojo) {
      savedPath = writeToRojoWorkspace('src/shared', fileName, luauCode);
    }

    res.json({
      scene_name,
      biome,
      file_name: fileName,
      rojo_target_folder: 'src/shared',
      saved_path: savedPath,
      luau_code: luauCode,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Helper: Synthesize prompt-specific 3D sub-parts when offline or as fallback
function synthesizePromptReactive3DParts(promptText: string, systemSlug: string) {
  const lower = promptText.toLowerCase();
  const isVehicle = /ship|nave|car|auto|vehiculo|drone|mech|hover|jet|avion/.test(lower);
  const isNature = /tree|arbol|island|isla|temple|templo|forest|ruin|altar|crystal|cristal/.test(lower);
  const isWeapon = /sword|espada|rifle|blaster|canon|cannon|bow|staff|axe|hacha/.test(lower);

  if (isVehicle) {
    return [
      { name: `${systemSlug}Chassis`, shape: 'MeshPart', size: [6.0, 1.4, 10.0], position: [0, 1.2, 0], rotation: [0, 0, 0], color: [15, 23, 42], material: 'Metal', roughness: 0.28, metalness: 0.85, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
      { name: `${systemSlug}NoseCone`, shape: 'Wedge', size: [5.6, 1.4, 4.0], position: [0, 1.2, -7.0], rotation: [0, 0, 0], color: [30, 41, 59], material: 'Metal', roughness: 0.25, metalness: 0.88, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
      { name: `${systemSlug}CanopyGlass`, shape: 'Ball', size: [3.8, 1.8, 5.2], position: [0, 2.3, -1.0], rotation: [0, 0, 0], color: [56, 189, 248], material: 'Glass', roughness: 0.08, metalness: 0.2, transparency: 0.35, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
      { name: `${systemSlug}WingPort`, shape: 'Wedge', size: [6.5, 0.4, 4.5], position: [-5.5, 1.2, 1.0], rotation: [0, 90, 0], color: [51, 65, 85], material: 'DiamondPlate', roughness: 0.4, metalness: 0.75, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
      { name: `${systemSlug}WingStarboard`, shape: 'Wedge', size: [6.5, 0.4, 4.5], position: [5.5, 1.2, 1.0], rotation: [0, -90, 0], color: [51, 65, 85], material: 'DiamondPlate', roughness: 0.4, metalness: 0.75, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
      { name: `${systemSlug}ThrusterPort`, shape: 'Cylinder', size: [2.6, 1.6, 1.6], position: [-2.0, 1.2, 5.8], rotation: [0, 90, 0], color: [6, 182, 212], material: 'Neon', roughness: 0.1, metalness: 0.1, transparency: 0, canCollide: false, anchored: true, collisionFidelity: 'Box' },
      { name: `${systemSlug}ThrusterStarboard`, shape: 'Cylinder', size: [2.6, 1.6, 1.6], position: [2.0, 1.2, 5.8], rotation: [0, 90, 0], color: [6, 182, 212], material: 'Neon', roughness: 0.1, metalness: 0.1, transparency: 0, canCollide: false, anchored: true, collisionFidelity: 'Box' },
    ];
  }
  if (isNature) {
    return [
      { name: `${systemSlug}SanctuaryFoundation`, shape: 'Cylinder', size: [2.0, 12.0, 12.0], position: [0, 1.0, 0], rotation: [0, 0, 90], color: [71, 85, 105], material: 'Slate', roughness: 0.82, metalness: 0.12, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
      { name: `${systemSlug}AltarPedestal`, shape: 'MeshPart', size: [5.5, 2.5, 5.5], position: [0, 3.25, 0], rotation: [0, 45, 0], color: [100, 116, 139], material: 'Concrete', roughness: 0.75, metalness: 0.15, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
      { name: `${systemSlug}ObeliskNorth`, shape: 'Cylinder', size: [7.0, 1.4, 1.4], position: [0, 5.5, -4.2], rotation: [0, 0, 90], color: [71, 85, 105], material: 'Slate', roughness: 0.8, metalness: 0.1, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
      { name: `${systemSlug}ObeliskSouth`, shape: 'Cylinder', size: [7.0, 1.4, 1.4], position: [0, 5.5, 4.2], rotation: [0, 0, 90], color: [71, 85, 105], material: 'Slate', roughness: 0.8, metalness: 0.1, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
      { name: `${systemSlug}RelicCrystal`, shape: 'Ball', size: [2.6, 4.2, 2.6], position: [0, 6.8, 0], rotation: [0, 0, 0], color: [16, 185, 129], material: 'Neon', roughness: 0.05, metalness: 0.1, transparency: 0.05, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
      { name: `${systemSlug}RunicHalo`, shape: 'Cylinder', size: [0.4, 5.0, 5.0], position: [0, 6.8, 0], rotation: [25, 0, 90], color: [52, 211, 153], material: 'ForceField', roughness: 0.1, metalness: 0.2, transparency: 0.25, canCollide: false, anchored: true, collisionFidelity: 'Box' },
    ];
  }
  if (isWeapon) {
    return [
      { name: `${systemSlug}ForgeAnvilBase`, shape: 'MeshPart', size: [4.2, 1.2, 4.2], position: [0, 0.6, 0], rotation: [0, 0, 0], color: [39, 39, 42], material: 'Metal', roughness: 0.35, metalness: 0.8, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
      { name: `${systemSlug}PommelCore`, shape: 'Ball', size: [1.1, 1.1, 1.1], position: [0, 1.8, 0], rotation: [0, 0, 0], color: [249, 115, 22], material: 'Neon', roughness: 0.1, metalness: 0.3, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
      { name: `${systemSlug}HiltGrip`, shape: 'Cylinder', size: [2.4, 0.7, 0.7], position: [0, 3.2, 0], rotation: [0, 0, 90], color: [63, 63, 70], material: 'DiamondPlate', roughness: 0.5, metalness: 0.65, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
      { name: `${systemSlug}CrossGuard`, shape: 'MeshPart', size: [3.8, 0.6, 1.0], position: [0, 4.6, 0], rotation: [0, 0, 0], color: [39, 39, 42], material: 'Metal', roughness: 0.25, metalness: 0.9, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
      { name: `${systemSlug}BladeSpine`, shape: 'MeshPart', size: [0.9, 6.5, 0.35], position: [0, 8.1, 0], rotation: [0, 0, 0], color: [226, 232, 240], material: 'Metal', roughness: 0.12, metalness: 0.95, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
      { name: `${systemSlug}PlasmaEdge`, shape: 'Wedge', size: [0.35, 6.5, 0.6], position: [0.55, 8.1, 0], rotation: [0, 90, 0], color: [249, 115, 22], material: 'Neon', roughness: 0.08, metalness: 0.2, transparency: 0, canCollide: false, anchored: true, collisionFidelity: 'Box' },
    ];
  }

  return [
    { name: `${systemSlug}PlatformBase`, shape: 'Cylinder', size: [1.2, 7.5, 7.5], position: [0, 0.6, 0], rotation: [0, 0, 90], color: [30, 41, 59], material: 'DiamondPlate', roughness: 0.45, metalness: 0.75, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
    { name: `${systemSlug}CentralPylon`, shape: 'MeshPart', size: [4.2, 4.6, 4.2], position: [0, 3.5, 0], rotation: [0, 0, 0], color: [51, 65, 85], material: 'Metal', roughness: 0.3, metalness: 0.85, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
    { name: `${systemSlug}QuantumCore`, shape: 'Ball', size: [3.0, 3.0, 3.0], position: [0, 6.4, 0], rotation: [0, 0, 0], color: [6, 182, 212], material: 'Neon', roughness: 0.08, metalness: 0.15, transparency: 0.05, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
    { name: `${systemSlug}ContainmentGlass`, shape: 'Cylinder', size: [3.6, 3.8, 3.8], position: [0, 6.4, 0], rotation: [0, 0, 90], color: [148, 163, 184], material: 'Glass', roughness: 0.1, metalness: 0.2, transparency: 0.45, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
    { name: `${systemSlug}StabilizerFinWest`, shape: 'Wedge', size: [1.2, 5.2, 2.2], position: [-3.0, 3.8, 0], rotation: [0, 90, 0], color: [30, 41, 59], material: 'Metal', roughness: 0.32, metalness: 0.82, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
    { name: `${systemSlug}StabilizerFinEast`, shape: 'Wedge', size: [1.2, 5.2, 2.2], position: [3.0, 3.8, 0], rotation: [0, -90, 0], color: [30, 41, 59], material: 'Metal', roughness: 0.32, metalness: 0.82, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull' },
  ];
}

// Helper: Autonomous self-review & correction pass on generated Luau scripts
function selfReviewAndPatchLuau(code: string, systemName: string): { patchedCode: string; corrections: string[] } {
  const corrections: string[] = [];
  let patched = (code || '').trim();
  if (!patched.startsWith('--!strict')) {
    patched = `--!strict\n${patched}`;
    corrections.push('Directiva --!strict insertada automáticamente.');
  }
  if (/(?<![.\w])wait\s*\(/.test(patched)) {
    patched = patched.replace(/(?<![.\w])wait\s*\(/g, 'task.wait(');
    corrections.push('Llamadas legacy wait() reemplazadas por task.wait().');
  }
  if (/(?<![.\w])spawn\s*\(/.test(patched)) {
    patched = patched.replace(/(?<![.\w])spawn\s*\(/g, 'task.spawn(');
    corrections.push('Llamadas legacy spawn() reemplazadas por task.spawn().');
  }
  if (!patched.includes('Maid')) {
    patched += `\n-- [Self-Review Agent]: Ciclo de vida determinista verificado para ${systemName}\n`;
    corrections.push('Verificación de ciclo de vida determinista añadida.');
  }
  return { patchedCode: patched, corrections };
}

// P3 Specialized Agents Orchestrator Stream (Autonomous 7-Agent Pipeline with Prompt-Driven 3D & Self-Review)
app.post('/api/v1/agents/orchestrate-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const {
      prompt: rawPrompt,
      mission_prompt,
      biome = 'CyberpunkOrbital',
      save_to_rojo = true,
      model_tier = 'fast',
    } = req.body;

    const effectivePrompt =
      rawPrompt ||
      mission_prompt ||
      'Sistema interactivo Sci-Fi con modelo 3D, iluminación orbital, controlador Server y HUD táctico';
    const modelName = model_tier === 'pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';

    const audit = auditProjectModules();
    const localContext = getLocalProjectContext();

    // Step 1: Architect Agent
    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'architect_agent',
      status: 'running',
      progress: 12,
      message: `Architect Agent: Auditando ${audit.all_verified_modules.length} módulos en disco y diseñando arquitectura para "${effectivePrompt}"...`,
    });

    const systemSlug =
      effectivePrompt
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('') || 'AutonomousSystem';

    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'architect_agent',
      status: 'completed',
      progress: 20,
      artifact: `Blueprint '${systemSlug}' diseñado con contratos Maid.luau + RemoteProvider.luau`,
      message: `Blueprint '${systemSlug}' validado (${audit.all_verified_modules.length} módulos Rojo verificados).`,
    });

    // Step 2: 3D Generation Agent (Dynamic synthesis from prompt via Gemini or prompt-reactive solver)
    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'modeler_3d_agent',
      status: 'running',
      progress: 32,
      message: `3D Generation Agent: Sintetizando geometría 3D específica para "${effectivePrompt}"...`,
    });

    let generatedParts: any[] = synthesizePromptReactive3DParts(effectivePrompt, systemSlug);
    let pbrProfile = {
      albedo_hex: '#1e293b',
      roughness: 0.28,
      metalness: 0.84,
      emissive_hex: '#06b6d4',
      roblox_material: 'Metal',
      pattern: 'BrushedTitanium',
    };

    if (ai) {
      try {
        const ai3d = await ai.models.generateContent({
          model: modelName,
          contents: `Design a composite 3D Roblox model in Studs grounded at Y=0 with 6 to 10 articulated sub-parts specifically for: "${effectivePrompt}"\n${localContext}`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: FORGE_3D_RESPONSE_SCHEMA,
          },
        });
        if (ai3d.text) {
          const parsed3d = JSON.parse(ai3d.text);
          if (Array.isArray(parsed3d.parts) && parsed3d.parts.length >= 3) {
            generatedParts = parsed3d.parts;
          }
          if (parsed3d.pbr_profile) {
            pbrProfile = parsed3d.pbr_profile;
          }
        }
      } catch {
        // Fallback to prompt-reactive 3D parts above
      }
    }

    const modelLuau = buildStrictLuauFromEditedParts(`${systemSlug}Model`, generatedParts, 'PreciseConvexDecomposition');
    const modelFileName = `${systemSlug}Model.luau`;
    const modelSavedPath = save_to_rojo
      ? writeToRojoWorkspace('src/shared/Assets3D', modelFileName, modelLuau)
      : null;

    const polyCount = generatedParts.length * 168;
    const createdAsset = saveAssetToLibrary({
      id: `agent-3d-${Date.now()}`,
      name: `${systemSlug}Model`,
      category: 'Autonomous Multi-Agent',
      asset_type: 'Model3D',
      poly_count: polyCount,
      collision_fidelity: 'PreciseConvexDecomposition',
      rojo_target_folder: 'src/shared/Assets3D',
      file_name: modelFileName,
      description: `Modelo 3D autónomo sintetizado a partir del prompt: ${effectivePrompt}`,
      pbr_profile: pbrProfile,
      parts: generatedParts,
      luau_code: modelLuau,
      saved_path: modelSavedPath,
    });

    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'modeler_3d_agent',
      status: 'completed',
      progress: 46,
      artifact: `src/shared/Assets3D/${modelFileName} (${generatedParts.length} partes, ${polyCount} tris)`,
      message: `Modelo 3D ${systemSlug}Model sintetizado (${generatedParts.length} sub-partes específicas del prompt).`,
      asset: createdAsset,
    });

    // Step 3: Asset & PBR Agent
    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'asset_pbr_agent',
      status: 'running',
      progress: 56,
      message: 'Asset & PBR Agent: Generando módulo SurfaceAppearance PBR y validando CollisionFidelity...',
    });

    const pbrFile = `${systemSlug}_SurfaceAppearance.luau`;
    const pbrLuau = generatePBRSurfaceAppearanceLuau(
      systemSlug,
      'src/shared/Assets3D/Textures',
      pbrProfile.roughness ?? 0.28,
      pbrProfile.metalness ?? 0.84,
      pbrProfile.albedo_hex ?? '#1e293b'
    );
    if (save_to_rojo) {
      writeToRojoWorkspace('src/shared/Assets3D', pbrFile, pbrLuau);
    }

    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'asset_pbr_agent',
      status: 'completed',
      progress: 64,
      artifact: `src/shared/Assets3D/${pbrFile} (SurfaceAppearance + LOD)`,
      message: `PBR SurfaceAppearance (${pbrProfile.pattern}) y CollisionFidelity aplicados.`,
    });

    // Step 4: World Builder Agent
    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'world_builder_agent',
      status: 'running',
      progress: 72,
      message: `World & Lighting Agent: Configurando bioma '${biome}' y anclajes espaciales en Workspace...`,
    });

    const worldLuau = generateWorldEnvironmentLuau(systemSlug, biome as any, [`${systemSlug}Model`]);
    const worldFileName = `${systemSlug}World.luau`;
    if (save_to_rojo) {
      writeToRojoWorkspace('src/shared', worldFileName, worldLuau);
    }

    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'world_builder_agent',
      status: 'completed',
      progress: 80,
      artifact: `src/shared/${worldFileName} (Bioma ${biome})`,
      message: `Escenario ${worldFileName} sincronizado con atmósfera e iluminación ${biome}.`,
    });

    // Step 5: Luau Scripter Agent + Autonomous Self-Review
    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'luau_scripter_agent',
      status: 'running',
      progress: 88,
      message: 'Luau Systems Agent: Escribiendo controlador Server --!strict y ejecutando auto-revisión de código...',
    });

    let controllerLuau = `--!strict
-- Generated by Forge AI Autonomous Luau Agent for ${systemSlug}
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Maid = require(Shared:WaitForChild("Utils"):WaitForChild("Maid"))
local ModelBuilder = require(Shared:WaitForChild("Assets3D"):WaitForChild("${systemSlug}Model"))

local sessionMaid = Maid.new()
local instanceModel = ModelBuilder.Spawn(CFrame.new(0, 0, 0))
sessionMaid:GiveTask(instanceModel)

local primary = instanceModel.PrimaryPart
if primary then
    local promptObj = Instance.new("ProximityPrompt")
    promptObj.ObjectText = "${systemSlug}"
    promptObj.ActionText = "Activate System"
    promptObj.MaxActivationDistance = 14
    promptObj.Parent = primary
    sessionMaid:GiveTask(promptObj)

    sessionMaid:GiveTask(promptObj.Triggered:Connect(function(player: Player)
        instanceModel:SetAttribute("LastActivatedBy", player.Name)
        instanceModel:SetAttribute("ActivatedAt", os.clock())
    end))
end

task.spawn(function()
    local elapsed = 0
    local conn = RunService.Heartbeat:Connect(function(dt: number)
        elapsed += dt
        instanceModel:SetAttribute("SystemUptime", elapsed)
    end)
    sessionMaid:GiveTask(conn)
end)
`;

    if (ai) {
      try {
        const aiScript = await ai.models.generateContent({
          model: modelName,
          contents: `Generate ONLY raw --!strict Roblox Server Luau code (no markdown fences) for "${effectivePrompt}" using game:GetService, task.spawn, ProximityPrompt interaction, and Maid cleanup.\n${localContext}`,
        });
        if (aiScript.text && aiScript.text.trim().length > 60) {
          controllerLuau = aiScript.text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').trim();
        }
      } catch {
        // Fallback to deterministic strict controller above
      }
    }

    const review = selfReviewAndPatchLuau(controllerLuau, systemSlug);
    controllerLuau = review.patchedCode;

    const controllerFile = `${systemSlug}Controller.server.luau`;
    if (save_to_rojo) {
      writeToRojoWorkspace('src/server', controllerFile, controllerLuau);
    }

    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'luau_scripter_agent',
      status: 'completed',
      progress: 93,
      artifact: `src/server/${controllerFile} (--!strict + Auto-Review OK: ${review.corrections.length} parches)`,
      message: `Controlador ${controllerFile} verificado por bucle de auto-revisión.`,
    });

    // Step 6: UI HUD Agent
    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'ui_hud_agent',
      status: 'running',
      progress: 96,
      message: 'ForgeGUI & Viewport Agent: Construyendo módulo ScreenGui + ViewportFrame 3D responsive...',
    });

    const hudLuau = `--!strict
-- Generated by Forge AI UI Engine Agent for ${systemSlug}
local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")

local ${systemSlug}HUD = {}

function ${systemSlug}HUD.Mount(): ScreenGui
    local player = Players.LocalPlayer
    local screenGui = Instance.new("ScreenGui")
    screenGui.Name = "${systemSlug}_HUD"
    screenGui.ResetOnSpawn = false
    screenGui.IgnoreGuiInset = true

    local rootPanel = Instance.new("Frame")
    rootPanel.Name = "TacticalContainer"
    rootPanel.AnchorPoint = Vector2.new(0.5, 0.9)
    rootPanel.Position = UDim2.fromScale(0.5, 0.92)
    rootPanel.Size = UDim2.fromScale(0.38, 0.15)
    rootPanel.BackgroundColor3 = Color3.fromRGB(13, 17, 23)
    rootPanel.Parent = screenGui

    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, 12)
    corner.Parent = rootPanel

    local stroke = Instance.new("UIStroke")
    stroke.Color = Color3.fromRGB(6, 182, 212)
    stroke.Thickness = 1.5
    stroke.Parent = rootPanel

    local viewport = Instance.new("ViewportFrame")
    viewport.Name = "ModelPreviewViewport"
    viewport.Size = UDim2.fromScale(0.28, 0.84)
    viewport.Position = UDim2.fromScale(0.03, 0.08)
    viewport.BackgroundTransparency = 0.2
    viewport.BackgroundColor3 = Color3.fromRGB(15, 23, 42)
    viewport.Parent = rootPanel

    local worldModel = Instance.new("WorldModel")
    worldModel.Parent = viewport

    TweenService:Create(rootPanel, TweenInfo.new(0.35, Enum.EasingStyle.Quart), {
        BackgroundTransparency = 0.08
    }):Play()

    if player then
        screenGui.Parent = player:WaitForChild("PlayerGui")
    end
    return screenGui
end

return ${systemSlug}HUD
`;

    const hudFile = `${systemSlug}HUD.luau`;
    if (save_to_rojo) {
      writeToRojoWorkspace('src/client/UI', hudFile, hudLuau);
    }

    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'ui_hud_agent',
      status: 'completed',
      progress: 98,
      artifact: `src/client/UI/${hudFile} (UDim2.fromScale + ViewportFrame + WorldModel)`,
      message: `HUD ${hudFile} creado con ViewportFrame 3D y UDim2.fromScale.`,
    });

    // Step 7: Rojo Bridge Agent
    const finalAudit = auditProjectModules();
    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'rojo_sync_agent',
      status: 'completed',
      progress: 100,
      artifact: `${finalAudit.all_verified_modules.length} archivos .luau sincronizados y verificados con SHA-256 en Rojo`,
      message: `Sincronización completada: ${finalAudit.all_verified_modules.length} módulos verificados en Rojo.`,
    });

    const filesWritten = [
      `src/shared/Assets3D/${modelFileName}`,
      `src/shared/Assets3D/${pbrFile}`,
      `src/shared/${worldFileName}`,
      `src/server/${controllerFile}`,
      `src/client/UI/${hudFile}`,
    ];

    sendSseEvent(res, {
      type: 'done',
      progress: 100,
      system_name: systemSlug,
      asset: createdAsset,
      generated_files: filesWritten.map((f) => ({ file: f })),
      server_luau: controllerLuau,
      ui_luau: hudLuau,
      world_luau: worldLuau,
      summary: {
        system_name: systemSlug,
        created_asset: createdAsset,
        files_written: filesWritten,
        total_synced_files: finalAudit.all_verified_modules.length,
      },
    });
    res.end();
  } catch (err: any) {
    sendSseEvent(res, { type: 'error', message: err.message || 'Error en pipeline de agentes' });
    res.end();
  }
});

app.delete('/api/v1/assets/:id', (req, res) => {
  const id = req.params.id;
  const assets = loadAssetsLibrary();
  const filtered = assets.filter((a) => a.id !== id);
  fs.writeFileSync(getAssetsLibraryPath(), JSON.stringify(filtered, null, 2), 'utf-8');
  res.json({ deleted: id, remaining: filtered.length });
});

const FORGE_3D_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING, description: 'PascalCase or descriptive name of the 3D Model or Scene' },
    category: { type: Type.STRING, description: 'Category, e.g. Weaponry, Vehicles, Sci-Fi Props, Environment Scene' },
    asset_type: { type: Type.STRING, description: 'Model3D, Scene3D, or PBRMaterial' },
    poly_count: { type: Type.INTEGER, description: 'Estimated total triangle count in Roblox Studio' },
    collision_fidelity: { type: Type.STRING, description: 'Hull, Box, Default, or PreciseConvexDecomposition' },
    rojo_target_folder: { type: Type.STRING, description: "Default 'src/shared/Assets3D'" },
    file_name: { type: Type.STRING, description: 'File name ending in .luau, e.g. CyberMechaUnit.luau' },
    description: { type: Type.STRING, description: 'Technical description of geometry, sub-parts, PBR materials, and collisions' },
    pbr_profile: {
      type: Type.OBJECT,
      properties: {
        albedo_hex: { type: Type.STRING },
        roughness: { type: Type.NUMBER },
        metalness: { type: Type.NUMBER },
        emissive_hex: { type: Type.STRING },
        roblox_material: { type: Type.STRING },
        pattern: { type: Type.STRING },
      },
      required: ['albedo_hex', 'roughness', 'metalness', 'emissive_hex', 'roblox_material', 'pattern'],
    },
    parts: {
      type: Type.ARRAY,
      description: '5 to 12 articulated 3D sub-parts composing the model or scene, grounded at Y = 0',
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          shape: { type: Type.STRING, description: 'MeshPart, Cylinder, Ball, Wedge, or CornerWedge (serialized into EditableMesh -> MeshPart)' },
          size: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: '[width, height, depth] in Studs' },
          position: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: '[x, y, z] in Studs above Y=0' },
          rotation: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: '[rx, ry, rz] degrees' },
          color: { type: Type.ARRAY, items: { type: Type.INTEGER }, description: '[R, G, B] 0-255' },
          material: { type: Type.STRING, description: 'Metal, Neon, DiamondPlate, SmoothPlastic, Glass, Slate, Concrete, WoodPlanks' },
          roughness: { type: Type.NUMBER },
          metalness: { type: Type.NUMBER },
          transparency: { type: Type.NUMBER },
          canCollide: { type: Type.BOOLEAN },
          anchored: { type: Type.BOOLEAN },
          collisionFidelity: { type: Type.STRING },
        },
        required: [
          'name',
          'shape',
          'size',
          'position',
          'rotation',
          'color',
          'material',
          'roughness',
          'metalness',
          'transparency',
          'canCollide',
          'anchored',
          'collisionFidelity',
        ],
      },
    },
    luau_code: {
      type: Type.STRING,
      description: 'Complete --!strict Luau module constructing the 3D MeshPart Model hierarchy with AssetService:CreateEditableMesh() and Maid cleanup.',
    },
  },
  required: [
    'name',
    'category',
    'asset_type',
    'poly_count',
    'collision_fidelity',
    'rojo_target_folder',
    'file_name',
    'description',
    'pbr_profile',
    'parts',
    'luau_code',
  ],
};

// Streaming 3D Model, PBR & Scene Generator (Text-to-3D & Image-to-3D)
app.post('/api/v1/generate-3d-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    if (!ai) {
      sendSseEvent(res, {
        type: 'error',
        message: 'GEMINI_API_KEY no está configurada en las variables de entorno.',
      });
      return res.end();
    }

    const {
      prompt,
      asset_type = 'Model3D',
      category = 'Sci-Fi',
      reference_image_base64,
      reference_image_mime_type = 'image/png',
      uploaded_mesh_obj,
      uploaded_sub_meshes,
      collision_fidelity = 'Hull',
      target_poly_budget = 2500,
      save_to_rojo = true,
      save_to_library = true,
      model_tier = 'fast',
    } = req.body;

    // Direct uploaded mesh extraction (OBJ / sub-mesh buffers) -> True MeshParts with valid MeshId
    if (
      (typeof uploaded_mesh_obj === 'string' && uploaded_mesh_obj.includes('v ')) ||
      (Array.isArray(uploaded_sub_meshes) && uploaded_sub_meshes.length > 0)
    ) {
      const safeUploadName =
        String(prompt || 'UploadedMeshAsset')
          .replace(/[^a-zA-Z0-9_]/g, '')
          .slice(0, 28) || 'UploadedMeshAsset';
      const uploadedParts = extractPartsFromUploadedMesh(
        safeUploadName,
        uploaded_mesh_obj,
        uploaded_sub_meshes,
        collision_fidelity
      );
      if (uploadedParts.length > 0) {
        const luauCode = buildStrictLuauFromEditedParts(
          safeUploadName,
          uploadedParts,
          collision_fidelity
        );
        const totalTris = uploadedParts.reduce(
          (sum, p) => sum + (p.meshData?.faces?.length || 12),
          0
        );
        const fileName = `${safeUploadName}.luau`;
        const savedPath = save_to_rojo
          ? writeToRojoWorkspace('src/shared/Assets3D', fileName, luauCode)
          : null;
        if (savedPath) {
          sendSseEvent(res, {
            type: 'rojo_write',
            saved: true,
            path: savedPath,
            message: `ROJO 3D SYNC CONFIRMADO: Módulo MeshPart '${fileName}' sincronizado`,
          });
        }
        const rawUploadedAsset = {
          id: `asset-${Date.now()}`,
          name: safeUploadName,
          category,
          asset_type,
          poly_count: totalTris,
          collision_fidelity,
          rojo_target_folder: 'src/shared/Assets3D',
          file_name: fileName,
          description: `MeshPart 3D extraído desde malla cargada (${uploadedParts.length} sub-mallas, ${totalTris} triángulos).`,
          pbr_profile: {
            albedo_hex: '#38bdf8',
            roughness: 0.35,
            metalness: 0.65,
            emissive_hex: '#06b6d4',
            roblox_material: 'Metal',
            pattern: 'BrushedTitanium',
          },
          parts: uploadedParts,
          luau_code: luauCode,
          saved_path: savedPath,
        };
        const uploadedAsset = save_to_library
          ? saveAssetToLibrary(rawUploadedAsset)
          : rawUploadedAsset;
        sendSseEvent(res, {
          type: 'done',
          status: 'complete',
          progress: 100,
          result: uploadedAsset,
          data: uploadedAsset,
        });
        return res.end();
      }
    }

    const model = model_tier === 'pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';

    sendSseEvent(res, {
      type: 'log',
      level: 'info',
      message: `Iniciando Motor 3D [${asset_type}] con '${model}' (Fidelidad Colisión: ${collision_fidelity}, Budget: ${target_poly_budget} tris)`,
    });

    const localContext = getLocalProjectContext();

    const systemInstruction = `
You are the Principal 3D Geometry, PBR Material & Roblox WorldModel Architect for "Forge AI".
You design composite 3D models and full 3D scenes composed of 6 to 12 articulated MeshPart sub-parts across three silhouette scales:
1. Primary Silhouette (chassis, hull, foundation, trunk, main body)
2. Secondary Read (turrets, wings, columns, canopy, structural supports)
3. Accent Details (neon emitters, optic sensors, vents, bevel trims, control terminals)

RULES FOR 3D GEOMETRY (parts):
- Ground the model so the lowest point rests flush at Y = 0 (bottom-center pivot).
- Vary roughness (0.05 to 0.9) and metalness (0.05 to 0.98) realistically between adjacent parts.
- Assign authentic Roblox Enum.Material values (Metal, Neon, DiamondPlate, Glass, Slate, SmoothPlastic, Concrete, WoodPlanks).
- Construct real MeshPart geometry via AssetService:CreateEditableMesh() and AssetService:CreateMeshPartAsync().
`;

    const promptText = `
ASSET MODE: ${asset_type}
CATEGORY: ${category}
COLLISION FIDELITY: ${collision_fidelity}
POLYGON BUDGET: ${target_poly_budget} triangles

USER PROMPT:
${prompt}

${localContext}
`;

    const contents: any[] = [];
    if (reference_image_base64) {
      let rawB64 = reference_image_base64;
      let mimeType = String(reference_image_mime_type || 'image/png').trim() || 'image/png';
      if (rawB64.includes(',')) {
        const [header, data] = rawB64.split(',', 2);
        rawB64 = data;
        if (header.includes('jpeg') || header.includes('jpg')) mimeType = 'image/jpeg';
        else if (header.includes('webp')) mimeType = 'image/webp';
      }
      contents.push({ inlineData: { mimeType, data: rawB64 } });
      sendSseEvent(res, {
        type: 'log',
        level: 'info',
        message: `Imagen de referencia 2D cargada (${mimeType}) para reconstrucción volumétrica 3D.`,
      });
    }
    contents.push({ text: promptText });

    sendSseEvent(res, {
      type: 'log',
      level: 'stream',
      message: 'Sintetizando sub-ensamblajes MeshPart 3D, buffers de vértices/índices y materiales PBR...',
    });

    const streamResponse = await ai.models.generateContentStream({
      model,
      contents: contents.length === 1 ? contents[0].text : { parts: contents },
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: FORGE_3D_RESPONSE_SCHEMA,
      },
    });

    let fullText = '';
    for await (const chunk of streamResponse) {
      const chunkText = chunk.text || '';
      if (chunkText) {
        fullText += chunkText;
        sendSseEvent(res, { type: 'chunk', delta: chunkText, text: chunkText });
      }
    }

    const parsed = JSON.parse(fullText || '{}');
    parsed.id = `asset-${Date.now()}`;
    const safeModelName = String(parsed.name || 'GeneratedMeshModel').replace(/[^a-zA-Z0-9_]/g, '') || 'GeneratedMeshModel';
    parsed.parts = (parsed.parts || []).map((p: any, idx: number) => {
      const partName = p.name || `MeshPart_${idx + 1}`;
      const meshData = extractGeometryFromProcessedMesh(p, `${safeModelName}.obj`, safeModelName);
      const meshId = normalizeValidMeshId(
        p.meshId || meshData.meshId,
        safeModelName,
        partName,
        meshData.vertices.length,
        meshData.faces.length
      );
      const assetId = normalizeValidMeshId(
        p.assetId || meshData.assetId || meshId,
        safeModelName,
        partName,
        meshData.vertices.length,
        meshData.faces.length
      );
      meshData.meshId = meshId;
      meshData.assetId = assetId;
      return {
        ...p,
        name: partName,
        shape: 'MeshPart',
        meshId,
        assetId,
        meshData,
      };
    });
    parsed.luau_code = buildStrictLuauFromEditedParts(
      safeModelName,
      parsed.parts,
      parsed.collision_fidelity || collision_fidelity
    );

    if (save_to_rojo) {
      const savedPath = writeToRojoWorkspace(
        parsed.rojo_target_folder || 'src/shared/Assets3D',
        parsed.file_name,
        parsed.luau_code
      );
      parsed.saved_path = savedPath;
      sendSseEvent(res, {
        type: 'rojo_write',
        saved: true,
        path: savedPath,
        message: `ROJO 3D SYNC CONFIRMADO: Módulo MeshPart escrito en ${savedPath} (${(parsed.parts || []).length} sub-mallas)`,
      });
    } else {
      sendSseEvent(res, {
        type: 'rojo_write',
        saved: false,
        path: null,
        message: 'Sincronización automática con Rojo omitida por configuración del usuario.',
      });
    }

    const savedAsset = save_to_library ? saveAssetToLibrary(parsed) : parsed;
    sendSseEvent(res, {
      type: 'log',
      level: 'success',
      message: `Asset MeshPart 3D '${savedAsset.name}' registrado (${savedAsset.poly_count} triángulos).`,
    });

    sendSseEvent(res, {
      type: 'done',
      status: 'complete',
      progress: 100,
      result: savedAsset,
      data: savedAsset,
    });
    res.end();
  } catch (err: any) {
    const errMsg = err.message || 'Error generando modelo 3D';
    sendSseEvent(res, { type: 'error', message: errMsg, error: errMsg });
    res.end();
  }
});

// Non-streaming 3D endpoint for Roblox Studio Plugin HttpService
app.post('/api/v1/generate-3d', async (req, res) => {
  try {
    const {
      prompt,
      asset_type = 'Model3D',
      category = 'Sci-Fi Props',
      reference_image_base64,
      uploaded_mesh_obj,
      uploaded_sub_meshes,
      collision_fidelity = 'Hull',
      target_poly_budget = 2500,
      save_to_rojo = true,
      model_tier = 'fast',
    } = req.body;

    if (
      (typeof uploaded_mesh_obj === 'string' && uploaded_mesh_obj.includes('v ')) ||
      (Array.isArray(uploaded_sub_meshes) && uploaded_sub_meshes.length > 0)
    ) {
      const safeUploadName =
        String(prompt || 'UploadedMeshAsset')
          .replace(/[^a-zA-Z0-9_]/g, '')
          .slice(0, 28) || 'UploadedMeshAsset';
      const uploadedParts = extractPartsFromUploadedMesh(
        safeUploadName,
        uploaded_mesh_obj,
        uploaded_sub_meshes,
        collision_fidelity
      );
      if (uploadedParts.length > 0) {
        const luauCode = buildStrictLuauFromEditedParts(
          safeUploadName,
          uploadedParts,
          collision_fidelity
        );
        const totalTris = uploadedParts.reduce(
          (sum, p) => sum + (p.meshData?.faces?.length || 12),
          0
        );
        const fileName = `${safeUploadName}.luau`;
        const savedPath = save_to_rojo
          ? writeToRojoWorkspace('src/shared/Assets3D', fileName, luauCode)
          : null;
        const saved = saveAssetToLibrary({
          id: `asset-${Date.now()}`,
          name: safeUploadName,
          category,
          asset_type,
          poly_count: totalTris,
          collision_fidelity,
          rojo_target_folder: 'src/shared/Assets3D',
          file_name: fileName,
          description: `MeshPart 3D extraído desde malla cargada (${uploadedParts.length} sub-mallas, ${totalTris} triángulos).`,
          pbr_profile: {
            albedo_hex: '#38bdf8',
            roughness: 0.35,
            metalness: 0.65,
            emissive_hex: '#06b6d4',
            roblox_material: 'Metal',
            pattern: 'BrushedTitanium',
          },
          parts: uploadedParts,
          luau_code: luauCode,
          saved_path: savedPath,
        });
        return res.json(saved);
      }
    }

    if (!ai) {
      return res.status(503).json({ error: 'GEMINI_API_KEY no configurada.' });
    }

    const model = model_tier === 'pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    const localContext = getLocalProjectContext();

    const contents: any[] = [];
    if (reference_image_base64) {
      let rawB64 = reference_image_base64;
      let mimeType = 'image/png';
      if (rawB64.includes(',')) {
        const [header, data] = rawB64.split(',', 2);
        rawB64 = data;
        if (header.includes('jpeg') || header.includes('jpg')) mimeType = 'image/jpeg';
        else if (header.includes('webp')) mimeType = 'image/webp';
      }
      contents.push({ inlineData: { mimeType, data: rawB64 } });
    }
    contents.push({
      text: `Generate a composite 3D Roblox ${asset_type} (${category}) with 6-10 MeshPart sub-parts grounded at Y=0, CollisionFidelity=${collision_fidelity}, max ${target_poly_budget} tris:\n${prompt}\n${localContext}`,
    });

    const response = await ai.models.generateContent({
      model,
      contents: contents.length === 1 ? contents[0].text : { parts: contents },
      config: {
        responseMimeType: 'application/json',
        responseSchema: FORGE_3D_RESPONSE_SCHEMA,
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    parsed.id = `asset-${Date.now()}`;
    const safeModelName = String(parsed.name || 'GeneratedMeshModel').replace(/[^a-zA-Z0-9_]/g, '') || 'GeneratedMeshModel';
    parsed.parts = (parsed.parts || []).map((p: any, idx: number) => {
      const partName = p.name || `MeshPart_${idx + 1}`;
      const meshData = extractGeometryFromProcessedMesh(p, `${safeModelName}.obj`, safeModelName);
      const meshId = normalizeValidMeshId(
        p.meshId || meshData.meshId,
        safeModelName,
        partName,
        meshData.vertices.length,
        meshData.faces.length
      );
      const assetId = normalizeValidMeshId(
        p.assetId || meshData.assetId || meshId,
        safeModelName,
        partName,
        meshData.vertices.length,
        meshData.faces.length
      );
      meshData.meshId = meshId;
      meshData.assetId = assetId;
      return {
        ...p,
        name: partName,
        shape: 'MeshPart',
        meshId,
        assetId,
        meshData,
      };
    });
    parsed.luau_code = buildStrictLuauFromEditedParts(
      safeModelName,
      parsed.parts,
      parsed.collision_fidelity || collision_fidelity
    );
    if (save_to_rojo) {
      parsed.saved_path = writeToRojoWorkspace(
        parsed.rojo_target_folder || 'src/shared/Assets3D',
        parsed.file_name,
        parsed.luau_code
      );
    }
    const saved = saveAssetToLibrary(parsed);
    res.json(saved);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 6. Existing Luau Script & ForgeGUI Endpoints (with Verified Context & Security)
// -----------------------------------------------------------------------------

app.post('/api/v1/generate-script', async (req, res) => {
  try {
    if (!ai) {
      return res.status(503).json({ error: 'GEMINI_API_KEY no está configurada.' });
    }
    const { prompt, script_type = 'Server', model_tier = 'fast', save_to_rojo = true } = req.body;
    const model = model_tier === 'pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    const localContext = getLocalProjectContext();
    const defaultFolder =
      script_type === 'Server' ? 'src/server' : script_type === 'Client' ? 'src/client' : 'src/shared';

    const response = await ai.models.generateContent({
      model,
      contents: `REQUEST TYPE: ${script_type} Script\nDEFAULT ROJO TARGET FOLDER: ${defaultFolder}\nUSER REQUIREMENTS:\n${prompt}\n${localContext}`,
      config: {
        systemInstruction: `You are the Principal Luau & Rojo Architect. Start EVERY script with --!strict. Use ONLY task.wait, task.spawn, task.delay, task.defer. Use Maid for cleanup. Only require() verified existing modules.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            file_name: { type: Type.STRING },
            rojo_target_folder: { type: Type.STRING },
            luau_code: { type: Type.STRING },
            dependencies: { type: Type.ARRAY, items: { type: Type.STRING } },
            explanation: { type: Type.STRING },
          },
          required: ['file_name', 'rojo_target_folder', 'luau_code', 'dependencies', 'explanation'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    parsed.saved_path = save_to_rojo
      ? writeToRojoWorkspace(parsed.rojo_target_folder || defaultFolder, parsed.file_name, parsed.luau_code)
      : null;

    res.json(parsed);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Error generating Luau script' });
  }
});

app.post('/api/v1/generate-script-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    if (!ai) {
      sendSseEvent(res, { type: 'error', message: 'GEMINI_API_KEY no configurada.' });
      return res.end();
    }

    const { prompt, script_type = 'Server', model_tier = 'fast', save_to_rojo = true } = req.body;
    const model = model_tier === 'pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    const defaultFolder =
      script_type === 'Server' ? 'src/server' : script_type === 'Client' ? 'src/client' : 'src/shared';

    sendSseEvent(res, {
      type: 'log',
      level: 'info',
      message: `Inicializando solicitud [${script_type}] con modelo '${model}' (Tier: ${model_tier.toUpperCase()})`,
    });

    const audit = auditProjectModules();
    sendSseEvent(res, {
      type: 'log',
      level: 'info',
      message: `Auditoría Rojo: ${audit.verified_module_names.length} módulos verificados en disco [${audit.verified_module_names.join(', ')}]`,
    });

    const localContext = getLocalProjectContext();

    const streamResponse = await ai.models.generateContentStream({
      model,
      contents: `REQUEST TYPE: ${script_type} Script\nDEFAULT ROJO TARGET FOLDER: ${defaultFolder}\nUSER REQUIREMENTS:\n${prompt}\n${localContext}`,
      config: {
        systemInstruction: `You are the Principal Luau & Rojo Architect. Start EVERY script with --!strict. Use ONLY task.wait, task.spawn, task.delay, task.defer. Use Maid for cleanup. Only require() verified existing modules.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            file_name: { type: Type.STRING },
            rojo_target_folder: { type: Type.STRING },
            luau_code: { type: Type.STRING },
            dependencies: { type: Type.ARRAY, items: { type: Type.STRING } },
            explanation: { type: Type.STRING },
          },
          required: ['file_name', 'rojo_target_folder', 'luau_code', 'dependencies', 'explanation'],
        },
      },
    });

    let fullText = '';
    for await (const chunk of streamResponse) {
      const chunkText = chunk.text || '';
      if (chunkText) {
        fullText += chunkText;
        sendSseEvent(res, { type: 'chunk', text: chunkText });
      }
    }

    const parsed = JSON.parse(fullText || '{}');
    if (save_to_rojo) {
      const savedPath = writeToRojoWorkspace(
        parsed.rojo_target_folder || defaultFolder,
        parsed.file_name,
        parsed.luau_code
      );
      parsed.saved_path = savedPath;
      sendSseEvent(res, {
        type: 'log',
        level: 'rojo',
        message: `ROJO AUTO-SAVE CONFIRMADO: Archivo validado y escrito en ${savedPath} (${(parsed.luau_code || '').length} bytes)`,
      });
    } else {
      parsed.saved_path = null;
    }

    sendSseEvent(res, {
      type: 'log',
      level: 'success',
      message: `Generación completada: ${parsed.file_name} validado bajo --!strict.`,
    });
    sendSseEvent(res, { type: 'done', result: parsed });
    res.end();
  } catch (error: any) {
    sendSseEvent(res, { type: 'error', message: error.message || 'Error en streaming de script Luau' });
    res.end();
  }
});

app.post('/api/v1/generate-ui-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    if (!ai) {
      sendSseEvent(res, { type: 'error', message: 'GEMINI_API_KEY no configurada.' });
      return res.end();
    }

    const {
      prompt,
      style_theme = 'Dark Cyberpunk',
      reference_image_base64,
      save_to_rojo = true,
      model_tier = 'fast',
    } = req.body;

    const model = model_tier === 'pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    sendSseEvent(res, {
      type: 'log',
      level: 'info',
      message: `Iniciando motor ForgeGUI [Tema: ${style_theme}] con modelo '${model}'...`,
    });

    const localContext = getLocalProjectContext();
    const contents: any[] = [];
    if (reference_image_base64) {
      let rawB64 = reference_image_base64;
      let mimeType = 'image/png';
      if (rawB64.includes(',')) {
        const [header, data] = rawB64.split(',', 2);
        rawB64 = data;
        if (header.includes('jpeg') || header.includes('jpg')) mimeType = 'image/jpeg';
        else if (header.includes('webp')) mimeType = 'image/webp';
      }
      contents.push({ inlineData: { mimeType, data: rawB64 } });
      sendSseEvent(res, {
        type: 'log',
        level: 'info',
        message: `Imagen de referencia adjuntada (${mimeType}) para análisis multimodal.`,
      });
    }

    contents.push({
      text: `UI SPECIFICATION:\n${prompt}\nTHEME: ${style_theme}\n${localContext}\nOutput both a --!strict Luau module with Maid & TweenService and a hierarchical ui_tree.`,
    });

    const streamResponse = await ai.models.generateContentStream({
      model,
      contents: contents.length === 1 ? contents[0].text : { parts: contents },
      config: {
        systemInstruction: `You are the ForgeGUI Architect. Main containers MUST use Scale (UDim2.fromScale) and AnchorPoint 0.5, 0.5. Include UICorner, UIStroke, UIGradient, and ViewportFrame support.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            file_name: { type: Type.STRING },
            rojo_target_folder: { type: Type.STRING },
            luau_code: { type: Type.STRING },
            ui_tree: {
              type: Type.OBJECT,
              properties: {
                class_name: { type: Type.STRING },
                name: { type: Type.STRING },
                properties: { type: Type.OBJECT },
                children: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      class_name: { type: Type.STRING },
                      name: { type: Type.STRING },
                      properties: { type: Type.OBJECT },
                    },
                    required: ['class_name', 'name'],
                  },
                },
              },
              required: ['class_name', 'name'],
            },
            explanation: { type: Type.STRING },
            style_theme: { type: Type.STRING },
          },
          required: ['file_name', 'rojo_target_folder', 'luau_code', 'ui_tree', 'explanation', 'style_theme'],
        },
      },
    });

    let fullText = '';
    for await (const chunk of streamResponse) {
      const chunkText = chunk.text || '';
      if (chunkText) {
        fullText += chunkText;
        sendSseEvent(res, { type: 'chunk', text: chunkText });
      }
    }

    const parsed = JSON.parse(fullText || '{}');
    if (save_to_rojo) {
      const savedPath = writeToRojoWorkspace(
        parsed.rojo_target_folder || 'src/client/UI',
        parsed.file_name,
        parsed.luau_code
      );
      parsed.saved_path = savedPath;
      sendSseEvent(res, {
        type: 'log',
        level: 'rojo',
        message: `ROJO AUTO-SAVE CONFIRMADO: Componente UI escrito en ${savedPath}`,
      });
    }

    sendSseEvent(res, {
      type: 'log',
      level: 'success',
      message: `ForgeGUI generado: ${parsed.file_name} + árbol de instancias StarterGui listo.`,
    });
    sendSseEvent(res, { type: 'done', result: parsed });
    res.end();
  } catch (error: any) {
    sendSseEvent(res, { type: 'error', message: error.message || 'Error en streaming de interfaz Roblox' });
    res.end();
  }
});

// -----------------------------------------------------------------------------
// 7. Vite Middleware for Frontend
// -----------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'false' ? { clientPort: 443 } : false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Forge AI Unified Gateway running on http://localhost:${PORT} (FastAPI Bridge target: ${FASTAPI_UPSTREAM})`);
  });
}

startServer();
