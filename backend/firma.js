// Firma HMAC-SHA256 con il segreto del server (variabile FIRMA_SEGRETO).
//
// Il server non conserva nulla, quindi tutto ciò che deve tornare indietro
// senza poter essere alterato dal browser viaggia firmato:
// - il testo delle pagine letto da /api/leggi (su cui si verificano le citazioni);
// - il file di lavoro della scheda (fase 3).
// La firma si calcola su una serializzazione canonica (chiavi in ordine), così
// non dipende dall'ordine in cui il browser rimette insieme l'oggetto.

import { createHmac, timingSafeEqual } from 'node:crypto';

export class ErroreFirma extends Error {
  constructor(messaggio) {
    super(messaggio);
    this.name = 'ErroreFirma';
  }
}

/** JSON con le chiavi degli oggetti in ordine alfabetico, ricorsivamente. */
export function canonico(valore) {
  if (valore === null || typeof valore !== 'object') return JSON.stringify(valore ?? null);
  if (Array.isArray(valore)) return '[' + valore.map(canonico).join(',') + ']';
  const chiavi = Object.keys(valore).filter((k) => valore[k] !== undefined).sort();
  return '{' + chiavi.map((k) => JSON.stringify(k) + ':' + canonico(valore[k])).join(',') + '}';
}

function segretoValido(segreto) {
  if (typeof segreto !== 'string' || segreto.length < 32) {
    throw new ErroreFirma('FIRMA_SEGRETO non impostato o troppo corto (servono almeno 32 caratteri).');
  }
  return segreto;
}

/**
 * @param {string} scopo  separa le firme di usi diversi ("pagine", "scheda")
 */
export function firma(dati, segreto, scopo) {
  return createHmac('sha256', segretoValido(segreto)).update(scopo + '\n' + canonico(dati)).digest('base64url');
}

export function firmaValida(dati, firmaRicevuta, segreto, scopo) {
  if (typeof firmaRicevuta !== 'string' || !firmaRicevuta) return false;
  const attesa = Buffer.from(firma(dati, segreto, scopo));
  const ricevuta = Buffer.from(firmaRicevuta);
  return attesa.length === ricevuta.length && timingSafeEqual(attesa, ricevuta);
}
