// Lettura dei PDF dei regolamenti, pagina per pagina.
//
// Per ogni pagina si ricava il livello di testo con pdfjs e se ne misura la
// leggibilità. Se il testo è corrotto (come nell'Appendice A del caso NPE,
// dove intere righe sono caratteri spostati e caratteri di controllo) o quasi
// assente, la pagina viene resa come immagine a 200 dpi e letta con Tesseract.
// Tutto avviene in memoria: nessun file viene scritto su disco e i dati delle
// lingue di Tesseract sono inclusi nel pacchetto (nessun download in esercizio).

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument, PasswordException } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWorker } from 'tesseract.js';

import { normalizza } from './verifica.js';

const require = createRequire(import.meta.url);

export const DPI_OCR = 200;

// Dicitura fissa stampata in testa alla prima pagina del PDF di consegna
// (frontend, fase 4). Serve a riconoscerlo se viene ricaricato per errore.
export const DICITURA_CONSEGNA = 'WES · Scheda prescrizioni tecniche · Documento di consegna';
export const MESSAGGIO_CONSEGNA =
  'Questo è il PDF di consegna. Per riprendere il lavoro carica il file di lavoro (.json)';

const LINGUE_OCR = ['eng', 'ita', 'deu', 'spa', 'fra'];

export class ErroreLettura extends Error {
  constructor(messaggio, codice) {
    super(messaggio);
    this.name = 'ErroreLettura';
    this.codice = codice;
  }
}

// ── Leggibilità del testo estratto ─────────────────────────────────────────

const PAROLE_FREQUENTI = {
  eng: ['the', 'and', 'of', 'to', 'in', 'be', 'is', 'for', 'or', 'all', 'must', 'with', 'by', 'on', 'not', 'are', 'any', 'may', 'shall', 'booth'],
  ita: ['il', 'di', 'che', 'la', 'per', 'del', 'della', 'gli', 'le', 'non', 'sono', 'deve', 'devono', 'con', 'una', 'nel', 'dello', 'degli', 'stand', 'essere'],
  deu: ['der', 'die', 'und', 'das', 'den', 'des', 'nicht', 'mit', 'sind', 'werden', 'ist', 'auf', 'eine', 'für', 'dem', 'muss', 'müssen', 'von', 'oder', 'stand'],
  spa: ['el', 'la', 'de', 'que', 'los', 'las', 'del', 'por', 'para', 'con', 'una', 'debe', 'deben', 'en', 'se', 'no', 'stand', 'al', 'su', 'ser'],
  fra: ['le', 'la', 'les', 'de', 'des', 'du', 'et', 'est', 'doit', 'doivent', 'pour', 'dans', 'sur', 'une', 'par', 'ne', 'pas', 'au', 'aux', 'stand']
};

const CARATTERI_AMMESSI = /[\p{L}\p{N}\p{P}\p{Zs}\p{Sc}\p{Sm}\p{So}\n\t°ºª]/u;
const PAROLA = /^[\p{L}]+$/u;

function parolaPlausibile(t) {
  if (t.length < 2) return true;
  if (!PAROLA.test(t)) return false;
  const minuscola = t.toLowerCase();
  if (!/[aeiouyàèéìòùáíóúäöüâêîôûœæ]/.test(minuscola)) return t.length <= 4; // sigle: NFPA, OCCC
  if (/[bcdfghjklmnpqrstvwxz]{5,}/.test(minuscola)) return false;
  // Maiuscole in mezzo alla parola (es. "0D[LPXP" decodificato male: "LPXP")
  const forma = t === minuscola || t === t.toUpperCase() || t === t[0].toUpperCase() + t.slice(1).toLowerCase();
  return forma;
}

/**
 * Misura quanto è leggibile il testo estratto da una pagina.
 * @returns {{ caratteri: number, quotaAnomali: number, quotaParole: number, leggibile: boolean }}
 */
