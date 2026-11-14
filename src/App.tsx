import { useState } from 'react';
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
  ChevronDown,
  Info,
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Save,
  BookOpen,
  ArrowRight,
} from 'lucide-react';
import { ForgeProvider, useForge } from './context/ForgeContext.tsx';

// 5 Primary Navigation Views
import { HomeView } from './components/views/HomeView.tsx';
import { CreateWizardView } from './components/views/CreateWizardView.tsx';
import { EditView } from './components/views/EditView.tsx';
import { MaterialsView } from './components/views/MaterialsView.tsx';
import { StudioSyncView } from './components/views/StudioSyncView.tsx';

// Interactive Step-by-Step Tutorial Modal
import { InteractiveTutorialModal } from './components/InteractiveTutorialModal.tsx';

// Developer & Engine Sub-views
import { ModularArchitectureAndAgents } from './components/ModularArchitectureAndAgents.tsx';
import { ScriptGenerator } from './components/ScriptGenerator.tsx';
import { UIGenerator } from './components/UIGenerator.tsx';
import { BackendExplorer } from './components/BackendExplorer.tsx';
import { RojoWorkflowGuide } from './components/RojoWorkflowGuide.tsx';
import { ContextEditor } from './components/ContextEditor.tsx';

function MainStudioContent() {
  const {
    activeTab,
    safeNavigateTab,
    uiMode,
    setUiMode,
    notification,
    setNotification,
    pendingChanges,
    activeAsset,
    setActiveAsset,
    assetLibrary,
    saveAssetToDisk,
    pushToStudio,
    bridgeStatus,
    showUnsavedModal,
    pendingSwitchTarget,
    pendingSwitchTab,
    confirmSwitchDiscard,
    confirmSwitchSaveAndProceed,
    cancelSwitch,
  } = useForge();

  const [devMenuOpen, setDevMenuOpen] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);

  const isPrimaryTab = ['home', 'create', 'edit', 'materials', 'studio'].includes(activeTab);

  const destinationLabel = pendingSwitchTarget
    ? `abrir '${pendingSwitchTarget.name}'`
    : pendingSwitchTab
    ? `ir a '${pendingSwitchTab}'`
    : 'continuar';

  return (
    <div className="min-h-screen bg-[#070B14] text-slate-100 flex flex-col font-sans selection:bg-amber-400/30 selection:text-white relative overflow-x-hidden">
      {/* Subtle Ambient Color Glows */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div
          className={`absolute -top-36 -left-36 w-[460px] h-[460px] rounded-full blur-[130px] transition-colors duration-700 ${
            activeTab === 'create'
              ? 'bg-violet-600/20'
              : activeTab === 'edit'
              ? 'bg-cyan-600/20'
              : activeTab === 'materials'
              ? 'bg-fuchsia-600/20'
              : activeTab === 'studio'
              ? 'bg-emerald-600/20'
              : 'bg-amber-500/12'
          }`}
        />
        <div
          className={`absolute top-1/3 -right-36 w-[420px] h-[420px] rounded-full blur-[130px] transition-colors duration-700 ${
            activeTab === 'create'
              ? 'bg-fuchsia-600/15'
              : activeTab === 'edit'
              ? 'bg-indigo-600/15'
              : activeTab === 'materials'
              ? 'bg-amber-500/15'
              : activeTab === 'studio'
              ? 'bg-teal-500/15'
              : 'bg-cyan-500/12'
          }`}
        />
      </div>

      {/* Interactive Detailed Step-by-Step Tutorial Modal */}
      <InteractiveTutorialModal
        isOpen={isTutorialOpen}
        onClose={() => setIsTutorialOpen(false)}
        onNavigateTab={(tab) => safeNavigateTab(tab)}
      />

      {/* Unsaved Changes Confirmation Modal */}
      {showUnsavedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-950/80 border border-amber-800/60 flex items-center justify-center text-amber-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">
                  ¿Guardamos tus cambios antes de salir?
                </h3>
                <p className="text-slate-400 text-xs">
                  {activeAsset?.name || 'Tu modelo'}
                </p>
              </div>
            </div>

            <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
              Hiciste cambios nuevos que todavía no se guardaron. ¿Quieres guardarlos antes de {destinationLabel}?
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={cancelSwitch}
                className="w-full sm:w-auto min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer transition"
              >
                Seguir aquí
              </button>
              <button
                type="button"
                onClick={confirmSwitchDiscard}
                className="w-full sm:w-auto min-h-[40px] px-4 py-2 rounded-xl bg-red-950/70 hover:bg-red-900/80 text-red-200 border border-red-800/60 text-xs font-bold cursor-pointer transition"
              >
                Salir sin guardar
              </button>
              <button
                type="button"
                onClick={confirmSwitchSaveAndProceed}
                className="w-full sm:w-auto min-h-[40px] px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold cursor-pointer transition shadow-md"
              >
                Guardar y seguir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 animate-slide-up max-w-md">
          <div
            className={`px-4 py-3 rounded-2xl shadow-2xl border text-xs sm:text-sm font-medium flex items-center gap-2.5 backdrop-blur-md ${
              notification.type === 'success'
                ? 'bg-emerald-950/95 text-emerald-100 border-emerald-500/60'
                : notification.type === 'error'
                ? 'bg-red-950/95 text-red-100 border-red-500/60'
                : notification.type === 'warning'
                ? 'bg-amber-950/95 text-amber-100 border-amber-500/60'
                : 'bg-indigo-950/95 text-indigo-100 border-indigo-500/60'
            }`}
          >
            {notification.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {notification.type === 'error' && <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />}
            {notification.type === 'warning' && <Info className="w-4 h-4 text-amber-400 shrink-0" />}
            {notification.type === 'info' && <Info className="w-4 h-4 text-cyan-400 shrink-0" />}
            <span className="leading-relaxed">{notification.message}</span>
            <button
              type="button"
              onClick={() => setNotification(null)}
              className="ml-2 text-slate-300 hover:text-white cursor-pointer font-bold"
              aria-label="Cerrar aviso"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Top Header: Clean 3-Zone Navigation */}
      <header className="border-b border-slate-800/80 bg-[#090E1A]/95 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Zone 1: Clean Single-Line Brand Wordmark */}
          <button
            type="button"
            onClick={() => safeNavigateTab('home')}
            className="flex items-center gap-2.5 cursor-pointer shrink-0 text-left group whitespace-nowrap"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-400 via-orange-500 to-fuchsia-500 p-0.5 group-hover:scale-105 transition duration-200 shadow-md">
              <div className="w-full h-full bg-[#090E1A] rounded-[10px] flex items-center justify-center">
                <Flame className="w-5 h-5 text-amber-400" />
              </div>
            </div>
            <span className="font-display font-extrabold text-base tracking-wide text-white whitespace-nowrap">
              Forge AI Studio
            </span>
          </button>

          {/* Zone 2: Kid-Friendly Main Menu Tabs */}
          <nav className="hidden lg:flex items-center gap-1.5 bg-slate-900/90 p-1.5 rounded-2xl border border-slate-800">
            <button
              type="button"
              onClick={() => safeNavigateTab('home')}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap forge-btn-press ${
                activeTab === 'home'
                  ? 'bg-amber-400 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Home className="w-4 h-4" />
              <span>Inicio</span>
            </button>

            <button
              type="button"
              onClick={() => safeNavigateTab('create')}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap forge-btn-press ${
                activeTab === 'create'
                  ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Crear</span>
            </button>

            <button
              type="button"
              onClick={() => safeNavigateTab('edit')}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap forge-btn-press ${
                activeTab === 'edit'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Box className="w-4 h-4" />
              <span>Editar 3D</span>
            </button>

            <button
              type="button"
              onClick={() => safeNavigateTab('materials')}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap forge-btn-press ${
                activeTab === 'materials'
                  ? 'bg-gradient-to-r from-fuchsia-500 to-amber-500 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Palette className="w-4 h-4" />
              <span>Pintar</span>
            </button>

            <button
              type="button"
              onClick={() => safeNavigateTab('studio')}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap forge-btn-press ${
                activeTab === 'studio'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Send className="w-4 h-4" />
              <span>Mandar a Roblox</span>
            </button>
          </nav>

          {/* Zone 3: Clear Help Button + Simple/Pro Mode Switch */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsTutorialOpen(true)}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 text-xs sm:text-sm font-extrabold flex items-center gap-2 cursor-pointer transition shadow-md whitespace-nowrap forge-btn-press"
              title="Abrir guía paso a paso súper fácil"
            >
              <BookOpen className="w-4 h-4" />
              <span>¿Cómo se usa?</span>
            </button>

            <button
              type="button"
              onClick={() => setUiMode(uiMode === 'simple' ? 'advanced' : 'simple')}
              className={`min-h-[40px] px-3 py-2 rounded-xl border text-xs font-bold transition cursor-pointer whitespace-nowrap hidden sm:flex items-center gap-1.5 ${
                uiMode === 'advanced'
                  ? 'bg-indigo-950/80 border-indigo-500/60 text-indigo-200'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
              }`}
              title="Cambiar entre vista fácil y herramientas de programador"
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>{uiMode === 'advanced' ? 'Modo Pro' : 'Modo Fácil'}</span>
            </button>

            {uiMode === 'advanced' && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDevMenuOpen(!devMenuOpen)}
                  className={`min-h-[40px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1 transition cursor-pointer whitespace-nowrap ${
                    !isPrimaryTab
                      ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                      : 'bg-slate-900 border-slate-800 text-slate-200 hover:text-white'
                  }`}
                >
                  <span>Avanzado</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {devMenuOpen && (
                  <div className="absolute right-0 mt-1 w-56 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl py-1 z-50 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        safeNavigateTab('agents');
                        setDevMenuOpen(false);
                      }}
                      className="w-full px-3 py-2.5 text-left hover:bg-slate-800 flex items-center gap-2 cursor-pointer text-slate-200"
                    >
                      <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Agentes IA (P0-P3)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        safeNavigateTab('script');
                        setDevMenuOpen(false);
                      }}
                      className="w-full px-3 py-2.5 text-left hover:bg-slate-800 flex items-center gap-2 cursor-pointer text-slate-200"
                    >
                      <FileCode2 className="w-3.5 h-3.5 text-blue-400" />
                      <span>Luau Engine</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        safeNavigateTab('ui');
                        setDevMenuOpen(false);
                      }}
                      className="w-full px-3 py-2.5 text-left hover:bg-slate-800 flex items-center gap-2 cursor-pointer text-slate-200"
                    >
                      <Palette className="w-3.5 h-3.5 text-purple-400" />
                      <span>UI Engine (2D + 3D)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        safeNavigateTab('rojo');
                        setDevMenuOpen(false);
                      }}
                      className="w-full px-3 py-2.5 text-left hover:bg-slate-800 flex items-center gap-2 cursor-pointer text-slate-200"
                    >
                      <Share2 className="w-3.5 h-3.5 text-teal-400" />
                      <span>Rojo Bridge Guide</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        safeNavigateTab('context');
                        setDevMenuOpen(false);
                      }}
                      className="w-full px-3 py-2.5 text-left hover:bg-slate-800 flex items-center gap-2 cursor-pointer text-slate-200"
                    >
                      <FileText className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Contexto &amp; Módulos</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        safeNavigateTab('backend');
                        setDevMenuOpen(false);
                      }}
                      className="w-full px-3 py-2.5 text-left hover:bg-slate-800 flex items-center gap-2 cursor-pointer text-slate-200"
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

        {/* Mobile / Tablet Navigation Bar (Compact to stay well under 15% viewport height) */}
        <div className="flex lg:hidden items-center justify-around border-t border-slate-800/80 bg-slate-950/95 px-2 py-1 overflow-x-auto">
          {[
            { id: 'home', label: 'Inicio', icon: Home, activeClass: 'bg-amber-400 text-slate-950' },
            { id: 'create', label: 'Crear', icon: Sparkles, activeClass: 'bg-violet-500 text-white' },
            { id: 'edit', label: 'Editar', icon: Box, activeClass: 'bg-cyan-500 text-slate-950' },
            { id: 'materials', label: 'Pintar', icon: Palette, activeClass: 'bg-fuchsia-500 text-white' },
            { id: 'studio', label: 'Roblox', icon: Send, activeClass: 'bg-emerald-500 text-slate-950' },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => safeNavigateTab(tab.id as any)}
                className={`min-h-[36px] px-3 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                  isActive ? `${tab.activeClass} shadow-sm` : 'text-slate-300 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Kid-Friendly Active Model Ribbon */}
        {isPrimaryTab && (activeAsset || assetLibrary.length > 0) && (
          <div className="border-t border-slate-800/70 bg-slate-950/85">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <FolderOpen className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="font-bold whitespace-nowrap">Modelo elegido:</span>
                </div>

                {assetLibrary.length > 0 ? (
                  <select
                    aria-label="Elegir otro modelo guardado"
                    value={activeAsset?.name || ''}
                    onChange={(e) => {
                      const found = assetLibrary.find((a) => a.name === e.target.value);
                      if (found) setActiveAsset(found);
                    }}
                    className="bg-slate-900 border border-slate-700 hover:border-cyan-400 rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-cyan-400 cursor-pointer max-w-[240px] truncate transition"
                  >
                    {!activeAsset && <option value="">— Elige un modelo —</option>}
                    {activeAsset && !assetLibrary.some((a) => a.name === activeAsset.name) && (
                      <option value={activeAsset.name}>{activeAsset.name} (Nuevo)</option>
                    )}
                    {assetLibrary.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name} ({item.parts?.length || 0} partes)
                      </option>
                    ))}
                  </select>
                ) : activeAsset ? (
                  <span className="text-xs font-bold text-white">{activeAsset.name}</span>
                ) : null}

                {activeAsset && (
                  <div className="hidden sm:flex items-center gap-2 text-xs text-slate-300 tabular-nums">
                    <span className="text-slate-600">·</span>
                    <span>{activeAsset.parts.length} partes</span>
                    <span className="text-slate-600">·</span>
                    <span className={pendingChanges ? 'text-amber-300 font-bold' : 'text-emerald-300 font-semibold'}>
                      {pendingChanges ? 'Sin guardar' : 'Guardado'}
                    </span>
                  </div>
                )}
              </div>

              {activeAsset && (
                <div className="flex items-center gap-2">
                  {pendingChanges && (
                    <button
                      type="button"
                      onClick={() => saveAssetToDisk(true)}
                      className="px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Guardar</span>
                    </button>
                  )}

                  {activeTab === 'home' || activeTab === 'create' ? (
                    <button
                      type="button"
                      onClick={() => safeNavigateTab('edit')}
                      className="px-3.5 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap shadow-sm"
                    >
                      <Box className="w-3.5 h-3.5" />
                      <span>Abrir en Editor 3D</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  ) : activeTab === 'edit' ? (
                    <button
                      type="button"
                      onClick={() => safeNavigateTab('materials')}
                      className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-fuchsia-500 to-amber-500 hover:from-fuchsia-400 hover:to-amber-400 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap shadow-sm"
                    >
                      <Palette className="w-3.5 h-3.5" />
                      <span>Pintar Colores</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => pushToStudio(activeAsset)}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap shadow-sm"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Mandar a Roblox</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full relative z-10">
        {activeTab === 'home' && <HomeView onOpenTutorial={() => setIsTutorialOpen(true)} />}
        {activeTab === 'create' && <CreateWizardView />}
        {activeTab === 'edit' && <EditView />}
        {activeTab === 'materials' && <MaterialsView />}
        {activeTab === 'studio' && <StudioSyncView />}

        {/* Developer Secondary Engines (Active in Pro Mode) */}
        {activeTab === 'agents' && <ModularArchitectureAndAgents />}
        {activeTab === 'script' && <ScriptGenerator />}
        {activeTab === 'ui' && <UIGenerator />}
        {activeTab === 'rojo' && <RojoWorkflowGuide />}
        {activeTab === 'context' && <ContextEditor />}
        {activeTab === 'backend' && <BackendExplorer />}
      </main>

      {/* Clean, Kid-Friendly Footer */}
      <footer className="border-t border-slate-800/80 bg-[#060911] py-4 text-xs text-slate-400 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-bold text-slate-200">Forge AI Studio</span>
            <span className="text-slate-700">·</span>
            <span>Creador fácil de modelos 3D para Roblox</span>
          </div>

          <div className="flex items-center gap-3 text-slate-400 text-xs flex-wrap">
            <span className={bridgeStatus.robloxStudio.connected ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
              Roblox Studio: {bridgeStatus.robloxStudio.connected ? 'Conectado' : 'Sin conectar'}
            </span>
            <span className="text-slate-700">·</span>
            <button
              type="button"
              onClick={() => setIsTutorialOpen(true)}
              className="text-amber-300 hover:text-amber-200 font-bold cursor-pointer"
            >
              Abrir guía fácil
            </button>
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
