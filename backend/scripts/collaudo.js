// Collaudo da riga di comando sul caso NPE2027 (punto 11 delle specifiche).
//
//   npm run collaudo                      estrazione completa e quattro soglie
//   npm run collaudo -- --max-tokens 3000 simula il limite di token
//   npm run collaudo -- --gruppi AB,CD    solo alcuni gruppi
//   npm run collaudo -- --scheda <file>   rimisura le soglie su una scheda già estratta
//
// Chiama direttamente i moduli del backend (niente HTTP) con la chiave in .env.
// La scheda e il rapporto finiscono in backend/collaudo-esiti/ (fuori da git).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

import { leggiPdf, chiudiOcr } from '../lettura.js';
import { compitiIniziali, eseguiCompito, preparaVoci, estraiTutto } from '../estrazione.js';
import { GRUPPI } from '../parametri.js';
import { unisciVoci, vociIncomplete, nuovaScheda, conteggi } from '../scheda.js';
import { indicizza, verificaCitazione, normalizza } from '../verifica.js';

const RADICE = fileURLToPath(new URL('../../', import.meta.url));
const MAPPA_GOLDEN = JSON.parse(readFileSync(new URL('./mappa-golden.json', import.meta.url), 'utf8'));
const ESITI = fileURLToPath(new URL('../collaudo-esiti/', import.meta.url));
const FONTI = [
  { id: 'f1', file: 'NPE_Show_Rules_and_Regulations.pdf', ruolo: 'organizzatore', etichetta: 'Reg.' },
  { id: 'f2', file: 'NPE_APPENDIX_A_-_Booth_Types2C_Dimensions2C_Display_Measurement_Rules.pdf', ruolo: 'organizzatore', etichetta: 'App. A' }
];

// Voci "Non specificato" del golden e parametro corrispondente della scheda A-J
const NON_SPECIFICATI_GOLDEN = {
  'Soppalchi: altezza max': 'soppalchi_altezza_max',
  "Soppalchi: % rispetto all'area dello stand": 'soppalchi_percentuale',
  'Percentuale max di chiusura del perimetro': 'chiusura_perimetro_max',
  'Portata max per punto (kg)': 'appendimenti_portata_punto',
  'Limite di carico complessivo': 'appendimenti_carico_complessivo',
  'Disponibilità, modalità, limiti di potenza': 'alimentazione_dall_alto',
  'Superficie max copribile in modo pieno': 'cielinatura_superficie_max',
  'Porzioni a rete o tessuto traspirante': 'cielinatura_porzioni_traspiranti',
  'Soglia m² per sprinkler/antincendio': 'sprinkler_soglia',
  'Oblò o finestratura sulle porte': 'porte_oblo',
  'Angoli arrotondati sulle pedane': 'pedane_angoli_arrotondati',
  'Pedane: altezza max e rampa': 'pedane_altezza_rampa',
  'Allestimento: proroghe e lavoro notturno': 'allestimento_proroghe_notturno'
};

function argomenti() {
  const a = process.argv.slice(2);
  const valore = (nome) => { const i = a.indexOf(nome); return i >= 0 ? a[i + 1] : undefined; };
  return {
    maxTokens: valore('--max-tokens') ? Number(valore('--max-tokens')) : Number(process.env.MAX_TOKENS || 32000),
    gruppi: valore('--gruppi') ? valore('--gruppi').split(',').map((g) => g.trim().toUpperCase().split('')) : GRUPPI,
    scheda: valore('--scheda')
  };
}

// ── Estrazione ─────────────────────────────────────────────────────────────

async function leggiFonti() {
  const fonti = [];
  for (const f of FONTI) {
    const buffer = readFileSync(RADICE + 'fixtures/regolamenti/' + f.file);
    const t0 = Date.now();
    const lettura = await leggiPdf(buffer);
    const ottiche = lettura.pagine.filter((p) => p.ocr).map((p) => p.numero);
    console.log(`Lettura ${f.etichetta}: ${lettura.numeroPagine} pagine, lettura ottica su [${ottiche.join(', ')}] in ${Date.now() - t0} ms`);
    fonti.push({ ...f, base64: buffer.toString('base64'), sha256: lettura.sha256, pagine: lettura.pagine });
  }
  return fonti;
}

