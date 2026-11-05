"""Run one chosen local suite and persist its actual output and result in the ledger."""
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
from uuid import uuid4
from services.activity import ActivityStore, ROOT

SUITES = {
    "orchestration": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_orchestration"],
    "application-learning": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_application_memory"],
    "application-learning-native": [sys.executable,"-X","utf8","-B","-m","tools.check_application_learning_native"],
    "background-launch-native": [sys.executable,"-X","utf8","-B","-m","tools.check_background_launch"],
    "workspace-results-ui": [sys.executable,"-X","utf8","-B","-m","tools.check_computer_ui","--workspace-results"],
    "workspace-results-native": [sys.executable,"-X","utf8","-B","-m","tools.check_workspace_native","--results-only"],
    "workspace-agents-ui": [sys.executable,"-X","utf8","-B","-m","tools.check_computer_ui","--workspace-agents"],
    "ios-preview": ["node","scripts/check-ios-preview.cjs"],
    "mobile-gateway": ["node","--test","workers/mobile-gateway/test/gateway.test.mjs","workers/mobile-gateway/test/accounts.test.mjs","workers/mobile-gateway/test/account-chat.test.mjs"],
    "account-host": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_brivany_account"],
    "account-preview": ["node","scripts/check-account-preview.cjs"],
    "sync-relay": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_sync_relay","tests.test_prefix_translation","tests.test_inline_clauses","tests.test_dubbing_timing","tests.test_dubbing_audio","tests.test_inline_timbre_pipeline","tests.test_dubbing_delivery_pipeline","tests.test_inline_trial_limits"],
    "sync-desktop": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_sync_desktop"],
    "workspace-sync-extension": ["node","--test","browser-extension/tests/sync-timeline.test.mjs","browser-extension/tests/background.test.mjs","browser-extension/tests/stream-setup.test.mjs","browser-extension/tests/caption-probe.test.mjs","browser-extension/tests/video-selection.test.mjs","browser-extension/tests/pcm-sender.test.mjs","browser-extension/tests/workspace-control.test.mjs","browser-extension/tests/continuity-quality.test.mjs","browser-extension/tests/trial-coverage.test.mjs","browser-extension/tests/public-video-opening.test.mjs"],
    "selected-video": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_selected_video"],
    "caption-prefetch": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_caption_prefetch"],
    "meta-prosody": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_meta_prosody"],
    "motion": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_motion","tests.test_motion_narration"],
    "workspace-chat": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_workspace_companion"],
    "desktop-instance": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_desktop_instance"],
    "workspace-translation": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_work_translation"],
    "translation-stop-device": [sys.executable,"-X","utf8","-B","-m","tools.check_translation_stop_device"],
    "workspace-translation-pacing": [sys.executable,"-X","utf8","-B","-m","tools.check_workspace_translation_pacing"],
    "workspace-translation-pacing-hardware": [sys.executable,"-X","utf8","-B","-m","tools.check_workspace_translation_pacing","--hardware"],
    "workspace-translation-ui": [sys.executable,"-X","utf8","-B","-m","tools.check_computer_ui","--workspace-translation"],
    "workspace-chat-ui": [sys.executable,"-X","utf8","-B","-m","tools.check_computer_ui","--workspace-chat"],
    "workspace-chat-native": [sys.executable,"-X","utf8","-B","-m","tools.check_workspace_native"],
    "workspace-microphone-native": [sys.executable,"-X","utf8","-B","-m","tools.check_workspace_native","--microphone-input"],
    "spotify-sync": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_spotify_sync.SyncTests"],
    "spotify-resume": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_spotify_resume.ResumeTests"],
    "motion-ui": [sys.executable,"-X","utf8","-B","-m","tools.check_computer_ui","--motion"],
    "computer-access": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_computer_access"],
    "computer-files": ["node","--test","tests/file-approval.test.cjs"],
    "computer-access-ui": [sys.executable,"-X","utf8","-B","-m","tools.check_computer_ui","--access"],
    "terminal-ide": ["node","--test","tests/ide-project.test.cjs","tests/ide-control.test.cjs"],
    "terminal": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_terminal","tests.test_terminal_system_office"],
    "media": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_media"],
    "support": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_support"],
    "media-ui": [sys.executable,"-X","utf8","-B","-m","tools.check_computer_ui","--media"],
    "terminal-ui": [sys.executable,"-X","utf8","-B","-m","tools.check_computer_ui","--terminal"],
    "music-ducking": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_music_ducking"],
    "music-ducking-volume": ["node","--test","tests/music-ducking.test.cjs"],
    "spotify-relay": ["node","tools/check_spotify_relay.cjs"],
    "spotify": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_spotify","tests.test_lyrics","tests.test_spotify_artwork","tests.test_spotify_player"],
    "island-ui": [sys.executable,"-X","utf8","-B","-m","tools.check_computer_ui","--island"],
    "work-events-ui": [sys.executable,"-X","utf8","-B","-m","tools.check_computer_ui","--work-events"],
    "events": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_events"],
    "work": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_work_mode","tests.test_work_bridge","tests.test_appbar","tests.test_chat_visibility"],
    "tray": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_tray"],
    "desktop-ui-session": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_desktop_ui_session"],
    "edits-mcp": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_edits_mcp"],
    "computer-images-agents": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_computer_images_agents"],
    "computer-images-agents-ui": [sys.executable,"-X","utf8","-B","-m","tools.check_computer_ui","--images-agents"],
    "computer": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_computer_control","tests.test_quick_applications"],
    "computer-bundle": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_computer_backend"],
    "computer-native": ["node","--test","tests/computer-native.test.cjs","tests/computer-browser.test.cjs","tests/computer-page-actions.test.cjs","tests/application-choice.test.cjs","tests/system-query.test.cjs"],
    "system-diagnostics": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_system_diagnostics"],
    "system-diagnostics-native": [sys.executable,"-X","utf8","-B","-m","tools.check_system_diagnostics_native"],
    "computer-ui": [sys.executable,"-X","utf8","-B","-m","tools.check_computer_ui"],
    "melodi-cartesia": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_cartesia_melodi","tests.test_live_voice","tests.test_conversation","tests.test_melodi_dialogue"],
    "brivany-translation": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "tests.test_brivany_translation"],
    "main-navigation": ["node", "tools/check_main_navigation.cjs"],
    "river-translation": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "tests.test_river_translation", "tests.test_acoustic_speakers", "tests.test_provisional_voice_style"],
    "translation-voices": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_audio_content","tests.test_voice_timbre","tests.test_robust_voice_timbre"],
    "river-ui": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_river_ui"],
    "meta-translation": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "tests.test_meta_translation"],
    "python": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests"],
    "spatial": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_spatial*.py"],
    "spatial-vendor": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_spatial_vendor"],
    "spatial-ui": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_spatial_ui"],
    "spatial-worker": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_spatial_worker"],
    "spatial-modal": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_spatial_modal_transport.py"],
    "spatial-physics": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_spatial_physics"],
    "spatial-render": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_spatial_render"],
    "spatial-progressive": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_spatial_progressive"],
    "spatial-load": ["node", "--test", "tests/spatial-load.test.cjs"],
    "floorplan-ui": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_floorplan_ui"],
    "plan-settings": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_spatial_plan_settings.py"],
    "portable-floorplan": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_portable_floorplan"],
    "portable-presentation": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_portable_presentation"],
    "room-dispatch": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_spatial_room_dispatch.py"],
    "room-ingest": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "tests.test_spatial_room_ingest", "tests.test_spatial_room_evidence", "tests.test_spatial_room_backup", "tests.test_spatial_room_http", "tests.test_spatial_room_portable"],
    "room-ingest-ui": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_room_ingest_ui"],
    "connections-http": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_connections_http.py"],
    "whatsapp-gateway": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_whatsapp_gateway.py"],
    "sous-pipeline": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_sous_pipeline"],
    "sous-catalog": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_sous_catalog"],
    "google-oauth": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_google_oauth.py"],
    "personal-providers": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_personal_providers.py"],
    "personal-notes": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_personal_notes.py"],
    "personal-ui": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_personal_ui"],
    "spatial-ingest": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_spatial_ingest.py"],
    "spatial-room": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_spatial_room.py"],
    "spatial-room-render": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_spatial_room"],
    "spatial-assistant": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_spatial_assistant.py"],
    "spatial-assistant-ui": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_spatial_assistant"],
    "chat-requests": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_chat_requests.py"],
    "chat-requests-ui": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_chat_requests"],
    "request-latency-local": [sys.executable, "-X", "utf8", "-B", "-m", "tools.measure_request_latency"],
    "additional-usecases": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_additional_usecases"],
    "presentation": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_spatial_presentation.py"],
    "presentation-ui": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_presentation_ui"],
    "ingest-ui": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_ingest_ui"],
    "social-ui": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_social_ui"],
    "social": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_social.py"],
    "connections": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_connections"],
    "sous-voice": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_sous_voice.py"],
    "sous-voice-pipeline": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_sous_voice"],
    "sous-ui": ["node", "tools/check_sous_ui.cjs"],
    "desktop": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_desktop.py"],
    "desktop-ui": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_desktop_ui"],
    "spatial-local": ["node", "tools/check_spatial_local.cjs"],
    "javascript": ["node", "--test", "tests/context-engine.test.cjs", "tests/voice-engine.test.cjs", "tests/live-voice.test.cjs", "tests/turn-budget.test.cjs", "tests/dub-timing.test.cjs"],
    "contracts": [sys.executable, "-X", "utf8", "-B", "tools/validate_contracts.py"],
    "activity-ui": ["node", "tools/check_activity_ui.cjs"],
    "app-ui": ["node", "tools/check_ui.cjs"],
    "live-ui": ["node", "tools/check_live_ui.cjs"],
    "human-skills-ui": ["node", "tools/check_human_skills_ui.cjs"],
    "activity-local": ["node", "tools/check_activity_local.cjs"],
    "dubbing": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_dubbing*.py"],
    "dubbing-ui": ["node", "tools/check_dubbing_ui.cjs"],
    "translation": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_translation.py"],
    "modular-pipeline": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_modular_pipeline"],
    "gemini-pipeline": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_gemini_pipeline"],
    "gemini-provider": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_gemini_dubbing.py"],
    "pcm-observation": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_pcm_observation.py"],
    "synthetic-review": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_synthetic_dubbing_review.py"],
    "dubbing-measure": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_dubbing_measure.py"],
    "palabra": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_palabra.py"],
    "palabra-live": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "tests.test_palabra", "tests.test_palabra_live", "tests.test_palabra_native"],
    "native-audio": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "tests.test_native_audio"],
    "youtube-source": ["node", "--test", "tests/youtube-source.test.cjs", "tests/dub-audio-sink.test.cjs", "tests/dub-tab-capture.test.cjs"],
    "youtube-dubbing": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_youtube_dubbing"],
    "youtube-simple": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_youtube_dubbing", "--simple"],
    "youtube-capture-compat": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_youtube_dubbing", "--capture-compat"],
    "dubbing-timing": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_dubbing_pipeline", "--timing"],
    "dubbing-stream-timing": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_dubbing_pipeline", "--timing", "--two-clauses"],
    "openai-translation-pipeline": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_openai_translation_pipeline"],
    "dubbing-review-pipeline": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_openai_translation_pipeline", "--review-synthetic"],
    "dubbing-review-rejection": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_openai_translation_pipeline", "--reject-review"],
    "http": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_h1_server.py"],
}


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Verificar y registrar una suite local sin inferencia pagada")
    parser.add_argument("suite", choices=SUITES)
    args = parser.parse_args()
    command = SUITES[args.suite]
    start = datetime.now(timezone.utc)
    try:
        result = subprocess.run(command, cwd=ROOT, capture_output=True, timeout=180, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        returncode, output = result.returncode, (result.stdout + result.stderr).decode("utf-8", errors="replace")
    except (subprocess.TimeoutExpired, OSError):
        returncode, output = 1, "No se completó la suite: proceso no disponible o límite de 180 segundos."
    finish = datetime.now(timezone.utc)
    report = {"suite": args.suite, "started_at": start.isoformat(), "finished_at": finish.isoformat(),
              "duration_seconds": (finish-start).total_seconds(), "command": command, "exit_code": returncode,
              "external_calls": 0, "gpu_seconds": 0, "output": output[:100000]}
    directory = ROOT / "tmp" / "verification"; directory.mkdir(parents=True, exist_ok=True)
    path = directory / f'{args.suite}-{start.strftime("%Y%m%dT%H%M%S")}-{uuid4().hex[:8]}.json'
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    summary='Captura física local de micrófono en WebView2, sin ASR ni audio guardado; resultado y límites en el informe.' if args.suite=='workspace-microphone-native' else f'Suite local ejecutada; código de salida {returncode}. El informe conserva comando, duración y salida. No mide hardware físico ni precisión de reconstrucción.'
    ActivityStore().add({"kind": "test", "status": "passed" if returncode == 0 else "failed",
        "title": "Verificación · " + args.suite,
        "summary": summary,
        "external_calls": 0, "gpu_seconds": 0.0}, [path])
    print(output)
    print(f"Informe guardado: {path.relative_to(ROOT).as_posix()}")
    return returncode


if __name__ == "__main__": sys.exit(main())
