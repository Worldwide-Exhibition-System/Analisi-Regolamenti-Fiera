// Estrazione delle voci, un gruppo di sezioni per chiamata.
//
// Il server non conserva nulla: a ogni chiamata riceve i PDF e il testo delle
// pagine (già letto e firmato da /api/leggi), chiede al modello le voci di un
// gruppo di due sezioni con output strutturato e restituisce le voci verificate
// dal codice. Se il modello si ferma per limite di token, la risposta è
// scartata per intero e il chiamante riceve `troncato: true`: il compito va
// diviso (vedi `dividiCompito`) e ripetuto. Un output troncato non entra mai
// nella scheda.

import { SEZIONI, LETTERE, PARAMETRI, parametriDelGruppo, identificativoStabile } from './parametri.js';
import { indicizza, verificaVoce } from './verifica.js';

export const STATI = ['confermato', 'da_verificare', 'non_specificato'];

export class ErroreEstrazione extends Error {
  constructor(messaggio, codice) {
    super(messaggio);
    this.name = 'ErroreEstrazione';
    this.codice = codice;
  }
}

// ── Istruzioni (identiche in ogni chiamata, così restano in cache) ─────────

export const ISTRUZIONI = `Sei un assistente tecnico al servizio dei progettisti di stand fieristici di WES. Le fonti sono i regolamenti tecnici di una fiera, dell'ente fiera e/o dell'organizzatore. Il tuo unico compito è estrarre dalle fonti le prescrizioni che vincolano la progettazione e l'allestimento dello stand e restituirle come voci strutturate.

Principio prioritario
L'accuratezza viene prima della completezza. Una scheda in cui metà delle voci risulta "non_specificato" ma ogni dato riportato è verificabile nella fonte vale più di una scheda completa che contiene anche una sola informazione non presente nei documenti. Non riempire mai una voce per il gusto di completarla.

Regole di estrazione
1. Riporta solo ciò che è scritto in modo esplicito nelle fonti. Non dedurre, non stimare, non calcolare, non convertire unità di misura, non integrare con conoscenze esterne o con prassi fieristiche generali.
2. Per ogni valore trascrivi la citazione testuale esatta da cui lo ricavi, copiata carattere per carattere nella lingua originale del regolamento, come è stampata nella pagina: stesse parole, stessi numeri, stessa punteggiatura. Non tradurre, non correggere refusi, non riassumere, non aggiungere né togliere parole, non usare puntini di sospensione. Ogni citazione è un passaggio continuo del testo e comprende almeno la frase intera o la riga intera che contiene il dato (per esempio "Maximum height: 8ft." e non solo "8ft."): un frammento di poche parole non può essere verificato. Se ti servono passaggi non contigui, usa più citazioni, ciascuna con la sua pagina.
3. La pagina di una citazione è il numero progressivo della pagina nel file PDF (la prima pagina del file è 1), non il numero stampato a piè di pagina.
4. Se non trovi una frase che contiene il dato, la voce è "non_specificato": valore vuoto e nessuna citazione.
5. Non combinare più frasi o più articoli per derivare un valore. Se un parametro richiede di mettere insieme passaggi diversi, non risolverlo: stato "da_verificare" con i passaggi rilevanti come citazioni.
6. Se una frase è ambigua, condizionata o parziale (vale solo in certi casi, rimanda ad altro documento, usa formule come "di norma", "salvo deroga", "where facility allows"), non trasformarla in un valore netto: stato "da_verificare" con la citazione integrale e il motivo.
7. Riconosci i concetti anche quando il regolamento usa termini diversi da quelli della scheda (vedi i sinonimi), ma solo se il significato coincide senza interpretazione.
8. Se due fonti dicono cose diverse sullo stesso parametro, crea una sola voce con stato "da_verificare", motivo "conflitto tra fonti", nel valore entrambi i dati con la fonte di ciascuno e le citazioni di entrambe le fonti. Non decidere quale prevalga.
9. Tempi e accessi: distingui sempre allestimento, disallestimento e accesso degli espositori durante la manifestazione, e non fondere orari di fasi diverse. Se un orario è riportato senza che la fonte chiarisca a quale fase si riferisce, stato "da_verificare". Non confondere l'orario di accesso degli espositori con l'orario di apertura al pubblico.
10. I regolamenti possono essere in inglese, italiano, tedesco, spagnolo o francese. Scrivi parametro, valore e motivo in italiano; le citazioni restano nella lingua originale. Nei testi in italiano (valore, motivo) indica le fonti con il loro nome (per esempio "Regolamento", "Appendice A"), non con gli identificativi f1, f2.

Stati
- "confermato": la citazione contiene letteralmente il dato riportato nel valore.
- "da_verificare": passaggio ambiguo, condizionato, da comporre con altri, in conflitto tra fonti o che rimanda ad altro documento. Il motivo lo dice in poche parole.
- "non_specificato": le fonti non trattano il parametro.
Ogni citazione che proponi sarà cercata dal software nel testo del PDF: se non viene ritrovata alla lettera, la voce scende a "da_verificare". Copiare esattamente è quindi essenziale.

Forma delle voci
- valore: in italiano, sintetico, con numeri e unità come sono scritti nella fonte (ft, sf, m, mq, kg…). Vuoto per "non_specificato".
- motivo: per "da_verificare" il motivo in poche parole (per esempio "condizionato alla struttura del padiglione", "rimanda al Target Floor Plan"); vuoto negli altri casi.
- Le pagine che il testo del PDF non rende leggibile ti sono fornite anche come testo ricavato con lettura ottica: usalo per copiare le citazioni, controllando sull'immagine della pagina.

Controllo finale
Prima di restituire le voci, rileggi ogni voce "confermato" e verifica che la citazione contenga davvero il valore riportato. Se non lo contiene in modo letterale, declassala a "da_verificare" o a "non_specificato". Non lasciare alcun valore privo della sua citazione.`;

