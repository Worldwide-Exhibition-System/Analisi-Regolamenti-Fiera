// Test della lettura dei PDF: Appendice A con livello di testo corrotto,
// lettura ottica, metodo registrato sulla citazione e casi di errore.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { leggiPdf, chiudiOcr, misuraLeggibilita, ErroreLettura, DICITURA_CONSEGNA } from '../lettura.js';
import { indicizza, verificaVoce, normalizza } from '../verifica.js';
import { pdfDiProva } from './pdf-di-prova.js';

const FIXTURE = fileURLToPath(new URL('../../fixtures/regolamenti/', import.meta.url));
const APPENDICE = 'NPE_APPENDIX_A_-_Booth_Types2C_Dimensions2C_Display_Measurement_Rules.pdf';
const CITAZIONE_P1 = 'Maximum height of 8ft. ; permitted only in the rear five feet of the booth space.';

let appendice;

before(async () => {
  appendice = await leggiPdf(readFileSync(FIXTURE + APPENDICE));
});

after(chiudiOcr);

test('Appendice A: tutte le pagine riconosciute illeggibili e lette per via ottica', () => {
  assert.equal(appendice.numeroPagine, 5);
  for (const p of appendice.pagine) {
    assert.equal(p.leggibilita.leggibile, false, `pagina ${p.numero} non riconosciuta come corrotta`);
    assert.ok(p.ocr && p.ocr.length > 500, `pagina ${p.numero} senza testo ottico`);
  }
});

test('Appendice A, pagina 1: la lettura ottica contiene la citazione del collaudo manuale', () => {
  const p1 = appendice.pagine[0];
  assert.ok(!normalizza(p1.testo).includes(normalizza(CITAZIONE_P1)), 'la citazione non deve stare nel testo corrotto');
  assert.ok(normalizza(p1.ocr).includes(normalizza(CITAZIONE_P1)));
});

test('Appendice A, pagina 1: la voce resta confermata con metodo ocr', () => {
  const v = verificaVoce({
    id: 'altezza_max_inline', stato: 'confermato', valore: '8 ft, solo nei 5 ft posteriori',
    citazioni: [{ fonte: 'f2', pagina: 1, testo: CITAZIONE_P1 }]
  }, new Map([['f2', indicizza(appendice.pagine)]]));
  assert.equal(v.stato, 'confermato');
  assert.equal(v.citazioni[0].metodo, 'ocr');
  assert.equal(v.citazioni[0].pagina, 1);
});

test('leggibilità: testo normale leggibile, testo spostato di 29 caratteri no', () => {
  const normale = 'All booths must have flooring in the form of carpet or other material that is not the pre-existing concrete floor.';
  const spostato = [...normale].map((c) => (c === ' ' ? '\u0003' : String.fromCharCode(c.charCodeAt(0) - 29))).join('');
  assert.equal(misuraLeggibilita(normale).leggibile, true);
  assert.equal(misuraLeggibilita(spostato).leggibile, false);
});

test('file che non è un PDF: respinto', async () => {
  await assert.rejects(leggiPdf(Buffer.from('Questo è un file di testo.')), (e) => e instanceof ErroreLettura && e.codice === 'non_pdf');
});

test('PDF protetto da password: messaggio chiaro', async () => {
  await assert.rejects(leggiPdf(pdfDiProva({ cifrato: true })), (e) => e instanceof ErroreLettura && e.codice === 'password');
});

test('PDF senza testo e senza contenuto leggibile: respinto come illeggibile', async () => {
  await assert.rejects(leggiPdf(pdfDiProva({ testo: null })), (e) => e instanceof ErroreLettura && e.codice === 'illeggibile');
});

test('PDF di consegna caricato come regolamento: respinto con il messaggio previsto', async () => {
  await assert.rejects(
    leggiPdf(pdfDiProva({ testo: DICITURA_CONSEGNA })),
    (e) => e instanceof ErroreLettura && e.codice === 'pdf_consegna' &&
      e.message === 'Questo è il PDF di consegna. Per riprendere il lavoro carica il file di lavoro (.json)'
  );
});
