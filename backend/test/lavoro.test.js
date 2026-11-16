// Test del file di lavoro: sigilli, firma, ripresa, manomissioni, riverifica,
// fusione con nuovi regolamenti e proposte della chat.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sigilla, sigilloValido, firmaScheda, verificaScheda, riverifica, controllaSigilli,
  MOTIVO_FIRMA, ErroreFileLavoro
} from '../lavoro.js';
import { fondiVoci, stessoValore, MOTIVO_CONFLITTO } from '../fusione.js';
import { normalizzaRisposta, contestoVoce } from '../chat.js';
import { indicizza, verificaVoce } from '../verifica.js';

const SEGRETO = 'segreto-di-prova-lungo-almeno-trentadue-caratteri';
const ALTRO_SEGRETO = 'un-altro-segreto-lungo-almeno-trentadue-caratteri';

const pagineF1 = [
  { numero: 1, testo: 'The maximum height of all booth structures is 4 meters in every hall.' },
  { numero: 2, testo: 'Hanging structures require prior approval by the technical office.' }
];
const pagineF2 = [
  { numero: 1, testo: 'Stand structures may not exceed a height of 5 meters in Hall 3.' },
  { numero: 2, testo: 'Rigging points must be requested at least 30 days before move-in.' }
];
const fonti = [
  { id: 'f1', file: 'Regolamento ente.pdf', ruolo: 'ente', pagine: 2, sha256: 'a'.repeat(64) },
  { id: 'f2', file: 'Regolamento organizzatore.pdf', ruolo: 'organizzatore', pagine: 2, sha256: 'b'.repeat(64) }
];
const indici = new Map([['f1', indicizza(pagineF1)], ['f2', indicizza(pagineF2)]]);

// Voce come esce dall'estrazione: verificata dal codice e sigillata dal server
function estratta(voce) {
  return sigilla(verificaVoce(voce, indici), fonti, SEGRETO);
}

function schedaDiProva() {
  const altezza = estratta({
    id: 'altezza_max', sezione: 'A', parametro: 'Altezza massima', valore: '4 m', stato: 'confermato',
    citazioni: [{ fonte: 'f1', pagina: 1, testo: 'The maximum height of all booth structures is 4 meters' }],
    chiarimento: null, note: null
  });
  const appendimenti = estratta({
    id: 'appendimenti_autorizzazione', sezione: 'D', parametro: 'Appendimenti: autorizzazione', valore: 'Approvazione preventiva',
    stato: 'da_verificare', motivo: 'ufficio non indicato',
    citazioni: [{ fonte: 'f1', pagina: 2, testo: 'Hanging structures require prior approval by the technical office.' }],
    chiarimento: null, note: null
  });
  const portata = {
    id: 'appendimenti_portata_punto', sezione: 'D', parametro: 'Portata massima per punto (kg)', valore: '',
    stato: 'non_specificato', motivo: null, citazioni: [], note: null,
    chiarimento: { tipo: 'chiarito', valore: '250 kg', fonte: 'mail dell\'ente fiera del 12/11', da: 'Nome PM', il: '2026-11-12T10:00:00Z', nota: '' }
  };
  return {
    id: 'prova', commessa: { numero: '001-2027', pm: 'Nome PM' },
    fiera: { nome: 'Fiera di prova', edizione: '2027', date: '' },
    creata: { da: 'Nome PM', il: '2026-11-12T09:00:00Z' }, aggiornata: { da: 'Nome PM', il: '2026-11-12T10:00:00Z' },
    fonti: [fonti[0]],
    voci: [altezza, appendimenti, portata],
    chat: [{ voce: 'appendimenti_portata_punto', ruolo: 'pm', testo: '250 kg, da mail dell\'ente', il: '2026-11-12T10:00:00Z' }]
  };
}

// ── Sigilli ────────────────────────────────────────────────────────────────

test('sigillo: solo sulle voci confermate con citazioni verificate', () => {
  const s = schedaDiProva();
  assert.ok(s.voci[0].sigillo, 'la voce confermata deve avere il sigillo');
  assert.equal(s.voci[1].sigillo, undefined);
  assert.equal(s.voci[2].sigillo, undefined);
  assert.equal(sigilloValido(s.voci[0], s.fonti, SEGRETO), true);
});

