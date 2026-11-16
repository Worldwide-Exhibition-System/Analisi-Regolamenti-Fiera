// Prova del servizio pubblicato: lettura ottica dell'Appendice A NPE.
//
//   $env:CODICE_ACCESSO = '...'      (nel proprio terminale, non in chat)
//   node scripts/prova-servizio.js https://wes-scheda-regolamenti.onrender.com
//
// Controlla che la pagina 1 dell'Appendice A sia riconosciuta illeggibile,
// letta per via ottica e contenga la citazione del collaudo manuale; riporta
// tempi e picco di memoria del servizio. Non stampa il codice d'accesso.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { normalizza } from '../verifica.js';

const BASE = (process.argv[2] || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('Uso: node scripts/prova-servizio.js <indirizzo del servizio>');
  process.exit(1);
}
const CODICE = process.env.CODICE_ACCESSO || '';
const PDF = fileURLToPath(new URL('../../fixtures/regolamenti/NPE_APPENDIX_A_-_Booth_Types2C_Dimensions2C_Display_Measurement_Rules.pdf', import.meta.url));
const CITAZIONE = 'Maximum height of 8ft. ; permitted only in the rear five feet of the booth space.';

const salute = async () => (await fetch(BASE + '/health')).json();

let t0 = Date.now();
const prima = await salute();
console.log(`Servizio: ${prima.stato} in ${Date.now() - t0} ms · modello ${prima.modello} · codice richiesto: ${prima.codiceRichiesto} · firma configurata: ${prima.firmaConfigurata} · memoria ${prima.memoriaMB ?? '?'} MB`);
if (!prima.firmaConfigurata) console.log('ATTENZIONE: FIRMA_SEGRETO non impostato sul servizio: la lettura finirà in errore.');

const senzaCodice = await fetch(BASE + '/api/leggi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
console.log(`Richiesta senza codice d'accesso: ${senzaCodice.status} ${senzaCodice.status === 401 ? '(respinta, corretto)' : '(ATTENZIONE: non respinta)'}`);

console.log('Invio dell\'Appendice A (5 pagine) per la lettura...');
t0 = Date.now();
const r = await fetch(BASE + '/api/leggi', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Codice-Accesso': CODICE },
  body: JSON.stringify({ base64: readFileSync(PDF).toString('base64') })
});
const durata = Math.round((Date.now() - t0) / 1000);
const dati = await r.json().catch(() => ({}));
if (!r.ok) {
  console.log(`Lettura: errore ${r.status} dopo ${durata} s: ${dati.errore || ''}`);
  process.exit(1);
}

const p1 = dati.pagine[0];
const trovata = normalizza(p1.ocr || '').includes(normalizza(CITAZIONE));
console.log(`Lettura: ${dati.numeroPagine} pagine in ${durata} s · ${dati.pagine.map((p) => `p${p.numero}:${p.leggibile ? 'testo' : 'ottica'}`).join(' ')}`);
console.log(`Pagina 1 riconosciuta illeggibile: ${!p1.leggibile ? 'sì' : 'NO'}`);
console.log(`Pagina 1, citazione «${CITAZIONE}» nel testo ottico: ${trovata ? 'SÌ' : 'NO'}`);
console.log(`Testo firmato dal servizio: ${dati.firma ? 'sì' : 'NO'}`);

const dopo = await salute();
console.log(`Memoria del servizio: ${dopo.memoriaMB} MB ora, picco ${dopo.memoriaMassimaMB} MB (limite del piano gratuito: 512 MB)`);
console.log(trovata && !p1.leggibile ? '\nPROVA SUPERATA' : '\nPROVA NON SUPERATA');
