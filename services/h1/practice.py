"""Mediciones de una práctica; no certifica competencia ni analiza video."""
from __future__ import annotations

import re
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

SKILL_ID = "oratoria-pitch-90s"
SKILL_TITLE = "Explica una idea en público y frente a cámara"


class PracticeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)

    transcript: str = Field(default="", max_length=12000)
    duration_seconds: float | None = Field(default=None, ge=0.1, le=600)
    duration_source: Literal["recorded", "manual", "unknown"] = "unknown"
    context: Literal["camera", "public"] = "camera"
    goal: str = Field(default="Explicar una idea con un ejemplo y un cierre claro.", max_length=500)
    use_meta: bool = False
    consent_to_send_transcript: bool = False

    @model_validator(mode="after")
    def coherent(self):
        self.transcript = self.transcript.strip()
        self.goal = self.goal.strip()
        if (self.duration_seconds is None) != (self.duration_source == "unknown"):
            raise ValueError("La duración necesita una procedencia, o debe quedar desconocida.")
        if self.use_meta and (not self.transcript or not self.consent_to_send_transcript):
            raise ValueError("Meta requiere transcripción y consentimiento explícito.")
        return self


def inspect_practice(request: PracticeRequest) -> dict:
    # Conteo reproducible de unidades escritas, no detección acústica de palabras.
    words = re.findall(r"\b[^\W_]+(?:['’][^\W_]+)*\b", request.transcript, flags=re.UNICODE)
    duration = request.duration_seconds
    pace = round(len(words) * 60 / duration, 1) if duration and words else None
    duration_verdict = "UNKNOWN" if duration is None else ("PASS" if 60 <= duration <= 90 else "FAIL")
    duration_reason = (
        "No se indicó duración."
        if duration is None else
        f"{duration:g} s; objetivo de este ejercicio: 60–90 s. "
        + ("Cronómetro del navegador, sin verificar el contenido del video." if request.duration_source == "recorded"
           else "Duración declarada manualmente; no verificada con un archivo.")
    )
    checks = [
        {"id": "duration", "label": "Duración del intento", "verdict": duration_verdict, "reason": duration_reason},
        {"id": "structure", "label": "Idea, ejemplo y cierre", "verdict": "NEEDS_REVIEW" if words else "UNKNOWN",
         "reason": "Requiere valorar el contenido de la transcripción; el conteo no prueba claridad." if words
         else "Añade una transcripción para revisar el contenido."},
        {"id": "delivery", "label": "Voz y presencia", "verdict": "UNKNOWN",
         "reason": "Esta prueba no analiza audio, mirada, gestos, pausas ni entonación."},
        {"id": "transfer", "label": "Aprendizaje independiente", "verdict": "NEEDS_REVIEW",
         "reason": "Haz un segundo intento con otro tema o audiencia y menos ayuda; necesita revisión humana."},
    ]
    improvements = []
    if duration is None:
        improvements.append("Registra la duración para comparar este intento con el objetivo del ejercicio.")
    elif duration < 60:
        improvements.append("Prueba desarrollar un ejemplo concreto antes del cierre, sin añadir palabras solo para llenar tiempo.")
    elif duration > 90:
        improvements.append("Elige una idea central y un solo ejemplo para acercarte al tiempo del ejercicio.")
    if not words:
        improvements.append("Escribe o pega lo que dijiste. H1 todavía no transcribe la grabación automáticamente.")
    improvements.append("Al revisar tu discurso, identifica una idea central, un ejemplo y lo que quieres que recuerde tu audiencia.")
    return {
        "practice_id": str(uuid4()),
        "mode": "local",
        "metrics": {"duration_seconds": duration, "word_count": len(words), "words_per_minute": pace},
        "checks": checks,
        "guidance": {
            "message": "Guía local del ejercicio. Estas sugerencias siguen reglas fijas; todavía no son una respuesta de Meta.",
            "strengths": ["La duración indicada está dentro del objetivo de este ejercicio."] if duration_verdict == "PASS" else [],
            "improvements": improvements,
            "next_exercise": "Explica la misma idea a otra audiencia, o elige otro tema. Usa solo tres palabras de apoyo y vuelve a practicar durante 60–90 segundos.",
            "evidence_notes": [
                "El texto es una transcripción aportada por ti y puede diferir de la grabación.",
                "Las palabras por minuto son una estimación sobre el texto y la duración indicada; no califican tu acento ni tu capacidad.",
                "No hay una puntuación global ni una certificación de dominio.",
            ],
        },
        "meta": None,
    }


def meta_context(request: PracticeRequest, result: dict) -> dict:
    """Lista explícita de datos enviados: nunca cámara, audio, archivos o secretos."""
    return {
        "skill": SKILL_TITLE,
        "skill_status": "draft_pending_expert_review",
        "rubric": {
            "focus": ["idea central", "ejemplo concreto", "cierre acorde con la audiencia"],
            "exercise_duration_seconds": [60, 90],
            "transfer": "Otro tema o audiencia con menos ayuda.",
        },
        "context": request.context,
        "goal": request.goal,
        "transcript": request.transcript,
        "transcript_source": "user_supplied_not_automatic_transcription",
        "duration_source": request.duration_source,
        "metrics": result["metrics"],
        "limitations": ["No audio ni imágenes disponibles.", "No inferir emociones, personalidad, mirada, gestos, pausas ni entonación.",
                        "No confundir sugerencias con verificación de dominio.", "No penalizar acentos o variedades del idioma."],
    }