test('sigillo: non vale se la conferma viene spostata su un altro parametro o sezione', () => {
  const v = schedaDiProva().voci[0];
  assert.equal(sigilloValido({ ...v, parametro: 'Portata massima per punto (kg)' }, fonti, SEGRETO), false);
  assert.equal(sigilloValido({ ...v, sezione: 'D' }, fonti, SEGRETO), false);
});

test('sigillo: non vale se cambia il valore, la citazione o il PDF di origine', () => {
  const v = schedaDiProva().voci[0];
  assert.equal(sigilloValido({ ...v, valore: '6 m' }, fonti, SEGRETO), false);
  assert.equal(sigilloValido({ ...v, citazioni: [{ ...v.citazioni[0], testo: 'The maximum height is 6 meters' }] }, fonti, SEGRETO), false);
  const altroPdf = [{ ...fonti[0], sha256: 'c'.repeat(64) }];
  assert.equal(sigilloValido(v, altroPdf, SEGRETO), false);
});

// ── File di lavoro: ripresa ────────────────────────────────────────────────

test('file di lavoro salvato e ricaricato: scheda identica, risposte del PM intatte', () => {
  const originale = schedaDiProva();
  const { scheda, firma, declassate } = firmaScheda(originale, SEGRETO);
  assert.equal(declassate, 0);
  // passaggio da file: serializzazione e rilettura
  const file = JSON.parse(JSON.stringify({ formato: 'wes-scheda-regolamenti', versione: 1, scheda, firma }));
  const esito = verificaScheda(file.scheda, file.firma, SEGRETO, 'file');
  assert.equal(esito.valida, true);
  assert.deepEqual(esito.scheda, originale);
  assert.deepEqual(esito.scheda.voci[2].chiarimento, originale.voci[2].chiarimento);
});

test('file modificato a mano: non valido, confermate a da_verificare, risposte del PM mantenute', () => {
  const { scheda, firma } = firmaScheda(schedaDiProva(), SEGRETO);
  const manomessa = structuredClone(scheda);
  manomessa.voci[1].stato = 'confermato'; // tentativo di far passare una voce per verificata
  const esito = verificaScheda(manomessa, firma, SEGRETO, 'file');
  assert.equal(esito.valida, false);
  assert.ok(esito.scheda.voci.every((v) => v.stato !== 'confermato'), 'nessuna voce deve restare confermata');
  assert.equal(esito.scheda.voci[0].motivo, MOTIVO_FIRMA);
  assert.equal(esito.scheda.voci[0].daRiverificare, true);
  assert.deepEqual(esito.scheda.voci[2].chiarimento, scheda.voci[2].chiarimento);
  assert.equal(esito.declassate, 2);
});

test('file senza firma o con segreto cambiato: stesso trattamento', () => {
  const { scheda, firma } = firmaScheda(schedaDiProva(), SEGRETO);
  for (const [f, segreto] of [[undefined, SEGRETO], ['', SEGRETO], [firma, ALTRO_SEGRETO]]) {
    const esito = verificaScheda(structuredClone(scheda), f, segreto, 'file');
    assert.equal(esito.valida, false);
    assert.equal(esito.scheda.voci[0].stato, 'da_verificare');
  }
});

test('firma del file: una conferma senza sigillo non viene firmata come confermata', () => {
  const s = schedaDiProva();
  s.voci[1] = { ...s.voci[1], stato: 'confermato' }; // modificata nel browser
  s.voci[2] = { ...s.voci[2], stato: 'confermato', valore: '250 kg' }; // risposta del PM spacciata per conferma
  const { scheda, declassate } = firmaScheda(s, SEGRETO);
  assert.equal(declassate, 2);
  assert.equal(scheda.voci[0].stato, 'confermato');
  assert.equal(scheda.voci[1].stato, 'da_verificare');
  assert.equal(scheda.voci[2].stato, 'da_verificare');
  assert.equal(scheda.voci[2].chiarimento.tipo, 'chiarito', 'la risposta del PM resta, ma non diventa conferma');
});

test('firma del file: sigillo copiato da un\'altra voce non vale', () => {
  const s = schedaDiProva();
  s.voci[1] = { ...s.voci[1], stato: 'confermato', sigillo: s.voci[0].sigillo };
  assert.equal(firmaScheda(s, SEGRETO).scheda.voci[1].stato, 'da_verificare');
});

