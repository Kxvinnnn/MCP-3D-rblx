import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SseStreamParser } from '../src/utils/sseParser.ts';

test('1. SseStreamParser procesa eventos simples estándar con terminador LF (\n\n)', () => {
  const parser = new SseStreamParser();
  const messages = parser.feed('event: stage\ndata: {"stage": "init", "message": "Iniciando"}\n\n');

  assert.equal(messages.length, 1);
  assert.equal(messages[0].event, 'stage');
  const parsed = JSON.parse(messages[0].data);
  assert.equal(parsed.stage, 'init');
});

test('2. SseStreamParser procesa correctamente eventos con CRLF (\r\n\r\n)', () => {
  const parser = new SseStreamParser();
  const messages = parser.feed('event: log\r\ndata: {"message": "Compilando shaders"}\r\n\r\n');

  assert.equal(messages.length, 1);
  assert.equal(messages[0].event, 'log');
  const parsed = JSON.parse(messages[0].data);
  assert.equal(parsed.message, 'Compilando shaders');
});

test('3. CRÍTICO: SseStreamParser maneja CRLF dividido exactamente en el límite de dos fragmentos (\r en chunk 1, \n en chunk 2)', () => {
  const parser = new SseStreamParser();

  // Chunk 1 termina con \r
  const chunk1 = 'event: stage\r\ndata: {"stage": "geometry"}\r';
  // Chunk 2 comienza con \n\r\n (completando la primera línea de corte y la línea vacía de cierre)
  const chunk2 = '\n\r\n';

  const res1 = parser.feed(chunk1);
  assert.equal(res1.length, 0, 'No debe emitir el evento hasta recibir el salto de línea completo');

  const res2 = parser.feed(chunk2);
  assert.equal(res2.length, 1, 'Debe emitir exactamente 1 evento tras recibir el segundo fragmento');
  assert.equal(res2[0].event, 'stage');
  const parsed = JSON.parse(res2[0].data);
  assert.equal(parsed.stage, 'geometry');
});

test('4. SseStreamParser procesa un evento fragmentado a través de múltiples trozos pequeños', () => {
  const parser = new SseStreamParser();
  const chunks = [
    'data: {"ty',
    'pe": "ro',
    'jo_write", ',
    '"saved": tr',
    'ue}\n',
    '\n',
  ];

  let allMessages: any[] = [];
  for (const c of chunks) {
    allMessages.push(...parser.feed(c));
  }

  assert.equal(allMessages.length, 1);
  const parsed = JSON.parse(allMessages[0].data);
  assert.equal(parsed.type, 'rojo_write');
  assert.equal(parsed.saved, true);
});

test('5. SseStreamParser procesa múltiples eventos juntos en un único fragmento', () => {
  const parser = new SseStreamParser();
  const singleChunk =
    'event: log\ndata: {"msg": "Paso 1"}\n\n' +
    'event: log\ndata: {"msg": "Paso 2"}\n\n' +
    'event: complete\ndata: {"status": "ok"}\n\n';

  const messages = parser.feed(singleChunk);
  assert.equal(messages.length, 3);
  assert.equal(messages[0].event, 'log');
  assert.equal(messages[1].event, 'log');
  assert.equal(messages[2].event, 'complete');
  assert.equal(JSON.parse(messages[2].data).status, 'ok');
});

test('6. SseStreamParser procesa datos multilínea (consecutivas data:) y descarta comentarios', () => {
  const parser = new SseStreamParser();
  const raw =
    ': esto es un comentario que debe ignorarse\n' +
    'event: message\n' +
    'data: primera_linea\n' +
    'data: segunda_linea\n' +
    'id: 1042\n\n';

  const messages = parser.feed(raw);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, '1042');
  assert.equal(messages[0].data, 'primera_linea\nsegunda_linea');
});

test('7. SseStreamParser vacía (flush) el buffer residual al terminar el stream sin terminador doble', () => {
  const parser = new SseStreamParser();
  // El servidor cierra el stream sin enviar la última línea vacía \n\n
  const incompleteChunk = 'event: done\ndata: {"finished": true}';
  const mid = parser.feed(incompleteChunk);
  assert.equal(mid.length, 0);

  // Al invocar flush(), el buffer residual se procesa y emite
  const flushed = parser.flush();
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].event, 'done');
  assert.equal(JSON.parse(flushed[0].data).finished, true);
});
