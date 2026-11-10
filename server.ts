import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '20mb' }));

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

// Read local project context if exists
function getLocalProjectContext(): string {
  const contextPaths = [
    path.resolve(process.cwd(), 'backend', 'project_context.md'),
    path.resolve(process.cwd(), 'project_context.md'),
  ];
  for (const cp of contextPaths) {
    if (fs.existsSync(cp)) {
      try {
        return fs.readFileSync(cp, 'utf-8');
      } catch {
        // ignore
      }
    }
  }
  return '';
}

// Read backend files to serve to frontend code explorer
function getBackendSourceFiles() {
  const backendDir = path.resolve(process.cwd(), 'backend');
  const files: Record<string, string> = {};

  const fileList = [
    { name: 'main.py', path: path.join(backendDir, 'main.py') },
    { name: 'requirements.txt', path: path.join(backendDir, 'requirements.txt') },
    { name: '.env.example', path: path.join(backendDir, '.env.example') },
    { name: 'project_context.md', path: path.join(backendDir, 'project_context.md') },
    { name: 'roblox_plugin/ForgeAIStudioPlugin.server.luau', path: path.join(backendDir, 'roblox_plugin', 'ForgeAIStudioPlugin.server.luau') },
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
// API Endpoints
// -----------------------------------------------------------------------------

// Backend Source Explorer endpoint
app.get('/api/v1/files', (_req, res) => {
  res.json({
    files: getBackendSourceFiles(),
  });
});

// Health check endpoint
app.get('/api/v1/health', (_req, res) => {
  const context = getLocalProjectContext();
  res.json({
    status: 'ok',
    gemini_connected: Boolean(ai),
    configured_models: {
      pro: 'gemini-2.5-pro',
      fast: 'gemini-2.5-flash',
    },
    rojo_project_path: './rojo_workspace',
    rojo_path_exists: true,
    context_file_found: Boolean(context),
    server_time: new Date().toISOString(),
  });
});

// Project Context endpoint
app.get('/api/v1/context', (_req, res) => {
  const context = getLocalProjectContext();
  res.json({
    has_context: Boolean(context),
    content: context,
  });
});

// Update Project Context endpoint
app.post('/api/v1/context', (req, res) => {
  try {
    const { content } = req.body;
    const targetPath = path.resolve(process.cwd(), 'backend', 'project_context.md');
    fs.writeFileSync(targetPath, content, 'utf-8');
    res.json({ success: true, message: 'Context updated successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Write generated Luau file to local Rojo workspace on disk
function writeToRojoWorkspace(rojoTargetFolder: string, fileName: string, luauCode: string): string {
  const rojoRoot = path.resolve(process.cwd(), 'rojo_workspace');
  const cleanFolder = (rojoTargetFolder || 'src/shared').replace(/^[/\\]+/, '');
  const targetDir = path.join(rojoRoot, cleanFolder);
  fs.mkdirSync(targetDir, { recursive: true });
  const cleanFileName = path.basename(fileName || 'GeneratedScript.luau');
  const targetFilePath = path.join(targetDir, cleanFileName);
  fs.writeFileSync(targetFilePath, luauCode, 'utf-8');
  return `./rojo_workspace/${cleanFolder}/${cleanFileName}`;
}

// Helper to emit SSE data line
function sendSseEvent(res: express.Response, payload: Record<string, any>) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// Generate Luau Script endpoint
app.post('/api/v1/generate-script', async (req, res) => {
  try {
    if (!ai) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY no está configurada en las variables de entorno.',
      });
    }

    const { prompt, script_type = 'Server', model_tier = 'fast', save_to_rojo = true } = req.body;
    const model = model_tier === 'pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';

    const localContext = getLocalProjectContext();

    const systemInstruction = `
You are the elite Luau & Roblox Software Architect for "Forge AI".
You generate industry-standard, high-performance, maintainable Luau code designed for Rojo workflows and production Roblox games.

MANDATORY LUAU CODING RULES (NON-NEGOTIABLE):
1. STRICT TYPECHECKING:
   - The very first line of EVERY script MUST BE: --!strict
   - Apply rigorous static Luau type annotations to all function parameters, return values, variables, and table records.
   - Use export type when defining reusable data structures.

2. MODERN TASK LIBRARY ONLY:
   - NEVER use deprecated legacy globals: wait(), spawn(), delay().
   - ALWAYS use the modern task library: task.wait(seconds), task.spawn(fn, ...), task.delay(seconds, fn, ...), task.defer(fn, ...).

3. MEMORY MANAGEMENT (MAID / JANITOR PATTERN):
   - Every connection (RBXScriptConnection), runtime Tween, dynamic thread, or temporary Instance MUST be tracked in a Maid/Janitor container.
   - Include clean :Destroy() or :DoCleaning() methods that disconnect all connections and destroy instances to prevent memory leaks.

4. SERVICE ACQUISITION:
   - Acquire all Roblox engine services at the top of the file using game:GetService("ServiceName").
   - Never use direct dot access like game.Workspace or game.Players.

5. ROJO CONVENTIONS:
   - Server scripts end with: .server.luau -> Target: src/server
   - Client scripts end with: .client.luau -> Target: src/client
   - Shared modules end with: .luau -> Target: src/shared
   - UI component modules end with: .luau -> Target: src/client/UI
`;

    const userPrompt = `
REQUEST TYPE: ${script_type} Script
DEFAULT ROJO TARGET FOLDER: ${script_type === 'Server' ? 'src/server' : script_type === 'Client' ? 'src/client' : 'src/shared'}

USER REQUIREMENTS:
${prompt}

${localContext ? `\n--- LOCAL PROJECT CONTEXT & CONVENTIONS ---\n${localContext}\n--- END LOCAL CONTEXT ---\n` : ''}

REMINDERS:
- Start file with --!strict.
- Use only task.wait, task.spawn, task.delay, task.defer.
- Implement Maid pattern for connection cleanup if listeners or timers are created.
- Ensure file_name ends with .server.luau (for Server), .client.luau (for Client), or .luau (for Module).
`;

    const response = await ai.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            file_name: {
              type: Type.STRING,
              description: 'File name with Rojo extension, e.g. DataManager.server.luau or Maid.luau',
            },
            rojo_target_folder: {
              type: Type.STRING,
              description: "Target relative directory in Rojo, e.g. 'src/server', 'src/client', 'src/shared'",
            },
            luau_code: {
              type: Type.STRING,
              description: 'Complete production Luau code starting with --!strict and utilizing task library and Maid pattern.',
            },
            dependencies: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'List of Roblox services and required modules.',
            },
            explanation: {
              type: Type.STRING,
              description: 'Technical breakdown of architecture, memory safety, and logic.',
            },
          },
          required: ['file_name', 'rojo_target_folder', 'luau_code', 'dependencies', 'explanation'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    parsed.saved_path = save_to_rojo
      ? writeToRojoWorkspace(parsed.rojo_target_folder, parsed.file_name, parsed.luau_code)
      : null;

    res.json(parsed);
  } catch (error: any) {
    console.error('Error generating script:', error);
    res.status(500).json({ error: error.message || 'Error generating Luau script' });
  }
});

// Streaming Generate Luau Script endpoint (SSE)
app.post('/api/v1/generate-script-stream', async (req, res) => {
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

    const { prompt, script_type = 'Server', model_tier = 'fast', save_to_rojo = true } = req.body;
    const model = model_tier === 'pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    const defaultFolder =
      script_type === 'Server' ? 'src/server' : script_type === 'Client' ? 'src/client' : 'src/shared';

    sendSseEvent(res, {
      type: 'log',
      level: 'info',
      message: `Inicializando solicitud [${script_type}] con modelo '${model}' (Tier: ${model_tier.toUpperCase()})`,
    });

    const localContext = getLocalProjectContext();
    if (localContext) {
      sendSseEvent(res, {
        type: 'log',
        level: 'info',
        message: `Contexto local inyectado desde project_context.md (${localContext.length} bytes)`,
      });
    }

    const systemInstruction = `
You are the elite Luau & Roblox Software Architect for "Forge AI".
You generate industry-standard, high-performance, maintainable Luau code designed for Rojo workflows and production Roblox games.

MANDATORY LUAU CODING RULES (NON-NEGOTIABLE):
1. STRICT TYPECHECKING:
   - The very first line of EVERY script MUST BE: --!strict
   - Apply rigorous static Luau type annotations to all function parameters, return values, variables, and table records.
   - Use export type when defining reusable data structures.

2. MODERN TASK LIBRARY ONLY:
   - NEVER use deprecated legacy globals: wait(), spawn(), delay().
   - ALWAYS use the modern task library: task.wait(seconds), task.spawn(fn, ...), task.delay(seconds, fn, ...), task.defer(fn, ...).

3. MEMORY MANAGEMENT (MAID / JANITOR PATTERN):
   - Every connection (RBXScriptConnection), runtime Tween, dynamic thread, or temporary Instance MUST be tracked in a Maid/Janitor container.
   - Include clean :Destroy() or :DoCleaning() methods that disconnect all connections and destroy instances to prevent memory leaks.

4. SERVICE ACQUISITION:
   - Acquire all Roblox engine services at the top of the file using game:GetService("ServiceName").
   - Never use direct dot access like game.Workspace or game.Players.

5. ROJO CONVENTIONS:
   - Server scripts end with: .server.luau -> Target: src/server
   - Client scripts end with: .client.luau -> Target: src/client
   - Shared modules end with: .luau -> Target: src/shared
   - UI component modules end with: .luau -> Target: src/client/UI
`;

    const userPrompt = `
REQUEST TYPE: ${script_type} Script
DEFAULT ROJO TARGET FOLDER: ${defaultFolder}

USER REQUIREMENTS:
${prompt}

${localContext ? `\n--- LOCAL PROJECT CONTEXT & CONVENTIONS ---\n${localContext}\n--- END LOCAL CONTEXT ---\n` : ''}

REMINDERS:
- Start file with --!strict.
- Use only task.wait, task.spawn, task.delay, task.defer.
- Implement Maid pattern for connection cleanup if listeners or timers are created.
- Ensure file_name ends with .server.luau (for Server), .client.luau (for Client), or .luau (for Module).
`;

    sendSseEvent(res, {
      type: 'log',
      level: 'stream',
      message: `Abriendo canal de streaming Structured Outputs con Gemini (${model})...`,
    });

    const streamResponse = await ai.models.generateContentStream({
      model,
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            file_name: {
              type: Type.STRING,
              description: 'File name with Rojo extension, e.g. DataManager.server.luau or Maid.luau',
            },
            rojo_target_folder: {
              type: Type.STRING,
              description: "Target relative directory in Rojo, e.g. 'src/server', 'src/client', 'src/shared'",
            },
            luau_code: {
              type: Type.STRING,
              description: 'Complete production Luau code starting with --!strict and utilizing task library and Maid pattern.',
            },
            dependencies: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'List of Roblox services and required modules.',
            },
            explanation: {
              type: Type.STRING,
              description: 'Technical breakdown of architecture, memory safety, and logic.',
            },
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
        sendSseEvent(res, {
          type: 'chunk',
          text: chunkText,
        });
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
        message: `💾 ROJO AUTO-SAVE CONFIRMADO: Archivo escrito en ${savedPath} (${(parsed.luau_code || '').length} bytes)`,
      });
    } else {
      parsed.saved_path = null;
      sendSseEvent(res, {
        type: 'log',
        level: 'info',
        message: 'Auto-guardado en Rojo omitido (save_to_rojo = false).',
      });
    }

    sendSseEvent(res, {
      type: 'log',
      level: 'success',
      message: `✅ Generación completada: ${parsed.file_name} validado con esquema LuauScriptResponse.`,
    });

    sendSseEvent(res, {
      type: 'done',
      result: parsed,
    });
    res.end();
  } catch (error: any) {
    console.error('Error streaming script:', error);
    sendSseEvent(res, {
      type: 'error',
      message: error.message || 'Error en streaming de script Luau',
    });
    res.end();
  }
});

