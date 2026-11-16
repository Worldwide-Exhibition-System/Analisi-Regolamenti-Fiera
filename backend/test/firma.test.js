import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canonico, firma, firmaValida, ErroreFirma } from '../firma.js';

const SEGRETO = 'segreto-di-prova-lungo-almeno-trentadue-caratteri';

test('canonico: non dipende dall\'ordine delle chiavi', () => {
  assert.equal(canonico({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), canonico({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
});

test('firma valida sui dati originali, non valida se cambia anche un carattere', () => {
  const dati = { sha256: 'abc', pagine: [{ numero: 1, testo: 'Maximum height of 8ft.', ocr: null }] };
  const f = firma(dati, SEGRETO, 'pagine');
  assert.equal(firmaValida(dati, f, SEGRETO, 'pagine'), true);
  const alterati = structuredClone(dati);
  alterati.pagine[0].testo = 'Maximum height of 9ft.';
  assert.equal(firmaValida(alterati, f, SEGRETO, 'pagine'), false);
});

test('firma di uno scopo non vale per un altro', () => {
  const f = firma({ x: 1 }, SEGRETO, 'pagine');
  assert.equal(firmaValida({ x: 1 }, f, SEGRETO, 'scheda'), false);
});

test('segreto cambiato: firma non valida', () => {
  const f = firma({ x: 1 }, SEGRETO, 'scheda');
  assert.equal(firmaValida({ x: 1 }, f, SEGRETO + '-nuovo', 'scheda'), false);
});

test('firma mancante o vuota: non valida', () => {
  assert.equal(firmaValida({ x: 1 }, undefined, SEGRETO, 'scheda'), false);
  assert.equal(firmaValida({ x: 1 }, '', SEGRETO, 'scheda'), false);
});

test('segreto assente o corto: errore esplicito', () => {
  assert.throws(() => firma({ x: 1 }, '', 'scheda'), ErroreFirma);
  assert.throws(() => firma({ x: 1 }, 'corto', 'scheda'), ErroreFirma);
});
