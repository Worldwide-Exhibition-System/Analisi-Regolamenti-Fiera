// Le dieci sezioni fisse della scheda e i parametri previsti dal prompt di
// estrazione, ciascuno con un identificativo stabile.
//
// I parametri nascono dall'elenco delle informazioni che servono alla
// progettazione WES (prompt NotebookLM), non da un regolamento in particolare.
// La riorganizzazione in dieci schede segue docs/specifiche.md, punto 4.
// Le prescrizioni non previste diventano voci "Altre prescrizioni" con un
// identificativo ricavato dal titolo (prefisso "altra_").

export const SEZIONI = [
  { lettera: 'A', titolo: 'Altezze per tipo di stand', ambito: 'altezze massime delle costruzioni e degli allestimenti a terra, con le differenze per tipo di stand (in linea, d\'angolo, a penisola, a isola…) e per posizione (a confine, fronte corsia, arretramenti); altezze dei padiglioni; limiti per macchinari ed elementi espositivi' },
  { lettera: 'B', titolo: 'Sospensioni e soppalchi', ambito: 'altezza massima degli elementi sospesi o appesi; soppalchi, piani rialzati, secondi livelli, doppi piani, mezzanini' },
  { lettera: 'C', titolo: 'Chiusure perimetrali', ambito: 'percentuale massima di chiusura del perimetro, pareti verso gli stand confinanti, lati ciechi, linee di vista, arretramenti obbligatori dal confine o dalla corsia' },
  { lettera: 'D', titolo: 'Appendimenti e alimentazione dall\'alto', ambito: 'possibilità di appendere carichi, autorizzazioni, altezza di appendimento, portata per punto e complessiva, distanze degli elementi appesi; rigging, truss, americane; alimentazione elettrica dall\'alto' },
  { lettera: 'E', titolo: 'Cielinature, coperture e controsoffitti', ambito: 'superficie copribile in modo pieno, porzioni a rete o traspiranti, soglia oltre cui servono sprinkler o impianti antincendio, materiali e classe di reazione al fuoco di coperture e controsoffitti, strutture coperte' },
  { lettera: 'F', titolo: 'Sicurezza e antincendio', ambito: 'porte e oblò, pedane, scale, portata dei pavimenti, ancoraggi, impianti elettrici, estintori e rilevatori, uscite e vie di fuga, protezione dei macchinari, accessibilità, altre prescrizioni di sicurezza' },
  { lettera: 'G', titolo: 'Forma, finiture e operatività', ambito: 'forma degli spazi, pavimentazioni, finiture delle superfici, insegne e grafiche, rumore, elementi aerei e speciali, contenimento nello spazio assegnato, altre prescrizioni tecniche o estetiche vincolanti' },
  { lettera: 'H', titolo: 'Adempimenti e scadenze', ambito: 'presentazione del progetto per approvazione, soglie che la rendono obbligatoria, termini e anticipi richiesti, penali, altre scadenze collegate all\'allestimento (assicurazioni, registrazione degli allestitori, moduli)' },
  { lettera: 'I', titolo: 'Montaggio e smontaggio', ambito: 'allestimento (montaggio, preallestimento, build-up) e disallestimento (smontaggio, tear-down, sgombero): giornate, orari, termini, proroghe, lavoro notturno, penali' },
  { lettera: 'J', titolo: 'Accessi e mezzi', ambito: 'accesso degli espositori durante la manifestazione, orari della manifestazione, pass e accrediti, accesso e movimentazione dei mezzi, finestre di carico e scarico, varchi merci, prenotazioni' }
];

export const LETTERE = SEZIONI.map((s) => s.lettera);

/** Gruppi di sezioni estratti con una sola chiamata (punto 6 delle specifiche). */
export const GRUPPI = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H'], ['I', 'J']];

/**
 * Parametri previsti. `descrizione` riprende il prompt NotebookLM, con i
 * sinonimi tra parentesi. `multiplo: true` indica che il parametro può
 * generare più voci (per tipo di stand, per fase, per padiglione): gli
 * identificativi delle varianti iniziano con lo slug del parametro seguito da
 * "__" e da un qualificatore (es. "altezza_max__inline").
 */