// Generate ForgeGUI UI endpoint
app.post('/api/v1/generate-ui', async (req, res) => {
  try {
    if (!ai) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY no está configurada en las variables de entorno.',
      });
    }

    const {
      prompt,
      style_theme = 'Dark Cyberpunk',
      reference_image_base64,
      save_to_rojo = true,
      model_tier = 'fast',
    } = req.body;

    const model = model_tier === 'pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    const localContext = getLocalProjectContext();

    const systemInstruction = `
You are the elite Luau & Roblox UI Architect for "ForgeGUI".
Generate an advanced, fully-responsive Roblox UI component with both:
1. luau_code: A production-ready Luau ModuleScript returning a Component class with:
   - Component.new(playerGui: PlayerGui): ComponentInstance
   - :Mount() to construct the UI programmatically.
   - :Open() and :Close() with smooth TweenService animations (EasingStyle.Back / Quad).
   - :Destroy() utilizing the Maid pattern to disconnect mouse events, destroy Tweens, and remove ScreenGui.
2. ui_tree: A complete hierarchical JSON tree representing the exact Roblox Instance hierarchy (Classes, Names, Properties, Children) for direct deserialization by Roblox Studio plugins.

MANDATORY UI RULES:
- 100% RESPONSIVE SCALING: Main containers MUST use Scale coordinates via UDim2.fromScale(widthScale, heightScale) and AnchorPoint = Vector2.new(0.5, 0.5). NEVER use fixed Offset for root dialogs or frames!
- ASPECT RATIOS: Use UIAspectRatioConstraint for icons, square buttons, or character viewports.
- MODERN VISUAL POLISH:
  - Add UICorner to buttons and frames (e.g. UDim.new(0, 8) or UDim.new(0, 12)).
  - Add UIStroke for subtle glowing or defined borders (ApplyStrokeMode = Enum.ApplyStrokeMode.Border).
  - Add UIGradient to headers, buttons, and decorative accents matching the requested theme.
  - Add UIPadding for comfortable content breathing room.
  - Interactive Hover animations on TextButtons (scale up / brighten via TweenService).
`;

    const promptText = `
UI SPECIFICATION:
${prompt}

THEME & AESTHETIC:
${style_theme}

${localContext ? `\n--- LOCAL PROJECT CONTEXT ---\n${localContext}\n--- END LOCAL CONTEXT ---\n` : ''}

REQUIREMENTS:
- Scale-only positioning (UDim2.fromScale) for all root elements.
- Modern visual styling: UICorner, UIStroke, UIGradient, UIAspectRatioConstraint.
- Output both a functional Luau ModuleScript class (with Maid cleanup and TweenService open/close)
  AND a complete instance hierarchy in 'ui_tree'.
`;

    const contents: any[] = [];
    if (reference_image_base64) {
      let rawB64 = reference_image_base64;
      let mimeType = 'image/png';
      if (rawB64.includes(',')) {
        const [header, data] = rawB64.split(',', 2);
        rawB64 = data;
        if (header.includes('image/jpeg') || header.includes('image/jpg')) {
          mimeType = 'image/jpeg';
        } else if (header.includes('image/webp')) {
          mimeType = 'image/webp';
        }
      }
      contents.push({
        inlineData: {
          mimeType,
          data: rawB64,
        },
      });
    }

    contents.push({ text: promptText });

    const response = await ai.models.generateContent({
      model,
      contents: contents.length === 1 ? contents[0].text : { parts: contents },
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            file_name: {
              type: Type.STRING,
              description: 'File name, e.g. InventoryGui.luau',
            },
            rojo_target_folder: {
              type: Type.STRING,
              description: 'Target folder in Rojo, default src/client/UI',
            },
            luau_code: {
              type: Type.STRING,
              description: 'Functional Luau module with Maid cleanup and Tween animations.',
            },
            ui_tree: {
              type: Type.OBJECT,
              description: 'Hierarchical tree of Roblox instances (class_name, name, properties, children).',
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
            explanation: {
              type: Type.STRING,
              description: 'Design breakdown, theme choice, and animation details.',
            },
            style_theme: {
              type: Type.STRING,
              description: 'Applied style theme.',
            },
          },
          required: ['file_name', 'rojo_target_folder', 'luau_code', 'ui_tree', 'explanation', 'style_theme'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    parsed.saved_path = save_to_rojo
      ? writeToRojoWorkspace(parsed.rojo_target_folder || 'src/client/UI', parsed.file_name, parsed.luau_code)
      : null;

    res.json(parsed);
  } catch (error: any) {
    console.error('Error generating UI:', error);
    res.status(500).json({ error: error.message || 'Error generating Roblox UI' });
  }
});

