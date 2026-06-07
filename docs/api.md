# API Reference

Base URL: `http://localhost:3000` (locale) o URL Railway in produzione.

---

## Status e documenti

### `GET /api/status`
Verifica la connessione a Groq.

**Risposta**
```json
{
  "online": true,
  "modelloCorrente": "llama-3.1-8b-instant",
  "modelloPresente": true,
  "provider": "Groq"
}
```
Se `GROQ_API_KEY` non è configurata: `online: false`, campo `errore`.

---

### `GET /api/docs`
Lista i file nella knowledge base (`/raw`).

**Risposta**
```json
{
  "files": [
    { "nome": "regolamento.pdf", "dimensione": "142 KB", "data": "05/06/2026" }
  ]
}
```

---

### `POST /api/upload`
Carica uno o più documenti nella knowledge base.

**Content-Type:** `multipart/form-data`  
**Campo:** `documento` (file singolo)  
**Formati accettati:** `.pdf`, `.docx`, `.txt`, `.md`  
**Limite dimensione:** 20 MB per file

**Risposta**
```json
{ "ok": true, "nome": "regolamento.pdf" }
```

---

### `DELETE /api/docs/:nome`
Elimina un documento dalla knowledge base.

**Parametro:** nome del file (URL-encoded se necessario)

**Risposta**
```json
{ "ok": true }
```

---

## Chat

### `POST /api/chat`
Endpoint principale. Riceve il messaggio del residente, esegue RAG + classificazione + risposta AI, crea il ticket.

**Body JSON**
```json
{
  "messaggio": "Quando scade il mio contratto?",
  "condomino": "Carla Ferretti",
  "condominio": "Via Roma 14, Milano",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```
`history` è opzionale. Vengono usati al massimo gli ultimi 6 messaggi per il contesto.

**Risposta (successo)**
```json
{
  "risposta": "Il regolamento prevede...",
  "ticket": "T007",
  "categoria": "documentale",
  "priorita": "normale",
  "stato": "chiusa",
  "gestitoDa": "AI",
  "esitoGestione": "risolto_da_ai",
  "autoGestita": true,
  "documentiLetti": ["regolamento.pdf"],
  "fontiUsate": ["regolamento.pdf"],
  "chunksUsati": 3,
  "durataMs": 1240
}
```

`stato` può essere `"chiusa"` (gestito da AI) o `"aperta"` (escalation ad amministratore).

**Errori**
- `400` — messaggio mancante
- `429` — server occupato (chiamata precedente ancora in corso)
- `500` — errore Groq o generico

---

## Ticket

### `GET /api/tickets`
Ritorna tutti i ticket e i KPI.

**Risposta**
```json
{
  "tickets": [ /* array di ticket */ ],
  "kpi": {
    "totali": 12,
    "gestiteAI": 8,
    "urgenti": 1,
    "inAttesa": 3,
    "oggi_count": 5,
    "percentuale": 67,
    "categorie": {
      "segnalazione": 3,
      "amministrativa": 4,
      "documentale": 3,
      "informativa": 2
    }
  }
}
```

---

### `GET /api/tickets/:id`
Ritorna un singolo ticket per ID (es. `T007`).

**Risposta:** oggetto ticket completo (vedi [ticket.md](ticket.md)).

---

### `PATCH /api/tickets/:id`
Aggiorna un ticket. Tutti i campi sono opzionali.

**Body JSON**
```json
{
  "stato": "in_gestione",
  "gestitoDa": "Amministratore",
  "noteAdmin": "Verificare con il notaio",
  "rispostaAdmin": "Gentile condòmino, la risposta è..."
}
```

Quando viene impostato `rispostaAdmin`:
- `rispostaAdminAt` viene compilato automaticamente con il timestamp corrente
- `stato` viene impostato a `chiusa_admin` se non già specificato

**Risposta:** oggetto ticket aggiornato.

---

### `DELETE /api/tickets`
Cancella tutti i ticket. Usato dal pulsante "Reset" nell'interfaccia.

**Risposta**
```json
{ "ok": true }
```

---

## SSE — Aggiornamenti real-time

### `GET /api/tickets-stream`
Connessione Server-Sent Events. Rimane aperta e invia eventi ogni volta che i ticket cambiano.

**Headers risposta**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Formato evento**
```
event: update
data: {"tickets":[...],"kpi":{...}}
```

**Keep-alive** — ogni 25 secondi viene inviato `: ka\n\n` per mantenere viva la connessione.

Il client riceve l'elenco completo dei ticket ad ogni update (non solo il delta).
