"""Experimental human-skill drafts extracted from media, not published expertise.

The source video remains evidence to review. Exercises are model proposals;
neither this schema nor a completed exercise certifies independent competence.
"""
from __future__ import annotations

import math
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


Short = Annotated[str, Field(min_length=1, max_length=600)]


class HumanSkillContract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False,
                              str_strip_whitespace=True)


class VideoEvidence(HumanSkillContract):
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(gt=0)
    observation: str = Field(min_length=1, max_length=900)
    modality: Literal["visual", "audio", "both"]

    @model_validator(mode="after")
    def ordered(self):
        if self.end_seconds <= self.start_seconds:
            raise ValueError("El tramo de evidencia necesita un final posterior al inicio.")
        return self


class SkillExercises(HumanSkillContract):
    guided: str = Field(min_length=1, max_length=900)
    hinted: str = Field(min_length=1, max_length=900)
    independent: str = Field(min_length=1, max_length=900)


class HumanSkillStep(HumanSkillContract):
    title: str = Field(min_length=1, max_length=160)
    instruction: str = Field(min_length=1, max_length=900)
    why: str = Field(min_length=1, max_length=600)
    evidence: VideoEvidence
    exercise: SkillExercises
    success_check: str = Field(min_length=1, max_length=600)
    common_mistake: str = Field(min_length=1, max_length=600)


class TransferExercise(HumanSkillContract):
    # Empty only for an insufficient-evidence result; validated at the root.
    instruction: str = Field(max_length=1200)
    success_check: str = Field(max_length=600)


class HumanSkillDraft(HumanSkillContract):
    status: Literal["ready", "insufficient_evidence"]
    reason: str = Field(max_length=900)
    title: str = Field(max_length=160)
    domain: Literal["communication", "languages", "learning", "creativity", "practical", "other"]
    objective: str = Field(max_length=600)
    summary: str = Field(max_length=1200)
    prerequisites: list[Short] = Field(max_length=6)
    steps: list[HumanSkillStep] = Field(max_length=6)
    transfer_exercise: TransferExercise
    limitations: list[Short] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def usable_or_insufficient(self):
        if self.status == "ready":
            if not self.steps or not all((self.title, self.objective, self.summary,
                                          self.transfer_exercise.instruction,
                                          self.transfer_exercise.success_check)):
                raise ValueError("Una propuesta utilizable necesita objetivo, pasos y transferencia.")
        elif self.steps or not self.reason:
            raise ValueError("Sin evidencia suficiente no se crean pasos; se explica qué falta.")
        return self


def validate_draft(data: dict, duration_seconds: float) -> HumanSkillDraft:
    if type(duration_seconds) not in (int, float) or not math.isfinite(duration_seconds) or duration_seconds <= 0:
        raise ValueError("Se necesita una duración de origen válida.")
    draft = HumanSkillDraft.model_validate(data)
    if any(step.evidence.end_seconds > duration_seconds for step in draft.steps):
        raise ValueError("Un tramo de evidencia queda fuera del video.")
    return draft


def human_skill_schema() -> dict:
    """JSON Schema with every object property required, no optional defaults."""
    schema = HumanSkillDraft.model_json_schema()

    def normalize(value):
        if isinstance(value, dict):
            value.pop("default", None)
            if value.get("type") == "object":
                value["additionalProperties"] = False
                value["required"] = list(value.get("properties", {}))
            for item in value.values():
                normalize(item)
        elif isinstance(value, list):
            for item in value:
                normalize(item)

    normalize(schema)
    return schema
