/* Núcleo puro: reglas locales, evidencia trazable y análisis orientativo. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BrivanyContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const normalize = text => String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const words = text => normalize(text).match(/[a-z0-9]+(?:'[a-z]+)?/g) || [];
  const stop = new Set("que como cuando donde cual quien para por porque esto esta este del las los una unos unas con sin sobre tengo hay can could would should what when where which who how the and is are was were do does you your we our to of in on a an el la de en un me mi es se si lo te al".split(" "));
  const tokens = text => new Set(words(text).filter(word => word.length > 2 && !stop.has(word)));

  function routeIntent(text, current = "practice") {
    const value = normalize(text);
    if (/\b(no|not|never)\b/.test(value)) return { mode: current, changed: false, reason: "El contexto no es inequívoco. Puedes elegir el modo." };
    let mode = current;
    if (/\b(reunion|meeting|entrevista|conferencia)\b/.test(value)) mode = "meeting";
    else if (/\b(ingles|english|traducir|traduccion|translate)\b/.test(value)) mode = "english";
    else if (/\b(practicar|ensayar|pitch|presentacion|camara|oratoria)\b/.test(value)) mode = "practice";
    return { mode, changed: mode !== current, reason: mode === current ? "Modo conservado." : "Seleccionado a partir del contexto que indicaste." };
  }

  function isQuestion(text) {
    const value = normalize(text).trim();
    return /[?¿]/.test(value) || /^(?:[a-z]+[, :]\s*)?(que|como|cuando|donde|cual|quien|cuanto|puedes|podrias|what|how|when|where|why|which|who|can you|could you|do you|would you)\b/.test(value);
  }

  // This is lexical retrieval over exact meeting quotations, not factual verification.
  const MEETING_TOPICS = [
    { id: "budget", label: "Cifras", pattern: /\b(presupuesto|budget|coste|costo|precio|importe|cost|price|euros|dolares|bolivianos|usd|bs)\b/ },
    { id: "dates", label: "Fechas", pattern: /\b(fecha|plazo|entrega|deadline|date|delivery|lunes|martes|miercoles|jueves|viernes|sabado|domingo|monday|tuesday|wednesday|thursday|friday|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/ },
    { id: "owners", label: "Responsables", pattern: /\b(responsable|encarga|encargado|encargada|asignado|asignada|owner|assigned|responsible)\b/ },
    { id: "decisions", label: "Acuerdos", pattern: /\b(acordamos|acordado|decidimos|decision|aprobado|aprobamos|acuerdo|agreed|decided|approved)\b/ },
    { id: "risks", label: "Pendientes", pattern: /\b(pendiente|riesgo|bloqueo|falta|risk|blocked|pending|blocker)\b/ },
  ];
  const meetingTopics = text => MEETING_TOPICS.filter(topic => topic.pattern.test(normalize(text)));
  function meetingTerms(text) {
    const terms = tokens(text);
    for (const topic of meetingTopics(text)) terms.add(`topic:${topic.id}`);
    if (/\b(cuando|when)\b/.test(normalize(text))) terms.add("topic:dates");
    if (/\b(quien|who)\b/.test(normalize(text))) terms.add("topic:owners");
    return terms;
  }
  function evidenceTerms(text) {
    const clauses = String(text).split(/(?<=[.!?])\s+|(?=¿)/u).filter(clause => clause.trim() && !isQuestion(clause));
    return clauses.length ? meetingTerms(clauses.join(" ")) : null;
  }

  const PHRASES = [
    { id: "repeat", english: "Could you repeat that, please?", spanish: "¿Podrías repetirlo, por favor?", use: "Pedir que repitan" },
    { id: "slower", english: "Could you speak a little more slowly?", spanish: "¿Podrías hablar un poco más despacio?", use: "Pedir un ritmo más lento" },
    { id: "clarify", english: "Could you clarify what you mean?", spanish: "¿Podrías aclarar a qué te refieres?", use: "Aclarar una idea" },
    { id: "moment", english: "Let me think about that for a moment.", spanish: "Déjame pensar en eso un momento.", use: "Tomarte una pausa" },
    { id: "check", english: "Let me check the information before I answer.", spanish: "Déjame comprobar la información antes de responder.", use: "Verificar antes de responder" },
    { id: "understood", english: "If I understand correctly, you mean…", spanish: "Si entendí bien, te refieres a…", use: "Comprobar que entendiste" },
  ];

  class ContextSession {
    constructor() { this.clear(); }
    clear() { this.mode = "practice"; this.entries = []; this.cards = []; this.sequence = 0; this.seen = new Set(); this.lastQuestion = null; this.index = new Map(); this.frequencies = new Map(); this.preview = null; this.board = []; }
    setIntent(text) { const choice = routeIntent(text, this.mode); this.mode = choice.mode; return choice; }
    setMode(mode) { if (!["practice", "meeting", "english"].includes(mode)) throw new Error("Invalid mode"); this.mode = mode; this.preview = null; }
    beginTurn() { this.preview = null; }
    support(text, question = {}) {
      const query = meetingTerms(text), history = this.entries.filter(item => this.index.has(item.id) && (!Number.isFinite(question.at) || item.at <= question.at));
      const ranked = history.map(item => {
        const terms = this.index.get(item.id) || new Set();
        const score = [...query].reduce((sum, word) => sum + (terms.has(word) ?
          word.startsWith("topic:") ? 4 : 1 + Math.log(1 + history.length / (1 + (this.frequencies.get(word) || 0))) : 0), 0);
        return { item, score };
      }).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score || b.item.at - a.item.at || b.item.id.localeCompare(a.item.id, undefined, { numeric: true })).slice(0, 2);
      return { question: { text, ...question }, excerpts: ranked.map(candidate => candidate.item),
        status: ranked.length ? "meeting_excerpts" : "needs_sources",
        message: ranked.length ? "Citas relacionadas de esta reunión. Comprueba su pertinencia."
          : "No hay una cita suficiente. Puedes decir: «Déjame comprobarlo antes de responder».",
        externalVerified: false, recipientConfirmed: false, spokenAutomatically: false };
    }
    previewQuestion(text, { id = "partial", at = 0 } = {}) {
      text = String(text).trim().slice(0, 3000);
      // Cumulative ASR hypotheses replace, rather than append to, the provisional card.
      // Never add them to history, the evidence index, or the prepared board.
      if (this.mode !== "meeting" || !isQuestion(text) || meetingTerms(text).size === 0) { this.preview = null; return null; }
      this.preview = { ...this.support(text, { id, at }), id: `preview-${id}`, provisional: true, turnId: id };
      return this.preview;
    }
    prepared() { return this.board; }
    prepare() {
      const recent = this.entries.filter(item => this.index.has(item.id)).slice().reverse();
      this.frequencies.clear();
      for (const terms of this.index.values()) for (const word of terms) this.frequencies.set(word, (this.frequencies.get(word) || 0) + 1);
      const displayed = new Set();
      this.board = MEETING_TOPICS.map(topic => {
        const matches = recent.filter(item => this.index.get(item.id)?.has(`topic:${topic.id}`));
        if (!matches.length || displayed.has(matches[0].id)) return null;
        displayed.add(matches[0].id);
        return { topic: topic.id, label: topic.label, excerpt: matches[0], previous: matches.length > 1 };
      }).filter(Boolean).slice(0, 3);
    }
    add(text, { id = null, at = 0, source = "manual", speaker = null } = {}) {
      text = String(text).trim().slice(0, 3000);
      if (!id || this.preview?.turnId === id) this.preview = null;
      if (!text || (id && this.seen.has(id))) return null;
      if (id) this.seen.add(id);
      if (this.seen.size > 300) this.seen.delete(this.seen.values().next().value);
      const entry = { id: `turn-${++this.sequence}`, text, at: Math.max(0, Number(at) || 0), source,
        speaker: source === "muse_transcription" && /^[A-Z]$/.test(speaker || "") ? speaker : "not_identified", isQuestion: isQuestion(text) };
      this.entries.push(entry);
      this.entries.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id, undefined, { numeric: true }));
      const terms = evidenceTerms(entry.text);
      if (terms) this.index.set(entry.id, terms);
      if (this.entries.length > 100) { const removed = this.entries.shift(); this.index.delete(removed.id); }
      this.prepare();
      // El contenido escuchado jamás cambia el modo ni autoriza voz o herramientas.
      if (this.mode === "meeting" && entry.isQuestion) {
        if (this.lastQuestion && this.lastQuestion.text === normalize(text) && Math.abs(entry.at - this.lastQuestion.at) < 10) return entry;
        this.lastQuestion = { text: normalize(text), at: entry.at };
        this.cards.push({ ...this.support(text, entry), id: `help-${entry.id}`, provisional: false });
        if (this.cards.length > 8) this.cards.shift();
      }
      return entry;
    }
    digest() { return this.entries.filter(item => !item.isQuestion).slice(-6); }
  }

  function analyzeFillers(text) {
    const value = normalize(text).slice(0, 12000);
    const groups = [
      ["eh / eeh", /\b(e+h+)\b/g], ["em / emm", /\b(e+m+)\b/g],
      ["este", /\beste\b/g], ["o sea", /\bo\s+sea\b/g], ["digamos", /\bdigamos\b/g],
      ["um / uh", /\b(u+m+|u+h+)\b/g], ["you know", /\byou\s+know\b/g], ["like", /\blike\b/g],
    ];
    const matches = groups.map(([label, pattern]) => ({ label, count: (value.match(pattern) || []).length })).filter(item => item.count);
    const repeated = (value.match(/\b([a-z]+)\s+\1\b/g) || []).length;
    return { matches, count: matches.reduce((total, item) => total + item.count, 0), repeated,
      wordCount: words(text).length,
      note: "Coincidencias léxicas, no errores confirmados. «Este» y «like» pueden ser parte del contenido. La transcripción puede omitir muletillas." };
  }

  class ActivityMeter {
    constructor(threshold = 0.025) { this.threshold = threshold; this.reset(); }
    reset() { this.last = null; this.activeMs = 0; this.totalMs = 0; this.silenceStart = null; this.seenActivity = false; this.pauses = []; this.onset = null; }
    sample(rms, at) {
      if (!Number.isFinite(rms) || !Number.isFinite(at)) return false;
      const delta = this.last === null ? 0 : Math.max(0, Math.min(at - this.last, 150));
      this.last = at; this.totalMs += delta;
      const active = rms >= this.threshold;
      if (active) {
        this.activeMs += delta;
        if (this.onset === null) this.onset = at;
        // Una sola muestra de ruido no cuenta como un turno.
        if (at - this.onset >= 180) {
          if (this.seenActivity && this.silenceStart !== null && this.onset - this.silenceStart >= 700) {
            this.pauses.push({ startMs: this.silenceStart, durationMs: this.onset - this.silenceStart });
          }
          this.seenActivity = true; this.silenceStart = null;
        }
      } else {
        this.onset = null;
        if (this.seenActivity && this.silenceStart === null) this.silenceStart = at;
      }
      return active;
    }
    summary() { return { activitySeconds: this.activeMs / 1000, measuredSeconds: this.totalMs / 1000,
      pauses: this.pauses.slice(-100), threshold: this.threshold,
      note: "Estimación de actividad acústica y silencios entre actividad. Puede incluir ruido u otras voces; no mide intención ni calidad." }; }
  }

  function coaching(text, variant = 0) {
    const result = analyzeFillers(text);
    const lead = ["Bien. Vamos paso a paso.", "A ver. Probemos algo sencillo.", "De acuerdo. Date un momento."][variant % 3];
    const tip = result.count ? `En el texto aparecen ${result.count} posibles muletillas. Revísalas en contexto. En tu siguiente intento, deja una pausa donde necesites pensar.`
      : "Elige una sola idea. Explícala con un ejemplo y termina con lo que quieres que recuerde tu audiencia.";
    return { text: `${lead} ${tip}`, segments: [{ text: lead, pauseAfter: 420 }, { text: tip, pauseAfter: 0 }], analysis: result };
  }
  return { normalize, routeIntent, isQuestion, ContextSession, analyzeFillers, ActivityMeter, PHRASES, coaching };
});