async function estrai(fonti, { maxTokens, gruppi }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY non impostata: inseriscila in backend/.env');
  }
  const client = new Anthropic();
  const modello = process.env.MODELLO || 'claude-sonnet-5-5';
  const effort = process.env.EFFORT || 'medium';
  const uso = { input: 0, cacheLettura: 0, cacheScrittura: 0, output: 0, chiamate: 0, troncate: 0 };
  console.log(`Estrazione con ${modello}, effort ${effort}, max_tokens ${maxTokens}`);

  const esegui = async (compito) => {
    const t0 = Date.now();
    const esito = await eseguiCompito({ client, modello, effort, maxTokens, fonti, compito });
    const u = esito.uso || {};
    uso.chiamate++; uso.input += u.input_tokens || 0; uso.output += u.output_tokens || 0;
    uso.cacheLettura += u.cache_read_input_tokens || 0; uso.cacheScrittura += u.cache_creation_input_tokens || 0;
    if (esito.troncato) uso.troncate++;
    const nome = compito.lettere.join('') + (compito.parametri ? `[${compito.parametri.length}${compito.altre ? '+altre' : ''}]` : '');
    console.log(`  ${nome.padEnd(14)} ${esito.troncato ? 'TRONCATO → divido' : `${esito.voci.length} voci`} · ${Math.round((Date.now() - t0) / 1000)} s · out ${u.output_tokens}`);
    if (esito.troncato) return esito;
    return { ...esito, voci: preparaVoci(esito.voci, compito, fonti) };
  };

  const { esiti, incompleti } = await estraiTutto(compitiIniziali(gruppi), esegui);
  const voci = unisciVoci([...esiti.map((e) => e.voci), ...incompleti.map(vociIncomplete)]);
  const scheda = nuovaScheda({
    fonti: fonti.map((f) => ({ id: f.id, file: f.file, ruolo: f.ruolo, pagine: f.pagine.length, sha256: f.sha256 })),
    voci,
    autore: 'collaudo',
    fiera: { nome: 'NPE2027', edizione: '2027', date: '2027-05-03/2027-05-07' }
  });
  scheda.id = 'npe2027';
  return { scheda, uso, incompleti };
}

// ── Soglie ─────────────────────────────────────────────────────────────────

// Solo per il confronto del collaudo (l'app non converte mai nulla): il golden
// riporta gli orari in 24 h e qualche numero in cifre dove il regolamento lo
// scrive in lettere, quindi si portano entrambi i lati alla stessa forma.
const NUMERI_IN_LETTERE = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, sixteen: 16, twenty: 20,
  uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, dodici: 12, sedici: 16, venti: 20
};
function formaComune(s) {
  return String(s)
    .replace(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?/gi, (_, h, m, ap) => {
      let ore = Number(h) % 12;
      if (ap.toLowerCase() === 'p') ore += 12;
      return `${ore}:${m || '00'}`;
    })
    .replace(/\b(mezzanotte|midnight)\b/gi, '24:00')
    .replace(/\b[a-z]+\b/gi, (p) => (NUMERI_IN_LETTERE[p.toLowerCase()] ?? p));
}
const numeri = (s) => (formaComune(s).match(/\d+(?:[.,:]\d+)*/g) || []).map((n) => n.replace(/[.,]/g, '').replace(/:00$/, ''));

