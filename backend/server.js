// Servizio della Scheda regolamenti fiera WES.
//
// Riceve i PDF dei regolamenti, ne legge il testo (con lettura ottica delle
// pagine illeggibili), fa estrarre al modello le prescrizioni un gruppo di
// sezioni alla volta e verifica le citazioni nel testo del PDF. Non conserva
// nulla: i file vivono in memoria per la durata della richiesta e poi
// spariscono. Nei log finiscono solo numeri di pagine e token, mai il testo
// dei regolamenti.

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

import { leggiPdf, chiudiOcr, ErroreLettura } from './lettura.js';
import { eseguiCompito, preparaVoci, dividiCompito, ErroreEstrazione } from './estrazione.js';
import { LETTERE, ID_PARAMETRI, SEZIONI, GRUPPI } from './parametri.js';
import { vociIncomplete } from './scheda.js';
import { sigilla, firmaScheda, verificaScheda, riverifica, ErroreFileLavoro, FORMATO, VERSIONE } from './lavoro.js';
import { fondiVoci } from './fusione.js';
import { rispondi, ErroreChat } from './chat.js';
import { firma, firmaValida, ErroreFirma } from './firma.js';

// ── Configurazione ────────────────────────────────────────────────────────
const PORTA = process.env.PORT || 3000;
const MODELLO = process.env.MODELLO || 'claude-sonnet-5-5';
const EFFORT = process.env.EFFORT || 'medium';
const CODICE_ACCESSO = (process.env.CODICE_ACCESSO || '').trim();
const FIRMA_SEGRETO = process.env.FIRMA_SEGRETO || '';
const MAX_MB = Number(process.env.MAX_MB || 25);
const LIMITE_ORARIO = Number(process.env.LIMITE_ORARIO || 200);
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 32000);
const EFFORT_CHAT = process.env.EFFORT_CHAT || 'low';

const ORIGINI_CONSENTITE = (process.env.ORIGINI_CONSENTITE ||
  'http://localhost:3000,http://127.0.0.1:3000,http://localhost:8080,http://127.0.0.1:8080')
  .split(',').map((o) => o.trim()).filter(Boolean);

// La pagina si apre anche con un doppio click dal disco: in quel caso il
// browser manda Origin: null. Si può disattivare con CONSENTI_ORIGINE_NULL=false.
const CONSENTI_ORIGINE_NULL = process.env.CONSENTI_ORIGINE_NULL !== 'false';

const CARTELLA_FRONTEND = fileURLToPath(new URL('../frontend/', import.meta.url));

const client = new Anthropic();
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render sta dietro un proxy: serve per leggere l'IP reale

// ── CORS ──────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const origine = req.headers.origin;
  const ammessa =
    (origine === 'null' && CONSENTI_ORIGINE_NULL) ||
    (origine && ORIGINI_CONSENTITE.includes(origine));

  if (ammessa) {
    res.set('Access-Control-Allow-Origin', origine);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Codice-Accesso');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(ammessa ? 204 : 403);
  next();
});

app.use(express.json({ limit: `${Math.ceil(MAX_MB * 1.4) + 2}mb` }));

// ── Limite di richieste per IP (finestra di un'ora) ───────────────────────
const contatori = new Map();

function oltreIlLimite(ip) {
  const ora = Date.now();
  const finestra = 60 * 60 * 1000;
  const voce = contatori.get(ip);

  if (!voce || ora - voce.da > finestra) {
    contatori.set(ip, { da: ora, n: 1 });
    return false;
  }
  voce.n += 1;
  return voce.n > LIMITE_ORARIO;
}

// La mappa non cresce all'infinito: ogni 10 minuti si buttano le voci scadute
setInterval(() => {
  const soglia = Date.now() - 60 * 60 * 1000;
  for (const [ip, voce] of contatori) if (voce.da < soglia) contatori.delete(ip);
}, 10 * 60 * 1000).unref();

// Controlli comuni alle rotte /api: codice d'accesso e limite orario
function controlliApi(req, res, next) {
  if (CODICE_ACCESSO && req.get('X-Codice-Accesso') !== CODICE_ACCESSO) {
    return res.status(401).json({ errore: 'Codice di accesso mancante o errato.', codice: 'accesso' });
  }
  if (oltreIlLimite(req.ip)) {
    return res.status(429).json({
      errore: `Hai superato il limite di ${LIMITE_ORARIO} richieste all'ora. Riprova più tardi.`
    });
  }
  next();
}

function decodificaPdf(base64, etichetta) {
  if (typeof base64 !== 'string' || !base64) {
    throw new ErroreLettura(`Nessun file ricevuto${etichetta ? ` per ${etichetta}` : ''}.`, 'vuoto');
  }
  return Buffer.from(base64, 'base64');
}

