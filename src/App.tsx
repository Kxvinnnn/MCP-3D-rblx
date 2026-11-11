import React, { useState } from 'react';
import {
  Flame,
  Home,
  Sparkles,
  Box,
  Palette,
  Send,
  Cpu,
  FileCode2,
  Share2,
  FileText,
  Terminal,
  Sliders,
  ChevronDown,
  Check,
  Info,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { ForgeProvider, useForge, PrimaryTab, AdvancedTab } from './context/ForgeContext.tsx';

// 5 Primary Navigation Views
import { HomeView } from './components/views/HomeView.tsx';
import { CreateWizardView } from './components/views/CreateWizardView.tsx';
import { EditView } from './components/views/EditView.tsx';
import { MaterialsView } from './components/views/MaterialsView.tsx';
import { StudioSyncView } from './components/views/StudioSyncView.tsx';

// Developer & Engine Sub-views
import { ModularArchitectureAndAgents } from './components/ModularArchitectureAndAgents.tsx';
import { ScriptGenerator } from './components/ScriptGenerator.tsx';
import { UIGenerator } from './components/UIGenerator.tsx';
import { BackendExplorer } from './components/BackendExplorer.tsx';
import { RojoWorkflowGuide } from './components/RojoWorkflowGuide.tsx';
import { ContextEditor } from './components/ContextEditor.tsx';
import { Forge3DStudio } from './components/Forge3DStudio.tsx';

function MainStudioContent() {
  const {
    activeTab,
    setActiveTab,
    uiMode,
    setUiMode,
    notification,
    setNotification,
    pendingChanges,
    activeAsset,
    showUnsavedModal,
    pendingSwitchTarget,
    confirmSwitchDiscard,
    confirmSwitchSaveAndProceed,
    cancelSwitch,
  } = useForge();

  const [devMenuOpen, setDevMenuOpen] = useState(false);

  const isPrimaryTab = ['home', 'create', 'edit', 'materials', 'studio'].includes(activeTab);

  return (
    <div className="min-h-screen bg-[#07090e] text-gray-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-white">
      {/* Unsaved Changes Confirmation Modal */}
      {showUnsavedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-950/80 border border-amber-800/60 flex items-center justify-center text-amber-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">
                  Cambios pendientes sin guardar
                </h3>
                <p className="text-slate-400 text-xs">
                  {activeAsset?.name || 'Modelo actual'}
                </p>
              </div>
            </div>

            <p className="text-slate-300 text-xs leading-relaxed">
              Has realizado modificaciones que aún no se han guardado en disco ni sincronizado con Roblox. ¿Deseas guardarlas antes de abrir <span className="font-semibold text-white font-mono">{pendingSwitchTarget?.name}</span>?
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={cancelSwitch}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmSwitchDiscard}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/60 text-xs font-semibold cursor-pointer transition"
              >
                Descartar cambios
              </button>
              <button
                type="button"
                onClick={confirmSwitchSaveAndProceed}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold cursor-pointer transition shadow-md shadow-cyan-900/30"
              >
                Guardar y abrir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div
            className={`px-4 py-3 rounded-xl shadow-2xl border text-xs font-medium flex items-center gap-2.5 backdrop-blur-md ${
              notification.type === 'success'
                ? 'bg-emerald-950/95 text-emerald-200 border-emerald-700/80'
                : notification.type === 'error'
                ? 'bg-red-950/95 text-red-200 border-red-700/80'
                : notification.type === 'warning'
                ? 'bg-amber-950/95 text-amber-200 border-amber-700/80'
                : 'bg-slate-900/95 text-slate-200 border-slate-700/80'
            }`}
          >
            {notification.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {notification.type === 'error' && <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />}
            {notification.type === 'warning' && <Info className="w-4 h-4 text-amber-400 shrink-0" />}
            {notification.type === 'info' && <Info className="w-4 h-4 text-cyan-400 shrink-0" />}
            <span>{notification.message}</span>
            <button
              type="button"
              onClick={() => setNotification(null)}
              className="ml-2 text-slate-400 hover:text-white cursor-pointer"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Top Header */}
      <header className="border-b border-slate-800/80 bg-[#0d1117] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Zone 1: Brand Wordmark */}
          <div
            onClick={() => setActiveTab('home')}
            className="flex items-center gap-2.5 cursor-pointer shrink-0"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 p-0.5">
              <div className="w-full h-full bg-[#0d1117] rounded-[10px] flex items-center justify-center">
                <Flame className="w-4 h-4 text-cyan-400" />
              </div>
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-sm tracking-wider text-white whitespace-nowrap">
                FORGE AI STUDIO
              </span>
              <span className="text-[10px] font-medium text-slate-400 whitespace-nowrap">
                Roblox 3D Creation
              </span>
            </div>
          </div>

          {/* Zone 2: 5 Primary Navigation Tabs */}
          <nav className="flex items-center gap-1 overflow-x-auto py-1">
            {/* 1. INICIO */}
            <button
              type="button"
              onClick={() => setActiveTab('home')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                activeTab === 'home'
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Home className="w-3.5 h-3.5" />
              <span>Inicio</span>
            </button>

            {/* 2. CREAR */}
            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                activeTab === 'create'
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Crear</span>
            </button>

            {/* 3. EDITAR */}
            <button
              type="button"
              onClick={() => setActiveTab('edit')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                activeTab === 'edit'
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              <span>Editar</span>
              {pendingChanges && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              )}
            </button>

            {/* 4. MATERIALES */}
            <button
              type="button"
              onClick={() => setActiveTab('materials')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                activeTab === 'materials'
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Materiales</span>
            </button>

            {/* 5. ROBLOX STUDIO */}
            <button
              type="button"
              onClick={() => setActiveTab('studio')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                activeTab === 'studio'
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>Roblox Studio</span>
            </button>
          </nav>

          {/* Zone 3: Mode Switch & Developer Tools */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Mode Switch: Sencillo vs Avanzado */}
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setUiMode('simple')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer whitespace-nowrap ${
                  uiMode === 'simple'
                    ? 'bg-slate-800 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Sencillo
              </button>
              <button
                type="button"
                onClick={() => setUiMode('advanced')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer whitespace-nowrap ${
                  uiMode === 'advanced'
                    ? 'bg-cyan-900/60 text-cyan-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Avanzado
              </button>
            </div>

            {/* In Advanced Mode: Developer Engines Dropdown */}
            {uiMode === 'advanced' && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDevMenuOpen(!devMenuOpen)}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                    !isPrimaryTab
                      ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Motores Dev</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>

                {devMenuOpen && (
                  <div className="absolute right-0 mt-1 w-56 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl py-1 z-50 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('agents');
                        setDevMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left hover:bg-slate-800 flex items-center gap-2 cursor-pointer ${
                        activeTab === 'agents' ? 'text-emerald-400 font-semibold' : 'text-slate-300'
                      }`}
                    >
                      <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Agentes IA (P0-P3)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('script');
                        setDevMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left hover:bg-slate-800 flex items-center gap-2 cursor-pointer ${
                        activeTab === 'script' ? 'text-blue-400 font-semibold' : 'text-slate-300'
                      }`}
                    >
                      <FileCode2 className="w-3.5 h-3.5 text-blue-400" />
                      <span>Luau Engine</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('ui');
                        setDevMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left hover:bg-slate-800 flex items-center gap-2 cursor-pointer ${
                        activeTab === 'ui' ? 'text-purple-400 font-semibold' : 'text-slate-300'
                      }`}
                    >
                      <Palette className="w-3.5 h-3.5 text-purple-400" />
                      <span>UI Engine (2D + 3D)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('rojo');
                        setDevMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left hover:bg-slate-800 flex items-center gap-2 cursor-pointer ${
                        activeTab === 'rojo' ? 'text-teal-400 font-semibold' : 'text-slate-300'
                      }`}
                    >
                      <Share2 className="w-3.5 h-3.5 text-teal-400" />
                      <span>Rojo Bridge Guide</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('context');
                        setDevMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left hover:bg-slate-800 flex items-center gap-2 cursor-pointer ${
                        activeTab === 'context' ? 'text-indigo-400 font-semibold' : 'text-slate-300'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Contexto &amp; Módulos</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('backend');
                        setDevMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left hover:bg-slate-800 flex items-center gap-2 cursor-pointer ${
                        activeTab === 'backend' ? 'text-cyan-400 font-semibold' : 'text-slate-300'
                      }`}
                    >
                      <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Backend Explorer</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">
        {activeTab === 'home' && <HomeView />}
        {activeTab === 'create' && <CreateWizardView />}
        {activeTab === 'edit' && <EditView />}
        {activeTab === 'materials' && <MaterialsView />}
        {activeTab === 'studio' && <StudioSyncView />}

        {/* Developer Secondary Engines (Active in Advanced Mode) */}
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
            <span className="font-bold text-white">Forge AI Studio</span>
            <span>•</span>
            <span>Estudio 3D para Roblox con sincronización en tiempo real</span>
          </div>

          <div className="flex items-center gap-4 text-slate-400 font-mono text-[11px]">
            <span>Plugin v2.2.0</span>
            <span>•</span>
            <span>Rojo 7.x</span>
            <span>•</span>
            <span>Roblox Luau --!strict</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ForgeProvider>
      <MainStudioContent />
    </ForgeProvider>
  );
}
