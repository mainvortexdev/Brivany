"""CPU-only preparation for a future Modal reconstruction. No cloud invocation."""
import argparse
import json
from pydantic import ValidationError
from services.spatial.capture import CaptureError, prepare_capture


def main():
    parser = argparse.ArgumentParser(description="Preparar una captura espacial sin consumir Meta ni Modal")
    parser.add_argument("video", help="MP4 local de hasta 60 segundos y 25 MiB")
    parser.add_argument("--output", required=True, help="Carpeta nueva; nunca se sobrescribe")
    parser.add_argument("--frames", type=int, choices=range(2, 9), default=6)
    parser.add_argument("--reference-length-m", type=float)
    parser.add_argument("--reference-description")
    args = parser.parse_args()
    try:
        result = prepare_capture(args.video, args.output, frames=args.frames,
            reference_length_m=args.reference_length_m, reference_description=args.reference_description)
    except (CaptureError, ValidationError, OSError) as error:
        message = "No se pudo validar la captura o su referencia." if isinstance(error, ValidationError) else str(error)
        parser.exit(2, message + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__": main()
