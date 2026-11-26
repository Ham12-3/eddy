"""What PyInstaller packages as eddy-maths.exe: maths-core on this computer only.

`eddy-maths --port N`. Its shared token comes from MATHS_CORE_SERVICE_TOKEN, as in development.
"""

import argparse
import sys

import uvicorn

from eddy_maths_core.main import app


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="eddy-maths", description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args(argv)
    # Never anything but this computer: only the desktop app's own API calls it.
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
