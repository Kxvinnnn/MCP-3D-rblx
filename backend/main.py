"""
Forge AI - Roblox Luau & Rojo Local Backend
===========================================
Production-grade FastAPI server powering Roblox Studio AI generation.
Utilizes the official Google GenAI SDK (`google-genai`), Pydantic Structured Outputs,
strict Luau architecture rules, and automated Rojo workspace synchronization.

Author: Senior Software & Luau Architect
Compatible: Python 3.11+, Roblox Studio (HttpService), Rojo 7.x
"""

import base64
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# Official current Google GenAI SDK (DO NOT use legacy google-generativeai)
from google import genai
from google.genai import types
from google.genai.errors import APIError

# ------------------------------------------------------------------------------
# 1. Configuration & Initialization
# ------------------------------------------------------------------------------

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("ForgeAI.Backend")

# Model tiers mapping
TIER_MODELS: dict[str, str] = {
    "pro": os.getenv("MODEL_TIER_PRO", "gemini-2.5-pro"),
    "fast": os.getenv("MODEL_TIER_FAST", "gemini-2.5-flash"),
}

ROJO_PROJECT_PATH_ENV = os.getenv("ROJO_PROJECT_PATH", "./rojo_workspace")
PROJECT_CONTEXT_FILE = os.getenv("PROJECT_CONTEXT_FILE", "project_context.md")

# Initialize Gemini Client (picks up GEMINI_API_KEY from environment)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
if not GEMINI_API_KEY:
    logger.warning("⚠️ GEMINI_API_KEY is not set in environment or .env file.")

try:
    gemini_client = genai.Client()
    logger.info("✅ Google GenAI SDK initialized successfully.")
except Exception as init_err:
    logger.error(f"❌ Failed to initialize Google GenAI Client: {init_err}")
    gemini_client = None

app = FastAPI(
    title="Forge AI - Roblox & Rojo Backend",
    version="1.0.0",
    description="High-performance backend for Luau code generation, Rojo syncing, and Roblox Studio integration."
)

# Allow CORS for local tools, web playground, and local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------------------
# 2. Pydantic Schemas for Requests and Gemini Structured Outputs
# ------------------------------------------------------------------------------

class ScriptRequest(BaseModel):
    """Payload to generate backend, client, or module Luau architecture."""
    prompt: str = Field(..., description="Description of the feature, logic, or system to generate in Luau.")
    script_type: Literal["Server", "Client", "Module"] = Field(
        default="Server",
        description="The execution context in Roblox: Server (Script), Client (LocalScript), or Module (ModuleScript)."
    )
    model_tier: Literal["fast", "pro"] = Field(
        default="fast",
        description="Model tier: 'fast' (gemini-2.5-flash) for rapid iterations, 'pro' (gemini-2.5-pro) for deep architecture."
    )
    save_to_rojo: bool = Field(
        default=True,
        description="Whether to automatically write the generated .luau file to the local Rojo project directory."
    )


class LuauScriptResponse(BaseModel):
    """Structured output expected from Gemini for script generation."""
    file_name: str = Field(
        ...,
        description="File name with Rojo extension: *.server.luau for Server, *.client.luau for Client, *.luau for Module."
    )
    rojo_target_folder: str = Field(
        ...,
        description="Target relative directory in Rojo project: 'src/server', 'src/client', or 'src/shared'."
    )
    luau_code: str = Field(
        ...,
        description="Complete, production-ready, strictly-typed Luau code complying with --!strict and task library standards."
    )
    dependencies: List[str] = Field(
        default_factory=list,
        description="List of required Roblox services and shared modules needed by this script."
    )
    explanation: str = Field(
        ...,
        description="Clear technical explanation of architecture, memory management, and network replication."
    )
    saved_path: Optional[str] = Field(
        default=None,
        description="Local disk path where Rojo file was saved, if save_to_rojo was enabled."
    )


class UINode(BaseModel):
    """Hierarchical node representing an instance in the Roblox GUI tree."""
    class_name: str = Field(
        ...,
        description="Roblox GUI ClassName: Frame, TextLabel, TextButton, ImageLabel, ImageButton, ScrollingFrame, UICorner, UIStroke, UIGradient, UIAspectRatioConstraint, UIListLayout, UIPadding."
    )
    name: str = Field(..., description="Roblox Instance name.")
    properties: Dict[str, Any] = Field(
        default_factory=dict,
        description="Key-value dictionary of Roblox properties (e.g. Size, Position, AnchorPoint, BackgroundColor3, Font, Text, TextScaled, CornerRadius)."
    )
    children: List["UINode"] = Field(
        default_factory=list,
        description="Nested child GUI instances."
    )


