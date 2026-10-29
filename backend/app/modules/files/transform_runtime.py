"""Run a single conversion in an owned, disposable, networkless Docker sandbox."""
import json
import logging
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from app.core.exceptions import AppError

IMAGE = 'paper-review-pdf-worker:6.19.0'
TIMEOUT_SECONDS = 60


def convert(inputs: list[bytes], operation: str, pages: list[list[int]], max_bytes: int) -> tuple[bytes, int]:
    owner = str(uuid4())
    container = f'paper-review-transform-{owner}'
    with TemporaryDirectory(prefix='paper-review-transform-') as temporary:
        root = Path(temporary)
        source, output = root / 'input', root / 'output'
        source.mkdir(mode=0o755)
        output.mkdir(mode=0o777)
        output.chmod(0o777)
        for i, data in enumerate(inputs):
            path = source / f'{i}.pdf'
            path.write_bytes(data)
            path.chmod(0o444)
        request = source / 'request.json'
        request.write_text(json.dumps({'operation': operation, 'pages': pages, 'max_bytes': max_bytes}))
        request.chmod(0o444)
        try:
            created = subprocess.run(['docker', 'create', '--name', container, '--pull=never', '--label', f'paper-review.transform={owner}',
                '--network=none', '--memory=512m', '--memory-swap=512m', '--cpus=1', '--pids-limit=32',
                '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=65534:65534',
                '--ulimit', 'nofile=128:128', '--ulimit', f'fsize={max_bytes}:{max_bytes}',
                '--mount', f'type=bind,src={source},dst=/input,readonly',
                '--mount', f'type=bind,src={output},dst=/output', IMAGE],
                capture_output=True, text=True, timeout=20)
            if created.returncode:
                raise AppError('PDF_RUNTIME_UNAVAILABLE', 503, 'PDF转换环境不可用，请检查本机Docker与转换镜像')
            container = created.stdout.strip()
            if len(container) != 64 or any(c not in '0123456789abcdef' for c in container):
                raise AppError('PDF_RUNTIME_UNAVAILABLE', 503, 'PDF转换环境返回异常')
            ran = subprocess.run(['docker', 'start', '-a', container], stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL, timeout=TIMEOUT_SECONDS)
            if ran.returncode or not (output / 'result.json').exists():
                raise AppError('VALIDATION_ERROR', 422, 'PDF不支持转换、页码无效或超过资源限制')
            with (output / 'result.pdf').open('rb') as stream:
                result = stream.read(max_bytes + 1)
            count = json.loads((output / 'result.json').read_text())['page_count']
            if not result or len(result) > max_bytes or type(count) is not int or not 1 <= count <= 1000:
                raise AppError('VALIDATION_ERROR', 422, 'PDF转换结果无效')
            return result, count
        except subprocess.TimeoutExpired as exc:
            raise AppError('VALIDATION_ERROR', 422, 'PDF转换超时，请减少页数后重试') from exc
        except OSError as exc:
            raise AppError('PDF_RUNTIME_UNAVAILABLE', 503, 'PDF转换环境不可用') from exc
        finally:
            active_error = sys.exception()
            if container:
                try:
                    check = subprocess.run(['docker', 'inspect', '--format', '{{index .Config.Labels "paper-review.transform"}}', container],
                                           capture_output=True, text=True, timeout=10)
                    if check.returncode == 0 and check.stdout.strip() == owner:
                        subprocess.run(['docker', 'rm', '-f', container], capture_output=True, timeout=10, check=True)
                except (OSError, subprocess.SubprocessError) as exc:
                    logging.getLogger(__name__).warning('PDF worker cleanup failed for %s (%s)', container, type(exc).__name__)
                    if active_error is None:
                        raise AppError('PDF_RUNTIME_UNAVAILABLE', 503, 'PDF转换环境清理失败，请稍后重试') from exc
