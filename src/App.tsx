import React, { useState, useEffect } from 'react';
import {
  FileCode2,
  Palette,
  Terminal,
  Share2,
  FileText,
  Activity,
  Flame,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { ScriptGenerator } from './components/ScriptGenerator.tsx';
import { UIGenerator } from './components/UIGenerator.tsx';
import { BackendExplorer } from './components/BackendExplorer.tsx';
import { RojoWorkflowGuide } from './components/RojoWorkflowGuide.tsx';
import { ContextEditor } from './components/ContextEditor.tsx';

export default function App() {
  const [activeTab, setActiveTab] = useState<'script' | 'ui' | 'backend' | 'rojo' | 'context'>('script');
  const [healthStatus, setHealthStatus] = useState<any>(null);

  useEffect(() => {
    fetch('/api/v1/health')
      .then((res) => res.json())
      .then((data) => setHealthStatus(data))
      .catch((err) => console.error('Health check failed:', err));
  }, []);

  return (
    <div className="min-h-screen bg-[#07090e] text-gray-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-white">
      {/* Top Header */}
      <header className="border-b border-gray-800/80 bg-[#0d1117]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-purple-600 p-0.5 shadow-lg shadow-cyan-500/20">
              <div className="w-full h-full bg-[#0d1117] rounded-[10px] flex items-center justify-center">
                <Flame className="w-5 h-5 text-cyan-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-extrabold text-base tracking-wide text-white">
                  FORGE AI
                </h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-blue-600 to-cyan-500 text-white">
                  Luau & Rojo Engine
                </span>
              </div>
              <p className="text-[11px] text-gray-400">
                FastAPI • Official google-genai SDK • Maid Lifecycle • ForgeGUI
              </p>
            </div>
          </div>

          {/* Engine Status Indicators */}
          <div className="hidden md:flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-900 border border-gray-800 text-xs">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-gray-400">Motor:</span>
              <span className="font-mono text-cyan-300 font-semibold">Gemini 2.5 Pro / Flash</span>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-900 border border-gray-800 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-gray-400">Backend:</span>
              <span className="font-semibold text-emerald-400">
                {healthStatus?.gemini_connected ? 'Conectado' : 'Online'}
              </span>
            </div>

            <div className="px-2.5 py-1 rounded-lg bg-purple-950/60 border border-purple-800/60 text-purple-300 font-mono text-[11px]">
              --!strict
            </div>
          </div>
        </div>

        {/* Navigation Tabs Bar */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center gap-1 overflow-x-auto border-t border-gray-800/40 py-1.5">
          <button
            onClick={() => setActiveTab('script')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeTab === 'script'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
            }`}
          >
            <FileCode2 className="w-4 h-4" />
            <span>Generador Luau (Server/Client)</span>
          </button>

          <button
            onClick={() => setActiveTab('ui')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeTab === 'ui'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
            }`}
          >
            <Palette className="w-4 h-4" />
            <span>ForgeGUI (UI Studio)</span>
          </button>

          <button
            onClick={() => setActiveTab('backend')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeTab === 'backend'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Código Backend (Python FastAPI)</span>
          </button>

          <button
            onClick={() => setActiveTab('rojo')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeTab === 'rojo'
                ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
            }`}
          >
            <Share2 className="w-4 h-4" />
            <span>Rojo & Plugin Roblox</span>
          </button>

          <button
            onClick={() => setActiveTab('context')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeTab === 'context'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Contexto del Proyecto (project_context.md)</span>
          </button>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full">
        {activeTab === 'script' && <ScriptGenerator />}
        {activeTab === 'ui' && <UIGenerator />}
        {activeTab === 'backend' && <BackendExplorer />}
        {activeTab === 'rojo' && <RojoWorkflowGuide />}
        {activeTab === 'context' && <ContextEditor />}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800/80 bg-[#0a0d14] py-6 text-xs text-gray-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white">Forge AI Studio</span>
            <span>•</span>
            <span>FastAPI Luau Backend & Roblox Studio Rojo Bridge</span>
          </div>

          <div className="flex items-center gap-4 text-gray-400">
            <span>Powered by Google GenAI SDK (google-genai)</span>
            <span>•</span>
            <span>Roblox Luau --!strict</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
