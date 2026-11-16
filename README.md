# Scheda regolamenti fiera

Webapp interna WES. Il PM carica i regolamenti tecnici di una fiera (PDF dell'ente fiera e/o dell'organizzatore); l'app estrae le prescrizioni che vincolano la progettazione dello stand, verifica ogni citazione nel PDF e le mostra in dieci schede a colori (A-J). Una chat guida il PM a chiudere le voci aperte; il lavoro si interrompe e si riprende con un file di lavoro firmato; la consegna è un PDF ottenuto con la stampa del browser.

Indirizzo del servizio: <https://wes-scheda-regolamenti.onrender.com>

Requisiti e decisioni sono in [docs/specifiche.md](docs/specifiche.md). Il pacchetto di avvio dello sviluppo è descritto in [docs/pacchetto-avvio.md](docs/pacchetto-avvio.md).

---

## Come è fatto

```
browser del PM (frontend/index.html, servito dal servizio stesso)
   │  PDF, testo delle pagine firmato, scheda
   ▼
servizio Node su Render (backend/)  ──▶  API Anthropic (modello in MODELLO)
```

Il servizio **non conserva nulla**: nessun database, nessun file su disco. I regolamenti vivono in memoria per la durata della richiesta; la scheda vive nel browser del PM e nel file di lavoro che il PM scarica. Nei log finiscono solo numeri (pagine, voci, token), mai il testo dei regolamenti. I regolamenti vengono inviati soltanto all'API Anthropic.

| File | Ruolo |
|---|---|
| `backend/server.js` | rotte HTTP, codice d'accesso, limite orario, gestione errori |
| `backend/lettura.js` | testo di ogni pagina del PDF, controllo di leggibilità, lettura ottica (Tesseract) a 200 dpi delle pagine illeggibili |
| `backend/estrazione.js` | prompt, chiamate al modello per gruppi di sezioni, divisione dei compiti se la risposta è troncata |
| `backend/parametri.js` | le dieci sezioni, i parametri con identificativo fisso, i temi da controllare |
| `backend/verifica.js` | verifica deterministica delle citazioni: una voce è "Confermato" solo se il codice ritrova la citazione nel PDF |
| `backend/lavoro.js` | sigilli delle voci confermate, firma e verifica del file di lavoro, riverifica |
| `backend/fusione.js` | fusione per identificativo quando si aggiungono regolamenti a un lavoro ripreso |
| `backend/chat.js` | chat di risoluzione, una voce alla volta |
| `backend/firma.js` | firma HMAC con il segreto `FIRMA_SEGRETO` |
| `frontend/index.html` | la pagina dell'app: apertura, schede, chat, file di lavoro, stampa |
| `render.yaml` | configurazione del servizio su Render (Blueprint) |

### Perché la scheda è affidabile

- **Citazioni verificate dal codice.** Il modello propone voci e citazioni; il codice cerca ogni citazione, alla lettera, nel testo della pagina indicata (o di quelle vicine). Se non la trova, la voce scende a "Da verificare". Su ogni citazione resta scritto se è stata trovata nel testo del PDF o con la lettura ottica.
- **Sigilli.** Ogni voce confermata riceve dal servizio un sigillo che lega stato, valore e citazioni all'impronta del PDF. Una conferma non può nascere da una modifica a mano del file né da una risposta in chat. Quando un file di lavoro senza firma valida viene ripreso e il PM ricarica i regolamenti, una voce torna "Confermato" solo se la citazione si ritrova **e** il sigillo originale vale ancora: un valore cambiato a mano resta "Da verificare" anche se la citazione è autentica.
- **Risposte del PM separate.** "Chiarito dal PM", "In attesa" e "Non applicabile" stanno in un campo a parte e non rendono mai una voce "Confermato"; anche il PDF di consegna le distingue.
- **Nessun output troncato in scheda.** Se il modello si ferma per limite di lunghezza, la risposta è scartata e il compito viene diviso; ciò che non si riesce a completare compare come "Da verificare – estrazione incompleta".

---

## Variabili d'ambiente

Su Render si inseriscono in **Environment** del servizio. In locale si scrivono nel file `backend/.env` (copia di `backend/.env.example`), che **non va mai nel repository** ed è escluso da `.gitignore`. Non caricarlo dal sito di GitHub.

