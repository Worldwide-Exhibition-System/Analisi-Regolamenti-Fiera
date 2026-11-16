// File di lavoro: sigilli delle voci confermate e firma della scheda.
//
// Il server non conserva nulla, ma deve poter riconoscere una voce
// "confermato" autentica quando la scheda gli torna dal browser. Per questo:
//
// - ogni voce confermata dall'estrazione riceve un SIGILLO, cioè una firma
//   HMAC che lega lo stato, il valore e le citazioni verificate all'impronta
//   (sha256) del PDF da cui provengono. Solo il server può produrlo, e solo
//   dopo la verifica deterministica delle citazioni;
// - il FILE DI LAVORO è firmato per intero. Il server lo firma solo dopo aver
//   controllato i sigilli: una voce confermata senza sigillo valido scende a
//   "da_verificare". Le risposte del PM (campo `chiarimento`) non toccano mai
//   lo stato estratto e non possono creare una conferma.
//
// Al caricamento: firma valida → scheda identica. Firma mancante o non valida
// (file modificato, segreto cambiato) → si importa tutto, ma ogni voce
// confermata scende a "da_verificare" e il PM ricarica i regolamenti per
// ripetere la verifica (specifiche, punto 8). L'autosalvataggio del browser
// non ha la firma del file: lì valgono i sigilli voce per voce.

import { firma, firmaValida } from './firma.js';
import { indicizza, verificaVoce } from './verifica.js';

export const FORMATO = 'wes-scheda-regolamenti';
export const VERSIONE = 1;
export const MOTIVO_FIRMA = 'File di lavoro senza firma valida: la citazione va riverificata ricaricando i regolamenti.';
export const MOTIVO_SIGILLO = 'Conferma non riconosciuta dal servizio: la citazione va riverificata ricaricando i regolamenti.';
export const MOTIVO_MODIFICATA =
  'La citazione si ritrova nel regolamento, ma la voce non corrisponde più a quella confermata dal servizio ' +
  '(modificata fuori dall\'app, oppure il segreto del servizio è cambiato): controllare valore e citazione sul regolamento.';

export class ErroreFileLavoro extends Error {
  constructor(messaggio) {
    super(messaggio);
    this.name = 'ErroreFileLavoro';
  }
}

// ── Sigillo della singola voce ─────────────────────────────────────────────

function shaFonti(fonti) {
  const mappa = new Map();
  for (const f of fonti || []) if (f && f.id) mappa.set(f.id, f.sha256 || null);
  return mappa;
}

function datiSigillo(voce, sha) {
  return {
    sezione: String(voce.sezione ?? ''),
    parametro: String(voce.parametro ?? ''),
    stato: voce.stato,
    valore: String(voce.valore ?? ''),
    citazioni: (voce.citazioni || []).map((c) => ({
      sha256: sha.get(c.fonte) || null,
      pagina: Number(c.pagina),
      testo: String(c.testo ?? ''),
      verificata: c.verificata === true,
      metodo: c.metodo || null
    }))
  };
}

/** Aggiunge il sigillo a una voce confermata con tutte le citazioni verificate. */
export function sigilla(voce, fonti, segreto) {
  const { sigillo: _vecchio, ...resto } = voce;
  if (resto.stato !== 'confermato') return resto;
  const sha = shaFonti(fonti);
  const citazioni = resto.citazioni || [];
  if (!citazioni.length || !citazioni.every((c) => c.verificata === true && sha.get(c.fonte))) return resto;
  return { ...resto, sigillo: firma(datiSigillo(resto, sha), segreto, 'voce') };
}

export function sigilloValido(voce, fonti, segreto) {
  if (voce.stato !== 'confermato' || !voce.sigillo) return false;
  return firmaValida(datiSigillo(voce, shaFonti(fonti)), voce.sigillo, segreto, 'voce');
}

/**
 * Porta una voce confermata a "da_verificare", conservando la proposta e le
 * risposte del PM. Il sigillo della conferma resta in `sigilloOriginale`: la
 * riverifica lo usa per controllare che valore, parametro e citazioni siano
 * ancora quelli confermati dal servizio (una citazione vera non basta a
 * riconfermare un valore cambiato a mano).
 */
export function declassa(voce, motivo) {
  const { sigillo, ...resto } = voce;
  const sigilloOriginale = sigillo || resto.sigilloOriginale;
  return {
    ...resto,
    stato: 'da_verificare',
    statoProposto: resto.statoProposto || 'confermato',
    motivo,
    daRiverificare: true,
    citazioni: (resto.citazioni || []).map((c) => ({ ...c, verificata: null })),
    ...(sigilloOriginale ? { sigilloOriginale } : {})
  };
}

/**
 * Controlla i sigilli di tutte le voci confermate; quelle senza sigillo
 * valido scendono a "da_verificare".
 */
