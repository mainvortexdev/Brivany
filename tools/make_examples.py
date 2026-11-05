"""Ejemplos sinteticos de contratos; no representan llamadas ni proyectos reales."""
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from uuid import uuid5, NAMESPACE_URL
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "contracts"))
from models import SkillManifest, Command, ToolProposal


def uid(name):
    return str(uuid5(NAMESPACE_URL, "urn:brivany:example:" + name))


def save(name, value):
    folder = ROOT / "contracts" / "examples"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build():
    source = {"source_id": "expert-demo", "kind": "expert_note", "artifact_id": uid("source"),
              "sha256": sha256(b"SYNTHETIC EXAMPLE - no real recording").hexdigest(), "license": "Ejemplo sintético del contrato; no incluye un medio real"}
    skill = {
        "schema_version": "0.1.0", "skill_id": uid("blender-skill"), "version": "1.0.0",
        "title": "Configurar dimensiones de un objeto de práctica",
        "domain": "3d_modeling", "objective": "Configurar tres dimensiones en metros y comprobarlas con el conector.",
        "prerequisites": ["Reconocer selección y transformaciones básicas en Blender"],
        "compatibility": {"application": "blender", "connector_profile": "blender.example-only",
                          "tested_versions": ["example-version-not-homologated"], "platforms": ["windows"],
                          "required_capabilities": ["blender.object.read", "blender.object.dimensions.read"]},
        "parameters": {axis: {"type": "number", "description": f"Dimensión {axis} en metros", "default": value,
                              "unit": "m", "minimum": 0.01, "maximum": 100}
                       for axis, value in [("width", 2.0), ("depth", 1.0), ("height", 0.75)]},
        "sources": [source],
        "steps": [
            {"step_id": "select-object", "title": "Seleccionar el objeto", "intent": "Fijar el objeto que se va a modificar",
             "instruction": "Seleccionar el objeto de práctica y confirmar que pertenece al proyecto autorizado.",
             "requires": [], "sources": [{"source_id": "expert-demo"}],
             "checks": [{"check_id": "object-present", "evaluator_kind": "deterministic", "rubric": "Existe un objeto seleccionado en el proyecto autorizado",
                         "capability": "blender.object.read", "signal_key": "object.selected", "comparison": "eq", "expected": True}],
             "max_attempts": 3, "recovery_guidance": "Solicitar otra observación y volver a seleccionar el objeto correcto."},
            {"step_id": "dimensions", "title": "Aplicar las dimensiones", "intent": "Relacionar cada eje con la dimensión solicitada",
             "instruction": "Ajustar ancho, profundidad y altura según los parámetros del ejercicio; explicar la unidad utilizada.",
             "requires": ["select-object"], "sources": [{"source_id": "expert-demo"}],
             "checks": [{"check_id": f"dimension-{axis}", "evaluator_kind": "deterministic", "rubric": "Dimensión normalizada dentro de tolerancia",
                         "capability": "blender.object.dimensions.read", "signal_key": f"object.dimensions.{axis}",
                         "comparison": "within", "parameter_ref": parameter, "unit": "m", "tolerance": 0.001}
                        for axis, parameter in [("x", "width"), ("y", "depth"), ("z", "height")]],
             "max_attempts": 3, "recovery_guidance": "Comprobar objeto activo, escala de unidades y valor solicitado; no inferir dimensiones desde una imagen."},
        ],
        "transfer_exercise": {"goal": "Configurar otro objeto con dimensiones diferentes",
                              "difference_from_example": "Otro objeto, otras medidas y sin instrucciones completas",
                              "target_help_level": "independent", "expert_review_required": True},
        "visibility": "private", "lifecycle": "draft", "is_example": True,
    }
    draft = SkillManifest.model_validate(skill)
    skill = draft.model_dump(mode="json")
    skill["content_sha256"] = draft.content_digest()
    skill["review"] = {"reviewer_id": uid("synthetic-reviewer"), "reviewed_at": "2026-10-27T10:00:00Z",
                       "decision": "approved", "content_sha256": draft.content_digest(),
                       "note": "REVISIÓN SINTÉTICA para validar el contrato; no es aprobación profesional ni homologación real."}
    skill["lifecycle"] = "published"
    skill = SkillManifest.model_validate(skill).model_dump(mode="json")
    save("blender-dimensiones.skill.json", skill)

    color = deepcopy(skill)
    color.update(skill_id=uid("resolve-skill"), title="Preparar una corrección primaria revisada", domain="color_grading",
                 objective="Guiar una corrección primaria dentro de un contexto de color confirmado por un experto.",
                 prerequisites=["Uso básico de la página Color"], parameters={}, lifecycle="draft", review=None, content_sha256="")
    color["compatibility"] = {"application": "davinci-resolve", "connector_profile": "resolve.discovery-pending",
                              "tested_versions": ["version-to-be-tested"], "platforms": ["windows"],
                              "required_capabilities": ["resolve.project.read"]}
    color["steps"] = []
    for index, (sid, title, intent) in enumerate([
        ("confirm-context", "Confirmar el contexto de color", "Identificar material, configuración y objetivo antes de ajustar"),
        ("primary-adjustment", "Realizar la corrección primaria", "Aplicar el criterio explicado por el colorista al material de práctica"),
        ("review-result", "Revisar el resultado", "Separar cumplimiento técnico e intención estética"),
    ]):
        color["steps"].append({"step_id": sid, "title": title, "intent": intent,
                               "instruction": "Borrador: el experto debe completar el procedimiento y la rúbrica con material autorizado.",
                               "requires": [] if index == 0 else [color["steps"][-1]["step_id"]],
                               "sources": [{"source_id": "expert-demo"}],
                               "checks": [{"check_id": sid + "-review", "evaluator_kind": "expert", "rubric": "Pendiente de definir por el colorista antes de publicar"}],
                               "max_attempts": 3, "recovery_guidance": "Solicitar contexto o revisión; no suponer parámetros inaccesibles."})
    color["transfer_exercise"] = {"goal": "Resolver un segundo clip", "difference_from_example": "Material con exposición o iluminación diferente dentro del alcance revisado",
                                  "target_help_level": "hinted", "expert_review_required": True}
    color_model = SkillManifest.model_validate(color)
    color["content_sha256"] = color_model.content_digest()
    save("davinci-color.skill.json", SkillManifest.model_validate(color).model_dump(mode="json"))

    common = {"workspace_id": uid("workspace"), "session_id": uid("session")}
    observation = {**common, "observation_id": uid("observation"), "device_id": uid("device"),
                   "connector_id": "blender.example-only", "connector_version": "0.1.0", "application_version": "example-version-not-homologated",
                   "project_ref": "practice-project-example", "project_revision": "revision-1", "observed_at": "2026-10-27T10:01:00Z",
                   "signals": [{"key": "object.selected", "value": True, "unit": None, "provenance": "native"}] +
                              [{"key": f"object.dimensions.{axis}", "value": value, "unit": "m", "provenance": "derived"}
                               for axis, value in [("x", 2.0), ("y", 1.0), ("z", 0.75)]], "artifact_ids": []}
    save("observation.json", observation)
    evidence = {**common, "evidence_id": uid("evidence"), "step_id": "dimensions", "attempt": 1,
                "observation_id": uid("observation"), "origin": "derived", "artifact_ids": [],
                "signal_keys": ["object.dimensions.x"], "recorded_at": "2026-10-27T10:01:01Z",
                "producer_id": "example-connector", "note": "Ejemplo: lectura de dimensiones normalizada a metros"}
    save("evidence.json", evidence)
    save("verification.json", {**common, "verification_id": uid("verification"), "step_id": "dimensions", "attempt": 1,
                               "check_id": "dimension-x", "evaluator_kind": "deterministic", "evaluator_version": "numeric-within-0.1.0",
                               "verdict": "PASS", "evidence_ids": [uid("evidence")], "reason": "Ejemplo de comparación 2 m con parámetro 2 m, tolerancia 0.001 m",
                               "verified_at": "2026-10-27T10:01:02Z"})
    save("melodi-proposal.json", {"proposal_id": uid("proposal"), "session_id": uid("session"), "expected_session_revision": 3,
                                 "step_id": "dimensions", "intervention": "explain", "message": "Comprueba el eje de cada medida y la unidad de la escena. Después revisaremos los tres valores.",
                                 "source_ids": ["expert-demo"], "missing_information": [], "tool": None})
    command_data = {**common, "command_id": uid("command"), "device_id": uid("device"),
                    "tool": ToolProposal(tool_name="blender.object.inspect", arguments={"object_ref": "object-example"}, rationale="Leer propiedades para explicar el paso"),
                    "action_sha256": "0" * 64, "project_ref": "practice-project-example", "expected_project_revision": "revision-1",
                    "expected_observation_id": uid("observation"), "issued_at": datetime(2026, 10, 27, 10, 1, 1, tzinfo=timezone.utc),
                    "expires_at": datetime(2026, 10, 27, 10, 1, 5, tzinfo=timezone.utc), "idempotency_key": "example-inspection-command-0001",
                    "risk": "low", "reversibility": "read_only", "approval_required": False,
                    "authorization_ref": uid("read-session-grant"), "state": "authorized"}
    unvalidated = Command.model_construct(**command_data)
    command_data["action_sha256"] = unvalidated.action_digest()
    save("command.json", Command.model_validate(command_data).model_dump(mode="json"))
    save("receipt.json", {**common, "receipt_id": uid("receipt"), "command_id": uid("command"), "device_id": uid("device"),
                          "state": "succeeded", "project_revision_before": "revision-1", "project_revision_after": "revision-1",
                          "observation_id": uid("observation"), "recorded_at": "2026-10-27T10:01:02Z", "detail": "Ejemplo de lectura; no se ejecutó ninguna aplicación real"})
    save("event.json", {**common, "event_id": uid("event"), "seq": 4, "type": "verification.completed",
                        "occurred_at": "2026-10-27T10:01:02Z", "correlation_id": uid("correlation"),
                        "payload": {"verification_id": uid("verification"), "verdict": "PASS"}})
    save("session.json", {**common, "skill_id": skill["skill_id"], "skill_version": "1.0.0", "skill_content_sha256": skill["content_sha256"],
                          "device_id": uid("device"), "mode": "coach", "help_level": "guided", "state": "active", "revision": 3,
                          "parameters": {"width": 2.0, "depth": 1.0, "height": 0.75},
                          "step_states": {"select-object": "verified", "dimensions": "active"}})
    print("Generados 10 ejemplos sintéticos.")


if __name__ == "__main__":
    build()
