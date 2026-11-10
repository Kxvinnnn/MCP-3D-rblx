import React, { useEffect, useRef, useState } from 'react';
import {
  Terminal,
  Minimize2,
  Maximize2,
  Trash2,
  CheckCircle2,
  FolderSync,
  Sparkles,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Activity,
} from 'lucide-react';

export interface TerminalLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'stream' | 'rojo' | 'success' | 'error';
  message: string;
}

interface FloatingTerminalLogProps {
  title?: string;
  logs: TerminalLogEntry[];
  streamingBuffer: string;
  isStreaming: boolean;
  onClear: () => void;
}

export const FloatingTerminalLog: React.FC<FloatingTerminalLogProps> = ({
  title = 'Forge AI Live Stream & Rojo Console',
  logs,
  streamingBuffer,
  isStreaming,
  onClear,
}) => {
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new logs or streaming chunks
  useEffect(() => {
    if (!isMinimized && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [logs, streamingBuffer, isMinimized]);

  // Automatically un-minimize when streaming starts
  useEffect(() => {
    if (isStreaming) {
      setIsMinimized(false);
    }
  }, [isStreaming]);

  const hasActivity = logs.length > 0 || Boolean(streamingBuffer) || isStreaming;

  const getBadgeStyle = (level: TerminalLogEntry['level']) => {
    switch (level) {
      case 'rojo':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
      case 'success':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'error':
        return 'bg-red-500/20 text-red-300 border-red-500/40';
      case 'stream':
        return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
      default:
        return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
    }
  };

  const getLevelLabel = (level: TerminalLogEntry['level']) => {
    switch (level) {
      case 'rojo':
        return 'ROJO-FS';
      case 'success':
        return 'DONE';
      case 'error':
        return 'ERROR';
      case 'stream':
        return 'GEMINI';
      default:
        return 'SYSTEM';
    }
  };

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 transition-all duration-300 ease-out ${
        isExpanded
          ? 'w-[92vw] max-w-4xl'
          : isMinimized
          ? 'w-80'
          : 'w-[92vw] sm:w-[540px]'
      }`}
    >
      <div className="rounded-xl border border-gray-700/80 bg-[#090c12]/95 backdrop-blur-xl shadow-2xl shadow-black/80 overflow-hidden flex flex-col">
        {/* Terminal Header Bar */}
        <div
          onClick={() => setIsMinimized(!isMinimized)}
          className="bg-[#121722] border-b border-gray-800 px-3.5 py-2.5 flex items-center justify-between cursor-pointer select-none"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
            </div>

            <div className="h-3.5 w-px bg-gray-700" />

            <div className="flex items-center gap-2 truncate">
              <Terminal className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="font-mono text-xs font-bold text-gray-200 truncate">
                {title}
              </span>
            </div>

            {isStreaming ? (
              <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-mono text-[10px] flex items-center gap-1 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                STREAMING
              </span>
            ) : hasActivity ? (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono text-[10px] shrink-0">
                IDLE ({logs.length})
              </span>
            ) : null}
          </div>

          <div
            className="flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onClear}
              title="Limpiar consola"
              className="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            {!isMinimized && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                title={isExpanded ? 'Contraer ancho' : 'Expandir ancho'}
                className="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition cursor-pointer"
              >
                {isExpanded ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>
            )}

            <button
              onClick={() => setIsMinimized(!isMinimized)}
              title={isMinimized ? 'Mostrar terminal' : 'Minimizar terminal'}
              className="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition cursor-pointer"
            >
              {isMinimized ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Terminal Body */}
        {!isMinimized && (
          <div
            ref={scrollContainerRef}
            className={`p-3.5 font-mono text-xs overflow-y-auto space-y-2 transition-all ${
              isExpanded ? 'max-h-[420px] min-h-[260px]' : 'max-h-[280px] min-h-[180px]'
            }`}
          >
            {logs.length === 0 && !streamingBuffer && !isStreaming ? (
              <div className="h-36 flex flex-col items-center justify-center text-gray-500 text-center">
                <Activity className="w-5 h-5 text-gray-600 mb-1.5" />
                <p className="text-[11px]">
                  Consola en espera. Inicia una generación para ver el stream de Gemini y la escritura de archivos en Rojo en tiempo real.
                </p>
              </div>
            ) : (
              <>
                {logs.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2 leading-relaxed animate-in fade-in duration-150"
                  >
                    <span className="text-gray-600 text-[10px] shrink-0 mt-0.5 select-none">
                      [{entry.timestamp}]
                    </span>

                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold border shrink-0 ${getBadgeStyle(
                        entry.level
                      )}`}
                    >
                      {getLevelLabel(entry.level)}
                    </span>

                    <span
                      className={`break-all ${
                        entry.level === 'rojo'
                          ? 'text-purple-200 font-semibold'
                          : entry.level === 'success'
                          ? 'text-emerald-300 font-semibold'
                          : entry.level === 'error'
                          ? 'text-red-300'
                          : 'text-gray-300'
                      }`}
                    >
                      {entry.message}
                    </span>
                  </div>
                ))}

                {/* Live Streaming JSON / Luau Token Buffer */}
                {(isStreaming || streamingBuffer) && (
                  <div className="mt-2 pt-2 border-t border-gray-800/80">
                    <div className="flex items-center justify-between text-[10px] text-cyan-400 mb-1">
                      <span className="flex items-center gap-1.5 font-bold">
                        <Sparkles className="w-3 h-3 animate-spin" />
                        STREAM PAYLOAD (REAL-TIME CHUNKS)
                      </span>
                      <span>{streamingBuffer.length} chars</span>
                    </div>
                    <pre className="p-2.5 rounded-lg bg-black/70 border border-cyan-500/20 text-[11px] text-cyan-200/90 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                      {streamingBuffer}
                      {isStreaming && (
                        <span className="inline-block w-2 h-3.5 bg-cyan-400 ml-0.5 animate-pulse align-middle" />
                      )}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Footer Status */}
        {!isMinimized && (
          <div className="bg-[#0d1119] border-t border-gray-800/80 px-3.5 py-1.5 flex items-center justify-between text-[10px] font-mono text-gray-400">
            <div className="flex items-center gap-1.5">
              <FolderSync className="w-3 h-3 text-purple-400" />
              <span>Rojo Target: ./rojo_workspace</span>
            </div>
            <div className="flex items-center gap-1.5">
              {isStreaming ? (
                <span className="text-cyan-400">Recibiendo paquetes SSE...</span>
              ) : (
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Canal SSE Activo
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
