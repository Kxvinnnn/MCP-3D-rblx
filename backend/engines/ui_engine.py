"""
UI Engine (backend/engines/ui_engine.py)
Generates responsive Roblox ScreenGui & ViewportFrame modules using UDim2.fromScale,
TweenService animations, UICorner, UIStroke, UIGradient, and hierarchical ui_tree JSON.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from google import genai
from google.genai import types


class UINode(BaseModel):
    class_name: str = Field(description="Roblox Instance ClassName (Frame, TextButton, TextLabel, ViewportFrame, etc.)")
    name: str = Field(description="Descriptive PascalCase instance name")
    properties: Dict[str, Any] = Field(default_factory=dict, description="Properties dictionary")
    children: List["UINode"] = Field(default_factory=list, description="Child UI instances")


UINode.model_rebuild()


class ForgeGUIResponse(BaseModel):
    file_name: str = Field(description="Luau UI module file name ending in .luau")
    rojo_target_folder: str = Field(default="src/client/UI", description="Rojo UI folder")
    luau_code: str = Field(description="--!strict Luau module building the ScreenGui/ViewportFrame with Maid & TweenService")
    ui_tree: UINode = Field(description="Hierarchical JSON representation of the Roblox UI tree")
    explanation: str = Field(description="Explanation of responsive scaling and animations")
    style_theme: str = Field(description="Applied visual theme")
    rojo_saved_path: Optional[str] = Field(default=None)


UI_ENGINE_SYSTEM_INSTRUCTION = """
You are the UI Engine (ForgeGUI) for Roblox Studio.
MANDATORY UI STANDARDS:
1. Start the module with `--!strict`.
2. Use `UDim2.fromScale(...)` for all primary containers and `AnchorPoint = Vector2.new(0.5, 0.5)`.
3. Include `UIAspectRatioConstraint`, `UICorner`, `UIStroke`, and `UIGradient`.
4. Support `ViewportFrame` with `WorldModel` when 3D previews are requested.
5. Animate open/close and interactive states with `TweenService` and clean up connections via `Maid`.
"""


class UIEngine:
    def __init__(self, client: Optional[genai.Client]):
        self.client = client

    def resolve_model(self, model_tier: str) -> str:
        return "gemini-2.5-pro" if model_tier == "pro" else "gemini-2.5-flash"

    def generate_ui(
        self,
        prompt: str,
        style_theme: str,
        model_tier: str,
        project_context: str,
    ) -> ForgeGUIResponse:
        if not self.client:
            raise RuntimeError("Google GenAI Client is not initialized.")

        full_prompt = (
            f"UI REQUEST: {prompt}\n"
            f"STYLE THEME: {style_theme}\n\n"
            f"{project_context}"
        )

        response = self.client.models.generate_content(
            model=self.resolve_model(model_tier),
            contents=full_prompt,
            config=types.GenerateContentConfig(
                system_instruction=UI_ENGINE_SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                response_schema=ForgeGUIResponse,
                temperature=0.25,
            ),
        )
        return ForgeGUIResponse.model_validate_json(response.text)
