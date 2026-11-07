"""Start an isolated, real-role acceptance API for the correction browser probe."""
import asyncio
import json
from pathlib import Path
import sys
import tempfile
import secrets
import os

sys.path.insert(0, str(Path.cwd() / 'backend'))
os.environ['SEED_PASSWORD'] = secrets.token_urlsafe(24)
import uvicorn
from httpx import ASGITransport, AsyncClient
from pypdf import PdfReader
from scripts.acceptance_server import acceptance_environment
from tests.helpers import auth, login


async def main():
    async with acceptance_environment('published') as rt:
        async with AsyncClient(transport=ASGITransport(app=rt.app), base_url='http://fixture') as c:
            ex, platform = [await login(c, name, rt.seed_password) for name in ('expert.zhou', 'platform.chen')]
            url = f'/api/v1/expert-tasks/{rt.task_id}/corrections'
            data = (await c.get(url, headers=auth(ex))).json()['data']
            req = await c.post(url, headers=auth(ex, 'browser-request'), json={
                'base_result_id': data['base_result_id'], 'base_revision_id': None, 'reason':'虚构的私有申请理由'})
            req.raise_for_status()
            row = req.json()['data']
            accepted = await c.post(f'/api/v1/platform-review/corrections/{row["id"]}:decide',
                headers=auth(platform, 'browser-decide'), json={'version':row['version'], 'decision':'APPROVE', 'reason':'检查录入'})
            accepted.raise_for_status()
        server = uvicorn.Server(uvicorn.Config(rt.app, host='127.0.0.1', port=18249, access_log=False, log_level='error'))
        task = asyncio.create_task(server.serve())
        try:
            while not server.started and not task.done():
                await asyncio.sleep(.05)
            assert server.started
            with tempfile.TemporaryDirectory(prefix='correction-pdf-') as folder:
                dest = Path(folder)/'current.pdf'
                proc = await asyncio.create_subprocess_exec('node', str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE)
                await proc.communicate(json.dumps(dict(task=rt.task_id, thesis=rt.thesis_id, request=row['id'],
                    password=rt.seed_password, pdf=str(dest))).encode())
                assert proc.returncode == 0
                doc = PdfReader(dest)
                content = ''.join(page.extract_text() for page in doc.pages)
                assert '发布版本：2' in content and '请补充样本规模的对照表' in content
                assert all(x not in content + str(doc.metadata) for x in ['虚构的私有申请理由','私有优点','私有分项','周明远','expert.zhou'])
                print('PDF actual: 发布版本：2 / 修改建议：请补充样本规模的对照表 / private canaries absent')
                if os.environ.get('CORRECTION_QA_DIR'):
                    import subprocess
                    subprocess.run(['pdftoppm','-singlefile','-scale-to','720','-x','46','-y','87','-W','430','-H','388','-png',str(dest),
                                    str(Path(os.environ['CORRECTION_QA_DIR'])/'published-pdf')],check=True)
        finally:
            server.should_exit=True
            await task


if __name__ == '__main__':
    asyncio.run(main())
