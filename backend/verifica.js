// Verifica deterministica delle citazioni.
//
// È la parte che rende la scheda affidabile: una voce resta "confermato" solo
// se il codice ritrova ogni citazione, alla lettera, nel testo del PDF alla
// pagina indicata (o in una pagina vicina, e allora la pagina viene corretta).
// Il modello propone, il codice decide.
//
// La normalizzazione riprende reference/verifica/check2.py: virgolette,
// apostrofi e trattini tipografici, sillabazione a fine riga, spazi e
// maiuscole. In più: forma Unicode NFKC (legature come "ﬁ"), trattini rimossi
// su entrambi i lati (così "Multi-\nLevel" e "Multi-Level" coincidono) e
// trattino morbido eliminato.

export const MOTIVO_NON_TROVATA = 'citazione non trovata nel documento';

/** Lunghezza minima (dopo la normalizzazione) perché un frammento sia verificabile. */
export const LUNGHEZZA_MINIMA = 15;

/** Pagine vicine in cui cercare se la citazione non è alla pagina indicata. */
export const DISTANZA_MASSIMA = 2;

export function normalizza(testo) {
  return String(testo ?? '')
    .normalize('NFKC')
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[­]/g, '')
    .replace(/[‐‑‒–—―−-]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * Divide una citazione nei frammenti che devono comparire tutti, in ordine,
 * nella stessa pagina. Le ellissi ("..." o "…") separano frammenti; quelle in
 * testa o in coda si ignorano.
 */
export function frammenti(citazione) {
  return String(citazione ?? '')
    .split(/\.{3,}|…/)
    .map((f) => f.trim())
    .filter(Boolean);
}

function cercaInTesto(frammentiNormalizzati, testoNormalizzato) {
  let da = 0;
  for (const f of frammentiNormalizzati) {
    const i = testoNormalizzato.indexOf(f, da);
    if (i < 0) return false;
    da = i + f.length;
  }
  return true;
}

function ordineDiRicerca(paginaIndicata, numeroPagine) {
  const ordine = [];
  if (paginaIndicata >= 1 && paginaIndicata <= numeroPagine) ordine.push(paginaIndicata);
  for (let d = 1; d <= DISTANZA_MASSIMA; d++) {
    for (const p of [paginaIndicata - d, paginaIndicata + d]) {
      if (p >= 1 && p <= numeroPagine) ordine.push(p);
    }
  }
  return ordine;
}

/**
 * Prepara le pagine di una fonte per la ricerca (normalizza una volta sola).
 * @param {Array<{ numero: number, testo: string, ocr?: string|null }>} pagine
 */
export function indicizza(pagine) {
  const mappa = new Map();
  for (const p of pagine) {
    mappa.set(p.numero, {
      testo: normalizza(p.testo),
      ocr: p.ocr ? normalizza(p.ocr) : null
    });
  }
  return { numeroPagine: pagine.length ? Math.max(...pagine.map((p) => p.numero)) : 0, pagine: mappa };
}

/**
 * Cerca una citazione in una fonte indicizzata.
 * @returns {{ verificata: boolean, pagina: number|null, metodo: 'testo'|'ocr'|null, motivo?: string }}
 */
export function verificaCitazione(testoCitazione, paginaIndicata, indice) {
  const parti = frammenti(testoCitazione).map(normalizza).filter(Boolean);
  if (!parti.length) return { verificata: false, pagina: null, metodo: null, motivo: 'citazione vuota' };
  if (parti.some((p) => p.length < LUNGHEZZA_MINIMA)) {
    return { verificata: false, pagina: null, metodo: null, motivo: 'citazione troppo breve per essere verificata' };
  }
  if (!indice) return { verificata: false, pagina: null, metodo: null, motivo: 'fonte non disponibile' };

  const numero = Number.parseInt(paginaIndicata, 10);
  for (const p of ordineDiRicerca(Number.isFinite(numero) ? numero : 1, indice.numeroPagine)) {
    const pagina = indice.pagine.get(p);
    if (!pagina) continue;
    if (cercaInTesto(parti, pagina.testo)) return { verificata: true, pagina: p, metodo: 'testo' };
    if (pagina.ocr && cercaInTesto(parti, pagina.ocr)) return { verificata: true, pagina: p, metodo: 'ocr' };
  }
  return { verificata: false, pagina: null, metodo: null, motivo: MOTIVO_NON_TROVATA };
}

/**
 * Applica la verifica a una voce e ne fissa lo stato finale.
 *
 * - "confermato" resta tale solo se la voce ha almeno una citazione e tutte
 *   sono state ritrovate; altrimenti scende a "da_verificare".
 * - "da_verificare" e "non_specificato" non salgono mai.
 * - Lo stato proposto dal modello è conservato in `statoProposto`.
 *
 * @param {object} voce  voce con `stato` e `citazioni: [{ fonte, pagina, testo }]`
 * @param {Map<string, object>} indici  fonte → indice prodotto da `indicizza`
 */
export function verificaVoce(voce, indici) {
  const citazioni = (voce.citazioni || []).map((c) => {
    const esito = verificaCitazione(c.testo, c.pagina, indici.get(c.fonte));
    return {
      fonte: c.fonte,
      pagina: esito.verificata ? esito.pagina : c.pagina,
      paginaIndicata: c.pagina,
      testo: c.testo,
      verificata: esito.verificata,
      metodo: esito.metodo,
      ...(esito.verificata ? {} : { motivo: esito.motivo })
    };
  });

  const statoProposto = voce.stato;
  let stato = statoProposto;
  let motivo = voce.motivo || null;

  if (statoProposto === 'confermato') {
    if (!citazioni.length) {
      stato = 'da_verificare';
      motivo = 'nessuna citazione a sostegno del valore';
    } else if (!citazioni.every((c) => c.verificata)) {
      stato = 'da_verificare';
      const motivi = [...new Set(citazioni.filter((c) => !c.verificata).map((c) => c.motivo))];
      motivo = motivi.length === 1 ? motivi[0] : MOTIVO_NON_TROVATA;
    }
  } else if (!['da_verificare', 'non_specificato'].includes(statoProposto)) {
    stato = 'da_verificare';
    motivo = 'stato non riconosciuto';
  }

  return { ...voce, citazioni, stato, statoProposto, motivo };
}
