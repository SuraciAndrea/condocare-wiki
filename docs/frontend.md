# Frontend

Il frontend è interamente in `public/` — quattro pagine HTML con JavaScript vanilla e un foglio di stile condiviso. Nessun bundler, nessun framework.

---

## Pagine

### `index.html` — Landing page
Punto di ingresso. Mostra il logo, lo stato del servizio AI (`GET /api/status`) e il numero di documenti caricati (`GET /api/docs`). Due card portano rispettivamente a `condomino.html` e `admin.html`.

---

### `condomino.html` — Chat residente

**Layout a due colonne:**
- Sinistra (280px): lista conversazioni e campi identità (nome, indirizzo condominio)
- Destra: chat attiva con storico messaggi e input

**State management** (variabili globali JS):
- `convAttiva` — ID del ticket corrente
- `modalita` — `"nuova"` o `"continua"`
- `pollingMap` — Map `ticketId → intervalId` per i polling attivi
- `mioTickets` — array dei ticket del residente (filtrati per nome + condominio)

**Flusso invio messaggio:**
1. Utente scrive e invia → `POST /api/chat`
2. Se `autoGestita: true` → messaggio AI mostrato direttamente, ticket chiuso
3. Se `autoGestita: false` → messaggio di attesa mostrato, si avvia polling ogni 4 secondi su `GET /api/tickets/:id`
4. Quando il polling trova `rispostaAdmin` non null → risposta admin mostrata, polling fermato

**Quick actions:** bottoni predefiniti che pre-compilano l'input con domande frequenti (regolamento, verbale, quote, segnalazione).

**Caricamento conversazioni:** al cambio di nome/condominio, `GET /api/tickets` filtra i ticket per `condomino` e `condominio` esatti.

---

### `admin.html` — Dashboard amministratore

**Layout a tre colonne:**
- Sidebar (230px): navigazione, profilo, contatori badge
- Area centrale: lista ticket con filtri
- Pannello destro (270px): KPI statistiche

**Filtri ticket:**
- Tutte
- Urgenti (`priorita === "urgente"` e `stato === "aperta"`)
- In attesa (`stato === "aperta"` o `"in_gestione"`)
- Gestite dall'AI (`gestitoDa === "AI"`)

**State management:**
- `allTickets` — array completo ricevuto via SSE
- `filtroAttivo` — stringa del filtro corrente
- `ticketAperto` — ID del ticket aperto nel modal

**SSE:** connessione `EventSource` a `/api/tickets-stream`. Ad ogni `event: update` la lista viene ridisegnata e i KPI aggiornati. In caso di errore la connessione si riconnette automaticamente dopo 3 secondi.

**Modal dettaglio ticket:**
- Mostra l'intera conversazione (user / AI / admin)
- Textarea per risposta admin (nascosta se risposta già inviata)
- Textarea per note interne (non visibili al residente)
- Azioni: "Prendi in carico" (`PATCH stato: in_gestione`), "Invia risposta" (`PATCH rispostaAdmin`), "Salva note" (`PATCH noteAdmin`)

**Greeting dinamico:** il titolo cambia in base all'ora (buongiorno/buonpomeriggio/buonasera).

---

### `docs.html` — Gestione documenti

Pagina semplice con:
- Zona drag-and-drop per upload (fallback click)
- Griglia di card per ogni documento presente in `/raw`
- Bottone elimina su ogni card (`DELETE /api/docs/:nome`)
- Feedback visivo per upload riuscito/fallito

---

## Design system (`style.css`)

### Palette colori
Brand kit CondoCare: Soft Navy · Dusty Blue · Warm Sand · Cream · Light Mist.
I nomi storici `--green-*` sono mantenuti come alias del primario/accento (navy).
```css
--green-dark:  #30475A   /* Soft Navy — sfondo sidebar, header, primario */
--green-mid:   #3E5A70   /* navy hover */
--green-light: #6C8FA3   /* Dusty Blue — accenti secondari */
--sand:        #DCC9A3   /* Warm Sand — accent, bottoni */
--sand-light:  #ECE0CC
--sand-pale:   #FBF6EE
--cream:       #FAF7F1   /* Cream — sfondo pagina */
--cream-dark:  #E6EBEF
--blue-steel:  #6C8FA3   /* Dusty Blue — info */
--blue-pale:   #DDE5EA   /* Light Mist */
--border:      #DDE5EA   /* Light Mist */
--red:         #B83227   /* urgente, errori */
--red-pale:    #FDECEB
--orange:      #C0622A   /* warning, alta priorità */
--orange-pale: #FDF3E7
```

### Tipografia
- **Titoli:** Fraunces (serif, da Google Fonts)
- **Corpo:** DM Sans (sans-serif)

### Logo
Immagine `public/logo.png` (contiene già il wordmark "CondoCare"), inserita via
`<img class="logo-img on-dark">`. La classe `.on-dark` la rende bianca sulle
intestazioni navy.

### Componenti notevoli
- **Badge** — colorati per categoria (`documentale`, `amministrativa`, `segnalazione`, `informativa`) e per priorità (`urgente`, `alta`, `normale`, `bassa`)
- **Bubble chat** — tre varianti: `.user-bubble`, `.ai-bubble`, `.admin-bubble`
- **Typing indicator** — tre puntini animati mostrati mentre si attende la risposta AI
- **Pulse animation** — sull'indicatore di connessione live in sidebar
- **Priority border** — bordo sinistro colorato sulle card ticket in base alla priorità