export function misuraLeggibilita(testo) {
  const senzaSpazi = testo.replace(/\s/g, '');
  const caratteri = senzaSpazi.length;
  let anomali = 0;
  for (const c of testo) if (!CARATTERI_AMMESSI.test(c)) anomali++;
  const quotaAnomali = testo.length ? anomali / testo.length : 0;

  const token = testo.split(/[\s\p{P}\p{S}\p{N}]+/u).filter((t) => t.length >= 2);
  const plausibili = token.filter(parolaPlausibile).length;
  const quotaParole = token.length ? plausibili / token.length : 0;

  // Soglie prudenti: basta una piccola quota di caratteri di controllo o di
  // parole impossibili per mandare la pagina alla lettura ottica. Il costo di
  // un OCR inutile è qualche secondo; il costo di un testo corrotto non
  // riconosciuto è una citazione vera respinta.
  const leggibile = caratteri >= 30 && quotaAnomali < 0.005 && quotaParole >= 0.9;
  return { caratteri, quotaAnomali, quotaParole, leggibile };
}

/** Lingua prevalente di un testo, contando le parole frequenti. */
export function linguaPrevalente(testo) {
  const parole = testo.toLowerCase().split(/[^\p{L}]+/u);
  let migliore = 'eng';
  let massimo = 0;
  for (const [lingua, elenco] of Object.entries(PAROLE_FREQUENTI)) {
    const insieme = new Set(elenco);
    const n = parole.filter((p) => insieme.has(p)).length;
    if (n > massimo) { massimo = n; migliore = lingua; }
  }
  return migliore;
}

// ── Testo della pagina ─────────────────────────────────────────────────────

function testoDaContenuto(contenuto) {
  let testo = '';
  for (const item of contenuto.items) {
    if (typeof item.str !== 'string') continue;
    testo += item.str;
    testo += item.hasEOL ? '\n' : ' ';
  }
  return testo;
}

// ── Lettura ottica ─────────────────────────────────────────────────────────

function percorsoLingua(lingua) {
  const pacchetto = path.dirname(require.resolve(`@tesseract.js-data/${lingua}/package.json`));
  return path.join(pacchetto, '4.0.0_best_int');
}

// I worker di Tesseract occupano molta memoria (il piano gratuito di Render ha
// 512 MB): ogni lettura crea al più un worker per lingua e li chiude alla fine.
function nuovoOcr() {
  const worker = new Map();
  return {
    async leggi(png, lingua) {
      if (!LINGUE_OCR.includes(lingua)) lingua = 'eng';
      if (!worker.has(lingua)) {
        worker.set(lingua, createWorker(lingua, 1, { langPath: percorsoLingua(lingua), gzip: true, cacheMethod: 'none' }));
      }
      const { data } = await (await worker.get(lingua)).recognize(png);
      return { testo: data.text || '', confidenza: data.confidence ?? null };
    },
    async chiudi() {
      const pronti = await Promise.allSettled([...worker.values()]);
      worker.clear();
      await Promise.allSettled(pronti.filter((w) => w.status === 'fulfilled').map((w) => w.value.terminate()));
    }
  };
}

/** Compatibilità con test e script: i worker si chiudono già a fine lettura. */
export async function chiudiOcr() {}

async function rendiPagina(documento, pagina) {
  const viewport = pagina.getViewport({ scale: DPI_OCR / 72 });
  const larghezza = Math.ceil(viewport.width);
  const altezza = Math.ceil(viewport.height);
  const { canvas, context } = documento.canvasFactory.create(larghezza, altezza);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, larghezza, altezza);
  await pagina.render({ canvas, canvasContext: context, viewport }).promise;
  const png = canvas.toBuffer('image/png');
  documento.canvasFactory.destroy({ canvas, context });
  return png;
}

// ── API del modulo ─────────────────────────────────────────────────────────