// Streaming Generate ForgeGUI UI endpoint (SSE)
app.post('/api/v1/generate-ui-stream', async (req, res) => {
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
    if (localContext) {
      sendSseEvent(res, {
        type: 'log',
        level: 'info',
        message: `Contexto de UI y Maid inyectado desde project_context.md (${localContext.length} bytes)`,
      });
    }

    const systemInstruction = `
You are the elite Luau & Roblox UI Architect for "ForgeGUI".
Generate an advanced, fully-responsive Roblox UI component with both:
1. luau_code: A production-ready Luau ModuleScript returning a Component class with:
   - Component.new(playerGui: PlayerGui): ComponentInstance
   - :Mount() to construct the UI programmatically.
   - :Open() and :Close() with smooth TweenService animations (EasingStyle.Back / Quad).
   - :Destroy() utilizing the Maid pattern to disconnect mouse events, destroy Tweens, and remove ScreenGui.
2. ui_tree: A complete hierarchical JSON tree representing the exact Roblox Instance hierarchy (Classes, Names, Properties, Children) for direct deserialization by Roblox Studio plugins.

MANDATORY UI RULES:
- 100% RESPONSIVE SCALING: Main containers MUST use Scale coordinates via UDim2.fromScale(widthScale, heightScale) and AnchorPoint = Vector2.new(0.5, 0.5). NEVER use fixed Offset for root dialogs or frames!
- ASPECT RATIOS: Use UIAspectRatioConstraint for icons, square buttons, or character viewports.
- MODERN VISUAL POLISH:
  - Add UICorner to buttons and frames (e.g. UDim.new(0, 8) or UDim.new(0, 12)).
  - Add UIStroke for subtle glowing or defined borders (ApplyStrokeMode = Enum.ApplyStrokeMode.Border).
  - Add UIGradient to headers, buttons, and decorative accents matching the requested theme.
  - Add UIPadding for comfortable content breathing room.
  - Interactive Hover animations on TextButtons (scale up / brighten via TweenService).
`;

    const promptText = `
UI SPECIFICATION:
${prompt}

THEME & AESTHETIC:
${style_theme}

${localContext ? `\n--- LOCAL PROJECT CONTEXT ---\n${localContext}\n--- END LOCAL CONTEXT ---\n` : ''}

REQUIREMENTS:
- Scale-only positioning (UDim2.fromScale) for all root elements.
- Modern visual styling: UICorner, UIStroke, UIGradient, UIAspectRatioConstraint.
- Output both a functional Luau ModuleScript class (with Maid cleanup and TweenService open/close)
  AND a complete instance hierarchy in 'ui_tree'.
`;

    const contents: any[] = [];
    if (reference_image_base64) {
      let rawB64 = reference_image_base64;
      let mimeType = 'image/png';
      if (rawB64.includes(',')) {
        const [header, data] = rawB64.split(',', 2);
        rawB64 = data;
        if (header.includes('image/jpeg') || header.includes('image/jpg')) {
          mimeType = 'image/jpeg';
        } else if (header.includes('image/webp')) {
          mimeType = 'image/webp';
        }
      }
      contents.push({
        inlineData: {
          mimeType,
          data: rawB64,
        },
      });
      sendSseEvent(res, {
        type: 'log',
        level: 'info',
        message: `🖼️ Imagen de referencia adjuntada (${mimeType}) para análisis multimodal.`,
      });
    }

    contents.push({ text: promptText });

    sendSseEvent(res, {
      type: 'log',
      level: 'stream',
      message: `Transmitiendo respuesta estructurada (Módulo Luau + ui_tree JSON)...`,
    });

    const streamResponse = await ai.models.generateContentStream({
      model,
      contents: contents.length === 1 ? contents[0].text : { parts: contents },
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            file_name: {
              type: Type.STRING,
              description: 'File name, e.g. InventoryGui.luau',
            },
            rojo_target_folder: {
              type: Type.STRING,
              description: 'Target folder in Rojo, default src/client/UI',
            },
            luau_code: {
              type: Type.STRING,
              description: 'Functional Luau module with Maid cleanup and Tween animations.',
            },
            ui_tree: {
              type: Type.OBJECT,
              description: 'Hierarchical tree of Roblox instances (class_name, name, properties, children).',
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
            explanation: {
              type: Type.STRING,
              description: 'Design breakdown, theme choice, and animation details.',
            },
            style_theme: {
              type: Type.STRING,
              description: 'Applied style theme.',
            },
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
        sendSseEvent(res, {
          type: 'chunk',
          text: chunkText,
        });
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
        message: `💾 ROJO AUTO-SAVE CONFIRMADO: Componente UI escrito en ${savedPath} (${(parsed.luau_code || '').length} bytes)`,
      });
    } else {
      parsed.saved_path = null;
      sendSseEvent(res, {
        type: 'log',
        level: 'info',
        message: 'Auto-guardado en Rojo omitido (save_to_rojo = false).',
      });
    }

    sendSseEvent(res, {
      type: 'log',
      level: 'success',
      message: `✅ ForgeGUI generado: ${parsed.file_name} + árbol de instancias StarterGui listo.`,
    });

    sendSseEvent(res, {
      type: 'done',
      result: parsed,
    });
    res.end();
  } catch (error: any) {
    console.error('Error streaming UI:', error);
    sendSseEvent(res, {
      type: 'error',
      message: error.message || 'Error en streaming de interfaz Roblox',
    });
    res.end();
  }
});

// -----------------------------------------------------------------------------
// Vite Middleware for Frontend in Dev Mode
// -----------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
    console.log(`🚀 Forge AI Server running on http://localhost:${PORT}`);
  });
}

startServer();
