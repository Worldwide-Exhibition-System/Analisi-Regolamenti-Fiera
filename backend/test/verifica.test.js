// Test della verifica deterministica delle citazioni.
// I casi sintetici controllano la normalizzazione; quelli sul regolamento NPE
// (solo livello di testo, senza lettura ottica) controllano il comportamento su
// un PDF vero, compresa la citazione inventata che deve essere respinta.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  normalizza, frammenti, indicizza, verificaCitazione, verificaVoce, MOTIVO_NON_TROVATA
} from '../verifica.js';
import { leggiPdf, chiudiOcr } from '../lettura.js';

const FIXTURE = fileURLToPath(new URL('../../fixtures/regolamenti/', import.meta.url));

// ── Normalizzazione ────────────────────────────────────────────────────────

test('normalizza: virgolette, apostrofi e trattini tipografici', () => {
  assert.equal(normalizza('company’s “booth” – A'), normalizza('company\'s "booth" - A'));
});

test('normalizza: sillabazione a fine riga e spazi', () => {
  assert.equal(normalizza('two 3ft. tall parti-\ntions on each side'), normalizza('two 3ft. tall partitions on each  side'));
});

test('normalizza: trattino reale spezzato a fine riga', () => {
  assert.equal(normalizza('Multi-\nLevel Booths'), normalizza('Multi-Level Booths'));
});

test('normalizza: legature e maiuscole', () => {
  assert.equal(normalizza('ﬁre EXTINGUISHER'), normalizza('fire extinguisher'));
});

test('frammenti: ellissi interne separano, quelle ai bordi si ignorano', () => {
  assert.deepEqual(frammenti('...before the conclusion'), ['before the conclusion']);
  assert.deepEqual(frammenti('Exhibitor is liable … move-out period'), ['Exhibitor is liable', 'move-out period']);
});

// ── Casi sintetici ─────────────────────────────────────────────────────────

const sintetico = indicizza([
  { numero: 1, testo: 'Introduzione generale al regolamento tecnico della manifestazione.' },
  { numero: 2, testo: 'L’altezza massima degli allestimenti è di 6,00 m.\nGli elementi so-\nspesi devono stare entro 8 m.' },
  { numero: 3, testo: 'Le pedane non possono superare i 10 cm di altezza.' },
  { numero: 4, testo: 'Pagina senza contenuti rilevanti per lo stand.' },
  { numero: 5, testo: 'Le cielinature piene sono vietate oltre i 20 mq.' },
  { numero: 6, testo: '%%%', ocr: 'Il progetto va presentato entro il 15 marzo 2027.' }
]);

test('citazione presente alla pagina indicata', () => {
  const r = verificaCitazione('L\'altezza massima degli allestimenti è di 6,00 m.', 2, sintetico);
  assert.deepEqual(r, { verificata: true, pagina: 2, metodo: 'testo' });
});

test('citazione con sillabazione a fine riga nel PDF', () => {
  const r = verificaCitazione('Gli elementi sospesi devono stare entro 8 m.', 2, sintetico);
  assert.equal(r.verificata, true);
});

test('pagina sbagliata di poco: trovata e corretta', () => {
  const r = verificaCitazione('Le pedane non possono superare i 10 cm di altezza.', 4, sintetico);
  assert.deepEqual(r, { verificata: true, pagina: 3, metodo: 'testo' });
});

test('pagina troppo lontana: non trovata', () => {
  const r = verificaCitazione('Le cielinature piene sono vietate oltre i 20 mq.', 1, sintetico);
  assert.equal(r.verificata, false);
  assert.equal(r.motivo, MOTIVO_NON_TROVATA);
});

test('citazione trovata solo nel testo della lettura ottica', () => {
  const r = verificaCitazione('Il progetto va presentato entro il 15 marzo 2027.', 6, sintetico);
  assert.deepEqual(r, { verificata: true, pagina: 6, metodo: 'ocr' });
});

test('valore alterato: respinta', () => {
  const r = verificaCitazione('L\'altezza massima degli allestimenti è di 7,00 m.', 2, sintetico);
  assert.equal(r.verificata, false);
});

test('citazione troppo breve: respinta', () => {
  const r = verificaCitazione('6,00 m', 2, sintetico);
  assert.equal(r.verificata, false);
});

test('frammenti in ordine sbagliato: respinta', () => {
  const r = verificaCitazione('Gli elementi sospesi devono stare entro 8 m. … L\'altezza massima degli allestimenti', 2, sintetico);
  assert.equal(r.verificata, false);
});

test('frammenti in ordine con ellissi: accettata', () => {
  const r = verificaCitazione('L\'altezza massima degli allestimenti … elementi sospesi devono stare entro 8 m.', 2, sintetico);
  assert.equal(r.verificata, true);
});

test('fonte sconosciuta: respinta', () => {
  const r = verificaCitazione('L\'altezza massima degli allestimenti è di 6,00 m.', 2, undefined);
  assert.equal(r.verificata, false);
});