/**
 * Legge un PDF e restituisce il testo di ogni pagina.
 *
 * @param {Buffer|Uint8Array} dati
 * @param {{ linguaSuggerita?: string, forzaOcr?: number[] }} [opzioni]
 * @returns {Promise<{ sha256: string, numeroPagine: number, lingua: string,
 *   pagine: Array<{ numero: number, testo: string, ocr: string|null,
 *   leggibilita: object, confidenzaOcr: number|null }> }>}
 */
export async function leggiPdf(dati, opzioni = {}) {
  const buffer = Buffer.isBuffer(dati) ? dati : Buffer.from(dati);
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new ErroreLettura('Il file non è un PDF. Carica i regolamenti in formato PDF.', 'non_pdf');
  }
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  const caricamento = getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
    isEvalSupported: false,
    useSystemFonts: false
  });
  let documento;
  try {
    documento = await caricamento.promise;
  } catch (err) {
    if (err instanceof PasswordException || err?.name === 'PasswordException') {
      throw new ErroreLettura(
        'Il PDF è protetto da password. Chiedi all\'ente fiera una copia senza protezione oppure ' +
        'aprilo con la password e salvalo di nuovo come PDF senza protezione.',
        'password'
      );
    }
    throw new ErroreLettura('Il PDF è danneggiato o non leggibile.', 'danneggiato');
  }

  const ocr = nuovoOcr();
  try {
    const pagine = [];
    for (let n = 1; n <= documento.numPages; n++) {
      const pagina = await documento.getPage(n);
      const testo = testoDaContenuto(await pagina.getTextContent());
      pagine.push({ numero: n, testo, ocr: null, leggibilita: misuraLeggibilita(testo), confidenzaOcr: null });
      pagina.cleanup();
    }

    // Confronto sul testo normalizzato: nel PDF stampato dal browser la
    // dicitura può risultare spezzata su più righe o con spazi diversi.
    if (pagine.length && normalizza(pagine[0].testo).includes(normalizza(DICITURA_CONSEGNA))) {
      throw new ErroreLettura(MESSAGGIO_CONSEGNA, 'pdf_consegna');
    }

    const testoLeggibile = pagine.filter((p) => p.leggibilita.leggibile).map((p) => p.testo).join('\n');
    let lingua = testoLeggibile.length > 200 ? linguaPrevalente(testoLeggibile) : (opzioni.linguaSuggerita || 'eng');

    const forza = new Set(opzioni.forzaOcr || []);
    for (const p of pagine) {
      if (p.leggibilita.leggibile && !forza.has(p.numero)) continue;
      const pagina = await documento.getPage(p.numero);
      const png = await rendiPagina(documento, pagina);
      pagina.cleanup();
      let risultato = await ocr.leggi(png, lingua);
      // Documento interamente illeggibile: la lingua si capisce solo dopo la
      // prima lettura ottica. Se non è quella usata, si rilegge.
      if (testoLeggibile.length <= 200 && risultato.testo.length > 200) {
        const rilevata = linguaPrevalente(risultato.testo);
        if (rilevata !== lingua) {
          lingua = rilevata;
          risultato = await ocr.leggi(png, lingua);
        }
      }
      p.ocr = risultato.testo;
      p.confidenzaOcr = risultato.confidenza;
    }

    const utili = pagine.filter((p) => p.leggibilita.leggibile || (p.ocr && p.ocr.replace(/\s/g, '').length >= 30));
    if (!utili.length) {
      throw new ErroreLettura(
        'Il PDF non contiene testo leggibile, nemmeno con la lettura ottica: probabilmente è una scansione ' +
        'di qualità troppo bassa. Chiedi all\'ente fiera la versione digitale del regolamento.',
        'illeggibile'
      );
    }

    return { sha256, numeroPagine: documento.numPages, lingua, pagine };
  } finally {
    await ocr.chiudi();
    await caricamento.destroy();
  }
}
