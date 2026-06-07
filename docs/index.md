# CondoCare — Documentazione tecnica

Piattaforma di supporto clienti AI-powered per la gestione condominiale.
Backend Node.js/Express + frontend HTML/CSS/JS vanilla + LLM cloud via Groq.

---

## Indice

| Documento | Contenuto |
|-----------|-----------|
| [architettura.md](architettura.md) | Struttura del progetto, stack tecnologico, flusso dati |
| [api.md](api.md) | Tutti gli endpoint REST e SSE con parametri e risposte |
| [ai-rag.md](ai-rag.md) | Pipeline AI: classificazione, RAG documentale, generazione risposta |
| [frontend.md](frontend.md) | Le quattro pagine HTML, design system, state management |
| [ticket.md](ticket.md) | Ciclo di vita di un ticket, stati, struttura dati |
| [deploy.md](deploy.md) | Variabili d'ambiente, avvio locale, deploy su Railway |

---

## Panoramica rapida

```
Residente → condomino.html → POST /api/chat → Groq LLM
                                                   ↓
                                    RAG su /raw (PDF/DOCX/TXT/MD)
                                                   ↓
                              ticket chiuso (AI) o aperto (admin)
                                                   ↓
              admin.html ←── SSE /api/tickets-stream ←── tickets.json
```

**Groq** è il provider LLM cloud (gratuito). Non richiede hardware locale.
I documenti della knowledge base vanno caricati dalla pagina `docs.html`.
