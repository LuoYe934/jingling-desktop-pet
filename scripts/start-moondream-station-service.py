import argparse
from pathlib import Path
import json
import time

from moondream_station.core.analytics import Analytics
from moondream_station.core.config import ConfigManager
from moondream_station.core.manifest import ManifestManager
from moondream_station.core.models import ModelManager
from moondream_station.core.service import ServiceManager
from moondream_station.session import SessionState


DEFAULT_MANIFEST_URL = "https://m87-md-prod-assets.s3.us-west-2.amazonaws.com/station/mds2/production_manifest.json"


def main():
    parser = argparse.ArgumentParser(description="Start Moondream Station REST service without the interactive shell.")
    parser.add_argument("--model", default=None, help="Moondream model id, for example moondream-2 or moondream-3-preview.")
    parser.add_argument("--port", type=int, default=None, help="REST service port.")
    parser.add_argument("--timeout", type=float, default=120.0, help="Inference timeout in seconds.")
    args = parser.parse_args()

    config = ConfigManager()
    manifest = ManifestManager(config)
    analytics = Analytics(config, manifest)
    session = SessionState()
    models = ModelManager(config, manifest)
    service = ServiceManager(config, manifest, session, analytics)

    source = config.get("last_manifest_source") or DEFAULT_MANIFEST_URL
    try:
        manifest.load_manifest(source, analytics=analytics)
    except Exception:
        cache_file = Path.home() / ".moondream-station" / "models" / "cache" / "manifests" / "manifest_cache.json"
        if not cache_file.exists():
            raise
        manifest.load_manifest(str(cache_file), analytics=analytics)

    model = args.model or config.get("current_model") or manifest.get_available_default_model()
    if not model:
        raise RuntimeError("No Moondream model is configured.")

    if not models.switch_model(model):
        raise RuntimeError(f"Could not switch to Moondream model: {model}")

    port = int(args.port or config.get("service_port", 2020))
    config.set("inference_timeout", args.timeout)
    if not service.start(model, port):
        raise RuntimeError(f"Could not start Moondream Station on port {port}.")

    print(json.dumps({"status": "running", "model": model, "port": port}), flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        service.stop()


if __name__ == "__main__":
    main()
