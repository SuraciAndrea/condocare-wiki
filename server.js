// LLM Wiki Local — server principale
// Workflow CondoCare con AI cloud (Groq, gratis e veloce)

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

// ── Configurazione ──────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [k, ...v] = t.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  }
}
loadEnv();

const PORT         = process.env.PORT         || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL   = process.env.GROQ_MODEL   || 'llama-3.1-8b-instant';
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';
const RAW_DIR      = path.join(__dirname, 'raw');
const TICKETS_FILE = path.join(__dirname, 'tickets.json');

if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
if (!fs.existsSync(TICKETS_FILE)) fs.writeFileSync(TICKETS_FILE, '[]', 'utf8');

// ── App Express ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Multer ──────────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, RAW_DIR),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    cb(null, base + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.pdf', '.docx', '.txt', '.md'].includes(path.extname(file.originalname).toLowerCase());
    ok ? cb(null, true) : cb(new Error('Formato non supportato.'));
  }
});

// ── Lettura documenti ───────────────────────────────────────────────────────

async function leggiDocumento(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.txt' || ext === '.md') return fs.readFileSync(filePath, 'utf8');
  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(fs.readFileSync(filePath));
    return data.text;
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result  = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }
  return '';
}

async function leggiTuttiDocumenti() {
  const files = fs.readdirSync(RAW_DIR).filter(f =>
    ['.pdf', '.docx', '.txt', '.md'].includes(path.extname(f).toLowerCase())
  );
  if (!files.length) return { testo: '', files: [] };
  const blocchi = [];
  for (const file of files) {
    try {
      const testo = await leggiDocumento(path.join(RAW_DIR, file));
      blocchi.push('=== DOCUMENTO: ' + file + ' ===\n' + testo.trim() + '\n');
    } catch (err) {
      blocchi.push('=== DOCUMENTO: ' + file + ' ===\n[Errore: ' + err.message + ']\n');
    }
  }
  return { testo: blocchi.join('\n'), files };
}


// ── Recupero contesto documentale RAG semplice ──────────────────────────────
// I file in /raw non vengono "visti" dal modello da soli: qui estraiamo solo
// i passaggi più rilevanti e li inseriamo nel prompt inviato a Ollama.