function misura(scheda, fonti) {
  const indici = new Map(fonti.map((f) => [f.id, indicizza(f.pagine)]));
  const confermate = scheda.voci.filter((v) => v.stato === 'confermato');

  // Soglia 1: nessuna voce confermata con citazioni non presenti nel PDF.
  // Si ricontrolla da capo ogni citazione, indipendentemente dal campo "verificata".
  const soglia1 = [];
  for (const v of confermate) {
    if (!v.citazioni.length) soglia1.push({ id: v.id, problema: 'nessuna citazione' });
    for (const c of v.citazioni) {
      const r = verificaCitazione(c.testo, c.pagina, indici.get(c.fonte));
      if (!r.verificata || !c.verificata) soglia1.push({ id: v.id, citazione: c.testo.slice(0, 80) });
    }
  }

  // Soglia 2: voci confermate del golden ritrovate con lo stesso valore.
  const golden = JSON.parse(readFileSync(RADICE + 'fixtures/golden/NPE2027_golden_8sezioni.json', 'utf8'));
  const righe = golden.flatMap((s) => s.rows.map((r) => ({ sezione: s.title[0], parametro: r[0], valore: r[1], rif: r[2], citazione: r[3], stato: r[4] })));
  const goldenConfermate = righe.filter((r) => r.stato.startsWith('Confermato'));
  const daVerificare = scheda.voci.filter((v) => v.stato === 'da_verificare');

  // Una voce del golden si ritrova per citazione (stesso passo del PDF) e per
  // parametro tramite mappa-golden.json (stessa prescrizione citata da un altro
  // passo, o divisa dal modello in più voci, anche "Altra:"). Si considerano
  // insieme le voci confermate trovate nei due modi.
  const perCitazione = (g, voci) => {
    const citEstratte = voci.flatMap((v) => v.citazioni.map((c) => ({ voce: v, n: normalizza(c.testo) })));
    const segmenti = g.citazione.split(' / ').map((s) => normalizza(s.replace(/\(analoghe.*?\)/, ''))).filter((s) => s.length >= 15);
    const trovate = new Set();
    for (const s of segmenti) {
      for (const c of citEstratte) if (c.n.length >= 15 && (c.n.includes(s) || s.includes(c.n))) trovate.add(c.voce);
    }
    return [...trovate];
  };
  const perParametro = (g, voci) => {
    const slug = MAPPA_GOLDEN[`${g.sezione} · ${g.parametro}`] || [];
    return voci.filter((v) => slug.some((s) => v.id === s || v.id.startsWith(s + '__') || (s.startsWith('altra_') && v.id.startsWith(s))));
  };

  const esiti2 = goldenConfermate.map((g) => {
    const perCit = perCitazione(g, confermate);
    const perPar = perParametro(g, confermate);
    const voci = [...new Set([...perCit, ...perPar])];
    const via = perCit.length && perPar.some((v) => !perCit.includes(v)) ? 'citazione+parametro' : perCit.length ? 'citazione' : 'parametro';
    if (!voci.length) {
      // Trovata ma lasciata "da verificare" dal modello: prudenza, non errore.
      // Non conta per la soglia, ma si distingue da una voce davvero mancante.
      const prudenti = [...new Set([...perCitazione(g, daVerificare), ...perParametro(g, daVerificare)])];
      if (prudenti.length) return { g, voci: prudenti, via: 'da_verificare', esito: 'trovata ma da verificare' };
      return { g, esito: 'non ritrovata' };
    }
    const numG = numeri(g.valore);
    const numE = new Set(voci.flatMap((v) => numeri(`${v.parametro} ${v.valore}`)));
    if (numG.length && numG.every((n) => numE.has(n))) return { g, voci, via, esito: 'stesso valore' };
    if (numG.length) return { g, voci, via, esito: 'valore diverso' };
    return { g, voci, via, esito: 'da controllare a mano' };
  });
  const ritrovate = esiti2.filter((e) => e.esito !== 'non ritrovata' && e.esito !== 'trovata ma da verificare').length;
  const stessoValore = esiti2.filter((e) => e.esito === 'stesso valore').length;
  const aMano = esiti2.filter((e) => e.esito === 'da controllare a mano').length;
  const prudenti = esiti2.filter((e) => e.esito === 'trovata ma da verificare').length;

  // Soglia 3: nessun "Non specificato" del golden diventato confermato.
  const soglia3 = [];
  for (const [nome, id] of Object.entries(NON_SPECIFICATI_GOLDEN)) {
    for (const v of scheda.voci) {
      if ((v.id === id || v.id.startsWith(id + '__')) && v.stato === 'confermato') soglia3.push({ golden: nome, voce: v.id, valore: v.valore });
    }
  }

  // Soglia 4: Appendice A letta per via ottica e citazioni con riscontro.
  const appendice = fonti.find((f) => f.id === 'f2');
  const pagineOttiche = appendice.pagine.filter((p) => p.ocr).length;
  const citApp = scheda.voci.flatMap((v) => v.citazioni.filter((c) => c.fonte === 'f2').map((c) => ({ ...c, voce: v.id, stato: v.stato })));
  const appOcr = citApp.filter((c) => c.verificata && c.metodo === 'ocr').length;
  const appTesto = citApp.filter((c) => c.verificata && c.metodo === 'testo').length;
  const appNonTrovate = citApp.filter((c) => !c.verificata);

  return {
    conteggi: conteggi(scheda.voci),
    soglia1: { superata: soglia1.length === 0, problemi: soglia1 },
    soglia2: {
      superata: stessoValore + aMano >= Math.ceil(0.9 * goldenConfermate.length),
      golden: goldenConfermate.length, ritrovate, stessoValore, aMano, prudenti,
      dettaglio: esiti2.map((e) => ({ esito: e.esito, via: e.via, golden: `${e.g.sezione} · ${e.g.parametro}`, valoreGolden: e.g.valore, voci: (e.voci || []).map((v) => `${v.id}: ${v.valore}`) }))
    },
    soglia3: { superata: soglia3.length === 0, problemi: soglia3 },
    soglia4: {
      superata: pagineOttiche === appendice.pagine.length && appOcr > 0,
      pagineOttiche, pagine: appendice.pagine.length, citazioniOcr: appOcr, citazioniTesto: appTesto,
      nonTrovate: appNonTrovate.map((c) => ({ voce: c.voce, pagina: c.paginaIndicata, testo: c.testo.slice(0, 100) }))
    }
  };
}

