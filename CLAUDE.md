# CondoCare — Contesto per Claude

Piattaforma AI di supporto clienti per studi di amministrazione condominiale.
I residenti chattano in italiano, l'AI risponde basandosi su documenti caricati dall'admin.

## Stack in breve

- **Backend:** `server.js` — Node.js + Express, tutto in un file
- **LLM:** Groq API (llama-3.1-8b-instant), chiave in `GROQ_API_KEY`
- **Storage:** `tickets.json` (ticket) + `raw/` (documenti knowledge base)
- **Frontend:** 4 pagine HTML vanilla in `public/`
- **Deploy:** Railway (`railway.json`)

## File principali

| File | Ruolo |
|------|-------|
| `server.js` | Entry point, tutti gli endpoint REST e SSE |
| `public/condomino.html` | Chat residente |
| `public/admin.html` | Dashboard admin con SSE |
| `public/docs.html` | Gestione documenti knowledge base |
| `public/style.css` | Design system (colori, componenti, badge) |

## Flusso core

```
POST /api/chat → RAG su /raw → Groq classifica → Groq risponde
→ se sicurezza alta/media → ticket chiuso (AI)
→ altrimenti → ticket aperto, admin vede via SSE e risponde
```

## Variabili d'ambiente richieste

```
GROQ_API_KEY=gsk_...          # obbligatoria
GROQ_MODEL=llama-3.1-8b-instant
PORT=3000
```

## Documentazione completa

→ [docs/index.md](docs/index.md)

- [Architettura e flusso dati](docs/architettura.md)
- [API Reference](docs/api.md)
- [Pipeline AI e RAG](docs/ai-rag.md)
- [Frontend — pagine e design system](docs/frontend.md)
- [Ciclo di vita ticket](docs/ticket.md)
- [Deploy e configurazione](docs/deploy.md)

## Note per lo sviluppo

- `isBusy` in `server.js:440` serializza le chiamate Groq — rimuoverlo solo con rate limiting adeguato
- I ticket vengono persi ad ogni redeploy su Railway (filesystem efimero)
- I file `server_*.js` alternativi sono varianti di sviluppo, non sono attivi
- Il RAG è keyword-based senza embedding — funziona bene fino a ~50 documenti

# Aggiornamento documentazione
 Ogni volta che modifichi o aggiungi funzionalità importanti devi aggiornare anche la documentazione. Basta una descrizione breve, non serve la modifica completa dei file.
