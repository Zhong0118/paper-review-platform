from datetime import datetime
from urllib.parse import urlsplit
from pydantic import BaseModel, StrictBool
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
    province_name: str | None
    doctoral_supervisor: bool | None
    masters_supervisor: bool | None
    research_directions: list[str]
    keywords: list[str]
    source_url: str | None
    source_note: str | None
    source_checked_at: datetime | None
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

    province_name: str | None = Field(default=None,max_length=128)
    doctoral_supervisor: StrictBool | None = None
    masters_supervisor: StrictBool | None = None
    research_directions: list[str] = Field(default_factory=list,max_length=20)
    keywords: list[str] = Field(default_factory=list,max_length=20)
    source_url: str | None = Field(default=None,max_length=2048)
    source_note: str | None = Field(default=None,max_length=1000)

    @field_validator('unit','title','province_name','source_url','source_note',
                     'discipline_codes','research_directions','keywords',mode='before')
    @classmethod
    def database_text(cls,value):
        values=value if isinstance(value,list) else [value]
        if any(isinstance(v,str) and '\x00' in v for v in values):
            raise ValueError('文本不能包含空字符')
        return value

    @field_validator('province_name','source_url','source_note',mode='before')
    @classmethod
    def nullable_text(cls,value):
        return (value.strip() or None) if isinstance(value,str) else value

    @field_validator('research_directions','keywords')
    @classmethod
    def tags(cls,value):
        values = [v.strip() for v in value]
        if any(not 2 <= len(v) <= 64 for v in values):
            raise ValueError('每个标签须为2–64个字符')
        return sorted(set(values))

    @field_validator('source_url')
    @classmethod
    def source_link(cls,value):
        if value:
            url = urlsplit(value)
            if url.scheme not in ('http','https') or not url.hostname or url.username or url.password or any(c.isspace() for c in value):
                raise ValueError('来源须为不含账号密码的HTTP/HTTPS链接')
        return value

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


class ImportApplyInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    preview_id: UUID
