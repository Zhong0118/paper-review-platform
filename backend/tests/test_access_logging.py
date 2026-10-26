import logging
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import threading
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest


@pytest.mark.parametrize('target', [
    '/api/v1/files/sample?token=SYNTHETIC_SENTINEL',
    '/api/v1/files/sample?%74oken=SYNTHETIC_SENTINEL&extra=hidden',
    '/api/v1/files/sample',
])
def test_access_query_removed(target):
    from app.core.logging import RedactAccessQueryFilter
    record = logging.LogRecord('uvicorn.access', logging.INFO, '', 0,
        '%s - "%s %s HTTP/%s" %d', ('client', 'GET', target, '1.1', 404), None)
    assert RedactAccessQueryFilter().filter(record)
    assert record.args == ('client', 'GET', '/api/v1/files/sample', '1.1', 404)
    assert 'SYNTHETIC_SENTINEL' not in record.getMessage()


@pytest.mark.parametrize('args', [(), ('private',), ('c', 'GET', None, '1.1', 200)])
def test_unrecognized_access_record_is_not_echoed(args):
    from app.core.logging import RedactAccessQueryFilter
    record = logging.LogRecord('uvicorn.access', logging.INFO, '', 0, 'private', args, None)
    assert RedactAccessQueryFilter().filter(record)
    assert record.getMessage() == 'Access log omitted: unrecognized record'


def test_application_creation_installs_filter_once():
    from app.core.logging import RedactAccessQueryFilter
    from app.main import create_app
    create_app()
    create_app()
    assert sum(isinstance(f, RedactAccessQueryFilter)
               for f in logging.getLogger('uvicorn.access').filters) == 1


@pytest.mark.parametrize('entry', ['cli', 'acceptance'])
def test_real_uvicorn_logs_hide_query_and_preserve_download_behavior(entry):
    from app.core.config import get_settings
    from tests.conftest import _test_url
    from tests.test_acceptance_server import schema_names
    from tests.test_review import VALID_DRAFT

    before = schema_names()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    command = ([sys.executable, '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', str(port)]
               if entry == 'cli' else [sys.executable, '-m', 'scripts.acceptance_server',
                                      '--scenario', 'accepted', '--port', str(port)])
    process = subprocess.Popen(command, cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, 'DATABASE_URL': _test_url(), 'APP_ENV': 'development'},
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    lines = []
    reader = threading.Thread(target=lambda: lines.extend(process.stdout), daemon=True)
    reader.start()
    private_values = ['SYNTHETIC_SENTINEL']
    storage = None
    try:
        with httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=10) as client:
            for _ in range(300):
                if process.poll() is not None:
                    pytest.fail('server exited before readiness (output intentionally withheld)')
                try:
                    if client.get('/openapi.json').status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                time.sleep(.1)
            else:
                pytest.fail('server readiness timed out')
            assert client.get('/missing?token=SYNTHETIC_SENTINEL').status_code == 404
            if entry == 'acceptance':
                response = client.post('/api/v1/auth/login', json={
                    'username': 'expert.zhou', 'password': get_settings().seed_password})
                assert response.status_code == 200
                headers = {'Authorization': 'Bearer ' + response.json()['data']['access_token']}
                task_id = client.get('/api/v1/expert/tasks', headers=headers).json()['data'][0]['id']
                files = client.get(f'/api/v1/expert/tasks/{task_id}/materials', headers=headers).json()['data']['files']
                fid = files[0]['file_id']
                grant = client.post(f'/api/v1/files/{fid}:authorize-download', headers=headers)
                assert grant.status_code == 200
                url = grant.json()['data']['url']
                private_values.append(parse_qs(urlparse(url).query)['token'][0])
                assert client.get(url).status_code == 200
                assert client.post(f'/api/v1/expert/tasks/{task_id}:submit-final',
                                   headers=headers, json=VALID_DRAFT).status_code == 200
                assert client.get(url).status_code == 404
                assert client.get(f'/api/v1/files/{fid}/content?token=SYNTHETIC_SENTINEL').status_code in (401, 404)
    finally:
        process.send_signal(signal.SIGINT) if process.poll() is None else None
        try:
            process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            pytest.fail('server did not shut down cleanly')
        reader.join(timeout=5)
        process.stdout.close()
        for line in lines:
            if line.startswith('storage_root='):
                storage = Path(line.strip().split('=', 1)[1])
        assert schema_names() == before
        if storage:
            assert not storage.exists()
    output = ''.join(lines)
    # Keep credentials and server output out of assertion failure rendering.
    leaked = any(value in output for value in private_values)
    assert not leaked, 'access logs disclosed a query value'
    assert 'GET /missing HTTP/1.1" 404' in output
    if entry == 'acceptance':
        assert f'GET /api/v1/files/{fid}/content HTTP/1.1" 200' in output
        assert f'GET /api/v1/files/{fid}/content HTTP/1.1" 404' in output
