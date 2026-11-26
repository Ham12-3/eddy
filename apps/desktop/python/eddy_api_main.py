"""What PyInstaller packages as eddy-api.exe: the desktop app's one program for services/api
(`setup`, `serve --port N`, `worker`). See eddy_api/desktop.py."""

import sys

from eddy_api.desktop import main

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
