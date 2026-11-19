"""`python -m eddy_api.seed`: validate the curriculum and upsert it into DATABASE_URL.

--check         validate the YAML only; no database needed (CI runs this)
--dry-run       seed inside a transaction, print the diff, then roll back
--verbose       list every created, updated, deleted, retired and orphaned row
--allow-remote  seed a database that is not on this machine (refused otherwise)
"""

import argparse
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from eddy_api.config import get_settings
from eddy_api.db.local import is_local
from eddy_api.seed.curriculum import CurriculumError, default_root, load
from eddy_api.seed.upsert import seed


@contextmanager
def owner_session(url: str) -> Iterator[Session]:
    """The seed is a deploy step, so it runs as the schema owner, like the migrations."""
    engine = create_engine(url)
    try:
        with Session(engine) as session:
            yield session
    finally:
        engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m eddy_api.seed", description=__doc__)
    parser.add_argument("--curriculum", type=Path, default=None, help="default: ./curriculum")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--allow-remote", action="store_true")
    args = parser.parse_args(argv)

    root: Path = args.curriculum or default_root()
    try:
        curriculum = load(root)
    except CurriculumError as error:
        print(f"{root} is invalid:", file=sys.stderr)
        for problem in error.problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    print(
        f"{root} is valid: {len(curriculum.specs)} specs, {len(curriculum.nodes)} nodes, "
        f"{len(curriculum.edges)} prerequisite edges, {len(curriculum.topics)} topics, "
        f"{len(curriculum.misconceptions)} misconceptions, {len(curriculum.set_texts)} set texts, "
        f"{len(curriculum.question_types)} question types"
    )
    if args.check:
        return 0

    url = get_settings().database_url.get_secret_value()
    target = make_url(url)
    print(f"Seeding database {target.database} on {target.host}:{target.port}")
    if not is_local(url) and not args.allow_remote:
        print(
            "Refusing: that database is not on this machine. Pass --allow-remote.", file=sys.stderr
        )
        return 2

    with owner_session(url) as session:
        report = seed(session, curriculum)
        if args.dry_run:
            session.rollback()
        else:
            session.commit()
    print(report.render(verbose=args.verbose))
    if args.dry_run:
        print("Dry run: nothing was written.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
