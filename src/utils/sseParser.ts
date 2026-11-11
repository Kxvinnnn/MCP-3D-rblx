/**
 * Robust, spec-compliant Server-Sent Events (SSE) stream parser.
 * Properly handles:
 * - CRLF (\r\n), LF (\n), and legacy CR (\r) line terminators.
 * - Chunk boundaries splitting \r and \n across different chunks.
 * - Multi-line data buffers (consecutive 'data:' lines).
 * - Custom event types ('event: error', 'event: stage', etc.).
 * - Trailing buffer flushing at end-of-stream.
 */

export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

export class SseStreamParser {
  private buffer: string = '';
  private currentEvent: string = 'message';
  private currentDataLines: string[] = [];
  private currentId: string | undefined = undefined;

  /**
   * Feeds a string chunk into the parser and returns any completed SSE messages.
   */
  public feed(chunk: string): SseMessage[] {
    const messages: SseMessage[] = [];
    this.buffer += chunk;

    let index = 0;
    const len = this.buffer.length;

    while (index < len) {
      // Find the next line break (\r, \n, or \r\n)
      let lineEnd = -1;
      let nextIndex = -1;

      for (let i = index; i < len; i++) {
        const char = this.buffer[i];
        if (char === '\r') {
          lineEnd = i;
          if (i + 1 < len) {
            // If immediately followed by \n, advance past both
            nextIndex = this.buffer[i + 1] === '\n' ? i + 2 : i + 1;
          } else {
            // Trailing \r at the very end of current buffer.
            // Wait for next chunk to determine if followed by \n.
            lineEnd = -1;
            nextIndex = -1;
          }
          break;
        } else if (char === '\n') {
          lineEnd = i;
          nextIndex = i + 1;
          break;
        }
      }

      // If no complete line terminator found in remaining buffer, stop loop
      if (lineEnd === -1) {
        break;
      }

      const line = this.buffer.slice(index, lineEnd);
      index = nextIndex;

      // An empty line indicates dispatch of the accumulated event
      if (line.length === 0) {
        if (this.currentDataLines.length > 0) {
          messages.push({
            event: this.currentEvent,
            data: this.currentDataLines.join('\n'),
            id: this.currentId,
          });
        }
        // Reset state for next event
        this.currentEvent = 'message';
        this.currentDataLines = [];
        this.currentId = undefined;
      } else if (line.startsWith(':')) {
        // SSE comment, ignore
        continue;
      } else if (line.startsWith('data:')) {
        // Strip single leading space if present per spec
        const val = line.slice(5).replace(/^\s/, '');
        this.currentDataLines.push(val);
      } else if (line.startsWith('event:')) {
        this.currentEvent = line.slice(6).trim();
      } else if (line.startsWith('id:')) {
        this.currentId = line.slice(3).trim();
      }
    }

    // Retain incomplete buffer
    this.buffer = this.buffer.slice(index);
    return messages;
  }

  /**
   * Flushes any remaining data at the end of the stream when connection terminates.
   */
  public flush(): SseMessage[] {
    const messages: SseMessage[] = [];
    if (this.buffer.length > 0) {
      const line = this.buffer.trim();
      if (line.startsWith('data:')) {
        this.currentDataLines.push(line.slice(5).replace(/^\s/, ''));
      } else if (line.startsWith('event:')) {
        this.currentEvent = line.slice(6).trim();
      }
      this.buffer = '';
    }

    if (this.currentDataLines.length > 0) {
      messages.push({
        event: this.currentEvent,
        data: this.currentDataLines.join('\n'),
        id: this.currentId,
      });
      this.currentEvent = 'message';
      this.currentDataLines = [];
      this.currentId = undefined;
    }

    return messages;
  }
}
