"""
Luau Engine (backend/engines/luau_engine.py)
Responsible for generating --!strict Server, Client, and Module scripts
using the official google-genai SDK and Structured Outputs (Pydantic).
"""

from typing import List, Literal, Optional
from pydantic import BaseModel, Field
from google import genai
from google.genai import types


class LuauScriptResponse(BaseModel):
    file_name: str = Field(description="File name with .server.luau, .client.luau or .luau suffix.")
    rojo_target_folder: str = Field(description="Target Rojo folder: src/server, src/client, or src/shared")
    luau_code: str = Field(description="Complete Luau script starting with --!strict, using task.* and Maid.")
    dependencies: List[str] = Field(description="List of Roblox services and shared modules required.")
    explanation: str = Field(description="Architectural explanation of the generated Luau system.")
    rojo_saved_path: Optional[str] = Field(default=None, description="Verified relative path saved in Rojo.")


LUAU_ENGINE_SYSTEM_INSTRUCTION = """
You are the Luau Engine inside Forge AI Studio.
MANDATORY LUAU STANDARDS:
1. Start EVERY script with `--!strict` and use explicit static type annotations.
2. Obtain all Roblox Services at the top of the file via `game:GetService("...")`.
3. Use ONLY the modern `task` library (`task.wait`, `task.spawn`, `task.delay`, `task.defer`). NEVER use deprecated `wait()`, `spawn()`, or `delay()`.
4. Manage all event connections (`RBXScriptConnection`) and created instances with a `Maid` cleanup lifecycle.
5. Never use `loadstring`, `getfenv`, or `setfenv`.
"""


class LuauEngine:
    def __init__(self, client: Optional[genai.Client]):
        self.client = client

    def resolve_model(self, model_tier: str) -> str:
        return "gemini-2.5-pro" if model_tier == "pro" else "gemini-2.5-flash"

    def generate_script(
        self,
        prompt: str,
        script_type: Literal["Server", "Client", "Module"],
        model_tier: str,
        project_context: str,
    ) -> LuauScriptResponse:
        if not self.client:
            raise RuntimeError("Google GenAI Client is not initialized.")

        full_prompt = (
            f"SCRIPT TYPE: {script_type}\n"
            f"USER REQUEST: {prompt}\n\n"
            f"{project_context}"
        )

        response = self.client.models.generate_content(
            model=self.resolve_model(model_tier),
            contents=full_prompt,
            config=types.GenerateContentConfig(
                system_instruction=LUAU_ENGINE_SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                response_schema=LuauScriptResponse,
                temperature=0.2,
            ),
        )
        return LuauScriptResponse.model_validate_json(response.text)
