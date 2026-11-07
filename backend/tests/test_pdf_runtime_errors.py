import subprocess

import pytest

from app.core.exceptions import AppError
from app.modules.files import transform_runtime


def test_missing_docker_returns_runtime_unavailable(monkeypatch, tmp_path):
    monkeypatch.setenv("PATH", str(tmp_path))
    with pytest.raises(AppError) as error:
        transform_runtime.convert([b"%PDF-synthetic"], "EXTRACT", [[1]], 1024)
    assert error.value.code == "PDF_RUNTIME_UNAVAILABLE"
    assert error.value.http_status == 503


@pytest.mark.parametrize("failure", ["cleanup_timeout", "worker_timeout"])
def test_runtime_failure_survives_cleanup_failure(monkeypatch, failure):
    def run(command, **kwargs):
        if command[1] == "create":
            return subprocess.CompletedProcess(command, 0 if failure == "worker_timeout" else 1,
                                               stdout="a" * 64, stderr="")
        raise subprocess.TimeoutExpired(command, kwargs["timeout"])

    monkeypatch.setattr(transform_runtime.subprocess, "run", run)
    with pytest.raises(AppError) as error:
        transform_runtime.convert([b"%PDF-synthetic"], "EXTRACT", [[1]], 1024)
    assert error.value.code == ("VALIDATION_ERROR" if failure == "worker_timeout" else "PDF_RUNTIME_UNAVAILABLE")
    assert error.value.http_status == (422 if failure == "worker_timeout" else 503)


def test_successful_conversion_does_not_hide_cleanup_failure(monkeypatch):
    import json
    from pathlib import Path
    output = None
    owner = None

    def run(command, **kwargs):
        nonlocal output, owner
        if command[1] == "create":
            owner = command[command.index("--label") + 1].split("=", 1)[1]
            mount = next(value for value in command if value.endswith("dst=/output"))
            output = Path(mount.split("src=", 1)[1].split(",dst=", 1)[0])
            return subprocess.CompletedProcess(command, 0, stdout="a" * 64, stderr="")
        if command[1] == "start":
            (output / "result.pdf").write_bytes(b"%PDF-synthetic")
            (output / "result.json").write_text(json.dumps({"page_count": 1}))
            return subprocess.CompletedProcess(command, 0)
        if command[1] == "inspect":
            return subprocess.CompletedProcess(command, 0, stdout=owner, stderr="")
        if command[1] == "rm":
            raise subprocess.CalledProcessError(1, command)
        raise AssertionError("unexpected Docker operation")

    monkeypatch.setattr(transform_runtime.subprocess, "run", run)
    with pytest.raises(AppError) as error:
        transform_runtime.convert([b"%PDF-synthetic"], "EXTRACT", [[1]], 1024)
    assert error.value.code == "PDF_RUNTIME_UNAVAILABLE"
    assert error.value.http_status == 503
