# Deploy e configurazione

---

## Variabili d'ambiente

| Variabile | Default | Obbligatoria | Descrizione |
|-----------|---------|:---:|-------------|
| `GROQ_API_KEY` | — | ✅ | Chiave API Groq (gratuita su console.groq.com) |
| `GROQ_MODEL` | `llama-3.1-8b-instant` | No | Modello Groq da usare |
| `PORT` | `3000` | No | Porta HTTP del server |

Crea un file `.env` nella root (vedi `.env.example`):
```
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
GROQ_MODEL=llama-3.1-8b-instant
PORT=3000
```

Il server carica `.env` manualmente con una funzione `loadEnv()` — non serve il pacchetto `dotenv`.

---

## Avvio locale

```bash
npm install
# Crea .env con GROQ_API_KEY
node server.js
# oppure
npm start
```

Il server è disponibile su `http://localhost:3000`.

Al primo avvio crea automaticamente:
- La cartella `raw/` per i documenti
- Il file `tickets.json` vuoto

---

## Deploy su Railway

Il progetto è già configurato per Railway (`railway.json`):

```json
{
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "node server.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

**Passi:**
1. Crea un nuovo progetto su [railway.app](https://railway.app)
2. Collega il repository GitHub
3. Aggiungi `GROQ_API_KEY` nelle variabili d'ambiente del servizio
4. Railway esegue `npm install` + `node server.js` automaticamente

**Limiti del filesystem Railway:**
- `raw/` e `tickets.json` sono su filesystem efimero — si azzerano ad ogni deploy
- Per persistenza dei documenti: usa Railway Volumes o uno storage esterno (S3, Cloudflare R2)
- Per persistenza dei ticket: migra a PostgreSQL (Railway offre il plugin nativo)

---

## Struttura dei file generati a runtime

```
raw/
├── regolamento.pdf
├── verbale-assemblea.docx
└── faq.txt

tickets.json   ← array JSON con tutti i ticket
```

---

## Ottenere una chiave Groq

1. Vai su [console.groq.com](https://console.groq.com)
2. Registrati (gratuito)
3. Crea una API Key
4. Incollala in `.env` come `GROQ_API_KEY`

Il tier gratuito di Groq ha rate limit generosi per uso in sviluppo e demo.

---

## Modelli Groq disponibili

I più usati per questo tipo di applicazione:

| Modello | Velocità | Qualità | Note |
|---------|---------|---------|------|
| `llama-3.1-8b-instant` | ⚡⚡⚡ | ★★★ | Default, ottimo per MVP |
| `llama-3.3-70b-versatile` | ⚡⚡ | ★★★★ | Più capace, leggermente più lento |
| `gemma2-9b-it` | ⚡⚡⚡ | ★★★ | Alternativa Google |
