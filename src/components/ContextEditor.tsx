import React, { useState, useEffect } from 'react';
import {
  Save,
  Check,
  RotateCcw,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  PackageCheck,
  Wrench,
} from 'lucide-react';

interface AuditedModule {
  module_name: string;
  require_expression: string;
  expected_rojo_path: string;
  exists_on_disk: boolean;
}

export const ContextEditor: React.FC = () => {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [auditedModules, setAuditedModules] = useState<AuditedModule[]>([]);
  const [bootstrapping, setBootstrapping] = useState<boolean>(false);

  const fetchContextAndAudit = async () => {
    setLoading(true);
    try {
      const [ctxRes, auditRes] = await Promise.all([
        fetch('/api/v1/context'),
        fetch('/api/v1/context/audit'),
      ]);
      const ctxData = await ctxRes.json();
      const auditData = await auditRes.json();
      setContent(ctxData.content || '');
      setAuditedModules(auditData.modules || []);
    } catch (err) {
      console.error('Error fetching context or audit:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContextAndAudit();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/v1/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 2500);
        const auditRes = await fetch('/api/v1/context/audit');
        const auditData = await auditRes.json();
        setAuditedModules(auditData.modules || []);
      }
    } catch (e) {
      console.error('Error saving context:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleBootstrapModules = async () => {
    setBootstrapping(true);
    try {
      const res = await fetch('/api/v1/context/bootstrap-modules', {
        method: 'POST',
      });
      if (res.ok) {
        const auditRes = await fetch('/api/v1/context/audit');
        const auditData = await auditRes.json();
        setAuditedModules(auditData.modules || []);
      }
    } catch (e) {
      console.error('Error bootstrapping modules:', e);
    } finally {
      setBootstrapping(false);
    }
  };

  const missingCount = auditedModules.filter((m) => !m.exists_on_disk).length;

  return (
    <div className="flex flex-col gap-5">
      {/* On-Disk Module Existence Verification Card */}
      <div className="p-5 rounded-2xl bg-[#0d1117] border border-slate-800 shadow-xl flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <PackageCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="text-sm font-bold text-white">
                Auditoría de Existencia Física de Módulos en Rojo (Anti-Broken Requires)
              </h3>
              <p className="text-xs text-slate-400">
                Antes de enviar <code className="text-cyan-300">project_context.md</code> a Gemini, el backend verifica en disco si cada módulo referenciado existe realmente en <code className="text-cyan-300">ROJO_PROJECT_PATH</code>.
              </p>
            </div>
          </div>

          {missingCount > 0 && (
            <button
              type="button"
              onClick={handleBootstrapModules}
              disabled={bootstrapping}
              className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>
                {bootstrapping
                  ? 'Instalando...'
                  : `Instalar ${missingCount} Módulo(s) Faltante(s) en Disco`}
              </span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {auditedModules.map((mod) => (
            <div
              key={mod.module_name}
              className={`p-3.5 rounded-xl border flex flex-col justify-between gap-2 ${
                mod.exists_on_disk
                  ? 'bg-emerald-950/20 border-emerald-500/30'
                  : 'bg-amber-950/30 border-amber-500/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-xs text-white">{mod.module_name}</span>
                {mod.exists_on_disk ? (
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px] flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> EN DISCO
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px] flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> NO ENCONTRADO
                  </span>
                )}
              </div>
              <div className="font-mono text-[11px] text-cyan-300 truncate">
                {mod.expected_rojo_path}
              </div>
              <div className="font-mono text-[10px] text-slate-400 truncate">
                {mod.require_expression}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Markdown Editor Header */}
      <div className="p-5 rounded-2xl bg-[#0d1117] border border-gray-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyan-400" />
            Editor de Contexto Local: project_context.md
          </h3>
          <p className="text-xs text-gray-400 mt-1 max-w-2xl leading-relaxed">
            Este archivo es leído y auditado por el backend antes de cada solicitud a Gemini. Si algún módulo listado aquí no existiera físicamente en disco, el motor inyecta automáticamente una implementación inline segura para evitar errores de ejecución.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={fetchContextAndAudit}
            title="Recargar desde disco"
            className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 font-bold text-xs text-white flex items-center gap-2 transition active:scale-95 shadow-lg shadow-emerald-600/20 disabled:opacity-50 cursor-pointer"
          >
            {savedSuccess ? (
              <>
                <Check className="w-4 h-4 text-white" />
                Guardado y Auditado!
              </>
            ) : saving ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Guardar project_context.md
              </>
            )}
          </button>
        </div>
      </div>

      {/* Editor Box */}
      <div className="rounded-xl border border-gray-800 bg-[#0b0e14] overflow-hidden shadow-2xl flex flex-col">
        <div className="bg-[#121620] px-4 py-2.5 border-b border-gray-800 flex items-center justify-between text-xs">
          <span className="font-mono text-cyan-400 font-semibold flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            project_context.md (Markdown format)
          </span>
          <span className="text-[11px] text-gray-400 font-mono">
            Auditado en disco antes de cada llamada a Gemini
          </span>
        </div>

        <div className="p-4 bg-[#080b10]">
          {loading ? (
            <div className="text-gray-500 text-center py-12 font-mono text-xs">
              Cargando project_context.md...
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={20}
              className="w-full bg-transparent font-mono text-xs leading-relaxed text-gray-200 focus:outline-none resize-y selection:bg-cyan-500/30"
              placeholder="Escribe las convenciones de tu proyecto aquí..."
            />
          )}
        </div>
      </div>
    </div>
  );
};
