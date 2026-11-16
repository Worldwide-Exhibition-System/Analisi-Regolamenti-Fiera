// Assistente virtuale della scheda: domande libere del PM sulla scheda aperta.
//
// A differenza della chat di risoluzione (chat.js), l'assistente non lavora su
// una voce e non registra nulla: risponde a domande sulla scheda così com'è
// (valori, stati, citazioni, risposte del PM, uso dell'app). Il server riceve
// la scheda in forma compatta e la conversazione, niente PDF, e non conserva
// nulla. Le regole di accuratezza sono le stesse dell'estrazione: nessun dato
// fuori dalla scheda, nessuna conversione, nessun calcolo, nessuna deduzione.

export class ErroreAssistente extends Error {
  constructor(messaggio) {
    super(messaggio);
    this.name = 'ErroreAssistente';
  }
}

export const MAX_DOMANDA = 2000;
export const MAX_MESSAGGI = 12;
export const MAX_VOCI = 400;

export const ISTRUZIONI_ASSISTENTE = `Sei l'assistente virtuale della "Scheda prescrizioni tecniche" di WES, azienda che progetta e realizza stand fieristici. Rispondi alle domande del project manager (PM) sulla scheda aperta, che trovi qui sotto: le prescrizioni dei regolamenti di una fiera che vincolano la progettazione dello stand, divise in sezioni A-J.

Gli stati delle voci:
- "confermato": il valore è stato estratto dal regolamento e la citazione è stata ritrovata dal software nel PDF;
- "da verificare": passaggio ambiguo, condizionato, da comporre con altri, in conflitto tra fonti o con citazione non ritrovata;
- "non specificato": le fonti caricate non trattano il parametro;
- una voce può avere anche una risposta del PM: "chiarito dal PM" (valore e fonte forniti dal PM), "in attesa" (domanda aperta con un interlocutore esterno) o "non applicabile". Una risposta del PM non è mai una conferma dal regolamento.

Regole:
1. Rispondi solo con quello che c'è nella scheda. Non usare conoscenze tue sulla fiera, sul quartiere fieristico o su valori tipici del settore. Se la scheda non contiene la risposta, dillo chiaramente e indica se il parametro risulta "non specificato" o da verificare, o se manca del tutto.
2. Nessuna conversione di unità, nessun calcolo, nessuna deduzione: riporta i valori come sono scritti nella scheda. Se il PM chiede una conversione o un calcolo, spiega che la scheda riporta i valori come nel regolamento e che il calcolo va fatto e verificato da lui.
3. Per ogni dato che riporti, di' sempre lo stato della voce (confermato, da verificare, chiarito dal PM, in attesa) e, se c'è, la fonte con la pagina. Un dato "da verificare" o "chiarito dal PM" non va presentato come confermato dal regolamento.
4. Quando ti servi di una voce, metti il suo identificativo (quello tra parentesi quadre) nel campo "voci", così il PM può aprirla. Al massimo 8 identificativi, solo quelli che compaiono nella scheda. Non scrivere gli identificativi nel messaggio.
5. Non puoi modificare la scheda. Se il PM vuole registrare un valore, mettere una voce in attesa o segnarla non applicabile, indicagli il pulsante "Voci aperte". Per salvare il lavoro c'è "Salva file di lavoro", per il documento di consegna "Stampa / PDF", per nuovi regolamenti "Aggiungi o ricarica regolamenti".
6. Le citazioni restano nella lingua del regolamento; il resto in italiano.
7. Se la domanda non riguarda la scheda o il suo uso, rispondi in una frase che puoi aiutare solo su questa scheda.
8. Scrivi in modo breve e diretto, senza markdown (niente asterischi, titoli o tabelle). Per un elenco usa righe che iniziano con "- ".`;

export function schemaAssistente() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['messaggio', 'voci'],
    properties: {
      messaggio: { type: 'string' },
      voci: { type: 'array', items: { type: 'string' } }
    }
  };
}

const breve = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

const NOMI_STATO = { confermato: 'confermato', da_verificare: 'da verificare', non_specificato: 'non specificato' };
const NOMI_RISPOSTA = { chiarito: 'chiarito dal PM', in_attesa: 'in attesa', non_applicabile: 'non applicabile' };

/**
 * Scheda in testo compatto, una voce per riga, con limiti su ogni campo.
 * @param {object} scheda  { fiera, commessa, fonti, voci }
 */
