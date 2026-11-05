"""Validacion de arquitectura y ejemplos. No prueba APIs ni conectores reales."""
from copy import deepcopy
from pathlib import Path
import json
import os
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "contracts"))
from pydantic import ValidationError
from models import (SkillManifest, Observation, Evidence, Verification, MelodiProposal,
                    Command, Receipt, Event, SessionView, VerifyRequest, DraftRequest, SCHEMA_MODELS)


def check_local_refs(root):
    count = 0
    def visit(node):
        nonlocal count
        if isinstance(node, dict):
            if "$ref" in node:
                ref = node["$ref"]
                if not ref.startswith("#/"):
                    raise AssertionError(f"Referencia no local inesperada: {ref}")
                target = root
                for token in ref[2:].split("/"):
                    target = target[token.replace("~1", "/").replace("~0", "~")]
                count += 1
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)
    visit(root)
    return count


def main():
    examples = ROOT / "contracts" / "examples"
    types = {
        "blender-dimensiones.skill.json": SkillManifest,
        "davinci-color.skill.json": SkillManifest,
        "oratoria-camara.skill.json": SkillManifest,
        "observation.json": Observation, "evidence.json": Evidence,
        "verification.json": Verification, "melodi-proposal.json": MelodiProposal,
        "command.json": Command, "receipt.json": Receipt, "event.json": Event, "session.json": SessionView,
    }
    loaded = {name: json.loads((examples / name).read_text(encoding="utf-8")) for name in types}
    for name, model in types.items():
        model.model_validate(loaded[name])

    # Relacionar la evidencia del ejemplo, no confiar solo en la estructura.
    observation, evidence, verification = [loaded[n] for n in ("observation.json", "evidence.json", "verification.json")]
    assert evidence["observation_id"] == observation["observation_id"]
    assert verification["evidence_ids"] == [evidence["evidence_id"]]
    for key in ("workspace_id", "session_id"):
        assert observation[key] == evidence[key] == verification[key] == loaded["session.json"][key]
    assert verification["step_id"] == evidence["step_id"]
    assert verification["attempt"] == evidence["attempt"]
    known_signals = {s["key"] for s in observation["signals"]}
    assert set(evidence["signal_keys"]) <= known_signals

    skill = loaded["blender-dimensiones.skill.json"]
    session = loaded["session.json"]
    assert session["skill_content_sha256"] == skill["content_sha256"]
    assert set(session["step_states"]) == {s["step_id"] for s in skill["steps"]}
    assert loaded["receipt.json"]["command_id"] == loaded["command.json"]["command_id"]
    assert loaded["melodi-proposal.json"]["expected_session_revision"] == session["revision"]

    negative = []
    def rejects(label, model, value):
        try:
            model.model_validate(value)
        except ValidationError:
            negative.append(label)
            return
        raise AssertionError(f"Contrato acepto caso invalido: {label}")

    base = deepcopy(skill)
    base.update(lifecycle="draft", review=None, content_sha256="")
    bad = deepcopy(skill); bad["review"] = None
    rejects("publicacion-sin-revision", SkillManifest, bad)
    bad = deepcopy(skill); bad["title"] = "Contenido cambiado"
    rejects("cambio-despues-de-revision", SkillManifest, bad)
    bad = deepcopy(base); bad["steps"][0]["requires"] = ["dimensions"]
    rejects("grafo-ciclico", SkillManifest, bad)
    bad = deepcopy(base); bad["steps"][0]["requires"] = ["missing"]
    rejects("dependencia-inexistente", SkillManifest, bad)
    bad = deepcopy(base); bad["steps"][0]["sources"][0]["source_id"] = "missing"
    rejects("fuente-inexistente", SkillManifest, bad)
    bad = deepcopy(base); bad["steps"][1]["checks"][0]["parameter_ref"] = "missing"
    rejects("parametro-inexistente", SkillManifest, bad)
    bad = deepcopy(base); bad["parameters"]["width"]["default"] = 1000
    rejects("predeterminado-fuera-de-rango", SkillManifest, bad)
    bad = deepcopy(base); bad["steps"][1]["checks"][0]["unit"] = "cm"
    rejects("unidades-incompatibles", SkillManifest, bad)
    bad = deepcopy(base); bad["steps"][1]["checks"][0]["capability"] = "undeclared.tool"
    rejects("capacidad-no-declarada", SkillManifest, bad)
    bad = deepcopy(verification); bad["evidence_ids"] = []
    rejects("pass-sin-evidencia", Verification, bad)
    bad = deepcopy(verification); bad["evaluator_kind"] = "visual"
    rejects("opinion-visual-como-pass", Verification, bad)
    bad = deepcopy(loaded["command.json"]); bad["authorization_ref"] = None
    rejects("comando-sin-autorizacion", Command, bad)
    bad = deepcopy(loaded["command.json"]); bad["tool"]["arguments"]["object_ref"] = "otro"
    rejects("accion-alterada-despues-del-hash", Command, bad)
    bad = deepcopy(loaded["command.json"]); bad["expires_at"] = bad["issued_at"]
    rejects("vencimiento-invalido", Command, bad)
    bad = deepcopy(loaded["command.json"]); bad["reversibility"] = "irreversible"
    rejects("irreversible-sin-confirmacion", Command, bad)
    bad = deepcopy(observation); bad["signals"].append(bad["signals"][0])
    rejects("senales-duplicadas", Observation, bad)
    bad = {"expected_revision": 3, "step_id": "dimensions", "attempt": 1,
           "observation_ids": [observation["observation_id"]], "verdict": "PASS"}
    rejects("cliente-inyecta-veredicto", VerifyRequest, bad)
    rejects("cliente-crea-publicacion-directa", DraftRequest, {"expected_revision": 0, "manifest": skill})

    refs = 0
    for model in SCHEMA_MODELS:
        path = ROOT / "contracts" / "schemas" / f"{model.__name__}.schema.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        refs += check_local_refs(data)
        expected = model.model_json_schema()
        expected["$schema"] = "https://json-schema.org/draft/2020-12/schema"
        expected["$id"] = f"urn:brivany:schema:{model.__name__}:0.1.0"
        assert data == expected, f"Esquema desactualizado: {path.name}"

    api = json.loads((ROOT / "contracts" / "openapi.json").read_text(encoding="utf-8"))
    assert api["openapi"] == "3.1.0"
    refs += check_local_refs(api)
    opids = []
    for path, methods in api["paths"].items():
        path_params = set(re.findall(r"\{([^}]+)\}", path))
        for method, operation in methods.items():
            opids.append(operation["operationId"])
            actual = {p["name"] for p in operation["parameters"] if p.get("in") == "path"}
            assert actual == path_params
            assert any(key.startswith("2") for key in operation["responses"])
            assert {"$ref": "#/components/parameters/Workspace"} in operation["parameters"]
            if method != "get":
                assert {"$ref": "#/components/parameters/Idempotency"} in operation["parameters"]
    assert len(opids) == len(set(opids))

    # Referencias locales Markdown. H1 ya incluye una interfaz local de práctica.
    link_count = 0
    generated = {"node_modules", "tmp", "dist", "dist-quick-apps", "Exports", "out"}
    for directory, subdirectories, files in os.walk(ROOT):
        subdirectories[:] = [name for name in subdirectories if not name.startswith(".") and name not in generated]
        for name in files:
            if not name.endswith(".md"):
                continue
            path = Path(directory) / name
            for link in re.findall(r"\]\(([^)]+)\)", path.read_text(encoding="utf-8")):
                if "://" in link or link.startswith("#"):
                    continue
                target = (path.parent / link.split("#")[0]).resolve()
                # The ledger retains historical evidence independently of the
                # optional working copies in tmp/.
                if (ROOT / "tmp") in target.parents and not target.exists():
                    continue
                assert target.exists(), f"Enlace inexistente: {path.relative_to(ROOT)} -> {link}"
                link_count += 1
    result = {"examples_validated": len(types), "negative_cases_rejected": len(negative),
              "schemas_current": len(SCHEMA_MODELS), "http_operations_checked": len(opids),
              "local_schema_refs_resolved": refs, "markdown_links_checked": link_count,
              "negative_cases": negative,
              "not_tested": ["live Meta APIs", "professional application connectors", "database migrations or RLS", "full OpenAPI validator", "user learning outcomes"]}
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return result


if __name__ == "__main__":
    main()
