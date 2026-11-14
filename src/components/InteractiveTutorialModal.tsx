import React, { useState } from 'react';
import {
  Sparkles,
  Box,
  Palette,
  Send,
  X,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  MousePointerClick,
  BookOpen,
  Play,
  Layers,
  Download,
} from 'lucide-react';
import { PrimaryTab } from '../context/ForgeContext.tsx';

interface InteractiveTutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateTab: (tab: PrimaryTab) => void;
}

interface TutorialStep {
  id: number;
  badge: string;
  title: string;
  subtitle: string;
  accentGradient: string;
  accentBorder: string;
  accentText: string;
  icon: React.ComponentType<{ className?: string }>;
  targetTab: PrimaryTab;
  ctaLabel: string;
  points: { title: string; desc: string; colorDot: string }[];
  tip: string;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 1,
    badge: 'Bienvenida',
    title: '¡Hola! ¿Cómo se usa Forge AI Studio?',
    subtitle:
      'Es súper fácil: solo tienes que seguir 4 pasos simples de izquierda a derecha en el menú de arriba. ¡No necesitas saber programar!',
    accentGradient: 'from-amber-400 via-orange-500 to-pink-500',
    accentBorder: 'border-amber-400/40',
    accentText: 'text-amber-300',
    icon: BookOpen,
    targetTab: 'home',
    ctaLabel: 'Ir al Inicio',
    points: [
      {
        title: '1. Crear',
        desc: 'Elige un árbol, un cofre, una torre o escribe con tus palabras lo que quieres construir.',
        colorDot: 'bg-violet-400',
      },
      {
        title: '2. Editar 3D',
        desc: 'Mira tu creación desde todos los lados y usa los botones - y + para moverla o cambiar su tamaño.',
        colorDot: 'bg-cyan-400',
      },
      {
        title: '3. Pintar',
        desc: 'Ponle colores geniales y texturas como oro brillante, piedra, madera o neón.',
        colorDot: 'bg-fuchsia-400',
      },
      {
        title: '4. Mandar a Roblox',
        desc: 'Pasa tu modelo directo a tu mapa de Roblox Studio o descárgalo para arrastrarlo con el ratón.',
        colorDot: 'bg-emerald-400',
      },
    ],
    tip: 'Truco de Bill Cipher: Arriba siempre verás qué modelo tienes elegido y un botón rápido para ir al siguiente paso.',
  },
  {
    id: 2,
    badge: 'Paso 1 · Crear',
    title: 'Crea un Árbol o Objeto en 3 Clics',
    subtitle:
      'No tienes que dibujar nada a mano. La app arma las piezas 3D por ti en unos segundos.',
    accentGradient: 'from-violet-500 via-fuchsia-500 to-emerald-500',
    accentBorder: 'border-violet-500/40',
    accentText: 'text-violet-300',
    icon: Sparkles,
    targetTab: 'create',
    ctaLabel: '¡Ir a Crear ahora!',
    points: [
      {
        title: 'Clic 1: Elige qué tipo de cosa quieres',
        desc: 'Por ejemplo: Árboles, Objetos y Cofres, Rocas, Castillos o Muebles.',
        colorDot: 'bg-violet-400',
      },
      {
        title: 'Clic 2: Toca un estilo listo o escribe tu idea',
        desc: 'Si elegiste Árboles, tienes 5 estilos ya listos en 1 clic (Roble, Pino, Sauce, Bonsái o Fantasía Rojizo).',
        colorDot: 'bg-fuchsia-400',
      },
      {
        title: 'Clic 3: Pulsa "¡Crear Modelo 3D Ahora!"',
        desc: 'Espera unos segundos a que se arme y ¡listo! Si quieres, también puedes cambiarle la altura o los colores antes.',
        colorDot: 'bg-emerald-400',
      },
    ],
    tip: 'Truco rápido: Haz doble clic en cualquier tarjeta del Paso 1 para avanzar directo sin pulsar Siguiente.',
  },
  {
    id: 3,
    badge: 'Paso 2 · Editar 3D',
    title: 'Mueve la Cámara y Ajusta las Partes',
    subtitle:
      'En el Editor 3D puedes darle la vuelta a tu creación como si fuera un juguete y ajustar cada parte.',
    accentGradient: 'from-cyan-500 via-sky-500 to-indigo-600',
    accentBorder: 'border-cyan-500/40',
    accentText: 'text-cyan-300',
    icon: Box,
    targetTab: 'edit',
    ctaLabel: 'Abrir Editor 3D',
    points: [
      {
        title: 'Cómo mover la cámara con el ratón',
        desc: 'Clic izquierdo y arrastra para GIRAR · Rueda del ratón para ACERCAR o ALEJAR · Clic derecho para MOVER la vista.',
        colorDot: 'bg-cyan-400',
      },
      {
        title: 'Cambiar el tamaño o posición de una parte',
        desc: 'Haz clic sobre cualquier parte en el visor 3D (o en la lista de la izquierda) y usa los botones - y + de la derecha.',
        colorDot: 'bg-sky-400',
      },
      {
        title: 'Poner en el suelo y Descargar',
        desc: 'Pulsa "Poner en Suelo (Y=0)" para que no quede flotando. En "Descargar" puedes bajarlo listo para Roblox.',
        colorDot: 'bg-indigo-400',
      },
    ],
    tip: '¿Te equivocaste en algo? No pasa nada: pulsa "Deshacer" arriba para volver atrás.',
  },
  {
    id: 4,
    badge: 'Paso 3 · Pintar',
    title: 'Pinta con Colores y Materiales Geniales',
    subtitle:
      'Haz que tu modelo brille como oro, parezca piedra real o tenga textura futurista.',
    accentGradient: 'from-fuchsia-500 via-pink-500 to-amber-500',
    accentBorder: 'border-fuchsia-500/40',
    accentText: 'text-fuchsia-300',
    icon: Palette,
    targetTab: 'materials',
    ctaLabel: 'Ir a Pintar',
    points: [
      {
        title: '1. Elige pintar todo o una sola parte',
        desc: 'Puedes pintar todo el modelo completo de una vez o elegir solo una parte (por ejemplo, solo el techo o solo el tronco).',
        colorDot: 'bg-fuchsia-400',
      },
      {
        title: '2. Elige un acabado bonito',
        desc: 'Prueba Oro Pulido, Titanio, Piedra Granito, Fibra de Carbono u Obsidiana.',
        colorDot: 'bg-pink-400',
      },
      {
        title: '3. Escoge tu color favorito y pulsa Aplicar',
        desc: 'Verás cómo cambia al instante en la pantalla 3D de la derecha.',
        colorDot: 'bg-amber-400',
      },
    ],
    tip: 'También puedes tocar directamente una pieza dentro del visor 3D para seleccionarla y pintarla por separado.',
  },
  {
    id: 5,
    badge: 'Paso 4 · Mandar a Roblox',
    title: '¡Lleva tu Modelo a Roblox Studio!',
    subtitle:
      'Tienes dos maneras súper fáciles de meter lo que creaste dentro de tu propio juego en Roblox.',
    accentGradient: 'from-emerald-500 via-teal-500 to-cyan-500',
    accentBorder: 'border-emerald-500/40',
    accentText: 'text-emerald-300',
    icon: Send,
    targetTab: 'studio',
    ctaLabel: 'Ir a Mandar a Roblox',
    points: [
      {
        title: 'Forma súper fácil (sin instalar nada)',
        desc: 'En "Editar 3D", pulsa "Descargar" y elige "Roblox (.rbxmx)". Luego solo arrastra ese archivo desde tu PC hacia adentro de Roblox Studio.',
        colorDot: 'bg-emerald-400',
      },
      {
        title: 'Forma automática (en vivo con el Plugin)',
        desc: 'Si tienes el plugin puesto en Roblox Studio, pulsa "Enviar Modelo a Roblox" y aparecerá mágicamente en tu mapa.',
        colorDot: 'bg-teal-400',
      },
      {
        title: 'Traer cosas desde tu mapa de Roblox',
        desc: 'También puedes seleccionar algo dentro de Roblox Studio y traerlo aquí para pintarlo o mejorarlo.',
        colorDot: 'bg-cyan-400',
      },
    ],
    tip: '¡Y eso es todo! Ya estás listo para construir mundos increíbles. Puedes volver a abrir esta guía cuando quieras.',
  },
];

