# Pipeline AI e RAG

Tutto il codice descritto qui è in [`server.js`](../server.js).

---

## 1. Costruzione del contesto documentale (RAG)

Funzione: `costruisciContestoDocumenti(query, maxChunks = 6)`

### Chunking
`chunkTesto(testo, dimensione=1400, overlap=250)` divide ogni documento in blocchi da 1400 caratteri con 250 caratteri di sovrapposizione. L'overlap evita di tagliare frasi rilevanti sul bordo.

### Keyword extraction
`estraiParoleChiave(query)` normalizza la query (minuscolo, rimozione accenti) e filtra le stopwords italiane hard-coded. Il risultato è l'insieme di parole significative da cercare nei chunks.

### Ranking
Per ogni chunk di ogni documento, viene calcolato un `score` = numero di keyword trovate nel testo normalizzato del chunk. I chunks vengono ordinati per score decrescente e vengono selezionati i top `maxChunks` (default 6).

**Caso speciale — domande generiche sui documenti:**
Se la query contiene parole come `riassumi`, `documenti`, `file`, `analisi`, il primo chunk di ogni file riceve un bonus di +2 al punteggio, così da includere sempre un estratto introduttivo.

**Fallback:**
Se nessun chunk raggiunge score > 0, vengono inviati comunque i primi chunk di ogni file disponibile (fino a 4 file). In questo modo il modello ha sempre del contesto, invece di rispondere in modo generico.

### Output
```javascript
{
  contesto: "[Fonte 1: regolamento.pdf]\n...\n\n---\n\n[Fonte 2: ...]",
  fontiUsate: ["regolamento.pdf"],
  filesDisponibili: ["regolamento.pdf", "verbale.docx"],
  chunks: 3
}
```

---

## 2. Classificazione del messaggio

Funzione: `classificaMessaggio(messaggio)` — `server.js:309`

### Prompt inviato a Groq

```
Sei un assistente per studi di amministrazione condominiale.
Analizza questo messaggio di un condomino e rispondi SOLO con JSON valido.

Messaggio: "{messaggio}"

Rispondi con questo JSON:
{"categoria":"documentale|amministrativa|informativa|segnalazione","priorita":"urgente|alta|normale|bassa","autoRispondi":true,"motivazione":"breve"}

Regole categoria: documentale=verbali/regolamenti, amministrativa=rate/pagamenti, informativa=domande generali, segnalazione=problemi fisici
Regole priorita: urgente=emergenze fisiche, alta=problemi che peggiorano, normale=standard, bassa=non urgente
autoRispondi=true se risposta e in documenti o FAQ standard; false se richiede decisione professionale o segnalazione urgente
```

Nessun system prompt. Un solo messaggio `role: "user"`. Groq risponde in modalità `json_object`.

### Output atteso
```json
{
  "categoria": "documentale|amministrativa|informativa|segnalazione",
  "priorita": "urgente|alta|normale|bassa",
  "autoRispondi": true,
  "motivazione": "breve"
}
```

**Categorie:**
- `documentale` — verbali, regolamenti, visure
- `amministrativa` — rate, pagamenti, contabilità
- `informativa` — domande generali
- `segnalazione` — problemi fisici (perdite, guasti, ecc.)

**Priorità:**
- `urgente` — emergenze fisiche
- `alta` — problemi che peggiorano
- `normale` — standard
- `bassa` — non urgente

> Nota: `autoRispondi` dalla classificazione non viene più usato per decidere la chiusura del ticket. La decisione dipende esclusivamente dalla capacità dell'AI di trovare una risposta sicura nei documenti (vedi sezione 4).

In caso di errore di parsing, fallback a `{ categoria: 'informativa', priorita: 'normale', autoRispondi: false }`.

---

## 3. Generazione della risposta

Funzione: `generaRispostaAI(messaggio, documenti, history, fontiUsate)` — `server.js:338`

### System prompt

