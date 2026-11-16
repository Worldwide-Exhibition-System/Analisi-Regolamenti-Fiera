// Composizione della scheda (modello dati del punto 5 delle specifiche) a
// partire dalle voci dei singoli compiti di estrazione.

import { SEZIONI, PARAMETRI, parametriDelGruppo } from './parametri.js';

export const MOTIVO_INCOMPLETA = 'estrazione incompleta: la risposta del modello superava il limite anche dopo la divisione. Ripetere l\'estrazione.';

const ORDINE_STATI = { confermato: 0, da_verificare: 1, non_specificato: 2 };

/**
 * Voci da mostrare per un compito che non si è riusciti a completare: mai
 * "non_specificato" (sarebbe un'affermazione sul regolamento), ma
 * "da_verificare" con il motivo esplicito.
 */
export function vociIncomplete(compito) {
  const attesi = (compito.parametri
    ? PARAMETRI.filter((p) => compito.parametri.includes(p.id))
    : parametriDelGruppo(compito.lettere)).filter((p) => !p.facoltativo);
  const voci = attesi.map((p) => ({
    id: p.id, sezione: p.sezione, parametro: p.parametro, valore: '', stato: 'da_verificare',
    statoProposto: null, motivo: MOTIVO_INCOMPLETA, citazioni: [], chiarimento: null, note: null
  }));
  const temi = (compito.parametri
    ? PARAMETRI.filter((p) => compito.parametri.includes(p.id))
    : parametriDelGruppo(compito.lettere)).some((p) => p.facoltativo);
  if (compito.altre !== false || temi) {
    for (const l of compito.lettere) {
      voci.push({
        id: `estrazione_incompleta_${l.toLowerCase()}`, sezione: l,
        parametro: 'Altre prescrizioni della sezione', valore: '', stato: 'da_verificare',
        statoProposto: null, motivo: MOTIVO_INCOMPLETA, citazioni: [], chiarimento: null, note: null
      });
    }
  }
  return voci;
}

/** Ordina le voci per sezione e, dentro la sezione, per stato. */
export function ordinaVoci(voci) {
  const pos = new Map(SEZIONI.map((s, i) => [s.lettera, i]));
  return voci
    .map((v, i) => ({ v, i }))
    .sort((a, b) =>
      (pos.get(a.v.sezione) - pos.get(b.v.sezione)) ||
      ((ORDINE_STATI[a.v.stato] ?? 3) - (ORDINE_STATI[b.v.stato] ?? 3)) ||
      (a.i - b.i))
    .map((x) => x.v);
}

/** Unisce voci di compiti diversi garantendo identificativi unici. */
export function unisciVoci(gruppiDiVoci) {
  const ids = new Set();
  const out = [];
  for (const voci of gruppiDiVoci) {
    for (const v of voci) {
      let id = v.id;
      for (let n = 2; ids.has(id); n++) id = `${v.id}_${n}`;
      ids.add(id);
      out.push(id === v.id ? v : { ...v, id });
    }
  }
  return ordinaVoci(out);
}

export function conteggi(voci) {
  const c = { confermato: 0, da_verificare: 0, non_specificato: 0 };
  for (const v of voci) if (v.stato in c) c[v.stato]++;
  return c;
}

/**
 * @param {object} p
 * @param {Array} p.fonti  [{ id, file, ruolo, pagine: number, sha256 }]
 * @param {Array} p.voci
 * @param {string} p.autore
 */
export function nuovaScheda({ fonti, voci, autore, fiera = {}, commessa = {} }) {
  const ora = new Date().toISOString();
  return {
    id: null,
    commessa: { numero: commessa.numero || '', pm: commessa.pm || autore || '' },
    fiera: { nome: fiera.nome || '', edizione: fiera.edizione || '', date: fiera.date || '' },
    creata: { da: autore || '', il: ora },
    aggiornata: { da: autore || '', il: ora },
    fonti,
    voci: ordinaVoci(voci),
    chat: []
  };
}
