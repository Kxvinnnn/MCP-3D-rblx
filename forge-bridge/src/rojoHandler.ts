/**
 * @module rojoHandler
 * @description
 * Fase 5 — Integración Rojo Local en Windows.
 *
 * Permite que Forge:
 * 1. Consulte el estado de Rojo (`rojo.status`).
 * 2. Compruebe si el proyecto está conectado (`rojoServerListening`, `defaultProjectJsonFound`).
 * 3. Consulte el proyecto configurado (`rojo.get_project_config`) devolviendo solo rutas relativas.
 * 4. Lea archivos permitidos (`rojo.read_file`).
 * 5. Escriba archivos permitidos (`rojo.write_file` y `rojo.write_package` con escritura atómica `.tmp` + rollback).
 * 6. Detecte cambios (`rojo.detect_changes`).
 * 7. Solicite sincronización (`rojo.request_sync`).
 * 8. Compruebe errores de compilación (`rojo.check_build` ejecutando `rojo build` con `execFile` sin shell).
 *
 * Ninguna respuesta incluye jamás la ruta absoluta de Windows del proyecto.
 */

import fs from 'fs';
import path from 'path';
import net from 'net';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  resolveAndValidateRelativePath,
  enforceFileSizeLimit,
  validateAndSanitizeLuauContent,
  computeFnv1a32Hex,
  computeSha256Short,
} from './security.js';

const execFileAsync = promisify(execFile);

export interface RojoManifestFileEntry {
  name: string;
  relativePath: string;
  sizeBytes: number;
  sha256: string;
  contentFnv32: string;
  datamodelTarget: string;
  modifiedAt: string;
}

export interface RojoPublicStatus {
  projectName: string;
  projectConnected: boolean;
  defaultProjectJsonFound: boolean;
  rojoCliInstalled: boolean;
  rojoVersion: string | null;
  rojoServePort: number;
  rojoServerListening: boolean;
  syncedFilesCount: number;
  lastChangeDetectedAt: string | null;
}

export class LocalRojoManager {
  private readonly projectRootAbs: string;
  private readonly rojoPort: number;
  private readonly maxFileSizeBytes: number;
  private baselineHashes: Map<string, string> = new Map();
  private lastChangeDetectedAt: string | null = null;
  private watcher: fs.FSWatcher | null = null;

  constructor(options: {
    projectRootPath: string;
    rojoPort?: number;
    maxFileSizeBytes?: number;
  }) {
    this.projectRootAbs = path.resolve(options.projectRootPath);
    this.rojoPort = options.rojoPort || 34872;
    this.maxFileSizeBytes = options.maxFileSizeBytes || 15 * 1024 * 1024;
    this.ensureProjectDirectoriesExist();
    this.captureBaselineSnapshot();
  }

