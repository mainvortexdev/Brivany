"""Genera JSON Schema y la propuesta HTTP; no inicia servidores."""
from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "contracts"))
from models import SCHEMA_MODELS


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build():
    components = {}
    for model in SCHEMA_MODELS:
        schema = model.model_json_schema()
        schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
        schema["$id"] = f"urn:brivany:schema:{model.__name__}:0.1.0"
        dump(ROOT / "contracts" / "schemas" / f"{model.__name__}.schema.json", schema)
        component = model.model_json_schema(ref_template="#/components/schemas/{model}")
        definitions = component.pop("$defs", {})
        for name, value in {**definitions, model.__name__: component}.items():
            if name in components and components[name] != value:
                raise ValueError(f"Definicion incoherente: {name}")
            components[name] = value

    paths = {}
    # method, path, id, request model, response model, success status, description
    operations = [
        ("post", "/v1/artifacts", "registerArtifact", "ArtifactRequest", "ArtifactUpload", "201", "Registrar un medio y autorizar su carga limitada; no queda listo hasta completar y verificar checksum."),
        ("post", "/v1/artifacts/{artifact_id}/complete", "completeArtifact", None, "Accepted", "202", "Verificar bytes, hash y permisos antes de admitir el recurso."),
        ("delete", "/v1/artifacts/{artifact_id}", "deleteArtifact", None, "JobView", "202", "Solicitar borrado autorizado del recurso y sus derivados."),
        ("post", "/v1/captures", "registerCapture", "CaptureRequest", "Accepted", "201", "Registrar recursos de demostracion autorizados; todos deben estar listos y pertenecer al espacio."),
        ("post", "/v1/skills/compile", "compileSkill", "CompileRequest", "JobView", "202", "Crear un trabajo de extraccion; su salida siempre es un borrador."),
        ("get", "/v1/jobs/{job_id}", "getJob", None, "JobView", "200", "Consultar trabajo del espacio autorizado."),
        ("post", "/v1/skills/{skill_id}/versions", "createSkillDraft", "DraftRequest", "SkillManifest", "201", "Crear una version en draft. Rechazar lifecycle publicado, revision de otra persona o id distinto al de la ruta."),
        ("get", "/v1/skills/{skill_id}/versions/{version}", "getSkillVersion", None, "SkillManifest", "200", "Recuperar una version a la que el actor tiene acceso."),
        ("patch", "/v1/skills/{skill_id}/versions/{version}", "updateSkillDraft", "DraftRequest", "SkillManifest", "200", "Editar solo un borrador con revision esperada. El contenido editado pierde cualquier revision previa."),
        ("post", "/v1/skills/{skill_id}/versions/{version}/review-requests", "submitSkillForReview", "PublishRequest", "SkillManifest", "200", "Fijar hash y pasar de draft a in_review tras validar estructura. Este paso no aprueba ni publica."),
        ("post", "/v1/skills/{skill_id}/versions/{version}/reviews", "reviewSkill", "ReviewRequest", "SkillManifest", "200", "Revisor autorizado: vincular decision al hash actual. El servidor asigna identidad y fecha del revisor."),
        ("post", "/v1/skills/{skill_id}/versions/{version}/publish", "publishSkill", "PublishRequest", "SkillManifest", "200", "Publicar solo tras revision vigente, compatibilidad y permisos. La version se vuelve inmutable."),
        ("post", "/v1/sessions", "createSession", "SessionRequest", "SessionView", "201", "Crear sesion fijando version. Los parametros se validan contra la skill; inicia preflight."),
        ("get", "/v1/sessions/{session_id}", "getSession", None, "SessionView", "200", "Consultar estado autoritativo y revision."),
        ("post", "/v1/sessions/{session_id}/transitions", "transitionSession", "TransitionRequest", "SessionView", "200", "Pausar, reanudar via preflight o cancelar. No permite al cliente marcar completed."),
        ("post", "/v1/sessions/{session_id}/mode", "changeSessionMode", "ModeRequest", "SessionView", "200", "Cambiar modo tras verificar permisos; assessment registra cualquier ayuda posterior."),
        ("post", "/v1/sessions/{session_id}/observations", "submitObservation", "Observation", "Accepted", "202", "Solo dispositivo emparejado. Comprobar espacio, sesion, proyecto, procedencia, timestamps y deduplicacion."),
        ("post", "/v1/sessions/{session_id}/verifications", "requestVerification", "VerifyRequest", "JobView", "202", "Solicitar evaluacion en servidor. El solicitante no proporciona el veredicto."),
        ("post", "/v1/sessions/{session_id}/step-reviews", "reviewStep", "StepReviewRequest", "Verification", "200", "Solo revisor autorizado por rubrica; validar evidencia, intento y relaciones antes de resolver."),
        ("post", "/v1/sessions/{session_id}/command-requests", "requestCommand", "CommandRequest", "Command", "201", "La politica calcula riesgo y precondiciones. Solicitar una accion no implica autorizarla ni ejecutarla."),
        ("post", "/v1/commands/{command_id}/decisions", "decideCommand", "DecisionRequest", "Command", "200", "Decision del usuario autenticado sobre hash exacto, alcance y vigencia del comando."),
        ("post", "/v1/commands/{command_id}/receipts", "submitReceipt", "Receipt", "Accepted", "202", "Solo el dispositivo destinatario. Registrar resultado local y solicitar verificacion de poscondicion."),
        ("get", "/v1/sessions/{session_id}/events", "listSessionEvents", None, "EventPage", "200", "Recuperar eventos durables posteriores a un cursor de sesion."),
    ]
    ref = lambda name: {"$ref": f"#/components/schemas/{name}"}
    for method, path, opid, request, response, status, description in operations:
        params = [{"$ref": "#/components/parameters/Workspace"}]
        for name in re.findall(r"\{([^}]+)\}", path):
            schema = {"type": "string", "pattern": r"^\d+\.\d+\.\d+$"} if name == "version" else {"type": "string", "format": "uuid"}
            params.append({"name": name, "in": "path", "required": True, "schema": schema})
        if method != "get":
            params.append({"$ref": "#/components/parameters/Idempotency"})
        if opid == "listSessionEvents":
            params += [
                {"name": "after_seq", "in": "query", "schema": {"type": "integer", "minimum": 0, "default": 0}},
                {"name": "limit", "in": "query", "schema": {"type": "integer", "minimum": 1, "maximum": 200, "default": 100}},
            ]
        operation = {"operationId": opid, "summary": description.split(".")[0], "description": description,
                     "parameters": params,
                     "responses": {status: {"description": "Resultado propuesto", "content": {"application/json": {"schema": ref(response)}}}}}
        for code in ("401", "403", "404", "409", "422", "429", "503"):
            operation["responses"][code] = {"description": f"Error {code}", "content": {"application/json": {"schema": ref("ErrorResponse")}}}
        if request:
            operation["requestBody"] = {"required": True, "content": {"application/json": {"schema": ref(request)}}}
        paths.setdefault(path, {})[method] = operation
    spec = {
        "openapi": "3.1.0",
        "info": {"title": "Brivany Architecture API", "version": "0.1.0",
                 "description": "Contrato de arquitectura sin servidor desplegado. La autorizacion y las reglas de negocio descritas deben implementarse. No incluye interfaz ni el protocolo completo de emparejamiento."},
        "security": [{"BearerAuth": []}],
        "paths": paths,
        "components": {
            "schemas": components,
            "securitySchemes": {"BearerAuth": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}},
            "parameters": {
                "Workspace": {"name": "X-Workspace-ID", "in": "header", "required": True,
                              "description": "El servidor debe verificar la pertenencia del actor al espacio solicitado.",
                              "schema": {"type": "string", "format": "uuid"}},
                "Idempotency": {"name": "Idempotency-Key", "in": "header", "required": True,
                                "description": "Clave acotada a espacio, actor y operacion; otro cuerpo con la misma clave produce 409.",
                                "schema": {"type": "string", "minLength": 8, "maxLength": 200}},
            },
        },
    }
    dump(ROOT / "contracts" / "openapi.json", spec)
    return len(SCHEMA_MODELS), len(operations)


if __name__ == "__main__":
    schemas, operations = build()
    print(f"Generados {schemas} esquemas y {operations} operaciones HTTP propuestas.")