function normalizzaTesto(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function estraiParoleChiave(s) {
  const stopwords = new Set([
    'come', 'cosa', 'quale', 'quali', 'quanto', 'quando', 'dove', 'sono',
    'della', 'delle', 'degli', 'dello', 'alla', 'alle', 'agli', 'con', 'per',
    'che', 'nel', 'nella', 'nei', 'nelle', 'dei', 'del', 'una', 'uno', 'gli',
    'tra', 'fra', 'questo', 'questa', 'questi', 'queste', 'mio', 'mia', 'tuo',
    'tua', 'suo', 'sua', 'loro', 'mi', 'ti', 'ci', 'vi', 'il', 'lo', 'la',
    'le', 'i', 'a', 'e', 'o', 'di', 'da', 'in', 'un', 'al', 'ai', 'sul',
    'sulla', 'su', 'ma', 'non', 'piu', 'puoi', 'devo', 'voglio'
  ]);

  return [...new Set(
    normalizzaTesto(s)
      .match(/[a-z0-9]{4,}/g)
      ?.filter(w => !stopwords.has(w)) || []
  )];
}

function chunkTesto(testo, dimensione = 1400, overlap = 250) {
  const clean = (testo || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chunks = [];
  const step = Math.max(1, dimensione - overlap);
  for (let i = 0; i < clean.length; i += step) {
    chunks.push(clean.slice(i, i + dimensione));
  }
  return chunks;
}

function domandaGenericaSuDocumenti(query) {
  const q = normalizzaTesto(query);
  return [
    'documenti', 'documento', 'file', 'files', 'caricati', 'raw', 'progetto',
    'riassumi', 'riassunto', 'sintesi', 'analizza', 'analisi', 'trovi', 'contenuto'
  ].some(k => q.includes(k));
}

async function costruisciContestoDocumenti(query, maxChunks = 6) {
  const files = fs.readdirSync(RAW_DIR).filter(f =>
    ['.pdf', '.docx', '.txt', '.md'].includes(path.extname(f).toLowerCase())
  );

  const parole = estraiParoleChiave(query);
  const queryGenerica = domandaGenericaSuDocumenti(query);
  const candidati = [];
  const fontiDisponibili = [];

  for (const file of files) {
    const fullPath = path.join(RAW_DIR, file);
    let testo = '';

    try {
      testo = await leggiDocumento(fullPath);
    } catch (err) {
      console.error('[RAG] Errore lettura file:', file, err.message);
      continue;
    }

    const chunks = chunkTesto(testo);
    if (!chunks.length) continue;
    fontiDisponibili.push(file);

    chunks.forEach((chunk, index) => {
      const chunkNorm = normalizzaTesto(chunk);
      let score = 0;

      for (const p of parole) {
        if (chunkNorm.includes(p)) score += 1;
      }

      // Per richieste generiche tipo "riassumi i documenti" includiamo anche
      // l'inizio di ogni file, altrimenti la ricerca keyword può restare a zero.
      if (queryGenerica && index === 0) score += 2;

      if (score > 0) {
        candidati.push({ file, index, score, text: chunk });
      }
    });
  }

  candidati.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.index - b.index);

  let selezionati = candidati.slice(0, maxChunks);

  // Fallback: se non troviamo match, inviamo comunque un estratto iniziale dei
  // documenti disponibili, così il modello non risponde in modo completamente generico.
  if (!selezionati.length && fontiDisponibili.length) {
    for (const file of fontiDisponibili.slice(0, Math.min(maxChunks, 4))) {
      try {
        const testo = await leggiDocumento(path.join(RAW_DIR, file));
        const primoChunk = chunkTesto(testo)[0];
        if (primoChunk) selezionati.push({ file, index: 0, score: 0, text: primoChunk });
      } catch (err) {
        console.error('[RAG] Errore fallback file:', file, err.message);
      }
    }
  }

  const contesto = selezionati
    .map((c, i) => '[Fonte ' + (i + 1) + ': ' + c.file + ']\n' + c.text)
    .join('\n\n---\n\n');

  return {
    contesto,
    fontiUsate: [...new Set(selezionati.map(c => c.file))],
    filesDisponibili: fontiDisponibili,
    chunks: selezionati.length
  };
}

// ── Ticket storage ──────────────────────────────────────────────────────────

function leggiTickets() {
  try { return JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf8')); }
  catch { fs.writeFileSync(TICKETS_FILE, '[]', 'utf8'); return []; }
}

function salvaTickets(tickets) {
  fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2), 'utf8');
  notificaSSE(tickets);
}

function nuovoTicket(dati) {
  const tickets = leggiTickets();
  const id = 'T' + String(tickets.length + 1).padStart(3, '0');
  const ticket = {
    id,
    timestamp:     new Date().toISOString(),
    condomino:     dati.condomino     || 'Condòmino',
    initials:      iniziali(dati.condomino || 'Condòmino'),
    condominio:    dati.condominio    || 'Condominio',
    messaggio:     dati.messaggio     || '',
    categoria:     dati.categoria     || 'informativa',
    priorita:      dati.priorita      || 'normale',
    stato:         dati.stato         || 'aperta',
    gestitoDa:     dati.gestitoDa     || 'AI',
    esitoGestione: dati.esitoGestione || (dati.gestitoDa === 'AI' ? 'risolto_da_ai' : 'inoltrato_amministratore'),
    rispostaAI:    dati.rispostaAI    || null,
    fonti:         dati.fonti         || [],
    noteAdmin:     null,
    conversazione: dati.conversazione || []
  };
  tickets.unshift(ticket);
  salvaTickets(tickets);
  return ticket;
}

