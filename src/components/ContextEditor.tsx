import React, { useState, useEffect } from 'react';
import { Save, Check, RotateCcw, FileText, Sparkles, CheckCircle2 } from 'lucide-react';

export const ContextEditor: React.FC = () => {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  const fetchContext = () => {
    setLoading(true);
    fetch('/api/v1/context')
      .then((res) => res.json())
      .then((data) => {
        setContent(data.content || '');
      })
      .catch((err) => console.error('Error fetching context:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchContext();
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
      }
    } catch (e) {
      console.error('Error saving context:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="p-5 rounded-2xl bg-gray-900/90 border border-gray-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyan-400" />
            Editor de Contexto Local: project_context.md
          </h3>
          <p className="text-xs text-gray-400 mt-1 max-w-2xl leading-relaxed">
            Este archivo es leído por el backend local antes de cada solicitud a Gemini. Cualquier regla, módulo existente (ej. Maid) o convención que agregues aquí será respetada automáticamente en todo el código generado.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={fetchContext}
            title="Recargar desde disco"
            className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 font-bold text-xs text-white flex items-center gap-2 transition active:scale-95 shadow-lg shadow-emerald-600/20 disabled:opacity-50 cursor-pointer"
          >
            {savedSuccess ? (
              <>
                <Check className="w-4 h-4 text-white" />
                Guardado en Disco!
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
            Inyectado en cada llamada a Gemini
          </span>
        </div>

        <div className="p-4 bg-[#080b10]">
          {loading ? (
            <div className="text-gray-500 text-center py-12 animate-pulse font-mono text-xs">
              Cargando project_context.md...
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={22}
              className="w-full bg-transparent font-mono text-xs leading-relaxed text-gray-200 focus:outline-none resize-y selection:bg-cyan-500/30"
              placeholder="Escribe las convenciones de tu proyecto aquí..."
            />
          )}
        </div>
      </div>
    </div>
  );
};