class UIRequest(BaseModel):
    """Payload to generate a complete responsive Roblox UI (ForgeGUI)."""
    prompt: str = Field(..., description="Functional description and layout requirements of the interface.")
    style_theme: str = Field(
        default="Dark Cyberpunk",
        description="Visual aesthetic (e.g. 'Dark Cyberpunk', 'Horror', 'Minimalist Glassmorphism', 'Fantasy RPG', 'Sci-Fi HUD')."
    )
    reference_image_base64: Optional[str] = Field(
        default=None,
        description="Optional base64-encoded screenshot, wireframe or sketch for visual reference."
    )
    save_to_rojo: bool = Field(
        default=True,
        description="Whether to auto-save the UI module to src/client/UI in the Rojo workspace."
    )
    model_tier: Literal["fast", "pro"] = Field(
        default="fast",
        description="Model tier choice for UI generation."
    )


class LuauUIResponse(BaseModel):
    """Structured output expected from Gemini for UI generation."""
    file_name: str = Field(
        ...,
        description="Target file name, e.g. InventoryView.luau or ShopModal.luau."
    )
    rojo_target_folder: str = Field(
        default="src/client/UI",
        description="Destination folder in Rojo, default is 'src/client/UI'."
    )
    luau_code: str = Field(
        ...,
        description="Production Luau module returning a Component class with :Mount(), :Open(), :Close(), :Destroy(), TweenService animations, and Maid cleanup."
    )
    ui_tree: UINode = Field(
        ...,
        description="Hierarchical JSON representation of the GUI instances for direct Roblox Studio plugin instantiation."
    )
    explanation: str = Field(
        ...,
        description="Design rationale, color palette breakdown, responsiveness explanation, and animation details."
    )
    style_theme: str = Field(
        ...,
        description="Confirmed style theme applied to the UI."
    )
    saved_path: Optional[str] = Field(
        default=None,
        description="Local disk path if saved to Rojo directory."
    )


class HealthResponse(BaseModel):
    """Health check payload for Roblox Studio HttpService and diagnostics."""
    status: str
    gemini_connected: bool
    configured_models: Dict[str, str]
    rojo_project_path: str
    rojo_path_exists: bool
    context_file_found: bool
    server_time: str


# ------------------------------------------------------------------------------
# 3. Luau Internal System Prompts & Standards
# ------------------------------------------------------------------------------

LUAU_CORE_STANDARDS = """
You are the elite Luau & Roblox Software Architect for "Forge AI".
You generate industry-standard, high-performance, maintainable Luau code designed for Rojo workflows and production Roblox games.

MANDATORY LUAU CODING RULES (NON-NEGOTIABLE):
1. STRICT TYPECHECKING:
   - The very first line of EVERY script MUST BE: `--!strict`
   - Apply rigorous static Luau type annotations to all function parameters, return values, variables, and table records.
   - Use `export type` when defining reusable data structures.

2. MODERN TASK LIBRARY ONLY:
   - NEVER use deprecated legacy globals: `wait()`, `spawn()`, `delay()`.
   - ALWAYS use the modern `task` library: `task.wait(seconds)`, `task.spawn(fn, ...)`, `task.delay(seconds, fn, ...)`, `task.defer(fn, ...)`.

3. MEMORY MANAGEMENT (MAID / JANITOR PATTERN):
   - Every connection (`RBXScriptConnection`), runtime Tween, dynamic thread, or temporary Instance MUST be tracked in a Maid/Janitor container.
   - Include clean `:Destroy()` or `:DoCleaning()` methods that disconnect all connections and destroy instances to prevent catastrophic memory leaks.

4. SERVICE ACQUISITION:
   - Acquire all Roblox engine services at the top of the file using `game:GetService("ServiceName")`.
   - Never use direct dot access like `game.Workspace` or `game.Players`.

5. ROJO CONVENTIONS:
   - Server scripts end with: `.server.luau` -> Target: `src/server`
   - Client scripts end with: `.client.luau` -> Target: `src/client`
   - Shared modules end with: `.luau` -> Target: `src/shared`
   - UI component modules end with: `.luau` -> Target: `src/client/UI`
"""