export function contestoScheda(scheda) {
  const fonti = Array.isArray(scheda?.fonti) ? scheda.fonti.slice(0, 20) : [];
  const nomeFonte = (id) => {
    const f = fonti.find((x) => x && x.id === id);
    return f ? breve(f.file, 100) : breve(id, 20);
  };
  const righe = [];
  const fiera = scheda?.fiera || {};
  righe.push(`Fiera: ${breve(fiera.nome, 120) || 'non indicata'}${fiera.date ? ` · date: ${breve(fiera.date, 60)}` : ''}`);
  if (scheda?.commessa?.numero) righe.push(`Commessa: ${breve(scheda.commessa.numero, 20)}`);
  if (fonti.length) {
    righe.push('Regolamenti caricati:');
    for (const f of fonti) righe.push(`- ${breve(f.file, 120)} (${breve(f.ruolo, 20) || 'ruolo non indicato'}${f.pagine ? `, ${Number(f.pagine) || '?'} pagine` : ''})`);
  }
  righe.push('', 'Voci della scheda (identificativo tra parentesi quadre):');
  const voci = Array.isArray(scheda?.voci) ? scheda.voci.slice(0, MAX_VOCI) : [];
  for (const v of voci) {
    if (!v || typeof v.id !== 'string') continue;
    const parti = [`[${breve(v.id, 80)}] ${breve(v.sezione, 2)} · ${breve(v.parametro, 160)}`, NOMI_STATO[v.stato] || 'da verificare'];
    if (v.valore) parti.push(`valore: ${breve(v.valore, 500)}`);
    if (v.motivo) parti.push(`motivo: ${breve(v.motivo, 200)}`);
    const cit = (Array.isArray(v.citazioni) ? v.citazioni : []).slice(0, 3)
      .map((c) => `«${breve(c?.testo, 300)}» (${nomeFonte(c?.fonte)}, p. ${Number(c?.pagina) || '?'})`);
    if (cit.length) parti.push(`citazioni: ${cit.join(' ')}`);
    const r = v.chiarimento;
    if (r && NOMI_RISPOSTA[r.tipo]) {
      const dettagli = [r.valore && breve(r.valore, 300), r.fonte && `fonte: ${breve(r.fonte, 150)}`, r.chi && `da: ${breve(r.chi, 100)}`, r.dal && `dal ${breve(r.dal, 30)}`]
        .filter(Boolean).join(', ');
      parti.push(`risposta del PM: ${NOMI_RISPOSTA[r.tipo]}${dettagli ? ` (${dettagli})` : ''}`);
    }
    righe.push(parti.join(' — '));
  }
  return righe.join('\n');
}

/** Conversazione ripulita: ultimi messaggi, ruoli ammessi, testi limitati. */
export function conversazione(messaggi) {
  return (Array.isArray(messaggi) ? messaggi : [])
    .filter((m) => m && (m.ruolo === 'pm' || m.ruolo === 'assistente') && String(m.testo || '').trim())
    .slice(-MAX_MESSAGGI)
    .map((m) => ({ ruolo: m.ruolo, testo: String(m.testo).slice(0, MAX_DOMANDA) }));
}

/**
 * @param {object} p
 * @param {object} p.scheda  scheda compatta dal browser
 * @param {Array<{ruolo: 'pm'|'assistente', testo: string}>} p.messaggi  l'ultimo è la domanda del PM
 */
export async function rispondiAssistente({ client, modello, effort, scheda, messaggi }) {
  const storia = conversazione(messaggi);
  if (!storia.length || storia[storia.length - 1].ruolo !== 'pm') {
    throw new ErroreAssistente('Scrivi una domanda per l\'assistente.');
  }
  // L'API vuole messaggi che alternano utente e assistente e iniziano dall'utente
  const turni = [];
  for (const m of storia) {
    const role = m.ruolo === 'pm' ? 'user' : 'assistant';
    if (!turni.length && role === 'assistant') continue;
    if (turni.length && turni[turni.length - 1].role === role) turni[turni.length - 1].testo += '\n' + m.testo;
    else turni.push({ role, testo: m.testo });
  }
  // La scheda va nel primo messaggio, in un blocco a sé messo in cache: le
  // domande successive sulla stessa scheda la rileggono dalla cache.
  const messages = turni.map((t, i) => ({
    role: t.role,
    content: i === 0
      ? [
          { type: 'text', text: `Scheda aperta:\n${contestoScheda(scheda)}`, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: `Domanda del PM: ${t.testo}` }
        ]
      : t.testo
  }));

  const risposta = await client.beta.messages.create({
    model: modello,
    max_tokens: 4000,
    system: ISTRUZIONI_ASSISTENTE,
    thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema: schemaAssistente() } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages
  });

  if (risposta.stop_reason === 'refusal') {
    throw new ErroreAssistente("L'assistente non ha potuto rispondere a questa domanda. Prova a riformularla.");
  }
  if (risposta.stop_reason !== 'end_turn') {
    throw new ErroreAssistente("La risposta dell'assistente si è interrotta. Prova con una domanda più circoscritta.");
  }
  const testo = risposta.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let dati;
  try {
    dati = JSON.parse(testo);
  } catch {
    throw new ErroreAssistente("La risposta dell'assistente non è leggibile. Riprova.");
  }
  return { ...normalizzaAssistente(dati, scheda), uso: risposta.usage };
}

/** Tiene solo identificativi di voci che esistono davvero nella scheda. */
export function normalizzaAssistente(dati, scheda) {
  const esistenti = new Set((Array.isArray(scheda?.voci) ? scheda.voci : []).map((v) => v && v.id));
  const voci = [...new Set((Array.isArray(dati?.voci) ? dati.voci : []).map(String))]
    .filter((id) => esistenti.has(id)).slice(0, 8);
  return { messaggio: String(dati?.messaggio || '').trim(), voci };
}
