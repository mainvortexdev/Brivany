"""Run one chosen local suite and persist its actual output and result in the ledger."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4
from services.activity import ActivityStore, ROOT

VETSA_WORKER = Path(os.environ.get("BRIVANY_VETSA_INTELLIGENCE_DIR", str(ROOT.parent / "Vetsa-Intelligence"))) / "cloudflare-worker"

SUITES = {
    "demo-cloud": ["node","--test","--test-timeout=45000","workers/demo/test/policy.test.mjs","workers/demo/test/runtime.test.mjs","workers/demo/test/socket.test.mjs","workers/demo/test/membership.test.mjs","workers/demo/test/download.test.mjs","workers/demo/test/audio-http.test.mjs"],
    "demo-phone": ["node","--import","./workers/calls/test/register.mjs","--test","--test-timeout=45000","workers/demo/test/phone.test.mjs"],
    "demo-native": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_demo_account"],
    "distribution": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_distribution"],
    "review-draft": ["node","--test","workers/whatsapp/test/review-draft.test.js"],
    "windows-installer": [sys.executable,"-X","utf8","-B","-m","tools.check_windows_installer"],
    "windows-release": [sys.executable,"-X","utf8","-B","-m","tools.audit_windows_release","--local-only"],
    "recall-meetings": ["node","--test","--test-timeout=20000","--import","./workers/whatsapp/test/cloudflare-register.js","workers/whatsapp/test/recall-meetings.test.js"],
    "recall-voice": ["node","--test","--test-timeout=20000","--import","./workers/whatsapp/test/cloudflare-register.js","workers/whatsapp/test/recall-voice.test.js"],
    "recall-native": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_meetings","tests.test_whatsapp_cloud","tests.test_connections_http"],
    "recall-ui": ["node","--import","./workers/whatsapp/test/cloudflare-register.js","tools/check_recall_ui.mjs"],
    "recall-runtime": ["node","--import","./workers/whatsapp/test/cloudflare-register.js","tools/check_recall_runtime.mjs"],
    "recall-voice-runtime": ["node","--import","./workers/whatsapp/test/cloudflare-register.js","tools/check_recall_voice_runtime.mjs"],
    "vetsa-meta-runtime": ["node","--test",str(VETSA_WORKER / "test/meta-image-workerd.test.mjs")],
    "vetsa-meta-image": ["node","--test",str(VETSA_WORKER / "test/meta-image.test.js"),str(VETSA_WORKER / "test/vision-analysis.test.js"),str(VETSA_WORKER / "test/kie-image.test.js")],
    "chat-progress-ui": ["node","tools/check_chat_progress_ui.cjs"],
    "desktop-lifecycle": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_lifecycle"],
    "app-identity-native": [sys.executable,"-X","utf8","-B","-m","tools.check_app_identity_native"],
    "chat-history": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_chat_history"],
    "chat-followup": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_image_followup","tests.test_meta_image_brand"],
    "chat-navigation-ui": ["node","tools/check_chat_navigation_ui.cjs"],
    "chat-history-ui": ["node","tools/check_chat_history_ui.cjs"],
    "workspace-mail": ["node","--test","workers/whatsapp/test/software-mail.test.js","workers/whatsapp/test/gmail.test.js"],
    "telephony-cloud": ["node","--test","--test-concurrency=1","--import","./workers/calls/test/register.mjs","workers/calls/test/phone.test.mjs","workers/calls/test/voice.test.mjs","workers/calls/test/runtime.test.mjs"],
    "melodi-whatsapp": [sys.executable,"-X","utf8","-B","-m","tools.check_melodi_whatsapp"],
    "whatsapp-cloud": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_whatsapp_cloud","tests.test_vetsa_account","tests.test_connections_http"],
    "melodi-whatsapp-site": ["node","--test","official-site/test/whatsapp.test.mjs","official-site/test/wav.test.mjs"],
    "shell-boot-native": [sys.executable,"-X","utf8","-B","-m","tools.check_shell_boot_native"],
    "shell-recovery-native": [sys.executable,"-X","utf8","-B","-m","tools.check_shell_boot_native","--inert-first-load"],
    "shell-recovery-ui": ["node","tools/check_shell_recovery_ui.cjs"],
    "spotify-connection-ui": ["node","tools/check_spotify_connection_ui.cjs"],
    "music-expansion": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_music_expansion"],
    "music-presence-protocol": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_music_presence_protocol"],
    "music-extension": ["node","--test","browser-extension/tests/music-presence.test.mjs","browser-extension/tests/timeline.test.mjs","browser-extension/tests/background.test.mjs"],
    "music-composition": ["node","--test","tests/music-composition.test.cjs"],
    "workspace-companions-music-ui": ["node","tools/check_companions_music_ui.cjs"],
    "drop-transfer": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_drop_transfer","tests.test_drop_http","tests.test_drop_edge"],
    "drop-acceptance": ["node","tools/check_drop_acceptance.cjs"],
    "drop-worker": ["node","tools/check_drop_worker.cjs"],
    "drop-storage": ["node","tools/check_drop_storage.cjs"],
    "drop-edge-ui": ["node","tools/check_drop_edge_ui.cjs"],
    "drop-edge-webkit-ui": ["node","tools/check_drop_edge_ui.cjs","--webkit"],
    "drop-edge-native": [sys.executable,"-X","utf8","-B","-m","tools.check_drop_edge_native"],
    "drop-e2e": ["node","tools/check_drop_e2e.cjs","--shelf-ready"],
    "drop-e2e-mass": ["node","tools/check_drop_e2e.cjs","--shelf-ready","--mass"],
    "drop-e2e-webkit-mass": ["node","tools/check_drop_e2e.cjs","--shelf-ready","--mass","--webkit"],
    "demo-transfer": ["node","--test","--test-timeout=45000","workers/demo/test/transfer.test.mjs"],
    "installed-backend-native": [sys.executable, "-X", "utf8", "-B", "-m", "tools.check_installed_backend"],
    "live-conversation": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "tests.test_live_conversation"],
    "chat-voice-ui": ["node", "tools/check_chat_voice_ui.cjs"],
    "chat-media-ui": ["node", "tools/check_chat_media_ui.cjs"],
    "chat-thinking-ui": ["node", "tools/check_chat_thinking_ui.cjs"],
    "chat-presentation": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_assistant_identity","tests.test_chat_progress"],
    "agents-preview-ui": ["node","tools/check_agents_preview_ui.cjs"],
    "chat-agents-ui": ["node","tools/check_chat_agents_ui.cjs"],
    "brand-typography": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_brand_typography"],
    "brand-typography-ui": ["node","tools/check_brand_typography_ui.cjs"],
    "video-retry": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_video_retry"],
    "call-visuals": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_call_visuals","tests.test_call_audio","tests.test_motion_story_contract","tests.test_motion_story_renderer"],
    "agent-avatars": ["node","--test","tests/agent-avatars.test.mjs"],
    "agent-avatars-ui": ["node","tools/check_agent_avatars_ui.cjs"],
    "whatsapp-client": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_whatsapp_client"],
    "whatsapp-desktop": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_whatsapp_desktop"],
    "whatsapp-client-native": [sys.executable,"-X","utf8","-B","-m","tools.check_whatsapp_client_native"],
    "whatsapp-client-ui": ["node","tools/check_whatsapp_client_ui.cjs"],
    "phone-calendar-audit": [sys.executable,"-X","utf8","-B","-m","tools.check_phone_calendar"],
    "telephony": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_telephony_telnyx"],
    "telephony-call-control": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_telnyx_call_control","tests.test_telephony_safety"],
    "telephony-realtime": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_telephony_realtime"],
    "telephony-sip-native": [sys.executable,"-X","utf8","-B","-m","tools.check_sip_native"],
    "telephony-sip": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_telephony_sip"],
    "telephony-ui": ["node","tools/check_telephony_ui.cjs"],
    "workspace-call": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_workspace_call"],
    "desktop-widgets": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_widget_state","tests.test_desktop_widgets"],
    "desktop-widgets-native": [sys.executable,"-X","utf8","-B","-m","tools.check_desktop_widgets_native"],
    "desktop-widgets-ui": ["node","tools/check_desktop_widgets_ui.cjs"],
    "desktop-widgets-resources-native": [sys.executable,"-X","utf8","-B","-m","tools.check_desktop_widgets_native","--measure"],
    "desktop-widgets-webview-native": [sys.executable,"-X","utf8","-B","-m","tools.check_desktop_widgets_webview_native"],
    "workspace-canvas": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_workspace_canvas"],
    "workspace-canvas-core": ["node","--test","tests/workspace-canvas.test.cjs"],
    "workspace-canvas-ui": ["node","tools/check_workspace_canvas_ui.cjs"],
    "workspace-canvas-clipboard-native": [sys.executable,"-X","utf8","-B","-m","tools.check_canvas_clipboard_native"],
    "workspace-canvas-native": [sys.executable,"-X","utf8","-B","-m","tools.check_workspace_canvas_native"],
    "workspace-phone": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_workspace_phone"],
    "phone-control": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_phone_control"],
    "phone-control-ui": ["node","tools/check_phone_control_ui.cjs"],
    "workspace-phone-ui": ["node","tools/check_workspace_phone_ui.cjs"],
    "workspace-settings-ui": ["node","tools/check_workspace_settings_ui.cjs"],
    "workspace-locale-native": [sys.executable,"-X","utf8","-B","-m","tools.check_workspace_native","--workspace-locale"],
    "workspace-recording": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_workspace_recording"],
    "workspace-recording-ui": ["node","tools/check_workspace_recording_ui.cjs"],
    "workspace-recording-native": [sys.executable,"-X","utf8","-B","-m","tools.check_workspace_recording_native"],
    "workspace-daily-ui": ["node","tools/check_workspace_daily_ui.cjs"],
    "workspace-daily": ["node","--test","tests/workspace-daily.test.cjs"],
    "workspace-weather": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_workspace_daily"],
    "workspace-model-lazy": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_robust_voice_timbre"],
    "workspace-voice-preferences": ["node", "tools/check_workspace_voice_preferences.cjs"],
    "workspace-startup": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_workspace_startup_resources"],
    "workspace-design-ui": ["node","tools/check_workspace_design_ui.cjs"],
    "workspace-game-native": [sys.executable,"-X","utf8","-B","-m","tools.check_workspace_game_native"],
    "workspace-controls": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_workspace_controls"],
    "workspace-runtime": ["node", "tools/check_workspace_runtime.cjs"],
    "workspace-runtime-native": [sys.executable,"-X","utf8","-B","-m","tools.check_workspace_native","--workspace-runtime"],
    "workspace-files": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_workspace_files"],
    "workspace-files-ui": ["node","tools/check_workspace_files_ui.cjs"],
    "workspace-files-native": [sys.executable,"-X","utf8","-B","-m","tools.check_workspace_native","--workspace-files"],
    "workspace-widgets": ["node","--test","tests/workspace-widgets.test.cjs"],
    "workspace-widgets-ui": ["node","tools/check_workspace_widgets_ui.cjs"],
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
    "workspace-sync-extension": ["node","--test","browser-extension/tests/sync-timeline.test.mjs","browser-extension/tests/timeline.test.mjs","browser-extension/tests/background.test.mjs","browser-extension/tests/stream-setup.test.mjs","browser-extension/tests/caption-probe.test.mjs","browser-extension/tests/video-selection.test.mjs","browser-extension/tests/pcm-sender.test.mjs","browser-extension/tests/workspace-control.test.mjs","browser-extension/tests/continuity-quality.test.mjs","browser-extension/tests/trial-coverage.test.mjs","browser-extension/tests/public-video-opening.test.mjs"],
    "selected-video": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_selected_video"],
    "caption-prefetch": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_caption_prefetch"],
    "meta-prosody": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_meta_prosody"],
    "motion": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_motion","tests.test_motion_narration"],
    "motion-social": [sys.executable,"-X","utf8","-B","-m","unittest","tests.test_motion_social","tests.test_motion_story_service"],
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
    "river-translation": [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "tests.test_river_translation", "tests.test_acoustic_speakers", "tests.test_provisional_voice_style", "tests.test_voice_clone_keep", "tests.test_ink_direct", "tests.test_groq_translation", "tests.test_caption_dubbing"],
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
    "javascript": ["node", "--test", "tests/context-engine.test.cjs", "tests/voice-engine.test.cjs", "tests/live-voice.test.cjs", "tests/live-turns.test.cjs", "tests/turn-budget.test.cjs", "tests/dub-timing.test.cjs"],
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
        environment = {**os.environ, 'BRIVANY_TEST_PYTHON': os.environ.get('BRIVANY_TEST_PYTHON', sys.executable)}
        result = subprocess.run(command, cwd=ROOT, env=environment, capture_output=True, timeout=480 if args.suite in {'drop-e2e-mass','drop-e2e-webkit-mass'} else 180, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        returncode, output = result.returncode, (result.stdout + result.stderr).decode("utf-8", errors="replace")
    except (subprocess.TimeoutExpired, OSError):
        returncode, output = 1, "No se completó la suite: proceso no disponible o límite de 180 segundos."
    finish = datetime.now(timezone.utc)
    gpu_seconds = None if args.suite.endswith('-ui') or args.suite.endswith('-native') or args.suite in {'workspace-phone','drop-e2e'} else 0
    report = {"suite": args.suite, "started_at": start.isoformat(), "finished_at": finish.isoformat(),
              "duration_seconds": (finish-start).total_seconds(), "command": command, "exit_code": returncode,
              "external_calls": 0, "gpu_seconds": gpu_seconds, "output": output[:100000]}
    directory = ROOT / "tmp" / "verification"; directory.mkdir(parents=True, exist_ok=True)
    path = directory / f'{args.suite}-{start.strftime("%Y%m%dT%H%M%S")}-{uuid4().hex[:8]}.json'
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    summary='Captura física local de micrófono en WebView2, sin ASR ni audio guardado; resultado y límites en el informe.' if args.suite=='workspace-microphone-native' else f'Suite local ejecutada; código de salida {returncode}. El informe conserva comando, duración y salida. No mide hardware físico ni precisión de reconstrucción.'
    if args.suite == 'drop-edge-native':
        summary = f'WinForms y aura por píxel reales; arrastre OLE entre dos procesos propios con archivos sintéticos, Copy, rechazo de texto y limpieza al desconectar. Salida {returncode}. Entrada Windows de prueba con restauración del puntero; sin captura personal, teléfono ni proveedores. GPU sin medir.'
    if args.suite in {'music-expansion','music-presence-protocol','music-extension','music-composition','workspace-companions-music-ui'}:
        summary = f'Expansión musical con relojes, canciones y audio sintéticos; puente y ventanas sustituidos. Protocolo WebSocket en loopback o Edge sin GPU cuando corresponde. Salida {returncode}. No acredita música personal, audio físico ni el minuto de inactividad real; sin proveedores externos.'
    if args.suite in {'shell-boot-native','shell-recovery-native'}:
        summary = f'WebView2 y HTTP reales con perfil sintético; entrada Windows, cuentas, modelos y audio sin utilizar. Arranque y recuperación de fallo 503 de scripts con un único reintento, según la suite. Salida {returncode}. Sin conversación personal ni llamadas externas; GPU sin medir.'
    if args.suite == 'spotify-connection-ui':
        summary = f'Edge sin GPU con cuentas y puente nativo sustituidos: error persistente, vinculación sin campo de Client ID, cancelación, identidad de cuenta y desconexión a 375 px. Salida {returncode}. Sin Spotify real, credenciales, audio ni entrada Windows; GPU sin medir.'
    if args.suite in {'drop-edge-ui','drop-edge-webkit-ui'}:
        engine = 'WebKit real con puntero' if args.suite == 'drop-edge-webkit-ui' else 'Edge real con eventos táctiles'
        summary = f'{engine} a 320/390/768 px; emisor sustituido. Selección sin envío, borde, cancelación, cola, botón accesible y movimiento reducido. Salida {returncode}. Sin móvil físico ni proveedores; GPU sin medir.'
    if args.suite == 'drop-e2e':
        summary = f'Worker/DO local, dos navegadores reales, WebRTC sin STUN externo, OPFS y disco nativo con archivos sintéticos. Cola PC→móvil y selección táctil móvil→PC, contenido exacto y sesión única. Salida {returncode}. Sin dominio público ni móvil físico; GPU sin medir.'
    if args.suite == 'chat-voice-ui':
        summary = f'Edge propio, WebAudio real y micrófono/ASR/turno/TTS sintéticos: activación, cierre local sin final Muse, captura durante preparación de respuesta, historial conservado, señal de escucha con reloj acelerado sin silenciar al usuario, cancelación, PCM/ondas y geometría de 320 px a escritorio. Salida {returncode}. Sin proveedores ni dispositivos físicos; GPU sin medir.'
    if args.suite == 'chat-progress-ui':
        summary=f'Edge aislado y reloj acelerado: imagen y video empiezan en 1, avanzan como estimación aun sin contador del proveedor, se limitan antes de completar, conservan geometría y animación. Salida {returncode}. Sin proveedor real; no mide progreso exacto del modelo.'
    if args.suite == 'chat-followup':
        summary=f'Imágenes y recibos sintéticos: edición ligada al chat antes del atajo conversacional/remoto, permiso vigente, referencia enviada a images/edits, original conservado, reinicio, chat distinto y recurso ausente. Salida {returncode}. Sin proveedor real; no certifica la fidelidad de una edición generada.'
    if args.suite == 'chat-navigation-ui':
        summary=f'Edge aislado con chats sintéticos: último mensaje, lectura sin saltos, flecha de retorno, Mostrar más/menos, renombrado, Conexiones/Bitácora en Ajustes y escritura progresiva. Salida {returncode}. Sin acceso al navegador personal ni proveedores.'
    if args.suite == 'app-identity-native':
        summary=f'Lectura de título e icono HICON de la ventana propia de Brivany tras reinicio normal. Salida {returncode}. Sin captura de pantalla, foco, entrada de sistema ni proveedores; no acredita un instalador recompilado.'
    if args.suite == 'live-conversation':
        summary = f'Contratos locales con proveedores y entrada nativa sustituidos: conversación sin clasificador previo, acciones con revisión y error específico, habilidad humana conservada, hasta tres síntesis de un mismo turno y señales locales sin inferencia. Salida {returncode}. No certifica semántica de modelos ni audio físico.'
    if args.suite == 'installed-backend-native':
        summary = f'Electron fijado y ejecutor nativo en proceso propio, con sondeo sin acciones de entrada ni reproducción del pedido del usuario. Salida {returncode}. Sin modelos ni proveedores; GPU sin medir.'
    if args.suite == 'workspace-recording-native':
        summary = f'Captura GDI real de una ventana sintética propia y decodificación del MP4; salida {returncode}. Sin captura de escritorio personal, micrófono ni proveedor. Tiempo GPU desconocido.'
    if args.suite == 'workspace-runtime-native':
        summary = f'WebView2 y región Windows en ventanas propias. CPU y memoria por grupo de procesos en tres estados, temporizador local y llamadas del puente; salida {returncode}. Tiempo de GPU sin medir.'
    if args.suite == 'workspace-files-native':
        summary = f'WebView2 y puente nativo de Archivos con DOCX sintético y escritura MIME real. Selector y cliente de correo sustituidos; salida {returncode}. Sin cuenta, proveedores ni envío.'
    if args.suite == 'workspace-phone':
        summary = f'Archivos sintéticos con transporte HTTPS real en loopback y DPAPI real en Windows; salida {returncode}. Red elegida sustituida. No certifica teléfono físico, firewall, Wi-Fi ni aceptación del certificado en el móvil.'
    if args.suite in {'phone-control', 'phone-control-ui'}:
        summary = f'Control móvil con HTTPS real en loopback, pantalla sintética y acciones Windows sustituidas; salida {returncode}. Sin teléfono físico, cambios de energía o captura personal.'
    if args.suite == 'workspace-game-native':
        summary = f'Franja WinForms propia y contadores de sistema reales; salida {returncode}. Sin partida, traza FPS, captura personal ni medición de GPU del banco.'
    if args.suite == 'workspace-call':
        summary = f'Lectura real de estado de Core Audio en Windows cuando hay entrada de comunicaciones, más escrituras con sustitutos y comprobación de ABI. Salida {returncode}. Sin captura ni cambios en el micrófono físico.'
    if args.suite == 'telephony-realtime':
        summary = f'Sesión Live sobre PCM 24 kHz con transporte en memoria, Muse, Meta y Cartesia sustituidos. Verifica audio antes del fin del modelo, interrupción por voz, acuses, cero para colgar y nivel PCM. Salida {returncode}. Sin telefonía PSTN, proveedores reales ni validación de latencia física.'
    if args.suite == 'telephony':
        summary = f'Telnyx con API y trabajador SIP sustituidos: clave solo como Bearer, aprovisionamiento idempotente con contraseña nueva, número emisor propio o verificado, límites de gasto, revisión de un uso, 403 explicado, cancelación y recibos sin remarcado. Salida {returncode}. Sin peticiones a Telnyx, PSTN ni proveedores de IA.'
    if args.suite == 'telephony-call-control':
        summary = f'Call Control v2 local con API, claves Ed25519, voz y audio sintéticos: validación RD, autorización, eventos firmados y deduplicados, envío incierto sin remarcado, speak/hangup, HTTP y WebSocket reales en loopback, PCM/PCMU y conversación con proveedores sustituidos. Salida {returncode}. No prueba llamadas PSTN, cuenta Telnyx, calidad semántica, escucha ni latencia física.'
    if args.suite == 'telephony-cloud':
        summary = f'Workers RPC, Durable Objects SQLite, alarmas persistentes y WebSockets en workerd local; Telnyx, Muse, Meta y Cartesia sustituidos. Voz canónica fijada, cancelación, firma, aislamiento, límites y resultado incierto sin remarcado. Salida {returncode}. Sin llamadas PSTN, proveedores reales ni medición de escucha, latencia física o semántica.'
    if args.suite == 'whatsapp-client':
        summary = f'Pasarela del cliente WhatsApp, revisión, persistencia, simulación bidireccional, interrupción y dispositivos de audio sustituidos. Salida {returncode}. Sin cuenta WhatsApp, audio físico, llamadas públicas ni API de Meta/voz reales.'
    if args.suite == 'agent-avatars':
        summary = f'Blobatar local: identidad entre reintentos, diferencias de caras, semillas sin HTML, licencia/versionado e integridad de assets con presupuesto de tamaño. Salida {returncode}. No acredita calidad visual por hash ni despliegues de agentes reales.'
    if args.suite == 'agent-avatars-ui':
        summary = f'Edge con Blobatar local y avisos reales sobre trabajos sintéticos: flotación acotada sin escala, mirada fija, parpadeo, identidad por función, CSP estricta, pausa por visibilidad, movimiento reducido y limpieza. Salida {returncode}. Sin proveedores ni agentes reales; GPU sin medir.'
    if args.suite == 'chat-agents-ui':
        summary = f'Barra y modal reales en Edge propio con trabajos sintéticos: 0/1/4/7 agentes, máximo cuatro visibles, detalles de función/tarea, modo oculto persistente sin detener trabajos, identidad entre tareas, teclado, CSP y 375 px. Salida {returncode}. Sin proveedores ni entrada Windows; GPU sin medir.'
    if args.suite == 'agents-preview-ui':
        summary = f'Vista de simulación local en Edge sin ventana visible: componentes reales de chat y agentes, miniaturas de imagen/video sin desmontar y dimensiones constantes en 30 muestras con escritura y progreso, proporciones a 320 px y pausas. Salida {returncode}. Sin ejecutar trabajos ni proveedores; GPU sin medir.'
    if args.suite == 'workspace-agents-ui':
        summary = f'WorkSpace real en Edge con seis agentes sintéticos: caras distintas, reintentos, SVG persistente, pausas, preferencias, revisión, cancelación y límites de 375 a 1280 px. Salida {returncode}. No ejecuta encargos ni mide consumo físico; GPU sin medir.'
    if args.suite == 'whatsapp-client-native':
        summary = f'UI Automation real sobre una ventana WPF propia con destinatario y estados sintéticos; navegación sustituida. Salida {returncode}. Sin cliente WhatsApp real, cuenta, red ni captura de audio. GPU sin medir.'
    if args.suite == 'whatsapp-client-ui':
        summary = f'Panel real en Edge conectado al puente Python y la pasarela en modo simulado. Salida {returncode}. Revisión, dos turnos de voz sintéticos, cancelación, restauración desde disco e idiomas; sin llamada pública ni API o dispositivos de audio reales. GPU sin medir.'
    if args.suite == 'phone-calendar-audit':
        summary = f'Auditoría de seis solicitudes de agenda en dos formatos telefónicos con proveedores y transporte sustituidos. Salida {returncode}; salida 1 puede indicar acceso a agenda ausente, según el informe. Sin llamadas públicas, acceso a cuentas ni cambios de eventos. No valida semántica de Meta ni latencia real.'
    if args.suite == 'telephony-sip':
        summary = f'Trabajador SIP para Telnyx: URIs E.164, diagnóstico de códigos sin cabeceras, alcance a un solo número y dos recorridos SIP/RTP nativos de loopback con IA sustituida. Salida {returncode}. Sin Telnyx, PSTN, dispositivos físicos ni latencia real. Los acuses SIP solo acreditan envío RTP local.'
    ActivityStore().add({"kind": "test", "status": "passed" if returncode == 0 else "failed",
        "title": "Verificación · " + args.suite,
        "summary": summary,
        "external_calls": 0, "gpu_seconds": gpu_seconds}, [path])
    print(output)
    print(f"Informe guardado: {path.relative_to(ROOT).as_posix()}")
    return returncode


if __name__ == "__main__": sys.exit(main())
