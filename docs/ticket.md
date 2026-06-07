# Ciclo di vita di un ticket

---

## Struttura dati

```javascript
{
  id:              "T007",                      // sequenziale, T + 3 cifre
  timestamp:       "2026-06-07T10:30:00.000Z",  // ISO 8601, creazione
  condomino:       "Carla Ferretti",
  initials:        "CF",                        // prime 2 lettere del nome
  condominio:      "Via Roma 14, Milano",
  messaggio:       "Quando scade il contratto?",
  categoria:       "documentale",               // vedi sotto
  priorita:        "normale",                   // vedi sotto
  stato:           "chiusa",                    // vedi sotto
  gestitoDa:       "AI",                        // "AI" | "Amministratore"
  esitoGestione:   "risolto_da_ai",             // "risolto_da_ai" | "inoltrato_amministratore"
  rispostaAI:      "Il regolamento prevede...", // testo mostrato al residente
  fonti:           ["regolamento.pdf"],          // documenti usati dal RAG
  noteAdmin:       null,                        // note interne, non visibili al residente
  rispostaAdmin:   null,                        // risposta dell'amministratore
  rispostaAdminAt: null,                        // ISO 8601, quando l'admin ha risposto
  aggiornatoAt:    null,                        // ISO 8601, ultimo PATCH
  conversazione: [
    { role: "user",      content: "Quando scade...?" },
    { role: "assistant", content: "Il regolamento prevede..." },
    { role: "admin",     content: "Gentile condòmino..." }  // se presente
  ]
}
```

---

## Categorie

| Valore | Significato |
|--------|-------------|
| `documentale` | Richieste su verbali, regolamenti, visure |
| `amministrativa` | Rate, pagamenti, contabilità |
| `informativa` | Domande generali |
| `segnalazione` | Problemi fisici (perdite, guasti, rumori) |

---

## Priorità

| Valore | Significato |
|--------|-------------|
| `urgente` | Emergenze fisiche che richiedono intervento immediato |
| `alta` | Problemi che peggiorano se non gestiti |
| `normale` | Richiesta standard |
| `bassa` | Non urgente |

---

## Stati e transizioni

```
            POST /api/chat
                  │
          ┌───────┴────────┐
          │                │
    AI risolve        AI non riesce
          │                │
          ▼                ▼
       "chiusa"         "aperta"
    (gestitoDa: AI)  (gestitoDa: Amministratore)
                          │
                  PATCH stato: in_gestione
                          │
                          ▼
                     "in_gestione"
                          │
               PATCH rispostaAdmin: "..."
                          │
                          ▼
                    "chiusa_admin"
```

| Stato | Significato | Chi lo imposta |
|-------|-------------|----------------|
| `aperta` | In attesa di gestione (umana o AI escalation) | server al momento della creazione |
| `in_gestione` | Admin ha preso in carico | PATCH da admin.html |
| `chiusa` | Risolto dall'AI automaticamente | server al momento della creazione |
| `chiusa_admin` | Risposta inviata dall'admin | PATCH `rispostaAdmin` |

---

## Persistenza

I ticket sono salvati in `tickets.json` nella root del progetto. Il file è un array JSON, ordinato dal più recente al meno recente (i nuovi ticket vengono inseriti con `unshift`).

`salvaTickets()` scrive il file e chiama `notificaSSE()` che manda l'update a tutti i client admin connessi.

**Attenzione:** su Railway il filesystem è efimero. `tickets.json` viene perso ad ogni redeploy. Per la produzione è necessario un database esterno (es. PostgreSQL con il plugin Railway) o un volume persistente.
