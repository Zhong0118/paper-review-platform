from pathlib import Path
import json,sys,socket
root=next(parent for parent in Path(__file__).resolve().parents if (parent/'AGENTS.md').is_file())
scratch=root/'.superpowers/sdd/2026-10-29-post-commit-acceptance'
sys.path.insert(0,str(root/'backend'))
from sqlalchemy import create_engine,text
from tests.conftest import _test_url
context=json.loads((scratch/'browser-context.json').read_text())
engine=create_engine(_test_url().replace('+asyncpg','+psycopg'))
try:
    with engine.connect() as conn:
        result={'postgres_version':conn.scalar(text('SHOW server_version')),
          'owned_schema_remaining':conn.scalar(text('SELECT count(*) FROM pg_namespace WHERE nspname=:name'), {'name':context['schema']}),
          'owned_roles_remaining':conn.scalar(text('SELECT count(*) FROM pg_roles WHERE rolname IN (:owner,:business,:auth)'),{k:context['role_prefix']+'_'+k for k in ('owner','business','auth')}),
          'owned_storage_exists':Path(context['storage_root']).exists(),
          'temporary_password_exists':(scratch/'browser-password').exists()}
    for port in (8013,5177):
        with socket.socket() as sock:
            result[f'port_{port}_listening']=sock.connect_ex(('127.0.0.1',port))==0
    print(json.dumps(result,indent=2))
finally:engine.dispose()
