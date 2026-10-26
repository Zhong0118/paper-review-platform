# pydantic请求和响应
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.user.schema import CreateTenantUserInput


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OrganizationInput(StrictModel):
    external_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)


class CreateTenantInput(StrictModel):
    institution_code: str | None = Field(default=None, pattern=r"^[0-9]{10}$")
    code: str = Field(min_length=2, max_length=32, pattern=r"^[a-z0-9-]+$")
    name: str = Field(min_length=1, max_length=128)
    organization: OrganizationInput
    reviewer: CreateTenantUserInput

    @field_validator("code", mode="before")
    @classmethod
    def normalize_code(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value


class CreateBatchInput(StrictModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=128)
    start_at: datetime | None = None
    end_at: datetime | None = None


class UpdateBatchInput(StrictModel):
    name: str = Field(min_length=1, max_length=128)
    start_at: datetime | None = None
    end_at: datetime | None = None
    expected_version: int = Field(ge=1)


class VersionInput(StrictModel):
    expected_version: int = Field(ge=1)


class CreateEligibilityInput(StrictModel):
    student_membership_id: UUID
    supervisor_membership_id: UUID | None = None
    degree_type: str | None = Field(default=None, max_length=32)
