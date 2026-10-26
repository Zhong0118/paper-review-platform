from pydantic import BaseModel
from uuid import UUID


class ExpertConflictView(BaseModel):
    kind: str
    value: str


class ExpertView(BaseModel):
    id: UUID
    user_id: UUID
    username: str
    display_name: str
    account_status: str
    unit: str
    title: str
    discipline_codes: list[str]
    qualification_status: str
    service_status: str
    conflicts: list[ExpertConflictView]
    version: int

from typing import Literal
from pydantic import ConfigDict, Field, field_validator, model_validator


class ProfileFields(BaseModel):
    model_config = ConfigDict(extra='forbid')
    unit: str = Field(max_length=128)
    title: str = Field(max_length=128)
    discipline_codes: list[str] = Field(min_length=1,max_length=20)

    @field_validator('unit','title',mode='before')
    @classmethod
    def trim(cls,value):
        return value.strip() if isinstance(value,str) else value

    @field_validator('discipline_codes')
    @classmethod
    def codes(cls,value):
        if any(not v.strip() for v in value): raise ValueError('discipline code is empty')
        return sorted(set(v.strip() for v in value))


class CreateExpertInput(ProfileFields):
    username: str = Field(min_length=3,max_length=64,pattern=r'^[a-z0-9._-]+$')
    display_name: str = Field(min_length=1,max_length=128)
    initial_password: str = Field(min_length=12,max_length=128)

    @field_validator('username',mode='before')
    @classmethod
    def username_value(cls,value):
        return value.strip().lower() if isinstance(value,str) else value

    @field_validator('display_name',mode='before')
    @classmethod
    def name_value(cls,value):
        return value.strip() if isinstance(value,str) else value


class UpdateExpertInput(ProfileFields):
    version: int = Field(strict=True,ge=1)


class VersionReason(BaseModel):
    model_config=ConfigDict(extra='forbid')
    version: int = Field(strict=True,ge=1)
    reason: str = Field(min_length=1,max_length=500)

    @field_validator('reason',mode='before')
    @classmethod
    def trim_reason(cls,value):
        return value.strip() if isinstance(value,str) else value


class QualificationInput(VersionReason):
    status: Literal['APPROVED','REJECTED']


class ServiceStatusInput(VersionReason):
    status: Literal['AVAILABLE','UNAVAILABLE']


class ConflictInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    kind: Literal['SUPERVISOR_NAME','TENANT_ID']
    value: str = Field(min_length=1,max_length=128)

    @field_validator('value',mode='before')
    @classmethod
    def trim_value(cls,value):
        return value.strip() if isinstance(value,str) else value

    @model_validator(mode='after')
    def canonical_value(self):
        if self.kind=='TENANT_ID': self.value=str(UUID(self.value))
        return self


class ConflictsInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    version: int = Field(strict=True,ge=1)
    items: list[ConflictInput] = Field(max_length=100)
