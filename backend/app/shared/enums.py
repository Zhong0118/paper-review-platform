from enum import StrEnum


class RoleCode(StrEnum):
    SYSTEM_ADMIN = "system_admin"
    SCHOOL_REVIEWER = "school_reviewer"
    PLATFORM_REVIEWER = "platform_reviewer"
    STUDENT = "student"
    SUPERVISOR = "supervisor"
    EXPERT = "expert"


class TenantStatus(StrEnum):
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    CLOSED = "CLOSED"


class BatchStatus(StrEnum):
    DRAFT = "DRAFT"
    OPEN = "OPEN"
    SUBMISSION_CLOSED = "SUBMISSION_CLOSED"
    ARCHIVED = "ARCHIVED"


class OrgType(StrEnum):
    COLLEGE = "COLLEGE"
    MAJOR = "MAJOR"
    DEPT = "DEPT"
    OTHER = "OTHER"


class UserStatus(StrEnum):
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"
    LOCKED = "LOCKED"


class MembershipType(StrEnum):
    STUDENT = "STUDENT"
    SUPERVISOR = "SUPERVISOR"
    STAFF = "STAFF"
    OTHER = "OTHER"


class EligibilityStatus(StrEnum):
    ELIGIBLE = "ELIGIBLE"
    SUSPENDED = "SUSPENDED"
    EXPIRED = "EXPIRED"
    REVOKED = "REVOKED"


class ThesisStage(StrEnum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    PREPARING = "PREPARING"
    READY_FOR_DISPATCH = "READY_FOR_DISPATCH"
    UNDER_REVIEW = "UNDER_REVIEW"
    RESULT_PROCESSING = "RESULT_PROCESSING"
    COMPLETED = "COMPLETED"
    TERMINATED = "TERMINATED"


class SubmissionSource(StrEnum):
    STUDENT = "STUDENT"
    SCHOOL_MANUAL = "SCHOOL_MANUAL"
    SCHOOL_BATCH = "SCHOOL_BATCH"


class FilePurpose(StrEnum):
    ORIGINAL = "original"
    ANONYMOUS = "anonymous"
    ATTACHMENT = "attachment"
    QUALIFICATION = "qualification"
    OBJECTION = "objection"
    EXPORT = "export"


class AnonymizationConclusion(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"


class FileScanStatus(StrEnum):
    PENDING = "PENDING"
    CLEAN = "CLEAN"
    FAILED = "FAILED"