test('file che non è una scheda: errore esplicito', () => {
  assert.throws(() => verificaScheda({ ciao: 1 }, '', SEGRETO), ErroreFileLavoro);
  assert.throws(() => firmaScheda(null, SEGRETO), ErroreFileLavoro);
});

test('autosalvataggio del browser: restano confermate solo le voci con sigillo valido', () => {
  const s = schedaDiProva();
  s.voci[1] = { ...s.voci[1], stato: 'confermato' };
  const esito = verificaScheda(s, null, SEGRETO, 'autosalvataggio');
  assert.equal(esito.scheda.voci[0].stato, 'confermato');
  assert.equal(esito.scheda.voci[1].stato, 'da_verificare');
  assert.equal(esito.declassate, 1);
});

// ── Riverifica con i regolamenti ricaricati ────────────────────────────────

test('riverifica: con il PDF ricaricato la voce torna confermata, con sigillo', () => {
  const { scheda } = verificaScheda(firmaScheda(schedaDiProva(), SEGRETO).scheda, 'firma-sbagliata', SEGRETO, 'file');
  assert.equal(scheda.voci[0].stato, 'da_verificare');
  const esito = riverifica(scheda.voci, [{ ...fonti[0], pagine: pagineF1 }], SEGRETO);
  assert.equal(esito.ripristinate, 1);
  assert.equal(esito.voci[0].stato, 'confermato');
  assert.equal(sigilloValido(esito.voci[0], [fonti[0]], SEGRETO), true);
  assert.equal(esito.voci[1].stato, 'da_verificare', 'una voce che il modello non aveva confermato resta aperta');
});

test('riverifica: con un PDF diverso la citazione non si ritrova e la voce resta aperta', () => {
  const { scheda } = verificaScheda(firmaScheda(schedaDiProva(), SEGRETO).scheda, 'x', SEGRETO, 'file');
  const altro = [{ ...fonti[0], pagine: [{ numero: 1, testo: 'The maximum height of booth structures is 6 meters.' }] }];
  const esito = riverifica(scheda.voci, altro, SEGRETO);
  assert.equal(esito.ripristinate, 0);
  assert.equal(esito.voci[0].stato, 'da_verificare');
});

// ── Fusione con nuovi regolamenti ──────────────────────────────────────────

test('fusione: stesso dato da due fonti, citazioni sommate e conferma risigillata', () => {
  const s = schedaDiProva();
  const nuova = estratta({
    id: 'altezza_max', sezione: 'A', parametro: 'Altezza massima', valore: 'massimo 4 m', stato: 'confermato',
    citazioni: [{ fonte: 'f2', pagina: 1, testo: 'Stand structures may not exceed a height of 5 meters in Hall 3.' }]
  });
  // il 5 non è il 4: per questo test serve una citazione con 4 m nella seconda fonte
  const pagine4 = [{ numero: 1, testo: 'In all halls the stand height is limited to 4 meters for every exhibitor.' }];
  const idx = new Map([['f2', indicizza(pagine4)]]);
  const nuovaUguale = sigilla(verificaVoce({
    id: 'altezza_max', sezione: 'A', parametro: 'Altezza massima', valore: '4 m', stato: 'confermato',
    citazioni: [{ fonte: 'f2', pagina: 1, testo: 'In all halls the stand height is limited to 4 meters' }]
  }, idx), fonti, SEGRETO);
  assert.ok(nuova.sigillo && nuovaUguale.sigillo);

  const esito = fondiVoci(s.voci, [nuovaUguale], fonti, SEGRETO);
  const v = esito.voci.find((x) => x.id === 'altezza_max');
  assert.equal(v.stato, 'confermato');
  assert.equal(v.citazioni.length, 2);
  assert.equal(sigilloValido(v, fonti, SEGRETO), true);
  assert.equal(esito.conflitti, 0);
});

test('fusione: fonti in disaccordo, voce a da_verificare con entrambi i valori', () => {
  const s = schedaDiProva();
  const nuova = estratta({
    id: 'altezza_max', sezione: 'A', parametro: 'Altezza massima', valore: '5 m (Hall 3)', stato: 'confermato',
    citazioni: [{ fonte: 'f2', pagina: 1, testo: 'Stand structures may not exceed a height of 5 meters in Hall 3.' }]
  });
  const esito = fondiVoci(s.voci, [nuova], fonti, SEGRETO);
  const v = esito.voci.find((x) => x.id === 'altezza_max');
  assert.equal(v.stato, 'da_verificare');
  assert.equal(v.motivo, MOTIVO_CONFLITTO);
  assert.equal(v.conflitto.length, 2);
  assert.match(v.valore, /Regolamento ente: 4 m/);
  assert.match(v.valore, /Regolamento organizzatore: 5 m \(Hall 3\)/);
  assert.equal(v.sigillo, undefined);
  assert.equal(esito.conflitti, 1);
});