LUAU_SCRIPT_SYSTEM_PROMPT = f"""{LUAU_CORE_STANDARDS}

TASK:
Generate a complete, fully-featured, runnable Luau script based on the user's prompt.
Adhere strictly to server-authoritative logic, secure network validation (never trust client input), and modular architecture.
Do not provide snippets or incomplete placeholders. Provide the entire production script.
"""

LUAU_UI_SYSTEM_PROMPT = f"""{LUAU_CORE_STANDARDS}

TASK: FORGEGUI INTERFACE GENERATION
Generate an advanced, fully-responsive Roblox UI component with both:
1. `luau_code`: A production-ready Luau ModuleScript returning a Component class with:
   - `Component.new(playerGui: PlayerGui): ComponentInstance`
   - `:Mount()` to construct the UI programmatically.
   - `:Open()` and `:Close()` with smooth `TweenService` animations (EasingStyle.Back / Quad).
   - `:Destroy()` utilizing the Maid pattern to disconnect mouse events, destroy Tweens, and remove ScreenGui.
2. `ui_tree`: A complete hierarchical JSON tree representing the exact Roblox Instance hierarchy (Classes, Names, Properties, Children) for direct deserialization by Roblox Studio plugins.

MANDATORY UI RULES:
- 100% RESPONSIVE SCALING: Main containers MUST use Scale coordinates via `UDim2.fromScale(widthScale, heightScale)` and `AnchorPoint = Vector2.new(0.5, 0.5)`. NEVER use fixed Offset for root dialogs or frames!
- ASPECT RATIOS: Use `UIAspectRatioConstraint` for icons, square buttons, or character viewports.
- MODERN VISUAL POLISH:
  - Add `UICorner` to buttons and frames (e.g. `UDim.new(0, 8)` or `UDim.new(0, 12)`).
  - Add `UIStroke` for subtle glowing or defined borders (`ApplyStrokeMode = Enum.ApplyStrokeMode.Border`).
  - Add `UIGradient` to headers, buttons, and decorative accents matching the requested theme.
  - Add `UIPadding` for comfortable content breathing room.
  - Interactive Hover animations on TextButtons (scale up / brighten via TweenService).
"""


# ------------------------------------------------------------------------------
# 4. Helper Functions: Context Injection & Rojo Saving
# ------------------------------------------------------------------------------

def load_project_context() -> str:
    """
    Reads the local project_context.md file to inject game architecture,
    conventions, and existing modules into the prompt.
    """
    # Look in current working dir, backend dir, or configured path
    search_paths = [
        Path(PROJECT_CONTEXT_FILE),
        Path(__file__).parent / PROJECT_CONTEXT_FILE,
        Path(__file__).parent.parent / PROJECT_CONTEXT_FILE,
        Path(ROJO_PROJECT_PATH_ENV) / PROJECT_CONTEXT_FILE,
    ]

    for p in search_paths:
        if p.exists() and p.is_file():
            try:
                content = p.read_text(encoding="utf-8").strip()
                if content:
                    logger.info(f"📄 Loaded project context from: {p.resolve()}")
                    return f"\n\n--- LOCAL PROJECT CONTEXT & CONVENTIONS ({p.name}) ---\n{content}\n--- END LOCAL CONTEXT ---\n"
            except Exception as read_err:
                logger.warning(f"Failed to read project context at {p}: {read_err}")

    logger.info("ℹ️ No project_context.md file found. Proceeding without local context injection.")
    return ""


def save_luau_to_rojo(rojo_target_folder: str, file_name: str, code: str) -> Optional[str]:
    """
    Saves generated Luau code directly to the local Rojo project directory.
    """
    try:
        rojo_root = Path(ROJO_PROJECT_PATH_ENV).resolve()
        
        # Sanitize target folder
        clean_folder = rojo_target_folder.strip().lstrip("/").lstrip("\\")
        target_dir = rojo_root / clean_folder
        target_dir.mkdir(parents=True, exist_ok=True)

        # Sanitize file name
        clean_file_name = Path(file_name).name
        target_file_path = target_dir / clean_file_name

        target_file_path.write_text(code, encoding="utf-8")
        logger.info(f"💾 Successfully saved Luau file to Rojo workspace: {target_file_path}")
        return str(target_file_path)
    except Exception as save_err:
        logger.error(f"❌ Failed to save file to Rojo project: {save_err}")
        return None


