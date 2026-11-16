// Chat di risoluzione delle voci aperte (specifiche, punto 7).
//
// Ogni chiamata riguarda una sola voce: il server riceve la voce corrente, le
// sue citazioni, le risposte già date alle voci collegate e la conversazione
// su quella voce. Niente PDF. Il modello restituisce un messaggio e, quando la
// risposta del PM è completa, una PROPOSTA di registrazione: la registra solo
// il PM, con il pulsante di conferma nella pagina. Le proposte possono essere
// solo "chiarito", "non_applicabile" o "in_attesa": una risposta del PM non
// rende mai una voce "confermato".

export const TIPI_PROPOSTA = ['nessuna', 'chiarito', 'non_applicabile', 'in_attesa'];

export class ErroreChat extends Error {
  constructor(messaggio) {
    super(messaggio);
    this.name = 'ErroreChat';
  }
}

export const ISTRUZIONI_CHAT = `Sei l'assistente che aiuta un project manager (PM) di WES, azienda che progetta e realizza stand fieristici, a chiudere le voci aperte della scheda delle prescrizioni tecniche di una fiera. Lavori su una voce alla volta. La voce è aperta perché il regolamento non tratta il parametro ("non specificato") o perché il passaggio è ambiguo, condizionato o in conflitto ("da verificare").

Il PM può:
- fornire il valore e la sua fonte (per esempio "risposta dell'ente fiera via mail del 12/11"): proposta "chiarito";
- dire che il parametro non riguarda il progetto: proposta "non_applicabile";
- dire che ha una domanda aperta con un interlocutore esterno: proposta "in_attesa", con chi deve rispondere e da quando.

Regole:
1. Non inventare valori, non proporre valori o numeri tipici del settore, non completare la risposta del PM con conoscenze tue.
2. Nessuna conversione di unità, nessun calcolo: riporta il valore come lo dà il PM.
3. Per "chiarito" servono il valore e la fonte. Se manca la fonte, chiedila e non proporre la registrazione (proposta "nessuna"). Per "in_attesa" servono chi deve rispondere e da quando: se mancano, chiedili.
4. Quando la risposta è completa, riformulala in una riga nel campo "messaggio" e chiedi al PM di confermarla con il pulsante: la registrazione la fa il PM, non tu.
5. Non commentare la risposta del PM, salvo per segnalare un'incoerenza con altre voci già registrate (per esempio un'altezza chiarita superiore al limite degli elementi sospesi): in quel caso descrivila nel campo "incoerenza", senza correggere il valore. Confronta solo valori espressi nella stessa unità di misura: se le unità sono diverse (per esempio metri e piedi) non convertire e non segnalare incoerenze, al massimo fai notare che le unità sono diverse. Altrimenti lascia il campo vuoto.
6. Una risposta del PM non rende mai la voce "confermata": non usare quella parola per le risposte del PM. Lo stato è "Chiarito dal PM".
7. Se il PM chiede la domanda da inoltrare all'ente fiera, o se la voce va in attesa, scrivi nel campo "domandaEnte" una domanda breve, cortese e precisa nella lingua del regolamento (in inglese se il regolamento è in inglese), che citi il passaggio o l'articolo e la pagina quando ci sono. Altrimenti lascia il campo vuoto.
8. Scrivi in italiano, in modo breve e diretto. Nessun markdown.`;

export function schemaChat() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['messaggio', 'proposta', 'domandaEnte', 'incoerenza'],
    properties: {
      messaggio: { type: 'string' },
      proposta: {
        type: 'object',
        additionalProperties: false,
        required: ['tipo', 'valore', 'fonte', 'chi', 'dal', 'nota'],
        properties: {
          tipo: { type: 'string', enum: TIPI_PROPOSTA },
          valore: { type: 'string' },
          fonte: { type: 'string' },
          chi: { type: 'string' },
          dal: { type: 'string' },
          nota: { type: 'string' }
        }
      },
      domandaEnte: { type: 'string' },
      incoerenza: { type: 'string' }
    }
  };
}

const NOMI_STATO = {
  confermato: 'confermato',
  da_verificare: 'da verificare',
  non_specificato: 'non specificato'
};

const breve = (s, n) => String(s ?? '').slice(0, n);

