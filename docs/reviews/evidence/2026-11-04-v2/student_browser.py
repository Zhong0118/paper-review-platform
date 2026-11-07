"""Run from repo root with Playwright (including Chrome) available to Node."""
import asyncio, base64, json, os, sys, socket
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'backend'))
import uvicorn
from httpx import AsyncClient, ASGITransport, ConnectError
from scripts.acceptance_server import acceptance_environment
from tests.pdf_samples import pdf_bytes
from tests.test_school_programs import login, auth, publish, bind, batch, upload


async def run():
    for port in (8028,5198):
        with socket.socket() as sock:
            sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); sock.bind(('127.0.0.1',port))
    async with acceptance_environment('operations',strict_cleanup=True) as rt:
        async with AsyncClient(transport=ASGITransport(app=rt.app),base_url='http://test') as c:
            school=await login(c,'pilot.school',rt.seed_password)
            cat=await publish(c,school,upload('虚构校内验收专业'))
            assert (await bind(c,school,await batch(c,school),cat)).status_code==200
            school=await login(c,'school.wang',rt.seed_password)
            assert (await c.put('/api/v1/school-admin/discipline-settings',headers=auth(school),
                                json={'codes':['0835'],'expected_version':0})).status_code==200
        srv=uvicorn.Server(uvicorn.Config(rt.app,host='127.0.0.1',port=8028,access_log=False,log_level='error'))
        api=asyncio.create_task(srv.serve())
        vite=await asyncio.create_subprocess_exec('node_modules/.bin/vite','--host','127.0.0.1','--port','5198','--strictPort',
               cwd='frontend', env={**os.environ,'VITE_DEMO_MODE':'false','VITE_API_PROXY_TARGET':'http://127.0.0.1:8028'},stdout=asyncio.subprocess.DEVNULL)
        try:
            async with AsyncClient() as c:
                for _ in range(150):
                    try:
                        if srv.started and (await c.get('http://127.0.0.1:5198')).is_success: break
                    except (OSError, ConnectError): pass
                    await asyncio.sleep(.1)
                else: raise RuntimeError('Acceptance servers failed to start')
            node=await asyncio.create_subprocess_exec('node',str(Path(__file__).with_name('student_browser.cjs')),stdin=asyncio.subprocess.PIPE)
            await node.communicate(json.dumps({'password':rt.seed_password,'pdf':base64.b64encode(pdf_bytes()).decode()}).encode())
            if node.returncode: raise RuntimeError('Browser assertions failed')
        finally:
            vite.terminate(); await vite.wait()
            srv.should_exit=True; await api
if __name__=='__main__': asyncio.run(run())
