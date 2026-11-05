"""Record project work locally. Examples in docs/17-bitacora.md."""
import argparse
import json
from pydantic import ValidationError
from services.activity import ActivityError, ActivityStore


def main():
    parser = argparse.ArgumentParser(description="Bitácora local de desarrollo de Brivany")
    parser.add_argument("kind", choices=["idea", "implementation", "test", "decision"])
    parser.add_argument("--status", required=True, choices=["pending", "implemented", "passed", "failed"])
    parser.add_argument("--title", required=True)
    parser.add_argument("--summary", required=True)
    parser.add_argument("--evidence", action="append", default=[])
    parser.add_argument("--external-calls", type=int)
    parser.add_argument("--gpu-seconds", type=float)
    args = parser.parse_args()
    try:
        record = ActivityStore().add({"kind": args.kind, "status": args.status, "title": args.title,
            "summary": args.summary, "external_calls": args.external_calls, "gpu_seconds": args.gpu_seconds}, args.evidence)
    except (ActivityError, ValidationError, OSError) as error:
        parser.exit(2, (str(error) if isinstance(error, ActivityError) else "No se pudo guardar el registro; revisa campos y evidencia.") + "\n")
    print(json.dumps({"recorded": True, "id": record["id"]}, ensure_ascii=False))


if __name__ == "__main__": main()