function iniziali(nome) {
  return nome.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

// ── SSE ─────────────────────────────────────────────────────────────────────

const sseClients = new Set();

function notificaSSE(tickets) {
  const kpi     = calcolaKPI(tickets);
  const payload = JSON.stringify({ tickets, kpi });
  for (const res of sseClients) {
    try { res.write('event: update\ndata: ' + payload + '\n\n'); }
    catch { sseClients.delete(res); }
  }
}

function calcolaKPI(tickets) {
  const oggi       = new Date().toDateString();
  const totali     = tickets.length;
  const gestiteAI  = tickets.filter(t => t.gestitoDa === 'AI' && (t.stato === 'chiusa' || t.stato === 'chiusa_admin')).length;
  const urgenti    = tickets.filter(t => t.priorita === 'urgente' && t.stato === 'aperta').length;
  const inAttesa   = tickets.filter(t => t.stato === 'aperta' || t.stato === 'in_gestione').length;
  const oggi_count = tickets.filter(t => new Date(t.timestamp).toDateString() === oggi).length;
  const percentuale = totali > 0 ? Math.round((gestiteAI / totali) * 100) : 0;
  const cat = { segnalazione: 0, amministrativa: 0, documentale: 0, informativa: 0 };
  for (const t of tickets) if (cat[t.categoria] !== undefined) cat[t.categoria]++;
  return { totali, gestiteAI, urgenti, inAttesa, oggi_count, percentuale, categorie: cat };
}

// ── Groq ─────────────────────────────────────────────────────────────────────

async function chiamaGroq(messaggi, json) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY non configurata. Aggiungila come variabile d\'ambiente.');
  const body = {
    model: GROQ_MODEL,
    messages: messaggi,
    stream: false,
    temperature: 0.1
  };
  if (json) body.response_format = { type: 'json_object' };
  const r = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + GROQ_API_KEY
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('Groq errore ' + r.status + ': ' + await r.text());
  const data = await r.json();
  return data.choices[0].message.content;
}

// ── Classificazione ──────────────────────────────────────────────────────────

async function classificaMessaggio(messaggio) {
  const prompt = 'Sei un assistente per studi di amministrazione condominiale.\n' +
    'Analizza questo messaggio di un condomino e rispondi SOLO con JSON valido.\n\n' +
    'Messaggio: "' + messaggio + '"\n\n' +
    'Rispondi con questo JSON:\n' +
    '{"categoria":"documentale|amministrativa|informativa|segnalazione","priorita":"urgente|alta|normale|bassa","autoRispondi":true,"motivazione":"breve"}\n\n' +
    'Regole categoria: documentale=verbali/regolamenti, amministrativa=rate/pagamenti, informativa=domande generali, segnalazione=problemi fisici\n' +
    'Regole priorita: urgente=emergenze fisiche, alta=problemi che peggiorano, normale=standard, bassa=non urgente\n' +
    'autoRispondi=true se risposta e in documenti o FAQ standard; false se richiede decisione professionale o segnalazione urgente';
  try {
    const raw = await chiamaGroq([{ role: 'user', content: prompt }], true);
    return JSON.parse(raw);
  } catch {
    return { categoria: 'informativa', priorita: 'normale', autoRispondi: false, motivazione: 'fallback: classificazione non sicura' };
  }
}

// ── Risposta AI ──────────────────────────────────────────────────────────────

function fallbackEscalationAI(motivo) {
  return {
    puoRispondere: false,
    sicurezza: 'bassa',
    risposta: 'Grazie per averci scritto! Non ho elementi documentali sufficienti per risponderti con certezza in questo momento: provvederò a inoltrare la tua richiesta all\'amministratore, che ti darà riscontro il prima possibile.',
    motivazione: motivo || 'informazione non certa',
    fonti: []
  };
}

