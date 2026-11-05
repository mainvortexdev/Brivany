"""Contratos de arquitectura Brivany 0.1.0. No es un backend operativo.

Pydantic 2.x. Las comprobaciones de autorización, tiempo real, pertenencia y
procedencia deben implementarse en servicios y conectores; no las prueba un JSON.
"""
from __future__ import annotations

import hashlib
import json
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, JsonValue, model_validator

SemVer = Annotated[str, Field(pattern=r"^\d+\.\d+\.\d+$")]
Sha256 = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Slug = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_.-]*$", max_length=120)]
Scalar = str | int | float | bool
Mode = Literal["coach", "demonstrate", "assist", "assess"]
HelpLevel = Literal["guided", "hinted", "independent"]
Verdict = Literal["PASS", "FAIL", "UNKNOWN", "NEEDS_REVIEW"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Source(Contract):
    source_id: Slug
    kind: Literal["creator_recording", "expert_note", "manual_reference"]
    artifact_id: UUID
    sha256: Sha256
    license: str = Field(min_length=1)


class SourceSpan(Contract):
    source_id: Slug
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def ordered(self):
        if (self.start_ms is None) != (self.end_ms is None):
            raise ValueError("Un tramo necesita inicio y fin")
        if self.start_ms is not None and self.end_ms <= self.start_ms:
            raise ValueError("El fin debe ser posterior al inicio")
        return self


class ParameterSpec(Contract):
    type: Literal["string", "number", "integer", "boolean"]
    description: str = Field(min_length=1)
    default: Scalar
    unit: str | None = None
    minimum: float | None = None
    maximum: float | None = None

    @model_validator(mode="after")
    def valid_default(self):
        valid = {
            "string": isinstance(self.default, str),
            "boolean": type(self.default) is bool,
            "integer": type(self.default) is int,
            "number": type(self.default) in (int, float),
        }[self.type]
        if not valid:
            raise ValueError("El valor predeterminado no coincide con el tipo")
        if self.type not in ("number", "integer") and (self.minimum is not None or self.maximum is not None):
            raise ValueError("Los limites numericos requieren parametro numerico")
        if self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise ValueError("Rango invertido")
        if self.minimum is not None and self.default < self.minimum:
            raise ValueError("Predeterminado inferior al minimo")
        if self.maximum is not None and self.default > self.maximum:
            raise ValueError("Predeterminado superior al maximo")
        return self


class Compatibility(Contract):
    application: Slug
    connector_profile: Slug
    tested_versions: list[str] = Field(min_length=1)
    platforms: list[Literal["windows", "macos", "linux"]] = Field(min_length=1)
    required_capabilities: list[Slug] = Field(min_length=1)


class Check(Contract):
    check_id: Slug
    evaluator_kind: Literal["deterministic", "visual", "expert"]
    rubric: str = Field(min_length=1)
    capability: Slug | None = None
    signal_key: Slug | None = None
    comparison: Literal["eq", "present", "gte", "lte", "within"] | None = None
    expected: Scalar | None = None
    parameter_ref: Slug | None = None
    unit: str | None = None
    tolerance: float | None = Field(default=None, ge=0)
    on_missing: Literal["UNKNOWN"] = "UNKNOWN"

    @model_validator(mode="after")
    def coherent_rule(self):
        if self.evaluator_kind == "deterministic":
            if not self.capability or not self.signal_key or not self.comparison:
                raise ValueError("Faltan capacidad, senal u operador")
            if self.comparison != "present" and ((self.expected is None) == (self.parameter_ref is None)):
                raise ValueError("Indicar valor esperado o parametro, exclusivamente")
            if self.comparison == "present" and (self.expected is not None or self.parameter_ref is not None):
                raise ValueError("Presence no acepta un valor esperado")
            if self.comparison == "within" and self.tolerance is None:
                raise ValueError("La comparacion within requiere tolerancia")
            if self.comparison in ("gte", "lte", "within") and self.expected is not None and type(self.expected) not in (int, float):
                raise ValueError("La comparacion numerica requiere un numero")
            if self.comparison != "within" and self.tolerance is not None:
                raise ValueError("Solo within admite tolerancia")
        elif any(v is not None for v in (self.signal_key, self.comparison, self.expected, self.parameter_ref, self.tolerance)):
            raise ValueError("Una rubrica humana o visual no es una comparacion numerica")
        return self


class Step(Contract):
    step_id: Slug
    title: str = Field(min_length=1)
    intent: str = Field(min_length=1)
    instruction: str = Field(min_length=1)
    requires: list[Slug] = Field(default_factory=list)
    sources: list[SourceSpan] = Field(min_length=1)
    checks: list[Check] = Field(min_length=1)
    max_attempts: int = Field(default=3, ge=1, le=10)
    recovery_guidance: str = Field(min_length=1)


class ExpertReview(Contract):
    reviewer_id: UUID
    reviewed_at: AwareDatetime
    decision: Literal["approved", "changes_requested"]
    content_sha256: Sha256
    note: str = Field(min_length=1)


class TransferExercise(Contract):
    goal: str = Field(min_length=1)
    difference_from_example: str = Field(min_length=1)
    target_help_level: HelpLevel
    expert_review_required: bool


class SkillManifest(Contract):
    schema_version: Literal["0.1.0"] = "0.1.0"
    skill_id: UUID
    version: SemVer
    title: str = Field(min_length=1)
    domain: Literal["public_speaking", "video_editing", "color_grading", "cad", "3d_modeling", "physical"]
    objective: str = Field(min_length=1)
    prerequisites: list[str] = Field(default_factory=list)
    compatibility: Compatibility
    parameters: dict[Slug, ParameterSpec] = Field(default_factory=dict)
    sources: list[Source] = Field(min_length=1)
    steps: list[Step] = Field(min_length=1)
    transfer_exercise: TransferExercise
    visibility: Literal["private", "workspace"] = "private"
    lifecycle: Literal["draft", "in_review", "published", "deprecated", "revoked"]
    review: ExpertReview | None = None
    content_sha256: str = Field(default="", pattern=r"^([a-f0-9]{64})?$")
    is_example: bool = False

    def content_digest(self) -> str:
        content = self.model_dump(mode="json", exclude={"review", "lifecycle", "content_sha256"})
        raw = json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    @model_validator(mode="after")
    def coherent_manifest(self):
        step_ids = [step.step_id for step in self.steps]
        source_ids = [source.source_id for source in self.sources]
        if len(set(step_ids)) != len(step_ids) or len(set(source_ids)) != len(source_ids):
            raise ValueError("Identificadores de paso y fuente deben ser unicos")
        graph = {step.step_id: step.requires for step in self.steps}
        checks = []
        for step in self.steps:
            if len(set(step.requires)) != len(step.requires):
                raise ValueError("Dependencias repetidas")
            if any(dep not in graph for dep in step.requires):
                raise ValueError("Dependencia inexistente")
            if any(span.source_id not in source_ids for span in step.sources):
                raise ValueError("Fuente inexistente")
            for check in step.checks:
                checks.append(check.check_id)
                if check.parameter_ref and check.parameter_ref not in self.parameters:
                    raise ValueError("Parametro referenciado inexistente")
                if check.parameter_ref:
                    parameter = self.parameters[check.parameter_ref]
                    if check.comparison in ("gte", "lte", "within") and parameter.type not in ("integer", "number"):
                        raise ValueError("Comparacion numerica con parametro no numerico")
                    if check.unit != parameter.unit:
                        raise ValueError("Unidad de rubrica y parametro incompatibles")
                if check.capability and check.capability not in self.compatibility.required_capabilities:
                    raise ValueError("Capacidad no declarada en compatibilidad")
        if len(set(checks)) != len(checks):
            raise ValueError("Los identificadores de comprobacion deben ser unicos")
        visiting, visited = set(), set()

        def visit(node):
            if node in visiting:
                raise ValueError("Dependencias ciclicas")
            if node in visited:
                return
            visiting.add(node)
            for dep in graph[node]:
                visit(dep)
            visiting.remove(node)
            visited.add(node)

        for node in graph:
            visit(node)
        digest = self.content_digest()
        if self.content_sha256 and self.content_sha256 != digest:
            raise ValueError("Hash de contenido incorrecto")
        if self.lifecycle in ("published", "deprecated"):
            if not self.review or self.review.decision != "approved":
                raise ValueError("Publicar requiere revision aprobada")
            if self.review.content_sha256 != digest or self.content_sha256 != digest:
                raise ValueError("La revision no corresponde al contenido actual")
        return self


class Signal(Contract):
    key: Slug
    value: JsonValue
    unit: str | None = None
    provenance: Literal["native", "derived", "visual", "human"]


class Observation(Contract):
    observation_id: UUID
    workspace_id: UUID
    session_id: UUID
    device_id: UUID
    connector_id: Slug
    connector_version: SemVer
    application_version: str
    project_ref: str = Field(min_length=1)
    project_revision: str = Field(min_length=1)
    observed_at: AwareDatetime
    signals: list[Signal]
    artifact_ids: list[UUID] = Field(default_factory=list)

    @model_validator(mode="after")
    def unique_signals(self):
        keys = [s.key for s in self.signals]
        if len(set(keys)) != len(keys):
            raise ValueError("Senales duplicadas")
        return self


class Evidence(Contract):
    evidence_id: UUID
    workspace_id: UUID
    session_id: UUID
    step_id: Slug
    attempt: int = Field(ge=1)
    observation_id: UUID | None = None
    origin: Literal["native", "derived", "visual", "expert", "learner"]
    artifact_ids: list[UUID] = Field(default_factory=list)
    signal_keys: list[Slug] = Field(default_factory=list)
    recorded_at: AwareDatetime
    producer_id: str
    note: str

    @model_validator(mode="after")
    def provenance_present(self):
        if self.origin in ("native", "derived") and (not self.observation_id or not self.signal_keys):
            raise ValueError("Evidencia nativa necesita observacion y senales")
        return self


class Verification(Contract):
    verification_id: UUID
    workspace_id: UUID
    session_id: UUID
    step_id: Slug
    attempt: int = Field(ge=1)
    check_id: Slug
    evaluator_kind: Literal["deterministic", "visual", "expert"]
    evaluator_version: str
    verdict: Verdict
    evidence_ids: list[UUID]
    reason: str = Field(min_length=1)
    verified_at: AwareDatetime

    @model_validator(mode="after")
    def admissible_pass(self):
        if self.verdict == "PASS" and not self.evidence_ids:
            raise ValueError("PASS requiere evidencia")
        if self.verdict == "PASS" and self.evaluator_kind == "visual":
            raise ValueError("La opinion visual no produce PASS autoritativo en v0.1")
        return self


class ToolProposal(Contract):
    tool_name: Slug
    arguments: dict[str, JsonValue]
    rationale: str = Field(min_length=1)


class MelodiProposal(Contract):
    proposal_id: UUID
    session_id: UUID
    expected_session_revision: int = Field(ge=0)
    step_id: Slug
    intervention: Literal["explain", "ask", "propose_tool", "request_verification", "escalate"]
    message: str = Field(min_length=1)
    source_ids: list[Slug]
    missing_information: list[str] = Field(default_factory=list)
    tool: ToolProposal | None = None

    @model_validator(mode="after")
    def tool_consistent(self):
        if (self.intervention == "propose_tool") != (self.tool is not None):
            raise ValueError("La herramienta debe corresponder al tipo de intervencion")
        return self


class Command(Contract):
    command_id: UUID
    workspace_id: UUID
    session_id: UUID
    device_id: UUID
    tool: ToolProposal
    action_sha256: Sha256
    project_ref: str
    expected_project_revision: str
    expected_observation_id: UUID
    issued_at: AwareDatetime
    expires_at: AwareDatetime
    idempotency_key: str = Field(min_length=8, max_length=200)
    risk: Literal["low", "medium", "high"]
    reversibility: Literal["read_only", "reversible", "irreversible"]
    approval_required: bool
    authorization_ref: UUID | None = None
    state: Literal["proposed", "awaiting_approval", "authorized", "dispatched", "succeeded", "failed", "uncertain", "cancelled", "expired"]

    def action_digest(self) -> str:
        payload = {"tool": self.tool.model_dump(mode="json"), "project_ref": self.project_ref,
                   "expected_project_revision": self.expected_project_revision,
                   "device_id": str(self.device_id), "risk": self.risk,
                   "reversibility": self.reversibility}
        return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()

    @model_validator(mode="after")
    def guards(self):
        if self.expires_at <= self.issued_at:
            raise ValueError("El comando debe vencer despues de emitirse")
        if self.reversibility == "irreversible" and not self.approval_required:
            raise ValueError("Una accion irreversible requiere aprobacion especifica")
        if self.risk == "high" and not self.approval_required:
            raise ValueError("Una accion de alto riesgo requiere aprobacion especifica")
        if self.state in ("authorized", "dispatched", "succeeded") and not self.authorization_ref:
            raise ValueError("Falta referencia a autorizacion")
        if self.action_sha256 != self.action_digest():
            raise ValueError("Hash de accion incorrecto")
        return self


class Receipt(Contract):
    receipt_id: UUID
    command_id: UUID
    workspace_id: UUID
    session_id: UUID
    device_id: UUID
    state: Literal["succeeded", "failed", "uncertain"]
    project_revision_before: str
    project_revision_after: str | None = None
    observation_id: UUID | None = None
    recorded_at: AwareDatetime
    detail: str


class Event(Contract):
    event_id: UUID
    workspace_id: UUID
    session_id: UUID
    seq: int = Field(ge=1)
    type: Literal["session.started", "observation.accepted", "guidance.ready", "verification.completed", "command.requested", "command.completed", "session.paused", "session.completed", "session.cancelled"]
    occurred_at: AwareDatetime
    correlation_id: UUID
    payload: dict[str, JsonValue]


class SessionView(Contract):
    session_id: UUID
    workspace_id: UUID
    skill_id: UUID
    skill_version: SemVer
    skill_content_sha256: Sha256
    device_id: UUID
    mode: Mode
    help_level: HelpLevel
    state: Literal["created", "preflight", "active", "paused", "completed", "cancelled", "failed"]
    revision: int = Field(ge=0)
    parameters: dict[str, Scalar]
    step_states: dict[str, Literal["not_started", "active", "verified", "failed", "needs_review"]]


class ErrorResponse(Contract):
    code: str
    message: str
    request_id: UUID
    details: dict[str, JsonValue] = Field(default_factory=dict)


class JobView(Contract):
    job_id: UUID
    state: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    result: JsonValue = None


class Accepted(Contract):
    resource_id: UUID
    status: Literal["accepted"] = "accepted"


class ArtifactRequest(Contract):
    file_name: str = Field(min_length=1, pattern=r"^[^/\\]+$")
    mime_type: str
    size_bytes: int = Field(ge=1, le=536870912)
    sha256: Sha256
    purpose: Literal["source", "observation", "exercise", "result"]


class ArtifactUpload(Contract):
    artifact_id: UUID
    upload_url: str
    expires_at: AwareDatetime
    required_headers: dict[str, str]


class CaptureRequest(Contract):
    application: Slug
    artifact_ids: list[UUID] = Field(min_length=1)
    consent_ref: UUID
    title: str


class CompileRequest(Contract):
    capture_id: UUID
    target_domain: Literal["video_editing", "color_grading", "cad", "3d_modeling", "physical"]
    requested_objective: str


class DraftRequest(Contract):
    expected_revision: int = Field(ge=0)
    manifest: SkillManifest

    @model_validator(mode="after")
    def draft_only(self):
        if self.manifest.lifecycle != "draft" or self.manifest.review is not None:
            raise ValueError("El cliente solo puede crear un borrador sin revision atribuida")
        return self


class ReviewRequest(Contract):
    expected_revision: int = Field(ge=0)
    content_sha256: Sha256
    decision: Literal["approved", "changes_requested"]
    note: str


class PublishRequest(Contract):
    expected_revision: int = Field(ge=0)
    content_sha256: Sha256


class SessionRequest(Contract):
    skill_id: UUID
    skill_version: SemVer
    device_id: UUID
    mode: Mode = "coach"
    help_level: HelpLevel = "guided"
    parameters: dict[str, Scalar] = Field(default_factory=dict)


class TransitionRequest(Contract):
    expected_revision: int = Field(ge=0)
    action: Literal["pause", "resume", "cancel"]
    reason: str


class ModeRequest(Contract):
    expected_revision: int = Field(ge=0)
    mode: Mode


class VerifyRequest(Contract):
    expected_revision: int = Field(ge=0)
    step_id: Slug
    attempt: int = Field(ge=1)
    observation_ids: list[UUID] = Field(min_length=1)


class StepReviewRequest(Contract):
    expected_revision: int = Field(ge=0)
    step_id: Slug
    attempt: int = Field(ge=1)
    check_id: Slug
    evidence_ids: list[UUID] = Field(min_length=1)
    verdict: Literal["PASS", "FAIL", "NEEDS_REVIEW"]
    reason: str


class CommandRequest(Contract):
    expected_revision: int = Field(ge=0)
    expected_observation_id: UUID
    tool: ToolProposal


class DecisionRequest(Contract):
    action_sha256: Sha256
    decision: Literal["approve", "decline"]


class EventPage(Contract):
    events: list[Event]
    next_seq: int = Field(ge=0)


SCHEMA_MODELS = [
    SkillManifest, Observation, Evidence, Verification, MelodiProposal, Command,
    Receipt, Event, SessionView, ErrorResponse, JobView, Accepted, ArtifactRequest,
    ArtifactUpload, CaptureRequest, CompileRequest, DraftRequest, ReviewRequest,
    PublishRequest, SessionRequest, TransitionRequest, ModeRequest, VerifyRequest,
    StepReviewRequest, CommandRequest, DecisionRequest, EventPage,
]
