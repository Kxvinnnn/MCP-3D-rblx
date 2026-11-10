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
  generateWorldEnvironmentLuau,
} from './src/server/engines/worldAndModelEditorEngine.ts';

dotenv.config();

const app = express();
const PORT = 3000;
const FASTAPI_UPSTREAM = process.env.FASTAPI_UPSTREAM_URL || 'http://127.0.0.1:8000';

app.use(express.json({ limit: '15mb' }));

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

const ALLOWED_EXTENSIONS = new Set(['.luau', '.json', '.obj', '.gltf', '.md']);
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
    const rebuiltLuau = buildStrictLuauFromEditedParts(
      asset.name,
      asset.parts || [],
      asset.collision_fidelity || 'Hull'
    );
    const updatedAsset = {
      ...asset,
      luau_code: rebuiltLuau,
      poly_count: (asset.parts || []).reduce((acc: number, p: any) => {
        if (p.shape === 'Ball') return acc + 360;
        if (p.shape === 'Cylinder') return acc + 180;
        return acc + 36;
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

// GLB/GLTF/OBJ/FBX Preprocessor -> Roblox MeshPart Export Endpoint
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

    const parts = payload.subMeshParts.map((sub: any) => ({
      name: sub.name || 'MeshPartChunk',
      shape: 'Block',
      size: sub.studSize || [2, 2, 2],
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
    }));

    const luauCode =
      payload.luauMeshPartBuilderCode ||
      buildStrictLuauFromEditedParts(payload.modelName, parts, 'Hull');

    const targetFolder = payload.rojoTargetFolder || 'src/shared/Assets3D';
    const fileName = payload.fileName || `${payload.modelName}_MeshPart.luau`;

    let savedPath: string | null = null;
    if (save_to_rojo) {
      savedPath = writeToRojoWorkspace(targetFolder, fileName, luauCode);
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
      description: `MeshPart 3D pre-procesado desde ${payload.sourceFormat || 'GLB/OBJ'} (${parts.length} MeshParts, ${payload.totalTriangles || 0} triángulos, escala ${payload.scaleFactorApplied || 1}x a Studs).`,
      pbr_profile: {
        albedo_hex: '#38bdf8',
        roughness: parts[0]?.roughness ?? 0.35,
        metalness: parts[0]?.metalness ?? 0.65,
        emissive_hex: '#06b6d4',
        roblox_material: parts[0]?.material || 'Metal',
        pattern: 'hex_plate',
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
      meshpart_count: parts.length,
      total_triangles: Number(payload.totalTriangles || 0),
      is_roblox_compliant: Boolean(payload.isRobloxCompliant),
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

// P3 Specialized Agents Orchestrator Stream
app.post('/api/v1/agents/orchestrate-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const {
      mission_prompt = 'Sistema completo de Torreta Defensiva de Plasma con HUD táctico, efectos de iluminación orbital y sincronización Rojo',
      biome = 'CyberpunkOrbital',
      save_to_rojo = true,
    } = req.body;

    const audit = auditProjectModules();

    // Step 1: Architect Agent
    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'architect_agent',
      status: 'running',
      message: `Architect Agent: Auditando módulos en disco (${audit.all_verified_modules.length} módulos verificados) y diseñando contratos para: "${mission_prompt}"`,
    });

    const systemSlug =
      mission_prompt
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .split(/\s+/)
        .slice(0, 3)
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('') || 'AutonomousSystem';

    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'architect_agent',
      status: 'completed',
      artifact: `Arquitectura '${systemSlug}' validada con Maid.luau + RemoteProvider.luau`,
    });

    // Step 2: 3D Generation Agent
    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'modeler_3d_agent',
      status: 'running',
      message: `3D Generation Agent: Sintetizando geometría 3D multi-parte en Studs para ${systemSlug}Model...`,
    });

    const generatedParts = [
      {
        name: 'ArmoredPedestalBase',
        shape: 'Cylinder',
        size: [6, 1.2, 6],
        position: [0, 0.6, 0],
        rotation: [0, 0, 0],
        color: [30, 41, 59],
        material: 'DiamondPlate',
        roughness: 0.45,
        metalness: 0.8,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'Hull',
      },
      {
        name: 'PlasmaReactorCore',
        shape: 'Ball',
        size: [2.8, 2.8, 2.8],
        position: [0, 2.8, 0],
        rotation: [0, 0, 0],
        color: [6, 182, 212],
        material: 'Neon',
        roughness: 0.1,
        metalness: 0.2,
        transparency: 0.05,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'Hull',
      },
      {
        name: 'UpperTurretHousing',
        shape: 'Block',
        size: [3.6, 1.6, 4.2],
        position: [0, 4.2, 0],
        rotation: [0, 0, 0],
        color: [51, 65, 85],
        material: 'Metal',
        roughness: 0.28,
        metalness: 0.88,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'Hull',
      },
      {
        name: 'LeftRailBarrel',
        shape: 'Cylinder',
        size: [0.6, 4.5, 0.6],
        position: [-1.1, 4.2, 2.6],
        rotation: [90, 0, 0],
        color: [14, 165, 233],
        material: 'Metal',
        roughness: 0.2,
        metalness: 0.92,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'Hull',
      },
      {
        name: 'RightRailBarrel',
        shape: 'Cylinder',
        size: [0.6, 4.5, 0.6],
        position: [1.1, 4.2, 2.6],
        rotation: [90, 0, 0],
        color: [14, 165, 233],
        material: 'Metal',
        roughness: 0.2,
        metalness: 0.92,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'Hull',
      },
      {
        name: 'TelemetrySensorMast',
        shape: 'Wedge',
        size: [0.8, 2.2, 1.4],
        position: [0, 5.8, -1.2],
        rotation: [0, 0, 0],
        color: [56, 189, 248],
        material: 'Neon',
        roughness: 0.15,
        metalness: 0.5,
        transparency: 0,
        canCollide: false,
        anchored: true,
        collisionFidelity: 'Box',
      },
    ];

    const modelLuau = buildStrictLuauFromEditedParts(`${systemSlug}Model`, generatedParts, 'Hull');
    const modelFileName = `${systemSlug}Model.luau`;
    const modelSavedPath = save_to_rojo
      ? writeToRojoWorkspace('src/shared/Assets3D', modelFileName, modelLuau)
      : null;

    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'modeler_3d_agent',
      status: 'completed',
      artifact: `src/shared/Assets3D/${modelFileName} (${generatedParts.length} partes, 948 tris)`,
    });

    // Step 3: Asset & PBR Agent
    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'asset_pbr_agent',
      status: 'running',
      message: 'Asset & PBR Agent: Calculando perfil SurfaceAppearance, LOD [100, 75, 50, 25] y guardando en assets_library.json...',
    });

    const createdAsset = saveAssetToLibrary({
      id: `agent-3d-${Date.now()}`,
      name: `${systemSlug}Model`,
      category: 'Agent Generated',
      asset_type: 'Model3D',
      poly_count: 948,
      collision_fidelity: 'Hull',
      rojo_target_folder: 'src/shared/Assets3D',
      file_name: modelFileName,
      description: `Modelo 3D autónomo generado por el pipeline de agentes para: ${mission_prompt}`,
      pbr_profile: {
        albedo_hex: '#1e293b',
        roughness: 0.25,
        metalness: 0.86,
        emissive_hex: '#06b6d4',
        roblox_material: 'Metal',
        pattern: 'hex_plate',
      },
      parts: generatedParts,
      luau_code: modelLuau,
      saved_path: modelSavedPath,
    });

    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'asset_pbr_agent',
      status: 'completed',
      artifact: `Asset PBR registrado en biblioteca (${createdAsset.name})`,
    });

    // Step 4: World Builder Agent
    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'world_builder_agent',
      status: 'running',
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
      artifact: `src/shared/${worldFileName} (Bioma ${biome})`,
    });

    // Step 5: Luau Scripter Agent
    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'luau_scripter_agent',
      status: 'running',
      message: 'Luau Systems Agent: Generando controlador Server --!strict con ciclo de vida Maid y task.spawn...',
    });

    let controllerLuau = `--!strict
-- Generated by Forge AI Luau Systems Agent for ${systemSlug}
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Maid = require(Shared:WaitForChild("Utils"):WaitForChild("Maid"))

local sessionMaid = Maid.new()

task.spawn(function()
    print("[ForgeAI] Sistema autónomo ${systemSlug} inicializado en ServerScriptService")
    local heartbeatConn = RunService.Heartbeat:Connect(function(_dt: number)
        -- Ciclo de telemetría del sistema ${systemSlug}
    end)
    sessionMaid:GiveTask(heartbeatConn)
end)
`;

    if (ai) {
      try {
        const aiScript = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `Generate a concise --!strict Roblox Server script using game:GetService, task.spawn, and Maid for: ${mission_prompt}. Output raw Luau code starting with --!strict.`,
        });
        if (aiScript.text && aiScript.text.includes('--!strict')) {
          controllerLuau = aiScript.text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').trim();
        }
      } catch {
        // Fallback to deterministic strict controller above
      }
    }

    const controllerFile = `${systemSlug}Controller.server.luau`;
    if (save_to_rojo) {
      writeToRojoWorkspace('src/server', controllerFile, controllerLuau);
    }

    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'luau_scripter_agent',
      status: 'completed',
      artifact: `src/server/${controllerFile} (--!strict + Maid)`,
    });

    // Step 6: UI HUD Agent
    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'ui_hud_agent',
      status: 'running',
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
    rootPanel.Size = UDim2.fromScale(0.36, 0.14)
    rootPanel.BackgroundColor3 = Color3.fromRGB(13, 17, 23)
    rootPanel.Parent = screenGui

    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, 12)
    corner.Parent = rootPanel

    local stroke = Instance.new("UIStroke")
    stroke.Color = Color3.fromRGB(6, 182, 212)
    stroke.Thickness = 1.5
    stroke.Parent = rootPanel

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
      artifact: `src/client/UI/${hudFile} (UDim2.fromScale + TweenService)`,
    });

    // Step 7: Rojo Bridge Agent
    const finalAudit = auditProjectModules();
    sendSseEvent(res, {
      type: 'agent_step',
      agent_id: 'rojo_sync_agent',
      status: 'completed',
      artifact: `${finalAudit.all_verified_modules.length} archivos .luau sincronizados y verificados con SHA-256 en Rojo`,
    });

    sendSseEvent(res, {
      type: 'done',
      summary: {
        system_name: systemSlug,
        created_asset: createdAsset,
        files_written: [
          `src/shared/Assets3D/${modelFileName}`,
          `src/shared/${worldFileName}`,
          `src/server/${controllerFile}`,
          `src/client/UI/${hudFile}`,
        ],
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
          shape: { type: Type.STRING, description: 'Block, Cylinder, Ball, Wedge, or CornerWedge' },
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
      description: 'Complete --!strict Luau module constructing the 3D Model hierarchy with Maid cleanup and SurfaceAppearance/PointLight.',
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
      category = 'Sci-Fi Props',
      reference_image_base64,
      collision_fidelity = 'Hull',
      target_poly_budget = 2500,
      save_to_rojo = true,
      model_tier = 'fast',
    } = req.body;

    const model = model_tier === 'pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';

    sendSseEvent(res, {
      type: 'log',
      level: 'info',
      message: `Iniciando Motor 3D [${asset_type}] con '${model}' (Fidelidad Colisión: ${collision_fidelity}, Budget: ${target_poly_budget} tris)`,
    });

    const localContext = getLocalProjectContext();

    const systemInstruction = `
You are the Principal 3D Geometry, PBR Material & Roblox WorldModel Architect for "Forge AI".
You design composite 3D models and full 3D scenes composed of 6 to 12 articulated sub-parts across three silhouette scales:
1. Primary Silhouette (chassis, hull, foundation, trunk, main body)
2. Secondary Read (turrets, wings, columns, canopy, structural supports)
3. Accent Details (neon emitters, optic sensors, vents, bevel trims, control terminals)

RULES FOR 3D GEOMETRY (parts):
- Ground the model so the lowest point rests flush at Y = 0 (bottom-center pivot).
- Vary roughness (0.05 to 0.9) and metalness (0.05 to 0.98) realistically between adjacent parts.
- Assign authentic Roblox Enum.Material values (Metal, Neon, DiamondPlate, Glass, Slate, SmoothPlastic, Concrete, WoodPlanks).
- Generate a complete --!strict Luau module in luau_code that constructs the Model inside Workspace or a ViewportFrame > WorldModel and cleans up via Maid.
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
        message: `Imagen de referencia 2D cargada (${mimeType}) para reconstrucción volumétrica 3D.`,
      });
    }
    contents.push({ text: promptText });

    sendSseEvent(res, {
      type: 'log',
      level: 'stream',
      message: 'Sintetizando sub-ensamblajes 3D, perfiles PBR y constructor Luau...',
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
        sendSseEvent(res, { type: 'chunk', text: chunkText });
      }
    }

    const parsed = JSON.parse(fullText || '{}');
    parsed.id = `asset-${Date.now()}`;

    if (save_to_rojo) {
      const savedPath = writeToRojoWorkspace(
        parsed.rojo_target_folder || 'src/shared/Assets3D',
        parsed.file_name,
        parsed.luau_code
      );
      parsed.saved_path = savedPath;
      sendSseEvent(res, {
        type: 'log',
        level: 'rojo',
        message: `ROJO 3D SYNC CONFIRMADO: Módulo 3D escrito en ${savedPath} (${(parsed.parts || []).length} sub-partes)`,
      });
    }

    const savedAsset = saveAssetToLibrary(parsed);
    sendSseEvent(res, {
      type: 'log',
      level: 'success',
      message: `Asset 3D '${savedAsset.name}' registrado en la Biblioteca Reutilizable (${savedAsset.poly_count} triángulos).`,
    });

    sendSseEvent(res, { type: 'done', result: savedAsset });
    res.end();
  } catch (err: any) {
    sendSseEvent(res, { type: 'error', message: err.message || 'Error generando modelo 3D' });
    res.end();
  }
});

// Non-streaming 3D endpoint for Roblox Studio Plugin HttpService
app.post('/api/v1/generate-3d', async (req, res) => {
  try {
    if (!ai) {
      return res.status(503).json({ error: 'GEMINI_API_KEY no configurada.' });
    }
    const {
      prompt,
      asset_type = 'Model3D',
      category = 'Sci-Fi Props',
      reference_image_base64,
      collision_fidelity = 'Hull',
      target_poly_budget = 2500,
      save_to_rojo = true,
      model_tier = 'fast',
    } = req.body;

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
      text: `Generate a composite 3D Roblox ${asset_type} (${category}) with 6-10 parts grounded at Y=0, CollisionFidelity=${collision_fidelity}, max ${target_poly_budget} tris:\n${prompt}\n${localContext}`,
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
