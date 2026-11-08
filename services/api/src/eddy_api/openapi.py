"""Write the OpenAPI document used to generate packages/api-client.

Usage: python -m eddy_api.openapi [output-path]   (stdout when no path is given)
"""

import json
import sys
from pathlib import Path

from eddy_api.main import create_app


def main() -> None:
    document = json.dumps(create_app().openapi(), indent=2, sort_keys=True) + "\n"
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(document, encoding="utf-8", newline="\n")
    else:
        sys.stdout.write(document)


if __name__ == "__main__":
    main()