export function controllaSigilli(voci, fonti, segreto, motivo = MOTIVO_SIGILLO) {
  let declassate = 0;
  const controllate = (voci || []).map((v) => {
    if (v.stato !== 'confermato') {
      const { sigillo: _s, ...resto } = v;
      return resto;
    }
    if (sigilloValido(v, fonti, segreto)) return v;
    declassate++;
    return declassa(v, motivo);
  });
  return { voci: controllate, declassate };
}

// ── Scheda ─────────────────────────────────────────────────────────────────

function controllaForma(scheda) {
  if (!scheda || typeof scheda !== 'object' || Array.isArray(scheda)) {
    throw new ErroreFileLavoro('Il file non contiene una scheda.');
  }
  if (!Array.isArray(scheda.voci) || !Array.isArray(scheda.fonti)) {
    throw new ErroreFileLavoro('Il file non è un file di lavoro della Scheda regolamenti (mancano voci o fonti).');
  }
  for (const v of scheda.voci) {
    if (!v || typeof v.id !== 'string' || !Array.isArray(v.citazioni || [])) {
      throw new ErroreFileLavoro('Il file di lavoro contiene voci non valide.');
    }
  }
}

/**
 * Firma la scheda per il file di lavoro, dopo aver controllato i sigilli.
 * @returns {{ scheda: object, firma: string, declassate: number }}
 */
export function firmaScheda(scheda, segreto) {
  controllaForma(scheda);
  const { voci, declassate } = controllaSigilli(scheda.voci, scheda.fonti, segreto);
  const pulita = { ...scheda, voci };
  return { scheda: pulita, firma: firma(pulita, segreto, 'scheda'), declassate };
}

/**
 * Verifica una scheda ricevuta dal browser.
 *
 * modo "file" (file di lavoro caricato dal PM): firma valida → scheda
 * identica; altrimenti ogni voce confermata scende a "da_verificare".
 *
 * modo "autosalvataggio" (copia nella memoria del browser, senza firma del
 * file): restano confermate solo le voci con sigillo valido.
 *
 * @returns {{ valida: boolean, scheda: object, declassate: number }}
 */
export function verificaScheda(scheda, firmaRicevuta, segreto, modo = 'file') {
  controllaForma(scheda);
  if (modo === 'file' && firmaValida(scheda, firmaRicevuta, segreto, 'scheda')) {
    return { valida: true, scheda, declassate: 0 };
  }
  if (modo === 'autosalvataggio') {
    const { voci, declassate } = controllaSigilli(scheda.voci, scheda.fonti, segreto);
    return { valida: false, scheda: { ...scheda, voci }, declassate };
  }
  let declassate = 0;
  const voci = scheda.voci.map((v) => {
    if (v.stato !== 'confermato') {
      const { sigillo: _s, ...resto } = v;
      return resto;
    }
    declassate++;
    return declassa(v, MOTIVO_FIRMA);
  });
  return { valida: false, scheda: { ...scheda, voci }, declassate };
}

/**
 * Ripete la verifica delle citazioni sulle voci declassate, con i regolamenti
 * ricaricati dal PM. Una voce torna "confermato" solo se il modello l'aveva
 * proposta come confermata, tutte le sue citazioni vengono ritrovate e il
 * sigillo della conferma originale vale ancora per la voce così com'è
 * (stesso valore, parametro, sezione, citazioni e PDF). Senza sigillo valido
 * la voce resta "da_verificare" con MOTIVO_MODIFICATA.
 *
 * @param {Array} voci  voci della scheda
 * @param {Array} fonti  fonti ricaricate: [{ id, sha256, pagine }] con gli
 *   identificativi della scheda (il testo delle pagine è già stato controllato)
 * @returns {{ voci: Array, ripristinate: number, ancoraAperte: number }}
 */
export function riverifica(voci, fonti, segreto) {
  const indici = new Map(fonti.map((f) => [f.id, indicizza(f.pagine)]));
  let ripristinate = 0;
  let ancoraAperte = 0;
  const nuove = voci.map((v) => {
    if (!v.daRiverificare) return v;
    const fontiCitate = (v.citazioni || []).map((c) => c.fonte);
    if (!fontiCitate.length || !fontiCitate.every((id) => indici.has(id))) {
      ancoraAperte++;
      return v;
    }
    const { daRiverificare: _d, sigilloOriginale, ...resto } = v;
    const candidata = { ...resto, stato: v.statoProposto === 'confermato' ? 'confermato' : v.stato, motivo: null };
    const verificata = verificaVoce(candidata, indici);
    if (verificata.stato === 'confermato') {
      if (sigilloOriginale && sigilloValido({ ...verificata, sigillo: sigilloOriginale }, fonti, segreto)) {
        ripristinate++;
        return sigilla(verificata, fonti, segreto);
      }
      ancoraAperte++;
      return { ...verificata, stato: 'da_verificare', motivo: MOTIVO_MODIFICATA };
    }
    ancoraAperte++;
    return verificata;
  });
  return { voci: nuove, ripristinate, ancoraAperte };
}