// Picco di memoria del processo, per controllare i limiti del piano Render
let memoriaMassima = process.memoryUsage().rss;
setInterval(() => {
  memoriaMassima = Math.max(memoriaMassima, process.memoryUsage().rss);
}, 500).unref();

// Fonti inviate dal browser con il testo letto da /api/leggi. Il testo vale
// solo se porta la firma del server e appartiene proprio a quel PDF.
function preparaFonti(fonti) {
  let byte = 0;
  const visti = new Set();
  const preparate = fonti.map((f) => {
    const id = String(f.id || '');
    if (!/^f\d{1,3}$/.test(id) || visti.has(id)) throw new ErroreLettura('Identificativi delle fonti non validi.', 'richiesta');
    visti.add(id);
    const buffer = decodificaPdf(f.base64, f.file);
    byte += buffer.length;
    const lettura = f.lettura || {};
    if (lettura.sha256 !== sha256(buffer) ||
        !firmaValida(datiLettura(lettura.sha256, lettura.pagine || []), lettura.firma, FIRMA_SEGRETO, 'pagine')) {
      throw new ErroreLettura(`Il testo di «${f.file}» non è valido: ricarica il regolamento.`, 'lettura_non_valida');
    }
    return {
      id,
      file: String(f.file || id),
      ruolo: ['ente', 'organizzatore', 'altro'].includes(f.ruolo) ? f.ruolo : 'altro',
      base64: f.base64,
      sha256: lettura.sha256,
      pagine: lettura.pagine
    };
  });
  if (byte > MAX_MB * 1024 * 1024) {
    throw new ErroreLettura(`I regolamenti superano insieme il limite di ${MAX_MB} MB.`, 'troppo_grande');
  }
  return preparate;
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

// Dati firmati della lettura: solo ciò che serve alla verifica delle citazioni
const datiLettura = (sha, pagine) => ({
  sha256: sha,
  pagine: pagine.map((p) => ({ numero: p.numero, testo: p.testo, ocr: p.ocr ?? null }))
});

// ── Rotte ─────────────────────────────────────────────────────────────────

// Usata anche dalla pagina per "svegliare" il servizio: sul piano gratuito di
// Render l'istanza va in sospensione dopo un po' di inattività e la prima
// richiesta successiva può metterci quasi un minuto.
app.get('/health', (_req, res) => {
  res.json({
    stato: 'attivo',
    modello: MODELLO,
    codiceRichiesto: Boolean(CODICE_ACCESSO),
    firmaConfigurata: FIRMA_SEGRETO.length >= 32,
    memoriaMB: Math.round(process.memoryUsage().rss / 1e6),
    memoriaMassimaMB: Math.round(memoriaMassima / 1e6)
  });
});

// Sezioni e gruppi di estrazione: la pagina li chiede qui, così l'elenco
// esiste in un posto solo.
app.get('/api/configurazione', controlliApi, (_req, res) => {
  res.json({ sezioni: SEZIONI.map(({ lettera, titolo }) => ({ lettera, titolo })), gruppi: GRUPPI });
});

// Lettura di un PDF: testo per pagina, lettura ottica dove serve, firma.
app.post('/api/leggi', controlliApi, async (req, res, next) => {
  try {
    if (FIRMA_SEGRETO.length < 32) throw new ErroreFirma('FIRMA_SEGRETO non impostato o troppo corto.');
    const { base64 } = req.body || {};
    const buffer = decodificaPdf(base64);
    if (buffer.length > MAX_MB * 1024 * 1024) {
      return res.status(413).json({ errore: `Il file supera il limite di ${MAX_MB} MB.` });
    }
    const inizio = Date.now();
    const lettura = await leggiPdf(buffer);
    const ottiche = lettura.pagine.filter((p) => p.ocr).length;
    memoriaMassima = Math.max(memoriaMassima, process.memoryUsage().rss);
    console.log(`[leggi] ${lettura.numeroPagine} pagine · ${ottiche} lette per via ottica · ${Date.now() - inizio} ms · picco memoria ${Math.round(memoriaMassima / 1e6)} MB`);

    const dati = datiLettura(lettura.sha256, lettura.pagine);
    res.json({
      sha256: lettura.sha256,
      numeroPagine: lettura.numeroPagine,
      lingua: lettura.lingua,
      pagine: lettura.pagine.map((p) => ({
        numero: p.numero, testo: p.testo, ocr: p.ocr, leggibile: p.leggibilita.leggibile
      })),
      firma: firma(dati, FIRMA_SEGRETO, 'pagine')
    });
  } catch (err) {
    next(err);
  }
});

// Estrazione di un compito (gruppo di sezioni o sua parte).
app.post('/api/estrai', controlliApi, async (req, res, next) => {
  try {
    const { fonti, compito, maxTokens } = req.body || {};
    if (!Array.isArray(fonti) || !fonti.length) {
      return res.status(400).json({ errore: 'Nessun regolamento ricevuto.' });
    }
    if (!compito || !Array.isArray(compito.lettere) || !compito.lettere.length ||
        !compito.lettere.every((l) => LETTERE.includes(l)) ||
        (compito.parametri != null && (!Array.isArray(compito.parametri) || !compito.parametri.every((p) => ID_PARAMETRI.has(p))))) {
      return res.status(400).json({ errore: 'Compito di estrazione non valido.' });
    }

    const preparate = preparaFonti(fonti);

    const compitoPulito = {
      lettere: compito.lettere,
      parametri: compito.parametri ?? null,
      altre: compito.altre !== false
    };
    const limite = Number.isFinite(Number(maxTokens)) ? Math.min(Math.max(Number(maxTokens), 1000), MAX_TOKENS) : MAX_TOKENS;

    const esito = await eseguiCompito({
      client, modello: MODELLO, effort: EFFORT, maxTokens: limite, fonti: preparate, compito: compitoPulito
    });
    const u = esito.uso || {};
    console.log(
      `[estrai] ${compitoPulito.lettere.join('')}${compitoPulito.parametri ? ` (${compitoPulito.parametri.length} param.)` : ''} · ` +
      `${esito.troncato ? 'TRONCATO' : `${esito.voci.length} voci`} · in ${u.input_tokens} cache ${u.cache_read_input_tokens}/${u.cache_creation_input_tokens} out ${u.output_tokens}`
    );

    // Risposta troncata: nulla entra nella scheda. Il server indica come
    // dividere il compito; se non è più divisibile, restituisce le voci da
    // segnare come "estrazione incompleta".
    if (esito.troncato) {
      const parti = dividiCompito(compitoPulito);
      return res.json(parti ? { troncato: true, parti } : { troncato: true, parti: null, vociIncomplete: vociIncomplete(compitoPulito) });
    }
    res.json({
      troncato: false,
      // Le voci confermate dal codice ricevono il sigillo del server
      voci: preparaVoci(esito.voci, compitoPulito, preparate).map((v) => sigilla(v, preparate, FIRMA_SEGRETO)),
      meta: { modello: esito.modello, uso: esito.uso }
    });
  } catch (err) {
    next(err);
  }
});

// ── File di lavoro ────────────────────────────────────────────────────────

// Firma della scheda per il file di lavoro (dopo il controllo dei sigilli)
app.post('/api/firma', controlliApi, (req, res, next) => {
  try {
    const { scheda, firma: f, declassate } = firmaScheda(req.body?.scheda, FIRMA_SEGRETO);
    console.log(`[firma] ${scheda.voci.length} voci${declassate ? ` · ${declassate} conferme senza sigillo declassate` : ''}`);
    res.json({ formato: FORMATO, versione: VERSIONE, scheda, firma: f, declassate });
  } catch (err) {
    next(err);
  }
});

// Verifica di una scheda ricaricata (file di lavoro o autosalvataggio)
app.post('/api/verifica-scheda', controlliApi, (req, res, next) => {
  try {
    const { scheda, firma: f, modo } = req.body || {};
    const esito = verificaScheda(scheda, f, FIRMA_SEGRETO, modo === 'autosalvataggio' ? 'autosalvataggio' : 'file');
    console.log(`[verifica-scheda] ${esito.valida ? 'firma valida' : 'firma non valida'} · ${esito.declassate} declassate`);
    res.json(esito);
  } catch (err) {
    next(err);
  }
});

// Riverifica delle citazioni con i regolamenti ricaricati
app.post('/api/riverifica', controlliApi, (req, res, next) => {
  try {
    const { fonti, voci } = req.body || {};
    if (!Array.isArray(fonti) || !fonti.length || !Array.isArray(voci)) {
      return res.status(400).json({ errore: 'Richiesta di riverifica non valida.' });
    }
    const esito = riverifica(voci, preparaFonti(fonti), FIRMA_SEGRETO);
    console.log(`[riverifica] ${esito.ripristinate} ripristinate · ${esito.ancoraAperte} ancora aperte`);
    res.json(esito);
  } catch (err) {
    next(err);
  }
});

// Fusione per identificativo con le voci estratte da nuovi regolamenti
app.post('/api/fondi', controlliApi, (req, res, next) => {
  try {
    const { fonti, esistenti, nuove } = req.body || {};
    if (!Array.isArray(fonti) || !Array.isArray(esistenti) || !Array.isArray(nuove)) {
      return res.status(400).json({ errore: 'Richiesta di fusione non valida.' });
    }
    const esito = fondiVoci(esistenti, nuove, fonti, FIRMA_SEGRETO);
    console.log(`[fondi] ${esito.aggiunte} aggiunte · ${esito.aggiornate} aggiornate · ${esito.conflitti} conflitti`);
    res.json(esito);
  } catch (err) {
    next(err);
  }
});

// ── Chat di risoluzione ───────────────────────────────────────────────────
app.post('/api/chat', controlliApi, async (req, res, next) => {
  try {
    const { voce, fonti, collegate, lingua, messaggi, richiesta } = req.body || {};
    if (!voce || typeof voce !== 'object' || (messaggi != null && !Array.isArray(messaggi))) {
      return res.status(400).json({ errore: 'Richiesta di chat non valida.' });
    }
    const esito = await rispondi({
      client, modello: MODELLO, effort: EFFORT_CHAT, voce, fonti, collegate, lingua,
      messaggi: messaggi || [], richiesta: richiesta === 'domanda' ? 'domanda' : 'risposta'
    });
    const u = esito.uso || {};
    console.log(`[chat] ${esito.proposta ? 'proposta ' + esito.proposta.tipo : 'messaggio'} · in ${u.input_tokens} out ${u.output_tokens}`);
    const { uso: _u, ...risposta } = esito;
    res.json(risposta);
  } catch (err) {
    next(err);
  }
});

// La pagina dell'app è servita dallo stesso servizio (un solo indirizzo)
app.use(express.static(CARTELLA_FRONTEND, { index: 'index.html', extensions: ['html'] }));

// ── Errori ────────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ errore: `I file superano il limite di ${MAX_MB} MB.` });
  }
  if (err instanceof SyntaxError) {
    return res.status(400).json({ errore: 'Richiesta malformata.' });
  }
  if (err instanceof ErroreLettura) {
    const stato = { lettura_non_valida: 409, troppo_grande: 413, richiesta: 400, vuoto: 400 }[err.codice] || 415;
    return res.status(stato).json({ errore: err.message, codice: err.codice });
  }
  if (err instanceof ErroreFirma) {
    console.error('[firma]', err.message);
    return res.status(500).json({ errore: 'Il servizio non è configurato correttamente (segreto di firma).', codice: 'firma' });
  }
  if (err instanceof ErroreFileLavoro) {
    return res.status(422).json({ errore: err.message, codice: 'file_lavoro' });
  }
  if (err instanceof ErroreChat) {
    return res.status(502).json({ errore: err.message, codice: 'chat' });
  }
  if (err instanceof ErroreEstrazione) {
    return res.status(502).json({ errore: err.message, codice: err.codice });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return res.status(429).json({
      errore: 'Il servizio AI ha raggiunto il limite di richieste. Riprova fra qualche minuto.'
    });
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    console.error('[api] credenziali:', err.message);
    return res.status(502).json({
      errore: 'Il servizio AI ha rifiutato le credenziali. Controlla la chiave API su Render.'
    });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return res.status(504).json({ errore: 'Il servizio AI non risponde. Riprova fra poco.' });
  }
  if (err instanceof Anthropic.APIError) {
    console.error('[api] errore:', err.status, err.message);
    // Il messaggio dell'API viene riportato al chiamante, come nel servizio
    // del brief: non contiene il testo dei regolamenti.
    return res.status(502).json({
      errore: `Il servizio AI ha restituito un errore (${err.status}).`,
      dettaglio: String(err.message || '').slice(0, 500)
    });
  }
  console.error('[server] imprevisto:', err?.name, err?.message);
  res.status(500).json({ errore: 'Errore imprevisto.' });
});

const server = app.listen(PORTA, () => {
  console.log(`Scheda regolamenti WES in ascolto sulla porta ${PORTA} · modello ${MODELLO} · effort ${EFFORT}`);
  if (!CODICE_ACCESSO) {
    console.warn('ATTENZIONE: CODICE_ACCESSO non impostato, endpoint aperto a chiunque conosca l\'URL.');
  }
  if (FIRMA_SEGRETO.length < 32) {
    console.warn('ATTENZIONE: FIRMA_SEGRETO non impostato o più corto di 32 caratteri: lettura e file di lavoro non funzioneranno.');
  }
});

for (const segnale of ['SIGTERM', 'SIGINT']) {
  process.on(segnale, () => {
    server.close();
    chiudiOcr().finally(() => process.exit(0));
  });
}