async function generaRispostaAI(messaggio, documenti, history, fontiUsate = [], nomeCondomino = '') {
  const saluto = nomeCondomino
    ? `Inizia SEMPRE la risposta con un saluto cordiale usando il nome dell'utente, ad esempio "Ciao ${nomeCondomino}," oppure "Buongiorno ${nomeCondomino},". Mantieni un tono caldo e amichevole per tutta la risposta.\n`
    : 'Inizia SEMPRE la risposta con un saluto cordiale (es. "Buongiorno," o "Ciao,"). Mantieni un tono caldo e amichevole per tutta la risposta.\n';
  const system = 'Sei l\'assistente digitale di uno studio di amministrazione condominiale.\n' +
    'Devi rispondere SOLO se il CONTESTO DOCUMENTALE contiene informazioni sufficienti e specifiche per dare una risposta affidabile.\n' +
    'Se l\'informazione non e presente, e ambigua, incompleta o non sei sicuro, NON devi rispondere nel merito: devi impostare puoRispondere=false e dire che inoltrerai la richiesta all\'amministratore.\n' +
    'Non inventare, non usare conoscenza generale per sostituire i documenti, non chiudere domande dubbie.\n' +
    'Quando rispondi nel merito, cita il nome del file sorgente in forma testuale, ad esempio: Fonte: nomefile.docx.\n' +
    saluto +
    'Tono cordiale, caldo e user-friendly. Italiano. Evita asterischi inutili.\n\n' +
    'Devi rispondere SOLO con JSON valido, senza testo prima o dopo, con questa struttura:\n' +
    '{"puoRispondere":true,"sicurezza":"alta|media|bassa","risposta":"testo per il condomino","motivazione":"breve motivo","fonti":["nomefile.docx"]}\n\n' +
    'Regole obbligatorie:\n' +
    '- puoRispondere=true solo se la risposta e chiaramente supportata dal contesto.\n' +
    '- sicurezza=alta o media solo se il contesto contiene dati sufficienti.\n' +
    '- se sicurezza=bassa, puoRispondere deve essere false.\n' +
    '- se puoRispondere=false, la risposta deve dire che la richiesta viene inoltrata all\'amministratore.\n\n' +
    'FONTI DISPONIBILI: ' + (fontiUsate.length ? fontiUsate.join(', ') : 'nessuna') + '\n\n' +
    'CONTESTO DOCUMENTALE:\n' + (documenti || '[Nessun contesto documentale disponibile]');

  const messaggi = [{ role: 'system', content: system }, ...(history || []).slice(-6), { role: 'user', content: messaggio }];

  try {
    const raw = await chiamaGroq(messaggi, true);
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    return {
      puoRispondere: parsed.puoRispondere === true,
      sicurezza: parsed.sicurezza || 'bassa',
      risposta: parsed.risposta || '',
      motivazione: parsed.motivazione || '',
      fonti: Array.isArray(parsed.fonti) ? parsed.fonti : []
    };
  } catch (err) {
    console.error('[AI] Risposta non valida o non parsabile:', err.message);
    return fallbackEscalationAI('risposta AI non validabile');
  }
}

function rispostaGestibileDaAI(rispostaAI) {
  if (!rispostaAI || rispostaAI.puoRispondere !== true) return false;

  const sicurezza = String(rispostaAI.sicurezza || '').toLowerCase().trim();
  const risposta = String(rispostaAI.risposta || '').toLowerCase();

  const sicurezzaOk = sicurezza.includes('alta') || sicurezza.includes('media');
  const haRisposta = risposta.trim().length > 20;

  // Protezione: se il testo generato dice di inoltrare, non può essere considerato risolto da AI.
  const sembraEscalation =
    risposta.includes('inoltro') ||
    risposta.includes('inoltrata') ||
    risposta.includes('amministratore ti') ||
    risposta.includes('amministratore la') ||
    risposta.includes('non ho elementi') ||
    risposta.includes('non posso rispondere') ||
    risposta.includes('non sono in grado');

  return sicurezzaOk && haRisposta && !sembraEscalation;
}

