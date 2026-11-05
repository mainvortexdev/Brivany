"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const ui = {
    preview: $("preview"), viewfinder: $("viewfinder"), empty: $("preview-empty"), audioPreview: $("audio-preview"),
    audioPlayer: $("audio-player"), camera: $("activate-camera"), audio: $("activate-audio"),
    record: $("record"), stop: $("stop"), timer: $("timer"), captureLabel: $("capture-label"),
    indicator: $("recording-indicator"), recordingState: $("recording-state"),
    captureMessage: $("capture-message"), playbackActions: $("playback-actions"),
    download: $("download"), discard: $("discard"), duration: $("duration"),
    durationNote: $("duration-note"), transcript: $("transcript"), goal: $("goal"),
    useMeta: $("use-meta"), consent: $("consent"), consentLabel: $("consent-label"),
    form: $("review-form"), evaluate: $("evaluate"), reviewMessage: $("review-message"),
  };
  let stream = null;
  let recorder = null;
  let recordingUrl = null;
  let recordingStarted = null;
  let timerHandle = null;
  let durationSource = "unknown";
  let cameraEnabled = false;
  let capturePending = false;
  let finishing = false;
  let disposed = false;
  let evaluating = false;
  let providerConfigured = false;

  function message(node, text, error = false) {
    node.textContent = text;
    node.classList.toggle("is-error", error);
  }

  function formatTime(seconds) {
    const whole = Math.floor(Math.max(0, seconds));
    return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  }

  function updateTimer() {
    if (recordingStarted === null) return;
    const elapsed = (performance.now() - recordingStarted) / 1000;
    ui.timer.textContent = formatTime(elapsed);
    if (elapsed >= 600) {
      stopCapture();
      message(ui.captureMessage, "El intento llegó a 10 minutos y se detuvo. Puedes guardarlo o preparar uno más breve.");
    }
  }

  function releaseTracks() {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    ui.preview.srcObject = null;
  }

  function revokeRecording() {
    ui.preview.pause();
    ui.audioPlayer.pause();
    ui.preview.removeAttribute("src");
    ui.audioPlayer.removeAttribute("src");
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl = null;
    ui.download.removeAttribute("href");
    ui.playbackActions.hidden = true;
    ui.audioPlayer.hidden = true;
  }

  function setCaptureButtons(state) {
    const active = state === "ready" || state === "recording";
    ui.camera.hidden = active || state === "finishing";
    ui.audio.hidden = active || state === "finishing";
    ui.camera.disabled = capturePending || evaluating;
    ui.audio.disabled = capturePending || evaluating;
    ui.record.hidden = state !== "ready";
    ui.record.disabled = !window.MediaRecorder || evaluating;
    ui.stop.hidden = !active;
    ui.stop.textContent = state === "recording" ? "■ Terminar intento" : "Apagar dispositivos";
    ui.indicator.classList.toggle("is-recording", state === "recording");
    if (state === "recording") {
      ui.captureLabel.textContent = "GRABANDO";
      ui.recordingState.textContent = "GRABACIÓN LOCAL";
    } else if (state === "ready") {
      ui.captureLabel.textContent = cameraEnabled ? "CÁMARA ACTIVA" : "MICRÓFONO ACTIVO";
      ui.recordingState.textContent = "LISTO PARA GRABAR";
    } else if (state === "finishing") {
      ui.captureLabel.textContent = "PREPARANDO REPRODUCCIÓN";
      ui.recordingState.textContent = "GRABACIÓN DETENIDA";
    } else {
      ui.captureLabel.textContent = recordingUrl ? "INTENTO GRABADO" : "CÁMARA APAGADA";
      ui.recordingState.textContent = recordingUrl ? "REPRODUCCIÓN LOCAL" : "VISTA PREVIA LOCAL";
    }
  }

  async function activateCapture(withCamera) {
    if (capturePending || finishing || evaluating || stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      message(ui.captureMessage, "Este navegador no permite capturar cámara o micrófono aquí. Abre el estudio en localhost con un navegador compatible. Puedes continuar con una transcripción manual.", true);
      return;
    }
    capturePending = true;
    setCaptureButtons("idle");
    message(ui.captureMessage, "Esperando tu permiso para activar los dispositivos…");
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({ video: withCamera ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } : false, audio: true });
      if (disposed) {
        nextStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = nextStream;
      cameraEnabled = withCamera;
      ui.preview.pause();
      ui.audioPlayer.pause();
      ui.audioPlayer.hidden = true;
      ui.preview.removeAttribute("src");
      ui.preview.controls = false;
      ui.preview.muted = true;
      ui.preview.classList.add("is-live");
      ui.viewfinder.classList.remove("is-playback");
      ui.preview.hidden = !withCamera;
      ui.empty.hidden = true;
      ui.audioPreview.hidden = withCamera;
      ui.audioPreview.querySelector("span:last-child").textContent = "Micrófono activo · cámara apagada";
      if (withCamera) {
        ui.preview.srcObject = stream;
        await ui.preview.play().catch(() => {});
      }
      ui.timer.textContent = "00:00";
      for (const track of stream.getTracks()) {
        track.addEventListener("ended", () => {
          if (stream) {
            stopCapture();
            message(ui.captureMessage, "Se interrumpió el acceso al dispositivo. La captura se detuvo.", true);
          }
        }, { once: true });
      }
      message(ui.captureMessage, window.MediaRecorder ? "Todo listo. Pulsa «Grabar intento» cuando quieras empezar." : "Puedes ver la cámara, pero este navegador no admite la grabación. Continúa con una transcripción manual.", !window.MediaRecorder);
      setCaptureButtons("ready");
    } catch (error) {
      releaseTracks();
      const permissionError = ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(error.name);
      message(ui.captureMessage, permissionError ? "No se concedió acceso. Puedes cambiar el permiso del navegador o continuar con una transcripción manual." : "No pudimos activar el dispositivo. Comprueba que esté conectado y que otra aplicación no lo esté utilizando.", true);
      setCaptureButtons("idle");
    } finally {
      capturePending = false;
      ui.camera.disabled = evaluating;
      ui.audio.disabled = evaluating;
    }
  }

  function preferredMime() {
    const candidates = cameraEnabled
      ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/mp4", "video/webm"]
      : ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type));
  }

  function startRecording() {
    if (!stream || finishing || evaluating || !window.MediaRecorder || recorder?.state === "recording") return;
    try {
      const mimeType = preferredMime();
      const nextRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      const isVideo = cameraEnabled;
      recorder = nextRecorder;
      nextRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      nextRecorder.addEventListener("stop", () => {
        if (disposed) return;
        finishing = false;
        releaseTracks();
        clearInterval(timerHandle);
        const blob = new Blob(chunks, { type: nextRecorder.mimeType || (isVideo ? "video/webm" : "audio/webm") });
        if (blob.size === 0) {
          ui.empty.hidden = false;
          ui.preview.hidden = true;
          ui.audioPreview.hidden = true;
          message(ui.captureMessage, "El navegador no generó una grabación. Puedes volver a intentarlo o continuar con tu transcripción.", true);
          setCaptureButtons("idle");
          return;
        }
        revokeRecording();
        recordingUrl = URL.createObjectURL(blob);
        ui.preview.classList.remove("is-live");
        ui.viewfinder.classList.add("is-playback");
        ui.empty.hidden = true;
        ui.preview.hidden = !isVideo;
        ui.audioPreview.hidden = isVideo;
        if (isVideo) {
          ui.preview.src = recordingUrl;
          ui.preview.muted = false;
          ui.preview.controls = true;
        } else {
          ui.audioPlayer.src = recordingUrl;
          ui.audioPlayer.hidden = false;
          ui.audioPreview.querySelector("span:last-child").textContent = "Intento grabado · dispositivos apagados";
        }
        const extension = blob.type.includes("mp4") ? (isVideo ? "mp4" : "m4a") : blob.type.includes("ogg") ? "ogg" : "webm";
        ui.download.href = recordingUrl;
        ui.download.download = `brivany-mi-intento.${extension}`;
        ui.playbackActions.hidden = false;
        recorder = null;
        setCaptureButtons("idle");
        message(ui.captureMessage, "Tu intento está listo para escucharlo. Los dispositivos están apagados; la grabación permanece en este navegador.");
      }, { once: true });
      nextRecorder.addEventListener("error", () => {
        stopCapture();
        message(ui.captureMessage, "Ocurrió un error al grabar. Revisa si se conservó una parte del intento antes de repetirlo.", true);
      });
      nextRecorder.start(1000);
      revokeRecording();
      // Revoking an older preview must not detach the current live stream.
      if (isVideo) ui.preview.srcObject = stream;
      ui.duration.value = "";
      durationSource = "unknown";
      markReviewStale();
      recordingStarted = performance.now();
      ui.timer.textContent = "00:00";
      timerHandle = setInterval(updateTimer, 200);
      ui.audioPreview.querySelector("span:last-child").textContent = "Micrófono activo · cámara apagada";
      setCaptureButtons("recording");
      message(ui.captureMessage, "Grabando tu intento. Objetivo: entre 60 y 90 segundos.");
      if (isVideo) ui.preview.play().catch(() => {});
    } catch {
      recorder = null;
      message(ui.captureMessage, "No fue posible iniciar la grabación. Puedes probar solo con micrófono o introducir tu transcripción.", true);
    }
  }

  function stopCapture() {
    if (finishing) return;
    if (recorder && recorder.state !== "inactive") {
      const elapsed = Math.min(600, Math.max(0.1, (performance.now() - recordingStarted) / 1000));
      ui.duration.value = elapsed.toFixed(1);
      durationSource = "recorded";
      ui.durationNote.textContent = "Duración medida durante esta grabación. Si la editas, se tratará como un dato manual.";
      ui.timer.textContent = formatTime(elapsed);
      recordingStarted = null;
      clearInterval(timerHandle);
      finishing = true;
      setCaptureButtons("finishing");
      recorder.stop();
      releaseTracks();
    } else {
      releaseTracks();
      ui.preview.hidden = true;
      ui.audioPreview.hidden = true;
      ui.empty.hidden = false;
      setCaptureButtons("idle");
      message(ui.captureMessage, "Los dispositivos están apagados.");
    }
  }

  function discardRecording() {
    if (recorder?.state === "recording" || finishing) return;
    releaseTracks();
    revokeRecording();
    ui.preview.hidden = true;
    ui.empty.hidden = false;
    ui.audioPreview.hidden = true;
    ui.viewfinder.classList.remove("is-playback");
    ui.timer.textContent = "00:00";
    if (durationSource === "recorded") {
      ui.duration.value = "";
      durationSource = "unknown";
      ui.durationNote.textContent = "Se completa al grabar, o puedes introducirla manualmente.";
    }
    setCaptureButtons("idle");
    message(ui.captureMessage, "La grabación se descartó. Tu transcripción permanece para que puedas seguir trabajando.");
  }

  async function loadStatus() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch("/api/status", { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("status");
      const status = await response.json();
      providerConfigured = false; // Modelo pospuesto por decisión de producto.
      ui.useMeta.disabled = !providerConfigured;
      $("provider-tag").textContent = providerConfigured ? "CONFIGURADO" : "MODO LOCAL";
      $("provider-tag").classList.toggle("is-ready", providerConfigured);
      $("provider-note").textContent = providerConfigured
        ? "Meta está configurado. Puedes elegir enviar tu transcripción; la conexión se comprueba al pedir sugerencias."
        : "Puedes revisar tu intento con la guía local. Las sugerencias de Meta estarán disponibles cuando se configure la conexión.";
    } catch {
      ui.useMeta.disabled = true;
      $("provider-tag").textContent = "SIN CONEXIÓN";
      $("provider-note").textContent = "No pudimos consultar el servicio local. Comprueba que Brivany esté en ejecución y recarga esta página.";
    } finally {
      clearTimeout(timeout);
    }
  }

  function fillList(id, values) {
    const list = $(id);
    list.replaceChildren();
    for (const value of Array.isArray(values) ? values : []) {
      const item = document.createElement("li");
      item.textContent = value;
      list.append(item);
    }
    return list.children.length;
  }

  function markReviewStale() {
    if ($("feedback-results").hidden || evaluating) return;
    $("feedback-results").hidden = true;
    $("feedback-empty").hidden = false;
    $("feedback-mode").textContent = "SIN EVALUAR";
    message(ui.reviewMessage, "Los datos del intento cambiaron. Solicita una nueva revisión cuando estés listo.");
  }

  function renderResult(result) {
    $("feedback-empty").hidden = true;
    $("feedback-results").hidden = false;
    const isMeta = result.mode === "meta";
    $("feedback-mode").textContent = isMeta ? "MELODI · META" : "GUÍA LOCAL";
    $("guidance-heading").textContent = isMeta ? "SUGERENCIAS DE MELODI · META" : "GUÍA LOCAL PARA PRACTICAR";
    const metrics = result.metrics || {};
    $("metric-duration").textContent = metrics.duration_seconds == null ? "—" : Number(metrics.duration_seconds).toLocaleString("es", { maximumFractionDigits: 1 });
    $("metric-words").textContent = metrics.word_count == null ? "—" : Number(metrics.word_count).toLocaleString("es");
    $("metric-pace").textContent = metrics.words_per_minute == null ? "—" : Math.round(metrics.words_per_minute).toLocaleString("es");
    const verdicts = { PASS: "CUMPLE", FAIL: "POR AJUSTAR", UNKNOWN: "SIN DATOS", NEEDS_REVIEW: "POR REVISAR" };
    const checks = $("checks");
    checks.replaceChildren();
    for (const check of result.checks || []) {
      const item = document.createElement("li");
      const heading = document.createElement("div");
      heading.className = "check-heading";
      const label = document.createElement("strong");
      label.textContent = check.label;
      const verdict = document.createElement("span");
      const key = Object.hasOwn(verdicts, check.verdict) ? check.verdict : "UNKNOWN";
      verdict.textContent = verdicts[key];
      verdict.className = `verdict-${key.toLowerCase()}`;
      heading.append(label, verdict);
      const reason = document.createElement("p");
      reason.textContent = check.reason;
      item.append(heading, reason);
      checks.append(item);
    }
    const guidance = result.guidance || {};
    $("guidance-message").textContent = guidance.message || "";
    $("strengths-section").hidden = fillList("strengths", guidance.strengths) === 0;
    $("improvements-section").hidden = fillList("improvements", guidance.improvements) === 0;
    $("next-exercise").textContent = guidance.next_exercise || "";
    fillList("evidence-notes", guidance.evidence_notes);
    $("provider-detail").textContent = isMeta && result.meta
      ? `Modelo: ${result.meta.model || "Meta"}. Las sugerencias se basan en texto; no analizan tu grabación ni acreditan dominio de la habilidad.`
      : "Guía local basada en reglas y preguntas de práctica. Este resultado no utiliza un modelo de IA ni acredita dominio de la habilidad.";
  }

  async function evaluatePractice(event) {
    event.preventDefault();
    if (evaluating) return;
    if (recorder?.state === "recording" || finishing) {
      message(ui.reviewMessage, "Termina tu grabación antes de revisar el intento.", true);
      return;
    }
    if (!ui.form.reportValidity()) return;
    const useMeta = providerConfigured && ui.useMeta.checked;
    if (useMeta && !ui.consent.checked) {
      message(ui.reviewMessage, "Confirma el envío de la transcripción a Meta o desactiva las sugerencias de Meta para usar la guía local.", true);
      ui.consent.focus();
      return;
    }
    if (useMeta && !ui.transcript.value.trim()) {
      message(ui.reviewMessage, "Añade una transcripción para que Melodi pueda trabajar sobre tus palabras.", true);
      ui.transcript.focus();
      return;
    }
    const duration = ui.duration.value === "" ? null : Number(ui.duration.value);
    if (duration !== null && (!Number.isFinite(duration) || duration <= 0 || duration > 600)) {
      message(ui.reviewMessage, "Introduce una duración mayor que cero y de hasta 600 segundos.", true);
      return;
    }
    evaluating = true;
    ui.evaluate.disabled = true;
    ui.evaluate.textContent = useMeta ? "Melodi está revisando tu intento…" : "Preparando tu revisión…";
    ui.camera.disabled = true;
    ui.audio.disabled = true;
    ui.record.disabled = true;
    document.body.classList.add("is-busy");
    message(ui.reviewMessage, useMeta ? "Enviando únicamente la transcripción, el objetivo y los datos de práctica a Meta…" : "Revisando las mediciones y preparando la guía local…");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 65000);
    try {
      const response = await fetch("/api/practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          transcript: ui.transcript.value,
          duration_seconds: duration,
          duration_source: duration === null ? "unknown" : durationSource === "unknown" ? "manual" : durationSource,
          context: document.querySelector('input[name="context"]:checked').value,
          goal: ui.goal.value,
          use_meta: useMeta,
          consent_to_send_transcript: useMeta && ui.consent.checked,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "No pudimos completar la revisión. Comprueba los datos e inténtalo de nuevo cuando estés listo.");
      renderResult(result);
      message(ui.reviewMessage, "Tu revisión está lista. Elige una mejora y prueba de nuevo con otro ejemplo.");
      if (window.matchMedia("(max-width: 720px)").matches) $("feedback-title").scrollIntoView({ behavior: "auto", block: "start" });
    } catch (error) {
      message(ui.reviewMessage, error.name === "AbortError"
        ? "La revisión tardó más de lo esperado. No se reintentó automáticamente. Comprueba la conexión antes de enviar otra solicitud."
        : error instanceof TypeError || error instanceof SyntaxError
          ? "No pudimos comunicarnos con el servicio local. Tu grabación y tu texto siguen en esta página."
          : error.message, true);
    } finally {
      clearTimeout(timeout);
      evaluating = false;
      ui.evaluate.disabled = false;
      ui.evaluate.textContent = "Revisar mi intento ↗";
      ui.camera.disabled = capturePending;
      ui.audio.disabled = capturePending;
      ui.record.disabled = !window.MediaRecorder;
      document.body.classList.remove("is-busy");
    }
  }

  ui.camera.addEventListener("click", () => activateCapture(true));
  ui.audio.addEventListener("click", () => activateCapture(false));
  ui.record.addEventListener("click", startRecording);
  ui.stop.addEventListener("click", stopCapture);
  ui.discard.addEventListener("click", discardRecording);
  ui.duration.addEventListener("input", () => {
    durationSource = ui.duration.value === "" ? "unknown" : "manual";
    ui.durationNote.textContent = durationSource === "manual" ? "Duración indicada manualmente; no verificada contra el archivo de grabación." : "Se completa al grabar, o puedes introducirla manualmente.";
    markReviewStale();
  });
  ui.transcript.addEventListener("input", markReviewStale);
  ui.goal.addEventListener("input", markReviewStale);
  document.querySelectorAll('input[name="context"]').forEach((input) => input.addEventListener("change", markReviewStale));
  ui.useMeta.addEventListener("change", () => {
    ui.consentLabel.hidden = !ui.useMeta.checked;
    ui.consent.checked = false;
  });
  ui.form.addEventListener("submit", evaluatePractice);
  window.addEventListener("pagehide", () => {
    disposed = true;
    clearInterval(timerHandle);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    releaseTracks();
    revokeRecording();
  });
  loadStatus();
})();
