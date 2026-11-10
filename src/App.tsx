import React, { useState } from 'react';
import {
  Box,
  FileCode2,
  Palette,
  Terminal,
  Share2,
  FileText,
  Flame,
  Cpu,
} from 'lucide-react';
import { Forge3DStudio } from './components/Forge3DStudio.tsx';
import { ModularArchitectureAndAgents } from './components/ModularArchitectureAndAgents.tsx';
import { ScriptGenerator } from './components/ScriptGenerator.tsx';
import { UIGenerator } from './components/UIGenerator.tsx';
import { BackendExplorer } from './components/BackendExplorer.tsx';
import { RojoWorkflowGuide } from './components/RojoWorkflowGuide.tsx';
import { ContextEditor } from './components/ContextEditor.tsx';

type NavTab = 'studio3d' | 'agents' | 'script' | 'ui' | 'rojo' | 'context' | 'backend';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('studio3d');

  return (
    <div className="min-h-screen bg-[#07090e] text-gray-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-white">
      {/* Clean 3-Zone Top Bar */}
      <header className="border-b border-slate-800/80 bg-[#0d1117] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Zone 1: Brand Wordmark */}
          <div
            onClick={() => setActiveTab('studio3d')}
            className="flex items-center gap-2.5 cursor-pointer shrink-0"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 p-0.5">
              <div className="w-full h-full bg-[#0d1117] rounded-[10px] flex items-center justify-center">
                <Flame className="w-4 h-4 text-cyan-400" />
              </div>
            </div>
            <span className="font-extrabold text-sm tracking-wider text-white whitespace-nowrap">
              FORGE AI STUDIO
            </span>
          </div>

          {/* Zone 2: Primary Navigation Links */}
          <nav className="flex items-center gap-1 overflow-x-auto py-1">
            <button
              type="button"
              onClick={() => setActiveTab('studio3d')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                activeTab === 'studio3d'
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              <span>3D Studio &amp; Editor</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('agents')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                activeTab === 'agents'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Motores &amp; Agentes (P0-P3)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('script')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                activeTab === 'script'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5" />
              <span>Luau Engine</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('ui')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                activeTab === 'ui'
                  ? 'bg-purple-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>UI Engine (2D + 3D)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('rojo')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                activeTab === 'rojo'
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Rojo Bridge</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('context')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                activeTab === 'context'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Contexto &amp; Módulos</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('backend')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                activeTab === 'backend'
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Código Motores (FastAPI)</span>
            </button>
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="hidden md:flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('agents')}
              className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-mono font-semibold text-emerald-300 transition cursor-pointer whitespace-nowrap"
            >
              Agentes IA (P3)
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">
        {activeTab === 'studio3d' && <Forge3DStudio />}
        {activeTab === 'agents' && <ModularArchitectureAndAgents />}
        {activeTab === 'script' && <ScriptGenerator />}
        {activeTab === 'ui' && <UIGenerator />}
        {activeTab === 'rojo' && <RojoWorkflowGuide />}
        {activeTab === 'context' && <ContextEditor />}
        {activeTab === 'backend' && <BackendExplorer />}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-[#0a0d14] py-5 text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white">Forge AI Studio v2.0</span>
            <span>•</span>
            <span>7 Motores Modulares: 3D Generation, Asset, Luau, UI, World, Rojo Bridge &amp; Agentes</span>
          </div>

          <div className="flex items-center gap-4 text-slate-400 font-mono text-[11px]">
            <span>FastAPI + google-genai SDK</span>
            <span>•</span>
            <span>Roblox Luau --!strict</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
