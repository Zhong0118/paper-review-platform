"""Bounded PDF checks; uncertain text extraction always requires manual review."""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import unicodedata
from typing import TypedDict
from xml.etree import ElementTree

from pypdf import PdfReader

from app.core.config import get_settings
from app.core.exceptions import AppError


def check_size(size: int) -> None:
    if size > get_settings().max_upload_bytes:
        raise AppError("FILE_TOO_LARGE", 413, "文件超过上传大小限制")


class PdfPage(TypedDict):
    page_number: int
    text: str
    uncertain: bool


class PdfInspection(TypedDict):
    pages: list[PdfPage]
    metadata: str
    uncertain: bool


def extract_pdf_pages(data: bytes) -> PdfInspection:
    check_size(len(data))
    try:
        reader = PdfReader(BytesIO(data), strict=True)
        if reader.is_encrypted or not 0 < len(reader.pages) <= 1000:
            raise ValueError("encrypted or invalid page count")
        metadata = " ".join(str(v) for v in (reader.metadata or {}).values())
        uncertain = bool(reader.root_object.get("/AcroForm"))
        xmp = reader.root_object.get("/Metadata")
        if xmp:
            try:
                raw = xmp.get_object().get_data()
                if len(raw) > 2 * 1024 * 1024 or b"<!DOCTYPE" in raw.upper():
                    raise ValueError("unsupported metadata")
                root = ElementTree.fromstring(raw)
                metadata += " " + " ".join(root.itertext())
                metadata += " " + " ".join(v for el in root.iter() for v in el.attrib.values())
            except Exception:
                uncertain = True
        pages = []
        count = 0
        for number, page in enumerate(reader.pages, 1):
            page_uncertain = False
            content = page.get_contents()
            if content is not None and len(content.get_data()) > 2 * 1024 * 1024:
                raise ValueError("page content too large")
            if content is not None and any(op == b"INLINE IMAGE" for _, op in content.operations):
                page_uncertain = True
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
                page_uncertain = True
            resources = page.get("/Resources", {})
            if resources:
                resources = resources.get_object()
            unknown_glyphs = any(
                unicodedata.category(c) in ("Co", "Cn", "Cs")
                or (unicodedata.category(c) == "Cc" and c not in "\n\r\t")
                for c in text
            )
            if (not text.strip() or "\ufffd" in text or unknown_glyphs
                    or resources.get("/XObject") or page.get("/Annots")):
                page_uncertain = True
            uncertain = uncertain or page_uncertain
            count += len(text)
            if count > 2_000_000:
                raise ValueError("extracted text too large")
            pages.append({"page_number": number, "text": text, "uncertain": page_uncertain})
        return {"pages": pages, "metadata": metadata, "uncertain": uncertain}
    except AppError:
        raise
    except Exception as exc:
        raise AppError("VALIDATION_FAILED", 422, "PDF 损坏、加密或超出解析限制，请重新上传") from exc


def inspect_pdf(data: bytes) -> tuple[str, str, bool]:
    result = extract_pdf_pages(data)
    return "\n".join(page["text"] for page in result["pages"]), result["metadata"], result["uncertain"]


def validated_bytes(obj) -> bytes:
    path = Path(obj.storage_key)
    try:
        check_size(path.stat().st_size)
        with path.open("rb") as stream:
            data = stream.read(get_settings().max_upload_bytes + 1)
    except OSError as exc:
        raise AppError("FILE_NOT_READY", 409, "文件尚未上传完成") from exc
    check_size(len(data))
    if not data or len(data) != obj.size_bytes or sha256(data).hexdigest() != obj.sha256:
        raise AppError("FILE_NOT_READY", 409, "文件内容不一致，请重新上传")
    if obj.purpose in ("original", "anonymous") or obj.content_type == "application/pdf":
        if obj.content_type != "application/pdf":
            raise AppError("VALIDATION_FAILED", 422, "论文必须为 PDF")
        inspect_pdf(data)
    return data
