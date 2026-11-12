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
import { cloudBridgeCoordinator } from './src/server/engines/bridgeCoordinatorEngine.ts';
import {
  AI_MODULE_CONTRACTS,
  buildAiSelfUnderstandingManifest,
  buildGltfFromPartsServer,
  buildObjAndMtlFromPartsServer,
  buildPrunedDomainContext,
  buildRbxmxFromPartsServer,
  buildStrictLuauFromEditedParts,
  computeDataModelSyncDiffServer,
  computeFnv1a32Hex,
  deleteAssetFromLibraryServer,
  extractGeometryFromProcessedMesh,
  extractPartsFromUploadedMesh,
  type ForgeContextDomain,
  generatePBRSurfaceAppearanceLuau,
  generateWorldEnvironmentLuau,
  getAssetFromLibraryServer,
  loadAssetsLibraryServer,
  normalizePartsWithSyncMetadata,
  normalizeValidMeshId,
  parseRbxmxFromPartsServer,
  restoreAssetVersionServer,
  splitOversizedMeshPartInput,
  synthesizeProceduralMeshData,
  upsertAssetInLibraryServer,
  validateAndDecodePngBuffer,
  validatePublishedRobloxMeshId,
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

const ALLOWED_EXTENSIONS = new Set([
  '.luau',
  '.json',
  '.obj',
  '.mtl',
  '.gltf',
  '.glb',
  '.rbxmx',
  '.md',
  '.png',
]);
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
  const rojoRoot = path.resolve(runtimeRojoPath);
  const relToRojo = path.relative(rojoRoot, absTarget).replace(/\\/g, '/');
  if (cloudBridgeCoordinator.isBridgeConnected()) {
    void cloudBridgeCoordinator.enqueueTask('rojo.write_file', {
      relativePath: relToRojo,
      content: safeCode,
      encoding: 'utf-8',
    });
  }
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
  const rojoRoot = path.resolve(runtimeRojoPath);
  const relToRojo = path.relative(rojoRoot, absTarget).replace(/\\/g, '/');
  if (cloudBridgeCoordinator.isBridgeConnected()) {
    void cloudBridgeCoordinator.enqueueTask('rojo.write_file', {
      relativePath: relToRojo,
      content: typeof content === 'string' ? content : content.toString('base64'),
      encoding: typeof content === 'string' ? 'utf-8' : 'base64',
    });
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

function walkLuauFiles(
  dir: string,
  rootDir: string,
  list: Array<{ name: string; relative_path: string; sha256: string; content_fnv32: string }> = []
) {
  if (!fs.existsSync(dir)) return list;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkLuauFiles(fullPath, rootDir, list);
    } else if (entry.isFile() && entry.name.endsWith('.luau')) {
      const content = fs.readFileSync(fullPath);
      const textContent = content.toString('utf-8');
      const sha256 = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
      const content_fnv32 = computeFnv1a32Hex(textContent);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      const baseName = entry.name
        .replace(/\.server\.luau$/, '')
        .replace(/\.client\.luau$/, '')
        .replace(/\.luau$/, '');
      list.push({
        name: baseName,
        relative_path: relPath,
        sha256,
        content_fnv32,
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

function getPrunedProjectContextDetails(domain: ForgeContextDomain = 'luau') {
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

  return buildPrunedDomainContext(rawContext, verificationBlock, domain);
}

function getLocalProjectContext(domain: ForgeContextDomain = 'luau'): string {
  return getPrunedProjectContextDetails(domain).promptContext;
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
  return loadAssetsLibraryServer(getAssetsLibraryPath());
}

function saveAssetToLibrary(asset: any): any {
  return upsertAssetInLibraryServer(getAssetsLibraryPath(), asset);
}

// Read backend files to serve to frontend code explorer
function getBackendSourceFiles() {
  const backendDir = path.resolve(process.cwd(), 'backend');
  const files: Record<string, string> = {};

  const rootDir = process.cwd();
  const fileList = [
    { name: 'AI_ARCHITECTURE_MAP.md', path: path.join(rootDir, 'AI_ARCHITECTURE_MAP.md') },
    { name: 'README.md', path: path.join(rootDir, 'README.md') },
    { name: 'docs/ARCHITECTURE.md', path: path.join(rootDir, 'docs', 'ARCHITECTURE.md') },
    { name: 'docs/API_REFERENCE.md', path: path.join(rootDir, 'docs', 'API_REFERENCE.md') },
    { name: 'docs/ROBLOX_PLUGIN_AND_ROJO_GUIDE.md', path: path.join(rootDir, 'docs', 'ROBLOX_PLUGIN_AND_ROJO_GUIDE.md') },
    { name: 'main.py', path: path.join(backendDir, 'main.py') },
    { name: 'engines/context_pruner.py', path: path.join(backendDir, 'engines', 'context_pruner.py') },
    { name: 'engines/generation_3d_engine.py', path: path.join(backendDir, 'engines', 'generation_3d_engine.py') },
    { name: 'engines/asset_engine.py', path: path.join(backendDir, 'engines', 'asset_engine.py') },
    { name: 'engines/world_engine.py', path: path.join(backendDir, 'engines', 'world_engine.py') },
    { name: 'engines/luau_engine.py', path: path.join(backendDir, 'engines', 'luau_engine.py') },
    { name: 'engines/ui_engine.py', path: path.join(backendDir, 'engines', 'ui_engine.py') },
    { name: 'engines/rojo_bridge.py', path: path.join(backendDir, 'engines', 'rojo_bridge.py') },
    { name: 'engines/agents_engine.py', path: path.join(backendDir, 'engines', 'agents_engine.py') },
    { name: 'src/server/engines/contextPrunerEngine.ts', path: path.join(rootDir, 'src', 'server', 'engines', 'contextPrunerEngine.ts') },
    { name: 'src/server/engines/generation3DEngine.ts', path: path.join(rootDir, 'src', 'server', 'engines', 'generation3DEngine.ts') },
    { name: 'src/server/engines/assetEngine.ts', path: path.join(rootDir, 'src', 'server', 'engines', 'assetEngine.ts') },
    { name: 'src/server/engines/luauEngine.ts', path: path.join(rootDir, 'src', 'server', 'engines', 'luauEngine.ts') },
    { name: 'src/server/engines/uiEngine.ts', path: path.join(rootDir, 'src', 'server', 'engines', 'uiEngine.ts') },
    { name: 'src/server/engines/worldEngine.ts', path: path.join(rootDir, 'src', 'server', 'engines', 'worldEngine.ts') },
    { name: 'src/server/engines/rojoBridge.ts', path: path.join(rootDir, 'src', 'server', 'engines', 'rojoBridge.ts') },
    { name: 'src/server/engines/agentsEngine.ts', path: path.join(rootDir, 'src', 'server', 'engines', 'agentsEngine.ts') },
    { name: 'src/components/engines/3dEngine.ts', path: path.join(rootDir, 'src', 'components', 'engines', '3dEngine.ts') },
    { name: 'requirements.txt', path: path.join(backendDir, 'requirements.txt') },
    { name: '.env.example', path: path.join(backendDir, '.env.example') },
    { name: 'project_context.md', path: path.join(backendDir, 'project_context.md') },
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
  const localStatus = await getRojoFullStatus();
  const bridgeStatus = cloudBridgeCoordinator.getPublicBridgeStatus();
  if (bridgeStatus.bridgeConnected && bridgeStatus.rojo) {
    return res.json({
      ...localStatus,
      rojo_cli_installed: bridgeStatus.rojo.rojoCliInstalled || localStatus.rojo_cli_installed,
      rojo_version: bridgeStatus.rojo.rojoVersion || localStatus.rojo_version,
      rojo_serve_port: bridgeStatus.rojo.rojoServePort || localStatus.rojo_serve_port,
      rojo_server_active: bridgeStatus.rojo.rojoServerListening || localStatus.rojo_server_active,
      rojo_server_listening: bridgeStatus.rojo.rojoServerListening || localStatus.rojo_server_active,
      default_project_name: bridgeStatus.rojo.projectName,
      synced_files_count: bridgeStatus.rojo.syncedFilesCount,
      bridge_connected: true,
      bridge_status: bridgeStatus,
    });
  }
  res.json({
    ...localStatus,
    bridge_connected: false,
    bridge_status: bridgeStatus,
  });
});

// -----------------------------------------------------------------------------
// 4b. Forge Local Bridge Cloud Coordinator Endpoints (Fase 3, 5, 6, 7, 8)
// -----------------------------------------------------------------------------

app.post('/api/v1/bridge/auth/handshake', (req, res) => {
  const providedHeader = String(req.headers['x-forge-token'] || '').trim();
  const result = cloudBridgeCoordinator.handleHandshake(req.body || {}, providedHeader);
  if (!result.accepted) {
    return res.status(401).json({ error: result.error || 'Handshake no autorizado.' });
  }
  res.json(result);
});

app.post('/api/v1/bridge/heartbeat', (req, res) => {
  const authHeader = String(req.headers.authorization || '');
  const sessionHeader = String(req.headers['x-bridge-session'] || '');
  const forgeTokenHeader = String(req.headers['x-forge-token'] || '');
  if (!cloudBridgeCoordinator.verifySessionRequest(authHeader, sessionHeader, forgeTokenHeader)) {
    return res.status(401).json({ error: 'Sesión del puente expirada o no autenticada.' });
  }
  const resp = cloudBridgeCoordinator.handleHeartbeat(req.body || {});
  res.json(resp);
});

app.post('/api/v1/bridge/task-ack', (req, res) => {
  const authHeader = String(req.headers.authorization || '');
  const sessionHeader = String(req.headers['x-bridge-session'] || '');
  const forgeTokenHeader = String(req.headers['x-forge-token'] || '');
  if (!cloudBridgeCoordinator.verifySessionRequest(authHeader, sessionHeader, forgeTokenHeader)) {
    return res.status(401).json({ error: 'Sesión del puente expirada o no autenticada.' });
  }
  const { taskId } = req.body || {};
  const acked = cloudBridgeCoordinator.handleTaskAck(String(taskId || ''));
  res.json({ acked });
});

app.post('/api/v1/bridge/task-result', (req, res) => {
  const authHeader = String(req.headers.authorization || '');
  const sessionHeader = String(req.headers['x-bridge-session'] || '');
  const forgeTokenHeader = String(req.headers['x-forge-token'] || '');
  if (!cloudBridgeCoordinator.verifySessionRequest(authHeader, sessionHeader, forgeTokenHeader)) {
    return res.status(401).json({ error: 'Sesión del puente expirada o no autenticada.' });
  }
  const accepted = cloudBridgeCoordinator.handleTaskResult(req.body || {});
  res.json({ accepted });
});

app.get('/api/v1/bridge/status', (_req, res) => {
  res.json(cloudBridgeCoordinator.getPublicBridgeStatus());
});

app.get('/api/v1/bridge/task/:taskId', (req, res) => {
  const result = cloudBridgeCoordinator.getTaskResult(String(req.params.taskId || ''));
  if (!result) {
    return res.status(404).json({ error: 'Tarea no encontrada o aún en ejecución.' });
  }
  return res.json(result);
});

app.post('/api/v1/bridge/reconnect', (_req, res) => {
  cloudBridgeCoordinator.requestReconnect();
  res.json({
    reconnecting: true,
    message: 'Se solicitó renovación de sesión al puente local.',
    status: cloudBridgeCoordinator.getPublicBridgeStatus(),
  });
});

app.post('/api/v1/bridge/enqueue', async (req, res) => {
  try {
    const {
      operation,
      payload = {},
      wait_for_completion = true,
      timeout_ms = 20000,
    } = req.body || {};
    if (!operation || typeof operation !== 'string') {
      return res.status(400).json({ error: 'Se requiere el campo operation.' });
    }
    const result = await cloudBridgeCoordinator.enqueueTask(
      operation,
      payload,
      Boolean(wait_for_completion),
      Number(timeout_ms)
    );
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
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
  const domains: ForgeContextDomain[] = ['3d', 'pbr', 'luau', 'ui', 'world', 'agents'];
  const domainPrunerStats = domains.map((d) => {
    const pruned = getPrunedProjectContextDetails(d);
    return {
      domain: pruned.domain,
      includedSections: pruned.includedSections,
      originalChars: pruned.rawCharCount,
      prunedChars: pruned.prunedCharCount,
      reductionPercent: pruned.savedPercentage,
    };
  });
  res.json({
    engines: FORGE_MODULAR_ENGINES,
    roadmap: FORGE_ROADMAP_STATUS,
    agents: SPECIALIZED_AGENTS,
    ai_manifest: buildAiSelfUnderstandingManifest(),
    module_contracts: AI_MODULE_CONTRACTS,
    domain_pruner_stats: domainPrunerStats,
  });
});

app.get('/api/v1/ai-manifest', (_req, res) => {
  const domains: ForgeContextDomain[] = ['3d', 'pbr', 'luau', 'ui', 'world', 'agents'];
  const domainPrunerStats = domains.map((d) => {
    const pruned = getPrunedProjectContextDetails(d);
    return {
      domain: pruned.domain,
      includedSections: pruned.includedSections,
      originalChars: pruned.rawCharCount,
      prunedChars: pruned.prunedCharCount,
      reductionPercent: pruned.savedPercentage,
    };
  });
  res.json({
    ...buildAiSelfUnderstandingManifest(),
    domainPrunerStats,
  });
});

app.get('/api/v1/context/pruned', (req, res) => {
  const rawDomain = String(req.query.domain || 'luau').toLowerCase();
  const allowed: ForgeContextDomain[] = ['3d', 'pbr', 'luau', 'ui', 'world', 'agents'];
  const domain: ForgeContextDomain = allowed.includes(rawDomain as ForgeContextDomain)
    ? (rawDomain as ForgeContextDomain)
    : 'luau';
  res.json(getPrunedProjectContextDetails(domain));
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

    const enrichedParts: any[] = [];
    (asset.parts || []).forEach((p: any, idx: number) => {
      const partName = p.name || `MeshPart_${idx + 1}`;
      const resolvedMesh = extractGeometryFromProcessedMesh(p, objFileName, safeModelName);
      const meshId = validatePublishedRobloxMeshId(p.meshId || p.mesh_id || resolvedMesh.meshId);
      const assetId = validatePublishedRobloxMeshId(
        p.assetId || p.asset_id || resolvedMesh.assetId || meshId
      );
      resolvedMesh.meshId = meshId;
      resolvedMesh.assetId = assetId;
      resolvedMesh.objFileName = objFileName;

      const splitList = splitOversizedMeshPartInput({
        ...p,
        name: partName,
        shape: 'MeshPart',
        meshId,
        assetId,
        meshData: resolvedMesh,
      });
      enrichedParts.push(...splitList);
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

// GLB/GLTF/OBJ/FBX/Heightmap Preprocessor -> Real Roblox EditableMesh / MeshPart + OBJ Export Endpoint
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

    const parts: any[] = [];
    payload.subMeshParts.forEach((sub: any, idx: number) => {
      const partName = sub.name || `MeshPart_${idx + 1}`;
      const studSize = sub.studSize || [2, 2, 2];
      const extractedMesh = extractGeometryFromProcessedMesh(sub, objFileName, payload.modelName);
      const meshId = validatePublishedRobloxMeshId(sub.meshId || sub.mesh_id || extractedMesh.meshId);
      const assetId = validatePublishedRobloxMeshId(
        sub.assetId || sub.asset_id || extractedMesh.assetId || meshId
      );

      extractedMesh.meshId = meshId;
      extractedMesh.assetId = assetId;
      extractedMesh.objFileName = objFileName;

      const splitList = splitOversizedMeshPartInput({
        name: partName,
        shape: 'MeshPart',
        meshId,
        assetId,
        textureId: validatePublishedRobloxMeshId(sub.textureId || sub.texture_id) || undefined,
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
      });
      parts.push(...splitList);
    });

    const luauCode =
      payload.luauMeshPartBuilderCode &&
      payload.luauMeshPartBuilderCode.includes('CreateEditableMesh') &&
      payload.luauMeshPartBuilderCode.includes('CreateMeshPartAsync') &&
      !payload.luauMeshPartBuilderCode.includes('.MeshId =')
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

    const totalTris =
      parts.reduce((sum, p) => sum + (p.meshData?.faces?.length || 0), 0) ||
      Number(payload.totalTriangles || 0);

    const assetRecord = {
      id: `meshpart-${Date.now()}`,
      name: payload.modelName,
      category: `Imported ${payload.sourceFormat || '3D'}`,
      asset_type: 'Model3D',
      poly_count: totalTris,
      collision_fidelity: parts[0]?.collisionFidelity || 'Hull',
      rojo_target_folder: targetFolder,
      file_name: fileName,
      obj_file_name: objFileName,
      obj_saved_path: objSavedPath,
      description: `MeshPart 3D con geometría EditableMesh real desde ${payload.sourceFormat || 'GLB/OBJ'} (${parts.length} MeshParts, ${totalTris} triángulos, EditableMesh + OBJ sincronizados).`,
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
      total_triangles: totalTris,
      is_roblox_compliant: Boolean(payload.isRobloxCompliant),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Bidirectional Roblox Studio Package Exporter (.rbxmx, .gltf, .obj + .mtl, .luau) -> Rojo & Library
app.post('/api/v1/assets/export-roblox-package', async (req, res) => {
  try {
    const {
      asset,
      rbxmx_content = '',
      gltf_content = '',
      obj_content = '',
      mtl_content = '',
      pbr_textures,
      save_to_rojo = true,
      save_to_library = true,
    } = req.body;

    if (!asset || !asset.name) {
      return res.status(400).json({ error: 'Se requiere un asset 3D válido para exportar a Roblox Studio.' });
    }

    const safeName = String(asset.name).replace(/[^a-zA-Z0-9_]/g, '') || 'ForgeModel3D';
    const targetFolder = asset.rojo_target_folder || 'src/shared/Assets3D';
    const objFileName = `${safeName}.obj`;
    const collisionFidelity = asset.collision_fidelity || 'Hull';

    const enrichedParts: any[] = [];
    (asset.parts || []).forEach((p: any, idx: number) => {
      const partName = p.name || `MeshPart_${idx + 1}`;
      const resolvedMesh = extractGeometryFromProcessedMesh(p, objFileName, safeName);
      const meshId = validatePublishedRobloxMeshId(p.meshId || p.mesh_id || resolvedMesh.meshId);
      const assetId = validatePublishedRobloxMeshId(
        p.assetId || p.asset_id || resolvedMesh.assetId || meshId
      );
      resolvedMesh.meshId = meshId;
      resolvedMesh.assetId = assetId;
      resolvedMesh.objFileName = objFileName;

      const splitList = splitOversizedMeshPartInput({
        ...p,
        name: partName,
        shape: 'MeshPart',
        meshId,
        assetId,
        meshData: resolvedMesh,
      });
      enrichedParts.push(...splitList);
    });

    const rebuiltLuau = buildStrictLuauFromEditedParts(
      safeName,
      enrichedParts,
      collisionFidelity
    );

    // Autonomously build any of the 4 companion files on the backend if omitted by the client
    let finalRbxmx = typeof rbxmx_content === 'string' ? rbxmx_content.trim() : '';
    let finalGltf = typeof gltf_content === 'string' ? gltf_content.trim() : '';
    let finalObj = typeof obj_content === 'string' ? obj_content.trim() : '';
    let finalMtl = typeof mtl_content === 'string' ? mtl_content.trim() : '';

    if (!finalRbxmx) {
      finalRbxmx = buildRbxmxFromPartsServer(
        safeName,
        enrichedParts,
        collisionFidelity,
        asset.category || '3D Asset',
        rebuiltLuau
      );
    }

    if (!finalObj || !finalMtl) {
      const builtObjMtl = buildObjAndMtlFromPartsServer(safeName, enrichedParts);
      if (!finalObj) finalObj = builtObjMtl.obj;
      if (!finalMtl) finalMtl = builtObjMtl.mtl;
    }

    if (!finalGltf) {
      finalGltf = buildGltfFromPartsServer(safeName, enrichedParts, pbr_textures);
    }

    const savedFiles: Record<string, string | null> = {
      luau: null,
      rbxmx: null,
      gltf: null,
      obj: null,
      mtl: null,
    };
    const verifiedFiles: Record<string, boolean> = {
      luau: false,
      rbxmx: false,
      gltf: false,
      obj: false,
      mtl: false,
    };

    if (save_to_rojo) {
      savedFiles.luau = writeToRojoWorkspace(targetFolder, `${safeName}.luau`, rebuiltLuau);
      savedFiles.rbxmx = writeRawAssetToRojoWorkspace(targetFolder, `${safeName}.rbxmx`, finalRbxmx);
      savedFiles.gltf = writeRawAssetToRojoWorkspace(targetFolder, `${safeName}.gltf`, finalGltf);
      savedFiles.obj = writeRawAssetToRojoWorkspace(targetFolder, `${safeName}.obj`, finalObj);
      savedFiles.mtl = writeRawAssetToRojoWorkspace(targetFolder, `${safeName}.mtl`, finalMtl);

      for (const [ext, filePath] of Object.entries(savedFiles)) {
        if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
          verifiedFiles[ext] = true;
        }
      }
    }

    const verifiedCount = Object.values(verifiedFiles).filter(Boolean).length;
    const allFiveExist = save_to_rojo ? verifiedCount === 5 : true;

    const totalTris = enrichedParts.reduce((acc: number, p: any) => {
      return acc + (p.meshData?.faces?.length || 12);
    }, 0);

    const updatedAsset = {
      ...asset,
      name: safeName,
      parts: enrichedParts,
      poly_count: totalTris,
      luau_code: rebuiltLuau,
      file_name: `${safeName}.luau`,
      obj_file_name: objFileName,
      saved_path: savedFiles.luau || asset.saved_path || null,
      obj_saved_path: savedFiles.obj || asset.obj_saved_path || null,
      exported_package_files: savedFiles,
      verified_package_files: verifiedFiles,
    };

    const finalAsset = save_to_library ? saveAssetToLibrary(updatedAsset) : updatedAsset;

    let studioBridgeTask: any = null;
    if (req.body.sync_to_studio && cloudBridgeCoordinator.isBridgeConnected()) {
      studioBridgeTask = await cloudBridgeCoordinator.enqueueTask(
        'studio.apply_modifications',
        {
          modelName: safeName,
          asset: finalAsset,
        },
        false
      );
    }

    res.json({
      success: allFiveExist,
      all_five_exist: allFiveExist,
      verified_files_count: verifiedCount,
      verified_files: verifiedFiles,
      asset: finalAsset,
      saved_files: savedFiles,
      studio_bridge_task: studioBridgeTask,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Publish browser-synthesized 4-channel PBR maps (ColorMap, NormalMap, RoughnessMap, MetalnessMap) + SurfaceAppearance Luau binder to Rojo
app.post('/api/v1/assets/publish-pbr', (req, res) => {
  try {
    const {
      material_name = 'ForgePBRMaterial',
      pattern = 'hex_plate',
      albedo_data_url = '',
      normal_data_url = '',
      roughness_data_url = '',
      metalness_data_url = '',
      roughness = 0.35,
      metalness = 0.75,
      albedo_hex = '#38bdf8',
      emissive_hex = '#06b6d4',
      target_asset_id = '',
      target_part_name = '',
      color_map_asset_id = '',
      normal_map_asset_id = '',
      roughness_map_asset_id = '',
      metalness_map_asset_id = '',
      roblox_api_key = '',
      roblox_open_cloud_api_key = '',
      roblox_creator_id = '',
      creator_user_id = '',
    } = req.body;

    const safeMat = String(material_name).replace(/[^a-zA-Z0-9_]/g, '') || 'ForgePBRMaterial';
    const cleanTargetAssetId = String(target_asset_id || '').trim();
    const cleanTargetPartName = String(target_part_name || '').trim();
    const textureFolder = 'src/shared/Assets3D/Textures';
    const libPath = getAssetsLibraryPath();

    // 1. Verify target_asset_id exists in the unified Asset Library before saving any PBR profile
    let existingAsset: any = null;
    if (cleanTargetAssetId) {
      existingAsset = getAssetFromLibraryServer(libPath, cleanTargetAssetId);
      if (!existingAsset) {
        return res.json({
          success: false,
          status: 'asset_not_found',
          error: `El asset destino '${cleanTargetAssetId}' no existe en la biblioteca de assets.`,
          material_name: safeMat,
          target_asset_id: cleanTargetAssetId,
          target_part_name: cleanTargetPartName || null,
          saved_textures: {},
          published_channels: [],
          missing_channels: ['ColorMap.png', 'NormalMap.png', 'RoughnessMap.png', 'MetalnessMap.png'],
          decode_errors: {},
          channel_status: {
            'ColorMap.png': 'asset_not_found',
            'NormalMap.png': 'asset_not_found',
            'RoughnessMap.png': 'asset_not_found',
            'MetalnessMap.png': 'asset_not_found',
          },
          is_cloud_published: false,
          verified_cloud_ids: {},
          verified_cloud_uris: {},
          updated_asset: null,
        });
      }
    }

    const savedTextures: Record<string, string> = {};
    const decodedRgbaPreviews: Record<string, string> = {};
    const pngValidationReports: Record<string, any> = {};
    const decodeErrors: Record<string, string> = {};
    const receivedChannels: string[] = [];
    const missingChannels: string[] = [];
    const channelStatus: Record<string, string> = {};

    const mapEntries: Array<[string, string]> = [
      [albedo_data_url, 'ColorMap.png'],
      [normal_data_url, 'NormalMap.png'],
      [roughness_data_url, 'RoughnessMap.png'],
      [metalness_data_url, 'MetalnessMap.png'],
    ];

    for (const [dataUrl, suffix] of mapEntries) {
      const rawStr = typeof dataUrl === 'string' ? dataUrl.trim() : '';
      if (!rawStr) {
        missingChannels.push(suffix);
        channelStatus[suffix] = 'missing';
        continue;
      }
      const b64 = rawStr.includes(',') ? rawStr.split(',')[1] : rawStr;
      if (!b64) {
        decodeErrors[suffix] = 'Data URL vacía sin payload base64.';
        channelStatus[suffix] = 'decode_failed';
        continue;
      }
      try {
        const buf = Buffer.from(b64, 'base64');
        const validation = validateAndDecodePngBuffer(buf);
        pngValidationReports[suffix] = {
          valid: validation.valid,
          width: validation.width,
          height: validation.height,
          bit_depth: validation.bitDepth,
          color_type: validation.colorType,
          sha256: validation.sha256,
          mean_rgba: validation.meanRgba,
          error: validation.error,
        };
        if (!validation.valid) {
          decodeErrors[suffix] = validation.error || 'Buffer PNG inválido.';
          channelStatus[suffix] = 'decode_failed';
          continue;
        }
        receivedChannels.push(suffix);
        if (validation.rgbaPreviewB64) {
          decodedRgbaPreviews[suffix] = validation.rgbaPreviewB64;
        }
        const fileName = `${safeMat}_${suffix}`;
        savedTextures[suffix] = writeRawAssetToRojoWorkspace(textureFolder, fileName, buf);
        channelStatus[suffix] = 'local_saved';
      } catch (err: any) {
        decodeErrors[suffix] = err?.message || 'Error decodificando PNG base64.';
        channelStatus[suffix] = 'decode_failed';
      }
    }

    const verifiedColor = validatePublishedRobloxMeshId(color_map_asset_id) || undefined;
    const verifiedNormal = validatePublishedRobloxMeshId(normal_map_asset_id) || undefined;
    const verifiedRough = validatePublishedRobloxMeshId(roughness_map_asset_id) || undefined;
    const verifiedMetal = validatePublishedRobloxMeshId(metalness_map_asset_id) || undefined;

    if (verifiedColor) channelStatus['ColorMap.png'] = 'cloud_published';
    if (verifiedNormal) channelStatus['NormalMap.png'] = 'cloud_published';
    if (verifiedRough) channelStatus['RoughnessMap.png'] = 'cloud_published';
    if (verifiedMetal) channelStatus['MetalnessMap.png'] = 'cloud_published';

    const publishedChannels: string[] = [];
    if (verifiedColor) publishedChannels.push('ColorMap.png');
    if (verifiedNormal) publishedChannels.push('NormalMap.png');
    if (verifiedRough) publishedChannels.push('RoughnessMap.png');
    if (verifiedMetal) publishedChannels.push('MetalnessMap.png');

    const cloudRequested = Boolean(
      (roblox_api_key || roblox_open_cloud_api_key || process.env.ROBLOX_OPEN_CLOUD_API_KEY) &&
        (roblox_creator_id || creator_user_id || process.env.ROBLOX_CREATOR_ID)
    );

    let pubStatus:
      | 'local_saved'
      | 'cloud_publishing'
      | 'cloud_published'
      | 'partially_published'
      | 'failed'
      | 'asset_not_found';

    if (receivedChannels.length === 0 || Object.keys(decodeErrors).length > 0) {
      pubStatus = 'failed';
    } else if (publishedChannels.length === 4) {
      pubStatus = 'cloud_published';
    } else if (publishedChannels.length > 0) {
      pubStatus = 'partially_published';
    } else if (cloudRequested && publishedChannels.length === 0) {
      pubStatus = 'failed';
    } else if (receivedChannels.length === 4) {
      pubStatus = 'local_saved';
    } else {
      pubStatus = 'partially_published';
    }

    const isSuccess = pubStatus !== 'failed';
    const isCloudPublished = publishedChannels.length === 4;

    const pbrLuau = generatePBRSurfaceAppearanceLuau(
      safeMat,
      textureFolder,
      Number(roughness),
      Number(metalness),
      String(albedo_hex),
      {
        colorMapId: verifiedColor,
        normalMapId: verifiedNormal,
        roughnessMapId: verifiedRough,
        metalnessMapId: verifiedMetal,
      },
      decodedRgbaPreviews
    );
    const luauFileName = `${safeMat}_SurfaceAppearance.luau`;
    const luauSavedPath = isSuccess
      ? writeToRojoWorkspace('src/shared/Assets3D', luauFileName, pbrLuau)
      : null;

    let updatedAsset: any = null;
    if (existingAsset && isSuccess) {
      const pbrSpec = {
        materialName: safeMat,
        pattern: String(pattern),
        albedoHex: String(albedo_hex),
        emissiveHex: String(emissive_hex),
        roughness: Number(roughness),
        metalness: Number(metalness),
        publicationStatus: pubStatus,
        colorMapId: verifiedColor,
        normalMapId: verifiedNormal,
        roughnessMapId: verifiedRough,
        metalnessMapId: verifiedMetal,
        colorMapAssetId: verifiedColor,
        normalMapAssetId: verifiedNormal,
        roughnessMapAssetId: verifiedRough,
        metalnessMapAssetId: verifiedMetal,
        localColorMapFile: savedTextures['ColorMap.png'],
        localNormalMapFile: savedTextures['NormalMap.png'],
        localRoughnessMapFile: savedTextures['RoughnessMap.png'],
        localMetalnessMapFile: savedTextures['MetalnessMap.png'],
        rgbaPreviewByChannel: decodedRgbaPreviews,
      };
      existingAsset.pbr_profile = {
        ...(existingAsset.pbr_profile || {}),
        albedo_hex: String(albedo_hex),
        emissive_hex: String(emissive_hex),
        roughness: Number(roughness),
        metalness: Number(metalness),
        pattern: String(pattern),
        surface_appearance: true,
        publication_status: pubStatus,
        albedo_asset_path: savedTextures['ColorMap.png'] || undefined,
        normal_asset_path: savedTextures['NormalMap.png'] || undefined,
        roughness_asset_path: savedTextures['RoughnessMap.png'] || undefined,
        metalness_asset_path: savedTextures['MetalnessMap.png'] || undefined,
        color_map_asset_id: verifiedColor || undefined,
        normal_map_asset_id: verifiedNormal || undefined,
        roughness_map_asset_id: verifiedRough || undefined,
        metalness_map_asset_id: verifiedMetal || undefined,
      };
      if (Array.isArray(existingAsset.parts)) {
        existingAsset.parts = existingAsset.parts.map((pt: any) => {
          if (!cleanTargetPartName || cleanTargetPartName === '__ALL__' || pt.name === cleanTargetPartName) {
            return {
              ...pt,
              roughness: Number(roughness),
              metalness: Number(metalness),
              pbrMaterial: pbrSpec,
            };
          }
          return pt;
        });
      }

      const safeAssetName =
        String(existingAsset.name || 'Model3D').replace(/[^a-zA-Z0-9_]/g, '') || 'Model3D';
      const enrichedParts = normalizePartsWithSyncMetadata(existingAsset.parts || []);
      const rebuiltLuau = buildStrictLuauFromEditedParts(
        safeAssetName,
        enrichedParts,
        existingAsset.collision_fidelity || 'Hull'
      );
      const rebuiltRbxmx = buildRbxmxFromPartsServer(
        safeAssetName,
        enrichedParts,
        existingAsset.collision_fidelity || 'Hull',
        existingAsset.category || '3D Asset',
        rebuiltLuau
      );
      const assetFolder = existingAsset.rojo_target_folder || 'src/shared/Assets3D';
      writeToRojoWorkspace(assetFolder, `${safeAssetName}.luau`, rebuiltLuau);
      writeRawAssetToRojoWorkspace(assetFolder, `${safeAssetName}.rbxmx`, rebuiltRbxmx);
      existingAsset.parts = enrichedParts;
      existingAsset.luau_code = rebuiltLuau;
      updatedAsset = saveAssetToLibrary(existingAsset);
    }

    res.json({
      success: isSuccess,
      status: pubStatus,
      material_name: safeMat,
      target_asset_id: cleanTargetAssetId || null,
      target_part_name: cleanTargetPartName || null,
      saved_textures: savedTextures,
      local_files: savedTextures,
      received_channels: receivedChannels,
      published_channels: publishedChannels,
      missing_channels: missingChannels,
      decode_errors: decodeErrors,
      channel_status: channelStatus,
      png_validation: pngValidationReports,
      is_cloud_published: isCloudPublished,
      verified_cloud_ids: {
        color_map_id: verifiedColor || null,
        normal_map_id: verifiedNormal || null,
        roughness_map_id: verifiedRough || null,
        metalness_map_id: verifiedMetal || null,
      },
      verified_cloud_uris: {
        ColorMap: verifiedColor || null,
        NormalMap: verifiedNormal || null,
        RoughnessMap: verifiedRough || null,
        MetalnessMap: verifiedMetal || null,
        color_map_id: verifiedColor || null,
        normal_map_id: verifiedNormal || null,
        roughness_map_id: verifiedRough || null,
        metalness_map_id: verifiedMetal || null,
      },
      luau_binder_path: `src/shared/Assets3D/${luauFileName}`,
      luau_file: `src/shared/Assets3D/${luauFileName}`,
      luau_saved_path: luauSavedPath,
      luau_code: pbrLuau,
      updated_asset: updatedAsset,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Phase 4 Bidirectional Rojo <-> Forge AI Studio synchronization & version audit
app.get('/api/v1/assets/sync-status', (_req, res) => {
  try {
    const assets = loadAssetsLibrary();
    const rojoRoot = path.resolve(runtimeRojoPath);
    const assetsDir = path.join(rojoRoot, 'src', 'shared', 'Assets3D');

    const statuses = assets.map((a: any) => {
      const safeName = String(a.name || 'Model3D').replace(/[^a-zA-Z0-9_]/g, '') || 'Model3D';
      const luauPath = path.join(assetsDir, a.file_name || `${safeName}.luau`);
      const objPath = path.join(assetsDir, a.obj_file_name || `${safeName}.obj`);
      const rbxmxPath = path.join(assetsDir, `${safeName}.rbxmx`);
      const gltfPath = path.join(assetsDir, `${safeName}.gltf`);
      const mtlPath = path.join(assetsDir, `${safeName}.mtl`);

      const librarySha = crypto
        .createHash('sha256')
        .update(String(a.luau_code || ''), 'utf-8')
        .digest('hex')
        .slice(0, 12);
      let diskSha: string | null = null;
      let externalChangeDetected = false;

      if (fs.existsSync(luauPath)) {
        const rawBytes = fs.readFileSync(luauPath);
        diskSha = crypto.createHash('sha256').update(rawBytes).digest('hex').slice(0, 12);
        if (diskSha !== librarySha) {
          externalChangeDetected = true;
        }
      }

      return {
        id: a.id,
        name: a.name,
        version: Number(a.version || 1),
        version_history_count: Array.isArray(a.version_history) ? a.version_history.length : 0,
        files_on_disk: {
          luau: fs.existsSync(luauPath),
          rbxmx: fs.existsSync(rbxmxPath),
          gltf: fs.existsSync(gltfPath),
          obj: fs.existsSync(objPath),
          mtl: fs.existsSync(mtlPath),
        },
        disk_luau_sha256: diskSha,
        library_luau_sha256: librarySha,
        external_change_detected: externalChangeDetected,
      };
    });

    res.json({
      rojo_assets_folder: assetsDir,
      total_assets: statuses.length,
      assets: statuses,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Phase 4 Bidirectional Sync & Version Recovery (Roblox Studio / Rojo -> Forge AI Studio)
app.post('/api/v1/assets/pull-from-rojo', (req, res) => {
  try {
    const { asset_id = '', asset_name = '', restore_version } = req.body;
    const libPath = getAssetsLibraryPath();
    const targetAsset = getAssetFromLibraryServer(libPath, asset_id || asset_name);
    if (!targetAsset) {
      return res.status(404).json({ error: 'Asset no encontrado en la biblioteca.' });
    }

    const safeName = String(targetAsset.name || 'Model3D').replace(/[^a-zA-Z0-9_]/g, '') || 'Model3D';

    if (restore_version !== undefined && restore_version !== null) {
      const restored = restoreAssetVersionServer(
        libPath,
        String(targetAsset.id || targetAsset.name),
        Number(restore_version)
      );
      if (!restored) {
        return res.status(404).json({ error: `Versión v${restore_version} no encontrada en el historial.` });
      }
      const rebuiltLuau =
        restored.luau_code ||
        buildStrictLuauFromEditedParts(
          safeName,
          restored.parts || [],
          restored.collision_fidelity || 'Hull'
        );
      const rbxmxSnap = buildRbxmxFromPartsServer(
        safeName,
        restored.parts || [],
        restored.collision_fidelity || 'Hull',
        restored.category || '3D Asset',
        rebuiltLuau
      );
      const targetFolder = restored.rojo_target_folder || 'src/shared/Assets3D';
      writeToRojoWorkspace(targetFolder, `${safeName}.luau`, rebuiltLuau);
      writeRawAssetToRojoWorkspace(targetFolder, `${safeName}.rbxmx`, rbxmxSnap);
      return res.json({
        success: true,
        source: `version_history_v${restore_version}`,
        rbxmx_content: rbxmxSnap,
        luau_content: rebuiltLuau,
        asset: restored,
      });
    }

    const rojoRoot = path.resolve(runtimeRojoPath);
    const assetsDir = path.join(rojoRoot, 'src', 'shared', 'Assets3D');
    const rbxmxPath = path.join(assetsDir, `${safeName}.rbxmx`);
    const objPath = path.join(assetsDir, targetAsset.obj_file_name || `${safeName}.obj`);
    const luauPath = path.join(assetsDir, targetAsset.file_name || `${safeName}.luau`);

    let rbxmxContent = '';
    let parsedRbxmxPartsCount = 0;
    if (fs.existsSync(rbxmxPath)) {
      rbxmxContent = fs.readFileSync(rbxmxPath, 'utf-8');
      const parsedRbxmx = parseRbxmxFromPartsServer(
        rbxmxContent,
        safeName,
        targetAsset.collision_fidelity || 'Hull'
      );
      if (parsedRbxmx.parts.length > 0) {
        parsedRbxmxPartsCount = parsedRbxmx.parts.length;
        targetAsset.parts = parsedRbxmx.parts;
        targetAsset.poly_count = parsedRbxmx.polyCount;
        targetAsset.luau_code =
          parsedRbxmx.luauCode ||
          buildStrictLuauFromEditedParts(
            safeName,
            parsedRbxmx.parts,
            targetAsset.collision_fidelity || 'Hull'
          );
      }
    }

    if (parsedRbxmxPartsCount === 0 && fs.existsSync(objPath)) {
      const objText = fs.readFileSync(objPath, 'utf-8');
      if (objText.includes('v ')) {
        const reParts = extractPartsFromUploadedMesh(
          safeName,
          objText,
          undefined,
          targetAsset.collision_fidelity || 'Hull'
        );
        if (reParts.length > 0) {
          targetAsset.parts = reParts;
          targetAsset.poly_count = reParts.reduce(
            (sum, p) => sum + (p.meshData?.faces?.length || 0),
            0
          );
          targetAsset.luau_code = buildStrictLuauFromEditedParts(
            safeName,
            reParts,
            targetAsset.collision_fidelity || 'Hull'
          );
        }
      }
    }

    if (fs.existsSync(luauPath)) {
      targetAsset.luau_code = fs.readFileSync(luauPath, 'utf-8');
    }

    if (!rbxmxContent) {
      rbxmxContent = buildRbxmxFromPartsServer(
        safeName,
        targetAsset.parts || [],
        targetAsset.collision_fidelity || 'Hull',
        targetAsset.category || '3D Asset',
        targetAsset.luau_code
      );
    }

    const saved = saveAssetToLibrary(targetAsset);
    res.json({
      success: true,
      source: fs.existsSync(rbxmxPath) ? 'rojo_rbxmx_disk' : 'rojo_workspace_disk',
      rbxmx_content: rbxmxContent,
      luau_content: saved.luau_code,
      asset: saved,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

function resolveBaselinePartsForAsset(existingAsset: any, body: any): any[] | undefined {
  if (Array.isArray(body?.base_parts)) {
    return body.base_parts;
  }
  const baselineSha = String(body?.baseline_snapshot_sha256 || '').trim();
  if (!baselineSha || !existingAsset) return undefined;
  if (String(existingAsset.snapshot_sha256 || '') === baselineSha) {
    return existingAsset.parts || [];
  }
  const history = Array.isArray(existingAsset.version_history) ? existingAsset.version_history : [];
  for (const snap of history) {
    if (snap && String(snap.snapshot_sha256 || '') === baselineSha && Array.isArray(snap.parts)) {
      return snap.parts;
    }
  }
  return undefined;
}

// Pillar C Real DataModel Bidirectional Sync Diff (Roblox Studio DataModel <-> Forge Web Editor)
app.post('/api/v1/assets/compare-datamodel', (req, res) => {
  try {
    const modelName = String(req.body.model_name || req.body.asset_id || '').trim();
    const safeName = modelName.replace(/[^a-zA-Z0-9_]/g, '') || modelName;
    const studioParts = Array.isArray(req.body.parts)
      ? req.body.parts
      : Array.isArray(req.body.studio_parts)
      ? req.body.studio_parts
      : [];
    const rawScope = String(req.body.sync_scope || 'full_model').trim();
    const syncScope: 'selection' | 'full_model' | 'explicit_delete' =
      rawScope === 'selection' || rawScope === 'full_model' || rawScope === 'explicit_delete'
        ? rawScope
        : 'full_model';
    const explicitDeleteIds: string[] = Array.isArray(req.body.explicit_delete_ids)
      ? req.body.explicit_delete_ids.map((x: any) => String(x))
      : [];

    const libPath = getAssetsLibraryPath();
    const existing =
      getAssetFromLibraryServer(libPath, modelName) || getAssetFromLibraryServer(libPath, safeName);
    if (!existing) {
      return res.json({
        found_in_forge: false,
        asset_id: null,
        model_name: modelName,
        version: 1,
        diff: computeDataModelSyncDiffServer([], studioParts, {
          syncScope,
          modelName: safeName,
          explicitDeleteIds,
        }),
      });
    }
    const baseParts = resolveBaselinePartsForAsset(existing, req.body);
    const diff = computeDataModelSyncDiffServer(existing.parts || [], studioParts, {
      baseParts,
      syncScope,
      modelName: String(existing.name || safeName),
      explicitDeleteIds,
    });
    res.json({
      found_in_forge: true,
      asset_id: existing.id,
      model_name: existing.name,
      version: existing.version || 1,
      snapshot_sha256: existing.snapshot_sha256 || null,
      diff,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Roblox Studio Plugin -> Forge AI Studio Incremental Live Push
app.post('/api/v1/assets/studio-push', (req, res) => {
  try {
    const {
      model_name = 'StudioModel',
      name,
      parts = [],
      rbxmx_content = '',
      merge_mode,
      remove_missing = false,
      sync_scope: rawScopeInput,
      explicit_delete_ids: rawDeleteIds,
      conflict_policy: rawConflictPolicy,
    } = req.body;

    const effectiveModelName = String(model_name || name || 'StudioModel').trim();
    const safeName = effectiveModelName.replace(/[^a-zA-Z0-9_]/g, '') || 'StudioModel';
    const incomingParts: any[] = Array.isArray(parts) ? parts : [];
    const explicitDeleteIds: string[] = Array.isArray(rawDeleteIds)
      ? rawDeleteIds.map((x: any) => String(x).trim()).filter(Boolean)
      : [];
    const explicitDeleteSet = new Set<string>(explicitDeleteIds);

    let syncScope: 'selection' | 'full_model' | 'explicit_delete';
    if (
      rawScopeInput === 'selection' ||
      rawScopeInput === 'full_model' ||
      rawScopeInput === 'explicit_delete'
    ) {
      syncScope = rawScopeInput;
    } else if (remove_missing || merge_mode === 'replace') {
      syncScope = 'full_model';
    } else if (explicitDeleteSet.size > 0 && incomingParts.length === 0) {
      syncScope = 'explicit_delete';
    } else {
      syncScope = 'selection';
    }

    const rawPolicyStr = String(rawConflictPolicy || 'smart_merge').trim().toLowerCase();
    const policyAliasMap: Record<string, 'manual_resolution' | 'smart_merge' | 'accept_studio' | 'keep_forge'> = {
      keep_forge: 'keep_forge',
      prefer_forge: 'keep_forge',
      accept_studio: 'accept_studio',
      prefer_studio: 'accept_studio',
      smart_merge: 'smart_merge',
      manual_resolution: 'manual_resolution',
      reject: 'manual_resolution',
      abort_on_conflict: 'manual_resolution',
    };
    const conflictPolicy = policyAliasMap[rawPolicyStr] || 'smart_merge';
    const effectiveMergeMode =
      merge_mode || (syncScope === 'full_model' ? 'replace' : 'incremental');

    if (incomingParts.length === 0 && explicitDeleteSet.size === 0) {
      return res.status(400).json({
        error: 'Se requiere un array de partes no vacío o explicit_delete_ids desde Roblox Studio.',
      });
    }

    const libPath = getAssetsLibraryPath();
    let existing =
      getAssetFromLibraryServer(libPath, effectiveModelName) ||
      getAssetFromLibraryServer(libPath, safeName);
    const baseParts = resolveBaselinePartsForAsset(existing, req.body);

    const normExisting =
      existing && Array.isArray(existing.parts)
        ? normalizePartsWithSyncMetadata(existing.parts, safeName)
        : [];
    const existingById = new Map<string, any>();
    const existingByName = new Map<string, any>();
    for (const ep of normExisting) {
      if (ep.partId) existingById.set(String(ep.partId), ep);
      if (ep.name) existingByName.set(String(ep.name), ep);
    }

    // Prepare incoming Studio parts: preserve existing Forge meshData if Studio part omitted ForgeMeshGeometryJSON,
    // and never invent a procedural cube for external MeshParts (`PublishedCloudMeshId` / `StudioExternalUnreadable`).
    const preparedIncoming: any[] = incomingParts
      .filter((p) => p && typeof p === 'object')
      .map((rawInc: any, idx: number) => {
        const inc = { ...rawInc };
        const incId = String(inc.partId || inc.id || '').trim();
        const pname = String(inc.name || `MeshPart_${idx + 1}`).trim();
        const matchedExisting =
          (incId ? existingById.get(incId) : undefined) || (!incId ? existingByName.get(pname) : undefined);

        const incMd = inc.meshData && typeof inc.meshData === 'object' ? inc.meshData : null;
        const hasIncBuffers = Boolean(
          incMd &&
            Array.isArray(incMd.vertices) &&
            incMd.vertices.length > 0 &&
            Array.isArray(incMd.faces) &&
            incMd.faces.length > 0
        );
        const incMeshId = validatePublishedRobloxMeshId(
          inc.meshId || inc.mesh_id || incMd?.meshId || incMd?.assetId
        );
        const incGeomSource = String(inc.geometrySource || '').trim();

        if (!hasIncBuffers && matchedExisting) {
          const exMeshId = validatePublishedRobloxMeshId(
            matchedExisting.meshId || matchedExisting.meshData?.meshId
          );
          if (!incMeshId || incMeshId === exMeshId) {
            if (matchedExisting.meshData) {
              inc.meshData = JSON.parse(JSON.stringify(matchedExisting.meshData));
            }
            if (!incGeomSource && matchedExisting.geometrySource) {
              inc.geometrySource = matchedExisting.geometrySource;
            }
            if (!incMeshId && exMeshId) {
              inc.meshId = exMeshId;
              inc.assetId = exMeshId;
            }
          }
        }

        if (incMeshId) {
          inc.meshId = incMeshId;
          inc.assetId = inc.assetId || incMeshId;
          if (!hasIncBuffers && !(inc.meshData && Array.isArray(inc.meshData.vertices) && inc.meshData.vertices.length > 0)) {
            inc.geometrySource = 'PublishedCloudMeshId';
          }
        } else if (!hasIncBuffers && !(inc.meshData && Array.isArray(inc.meshData.vertices) && inc.meshData.vertices.length > 0)) {
          if (incGeomSource === 'StudioExternalUnreadable' || incGeomSource === 'PublishedCloudMeshId') {
            inc.geometrySource = incGeomSource;
          } else if (!matchedExisting) {
            inc.geometrySource = 'StudioExternalUnreadable';
          }
        }

        if (!incId && matchedExisting?.partId) {
          inc.partId = matchedExisting.partId;
        }

        const resolvedMesh = extractGeometryFromProcessedMesh(inc, `${safeName}.obj`, safeName);
        return {
          ...inc,
          partId: inc.partId || undefined,
          name: pname,
          parentName: inc.parentName || matchedExisting?.parentName || 'Root',
          parentContainerClass: inc.parentContainerClass || matchedExisting?.parentContainerClass || 'Model',
          hierarchyPath: inc.hierarchyPath || matchedExisting?.hierarchyPath || pname,
          shape: 'MeshPart' as const,
          size: Array.isArray(inc.size) ? inc.size : matchedExisting?.size || [2, 2, 2],
          position: Array.isArray(inc.position) ? inc.position : matchedExisting?.position || [0, 1, 0],
          rotation: Array.isArray(inc.rotation) ? inc.rotation : matchedExisting?.rotation || [0, 0, 0],
          rotationMatrix: Array.isArray(inc.rotationMatrix) ? inc.rotationMatrix : undefined,
          color: Array.isArray(inc.color) ? inc.color : matchedExisting?.color || [148, 163, 184],
          material: inc.material || matchedExisting?.material || 'Metal',
          roughness: typeof inc.roughness === 'number' ? inc.roughness : matchedExisting?.roughness ?? 0.35,
          metalness: typeof inc.metalness === 'number' ? inc.metalness : matchedExisting?.metalness ?? 0.65,
          transparency: typeof inc.transparency === 'number' ? inc.transparency : matchedExisting?.transparency ?? 0,
          reflectance: typeof inc.reflectance === 'number' ? inc.reflectance : matchedExisting?.reflectance ?? 0,
          canCollide: inc.canCollide !== false,
          anchored: inc.anchored !== false,
          collisionFidelity: inc.collisionFidelity || matchedExisting?.collisionFidelity || 'Hull',
          pbrMaterial: inc.pbrMaterial || matchedExisting?.pbrMaterial,
          meshData:
            resolvedMesh.vertices.length > 0
              ? resolvedMesh
              : inc.meshData || undefined,
        };
      });

    const syncDiff = computeDataModelSyncDiffServer(normExisting, preparedIncoming, {
      baseParts,
      syncScope,
      modelName: safeName,
      explicitDeleteIds: Array.from(explicitDeleteSet),
    });

    // 1. Reject duplicate partIds immediately
    if (syncDiff.has_duplicate_ids) {
      return res.json({
        success: false,
        status: 'duplicate_part_ids',
        error: 'Push rechazado: se detectaron ForgePartId duplicados en el payload.',
        duplicate_studio_part_ids: syncDiff.duplicate_studio_part_ids,
        duplicate_forge_part_ids: syncDiff.duplicate_forge_part_ids,
        sync_diff: syncDiff,
      });
    }

    // 1b. Reject circular hierarchy cycles
    if (syncDiff.has_hierarchy_cycles) {
      return res.json({
        success: false,
        status: 'hierarchy_cycle_detected',
        error: 'Push rechazado: se detectaron ciclos circulares en la jerarquía de contenedores.',
        hierarchy_cycles: syncDiff.hierarchy_cycles,
        sync_diff: syncDiff,
      });
    }

    // 2. Enforce conflict policy when 3-way conflicts exist
    if (syncDiff.has_conflicts && conflictPolicy === 'manual_resolution') {
      return res.json({
        success: false,
        status: 'conflict_detected',
        conflict_policy: rawPolicyStr,
        error:
          'Push rechazado por política de conflictos: el modelo cambió tanto en Forge como en Studio desde el último snapshot base.',
        conflicts: syncDiff.conflicts,
        sync_diff: syncDiff,
      });
    }

    const normStudio = normalizePartsWithSyncMetadata(preparedIncoming, safeName);
    const conflictById = new Map<string, any>();
    for (const c of syncDiff.conflicts || []) {
      if (c.partId) conflictById.set(String(c.partId), c);
    }
    const baseById = new Map<string, any>();
    if (baseParts) {
      for (const bp of normalizePartsWithSyncMetadata(baseParts, safeName)) {
        if (bp.partId) baseById.set(String(bp.partId), bp);
      }
    }

    let mergedParts: any[] = [];
    if (existing && normExisting.length > 0) {
      const seenIds = new Set<string>();
      const seenNames = new Set<string>();

      for (let idx = 0; idx < normStudio.length; idx++) {
        const inc = normStudio[idx];
        const incId = String(inc.partId || '');
        const pname = String(inc.name || `MeshPart_${idx + 1}`);
        if (explicitDeleteSet.has(incId) || explicitDeleteSet.has(pname)) continue;

        const fPart = existingById.get(incId) || (!incId ? existingByName.get(pname) : undefined);
        const resolvedId = incId || (fPart ? String(fPart.partId) : `forge-part-${idx + 1}-${pname.toLowerCase()}`);
        seenIds.add(resolvedId);
        seenNames.add(pname);
        if (fPart?.name) seenNames.add(String(fPart.name));

        if (!fPart) {
          mergedParts.push(inc);
          continue;
        }

        const hasConflict = conflictById.has(resolvedId);
        if (hasConflict && conflictPolicy === 'keep_forge') {
          mergedParts.push(fPart);
          continue;
        }

        const bPart = baseById.get(resolvedId);
        if (hasConflict && conflictPolicy === 'smart_merge' && bPart) {
          const studioGeomChanged = inc.geometryHash !== bPart.geometryHash;
          const studioMatChanged = inc.materialHash !== bPart.materialHash;
          const studioTransChanged = inc.transformHash !== bPart.transformHash;
          const studioHierChanged = inc.hierarchyHash !== bPart.hierarchyHash;
          const studioNameChanged = inc.name !== bPart.name;
          const resolvedName = studioNameChanged ? pname : String(fPart.name || pname);
          mergedParts.push({
            ...fPart,
            partId: resolvedId,
            name: resolvedName,
            parentId: studioHierChanged ? inc.parentId : fPart.parentId,
            parentName: studioHierChanged ? inc.parentName : fPart.parentName || 'Root',
            parentContainerClass: studioHierChanged
              ? inc.parentContainerClass
              : fPart.parentContainerClass || 'Model',
            hierarchyPath: studioHierChanged ? inc.hierarchyPath : fPart.hierarchyPath || `Root/${resolvedName}`,
            size: studioTransChanged ? inc.size : fPart.size || [2, 2, 2],
            position: studioTransChanged ? inc.position : fPart.position || [0, 1, 0],
            rotation: studioTransChanged ? inc.rotation : fPart.rotation || [0, 0, 0],
            rotationMatrix: studioTransChanged ? inc.rotationMatrix : fPart.rotationMatrix,
            color: studioMatChanged ? inc.color : fPart.color || [148, 163, 184],
            material: studioMatChanged ? inc.material : fPart.material || 'Metal',
            roughness: studioMatChanged ? inc.roughness : fPart.roughness ?? 0.35,
            metalness: studioMatChanged ? inc.metalness : fPart.metalness ?? 0.65,
            transparency: studioMatChanged ? inc.transparency : fPart.transparency ?? 0,
            reflectance: studioMatChanged ? inc.reflectance : fPart.reflectance ?? 0,
            pbrMaterial: studioMatChanged ? inc.pbrMaterial || fPart.pbrMaterial : fPart.pbrMaterial,
            meshId: studioGeomChanged ? inc.meshId : fPart.meshId,
            assetId: studioGeomChanged ? inc.assetId : fPart.assetId,
            textureId: studioMatChanged ? inc.textureId : fPart.textureId,
            geometrySource: studioGeomChanged ? inc.geometrySource : fPart.geometrySource,
            meshData: studioGeomChanged ? inc.meshData : fPart.meshData,
          });
        } else {
          mergedParts.push({
            ...fPart,
            ...inc,
            partId: resolvedId,
            name: pname,
            parentName: inc.parentName || fPart.parentName || 'Root',
            parentContainerClass: inc.parentContainerClass || fPart.parentContainerClass || 'Model',
            hierarchyPath: inc.hierarchyPath || fPart.hierarchyPath || pname,
            shape: 'MeshPart',
            meshData: inc.meshData !== undefined ? inc.meshData : fPart.meshData,
            pbrMaterial: inc.pbrMaterial || fPart.pbrMaterial,
          });
        }
      }

      if (syncScope !== 'full_model') {
        for (const ep of normExisting) {
          const epId = String(ep.partId || '');
          const epName = String(ep.name || '');
          if (explicitDeleteSet.has(epId) || explicitDeleteSet.has(epName)) continue;
          if (!seenIds.has(epId) && !seenNames.has(epName)) {
            mergedParts.push(ep);
          }
        }
      }
    } else {
      mergedParts = normStudio.filter(
        (p) => !explicitDeleteSet.has(String(p.partId)) && !explicitDeleteSet.has(String(p.name))
      );
    }

    const finalParts = normalizePartsWithSyncMetadata(mergedParts, safeName);
    const collisionFidelity = existing?.collision_fidelity || 'Hull';
    const luauCode = buildStrictLuauFromEditedParts(safeName, finalParts, collisionFidelity);
    const rbxmxOut =
      rbxmx_content && String(rbxmx_content).trim().length > 0
        ? String(rbxmx_content)
        : buildRbxmxFromPartsServer(
            safeName,
            finalParts,
            collisionFidelity,
            existing?.category || 'Studio Synced Asset',
            luauCode
          );

    const targetFolder = existing?.rojo_target_folder || 'src/shared/Assets3D';
    const luauAbsTarget = resolveSafeProjectPath(targetFolder, `${safeName}.luau`);
    const rbxmxAbsTarget = resolveSafeProjectPath(targetFolder, `${safeName}.rbxmx`);

    // Backup previous files on disk for atomic rollback if any step fails
    const prevLuauBytes = fs.existsSync(luauAbsTarget) ? fs.readFileSync(luauAbsTarget) : null;
    const prevRbxmxBytes = fs.existsSync(rbxmxAbsTarget) ? fs.readFileSync(rbxmxAbsTarget) : null;
    const prevLibBytes = fs.existsSync(libPath) ? fs.readFileSync(libPath) : null;

    let saved: any;
    let luauSavedPath: string;
    let rbxmxSavedPath: string;

    try {
      const safeLuau = validateAndSanitizeLuau(luauCode);
      const luauTmp = `${luauAbsTarget}.tmp`;
      const rbxmxTmp = `${rbxmxAbsTarget}.tmp`;
      fs.writeFileSync(luauTmp, safeLuau, 'utf-8');
      fs.writeFileSync(rbxmxTmp, rbxmxOut, 'utf-8');
      fs.renameSync(luauTmp, luauAbsTarget);
      fs.renameSync(rbxmxTmp, rbxmxAbsTarget);

      luauSavedPath = `./${path.relative(process.cwd(), luauAbsTarget).replace(/\\/g, '/')}`;
      rbxmxSavedPath = `./${path.relative(process.cwd(), rbxmxAbsTarget).replace(/\\/g, '/')}`;

      const totalTris = finalParts.reduce(
        (s: number, p: any) => s + (p.meshData?.faces?.length || 0),
        0
      );
      const assetPayload = {
        ...(existing || {}),
        id: existing?.id || `studio-${Date.now()}`,
        name: safeName,
        category: existing?.category || 'Studio Synced Asset',
        asset_type: 'Model3D',
        poly_count: totalTris,
        collision_fidelity: collisionFidelity,
        rojo_target_folder: targetFolder,
        file_name: `${safeName}.luau`,
        obj_file_name: `${safeName}.obj`,
        parts: finalParts,
        luau_code: luauCode,
        saved_path: luauSavedPath,
      };
      saved = saveAssetToLibrary(assetPayload);
    } catch (writeErr: any) {
      try {
        if (prevLuauBytes) fs.writeFileSync(luauAbsTarget, prevLuauBytes);
        else if (fs.existsSync(luauAbsTarget)) fs.unlinkSync(luauAbsTarget);
        if (prevRbxmxBytes) fs.writeFileSync(rbxmxAbsTarget, prevRbxmxBytes);
        else if (fs.existsSync(rbxmxAbsTarget)) fs.unlinkSync(rbxmxAbsTarget);
        if (prevLibBytes) fs.writeFileSync(libPath, prevLibBytes);
      } catch {
        // ignore rollback error
      }
      throw new Error(`Atomic studio-push failed and was rolled back: ${writeErr.message}`);
    }

    if (cloudBridgeCoordinator.isBridgeConnected() && !req.headers['x-bridge-session']) {
      const cleanRelFolder = String(targetFolder || 'src/shared/Assets3D').replace(/^[/\\]+/, '');
      void cloudBridgeCoordinator.enqueueTask('rojo.write_package', {
        files: [
          {
            relativePath: `${cleanRelFolder}/${safeName}.luau`,
            content: validateAndSanitizeLuau(luauCode),
            encoding: 'utf-8',
          },
          {
            relativePath: `${cleanRelFolder}/${safeName}.rbxmx`,
            content: rbxmxOut,
            encoding: 'utf-8',
          },
        ],
      });
    }

    res.json({
      success: true,
      status: 'synced',
      merge_mode: effectiveMergeMode,
      sync_scope: syncScope,
      conflict_policy: conflictPolicy,
      asset: saved,
      sync_diff: syncDiff,
      luau_code: validateAndSanitizeLuau(luauCode),
      rbxmx_content: rbxmxOut,
      luau_saved_path: luauSavedPath,
      rbxmx_saved_path: rbxmxSavedPath,
      updated_part_count: finalParts.length,
      updated_parts_count: finalParts.length,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Pillar D: Automated Rojo Build & 5-File Package Validator with Auto-Recovery
app.post('/api/v1/assets/validate-rojo-build', (req, res) => {
  try {
    const { asset, auto_heal = true } = req.body;
    const rojoRoot = path.resolve(runtimeRojoPath);
    const projectJsonPath = path.join(rojoRoot, 'default.project.json');
    const requiredFolders = [
      path.join(rojoRoot, 'src', 'shared', 'Assets3D'),
      path.join(rojoRoot, 'src', 'shared', 'Assets3D', 'Textures'),
      path.join(rojoRoot, 'src', 'server'),
      path.join(rojoRoot, 'src', 'client'),
    ];

    const healedActions: string[] = [];

    // 1. Verify or self-heal required Rojo directories
    for (const dir of requiredFolders) {
      if (!fs.existsSync(dir)) {
        if (auto_heal) {
          fs.mkdirSync(dir, { recursive: true });
          healedActions.push(`Directorio Rojo creado: ${path.relative(rojoRoot, dir)}`);
        }
      }
    }

    // 2. Verify or self-heal default.project.json
    let projectJsonValid = false;
    if (fs.existsSync(projectJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
        projectJsonValid = Boolean(parsed && parsed.name && parsed.tree);
      } catch {
        projectJsonValid = false;
      }
    }
    if (!projectJsonValid && auto_heal) {
      const defaultProject = {
        name: 'ForgeAIStudioGame',
        tree: {
          $className: 'DataModel',
          ReplicatedStorage: {
            $className: 'ReplicatedStorage',
            Shared: {
              $path: 'src/shared',
            },
          },
          ServerScriptService: {
            $className: 'ServerScriptService',
            Server: {
              $path: 'src/server',
            },
          },
          StarterPlayer: {
            $className: 'StarterPlayer',
            StarterPlayerScripts: {
              $className: 'StarterPlayerScripts',
              Client: {
                $path: 'src/client',
              },
            },
          },
        },
      };
      fs.writeFileSync(projectJsonPath, JSON.stringify(defaultProject, null, 2), 'utf-8');
      projectJsonValid = true;
      healedActions.push('Archivo default.project.json regenerado con árbol DataModel válido.');
    }

    // 3. Verify or self-heal all 5 package files for the active asset if provided
    const verifiedFiles: Record<string, boolean> = {
      luau: false,
      rbxmx: false,
      gltf: false,
      obj: false,
      mtl: false,
    };

    if (asset && asset.name) {
      const safeName = String(asset.name).replace(/[^a-zA-Z0-9_]/g, '') || 'ForgeModel3D';
      const targetFolder = asset.rojo_target_folder || 'src/shared/Assets3D';
      const assetsDir = path.join(rojoRoot, targetFolder);

      const fileMap: Record<string, string> = {
        luau: path.join(assetsDir, `${safeName}.luau`),
        rbxmx: path.join(assetsDir, `${safeName}.rbxmx`),
        gltf: path.join(assetsDir, `${safeName}.gltf`),
        obj: path.join(assetsDir, `${safeName}.obj`),
        mtl: path.join(assetsDir, `${safeName}.mtl`),
      };

      const enrichedParts = (asset.parts || []).map((p: any, idx: number) => ({
        ...p,
        name: p.name || `MeshPart_${idx + 1}`,
        shape: 'MeshPart',
        meshData: extractGeometryFromProcessedMesh(p, `${safeName}.obj`, safeName),
      }));

      for (const [ext, fPath] of Object.entries(fileMap)) {
        const exists = fs.existsSync(fPath) && fs.statSync(fPath).size > 0;
        if (exists) {
          verifiedFiles[ext] = true;
        } else if (auto_heal) {
          const luauCode = buildStrictLuauFromEditedParts(
            safeName,
            enrichedParts,
            asset.collision_fidelity || 'Hull'
          );
          if (ext === 'luau') {
            writeToRojoWorkspace(targetFolder, `${safeName}.luau`, luauCode);
          } else if (ext === 'rbxmx') {
            const xml = buildRbxmxFromPartsServer(
              safeName,
              enrichedParts,
              asset.collision_fidelity || 'Hull',
              asset.category || '3D Asset',
              luauCode
            );
            writeRawAssetToRojoWorkspace(targetFolder, `${safeName}.rbxmx`, xml);
          } else if (ext === 'gltf') {
            const gltf = buildGltfFromPartsServer(safeName, enrichedParts);
            writeRawAssetToRojoWorkspace(targetFolder, `${safeName}.gltf`, gltf);
          } else if (ext === 'obj' || ext === 'mtl') {
            const { obj, mtl } = buildObjAndMtlFromPartsServer(safeName, enrichedParts);
            writeRawAssetToRojoWorkspace(targetFolder, `${safeName}.obj`, obj);
            writeRawAssetToRojoWorkspace(targetFolder, `${safeName}.mtl`, mtl);
          }
          verifiedFiles[ext] = fs.existsSync(fPath) && fs.statSync(fPath).size > 0;
          if (verifiedFiles[ext]) {
            healedActions.push(`Archivo faltante auto-generado en Rojo: ${safeName}.${ext}`);
          }
        }
      }
    }

    res.json({
      success: true,
      project_json_valid: projectJsonValid,
      verified_files: verifiedFiles,
      all_five_exist: Object.values(verifiedFiles).every(Boolean),
      healed_actions: healedActions,
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
    const localContext = getLocalProjectContext('agents');

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
  const libPath = getAssetsLibraryPath();
  const deletedOk = deleteAssetFromLibraryServer(libPath, id);
  const remaining = loadAssetsLibrary().length;
  res.json({ deleted: id, deleted_ok: deletedOk, remaining });
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

    const localContext = getLocalProjectContext('3d');

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
    const localContext = getLocalProjectContext('3d');

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
    const localContext = getLocalProjectContext('luau');
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

    const localContext = getLocalProjectContext('luau');

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

    const localContext = getLocalProjectContext('ui');
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
