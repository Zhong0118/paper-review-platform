"""Import ORM modules so metadata is complete for Alembic."""

from app.modules.audit.models import AuditEvent, IdempotencyKey  # noqa: F401
from app.modules.auth.models import AuthSession  # noqa: F401
from app.modules.files.models import FileObject  # noqa: F401
from app.modules.tenant.models import DisciplineCatalog, Organization, ReviewBatch, Tenant  # noqa: F401
from app.modules.thesis.models import (  # noqa: F401
    AnonymizationCheck,
    Thesis,
    ThesisVersion,
    ThesisVersionFile,
)
from app.modules.user.models import (  # noqa: F401
    Role,
    StudentEligibility,
    TenantUserMembership,
    User,
    UserRoleAssignment,
)
from app.modules.workflow.models import TerminationRecord, WorkflowEvent  # noqa: F401
from app.modules.expert.models import Expert, ExpertConflict  # noqa: F401
from app.modules.dispatch.models import ExpertTask, ReviewRound  # noqa: F401
from app.modules.review.models import ReviewDraft, ReviewResultVersion  # noqa: F401
from app.modules.result.models import ResultPublication, ResultSummary  # noqa: F401
from app.modules.result.objection_models import Objection  # noqa: F401