// ── Endpoints ────────────────────────────────────────────────────────────────

app.get('/api/status', async (req, res) => {
  try {
    if (!GROQ_API_KEY) {
      return res.json({ online: false, modelloCorrente: GROQ_MODEL, errore: 'GROQ_API_KEY non configurata' });
    }
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': 'Bearer ' + GROQ_API_KEY }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const json = await r.json();
    const modelli = (json.data || []).map(m => m.id);
    res.json({ online: true, modelloCorrente: GROQ_MODEL, modelloPresente: modelli.some(m => m.includes('llama')), provider: 'Groq' });
  } catch (err) {
    res.json({ online: false, modelloCorrente: GROQ_MODEL, modelloPresente: false, errore: err.message });
  }
});

app.get('/api/docs', (req, res) => {
  try {
    const files = fs.readdirSync(RAW_DIR)
      .filter(f => ['.pdf', '.docx', '.txt', '.md'].includes(path.extname(f).toLowerCase()))
      .map(f => {
        const s = fs.statSync(path.join(RAW_DIR, f));
        return { nome: f, dimensione: Math.round(s.size / 1024) + ' KB', data: s.mtime.toLocaleDateString('it-IT') };
      });
    res.json({ files });
  } catch (err) { res.status(500).json({ errore: err.message }); }
});

app.post('/api/upload', upload.single('documento'), (req, res) => {
  if (!req.file) return res.status(400).json({ errore: 'Nessun file ricevuto.' });
  res.json({ ok: true, nome: req.file.filename });
});

app.delete('/api/docs/:nome', (req, res) => {
  const fp = path.join(RAW_DIR, path.basename(req.params.nome));
  if (!fs.existsSync(fp)) return res.status(404).json({ errore: 'File non trovato.' });
  fs.unlinkSync(fp);
  res.json({ ok: true });
});

// Chat condòmino (workflow completo)
let isBusy = false;

app.post('/api/chat', async (req, res) => {
  if (isBusy) return res.status(429).json({ errore: 'Attendi la risposta precedente...' });
  const { messaggio, condomino, condominio, history = [] } = req.body;
  if (!messaggio || !messaggio.trim()) return res.status(400).json({ errore: 'Messaggio mancante.' });

  isBusy = true;
  const inizio = Date.now();
  try {
    const rag = await costruisciContestoDocumenti(messaggio);
    const docsFiles = rag.filesDisponibili;
    const documenti = rag.contesto;
    const classificazione = await classificaMessaggio(messaggio);

    console.log('[RAG] File disponibili:', docsFiles.length, '| Fonti usate:', rag.fontiUsate.join(', ') || 'nessuna', '| Chunks:', rag.chunks, '| Caratteri:', documenti.length);

    let rispostaFinale, statoTicket, gestitoDa, esitoGestione;

    // La classificazione serve per categoria/priorità, NON per decidere da sola
    // se chiudere o inoltrare. La chiusura dipende dalla capacità effettiva
    // dell'AI di trovare una risposta supportata dai documenti.
    if (documenti && documenti.trim()) {
      const rispostaAI = await generaRispostaAI(messaggio, documenti, history, rag.fontiUsate, condomino);
      const risoltaDaAI = rispostaGestibileDaAI(rispostaAI);

      if (risoltaDaAI) {
        rispostaFinale = rispostaAI.risposta;
        statoTicket    = 'chiusa';
        gestitoDa      = 'AI';
        esitoGestione  = 'risolto_da_ai';
      } else {
        rispostaFinale = rispostaAI.risposta || fallbackEscalationAI('risposta non sicura').risposta;
        statoTicket    = 'aperta';
        gestitoDa      = 'Amministratore';
        esitoGestione  = 'inoltrato_amministratore';
      }

      console.log('[AI] Sicurezza:', rispostaAI.sicurezza, '| puoRispondere:', rispostaAI.puoRispondere, '| risoltaDaAI:', risoltaDaAI, '| Ticket:', statoTicket, '| Motivo:', rispostaAI.motivazione || 'n/d');

    } else {
      const salutoFallback = condomino ? `Gentile ${condomino}, ` : 'Gentile condomino, ';
      rispostaFinale = salutoFallback + "grazie per averci scritto. Non ho trovato nei documenti elementi sufficienti per risponderti con certezza: inoltrerò la tua richiesta all'amministratore, che ti risponderà a breve.";
      statoTicket    = 'aperta';
      gestitoDa      = 'Amministratore';
      esitoGestione  = 'inoltrato_amministratore';
    }

    const ticket = nuovoTicket({
      condomino, condominio, messaggio,
      categoria:     classificazione.categoria,
      priorita:      classificazione.priorita,
      stato:         statoTicket,
      gestitoDa,
      esitoGestione,
      fonti:         rag.fontiUsate,
      rispostaAI:    rispostaFinale,
      conversazione: [...history, { role: 'user', content: messaggio }, { role: 'assistant', content: rispostaFinale }]
    });

    res.json({ risposta: rispostaFinale, ticket: ticket.id, categoria: classificazione.categoria, priorita: classificazione.priorita, stato: statoTicket, gestitoDa, esitoGestione, autoGestita: statoTicket === 'chiusa', documentiLetti: docsFiles, fontiUsate: rag.fontiUsate, chunksUsati: rag.chunks, durataMs: Date.now() - inizio });

  } catch (err) {
    console.error('Errore chat:', err.message);
    let msg = err.message;
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch')) {
      msg = 'Servizio AI non raggiungibile. Verifica la configurazione del server.';
    }
    res.status(500).json({ errore: msg });
  } finally {
    isBusy = false;
  }
});

