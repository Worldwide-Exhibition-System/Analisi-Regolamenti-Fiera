// Fusione per identificativo delle voci estratte da nuovi regolamenti con
// quelle di una scheda esistente (specifiche, punti 3, 5 e 8).
//
// Regole:
// - le risposte del PM (chiarimento) e le note non si toccano mai;
// - voce nuova "non_specificato": la voce esistente resta com'è;
// - voce esistente senza valore: prende i dati estratti dalla nuova fonte;
// - stesso dato da due fonti: le citazioni si sommano, lo stato è il più
//   prudente dei due;
// - dati diversi: la voce va a "da_verificare" con entrambi i valori e la
//   rispettiva fonte. Il software non decide quale prevalga.
//
// Le voci confermate che risultano dalla fusione vengono sigillate di nuovo
// dal server; quelle che arrivano senza sigillo valido scendono prima a
// "da_verificare" (lavoro.js).

import { controllaSigilli, sigilla } from './lavoro.js';

export const MOTIVO_CONFLITTO = 'conflitto tra fonti: i regolamenti riportano valori diversi, il software non decide quale prevalga';

const PRUDENZA = { confermato: 0, da_verificare: 1, non_specificato: 2 };

function numeri(testo) {
  return [...new Set((String(testo).match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/[.,]/g, '')))].sort();
}

function testoNormalizzato(testo) {
  return String(testo).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Due valori dicono la stessa cosa? Con dei numeri: stessi numeri. Senza
 * numeri: stesso testo normalizzato. Nel dubbio sono diversi: meglio un
 * conflitto da chiarire che un dato fuso per errore.
 */
export function stessoValore(a, b) {
  const na = numeri(a);
  const nb = numeri(b);
  if (na.length || nb.length) return na.length === nb.length && na.every((n, i) => n === nb[i]);
  return testoNormalizzato(a) === testoNormalizzato(b);
}

function nomeFonte(fonti, id) {
  const f = fonti.find((x) => x.id === id);
  return f ? String(f.file || id).replace(/\.pdf$/i, '') : id;
}

function fontiDi(voce) {
  return [...new Set((voce.citazioni || []).map((c) => c.fonte))];
}

function unisciCitazioni(a, b) {
  const viste = new Set();
  return [...(a || []), ...(b || [])].filter((c) => {
    const k = c.fonte + '|' + c.testo;
    if (viste.has(k)) return false;
    viste.add(k);
    return true;
  });
}

function valoriInConflitto(voce) {
  if (Array.isArray(voce.conflitto) && voce.conflitto.length) return voce.conflitto;
  return [{ fonti: fontiDi(voce), valore: voce.valore }];
}

/**
 * @param {Array} esistenti  voci della scheda
 * @param {Array} nuove  voci estratte dai nuovi regolamenti (sigillate dal server)
 * @param {Array} fonti  tutte le fonti della scheda, nuove comprese: [{ id, file, sha256 }]
 * @returns {{ voci: Array, aggiunte: number, aggiornate: number, conflitti: number, declassate: number }}
 */
export function fondiVoci(esistenti, nuove, fonti, segreto) {
  const a = controllaSigilli(esistenti, fonti, segreto);
  const b = controllaSigilli(nuove, fonti, segreto);
  const voci = a.voci.map((v) => ({ ...v }));
  const posizione = new Map(voci.map((v, i) => [v.id, i]));
  let aggiunte = 0;
  let aggiornate = 0;
  let conflitti = 0;

  for (const n of b.voci) {
    const i = posizione.get(n.id);
    if (i === undefined) {
      posizione.set(n.id, voci.length);
      voci.push(n);
      aggiunte++;
      continue;
    }
    const e = voci[i];
    const daPm = { chiarimento: e.chiarimento ?? null, note: e.note ?? null };

    if (n.stato === 'non_specificato') continue;

    if (e.stato === 'non_specificato' || !String(e.valore || '').trim()) {
      voci[i] = sigilla({ ...n, id: e.id, sezione: e.sezione, ...daPm }, fonti, segreto);
      aggiornate++;
      continue;
    }

    if (stessoValore(e.valore, n.valore) && !e.conflitto) {
      const prudente = PRUDENZA[n.stato] > PRUDENZA[e.stato] ? n : e;
      const unita = {
        ...e,
        stato: prudente.stato,
        motivo: prudente.stato === 'confermato' ? null : prudente.motivo,
        citazioni: unisciCitazioni(e.citazioni, n.citazioni),
        ...daPm
      };
      voci[i] = sigilla(unita, fonti, segreto);
      aggiornate++;
      continue;
    }

    const elenco = [...valoriInConflitto(e), { fonti: fontiDi(n), valore: n.valore }];
    const { sigillo: _s, ...senzaSigillo } = e;
    voci[i] = {
      ...senzaSigillo,
      stato: 'da_verificare',
      statoProposto: e.statoProposto ?? e.stato,
      motivo: MOTIVO_CONFLITTO,
      valore: elenco.map((c) => `${c.fonti.map((id) => nomeFonte(fonti, id)).join(', ')}: ${c.valore}`).join(' · '),
      conflitto: elenco,
      citazioni: unisciCitazioni(e.citazioni, n.citazioni),
      ...daPm
    };
    conflitti++;
  }

  return { voci, aggiunte, aggiornate, conflitti, declassate: a.declassate + b.declassate };
}
