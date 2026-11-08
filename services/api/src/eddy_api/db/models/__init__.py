"""Every table, imported here so Alembic sees the whole schema (SPEC.md section 6)."""

from eddy_api.db.models.accounts import (
    Account,
    InviteCode,
    NoticeAcknowledgement,
    ParentLink,
    Session,
    StudentProfile,
    User,
    VerificationToken,
)
from eddy_api.db.models.curriculum import (
    CurriculumNode,
    CurriculumSpec,
    Item,
    ItemFamily,
    Misconception,
    NodePrerequisite,
    Topic,
    TopicNode,
)
from eddy_api.db.models.english import LevelDescriptor, QuestionType, SetText
from eddy_api.db.models.governance import AuditLog, DataRequest, SafeguardingEvent
from eddy_api.db.models.learning import Attempt, MasteryState, MisconceptionState, ReviewCard
from eddy_api.db.models.scenes import AudioAsset, SceneInstance, SceneSpec
from eddy_api.db.models.tutor import LlmCall, TutorMessage, TutorSession

__all__ = [
    "Account",
    "Attempt",
    "AudioAsset",
    "AuditLog",
    "CurriculumNode",
    "CurriculumSpec",
    "DataRequest",
    "InviteCode",
    "Item",
    "ItemFamily",
    "LevelDescriptor",
    "LlmCall",
    "MasteryState",
    "Misconception",
    "MisconceptionState",
    "NodePrerequisite",
    "NoticeAcknowledgement",
    "ParentLink",
    "QuestionType",
    "ReviewCard",
    "SafeguardingEvent",
    "SceneInstance",
    "SceneSpec",
    "Session",
    "SetText",
    "StudentProfile",
    "Topic",
    "TopicNode",
    "TutorMessage",
    "TutorSession",
    "User",
    "VerificationToken",
]