export const InteractiveTutorialModal: React.FC<InteractiveTutorialModalProps> = ({
  isOpen,
  onClose,
  onNavigateTab,
}) => {
  const [currentIdx, setCurrentIdx] = useState(0);

  if (!isOpen) return null;

  const step = TUTORIAL_STEPS[currentIdx];
  const StepIcon = step.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl bg-[#0B101E] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden animate-slide-up">
        {/* Top Gradient Ribbon */}
        <div className={`h-2 w-full bg-gradient-to-r ${step.accentGradient}`} />

        {/* Modal Header */}
        <div className="px-6 pt-5 pb-4 border-b border-slate-800/80 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${step.accentGradient} p-0.5 shadow-lg shrink-0`}
            >
              <div className="w-full h-full bg-[#0B101E] rounded-[14px] flex items-center justify-center">
                <StepIcon className="w-5 h-5 text-white" />
              </div>
            </div>
            <div>
              <span className={`text-xs font-bold ${step.accentText}`}>
                {step.badge}
              </span>
              <h2 className="text-lg sm:text-xl font-extrabold text-white leading-tight">
                {step.title}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer transition flex items-center justify-center"
            title="Cerrar guía"
            aria-label="Cerrar guía"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Interactive Step Selector */}
        <div className="px-6 py-3 bg-slate-950/70 border-b border-slate-800/70 flex items-center gap-2 overflow-x-auto">
          {TUTORIAL_STEPS.map((s, idx) => {
            const active = idx === currentIdx;
            const completed = idx < currentIdx;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setCurrentIdx(idx)}
                className={`min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap ${
                  active
                    ? `bg-gradient-to-r ${s.accentGradient} text-white shadow-md`
                    : completed
                    ? 'bg-slate-800/90 text-emerald-300 border border-emerald-500/30'
                    : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
                }`}
              >
                {completed ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <span className="font-mono text-[11px]">{idx + 1}.</span>
                )}
                <span>
                  {idx === 0
                    ? 'Inicio'
                    : idx === 1
                    ? '1. Crear'
                    : idx === 2
                    ? '2. Editar 3D'
                    : idx === 3
                    ? '3. Pintar'
                    : '4. A Roblox'}
                </span>
              </button>
            );
          })}
        </div>

        {/* Main Body Content */}
        <div className="p-6 space-y-5 max-h-[65vh] overflow-y-auto">
          <p className="text-slate-200 text-sm sm:text-base leading-relaxed">{step.subtitle}</p>

          <div className="grid grid-cols-1 gap-3">
            {step.points.map((pt, i) => (
              <div
                key={i}
                className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex items-start gap-3.5"
              >
                <div className="mt-1.5 shrink-0">
                  <span className={`w-3 h-3 rounded-full block ${pt.colorDot}`} />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-white">{pt.title}</h4>
                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">{pt.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {step.id === 3 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              <div className="bg-cyan-950/30 border border-cyan-500/30 rounded-xl p-3 text-center space-y-1">
                <MousePointerClick className="w-4 h-4 text-cyan-400 mx-auto" />
                <div className="text-xs font-bold text-white">Clic Izquierdo</div>
                <div className="text-[11px] text-cyan-200/90">Girar el modelo 360°</div>
              </div>
              <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-xl p-3 text-center space-y-1">
                <Layers className="w-4 h-4 text-indigo-400 mx-auto" />
                <div className="text-xs font-bold text-white">Rueda del Ratón</div>
                <div className="text-[11px] text-indigo-200/90">Acercar o alejar</div>
              </div>
              <div className="bg-violet-950/30 border border-violet-500/30 rounded-xl p-3 text-center space-y-1">
                <Download className="w-4 h-4 text-violet-400 mx-auto" />
                <div className="text-xs font-bold text-white">Tocar una Parte</div>
                <div className="text-[11px] text-violet-200/90">Elegirla para cambiarla</div>
              </div>
            </div>
          )}

          <div className={`rounded-2xl border ${step.accentBorder} bg-slate-950/80 p-4 flex items-center justify-between gap-4 flex-wrap`}>
            <p className="text-xs sm:text-sm text-slate-200 font-medium flex-1">{step.tip}</p>
            <button
              type="button"
              onClick={() => {
                onNavigateTab(step.targetTab);
                onClose();
              }}
              className={`min-h-[40px] px-4 py-2 rounded-xl bg-gradient-to-r ${step.accentGradient} text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer forge-btn-press shadow-md whitespace-nowrap`}
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              <span>{step.ctaLabel}</span>
            </button>
          </div>
        </div>

        {/* Modal Footer Navigation */}
        <div className="px-6 py-4 bg-slate-950/90 border-t border-slate-800/80 flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={currentIdx === 0}
            onClick={() => setCurrentIdx((prev) => Math.max(0, prev - 1))}
            className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
              currentIdx === 0
                ? 'bg-slate-900 text-slate-600 cursor-not-allowed'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer'
            }`}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Anterior</span>
          </button>

          <span className="text-xs font-mono text-slate-400 tabular-nums">
            {currentIdx + 1} de {TUTORIAL_STEPS.length}
          </span>

          {currentIdx < TUTORIAL_STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setCurrentIdx((prev) => Math.min(TUTORIAL_STEPS.length - 1, prev + 1))}
              className={`min-h-[40px] px-5 py-2.5 rounded-xl bg-gradient-to-r ${step.accentGradient} text-white text-xs font-extrabold flex items-center gap-2 cursor-pointer forge-btn-press shadow-lg`}
            >
              <span>Siguiente</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                onNavigateTab('create');
                onClose();
              }}
              className="min-h-[40px] px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 text-xs font-extrabold flex items-center gap-2 cursor-pointer forge-btn-press shadow-lg"
            >
              <Sparkles className="w-4 h-4" />
              <span>¡Empezar a Crear!</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
