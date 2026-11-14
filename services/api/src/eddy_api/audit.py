"""The append-only audit log (SPEC.md section 6.5): who did what, never what they wrote.

The runtime role may only read and add rows (ADR-0024). A row holds ids, a role and an action
name such as `account.create`, never an email address or a student's words.
"""

import uuid

from sqlalchemy.orm import Session

from eddy_api.db.models import AuditLog


def record(
    session: Session,
    *,
    actor_id: uuid.UUID | None,
    actor_role: str,
    action: str,
    target_type: str,
    target_id: object | None = None,
) -> None:
    session.add(
        AuditLog(
            actor_id=actor_id,
            actor_role=actor_role,
            action=action,
            target_type=target_type,
            target_id=None if target_id is None else str(target_id),
        )
    )
