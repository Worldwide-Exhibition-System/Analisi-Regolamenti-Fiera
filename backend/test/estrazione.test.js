// Test dell'estrazione senza chiamare il modello: divisione dei compiti
// troncati, orchestrazione e preparazione delle voci.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compitiIniziali, dividiCompito, estraiTutto, preparaVoci, schemaRisposta } from '../estrazione.js';
import { GRUPPI, parametriDelGruppo } from '../parametri.js';
import { vociIncomplete, unisciVoci, MOTIVO_INCOMPLETA } from '../scheda.js';

const fonti = [{
  id: 'f1', file: 'regolamento.pdf', ruolo: 'ente', base64: '',
  pagine: [
    { numero: 1, testo: 'The maximum height of all booth structures is 4 meters in every hall.' },
    { numero: 2, testo: 'Hanging structures require prior approval by the technical office.' }
  ]
}];

// ── Divisione ──────────────────────────────────────────────────────────────

test('compiti iniziali: un compito per gruppo di due sezioni', () => {
  const c = compitiIniziali(GRUPPI);
  assert.equal(c.length, 5);
  assert.deepEqual(c[0], { lettere: ['A', 'B'], parametri: null, altre: true });
});

test('gruppo troncato: diviso per sezione', () => {
  assert.deepEqual(dividiCompito({ lettere: ['A', 'B'], parametri: null, altre: true }), [
    { lettere: ['A'], parametri: null, altre: true },
    { lettere: ['B'], parametri: null, altre: true }
  ]);
});

test('sezione troncata: divisa a metà dei parametri, altre prescrizioni nella seconda metà', () => {
  const ids = parametriDelGruppo(['B']).map((p) => p.id);
  const [a, b] = dividiCompito({ lettere: ['B'], parametri: null, altre: true });
  assert.deepEqual([...a.parametri, ...b.parametri], ids);
  assert.equal(a.altre, false);
  assert.equal(b.altre, true);
});

test('compito minimo: non più divisibile', () => {
  assert.equal(dividiCompito({ lettere: ['G'], parametri: [], altre: true }), null);
  assert.equal(dividiCompito({ lettere: ['B'], parametri: ['soppalchi_altezza_max'], altre: false }), null);
});

// ── Orchestrazione con limite di token simulato ────────────────────────────

test('output troncato: mai consegnato, compito diviso e ripetuto', async () => {
  const chiamate = [];
  // Simula un modello che va oltre il limite con più di 3 parametri o con due sezioni
  const esegui = async (compito) => {
    chiamate.push(compito);
    const n = compito.parametri ? compito.parametri.length : parametriDelGruppo(compito.lettere).length;
    if (compito.lettere.length > 1 || n > 3) {
      return { troncato: true, voci: [{ id: 'voce_parziale', sezione: compito.lettere[0], stato: 'confermato' }] };
    }
    return { troncato: false, voci: [{ id: 'ok', sezione: compito.lettere[0], parametro: 'x', valore: '', stato: 'non_specificato', motivo: '', citazioni: [] }] };
  };
  const { esiti, incompleti } = await estraiTutto(compitiIniziali([['A', 'B']]), esegui);

  assert.equal(incompleti.length, 0);
  assert.ok(chiamate.length > 3);
  for (const e of esiti) {
    assert.equal(e.troncato, false);
    assert.ok(!e.voci.some((v) => v.id === 'voce_parziale'), 'una voce di un output troncato è finita nella scheda');
  }
  // Ogni parametro di A e B è coperto da un compito completato
  const coperti = new Set(esiti.flatMap((e) => e.compito.parametri ?? parametriDelGruppo(e.compito.lettere).map((p) => p.id)));
  for (const p of parametriDelGruppo(['A', 'B'])) assert.ok(coperti.has(p.id), `parametro ${p.id} perso`);
});

test('compito mai completato: segnalato come incompleto, voci da_verificare con il motivo', async () => {
  const esegui = async () => ({ troncato: true });
  const { esiti, incompleti } = await estraiTutto([{ lettere: ['G'], parametri: [], altre: true }], esegui);
  assert.equal(esiti.length, 0);
  assert.equal(incompleti.length, 1);
  const voci = vociIncomplete(incompleti[0]);
  assert.ok(voci.length >= 1);
  for (const v of voci) {
    assert.equal(v.stato, 'da_verificare');
    assert.equal(v.motivo, MOTIVO_INCOMPLETA);
  }
});