export const PARAMETRI = [
  // A
  { id: 'altezza_max', sezione: 'A', parametro: 'Altezza massima delle costruzioni', descrizione: 'Altezza massima delle costruzioni, con le differenze per tipo di stand e per posizione (a confine, fronte corsia, arretramenti).', multiplo: true },
  { id: 'altezza_padiglioni', sezione: 'A', parametro: 'Altezza dei padiglioni', descrizione: 'Altezza libera dei padiglioni o dei soffitti, se indicata.', multiplo: true },

  // B
  { id: 'altezza_max_sospesi', sezione: 'B', parametro: 'Altezza massima elementi sospesi', descrizione: 'Altezza massima ammessa per elementi sospesi o appesi (insegne, americane, strutture appese), con eventuali altezze minime da terra.', multiplo: true },
  { id: 'soppalchi_ammissibilita', sezione: 'B', parametro: 'Soppalchi: ammissibilità', descrizione: 'Se i soppalchi sono ammessi e a quali condizioni (sinonimi: piano rialzato, secondo livello, doppio piano, mezzanino, multi-level).' },
  { id: 'soppalchi_altezza_max', sezione: 'B', parametro: 'Soppalchi: altezza massima', descrizione: 'Altezza massima dei soppalchi.' },
  { id: 'soppalchi_superficie_max', sezione: 'B', parametro: 'Soppalchi: superficie massima', descrizione: 'Superficie massima del piano superiore.' },
  { id: 'soppalchi_percentuale', sezione: 'B', parametro: 'Soppalchi: percentuale dell\'area dello stand', descrizione: 'Percentuale massima del soppalco rispetto all\'area dello stand.' },
  { id: 'soppalchi_autorizzazione', sezione: 'B', parametro: 'Soppalchi: autorizzazione', descrizione: 'Obbligo di autorizzazione o approvazione preventiva dei soppalchi.' },

  // C
  { id: 'chiusura_perimetro_max', sezione: 'C', parametro: 'Percentuale massima di chiusura del perimetro', descrizione: 'Percentuale massima di chiusura del perimetro (sinonimi: pareti perimetrali, lati ciechi, fasce di confine).' },
  { id: 'chiusura_limiti_confinanti', sezione: 'C', parametro: 'Limiti verso gli stand confinanti', descrizione: 'Limiti verso gli stand confinanti: pareti di confine, linee di vista, arretramenti obbligatori dal confine o dalla corsia.', multiplo: true },

  // D
  { id: 'appendimenti_ammessi', sezione: 'D', parametro: 'Possibilità di appendere', descrizione: 'Se è possibile appendere carichi, per quali stand e con quale autorizzazione (sinonimi: punti di sospensione, rigging, truss, americana, graticcia, carichi appesi).', multiplo: true },
  { id: 'appendimenti_autorizzazione', sezione: 'D', parametro: 'Appendimenti: autorizzazione', descrizione: 'Autorizzazione o approvazione preventiva richiesta per gli appendimenti e relativo termine.' },
  { id: 'appendimenti_altezza_max', sezione: 'D', parametro: 'Altezza massima di appendimento', descrizione: 'Altezza massima di appendimento.' },
  { id: 'appendimenti_portata_punto', sezione: 'D', parametro: 'Portata massima per punto (kg)', descrizione: 'Portata massima per singolo punto di appendimento.' },
  { id: 'appendimenti_carico_complessivo', sezione: 'D', parametro: 'Limite di carico complessivo', descrizione: 'Eventuale limite di carico complessivo appeso.' },
  { id: 'appendimenti_distanze', sezione: 'D', parametro: 'Appendimenti: distanze', descrizione: 'Distanze obbligatorie degli elementi appesi dagli stand confinanti o dalle strutture a terra.' },
  { id: 'alimentazione_dall_alto', sezione: 'D', parametro: 'Alimentazione elettrica dall\'alto', descrizione: 'Disponibilità di alimentazione elettrica dall\'alto per alimentare l\'americana senza adduzione da terra; modalità, limiti di potenza, prescrizioni (sinonimi: alimentazione aerea, calata elettrica dall\'alto).' },

  // E
  { id: 'cielinatura_superficie_max', sezione: 'E', parametro: 'Superficie massima copribile in modo pieno', descrizione: 'Superficie massima copribile in modo pieno (sinonimi: cielini, soffittature, tetti, coperture orizzontali, controsoffitti).' },
  { id: 'cielinatura_porzioni_traspiranti', sezione: 'E', parametro: 'Porzioni a rete o tessuto traspirante', descrizione: 'Obbligo di porzioni a rete o tessuto traspirante e relative percentuali o condizioni.' },
  { id: 'sprinkler_soglia', sezione: 'E', parametro: 'Soglia per sprinkler o antincendio', descrizione: 'Soglia di superficie oltre la quale è obbligatorio installare sprinkler o impianto antincendio.' },
  { id: 'cielinatura_materiali', sezione: 'E', parametro: 'Materiali ammessi', descrizione: 'Materiali ammessi per coperture e controsoffitti.' },
  { id: 'cielinatura_classe_fuoco', sezione: 'E', parametro: 'Classe di reazione al fuoco', descrizione: 'Classe di reazione al fuoco richiesta per coperture e controsoffitti, certificazioni.' },

  // F
  { id: 'porte_oblo', sezione: 'F', parametro: 'Oblò o finestratura sulle porte', descrizione: 'Obbligo di oblò o finestratura sulle porte.' },
  { id: 'pedane_angoli_arrotondati', sezione: 'F', parametro: 'Angoli arrotondati sulle pedane', descrizione: 'Obbligo di angoli arrotondati sulle pedane.' },
  { id: 'pedane_altezza_rampa', sezione: 'F', parametro: 'Pedane: altezza massima e rampa', descrizione: 'Altezza massima delle pedane e obbligo di rampa di accesso.' },

  // H
  { id: 'progetto_approvazione', sezione: 'H', parametro: 'Presentazione del progetto per approvazione', descrizione: 'Obbligo di presentare il progetto per approvazione, soglie che lo rendono obbligatorio (doppio piano, appendimenti, altezze elevate, superfici) e termine o anticipo richiesto.', multiplo: true },
  { id: 'progetto_penali', sezione: 'H', parametro: 'Penali per ritardo nella presentazione', descrizione: 'Penali o conseguenze per la presentazione tardiva del progetto.' },

  // I
  { id: 'allestimento_giornate_orari', sezione: 'I', parametro: 'Allestimento: giornate e orari', descrizione: 'Giornate consentite e fasce orarie di accesso per l\'allestimento (sinonimi: preallestimento, build-up, periodo di montaggio).', multiplo: true },
  { id: 'allestimento_termine', sezione: 'I', parametro: 'Allestimento: termine di completamento', descrizione: 'Termine ultimo entro cui lo stand deve essere completato.' },
  { id: 'allestimento_proroghe_notturno', sezione: 'I', parametro: 'Allestimento: proroghe e lavoro notturno', descrizione: 'Possibilità di proroghe o lavoro notturno e relative condizioni.' },
  { id: 'disallestimento_inizio', sezione: 'I', parametro: 'Disallestimento: inizio', descrizione: 'Data e ora da cui è consentito lo smontaggio (sinonimi: tear-down, periodo di smontaggio).' },
  { id: 'disallestimento_termine', sezione: 'I', parametro: 'Disallestimento: termine di sgombero', descrizione: 'Termine ultimo per lo sgombero e la riconsegna dell\'area.', multiplo: true },
  { id: 'disallestimento_penali', sezione: 'I', parametro: 'Disallestimento: penali', descrizione: 'Penali per occupazione o ritardo oltre il termine di sgombero.' },

  // J
  { id: 'accesso_espositori_orari', sezione: 'J', parametro: 'Accesso espositori: ingresso e uscita', descrizione: 'Orario di ingresso anticipato rispetto all\'apertura al pubblico e orario di uscita consentito durante la manifestazione. Da non confondere con l\'orario di apertura al pubblico.' },
  { id: 'orari_manifestazione', sezione: 'J', parametro: 'Orari della manifestazione', descrizione: 'Orari di apertura al pubblico della manifestazione. Da non confondere con l\'orario di accesso degli espositori.' },
  { id: 'accesso_espositori_accrediti', sezione: 'J', parametro: 'Accrediti e pass', descrizione: 'Modalità di accesso e accrediti: obbligo di registrazione o di credenziali, numero di badge o pass concessi a ciascun espositore (gratuiti o a pagamento, in base alla superficie, minimi e massimi) e termini per richiederli. Questi aspetti stanno spesso in articoli diversi, anche lontani dalla parte sugli orari: una voce per aspetto, ciascuna con la propria citazione, senza unirli (sinonimi: pass espositore, badge, booth personnel badges, tessere, accrediti).', multiplo: true },
  { id: 'mezzi_finestre_scarico', sezione: 'J', parametro: 'Mezzi: finestre di carico e scarico', descrizione: 'Finestre orarie e modalità per carico e scarico, eventuale obbligo di prenotazione (sinonimi: accesso automezzi, logistica merci).', multiplo: true },
  { id: 'mezzi_varchi_merci', sezione: 'J', parametro: 'Mezzi: varchi merci', descrizione: 'Varchi merci dedicati e veicoli ammessi (sinonimi: varchi, ingressi merci, marshalling yard).', multiplo: true }
];

