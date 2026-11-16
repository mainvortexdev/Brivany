"""Isolated job entrypoint; the HTTP parent enforces a hard process-group deadline."""
import json
import os
import sys
from pathlib import Path

from processor import process_request


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.buffer.read(8192))
        root = Path(os.environ.get("MEDIA_JOB_DIRECTORY", "/tmp/vetsa-public-media"))
        model = Path(os.environ["YAMNET_MODEL_PATH"]) if os.environ.get("YAMNET_MODEL_PATH") else None
        result = process_request(request, root, model_path=model)
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
    except ValueError as error:
        allowed = {"invalid_source_url", "only_public_post_or_reel_supported", "unsupported_profile", "invalid_request_id", "invalid_limits",
                   "invalid_processing_request", "request_id_conflict", "public_metadata_unavailable", "metadata_scope_mismatch"}
        print(json.dumps({"ok": False, "error": str(error) if str(error) in allowed else "processing_unavailable"}))
    except Exception:
        print(json.dumps({"ok": False, "error": "processing_unavailable"}))
