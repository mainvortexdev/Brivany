"""Genera el borrador H1 desde una nota de producto local, sin fingir revisión."""
from hashlib import sha256
import json
from pathlib import Path
import sys
from uuid import NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "contracts"))
from models import SkillManifest

SOURCE = ROOT / "data" / "skills" / "oratoria-metodo-propuesto.md"
DESTINATION = ROOT / "contracts" / "examples" / "oratoria-camara.skill.json"


def build_manifest():
    uid = lambda name: str(uuid5(NAMESPACE_URL, "urn:brivany:h1:" + name))
    steps = []
    for step_id, title, instruction, rubric in [
        ("prepare", "Elegir audiencia e intención", "Escribe para quién hablas y la idea que quieres que recuerde.", "Revisar que audiencia, intención e idea central sean explícitas."),
        ("practice", "Explicar con un ejemplo y un cierre", "Practica 60–90 segundos. Puedes grabarte localmente o introducir la duración de forma manual.", "Revisar relación entre idea, ejemplo y cierre; no evaluar emociones ni acento."),
        ("review", "Escuchar y revisar el intento", "Aporta una transcripción fiel. Revisa los datos y elige una mejora concreta para el siguiente intento.", "Las sugerencias necesitan revisión humana; una duración válida no acredita claridad ni dominio."),
        ("transfer", "Cambiar audiencia o tema", "Repite con otra audiencia o tema y solo tres palabras de apoyo, con menos ayuda.", "Un revisor compara los intentos y registra el nivel de ayuda; no asumir transferencia por terminar."),
    ]:
        checks = [{"check_id": step_id + "-review", "evaluator_kind": "expert", "rubric": rubric}]
        if step_id == "practice":
            checks.append({"check_id": "exercise-duration", "evaluator_kind": "deterministic",
                           "rubric": "Duración indicada de 60 a 90 s, sin verificar el contenido audiovisual.",
                           "capability": "speaking.duration.read", "signal_key": "speaking.duration.seconds",
                           "comparison": "within", "expected": 75, "tolerance": 15, "unit": "s"})
        steps.append({"step_id": step_id, "title": title, "intent": rubric, "instruction": instruction,
                      "requires": [steps[-1]["step_id"]] if steps else [],
                      "sources": [{"source_id": "proposed-method"}], "checks": checks,
                      "max_attempts": 3, "recovery_guidance": "Conservar la incertidumbre, pedir la información que falta y volver a practicar."})
    data = {
        "skill_id": uid("oratoria-pitch-90s"), "version": "0.1.0", "domain": "public_speaking",
        "title": "Explica una idea en público y frente a cámara",
        "objective": "Explicar una idea con ejemplo y cierre, y repetir ante otra audiencia o tema con menos ayuda.",
        "prerequisites": ["Elegir un tema propio y una audiencia", "Aceptar que la rúbrica es un borrador pendiente de revisión"],
        "compatibility": {"application": "brivany-browser", "connector_profile": "speaking.browser.experimental",
                          "tested_versions": ["h1-experimental-pending-device-validation"], "platforms": ["windows"],
                          "required_capabilities": ["speaking.duration.read", "speaking.transcript.manual"]},
        "sources": [{"source_id": "proposed-method", "kind": "manual_reference", "artifact_id": uid("proposed-method"),
                     "sha256": sha256(SOURCE.read_bytes()).hexdigest(),
                     "license": "Nota local de producto para el prototipo; pendiente de revisión experta. No incluye grabaciones de terceros."}],
        "steps": steps,
        "transfer_exercise": {"goal": "Explicar con menos ayuda ante una nueva audiencia o sobre otro tema",
                              "difference_from_example": "Cambiar audiencia o tema; usar solo tres palabras de apoyo",
                              "target_help_level": "hinted", "expert_review_required": True},
        "lifecycle": "draft", "visibility": "private", "review": None, "is_example": False,
    }
    skill = SkillManifest.model_validate(data)
    data["content_sha256"] = skill.content_digest()
    return SkillManifest.model_validate(data)


if __name__ == "__main__":
    DESTINATION.write_text(json.dumps(build_manifest().model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(DESTINATION.name)
