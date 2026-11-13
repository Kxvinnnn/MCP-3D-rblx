"""
Forge AI Studio v2.3.0 - Modular Engine Architecture (AI-First Self-Documented Edition)
=====================================================================================
Independent single-responsibility engines orchestrated by FastAPI (`main.py`) and Express (`server.ts`):
- context_pruner: Domain-scoped AI prompt context slicer (~65% less redundant prompt context) & AI manifest
- rojo_bridge: Rojo 7.x synchronization, path sandboxing & SHA-256 manifest
- luau_engine: Roblox --!strict script architecture & Maid lifecycle
- ui_engine: Responsive ScreenGui, ViewportFrame & TweenService animations
- generation_3d_engine: EditableMesh 3D synthesis, Wavefront .OBJ parser, >9k splitter & .RBXMX parser
- asset_engine: 4-Channel PBR SurfaceAppearance, Open Cloud async Operation polling & 25-version library
- world_engine: Full 3D Scene, Lighting, Atmosphere & spatial map builder
- agents_engine: P3 Specialized Multi-Agent autonomous workflow orchestrator
"""

from .context_pruner import (
    AI_MODULE_CONTRACTS,
    build_ai_self_understanding_manifest,
    build_pruned_domain_context,
)

__all__ = [
    "AI_MODULE_CONTRACTS",
    "build_ai_self_understanding_manifest",
    "build_pruned_domain_context",
]