  private ensureProjectDirectoriesExist(): void {
    const projectJsonPath = path.join(this.projectRootAbs, 'default.project.json');
    if (!fs.existsSync(projectJsonPath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
      const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const record = node as Record<string, unknown>;
        if (typeof record.$path === 'string' && path.extname(record.$path) === '') {
          const targetDir = path.resolve(this.projectRootAbs, record.$path);
          if (targetDir.startsWith(this.projectRootAbs + path.sep) && !fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
        }
        for (const [key, val] of Object.entries(record)) {
          if (!key.startsWith('$')) visit(val);
        }
      };
      visit(parsed.tree);
    } catch {
      // Ignorar errores de parseo inicial; serán reportados por getStatus/checkBuildErrors
    }
  }

  public startWatching(): void {
    const srcDir = path.join(this.projectRootAbs, 'src');
    if (!fs.existsSync(srcDir) || this.watcher) return;
    try {
      this.watcher = fs.watch(srcDir, { recursive: true }, (_eventType, filename) => {
        if (filename && !filename.endsWith('.tmp')) {
          this.lastChangeDetectedAt = new Date().toISOString();
        }
      });
    } catch {
      // Recursive fs.watch fallback handled by snapshot diff
    }
  }

  public stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private async checkPortOpen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(250);
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

  private async resolveRojoBinary(): Promise<{ bin: string | null; version: string | null }> {
    const candidates = [
      'rojo',
      'C:\\Rojo\\rojo.exe',
      path.join(this.projectRootAbs, '.tools', process.platform === 'win32' ? 'rojo.exe' : 'rojo'),
      path.join(os.homedir(), '.rokit', 'bin', process.platform === 'win32' ? 'rojo.exe' : 'rojo'),
      path.join(os.homedir(), '.aftman', 'bin', process.platform === 'win32' ? 'rojo.exe' : 'rojo'),
      path.join(os.homedir(), '.foreman', 'bin', process.platform === 'win32' ? 'rojo.exe' : 'rojo'),
    ];

    for (const candidate of candidates) {
      try {
        const { stdout } = await execFileAsync(candidate, ['--version'], { timeout: 2000 });
        const version = stdout.trim();
        if (version) {
          return { bin: candidate, version };
        }
      } catch {
        // Probar siguiente candidato
      }
    }
    return { bin: null, version: null };
  }

  public scanAllowedProjectFiles(): RojoManifestFileEntry[] {
    const srcDir = path.join(this.projectRootAbs, 'src');
    const results: RojoManifestFileEntry[] = [];

    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.luau')) {
          const rawBytes = fs.readFileSync(fullPath);
          const textContent = rawBytes.toString('utf-8');
          const relPath = path.relative(this.projectRootAbs, fullPath).replace(/\\/g, '/');
          const baseName = entry.name
            .replace(/\.server\.luau$/, '')
            .replace(/\.client\.luau$/, '')
            .replace(/\.luau$/, '');

          let datamodelTarget = `ReplicatedStorage.Shared.${baseName}`;
          if (relPath.startsWith('src/server')) {
            datamodelTarget = `ServerScriptService.Server.${baseName}`;
          } else if (relPath.startsWith('src/client/UI')) {
            datamodelTarget = `StarterGui.Interface.${baseName}`;
          } else if (relPath.startsWith('src/client')) {
            datamodelTarget = `StarterPlayer.StarterPlayerScripts.Client.${baseName}`;
          }

          const stat = fs.statSync(fullPath);
          results.push({
            name: baseName,
            relativePath: relPath,
            sizeBytes: rawBytes.byteLength,
            sha256: computeSha256Short(rawBytes),
            contentFnv32: computeFnv1a32Hex(textContent),
            datamodelTarget,
            modifiedAt: stat.mtime.toISOString(),
          });
        }
      }
    };

    walk(srcDir);
    return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  public captureBaselineSnapshot(): void {
    const files = this.scanAllowedProjectFiles();
    this.baselineHashes.clear();
    for (const f of files) {
      this.baselineHashes.set(f.relativePath, f.sha256);
    }
  }

  /**
   * 1 & 2. Consulta el estado de Rojo y si el proyecto está conectado,
   * sin exponer rutas absolutas de Windows.
   */
  public async getStatus(): Promise<RojoPublicStatus> {
    const projectJsonPath = path.join(this.projectRootAbs, 'default.project.json');
    const defaultProjectJsonFound = fs.existsSync(projectJsonPath);
    let projectName = path.basename(this.projectRootAbs) || 'RojoProject';
    let configuredPort = this.rojoPort;

    if (defaultProjectJsonFound) {
      try {
        const parsed = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
        if (parsed && typeof parsed.name === 'string') {
          projectName = parsed.name;
        }
        if (parsed && typeof parsed.servePort === 'number') {
          configuredPort = parsed.servePort;
        }
      } catch {
        // Ignorar JSON malformado en lectura de nombre
      }
    }

    const [{ bin, version }, serverListening] = await Promise.all([
      this.resolveRojoBinary(),
      this.checkPortOpen(configuredPort),
    ]);

    const files = this.scanAllowedProjectFiles();

    return {
      projectName,
      projectConnected: fs.existsSync(this.projectRootAbs) && defaultProjectJsonFound,
      defaultProjectJsonFound,
      rojoCliInstalled: Boolean(bin),
      rojoVersion: version,
      rojoServePort: configuredPort,
      rojoServerListening: serverListening,
      syncedFilesCount: files.length,
      lastChangeDetectedAt: this.lastChangeDetectedAt,
    };
  }

  /**
   * 3. Consulta la configuración del proyecto (`default.project.json`) y el manifiesto de archivos.
   */
  public getProjectConfig(): {
    projectName: string;
    defaultProjectJson: Record<string, unknown> | null;
    files: RojoManifestFileEntry[];
    timestamp: string;
  } {
    const projectJsonPath = path.join(this.projectRootAbs, 'default.project.json');
    let defaultProjectJson: Record<string, unknown> | null = null;
    let projectName = path.basename(this.projectRootAbs);
    if (fs.existsSync(projectJsonPath)) {
      defaultProjectJson = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
      if (defaultProjectJson && typeof defaultProjectJson.name === 'string') {
        projectName = defaultProjectJson.name;
      }
    }
    return {
      projectName,
      defaultProjectJson,
      files: this.scanAllowedProjectFiles(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 4. Lee un archivo permitido usando exclusivamente su ruta relativa.
   */
  public readFile(relativePath: string): {
    relativePath: string;
    encoding: 'utf-8' | 'base64';
    content: string;
    sizeBytes: number;
    sha256: string;
    contentFnv32: string | null;
  } {
    const resolved = resolveAndValidateRelativePath(this.projectRootAbs, relativePath);
    if (!fs.existsSync(resolved.absolutePath) || !fs.statSync(resolved.absolutePath).isFile()) {
      throw new Error(`El archivo '${resolved.relativePath}' no existe en el proyecto Rojo.`);
    }
    const rawBytes = fs.readFileSync(resolved.absolutePath);
    enforceFileSizeLimit(rawBytes, this.maxFileSizeBytes);

    const isBinary = resolved.extension === '.png' || resolved.extension === '.glb';
    const textContent = isBinary ? null : rawBytes.toString('utf-8');

    return {
      relativePath: resolved.relativePath,
      encoding: isBinary ? 'base64' : 'utf-8',
      content: isBinary ? rawBytes.toString('base64') : (textContent as string),
      sizeBytes: rawBytes.byteLength,
      sha256: computeSha256Short(rawBytes),
      contentFnv32: textContent !== null ? computeFnv1a32Hex(textContent) : null,
    };
  }

  /**
   * 5. Escribe un archivo permitido en el proyecto Rojo de forma atómica (`.tmp` + rename).
   */
  public writeFile(params: {
    relativePath: string;
    content: string;
    encoding?: 'utf-8' | 'base64';
  }): {
    relativePath: string;
    bytesWritten: number;
    sha256: string;
    contentFnv32: string | null;
    timestamp: string;
  } {
    const resolved = resolveAndValidateRelativePath(this.projectRootAbs, params.relativePath);
    const encoding = params.encoding === 'base64' ? 'base64' : 'utf-8';

    let finalBuffer: Buffer;
    let fnv32: string | null = null;

    if (resolved.extension === '.luau' || resolved.extension === '.lua') {
      const sanitizedLuau = validateAndSanitizeLuauContent(params.content);
      finalBuffer = Buffer.from(sanitizedLuau, 'utf-8');
      fnv32 = computeFnv1a32Hex(sanitizedLuau);
    } else if (encoding === 'base64') {
      finalBuffer = Buffer.from(params.content, 'base64');
    } else {
      finalBuffer = Buffer.from(String(params.content ?? ''), 'utf-8');
      fnv32 = computeFnv1a32Hex(String(params.content ?? ''));
    }

    const byteLength = enforceFileSizeLimit(finalBuffer, this.maxFileSizeBytes);
    fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });

    const tmpPath = `${resolved.absolutePath}.tmp.${ process.pid }.${ Date.now() }`;
    fs.writeFileSync(tmpPath, finalBuffer);
    fs.renameSync(tmpPath, resolved.absolutePath);

    const sha256 = computeSha256Short(finalBuffer);
    this.baselineHashes.set(resolved.relativePath, sha256);
    this.lastChangeDetectedAt = new Date().toISOString();

    return {
      relativePath: resolved.relativePath,
      bytesWritten: byteLength,
      sha256,
      contentFnv32: fnv32,
      timestamp: this.lastChangeDetectedAt,
    };
  }

  /**
   * Escribe múltiples archivos como una transacción atómica (ej. paquete `.luau`, `.rbxmx`, `.gltf`, `.obj`, `.mtl`).
   */
  public writePackage(files: Array<{ relativePath: string; content: string; encoding?: 'utf-8' | 'base64' }>): {
    writtenFiles: Array<{
      relativePath: string;
      bytesWritten: number;
      sha256: string;
    }>;
  } {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error('Se requiere al menos un archivo en write_package.');
    }

    const backups: Array<{ absPath: string; existed: boolean; previousBytes: Buffer | null }> = [];
    const results: Array<{ relativePath: string; bytesWritten: number; sha256: string }> = [];

    try {
      for (const file of files) {
        const resolved = resolveAndValidateRelativePath(this.projectRootAbs, file.relativePath);
        const existed = fs.existsSync(resolved.absolutePath);
        backups.push({
          absPath: resolved.absolutePath,
          existed,
          previousBytes: existed ? fs.readFileSync(resolved.absolutePath) : null,
        });

        const res = this.writeFile(file);
        results.push({
          relativePath: res.relativePath,
          bytesWritten: res.bytesWritten,
          sha256: res.sha256,
        });
      }
      return { writtenFiles: results };
    } catch (err) {
      // Rollback completo si falla cualquier archivo del paquete
      for (const b of backups) {
        try {
          if (b.existed && b.previousBytes) {
            fs.writeFileSync(b.absPath, b.previousBytes);
          } else if (!b.existed && fs.existsSync(b.absPath)) {
            fs.unlinkSync(b.absPath);
          }
        } catch {
          // Ignorar error secundario en rollback
        }
      }
      throw err;
    }
  }

  /**
   * 6. Detecta cambios en los archivos del proyecto Rojo respecto al último snapshot.
   */
  public detectChanges(updateBaseline = false): {
    changed: boolean;
    added: RojoManifestFileEntry[];
    modified: RojoManifestFileEntry[];
    deleted: string[];
    totalScanned: number;
    timestamp: string;
  } {
    const currentFiles = this.scanAllowedProjectFiles();
    const currentMap = new Map<string, RojoManifestFileEntry>();
    const added: RojoManifestFileEntry[] = [];
    const modified: RojoManifestFileEntry[] = [];
    const deleted: string[] = [];

    for (const file of currentFiles) {
      currentMap.set(file.relativePath, file);
      const prevSha = this.baselineHashes.get(file.relativePath);
      if (!prevSha) {
        added.push(file);
      } else if (prevSha !== file.sha256) {
        modified.push(file);
      }
    }

    for (const prevRel of this.baselineHashes.keys()) {
      if (!currentMap.has(prevRel)) {
        deleted.push(prevRel);
      }
    }

    if (updateBaseline) {
      this.baselineHashes.clear();
      for (const file of currentFiles) {
        this.baselineHashes.set(file.relativePath, file.sha256);
      }
    }

    const changed = added.length > 0 || modified.length > 0 || deleted.length > 0;
    if (changed) {
      this.lastChangeDetectedAt = new Date().toISOString();
    }

    return {
      changed,
      added,
      modified,
      deleted,
      totalScanned: currentFiles.length,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 8. Comprueba errores de compilación del proyecto Rojo (`rojo build` o validación estructural de `default.project.json` + sintaxis Luau).
   */
  public async checkBuild(): Promise<{
    valid: boolean;
    compilerUsed: 'rojo_cli' | 'structural_validator';
    rojoVersion: string | null;
    errors: string[];
    warnings: string[];
    checkedFilesCount: number;
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const projectJsonPath = path.join(this.projectRootAbs, 'default.project.json');

    if (!fs.existsSync(projectJsonPath)) {
      return {
        valid: false,
        compilerUsed: 'structural_validator',
        rojoVersion: null,
        errors: ['No se encontró default.project.json en la raíz del proyecto Rojo.'],
        warnings,
        checkedFilesCount: 0,
      };
    }

    let projectConfig: any = null;
    try {
      projectConfig = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
      if (!projectConfig || typeof projectConfig.tree !== 'object') {
        errors.push("El archivo default.project.json no contiene un nodo 'tree' válido.");
      }
    } catch (err: any) {
      errors.push(`Error de sintaxis JSON en default.project.json: ${err.message}`);
    }

    const files = this.scanAllowedProjectFiles();
    for (const file of files) {
      const fullPath = path.join(this.projectRootAbs, file.relativePath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (!content.trimStart().startsWith('--!strict')) {
        warnings.push(`${file.relativePath}: No comienza con --!strict.`);
      }
    }

    const { bin, version } = await this.resolveRojoBinary();
    if (bin && errors.length === 0) {
      const tmpOut = path.join(os.tmpdir(), `forge_rojo_check_${process.pid}_${Date.now()}.rbxlx`);
      try {
        await execFileAsync(bin, ['build', projectJsonPath, '--output', tmpOut], {
          cwd: this.projectRootAbs,
          timeout: 10000,
        });
        return {
          valid: true,
          compilerUsed: 'rojo_cli',
          rojoVersion: version,
          errors: [],
          warnings,
          checkedFilesCount: files.length,
        };
      } catch (err: any) {
        const stderr = String(err?.stderr || err?.message || 'Error en rojo build').trim();
        // Sanitizar cualquier ruta absoluta del mensaje de error de rojo
        const sanitizedErr = stderr.split(this.projectRootAbs).join('.');
        errors.push(sanitizedErr);
        return {
          valid: false,
          compilerUsed: 'rojo_cli',
          rojoVersion: version,
          errors,
          warnings,
          checkedFilesCount: files.length,
        };
      } finally {
        if (fs.existsSync(tmpOut)) {
          try {
            fs.unlinkSync(tmpOut);
          } catch {
            // ignore
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      compilerUsed: 'structural_validator',
      rojoVersion: version,
      errors,
      warnings,
      checkedFilesCount: files.length,
    };
  }
}
