from types import SimpleNamespace
from uuid import UUID
from pathlib import Path

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.modules.thesis.detector import run_anonymization_check
from app.modules.files.models import FileObject
from tests.pdf_samples import pdf_bytes
from tests.helpers import login, auth, create_draft, attach_files, submit_current_draft
from tests.test_file_lifecycle import prepare


@pytest.mark.parametrize('raw, expected, location', [
    (pdf_bytes('作者 林知远'), 'FAIL', 'body'),
    (pdf_bytes('学号 20260042'), 'FAIL', 'body'),
    (pdf_bytes('导师 赵 文 博'), 'FAIL', 'body'),
    (pdf_bytes(author='林知远'), 'FAIL', 'metadata'),
    (pdf_bytes(xmp='<metadata><creator>林知远</creator></metadata>'), 'FAIL', 'metadata'),
    (pdf_bytes(), 'PASS', None),
    (pdf_bytes(blank=True), 'REVIEW_REQUIRED', None),
    (pdf_bytes(image=True), 'REVIEW_REQUIRED', None),
])
def test_real_pdf_detection(raw, expected, location):
    version = SimpleNamespace(title='匿名论文', abstract='', keywords=[])
    elig = SimpleNamespace(student_name='林知远', student_no='20260042', supervisor_name='赵文博')
    file = SimpleNamespace(original_filename='anonymous.pdf')
    conclusion, findings = run_anonymization_check(version, elig, file, raw)
    assert conclusion == expected
    if location:
        assert any(f['location'] == location for f in findings)


@pytest.mark.asyncio
@pytest.mark.parametrize('raw', [b'%PDF-1.4 fake', b'plain text', pdf_bytes()[:-60], pdf_bytes(encrypt=True)])
async def test_reject_invalid_pdf_at_complete(client, raw):
    user = await login(client, 'student.lin')
    draft = await create_draft(client, user)
    data = (await prepare(client, user, draft['id'])).json()['data']
    assert (await client.put(data['upload_url'], headers=auth(user), content=raw)).status_code == 200
    res = await client.post(f"/api/v1/files/{data['file_id']}:complete", headers={**auth(user),"If-Draft-Revision":draft["current_version"]["content_revision"]})
    assert res.status_code == 422, res.text


@pytest.mark.asyncio
async def test_oversize_upload_does_not_replace_previous_bytes(client, db_session, monkeypatch):
    user = await login(client, 'student.lin')
    draft = await create_draft(client, user)
    data = (await prepare(client, user, draft['id'])).json()['data']
    original = pdf_bytes()
    assert (await client.put(data['upload_url'], headers=auth(user), content=original)).status_code == 200
    # Existing settings currently ignores unknown fields; this overrides only this test's limit.
    monkeypatch.setitem(get_settings().__dict__, 'max_upload_bytes', len(original))
    res = await client.put(data['upload_url'], headers=auth(user), content=original+b'extra')
    assert res.status_code == 413, res.text
    obj = await db_session.get(FileObject, UUID(data['file_id']))
    assert Path(obj.storage_key).read_bytes() == original


@pytest.mark.asyncio
async def test_historical_fake_pdf_cannot_submit(client, db_session):
    user = await login(client, 'student.lin')
    draft = await create_draft(client, user)
    await attach_files(client, user, draft['id'], original_bytes=pdf_bytes(), anonymous_bytes=pdf_bytes())
    obj = (await db_session.execute(select(FileObject).where(FileObject.purpose == 'anonymous'))).scalar_one()
    from hashlib import sha256
    raw = b'%PDF legacy placeholder'
    Path(obj.storage_key).write_bytes(raw)
    obj.size_bytes = len(raw)
    obj.sha256 = sha256(raw).hexdigest()
    await db_session.flush()
    res = await submit_current_draft(client, f"/api/v1/theses/{draft['id']}:submit", headers=auth(user), json={'version':draft['version']})
    assert res.status_code == 422, res.text


def test_literal_encrypt_is_not_encrypted_pdf():
    from app.modules.files.pdf import inspect_pdf
    assert "/Encrypt" in inspect_pdf(pdf_bytes("The literal /Encrypt is ordinary text"))[0]


@pytest.mark.parametrize("field", ["title", "abstract", "keywords"])
def test_thesis_metadata_is_checked(field):
    version = SimpleNamespace(title="", abstract="", keywords=[])
    setattr(version, field, ["林知远"] if field == "keywords" else "林知远")
    eligibility = SimpleNamespace(student_name="林知远", student_no="20260042", supervisor_name="")
    conclusion, findings = run_anonymization_check(
        version, eligibility, SimpleNamespace(original_filename="anonymous.pdf"), pdf_bytes()
    )
    assert conclusion == "FAIL"
    assert findings[0]["location"] == "metadata"


@pytest.mark.asyncio
@pytest.mark.parametrize("purpose", ["original", "anonymous"])
async def test_thesis_cannot_be_declared_plain_text(client, purpose):
    user = await login(client, "student.lin")
    draft = await create_draft(client, user)
    res = await client.post("/api/v1/files:prepare-upload", headers=auth(user), json={
        "thesis_id": draft["id"], "purpose": purpose,
        "filename": "paper.txt", "content_type": "text/plain",
    })
    data = res.json()["data"]
    await client.put(data["upload_url"], headers=auth(user), content=b"ordinary text")
    res = await client.post(f"/api/v1/files/{data['file_id']}:complete", headers={**auth(user),"If-Draft-Revision":draft["current_version"]["content_revision"]})
    assert res.status_code == 422


def test_inline_image_requires_manual_review():
    version = SimpleNamespace(title="", abstract="", keywords=[])
    eligibility = SimpleNamespace(student_name="林知远", student_no="20260042", supervisor_name="")
    conclusion, _ = run_anonymization_check(
        version, eligibility, SimpleNamespace(original_filename="anonymous.pdf"), pdf_bytes(inline_image=True)
    )
    assert conclusion == "REVIEW_REQUIRED"


def test_unknown_glyphs_require_manual_review():
    from io import BytesIO
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import DecodedStreamObject, NameObject
    from app.modules.files.pdf import inspect_pdf
    writer = PdfWriter(clone_from=PdfReader(BytesIO(pdf_bytes())))
    content = DecodedStreamObject()
    content.set_data(b"BT /F1 12 Tf 50 700 Td (Neutral paper text \\001\\002\\003) Tj ET")
    writer.pages[0][NameObject("/Contents")] = writer._add_object(content)
    output = BytesIO()
    writer.write(output)
    assert inspect_pdf(output.getvalue())[2] is True