| Variabile | Obbligatoria | Valore | A cosa serve |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **sì** | `sk-ant-...` | chiave API del Team WES AI (console.anthropic.com, tipo "Altrove") |
| `CODICE_ACCESSO` | **sì** | una parola o frase concordata | i PM la inseriscono una volta; senza, chiunque trovi l'indirizzo può usare il servizio |
| `FIRMA_SEGRETO` | **sì** | almeno 32 caratteri casuali | firma il testo delle pagine e il file di lavoro; vedi la sezione dedicata |
| `MODELLO` | no | `claude-sonnet-5-5` | modello usato per estrazione e chat; si cambia senza toccare il codice |
| `EFFORT` | no | `medium` | profondità di ragionamento nell'estrazione (`low`, `medium`, `high`) |
| `EFFORT_CHAT` | no | `low` | profondità di ragionamento nella chat |
| `MAX_TOKENS` | no | `32000` | lunghezza massima di una risposta di estrazione; oltre, il compito si divide |
| `MAX_MB` | no | `25` | dimensione massima dei regolamenti inviati insieme |
| `LIMITE_ORARIO` | no | `200` | richieste all'ora per indirizzo IP |
| `ORIGINI_CONSENTITE` | no | — | altri siti da cui la pagina può chiamare il servizio (non serve: la pagina è servita dal servizio stesso) |
| `CONSENTI_ORIGINE_NULL` | no | `true` | consente la pagina aperta da disco |
| `NODE_VERSION` | no | `22` | versione di Node su Render (già in `render.yaml`) |

Per controllare che il servizio sia configurato, apri `https://wes-scheda-regolamenti.onrender.com/health`: deve rispondere `"codiceRichiesto": true` e `"firmaConfigurata": true`.

---

## Il segreto di firma (`FIRMA_SEGRETO`)

**A cosa serve.** Con questo segreto il servizio firma il testo delle pagine che restituisce al browser e il file di lavoro che il PM scarica, e sigilla le voci confermate. Al caricamento di un file di lavoro il servizio controlla la firma: se non torna, il file viene importato comunque, ma tutte le voci "Confermato" tornano "Da verificare" finché il PM non ricarica i regolamenti.

**Come generarlo.** Sul proprio PC, con Node installato, questo comando copia un segreto nuovo negli appunti senza mostrarlo:

```powershell
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | Set-Clipboard
```

Incollarlo direttamente in `FIRMA_SEGRETO` su Render (Environment → Save, rebuild and deploy).

**Dove conservarlo.** Solo nel pannello di Render e in una copia nel gestore di password aziendale. Mai nel repository, in chat, in email o in file condivisi. Non stamparlo a schermo.

**Cosa succede se cambia.** Tutti i file di lavoro salvati prima del cambio risultano "senza firma valida": si aprono, le risposte dei PM restano, ma le voci confermate tornano "Da verificare". Anche i sigilli delle voci erano fatti con il vecchio segreto, quindi **ricaricare i regolamenti non basta a riconfermarle**: restano "Da verificare" con il motivo "la voce non corrisponde più a quella confermata dal servizio". Per riavere le conferme il PM apre una **scheda nuova** con gli stessi PDF e riporta a mano le risposte già date, leggendole dal vecchio file. Per questo il segreto si cambia solo se c'è motivo di ritenerlo esposto, avvisando prima i PM di chiudere le schede in corso.

**Se è stato esposto** (per esempio pubblicato per errore): generarne subito uno nuovo, sostituirlo su Render e avvisare i PM come sopra. Lo stesso vale per `CODICE_ACCESSO` e, se esposta, per la chiave API (da revocare nella console Anthropic).

---

## Pubblicazione su Render

Il servizio `wes-scheda-regolamenti` è collegato al repository `Worldwide-Exhibition-System/Analisi-Regolamenti-Fiera` e si aggiorna da solo a ogni push sul ramo `main` che tocca `backend/`, `frontend/` o `render.yaml`.

Per crearlo da zero:

1. Su Render: **New → Blueprint**, collegare il repository. Render legge `render.yaml` e crea il servizio (piano gratuito, Node, comandi `cd backend && npm ci` e `cd backend && npm start`, controllo su `/health`).
2. In **Environment** inserire `ANTHROPIC_API_KEY`, `CODICE_ACCESSO` e `FIRMA_SEGRETO`, poi **Save, rebuild and deploy** (non "Save only", che non applica le variabili fino al deploy successivo).
3. Attendere che l'ultimo deploy in **Events** sia **Live** e aprire `/health`.

Il repository va tenuto **privato**: contiene i regolamenti del caso di prova.

**Piano gratuito.** Dopo circa 15 minuti di inattività il servizio si sospende e la prima richiesta lo riavvia (fino a un minuto). La lettura ottica è lenta su questo piano: circa 2 minuti per 5 pagine illeggibili, con un picco di memoria di circa 340 MB sui 512 disponibili. Due PM che caricano contemporaneamente regolamenti scansionati potrebbero superare la memoria: in quel caso si valuta un piano superiore.

---

## Provare in locale

Serve Node 22 o successivo.

```powershell
cd backend
npm ci
copy .env.example .env   # poi scrivere i valori nel file .env
npm start
```

La pagina è su <http://localhost:3000>.

| Comando (in `backend/`) | Cosa fa |
|---|---|
| `npm test` | test automatici: verifica delle citazioni (compresa una citazione inventata), lettura ottica dell'Appendice A, estrazione e divisione dei compiti, firma, file di lavoro, fusione, chat. Non usa l'API. |
| `npm run collaudo` | estrae il caso NPE2027 da `fixtures/` e misura le quattro soglie del punto 11 delle specifiche; usa l'API. Scheda e rapporto in `backend/collaudo-esiti/` |
| `npm run collaudo -- --max-tokens 4000 --gruppi AB` | come sopra con limite di lunghezza ridotto, per provare la divisione dei compiti |
| `node scripts/prova-servizio.js <indirizzo>` | prova la lettura ottica sul servizio pubblicato; il codice d'accesso va in `$env:CODICE_ACCESSO` nel terminale |

---

## Uso da parte dei PM, in breve

1. Aprire l'indirizzo, scrivere nome e codice d'accesso.
2. **Scheda nuova**: caricare i PDF dei regolamenti e indicare per ciascuno se è dell'ente fiera o dell'organizzatore. L'estrazione richiede alcuni minuti.
3. Leggere le schede A-J. Con **Voci aperte** la chat propone le voci "Da verificare" e "Non specificato" una alla volta: rispondere con valore e fonte, oppure "Non applicabile" o "In attesa".
4. **Salva file di lavoro** (servono nome PM e numero di commessa nel formato `001-2027`). Per riprendere: **Riprendi un lavoro** con quel file `.json`, eventualmente insieme a nuovi regolamenti da fondere.
5. **Stampa / PDF** produce il PDF di consegna: "BOZZA" se ci sono voci aperte, "Versione del giorno" quando sono tutte chiuse o in attesa.

Il PDF di consegna **non** serve a riprendere il lavoro: se viene caricato al suo posto, l'app lo respinge. La copia automatica nel browser è solo una rete di sicurezza: la copia che conta è il file di lavoro.

---

## Limiti noti

- La lettura ottica legge male alcune pagine a due colonne con disegni: le citazioni di quelle zone possono non essere ritrovate e restano "Da verificare".
- Nella fusione con un nuovo regolamento, due valori senza numeri formulati diversamente risultano in conflitto anche se dicono la stessa cosa (scelta prudente); e la fusione avviene solo tra voci con lo stesso identificativo.
- Collaudo NPE2027 del 13/11/2026: quattro soglie superate. La seconda (voci confermate del golden ritrovate con lo stesso valore, minimo 54 su 60) dà 55 su 60 con l'estrazione completa e 58 su 60 dopo il ritocco del parametro "Accrediti e pass" (sezioni I-J estratte di nuovo, A-H dall'estrazione completa). Il modello non è deterministico: da un'estrazione all'altra alcune voci passano da "Confermato" a "Da verificare" per prudenza (per esempio orari della manifestazione, inizio del disallestimento, veicoli al marshalling yard, portata del pavimento in West Hall A). Lo script `backend/scripts/collaudo.js` aggancia le voci del golden per citazione e per parametro (`backend/scripts/mappa-golden.json`) e le voci testuali vanno controllate a mano.