function stampa(r) {
  const ok = (b) => (b ? 'SUPERATA' : 'NON SUPERATA');
  console.log('\n══ Collaudo NPE2027 ══');
  console.log(`Voci: ${r.conteggi.confermato} confermate · ${r.conteggi.da_verificare} da verificare · ${r.conteggi.non_specificato} non specificate (golden: 60 · 14 · 13)`);
  console.log(`1. Zero citazioni confermate assenti dal PDF: ${ok(r.soglia1.superata)}${r.soglia1.problemi.length ? ` (${r.soglia1.problemi.length} problemi)` : ''}`);
  console.log(`2. Voci confermate del golden ritrovate con stesso valore (min 90%): ${ok(r.soglia2.superata)}`);
  console.log(`   ${r.soglia2.stessoValore} stesso valore numerico + ${r.soglia2.aMano} da controllare a mano su ${r.soglia2.golden} (ritrovate: ${r.soglia2.ritrovate}; trovate ma lasciate da verificare: ${r.soglia2.prudenti ?? 0})`);
  console.log(`3. Nessun "Non specificato" del golden diventato confermato: ${ok(r.soglia3.superata)}`);
  for (const p of r.soglia3.problemi) console.log(`   ✗ ${p.golden} → ${p.voce}: ${p.valore}`);
  console.log(`4. Appendice A letta per via ottica con riscontro: ${ok(r.soglia4.superata)}`);
  console.log(`   ${r.soglia4.pagineOttiche}/${r.soglia4.pagine} pagine ottiche · citazioni verificate: ${r.soglia4.citazioniOcr} via ocr, ${r.soglia4.citazioniTesto} via testo · non trovate: ${r.soglia4.nonTrovate.length}`);
  const non = r.soglia2.dettaglio.filter((d) => ['non ritrovata', 'valore diverso', 'trovata ma da verificare'].includes(d.esito));
  if (non.length) {
    console.log('\nVoci confermate del golden non ritrovate o con valore diverso:');
    for (const d of non) console.log(`   - [${d.esito}] ${d.golden} (golden: ${d.valoreGolden})${d.voci.length ? ' → ' + d.voci.join(' | ') : ''}`);
  }
}

// ── Avvio ──────────────────────────────────────────────────────────────────

const opzioni = argomenti();
mkdirSync(ESITI, { recursive: true });
try {
  const fonti = await leggiFonti();
  let scheda;
  let uso = null;
  if (opzioni.scheda) {
    scheda = JSON.parse(readFileSync(opzioni.scheda, 'utf8'));
  } else {
    const r = await estrai(fonti, opzioni);
    scheda = r.scheda;
    uso = r.uso;
    if (r.incompleti.length) console.log(`ATTENZIONE: ${r.incompleti.length} compiti non completati (voci segnate come estrazione incompleta)`);
  }
  const risultato = misura(scheda, fonti);
  stampa(risultato);
  if (uso) console.log(`\nToken: ${uso.chiamate} chiamate (${uso.troncate} troncate) · input ${uso.input} · cache letta ${uso.cacheLettura} · cache scritta ${uso.cacheScrittura} · output ${uso.output}`);

  const marca = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  if (!opzioni.scheda) writeFileSync(ESITI + `NPE2027_scheda_${marca}.json`, JSON.stringify(scheda, null, 2));
  writeFileSync(ESITI + `NPE2027_collaudo_${marca}.json`, JSON.stringify({ opzioni, uso, risultato }, null, 2));
  console.log(`\nScheda e rapporto in ${ESITI}`);
} finally {
  await chiudiOcr();
}