// ── Contenuti della richiesta ──────────────────────────────────────────────

const RUOLI = { ente: 'ente fiera', organizzatore: 'organizzatore', altro: 'altra fonte' };

/**
 * Blocchi delle fonti: documenti PDF e testo ottico delle pagine illeggibili.
 * L'ultimo blocco porta il punto di cache: tutto ciò che precede è uguale in
 * ogni chiamata dello stesso lavoro.
 */
function blocchiFonti(fonti) {
  const blocchi = [{
    type: 'text',
    text: 'Fonti caricate:\n' + fonti.map((f) =>
      `- ${f.id}: «${f.file}», ${RUOLI[f.ruolo] || RUOLI.altro}, ${f.pagine.length} pagine`).join('\n')
  }];
  for (const f of fonti) {
    blocchi.push({ type: 'text', text: `Fonte ${f.id}: «${f.file}» (${RUOLI[f.ruolo] || RUOLI.altro}).` });
    blocchi.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: f.base64 },
      title: `${f.id} — ${f.file}`
    });
    const ottiche = f.pagine.filter((p) => p.ocr);
    if (ottiche.length) {
      blocchi.push({
        type: 'text',
        text: `Fonte ${f.id}: il testo del PDF è illeggibile nelle pagine ${ottiche.map((p) => p.numero).join(', ')}. ` +
          'Questo è il testo ricavato con lettura ottica, pagina per pagina:\n\n' +
          ottiche.map((p) => `=== ${f.id}, pagina ${p.numero} ===\n${p.ocr.trim()}`).join('\n\n')
      });
    }
  }
  blocchi[blocchi.length - 1].cache_control = { type: 'ephemeral' };
  return blocchi;
}

function istruzioniCompito(compito) {
  const sezioni = SEZIONI.filter((s) => compito.lettere.includes(s.lettera));
  const parametri = compito.parametri
    ? PARAMETRI.filter((p) => compito.parametri.includes(p.id))
    : parametriDelGruppo(compito.lettere);

  const riga = (p) =>
    `  - id "${p.id}": ${p.descrizione}` +
    (p.multiplo ? ` Se il valore cambia per tipo di stand, fase, area o padiglione, crea una voce per caso con id "${p.id}__<qualificatore>" (per esempio "${p.id}__inline").` : '');

  const elenco = sezioni.map((s) => {
    const obbligatori = parametri.filter((p) => p.sezione === s.lettera && !p.facoltativo);
    const temi = parametri.filter((p) => p.sezione === s.lettera && p.facoltativo);
    let testo = `Sezione ${s.lettera} — ${s.titolo} (ambito: ${s.ambito})\n`;
    testo += obbligatori.length
      ? '  Parametri (ciascuno deve comparire, anche come "non_specificato"):\n' + obbligatori.map(riga).join('\n')
      : '  Nessun parametro obbligatorio in questa parte del compito.';
    if (temi.length) {
      testo += '\n  Temi da controllare (crea la voce solo se le fonti li trattano; se non li trattano, nessuna voce):\n' + temi.map(riga).join('\n');
    }
    return testo;
  }).join('\n\n');

  const altre = compito.altre !== false
    ? 'Infine leggi tutte le pagine di tutte le fonti e aggiungi una voce per ciascuna altra prescrizione tecnica o estetica vincolante per la progettazione o l\'allestimento dello stand che rientra nell\'ambito di queste sezioni e non è coperta dai parametri o dai temi: id "altra_<titolo_breve>", parametro che inizia con "Altra: ", stato "confermato" o "da_verificare". Una voce per prescrizione distinta: non accorpare prescrizioni diverse nella stessa voce. ' +
      'Non aggiungere voci "non_specificato" per le altre prescrizioni. ' +
      `Non includere prescrizioni che appartengono ad altre sezioni della scheda (${SEZIONI.filter((s) => !compito.lettere.includes(s.lettera)).map((s) => s.lettera + ' ' + s.titolo).join('; ')}): saranno estratte in un'altra chiamata.`
    : 'Limita il lavoro ai parametri e ai temi elencati: non aggiungere altre prescrizioni.';

  return `Compito di questa chiamata: compila le voci delle sezioni ${compito.lettere.join(' e ')}.\n\n${elenco}\n\n${altre}`;
}

