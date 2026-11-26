"""What PyInstaller packages as eddy-maths.exe: maths-core on this computer only.

`eddy-maths --port N`. Its shared token comes from MATHS_CORE_SERVICE_TOKEN, as in development.
"""

import argparse
import os
import sys
import threading

import uvicorn

from eddy_maths_core.main import app


def exit_with_parent() -> None:
    """End when the shell that started this program goes: it holds our input open and never
    writes to it, so a read that returns means the shell has gone (see eddy_api/desktop.py)."""
    if os.environ.get("EDDY_EXIT_WITH_PARENT") != "1":
        return

    def wait() -> None:
        try:
            sys.stdin.buffer.read()
        except (OSError, ValueError):
            pass
        os._exit(0)

    threading.Thread(target=wait, name="exit-with-parent", daemon=True).start()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="eddy-maths", description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args(argv)
    exit_with_parent()
    # Never anything but this computer: only the desktop app's own API calls it.
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