```
Sei l'assistente digitale di uno studio di amministrazione condominiale.
Devi rispondere SOLO se il CONTESTO DOCUMENTALE contiene informazioni sufficienti e specifiche per dare una risposta affidabile.
Se l'informazione non e presente, e ambigua, incompleta o non sei sicuro, NON devi rispondere nel merito: devi impostare puoRispondere=false e dire che inoltrerai la richiesta all'amministratore.
Non inventare, non usare conoscenza generale per sostituire i documenti, non chiudere domande dubbie.
Quando rispondi nel merito, cita il nome del file sorgente in forma testuale, ad esempio: Fonte: nomefile.docx.
Tono cordiale, diretto. Italiano. Evita asterischi inutili.

Devi rispondere SOLO con JSON valido, senza testo prima o dopo, con questa struttura:
{"puoRispondere":true,"sicurezza":"alta|media|bassa","risposta":"testo per il condomino","motivazione":"breve motivo","fonti":["nomefile.docx"]}

Regole obbligatorie:
- puoRispondere=true solo se la risposta e chiaramente supportata dal contesto.
- sicurezza=alta o media solo se il contesto contiene dati sufficienti.
- se sicurezza=bassa, puoRispondere deve essere false.
- se puoRispondere=false, la risposta deve dire che la richiesta viene inoltrata all'amministratore.

FONTI DISPONIBILI: {lista file usati dal RAG, es. "regolamento.pdf, verbale.docx"}

CONTESTO DOCUMENTALE:
[Fonte 1: regolamento.pdf]
...chunk di testo selezionato dal RAG...

---

[Fonte 2: verbale.docx]
...chunk di testo selezionato dal RAG...
```

### Sequenza messaggi inviata a Groq

```
[
  { role: "system",    content: <system prompt sopra> },
  { role: "user",      content: "..." },   ─┐
  { role: "assistant", content: "..." },    │ ultimi 6 messaggi
  ...                                       │ della history
  { role: "user",      content: "..." },   ─┘
  { role: "user",      content: "{messaggio corrente}" }
]
```

### Output atteso
```json
{
  "puoRispondere": true,
  "sicurezza": "alta|media|bassa",
  "risposta": "testo per il condòmino",
  "motivazione": "breve",
  "fonti": ["regolamento.pdf"]
}
```

**Fallback** se il parsing JSON fallisce: `fallbackEscalationAI()` restituisce un oggetto con `puoRispondere: false` e il testo standard:
> "Grazie per averci scritto. Non ho elementi documentali sufficienti per risponderti con certezza: inoltro la richiesta all'amministratore, che ti darà riscontro appena possibile."

---

## 4. Decisione: chiudere o escalare

Funzione: `rispostaGestibileDaAI(rispostaAI)`

Ritorna `true` solo se **tutte** queste condizioni sono vere:
1. `puoRispondere === true`
2. `sicurezza` contiene "alta" o "media"
3. La risposta ha più di 20 caratteri
4. La risposta **non** contiene frasi di escalation (`"inoltro"`, `"amministratore ti"`, `"non ho elementi"`, ecc.)

La protezione al punto 4 previene casi in cui il modello dice `puoRispondere: true` ma poi nel testo della risposta comunica comunque l'escalation.

**Se `true`** → ticket `stato: "chiusa"`, `gestitoDa: "AI"`  
**Se `false`** → ticket `stato: "aperta"`, `gestitoDa: "Amministratore"`

---

## 5. Client Groq

Funzione: `chiamaGroq(messaggi, json)`

Chiama `https://api.groq.com/openai/v1/chat/completions` con:
- `model`: valore di `GROQ_MODEL` (default `llama-3.1-8b-instant`)
- `temperature: 0.1` — risposta deterministica
- `response_format: { type: 'json_object' }` quando `json=true`

Richiede `GROQ_API_KEY` come variabile d'ambiente. Se assente, lancia un errore esplicito.

---

## Cambio provider LLM

Il progetto ha avuto due fasi:
- **Versione originale** (`server_originale.js`) — Ollama locale, LLM on-premise
- **Versione corrente** (`server.js`) — Groq cloud, gratuito e senza hardware

Per tornare a Ollama o passare ad altro provider OpenAI-compatible, basta riscrivere la funzione `chiamaGroq` con l'URL e l'autenticazione appropriati. La pipeline RAG e il resto del codice non cambiano.