// Lo schema è identico in tutte le chiamate dello stesso lavoro (tutte le
// lettere, tutte le fonti): se cambiasse da un gruppo all'altro, la cache dei
// PDF verrebbe invalidata a ogni chiamata. Le voci fuori dal compito sono
// scartate dopo, da preparaVoci.
export function schemaRisposta(fonti) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['voci'],
    properties: {
      voci: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'sezione', 'parametro', 'valore', 'stato', 'motivo', 'citazioni'],
          properties: {
            id: { type: 'string' },
            sezione: { type: 'string', enum: LETTERE },
            parametro: { type: 'string' },
            valore: { type: 'string' },
            stato: { type: 'string', enum: STATI },
            motivo: { type: 'string' },
            citazioni: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['fonte', 'pagina', 'testo'],
                properties: {
                  fonte: { type: 'string', enum: fonti.map((f) => f.id) },
                  pagina: { type: 'integer' },
                  testo: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  };
}

// ── Divisione dei compiti ──────────────────────────────────────────────────

/** Compiti iniziali: un gruppo di due sezioni per chiamata. */
export function compitiIniziali(gruppi) {
  return gruppi.map((lettere) => ({ lettere: [...lettere], parametri: null, altre: true }));
}

/**
 * Divide un compito troncato in compiti più piccoli.
 * Gruppo di più sezioni → una sezione per compito. Sezione singola → metà dei
 * parametri previsti senza "altre prescrizioni" + l'altra metà con le altre
 * prescrizioni. Sezione con le sole altre prescrizioni → non divisibile.
 * @returns {Array|null} null se il compito non è più divisibile
 */
export function dividiCompito(compito) {
  if (compito.lettere.length > 1) {
    return compito.lettere.map((l) => ({ lettere: [l], parametri: null, altre: compito.altre }));
  }
  const ids = compito.parametri || parametriDelGruppo(compito.lettere).map((p) => p.id);
  if (ids.length >= 2) {
    const meta = Math.ceil(ids.length / 2);
    return [
      { lettere: compito.lettere, parametri: ids.slice(0, meta), altre: false },
      { lettere: compito.lettere, parametri: ids.slice(meta), altre: compito.altre }
    ];
  }
  if (ids.length === 1 && compito.altre) {
    return [
      { lettere: compito.lettere, parametri: ids, altre: false },
      { lettere: compito.lettere, parametri: [], altre: true }
    ];
  }
  return null;
}

// ── Chiamata al modello ────────────────────────────────────────────────────

/**
 * Esegue un compito di estrazione.
 *
 * @param {object} opzioni
 * @param {import('@anthropic-ai/sdk').default} opzioni.client
 * @param {string} opzioni.modello
 * @param {string} opzioni.effort
 * @param {number} opzioni.maxTokens
 * @param {Array} opzioni.fonti  [{ id, file, ruolo, base64, pagine }]
 * @param {object} opzioni.compito  { lettere, parametri, altre }
 * @returns {Promise<{ troncato: true, uso } | { troncato: false, voci, uso, modello }>}
 */
export async function eseguiCompito({ client, modello, effort, maxTokens, fonti, compito }) {
  const richiesta = {
    model: modello,
    max_tokens: maxTokens,
    system: ISTRUZIONI,
    thinking: { type: 'adaptive' },
    output_config: {
      effort,
      format: { type: 'json_schema', schema: schemaRisposta(fonti) }
    },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{
      role: 'user',
      content: [...blocchiFonti(fonti), { type: 'text', text: istruzioniCompito(compito) }]
    }]
  };

  const risposta = await client.beta.messages.stream(richiesta).finalMessage();
  const uso = risposta.usage;

  if (risposta.stop_reason === 'max_tokens') return { troncato: true, uso };
  if (risposta.stop_reason === 'refusal') {
    throw new ErroreEstrazione('Il modello ha rifiutato la richiesta. Riprova o contatta chi gestisce il servizio.', 'rifiuto');
  }
  if (risposta.stop_reason !== 'end_turn') {
    throw new ErroreEstrazione(`Risposta del modello interrotta (${risposta.stop_reason}).`, 'interrotta');
  }

  const testo = risposta.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let dati;
  try {
    dati = JSON.parse(testo);
  } catch {
    throw new ErroreEstrazione('La risposta del modello non è JSON valido.', 'json');
  }
  if (!dati || !Array.isArray(dati.voci)) throw new ErroreEstrazione('Risposta del modello senza voci.', 'json');

  return { troncato: false, voci: dati.voci, uso, modello: risposta.model };
}

