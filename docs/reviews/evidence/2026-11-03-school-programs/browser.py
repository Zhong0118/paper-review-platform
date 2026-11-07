import sys,asyncio,json,base64
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'backend'))
from scripts.acceptance_server import acceptance_environment
from tests.pdf_samples import pdf_bytes
import uvicorn
async def run():
 async with acceptance_environment('operations') as runtime:
  srv=uvicorn.Server(uvicorn.Config(runtime.app,host='127.0.0.1',port=18237,access_log=False,log_level='error'))
  job=asyncio.create_task(srv.serve())
  try:
   while not srv.started and not job.done():await asyncio.sleep(.05)
   assert srv.started
   p=await asyncio.create_subprocess_exec('node',str(Path(__file__).with_name('browser.cjs')),stdin=asyncio.subprocess.PIPE)
   await p.communicate(json.dumps(dict(password=runtime.seed_password,pdf=base64.b64encode(pdf_bytes()).decode())).encode())
   if p.returncode:raise RuntimeError('browser acceptance failed')
  finally:
   srv.should_exit=True
   await job
asyncio.run(run())
