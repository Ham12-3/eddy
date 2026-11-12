"""The signed-in student behind a request (ADR-0018, ADR-0032).

A student token's subject is the account id. Routes that act for a student load the account
and refuse one that is unknown or deactivated: deleting an account stops it working at once,
even with a token minted a moment before.
"""

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from eddy_api.auth import Caller, require_roles
from eddy_api.db.models import StudentProfile, User
from eddy_api.db.session import get_session


def current_student(
    caller: Annotated[Caller, Depends(require_roles("student"))],
    session: Annotated[Session, Depends(get_session)],
) -> User:
    try:
        user_id = uuid.UUID(caller.subject)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Unknown account.") from None
    user = session.get(User, user_id)
    if user is None or user.role != "student" or user.deactivated_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Unknown account.")
    return user


Student = Annotated[User, Depends(current_student)]


def profile_of(session: Session, user: User) -> StudentProfile:
    profile = session.get(StudentProfile, user.id)
    if profile is None:
        # Every student account is made with its profile (routes/accounts.py).
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This account has no profile.")
    return profile