/** Contesto della voce in testo, con limiti di lunghezza su ogni campo. */
export function contestoVoce({ voce, fonti, collegate, lingua }) {
  const nomeFonte = (id) => {
    const f = (fonti || []).find((x) => x.id === id);
    return f ? breve(f.file, 120) : id;
  };
  const righe = [
    `Voce: ${breve(voce.parametro, 200)} (sezione ${breve(voce.sezione, 2)})`,
    `Stato estratto: ${NOMI_STATO[voce.stato] || breve(voce.stato, 30)}`,
    voce.valore ? `Valore estratto dal regolamento: ${breve(voce.valore, 800)}` : 'Valore estratto: nessuno',
    voce.motivo ? `Perché è aperta: ${breve(voce.motivo, 400)}` : ''
  ];
  const citazioni = (voce.citazioni || []).slice(0, 6);
  if (citazioni.length) {
    righe.push('Citazioni dal regolamento:');
    for (const c of citazioni) righe.push(`- «${breve(c.testo, 1200)}» (${nomeFonte(c.fonte)}, pagina ${Number(c.pagina) || '?'})`);
  }
  if (lingua) righe.push(`Lingua del regolamento: ${breve(lingua, 10)}`);
  const altre = (collegate || []).slice(0, 25);
  if (altre.length) {
    righe.push('Altre voci della stessa sezione già note (per controllare eventuali incoerenze):');
    for (const v of altre) {
      const risposta = v.chiarimento && v.chiarimento.tipo
        ? ` — risposta del PM (${breve(v.chiarimento.tipo, 20)}): ${breve(v.chiarimento.valore, 300)}`
        : '';
      righe.push(`- ${breve(v.parametro, 160)}: ${breve(v.valore, 300) || '—'}${risposta}`);
    }
  }
  return righe.filter(Boolean).join('\n');
}

/**
 * @param {object} p
 * @param {'risposta'|'domanda'} p.richiesta
 * @param {Array<{ruolo: 'pm'|'assistente', testo: string}>} p.messaggi
 */
export async function rispondi({ client, modello, effort, voce, fonti, collegate, lingua, messaggi, richiesta }) {
  const conversazione = (messaggi || []).slice(-20)
    .map((m) => `${m.ruolo === 'pm' ? 'PM' : 'Assistente'}: ${breve(m.testo, 2000)}`).join('\n');
  const compito = richiesta === 'domanda'
    ? 'Il PM chiede la domanda da inoltrare all\'ente fiera per questa voce: scrivila nel campo "domandaEnte" e nel messaggio spiega in una riga a chi inviarla. Proposta "nessuna".'
    : 'Rispondi all\'ultimo messaggio del PM seguendo le regole.';

  const risposta = await client.beta.messages.create({
    model: modello,
    max_tokens: 4000,
    system: ISTRUZIONI_CHAT,
    thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema: schemaChat() } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{
      role: 'user',
      content: `${contestoVoce({ voce, fonti, collegate, lingua })}\n\nConversazione su questa voce:\n${conversazione || '(nessun messaggio)'}\n\n${compito}`
    }]
  });

  if (risposta.stop_reason === 'refusal') {
    throw new ErroreChat("L'assistente non ha potuto rispondere a questa richiesta. Riformula la risposta o registra la voce a mano.");
  }
  if (risposta.stop_reason !== 'end_turn') {
    throw new ErroreChat("La risposta dell'assistente si è interrotta. Riprova.");
  }
  const testo = risposta.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let dati;
  try {
    dati = JSON.parse(testo);
  } catch {
    throw new ErroreChat("La risposta dell'assistente non è leggibile. Riprova.");
  }
  return { ...normalizzaRisposta(dati), uso: risposta.usage };
}

/** Ripulisce la risposta: nessuna proposta fuori dai tipi ammessi. */
export function normalizzaRisposta(dati) {
  const p = dati && dati.proposta ? dati.proposta : {};
  const tipo = TIPI_PROPOSTA.includes(p.tipo) ? p.tipo : 'nessuna';
  return {
    messaggio: String(dati?.messaggio || ''),
    proposta: tipo === 'nessuna' ? null : {
      tipo,
      valore: String(p.valore || ''),
      fonte: String(p.fonte || ''),
      chi: String(p.chi || ''),
      dal: String(p.dal || ''),
      nota: String(p.nota || '')
    },
    domandaEnte: String(dati?.domandaEnte || ''),
    incoerenza: String(dati?.incoerenza || '')
  };
}