// ── Preparazione delle voci ────────────────────────────────────────────────

test('preparaVoci: verifica le citazioni e decide lo stato', () => {
  const compito = { lettere: ['A', 'B'], parametri: null, altre: true };
  const voci = preparaVoci([
    { id: 'altezza_max', sezione: 'A', parametro: 'Altezza massima', valore: '4 m', stato: 'confermato', motivo: '',
      citazioni: [{ fonte: 'f1', pagina: 1, testo: 'The maximum height of all booth structures is 4 meters' }] },
    { id: 'soppalchi_ammissibilita', sezione: 'B', parametro: 'Soppalchi', valore: 'Ammessi', stato: 'confermato', motivo: '',
      citazioni: [{ fonte: 'f1', pagina: 1, testo: 'Double-decker booths are allowed in all halls.' }] }
  ], compito, fonti);

  const altezza = voci.find((v) => v.id === 'altezza_max');
  assert.equal(altezza.stato, 'confermato');
  assert.equal(altezza.citazioni[0].metodo, 'testo');

  const soppalchi = voci.find((v) => v.id === 'soppalchi_ammissibilita');
  assert.equal(soppalchi.stato, 'da_verificare', 'citazione inventata non respinta');
});

test('preparaVoci: parametri omessi dal modello compaiono come non_specificato', () => {
  const compito = { lettere: ['B'], parametri: null, altre: true };
  const voci = preparaVoci([], compito, fonti);
  const attesi = parametriDelGruppo(['B']).map((p) => p.id).sort();
  assert.deepEqual(voci.map((v) => v.id).sort(), attesi);
  assert.ok(voci.every((v) => v.stato === 'non_specificato'));
});

test('preparaVoci: scarta le voci fuori dal compito e le "altre" non specificate', () => {
  const compito = { lettere: ['A'], parametri: null, altre: true };
  const voci = preparaVoci([
    { id: 'porte_oblo', sezione: 'F', parametro: 'Oblò', valore: '', stato: 'non_specificato', motivo: '', citazioni: [] },
    { id: 'altra_nulla', sezione: 'A', parametro: 'Altra: niente', valore: '', stato: 'non_specificato', motivo: '', citazioni: [] }
  ], compito, fonti);
  assert.ok(!voci.some((v) => v.id === 'porte_oblo'));
  assert.ok(!voci.some((v) => v.id === 'altra_nulla'));
});

test('preparaVoci: id liberi diventano altra_<slug>, varianti dei parametri multipli conservate', () => {
  const compito = { lettere: ['A'], parametri: null, altre: true };
  const voci = preparaVoci([
    { id: 'altezza_max__island', sezione: 'A', parametro: 'Altezza max island', valore: '4 m', stato: 'da_verificare', motivo: 'x', citazioni: [] },
    { id: 'Macchinari!', sezione: 'A', parametro: 'Altra: macchinari e attrezzature', valore: 'x', stato: 'da_verificare', motivo: 'x', citazioni: [] }
  ], compito, fonti);
  assert.ok(voci.some((v) => v.id === 'altezza_max__island'));
  assert.ok(voci.some((v) => v.id === 'altra_macchinari_e_attrezzature'));
  assert.ok(!voci.some((v) => v.id === 'altezza_max'), 'con una variante, il parametro base non va aggiunto come non_specificato');
});

test('preparaVoci: temi facoltativi assenti non diventano non_specificato', () => {
  const compito = { lettere: ['G'], parametri: null, altre: true };
  const voci = preparaVoci([
    { id: 'rumore_audio', sezione: 'G', parametro: 'Rumore', valore: '', stato: 'non_specificato', motivo: '', citazioni: [] }
  ], compito, fonti);
  assert.deepEqual(voci, []);
});

test('unisciVoci: identificativi unici tra compiti diversi', () => {
  const v = { id: 'altra_x', sezione: 'G', stato: 'confermato' };
  const unite = unisciVoci([[v], [{ ...v }]]);
  assert.deepEqual(unite.map((x) => x.id), ['altra_x', 'altra_x_2']);
});

test('schema: identico per ogni compito (cache), sezioni e fonti vincolate', () => {
  const s = schemaRisposta(fonti);
  const voce = s.properties.voci.items;
  assert.deepEqual(voce.properties.sezione.enum, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  assert.deepEqual(voce.properties.citazioni.items.properties.fonte.enum, ['f1']);
  assert.equal(voce.additionalProperties, false);
});
