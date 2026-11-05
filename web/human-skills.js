"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const domains = { communication: "Comunicación", languages: "Idiomas", learning: "Aprendizaje", creativity: "Creatividad", practical: "Habilidad práctica", other: "Human skill" };
  let capabilities = { configured: false, max_bytes: 26214400, max_duration_seconds: 300 };
  let selected = null, selectionVersion = 0, currentSkill = null, stepIndex = 0;
  let currentJob = null, pollVersion = 0, pollTimer = null, creating = false, progressBusy = false, clipEnd = null;
  const node = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
  const time = seconds => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, "0")}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, "0")}`;
  function notice(text, error = false) { $("global-notice").textContent = text; $("global-notice").classList.toggle("error", error); }
  async function api(path, options = {}) {
    const response = await fetch(path, { cache: "no-store", ...options });
    let result; try { result = await response.json(); } catch { throw Error("No se pudo leer la respuesta de Brivany."); }
    if (!response.ok) throw Error(result.error?.message || "No se pudo completar la solicitud.");
    return result;
  }
  function setCreateEnabled() {
    const busy = creating || currentJob?.status === "processing";
    $("create-skill").disabled = busy || !selected || !capabilities.configured || capabilities.video_validation_available === false || !$("send-consent").checked;
    $("video-file").disabled = busy; $("learning-goal").disabled = busy; $("send-consent").disabled = busy;
    $("create-skill").textContent = busy ? "Creando tu skill…" : "Crear human-skill ↗";
  }
  async function waitForVideo(video) {
    if (video.readyState >= 1) return;
    await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); video.removeEventListener("loadedmetadata", ready); video.removeEventListener("error", fail); };
      const ready = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(Error("Este navegador no pudo abrir el video. Prueba con un MP4 compatible.")); };
      const timer = setTimeout(fail, 10000);
      video.addEventListener("loadedmetadata", ready, { once: true }); video.addEventListener("error", fail, { once: true });
    });
  }
  function releaseSelection() {
    $("upload-preview").pause(); $("source-video").pause(); clipEnd = null;
    for (const id of ["upload-preview", "source-video"]) { $(id).removeAttribute("src"); $(id).load(); $(id).hidden = true; }
    if (selected?.url) URL.revokeObjectURL(selected.url);
    selected = null; $("reselect-source").hidden = false;
  }
  async function chooseFile(file, forSource = false) {
    if (!file || creating || currentJob?.status === "processing") return;
    const version = ++selectionVersion; releaseSelection(); $("send-consent").checked = false;
    $("file-error").textContent = ""; $("source-notice").textContent = "";
    $("file-label").textContent = "Comprobando el video…"; setCreateEnabled();
    let url;
    try {
      if (!/\.mp4$/i.test(file.name) || (file.type && file.type !== "video/mp4")) throw Error("Elige un archivo de video MP4.");
      if (!file.size || file.size > capabilities.max_bytes) throw Error("El video debe ocupar como máximo 25 MiB.");
      url = URL.createObjectURL(file); $("upload-preview").src = url;
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
      await waitForVideo($("upload-preview"));
      const duration = $("upload-preview").duration;
      if (!Number.isFinite(duration) || duration <= 0 || duration > capabilities.max_duration_seconds) throw Error("Elige un fragmento de hasta 5 minutos.");
      if (version !== selectionVersion) { URL.revokeObjectURL(url); return; }
      selected = { file, url, sha256, duration }; url = null;
      $("file-label").textContent = file.name; $("file-meta").textContent = `${time(duration)} · ${(file.size / 1048576).toFixed(1)} MiB · MP4`;
      $("upload-preview").hidden = false; updateSource();
      if (forSource && currentSkill && currentSkill.source.sha256 !== sha256) {
        $("source-notice").textContent = "Este archivo no coincide con el video original de la skill. Las referencias permanecen desactivadas.";
      }
    } catch (error) {
      if (url) URL.revokeObjectURL(url);
      if (version !== selectionVersion) return;
      $("file-label").textContent = "Elige un video"; $("file-meta").textContent = "MP4 · hasta 5 min · 25 MiB";
      $("file-error").textContent = error.message;
      if (forSource) $("source-notice").textContent = error.message;
      $("upload-preview").removeAttribute("src"); $("upload-preview").load();
    } finally { if (version === selectionVersion) setCreateEnabled(); }
  }
  function updateSource() {
    if (!currentSkill) return;
    const matches = selected?.sha256 === currentSkill.source.sha256;
    $("source-video").hidden = !matches; $("reselect-source").hidden = matches;
    if (matches) {
      if ($("source-video").getAttribute("src") !== selected.url) $("source-video").src = selected.url;
      $("source-notice").textContent = "Video original comprobado. Las marcas de tiempo son aproximadas.";
    } else {
      $("source-video").pause(); $("source-video").removeAttribute("src"); $("source-video").load();
      $("source-notice").textContent = "El video original no se guarda con la skill. Vuelve a seleccionarlo para ver sus momentos.";
    }
  }
  function renderLibrary(skills) {
    const host = $("skill-library"); host.replaceChildren();
    $("library-count").textContent = skills.length ? `${skills.length} ${skills.length === 1 ? "skill" : "skills"}` : "";
    if (!skills.length) { host.append(node("p", "Tu primera skill empezará aquí.", "empty")); return; }
    for (const item of skills) {
      const button = node("button", undefined, "library-item"); button.type = "button";
      button.append(node("small", `${domains[item.domain] || "Human skill"} · BORRADOR`), node("h3", item.title || "Video por revisar"), node("p", item.objective || "La evidencia necesita revisión."));
      const completed = Array.isArray(item.completed_steps) ? item.completed_steps.length : Number(item.completed_steps) || 0;
      button.append(node("span", item.step_count ? `${completed} de ${item.step_count} pasos registrados · Abrir ↗` : "Ver análisis ↗"));
      button.addEventListener("click", () => openSkill(item.id)); host.append(button);
    }
  }
  async function loadLibrary({ recover = false } = {}) {
    const result = await api("/api/human-skills"); capabilities = { ...capabilities, ...result.capabilities };
    renderLibrary(result.skills || []); $("provider-notice").replaceChildren();
    if (!capabilities.configured) { $("provider-notice").append(document.createTextNode("Conecta Meta para crear tu primera skill. ")); const link = node("a", "Abrir ajustes ↗"); link.href = "/app?setup=meta"; $("provider-notice").append(link); }
    else if (capabilities.video_validation_available === false) $("provider-notice").textContent = "Este equipo necesita ffprobe para comprobar el video antes de enviarlo.";
    setCreateEnabled();
    if (recover && result.active_job) watchJob(result.active_job);
  }
  function jobPhase(job) {
    const phases = { queued: "Video recibido. Preparando el análisis…", validating: "Comprobando el archivo…", analyzing: "Leyendo imágenes, audio y técnica…", saving: "Guardando tu human-skill…", processing: "Analizando el video…" };
    return phases[job.phase] || job.phase || "Melodi está analizando el video…";
  }
  async function watchJob(job) {
    const version = ++pollVersion; clearTimeout(pollTimer); currentJob = job;
    $("job-panel").hidden = false; $("refresh-job").hidden = true; setCreateEnabled();
    const update = async () => {
      if (version !== pollVersion) return;
      $("job-phase").textContent = jobPhase(currentJob);
      if (currentJob.status === "complete") {
        $("job-panel").hidden = true; setCreateEnabled();
        notice(currentJob.reused ? "Recuperamos tu skill guardada. No se repitió el análisis." : "Tu human-skill está lista para revisar y practicar.");
        await loadLibrary(); if (currentJob.skill_id) await openSkill(currentJob.skill_id); return;
      }
      if (currentJob.status === "failed") {
        $("job-panel").hidden = true; notice(currentJob.error?.message || "No se pudo crear la skill. No repetimos el análisis automáticamente.", true); setCreateEnabled(); return;
      }
      pollTimer = setTimeout(async () => {
        try {
          const result = await api(`/api/human-skills/jobs/${encodeURIComponent(currentJob.id)}`);
          if (version !== pollVersion) return;
          currentJob = result.job; await update();
        } catch (error) { if (version === pollVersion) { $("job-phase").textContent = "No pudimos consultar el estado. El análisis puede seguir en curso."; $("refresh-job").hidden = false; notice(error.message, true); } }
      }, 1800);
    };
    try { await update(); } catch (error) { notice(error.message, true); $("refresh-job").hidden = false; }
  }
  async function createSkill(event) {
    event.preventDefault(); if ($("create-skill").disabled || !selected) return;
    const input = selected, goal = $("learning-goal").value.trim(); creating = true; setCreateEnabled(); notice("Enviando el video que seleccionaste…");
    try {
      const result = await api("/api/human-skills/jobs", { method: "POST", headers: {
        "Content-Type": "video/mp4", "X-Brivany-Consent": "true", "X-Brivany-Metadata": encodeURIComponent(JSON.stringify({ filename: input.file.name, goal })) }, body: input.file });
      $("send-consent").checked = false; creating = false; await watchJob(result.job);
    } catch (error) { notice(error.message, true); }
    finally { creating = false; setCreateEnabled(); }
  }
  async function openSkill(id) {
    try {
      const result = await api(`/api/human-skills/${encodeURIComponent(id)}`); currentSkill = result.skill; stepIndex = 0;
      $("upload-preview").pause(); $("create-view").hidden = true; $("skill-view").hidden = false;
      renderSkill(); $("skill-title").setAttribute("tabindex", "-1"); $("skill-title").focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: "auto" });
    } catch (error) { notice(error.message, true); }
  }
  function fillList(id, values, emptyText) {
    const host = $(id); host.replaceChildren();
    for (const text of values.length ? values : [emptyText]) host.append(node("li", text));
  }
  function renderSkill() {
    const draft = currentSkill.draft, ready = draft.status === "ready" && draft.steps.length > 0;
    $("skill-title").textContent = draft.title || "Un video por explorar."; $("skill-objective").textContent = draft.objective || draft.reason;
    $("skill-summary").textContent = draft.summary || draft.reason;
    $("source-filename").textContent = `${currentSkill.source.filename} · ${time(currentSkill.source.duration_seconds)}`;
    fillList("prerequisites", draft.prerequisites || [], "No se indicaron requisitos adicionales.");
    fillList("limitations", draft.limitations || [], "Revisa la técnica y su relación con el video antes de practicar.");
    $("analysis-note").textContent = `${currentSkill.analysis.model} · ${Number.isInteger(currentSkill.analysis.usage?.total_tokens) ? currentSkill.analysis.usage.total_tokens.toLocaleString("es") + " tokens usados al crear" : "consumo no informado"}. Practicar estos ejercicios no consume Meta.`;
    $("insufficient-panel").hidden = ready; $("insufficient-reason").textContent = draft.reason;
    $("practice-content").hidden = !ready; $("transfer-panel").hidden = !ready;
    $("transfer-instruction").textContent = draft.transfer_exercise.instruction; $("transfer-check").textContent = draft.transfer_exercise.success_check;
    $("transfer-completed").checked = currentSkill.progress.transfer_completed; $("transfer-completed").disabled = progressBusy;
    updateSource(); if (ready) renderStep();
  }
  function renderStep() {
    if (!currentSkill?.draft.steps.length) return;
    const steps = currentSkill.draft.steps; stepIndex = Math.max(0, Math.min(stepIndex, steps.length - 1));
    const step = steps[stepIndex], level = $("help-level").value;
    $("step-counter").textContent = `PASO ${stepIndex + 1} DE ${steps.length}`;
    $("step-title").textContent = step.title; $("step-instruction").textContent = step.instruction;
    $("step-why").textContent = step.why; $("step-instruction").hidden = level === "independent"; $("step-why").hidden = level !== "guided";
    $("show-evidence").textContent = `${time(step.evidence.start_seconds)}–${time(step.evidence.end_seconds)} · Ver momento ↗`;
    $("evidence-observation").textContent = step.evidence.observation;
    $("evidence-observation").hidden = level === "independent";
    $("exercise-title").textContent = { guided: "Prueba esta técnica.", hinted: "Una pista para avanzar.", independent: "Ahora, a tu manera." }[level];
    $("exercise-instruction").textContent = step.exercise[level]; $("success-check").textContent = step.success_check; $("common-mistake").textContent = step.common_mistake;
    $("step-completed").checked = currentSkill.progress.completed_steps.includes(stepIndex); $("step-completed").disabled = progressBusy;
    $("previous-step").disabled = stepIndex === 0; $("next-step").disabled = stepIndex === steps.length - 1;
    $("progress-label").textContent = `${currentSkill.progress.completed_steps.length} de ${steps.length} practicados`;
  }
  async function saveProgress() {
    if (!currentSkill || progressBusy) return;
    const id = currentSkill.id, completed = new Set(currentSkill.progress.completed_steps);
    if ($("step-completed").checked) completed.add(stepIndex); else completed.delete(stepIndex);
    const body = { completed_steps: [...completed].sort((a, b) => a - b), transfer_completed: $("transfer-completed").checked };
    progressBusy = true; $("step-completed").disabled = true; $("transfer-completed").disabled = true; $("delete-skill").disabled = true;
    try {
      const result = await api(`/api/human-skills/${encodeURIComponent(id)}/progress`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (currentSkill?.id === id) { currentSkill = result.skill; notice("Práctica guardada. Este registro es tu autoevaluación."); }
    } catch (error) { notice(error.message, true); }
    finally { progressBusy = false; $("delete-skill").disabled = false; if (currentSkill?.id === id) renderSkill(); }
  }
  async function showEvidence() {
    if (!currentSkill?.draft.steps.length) return;
    if (selected?.sha256 !== currentSkill.source.sha256) {
      $("source-notice").textContent = "Selecciona el video original para abrir esta referencia."; $("source-file").focus(); $("reselect-source").scrollIntoView({ block: "center", behavior: "auto" }); return;
    }
    const skill = currentSkill, selectedSource = selected, span = skill.draft.steps[stepIndex].evidence, video = $("source-video");
    try {
      await waitForVideo(video); if (currentSkill !== skill || selected !== selectedSource) return;
      video.currentTime = Math.max(0, Math.min(span.start_seconds, video.duration)); clipEnd = Math.min(span.end_seconds, video.duration);
      video.scrollIntoView({ block: "center", behavior: "auto" }); await video.play();
    } catch { $("source-notice").textContent = "La referencia está seleccionada. Pulsa reproducir en el video."; }
  }
  function backToLibrary() { $("source-video").pause(); clipEnd = null; $("skill-view").hidden = true; $("create-view").hidden = false; currentSkill = null; loadLibrary().catch(error => notice(error.message, true)); window.scrollTo({ top: 0, behavior: "auto" }); }
  function exportSkill() {
    if (!currentSkill) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(currentSkill, null, 2)], { type: "application/json" }));
    const link = node("a"); link.href = url; link.download = `brivany-human-skill-${currentSkill.id}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function deleteSkill() {
    if (!currentSkill) return; const id = currentSkill.id; $("confirm-delete").disabled = true;
    try { await api(`/api/human-skills/${encodeURIComponent(id)}`, { method: "DELETE" }); $("delete-dialog").close(); backToLibrary(); notice("Skill eliminada de este equipo."); }
    catch (error) { $("delete-dialog").close(); notice(error.message, true); }
    finally { $("confirm-delete").disabled = false; }
  }
  $("video-file").addEventListener("change", event => chooseFile(event.target.files[0]));
  $("source-file").addEventListener("change", event => chooseFile(event.target.files[0], true));
  $("send-consent").addEventListener("change", setCreateEnabled); $("create-form").addEventListener("submit", createSkill);
  $("back-to-library").addEventListener("click", backToLibrary); $("help-level").addEventListener("change", renderStep);
  $("previous-step").addEventListener("click", () => { stepIndex--; renderStep(); }); $("next-step").addEventListener("click", () => { stepIndex++; renderStep(); });
  $("step-completed").addEventListener("change", saveProgress); $("transfer-completed").addEventListener("change", saveProgress);
  $("show-evidence").addEventListener("click", showEvidence); $("export-skill").addEventListener("click", exportSkill);
  $("delete-skill").addEventListener("click", () => $("delete-dialog").showModal()); $("cancel-delete").addEventListener("click", () => $("delete-dialog").close()); $("confirm-delete").addEventListener("click", deleteSkill);
  $("refresh-job").addEventListener("click", async () => { if (!currentJob) return; try { const result = await api(`/api/human-skills/jobs/${encodeURIComponent(currentJob.id)}`); watchJob(result.job); } catch (error) { notice(error.message, true); } });
  $("source-video").addEventListener("timeupdate", () => { if (clipEnd !== null && $("source-video").currentTime >= clipEnd) { $("source-video").pause(); clipEnd = null; } });
  for (const event of ["dragenter", "dragover"]) $("dropzone").addEventListener(event, e => { e.preventDefault(); $("dropzone").classList.add("dragging"); });
  for (const event of ["dragleave", "drop"]) $("dropzone").addEventListener(event, e => { e.preventDefault(); $("dropzone").classList.remove("dragging"); if (event === "drop") chooseFile(e.dataTransfer.files[0]); });
  window.addEventListener("pagehide", () => { clearTimeout(pollTimer); pollVersion++; releaseSelection(); });
  loadLibrary({ recover: true }).catch(error => notice(error.message, true));
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
