# Architettura del progetto

## Stack tecnologico

**Backend**
- Node.js + Express 4.x
- Multer — upload file
- pdf-parse — estrazione testo da PDF
- Mammoth — estrazione testo da DOCX
- Groq API (OpenAI-compatible) — LLM cloud

**Frontend**
- HTML/CSS/JavaScript vanilla (nessun framework)
- Google Fonts: Playfair Display + DM Sans
- Fetch API + EventSource (SSE)

**Storage**
- `tickets.json` — tutti i ticket, persistenza su file
- `raw/` — documenti caricati dalla knowledge base

**Deploy**
- Railway (configurato in `railway.json`)
- `node server.js` come start command

---

## Struttura delle directory

```
llm-wiki-local/
├── server.js               # Entry point — tutto il backend
├── server_originale.js     # Versione precedente (Ollama locale)
├── server_Backup1.js       # Backup
├── server_Claude.js        # Variante sperimentale
├── server_nnva.js          # Variante sperimentale
├── package.json
├── railway.json            # Config deploy Railway
├── .env.example            # Template variabili d'ambiente
├── .gitignore
├── tickets.json            # Generato a runtime
├── raw/                    # Generata a runtime — documenti knowledge base
└── public/
    ├── index.html          # Landing page (selezione ruolo)
    ├── condomino.html      # Chat residente
    ├── admin.html          # Dashboard amministratore
    ├── docs.html           # Gestione documenti
    └── style.css           # Design system unificato
```

> I file `server_*.js` alternativi sono varianti di sviluppo. Il file attivo è `server.js`.

---

## Flusso dati principale

```
1. Residente invia messaggio (condomino.html)
        │
        ▼
2. POST /api/chat
        │
        ├─ costruisciContestoDocumenti(messaggio)
        │       └─ legge /raw, crea chunks, ranking keyword → top 6 chunks
        │
        ├─ classificaMessaggio(messaggio)  → Groq (JSON: categoria, priorità, autoRispondi)
        │
        ├─ generaRispostaAI(messaggio, contesto, history)  → Groq (JSON: risposta, sicurezza)
        │
        ├─ rispostaGestibileDaAI() → true se sicurezza alta/media e nessuna frase di escalation
        │
        └─ nuovoTicket()  → tickets.json  → notificaSSE()
                │
                ▼
3. Admin riceve update SSE (admin.html)
   Può rispondere → PATCH /api/tickets/:id → notificaSSE()
                │
                ▼
4. Residente vede risposta admin (polling GET /api/tickets/:id ogni 4s)
```

---

## Scelte architetturali rilevanti

**File-based storage** — Nessun database. I ticket sono in `tickets.json`, i documenti in `raw/`. Semplice da deployare, sufficiente per MVP. Limite: non scalabile con molti utenti concorrenti.

**RAG senza embedding** — Il retrieval è keyword-based (bag of words, stopwords italiane rimosse). Nessun vector store, nessuna dipendenza esterna. Funziona bene su knowledge base piccole (< 50 documenti).

**Groq come LLM** — Sostituisce Ollama (versione originale con LLM locale). Groq offre API gratuite e compatibili OpenAI. Il modello default è `llama-3.1-8b-instant`.

**SSE per real-time** — Server-Sent Events unidirezionali invece di WebSocket. Più semplice, sufficiente perché solo il server invia aggiornamenti al client.

**isBusy flag** — Un semaforo booleano globale serializza le chiamate a `/api/chat`. Previene chiamate Groq parallele che potrebbero superare i rate limit. Risponde 429 se occupato.
