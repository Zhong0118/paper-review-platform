from hashlib import sha256
import os
from tempfile import NamedTemporaryFile
from pathlib import Path
from uuid import UUID

from app.core.config import get_settings
from app.shared.enums import FilePurpose


def purpose_dir(purpose: str) -> str:
    if purpose == FilePurpose.ORIGINAL:
        return "original"
    if purpose == FilePurpose.ANONYMOUS:
        return "anonymous"
    return purpose


def storage_path(tenant_id: UUID, thesis_id: UUID, file_id: UUID, purpose: str) -> Path:
    root = Path(get_settings().storage_root)
    path = root / purpose_dir(purpose) / str(tenant_id) / str(thesis_id) / str(file_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def write_bytes(path: Path, data: bytes) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return sha256(data).hexdigest()


def read_bytes(path: Path) -> bytes:
    return path.read_bytes()