test('fusione: le risposte del PM non si toccano, la voce vuota prende i dati nuovi', () => {
  const s = schedaDiProva();
  const nuova = estratta({
    id: 'appendimenti_portata_punto', sezione: 'D', parametro: 'Portata massima per punto (kg)', valore: '30 giorni prima',
    stato: 'da_verificare', motivo: 'la fonte parla di termini, non di portata',
    citazioni: [{ fonte: 'f2', pagina: 2, testo: 'Rigging points must be requested at least 30 days before move-in.' }]
  });
  const esito = fondiVoci(s.voci, [nuova], fonti, SEGRETO);
  const v = esito.voci.find((x) => x.id === 'appendimenti_portata_punto');
  assert.equal(v.stato, 'da_verificare');
  assert.deepEqual(v.chiarimento, s.voci[2].chiarimento);
});

test('fusione: voce nuova aggiunta, voce nuova non specificata ignorata', () => {
  const s = schedaDiProva();
  const esito = fondiVoci(s.voci, [
    { id: 'altra_rigging', sezione: 'D', parametro: 'Altra: rigging', valore: '30 giorni', stato: 'da_verificare', motivo: 'x', citazioni: [] },
    { id: 'altezza_max', sezione: 'A', parametro: 'Altezza massima', valore: '', stato: 'non_specificato', citazioni: [] }
  ], fonti, SEGRETO);
  assert.equal(esito.aggiunte, 1);
  assert.equal(esito.voci.find((x) => x.id === 'altezza_max').stato, 'confermato');
  assert.equal(esito.voci.length, 4);
});

test('fusione: una voce nuova confermata senza sigillo arriva come da_verificare', () => {
  const esito = fondiVoci([], [{ id: 'altra_x', sezione: 'G', parametro: 'Altra: x', valore: '1', stato: 'confermato', citazioni: [] }], fonti, SEGRETO);
  assert.equal(esito.voci[0].stato, 'da_verificare');
  assert.equal(esito.declassate, 1);
});

test('stessoValore: numeri uguali con parole diverse; numeri diversi', () => {
  assert.equal(stessoValore('4 m', 'massimo 4 metri'), true);
  assert.equal(stessoValore('4 m', '5 m'), false);
  assert.equal(stessoValore('Vietate', 'vietate'), true);
  assert.equal(stessoValore('Ammessi', 'Non ammessi'), false);
});

test('controllaSigilli: rimuove sigilli residui dalle voci non confermate', () => {
  const v = { id: 'x', stato: 'da_verificare', sigillo: 'qualcosa', citazioni: [] };
  assert.equal(controllaSigilli([v], fonti, SEGRETO).voci[0].sigillo, undefined);
});

// ── Chat ───────────────────────────────────────────────────────────────────

test('chat: una proposta "confermato" o sconosciuta non è ammessa', () => {
  assert.equal(normalizzaRisposta({ messaggio: 'ok', proposta: { tipo: 'confermato', valore: '4 m' } }).proposta, null);
  assert.equal(normalizzaRisposta({ messaggio: 'ok', proposta: { tipo: 'qualsiasi' } }).proposta, null);
  const p = normalizzaRisposta({ messaggio: 'ok', proposta: { tipo: 'in_attesa', chi: 'Show Management', dal: '12/11' } }).proposta;
  assert.equal(p.tipo, 'in_attesa');
  assert.equal(p.chi, 'Show Management');
});

test('chat: il contesto contiene solo la voce, le citazioni e le voci collegate', () => {
  const s = schedaDiProva();
  const testo = contestoVoce({ voce: s.voci[1], fonti, collegate: [s.voci[2]], lingua: 'eng' });
  assert.match(testo, /Appendimenti: autorizzazione/);
  assert.match(testo, /Hanging structures require prior approval/);
  assert.match(testo, /risposta del PM \(chiarito\): 250 kg/);
  assert.doesNotMatch(testo, /maximum height/);
});
