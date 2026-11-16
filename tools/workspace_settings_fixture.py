"""Serve the real desktop settings routes with an isolated preference file."""
import json
from pathlib import Path
import sys

from desktop.experience.launcher import MODULE_ROUTES, NATIVE_PAGES, experience_handler
from desktop.experience.ui_session import DesktopUISession
from desktop.experience.workspace_preferences import WorkspacePreferences
from desktop.launcher import LocalDesktopServer
from services.h1.server import Handler


def main():
    session=DesktopUISession(MODULE_ROUTES|NATIVE_PAGES)
    with LocalDesktopServer(handler=experience_handler(Handler)) as server:
        server.http.desktop_ui_session=session
        server.http.workspace_preferences=WorkspacePreferences(Path(sys.argv[1])/'preferences.json')
        print(json.dumps({'origin':server.base_url,'header':session.HEADER,'capability':session.secret}),flush=True)
        sys.stdin.readline()


if __name__=='__main__':
    main()