// ── Stato delle voci ───────────────────────────────────────────────────────

const indici = new Map([['f1', sintetico]]);

test('voce confermata con citazione vera resta confermata', () => {
  const v = verificaVoce({
    id: 'altezza_max', stato: 'confermato', valore: '6,00 m',
    citazioni: [{ fonte: 'f1', pagina: 2, testo: 'L’altezza massima degli allestimenti è di 6,00 m.' }]
  }, indici);
  assert.equal(v.stato, 'confermato');
  assert.equal(v.citazioni[0].verificata, true);
  assert.equal(v.citazioni[0].metodo, 'testo');
});

test('voce confermata con una citazione su due non trovata scende a da_verificare', () => {
  const v = verificaVoce({
    id: 'altezza_max', stato: 'confermato', valore: '6,00 m',
    citazioni: [
      { fonte: 'f1', pagina: 2, testo: 'L’altezza massima degli allestimenti è di 6,00 m.' },
      { fonte: 'f1', pagina: 2, testo: 'Nelle aree esterne l’altezza può arrivare a 9 m.' }
    ]
  }, indici);
  assert.equal(v.stato, 'da_verificare');
  assert.equal(v.motivo, MOTIVO_NON_TROVATA);
  assert.equal(v.statoProposto, 'confermato');
});

test('voce confermata senza citazioni scende a da_verificare', () => {
  const v = verificaVoce({ id: 'x', stato: 'confermato', valore: '6 m', citazioni: [] }, indici);
  assert.equal(v.stato, 'da_verificare');
});

test('da_verificare e non_specificato non salgono mai a confermato', () => {
  const cit = [{ fonte: 'f1', pagina: 3, testo: 'Le pedane non possono superare i 10 cm di altezza.' }];
  assert.equal(verificaVoce({ id: 'a', stato: 'da_verificare', citazioni: cit }, indici).stato, 'da_verificare');
  assert.equal(verificaVoce({ id: 'b', stato: 'non_specificato', citazioni: cit }, indici).stato, 'non_specificato');
});

test('stato sconosciuto proposto dal modello: da_verificare', () => {
  assert.equal(verificaVoce({ id: 'c', stato: 'chiarito', citazioni: [] }, indici).stato, 'da_verificare');
});

// ── Regolamento NPE vero ───────────────────────────────────────────────────

let regolamento;

before(async () => {
  const lettura = await leggiPdf(readFileSync(FIXTURE + 'NPE_Show_Rules_and_Regulations.pdf'));
  regolamento = new Map([['f1', indicizza(lettura.pagine)]]);
});

after(chiudiOcr);

test('NPE: citazione vera del golden (Reg. 6.17, p.20) confermata', () => {
  const v = verificaVoce({
    id: 'insegne_neon', stato: 'confermato', valore: 'Vietate',
    citazioni: [{ fonte: 'f1', pagina: 20, testo: 'Signs involving the use of neon or similar gases are prohibited.' }]
  }, regolamento);
  assert.equal(v.stato, 'confermato');
  assert.equal(v.citazioni[0].metodo, 'testo');
});

test('NPE: citazione inventata di proposito respinta', () => {
  const v = verificaVoce({
    id: 'altezza_insegne', stato: 'confermato', valore: '30 ft',
    citazioni: [{ fonte: 'f1', pagina: 20, testo: 'Hanging signs may not exceed 30ft in height in any exhibit hall.' }]
  }, regolamento);
  assert.equal(v.stato, 'da_verificare');
  assert.equal(v.citazioni[0].verificata, false);
  assert.equal(v.motivo, MOTIVO_NON_TROVATA);
});

test('NPE: citazione vera con un numero cambiato respinta', () => {
  const v = verificaVoce({
    id: 'portata_pavimento', stato: 'confermato', valore: '500 PSF',
    citazioni: [{ fonte: 'f1', pagina: 17, testo: 'The floor load capacity is 500 pounds per square foot (PSF) in the South and North exhibit halls' }]
  }, regolamento);
  assert.equal(v.stato, 'da_verificare');
});

test('NPE: due frasi vere di articoli diversi incollate insieme respinte', () => {
  const v = verificaVoce({
    id: 'combinata', stato: 'confermato', valore: 'x',
    citazioni: [{ fonte: 'f1', pagina: 20, testo: 'Signs involving the use of neon or similar gases are prohibited. The floor load capacity is 400 pounds per square foot' }]
  }, regolamento);
  assert.equal(v.stato, 'da_verificare');
});

test('NPE: pagina indicata sbagliata di uno, corretta', () => {
  const v = verificaVoce({
    id: 'insegne_neon', stato: 'confermato', valore: 'Vietate',
    citazioni: [{ fonte: 'f1', pagina: 19, testo: 'Signs involving the use of neon or similar gases are prohibited.' }]
  }, regolamento);
  assert.equal(v.stato, 'confermato');
  assert.equal(v.citazioni[0].pagina, 20);
  assert.equal(v.citazioni[0].paginaIndicata, 19);
});
