import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.exceptions import AppError
from app.modules.auth.deps import CurrentUser
from app.modules.files.models import FileObject
from app.modules.files import service as files
from app.modules.thesis.service import create_draft, DraftInput
from app.modules.thesis.models import ThesisVersionFile
from app.modules.user.models import User, TenantUserMembership
from app.seed import seed_database
from tests.conftest import migrated_test_schema, _test_url


@pytest.mark.asyncio
@pytest.mark.parametrize('completed', [True, False])
async def test_upgrade_preserves_legacy_file_and_disables_writes(tmp_path, completed):
    with migrated_test_schema('0006_open_objection') as schema:
        engine = create_async_engine(_test_url(), connect_args={'server_settings': {'search_path': schema}})
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        file_id = uuid4()
        path = tmp_path / 'legacy'
        path.write_bytes(b'old bytes')
        try:
            async with sessions() as session:
                await seed_database(session)
                owner = (await session.execute(select(User).where(User.username == 'student.lin'))).scalar_one()
                member = (await session.execute(select(TenantUserMembership).where(TenantUserMembership.user_id == owner.id))).scalar_one()
                user = CurrentUser(id=owner.id, tenant_id=member.tenant_id, role='student', data_scope={})
                thesis = await create_draft(session, user, DraftInput(title='migration', abstract='', discipline_code='0812', discipline_name='计算机科学与技术', keywords=["migration"]))
                version_id = thesis.current_version_id
                await session.execute(text('''INSERT INTO file_objects
                    (id, tenant_id, purpose, storage_key, original_filename, content_type,
                     size_bytes, sha256, scan_status, uploaded_by, completed_at)
                    VALUES (:id, :tenant, 'anonymous', :path, 'old.pdf', 'application/pdf',
                            9, 'legacy-hash', 'CLEAN', :owner, CASE WHEN :completed THEN now() ELSE NULL END)'''),
                    {'id': file_id, 'tenant': user.tenant_id, 'path': str(path), 'owner': user.id, 'completed': completed})
                if completed:
                    session.add(ThesisVersionFile(thesis_version_id=version_id, file_id=file_id, purpose='anonymous'))
                await session.commit()
            subprocess.run([sys.executable, '-m', 'alembic', 'upgrade', 'head'],
                           cwd=Path(__file__).resolve().parents[1], check=True, capture_output=True,
                           env={**os.environ, 'DATABASE_URL': _test_url(), 'PGOPTIONS': f'-c search_path={schema}'})
            async with sessions() as session:
                obj = await session.get(FileObject, file_id)
                assert obj.upload_version_id is None
                assert obj.sha256 == 'legacy-hash'
                with pytest.raises(AppError) as error:
                    await files.put_content(session, user, file_id, b'new')
                assert error.value.http_status == 409
                if completed:
                    assert (await files.complete_upload(session, user, file_id)).id == file_id
                    link = (await session.execute(select(ThesisVersionFile).where(ThesisVersionFile.file_id == file_id))).scalar_one()
                    assert link.thesis_version_id == version_id
                else:
                    with pytest.raises(AppError) as error:
                        await files.complete_upload(session, user, file_id)
                    assert error.value.http_status == 409
                assert path.read_bytes() == b'old bytes'
        finally:
            await engine.dispose()
