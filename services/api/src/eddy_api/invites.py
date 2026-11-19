"""`python -m eddy_api.invites CODE --cohort NAME --uses N`: create or top up an invite code.

Runs as the schema owner (DATABASE_URL), on this machine unless --allow-remote.
"""

import argparse
import sys
from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from eddy_api.config import get_settings
from eddy_api.db.local import is_local
from eddy_api.db.models import InviteCode
from eddy_api.routes.accounts import normalise_invite


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m eddy_api.invites", description=__doc__)
    parser.add_argument("code")
    parser.add_argument("--cohort", default="beta")
    parser.add_argument("--uses", type=int, default=30)
    parser.add_argument("--days", type=int, default=60, help="days until it expires")
    parser.add_argument("--allow-remote", action="store_true")
    args = parser.parse_args(argv)
    code = normalise_invite(args.code)
    if not 8 <= len(code) <= 32:
        print(
            "An invite code needs 8 to 32 letters or digits, so it cannot be guessed.",
            file=sys.stderr,
        )
        return 2
    url = get_settings().database_url.get_secret_value()
    if not is_local(url) and not args.allow_remote:
        print(
            "Refusing: that database is not on this machine. Pass --allow-remote.", file=sys.stderr
        )
        return 2
    engine = create_engine(url)
    expires = datetime.now(UTC) + timedelta(days=args.days)
    with Session(engine) as session:
        session.execute(
            insert(InviteCode)
            .values(
                code=code, cohort=args.cohort, max_uses=args.uses, used_count=0, expires_at=expires
            )
            .on_conflict_do_update(
                index_elements=[InviteCode.code],
                set_={"max_uses": args.uses, "expires_at": expires, "cohort": args.cohort},
            )
        )
        session.commit()
    engine.dispose()
    print(f"Invite {code} ({args.cohort}): {args.uses} uses, expires {expires:%d %B %Y}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