// Tickets
app.get('/api/tickets', (req, res) => {
  const t = leggiTickets();
  res.json({ tickets: t, kpi: calcolaKPI(t) });
});

app.get('/api/tickets/:id', (req, res) => {
  const ticket = leggiTickets().find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ errore: 'Ticket non trovato.' });
  res.json(ticket);
});

app.patch('/api/tickets/:id', (req, res) => {
  const tickets = leggiTickets();
  const idx     = tickets.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ errore: 'Ticket non trovato.' });
  const { stato, noteAdmin, gestitoDa, rispostaAdmin } = req.body;
  if (stato)         tickets[idx].stato          = stato;
  if (noteAdmin)     tickets[idx].noteAdmin       = noteAdmin;
  if (gestitoDa)     tickets[idx].gestitoDa       = gestitoDa;
  if (rispostaAdmin) {
    tickets[idx].rispostaAdmin   = rispostaAdmin;
    tickets[idx].rispostaAdminAt = new Date().toISOString();
    tickets[idx].stato           = 'chiusa_admin';
  }
  tickets[idx].aggiornatoAt = new Date().toISOString();
  salvaTickets(tickets);
  res.json(tickets[idx]);
});

app.delete('/api/tickets', (req, res) => {
  salvaTickets([]);
  res.json({ ok: true });
});

// SSE live
app.get('/api/tickets-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.add(res);
  const tickets = leggiTickets();
  res.write('event: update\ndata: ' + JSON.stringify({ tickets, kpi: calcolaKPI(tickets) }) + '\n\n');
  const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch { clearInterval(ka); } }, 25000);
  req.on('close', () => { sseClients.delete(res); clearInterval(ka); });
});

// Avvio
app.listen(PORT, () => {
  console.log('\n✅ LLM Wiki Local — Workflow CondoCare');
  console.log('   http://localhost:' + PORT);
  console.log('   Provider: Groq | Modello: ' + GROQ_MODEL);
  console.log('   API Key configurata: ' + (GROQ_API_KEY ? 'Sì' : '⚠️  NO — imposta GROQ_API_KEY'));
  console.log('   Documenti in: ' + RAW_DIR + '\n');
});