// ── Dalle voci del modello alle voci della scheda ──────────────────────────

/**
 * Normalizza le voci di un compito, le verifica sui testi delle pagine e
 * scarta quelle fuori dal compito. Lo stato finale è deciso da verificaVoce.
 */
export function preparaVoci(vociModello, compito, fonti) {
  const indici = new Map(fonti.map((f) => [f.id, indicizza(f.pagine)]));
  const ammessi = compito.parametri ? new Set(compito.parametri) : null;
  const visti = new Map();

  for (const v of vociModello) {
    if (!compito.lettere.includes(v.sezione)) continue;
    const id = identificativoStabile(v.id, v.parametro);
    const previsto = PARAMETRI.find((p) => p.id === id.split('__')[0]);
    if (previsto && ammessi && !ammessi.has(previsto.id)) continue;
    if (!previsto && compito.altre === false) continue;
    // Le altre prescrizioni e i temi facoltativi esistono solo se trattati
    if ((!previsto || previsto.facoltativo) && v.stato === 'non_specificato') continue;

    const sezione = previsto ? previsto.sezione : v.sezione;
    if (!compito.lettere.includes(sezione)) continue;
    const base = {
      id,
      sezione,
      parametro: String(v.parametro || previsto?.parametro || id).trim(),
      valore: v.stato === 'non_specificato' ? '' : String(v.valore || '').trim(),
      stato: STATI.includes(v.stato) ? v.stato : 'da_verificare',
      motivo: String(v.motivo || '').trim() || null,
      citazioni: v.stato === 'non_specificato' ? [] : (v.citazioni || []).map((c) => ({
        fonte: c.fonte, pagina: c.pagina, testo: String(c.testo || '')
      })),
      chiarimento: null,
      note: null
    };
    // Identificativo ripetuto nello stesso compito: si aggiunge un suffisso,
    // senza perdere nessuna delle due voci.
    let idUnico = id;
    for (let n = 2; visti.has(idUnico); n++) idUnico = `${id}_${n}`;
    base.id = idUnico;
    visti.set(idUnico, verificaVoce(base, indici));
  }

  // I parametri previsti che il modello ha omesso diventano "non_specificato":
  // l'omissione non è un dato, ma la voce deve comparire nella scheda.
  const attesi = (compito.parametri
    ? PARAMETRI.filter((p) => compito.parametri.includes(p.id))
    : parametriDelGruppo(compito.lettere)).filter((p) => !p.facoltativo);
  for (const p of attesi) {
    const presente = [...visti.keys()].some((id) => id === p.id || id.startsWith(p.id + '__'));
    if (!presente) {
      visti.set(p.id, {
        id: p.id, sezione: p.sezione, parametro: p.parametro, valore: '', stato: 'non_specificato',
        statoProposto: null, motivo: 'voce non restituita dal modello', citazioni: [], chiarimento: null, note: null
      });
    }
  }
  return [...visti.values()];
}

// ── Orchestrazione (usata dal collaudo; il frontend fa lo stesso via HTTP) ─

/**
 * Esegue tutti i compiti, dividendo quelli troncati.
 * @param {(compito: object) => Promise<object>} esegui  esegue un compito e
 *   restituisce l'esito di eseguiCompito
 * @param {(evento: object) => void} [avanzamento]
 */
export async function estraiTutto(compiti, esegui, avanzamento = () => {}) {
  const coda = [...compiti];
  const esiti = [];
  const incompleti = [];
  while (coda.length) {
    const compito = coda.shift();
    avanzamento({ tipo: 'inizio', compito, restanti: coda.length });
    const esito = await esegui(compito);
    if (esito.troncato) {
      const parti = dividiCompito(compito);
      avanzamento({ tipo: 'troncato', compito, parti });
      if (parti) coda.unshift(...parti);
      else incompleti.push(compito);
      continue;
    }
    esiti.push({ compito, ...esito });
    avanzamento({ tipo: 'fine', compito, voci: esito.voci.length });
  }
  return { esiti, incompleti };
}