/**
 * Temi da controllare: argomenti di progettazione ricorrenti nei regolamenti
 * che non sono parametri della scheda originale. Hanno un identificativo fisso
 * (così la voce è stabile tra estrazioni diverse), ma il modello crea la voce
 * solo se le fonti trattano il tema: un tema assente non diventa
 * "non_specificato". Sono generici, non legati a una fiera in particolare.
 */
export const TEMI = [
  // C
  { id: 'arretramento_corsia', sezione: 'C', parametro: 'Arretramento dalla corsia', descrizione: 'Distanza obbligatoria di allestimenti, attrezzature o arredi dal filo corsia.' },
  { id: 'linee_di_vista', sezione: 'C', parametro: 'Linee di vista verso i vicini', descrizione: 'Obblighi di non ostruire la visuale degli stand confinanti.' },
  { id: 'pareti_confine_finitura', sezione: 'C', parametro: 'Pareti verso i confinanti: finitura e grafiche', descrizione: 'Finitura del retro delle pareti di confine, divieto di grafiche o loghi verso i vicini, partizioni laterali che non si possono rimuovere.', multiplo: true },

  // E
  { id: 'strutture_coperte', sezione: 'E', parametro: 'Strutture coperte: requisiti', descrizione: 'Requisiti per stand o strutture coperte (rilevatori di fumo, estintori, soglie di superficie coperta, disegni firmati).', multiplo: true },
  { id: 'canopy', sezione: 'E', parametro: 'Canopy e coperture parziali', descrizione: 'Pensiline, canopy, tettoie: altezza minima da terra, distanze dalle corsie, supporti.', multiplo: true },
  { id: 'copertura_soppalchi', sezione: 'E', parametro: 'Copertura del piano superiore dei soppalchi', descrizione: 'Se il piano superiore dei soppalchi può avere coperture, soffitti, teli.' },

  // F
  { id: 'scale', sezione: 'F', parametro: 'Scale', descrizione: 'Larghezza, corrimano, forma e numero delle scale di soppalchi o piani occupati.', multiplo: true },
  { id: 'capienza_piani', sezione: 'F', parametro: 'Capienza e carico dei piani', descrizione: 'Avvisi di capienza o di carico massimo, occupazione dei piani superiori.' },
  { id: 'estintori_rilevatori', sezione: 'F', parametro: 'Estintori e rilevatori di fumo', descrizione: 'Obbligo di estintori, rilevatori di fumo o altri presidi antincendio nello stand.', multiplo: true },
  { id: 'corridoi_antincendio', sezione: 'F', parametro: 'Corridoi antincendio e vie di fuga', descrizione: 'Corridoi tagliafuoco, uscite di sicurezza, vie di fuga all\'interno dello stand.' },
  { id: 'presidi_antincendio_liberi', sezione: 'F', parametro: 'Presidi antincendio del padiglione', descrizione: 'Divieto di coprire o ostruire idranti, estintori, segnaletica di sicurezza del padiglione.' },
  { id: 'portata_pavimento', sezione: 'F', parametro: 'Portata del pavimento', descrizione: 'Carico ammesso sul pavimento dei padiglioni.', multiplo: true },
  { id: 'ancoraggi_pavimento', sezione: 'F', parametro: 'Ancoraggi e forature a pavimento', descrizione: 'Possibilità di ancorare o forare il pavimento, limiti e autorizzazioni.' },
  { id: 'impianti_elettrici', sezione: 'F', parametro: 'Impianti elettrici dello stand', descrizione: 'Norme e prescrizioni per gli impianti elettrici e i cavi dello stand.' },
  { id: 'protezione_macchinari', sezione: 'F', parametro: 'Protezione dei macchinari in funzione', descrizione: 'Recinzioni, schermi o distanze per macchinari in funzione.' },
  { id: 'accessibilita', sezione: 'F', parametro: 'Accessibilità', descrizione: 'Obblighi di accessibilità dello stand per persone con disabilità.' },

  // G
  { id: 'forma_spazio', sezione: 'G', parametro: 'Forma degli spazi espositivi', descrizione: 'Forme ammesse o escluse per gli spazi espositivi.' },
  { id: 'pavimentazione', sezione: 'G', parametro: 'Pavimentazione dello stand', descrizione: 'Obbligo o divieto di pedana, moquette o altro rivestimento a pavimento.' },
  { id: 'finiture_superfici', sezione: 'G', parametro: 'Finitura delle superfici', descrizione: 'Finitura delle pareti e delle superfici visibili da corsie o altri stand.' },
  { id: 'insegne_grafiche', sezione: 'G', parametro: 'Insegne e grafiche', descrizione: 'Insegne ammesse o vietate (neon, luminose, marchi di terzi), grafiche.', multiplo: true },
  { id: 'rumore_audio', sezione: 'G', parametro: 'Rumore e impianti audio', descrizione: 'Limiti di volume, decibel, impianti audio e video.' },
  { id: 'elementi_aerei', sezione: 'G', parametro: 'Palloni, dispositivi ad aria, droni', descrizione: 'Palloni, gonfiabili, dispositivi ad aria, droni: autorizzazioni e limiti.' },
  { id: 'contenimento_spazio', sezione: 'G', parametro: 'Contenimento nello spazio assegnato', descrizione: 'Obbligo di contenere arredi, esposizioni e attività entro lo spazio assegnato.' },
  { id: 'sale_riunioni', sezione: 'G', parametro: 'Sale riunioni e spazi chiusi', descrizione: 'Prescrizioni per sale riunioni o spazi chiusi nello stand o in padiglione.', multiplo: true },
  { id: 'materiali_decorativi', sezione: 'G', parametro: 'Materiali decorativi e ignifugazione', descrizione: 'Requisiti di reazione al fuoco o ignifugazione per materiali, tessuti e decorazioni dello stand.' },

  // J
  { id: 'mezzi_fuori_finestra', sezione: 'J', parametro: 'Mezzi: arrivi fuori finestra', descrizione: 'Conseguenze o costi per merci e mezzi fuori dalla finestra assegnata.' },
  { id: 'corsie_senza_merci', sezione: 'J', parametro: 'Corsie da tenere libere da merci', descrizione: 'Corsie in cui non si possono depositare merci o materiali durante montaggio e smontaggio.' },
  { id: 'minori_montaggio', sezione: 'J', parametro: 'Minori durante montaggio e smontaggio', descrizione: 'Limiti di età per l\'accesso ai padiglioni durante montaggio e smontaggio.' }
].map((t) => ({ ...t, facoltativo: true }));

PARAMETRI.push(...TEMI);

export const ID_PARAMETRI = new Set(PARAMETRI.map((p) => p.id));

/** Slug ASCII minuscolo da un titolo libero. */
export function slug(testo) {
  return String(testo ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/**
 * Riporta l'identificativo proposto dal modello a una forma stabile:
 * - parametro previsto → il suo slug;
 * - variante di un parametro multiplo → "slug__qualificatore";
 * - prescrizione aggiuntiva → "altra_" + slug del titolo.
 */
export function identificativoStabile(idProposto, parametro) {
  const parti = String(idProposto ?? '').split(/_{2,}/).map(slug).filter(Boolean);
  const id = parti.join('__');
  if (ID_PARAMETRI.has(id)) return id;
  const previsto = PARAMETRI.find((p) => p.id === parti[0]);
  if (previsto?.multiplo && parti.length > 1) return id;
  if (id.startsWith('altra_') && parti.length === 1) return id;
  const titolo = slug(parametro || idProposto).replace(/^altra_/, '');
  return 'altra_' + (titolo || 'prescrizione');
}

export function parametriDelGruppo(lettere) {
  return PARAMETRI.filter((p) => lettere.includes(p.sezione));
}
