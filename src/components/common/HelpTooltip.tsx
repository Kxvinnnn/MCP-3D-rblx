import React, { useState } from 'react';
import { HelpCircle, Info } from 'lucide-react';

interface HelpTooltipProps {
  term: string;
  explanation: string;
  variant?: 'inline' | 'icon' | 'badge';
  children?: React.ReactNode;
}

export const HelpTooltip: React.FC<HelpTooltipProps> = ({
  term,
  explanation,
  variant = 'icon',
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <span className="relative inline-flex items-center gap-1 group">
      {children ? (
        <span
          className="cursor-help border-b border-dotted border-slate-500 hover:border-cyan-400 transition-colors"
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
          onClick={() => setIsOpen(!isOpen)}
        >
          {children}
        </span>
      ) : (
        <span className="text-slate-300 font-medium">{term}</span>
      )}

      {variant === 'icon' && (
        <button
          type="button"
          aria-label={`Ayuda sobre ${term}`}
          className="text-slate-500 hover:text-cyan-400 focus:outline-none transition-colors p-0.5 rounded cursor-pointer"
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
          onClick={() => setIsOpen(!isOpen)}
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      )}

      {variant === 'badge' && (
        <button
          type="button"
          className="text-[10px] text-cyan-400/80 hover:text-cyan-300 bg-cyan-950/40 hover:bg-cyan-900/60 px-1.5 py-0.5 rounded border border-cyan-800/40 cursor-pointer"
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
          onClick={() => setIsOpen(!isOpen)}
        >
          ¿Qué es?
        </button>
      )}

      {isOpen && (
        <span
          role="tooltip"
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2.5 bg-slate-900/95 text-slate-200 text-xs rounded-lg shadow-xl border border-slate-700/80 backdrop-blur-sm pointer-events-none animate-in fade-in zoom-in-95 duration-150"
        >
          <span className="font-semibold text-cyan-300 block mb-1 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            {term}
          </span>
          <span className="leading-relaxed text-slate-300 block text-[11px]">
            {explanation}
          </span>
        </span>
      )}
    </span>
  );
};

export const FORGE_GLOSSARY = {
  editableMesh: {
    term: 'EditableMesh',
    explanation: 'Geometría editable en tiempo real. Permite modificar los vértices y caras del modelo 3D directamente dentro de Roblox Studio.',
  },
  surfaceAppearance: {
    term: 'SurfaceAppearance',
    explanation: 'Material realista PBR. Añade textura, relieve (normales), brillo (rugosidad) y reflejos metálicos al modelo en Roblox.',
  },
  sha256: {
    term: 'Huella de Integridad (SHA-256)',
    explanation: 'Huella digital matemática única. Garantiza que el modelo en Roblox y en Forge son idénticos y no han sufrido alteraciones no deseadas.',
  },
  rojoBridge: {
    term: 'Rojo Bridge',
    explanation: 'Sincronizador automático de archivos. Conecta tu proyecto en el disco local con Roblox Studio en tiempo real.',
  },
  lod: {
    term: 'LOD (Nivel de Detalle)',
    explanation: 'Optimización de rendimiento que reduce la cantidad de polígonos del modelo cuando la cámara se aleja en el juego.',
  },
  collisionFidelity: {
    term: 'Fidelidad de Colisión',
    explanation: 'Define cómo interactúan los jugadores físicamente con el modelo: Hull (caja envolvente rápida), Box (cubo simple) o Precise (colisión exacta con cada curva).',
  },
  smartMerge: {
    term: 'Fusión Inteligente',
    explanation: 'Combina cambios de posición hechos en Studio con nuevas piezas creadas en Forge sin sobrescribir el trabajo de ninguno.',
  },
};