def get_gemini_client() -> genai.Client:
    """Helper to ensure Gemini client is available or raise HTTPException."""
    if not gemini_client:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google GenAI Client is not initialized. Please verify GEMINI_API_KEY."
        )
    return gemini_client


# ------------------------------------------------------------------------------
# 5. API Endpoints
# ------------------------------------------------------------------------------

@app.get("/api/v1/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    """
    Health check endpoint for Roblox Studio HttpService and CLI tools.
    Verifies API connectivity, Rojo path, and project context availability.
    """
    from datetime import datetime
    
    rojo_path = Path(ROJO_PROJECT_PATH_ENV).resolve()
    context_exists = bool(load_project_context())

    return HealthResponse(
        status="ok",
        gemini_connected=gemini_client is not None,
        configured_models=TIER_MODELS,
        rojo_project_path=str(rojo_path),
        rojo_path_exists=rojo_path.exists(),
        context_file_found=context_exists,
        server_time=datetime.utcnow().isoformat() + "Z"
    )


@app.get("/api/v1/context")
def get_current_context():
    """Inspect the active project_context.md content currently injected into prompts."""
    raw_context = load_project_context()
    return {
        "has_context": bool(raw_context),
        "context_preview": raw_context[:500] + ("..." if len(raw_context) > 500 else "") if raw_context else None,
        "full_context": raw_context
    }


@app.post("/api/v1/generate-script", response_model=LuauScriptResponse)
def generate_script(req: ScriptRequest) -> LuauScriptResponse:
    """
    Generate Luau scripts (Server, Client, Module) using Gemini Structured Outputs.
    Applies strict Luau standards, Maid memory management, and optional Rojo file sync.
    """
    client = get_gemini_client()

    # Model resolution based on tier
    model_name = TIER_MODELS.get(req.model_tier, TIER_MODELS["fast"])
    logger.info(f"🚀 Generating Luau script [{req.script_type}] with model '{model_name}' (Tier: {req.model_tier})")

    # Ingest local context
    context_data = load_project_context()

    # Determine default folder hint for Rojo
    default_folder_hint = {
        "Server": "src/server",
        "Client": "src/client",
        "Module": "src/shared"
    }.get(req.script_type, "src/shared")

    # Build prompt with strict typing constraints
    user_prompt = f"""
REQUEST TYPE: {req.script_type} Script
DEFAULT ROJO TARGET FOLDER: {default_folder_hint}

USER REQUIREMENTS:
{req.prompt}
{context_data}

REMINDERS:
- Start file with --!strict.
- Use only task.wait, task.spawn, task.delay, task.defer.
- Implement Maid pattern for connection cleanup if listeners or timers are created.
- Ensure file_name ends with .server.luau (for Server), .client.luau (for Client), or .luau (for Module).
"""

    try:
        # Call Gemini with Structured Outputs via Pydantic model
        response = client.models.generate_content(
            model=model_name,
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=LUAU_SCRIPT_SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_schema=LuauScriptResponse,
            )
        )

        raw_text = response.text or ""
        parsed_result = LuauScriptResponse.model_validate_json(raw_text)

        # Auto-save to Rojo workspace if requested
        if req.save_to_rojo:
            saved_path = save_luau_to_rojo(
                rojo_target_folder=parsed_result.rojo_target_folder,
                file_name=parsed_result.file_name,
                code=parsed_result.luau_code
            )
            parsed_result.saved_path = saved_path

        return parsed_result

    except APIError as api_err:
        logger.error(f"Gemini API Error: {api_err}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Google Gemini API error: {str(api_err)}"
        )
    except Exception as err:
        logger.error(f"Error during script generation: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate Luau script: {str(err)}"
        )


@app.post("/api/v1/generate-ui", response_model=LuauUIResponse)
def generate_ui(req: UIRequest) -> LuauUIResponse:
    """
    ForgeGUI Generator: Generates responsive Roblox UI components.
    Accepts text requirements and optional reference image (wireframe/mockup).
    Returns both a production Luau Module and a hierarchical JSON ui_tree.
    """
    client = get_gemini_client()

    model_name = TIER_MODELS.get(req.model_tier, TIER_MODELS["fast"])
    logger.info(f"🎨 Generating Roblox UI with theme '{req.style_theme}' using model '{model_name}'")

    context_data = load_project_context()

    prompt_text = f"""
UI SPECIFICATION:
{req.prompt}

THEME & AESTHETIC:
{req.style_theme}
{context_data}

REQUIREMENTS:
- Scale-only positioning (UDim2.fromScale) for all root elements.
- Modern visual styling: UICorner, UIStroke, UIGradient, UIAspectRatioConstraint.
- Output both a functional Luau ModuleScript class (with Maid cleanup and TweenService open/close)
  AND a complete instance hierarchy in 'ui_tree'.
"""

    contents: list[Any] = []

    # Process base64 reference image if provided
    if req.reference_image_base64:
        try:
            raw_b64 = req.reference_image_base64.strip()
            mime_type = "image/png"
            if "," in raw_b64:
                header, raw_b64 = raw_b64.split(",", 1)
                if "image/jpeg" in header or "image/jpg" in header:
                    mime_type = "image/jpeg"
                elif "image/webp" in header:
                    mime_type = "image/webp"

            image_bytes = base64.b64decode(raw_b64)
            contents.append(types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
            logger.info("🖼️ Attached reference image to Gemini UI generation request.")
        except Exception as img_err:
            logger.warning(f"Could not parse reference image base64: {img_err}")

    contents.append(prompt_text)

    try:
        # Call Gemini with Structured Outputs via Pydantic model
        response = client.models.generate_content(
            model=model_name,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=LUAU_UI_SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_schema=LuauUIResponse,
            )
        )

        raw_text = response.text or ""
        parsed_result = LuauUIResponse.model_validate_json(raw_text)

        # Auto-save to Rojo workspace if requested
        if req.save_to_rojo:
            saved_path = save_luau_to_rojo(
                rojo_target_folder=parsed_result.rojo_target_folder or "src/client/UI",
                file_name=parsed_result.file_name,
                code=parsed_result.luau_code
            )
            parsed_result.saved_path = saved_path

        return parsed_result

    except APIError as api_err:
        logger.error(f"Gemini API Error in UI generation: {api_err}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Google Gemini API error: {str(api_err)}"
        )
    except Exception as err:
        logger.error(f"Error during UI generation: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate Roblox UI: {str(err)}"
        )


@app.post("/api/v1/generate-script-stream")
def generate_script_stream(req: ScriptRequest) -> StreamingResponse:
    """
    Real-time SSE streaming endpoint for Luau script generation, including Rojo file-write confirmations.
    """
    client = get_gemini_client()
    model_name = TIER_MODELS.get(req.model_tier, TIER_MODELS["fast"])
    default_folder_hint = {
        "Server": "src/server",
        "Client": "src/client",
        "Module": "src/shared"
    }.get(req.script_type, "src/shared")

    def event_generator():
        def sse(payload: dict) -> str:
            return f"data: {json.dumps(payload)}\n\n"

        try:
            yield sse({
                "type": "log",
                "level": "info",
                "message": f"Inicializando solicitud [{req.script_type}] con modelo '{model_name}' (Tier: {req.model_tier.upper()})"
            })

            context_data = load_project_context()
            if context_data:
                yield sse({
                    "type": "log",
                    "level": "info",
                    "message": f"Contexto local inyectado desde project_context.md ({len(context_data)} bytes)"
                })

            user_prompt = f"""
REQUEST TYPE: {req.script_type} Script
DEFAULT ROJO TARGET FOLDER: {default_folder_hint}

USER REQUIREMENTS:
{req.prompt}
{context_data}

REMINDERS:
- Start file with --!strict.
- Use only task.wait, task.spawn, task.delay, task.defer.
- Implement Maid pattern for connection cleanup if listeners or timers are created.
- Ensure file_name ends with .server.luau (for Server), .client.luau (for Client), or .luau (for Module).
"""
            yield sse({
                "type": "log",
                "level": "stream",
                "message": f"Abriendo canal de streaming Structured Outputs con Gemini ({model_name})..."
            })

            full_text = ""
            for chunk in client.models.generate_content_stream(
                model=model_name,
                contents=user_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=LUAU_SCRIPT_SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=LuauScriptResponse,
                )
            ):
                if chunk.text:
                    full_text += chunk.text
                    yield sse({"type": "chunk", "text": chunk.text})

            parsed_result = LuauScriptResponse.model_validate_json(full_text)

            if req.save_to_rojo:
                saved_path = save_luau_to_rojo(
                    rojo_target_folder=parsed_result.rojo_target_folder,
                    file_name=parsed_result.file_name,
                    code=parsed_result.luau_code
                )
                parsed_result.saved_path = saved_path
                yield sse({
                    "type": "log",
                    "level": "rojo",
                    "message": f"💾 ROJO AUTO-SAVE CONFIRMADO: Archivo escrito en {saved_path} ({len(parsed_result.luau_code)} bytes)"
                })

            yield sse({
                "type": "log",
                "level": "success",
                "message": f"✅ Generación completada: {parsed_result.file_name} validado con esquema LuauScriptResponse."
            })
            yield sse({"type": "done", "result": parsed_result.model_dump()})
        except Exception as exc:
            logger.error(f"Stream error: {exc}", exc_info=True)
            yield sse({"type": "error", "message": str(exc)})

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/v1/generate-ui-stream")
def generate_ui_stream(req: UIRequest) -> StreamingResponse:
    """
    Real-time SSE streaming endpoint for ForgeGUI generation, including Rojo file-write confirmations.
    """
    client = get_gemini_client()
    model_name = TIER_MODELS.get(req.model_tier, TIER_MODELS["fast"])

    def event_generator():
        def sse(payload: dict) -> str:
            return f"data: {json.dumps(payload)}\n\n"

        try:
            yield sse({
                "type": "log",
                "level": "info",
                "message": f"Iniciando motor ForgeGUI [Tema: {req.style_theme}] con modelo '{model_name}'..."
            })

            context_data = load_project_context()
            if context_data:
                yield sse({
                    "type": "log",
                    "level": "info",
                    "message": f"Contexto de UI y Maid inyectado desde project_context.md ({len(context_data)} bytes)"
                })

            prompt_text = f"""
UI SPECIFICATION:
{req.prompt}

THEME & AESTHETIC:
{req.style_theme}
{context_data}

REQUIREMENTS:
- Scale-only positioning (UDim2.fromScale) for all root elements.
- Modern visual styling: UICorner, UIStroke, UIGradient, UIAspectRatioConstraint.
- Output both a functional Luau ModuleScript class (with Maid cleanup and TweenService open/close)
  AND a complete instance hierarchy in 'ui_tree'.
"""
            contents: list[Any] = []
            if req.reference_image_base64:
                raw_b64 = req.reference_image_base64.strip()
                mime_type = "image/png"
                if "," in raw_b64:
                    header, raw_b64 = raw_b64.split(",", 1)
                    if "image/jpeg" in header or "image/jpg" in header:
                        mime_type = "image/jpeg"
                    elif "image/webp" in header:
                        mime_type = "image/webp"
                image_bytes = base64.b64decode(raw_b64)
                contents.append(types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
                yield sse({
                    "type": "log",
                    "level": "info",
                    "message": f"🖼️ Imagen de referencia adjuntada ({mime_type}) para análisis multimodal."
                })

            contents.append(prompt_text)

            yield sse({
                "type": "log",
                "level": "stream",
                "message": "Transmitiendo respuesta estructurada (Módulo Luau + ui_tree JSON)..."
            })

            full_text = ""
            for chunk in client.models.generate_content_stream(
                model=model_name,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=LUAU_UI_SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=LuauUIResponse,
                )
            ):
                if chunk.text:
                    full_text += chunk.text
                    yield sse({"type": "chunk", "text": chunk.text})

            parsed_result = LuauUIResponse.model_validate_json(full_text)

            if req.save_to_rojo:
                saved_path = save_luau_to_rojo(
                    rojo_target_folder=parsed_result.rojo_target_folder or "src/client/UI",
                    file_name=parsed_result.file_name,
                    code=parsed_result.luau_code
                )
                parsed_result.saved_path = saved_path
                yield sse({
                    "type": "log",
                    "level": "rojo",
                    "message": f"💾 ROJO AUTO-SAVE CONFIRMADO: Componente UI escrito en {saved_path} ({len(parsed_result.luau_code)} bytes)"
                })

            yield sse({
                "type": "log",
                "level": "success",
                "message": f"✅ ForgeGUI generado: {parsed_result.file_name} + árbol de instancias StarterGui listo."
            })
            yield sse({"type": "done", "result": parsed_result.model_dump()})
        except Exception as exc:
            logger.error(f"UI Stream error: {exc}", exc_info=True)
            yield sse({"type": "error", "message": str(exc)})

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ------------------------------------------------------------------------------
# 6. Server Runner
# ------------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", 8000))
    logger.info(f"🔥 Starting Forge AI Server on http://{host}:{port}")
    uvicorn.run("main:app", host=host, port=port, reload=True)
