import os
from pathlib import Path
import selectors
import signal
import socket
import subprocess
import sys
import time

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from tests.conftest import _test_url


def schema_names() -> set[str]:
    engine = create_engine(_test_url().replace("+asyncpg", "+psycopg"))
    try:
        with engine.connect() as conn:
            return set(
                conn.execute(
                    text(
                        "SELECT schema_name FROM information_schema.schemata "
                        "WHERE schema_name LIKE 'test\\_%' ESCAPE '\\'"
                    )
                ).scalars()
            )
    finally:
        engine.dispose()


def test_database_target_rejects_non_test_host_or_port():
    from scripts.acceptance_server import validate_database_target

    assert (
        validate_database_target("postgresql+asyncpg://user:secret@127.0.0.1:5433/paper_review")
        == "postgresql+asyncpg://user:secret@127.0.0.1:5433/paper_review_test"
    )
    with pytest.raises(ValueError, match="5433"):
        validate_database_target("postgresql+asyncpg://user:secret@127.0.0.1:5432/paper_review")
    with pytest.raises(ValueError, match="loopback"):
        validate_database_target("postgresql+asyncpg://user:secret@db.example:5433/paper_review")


@pytest.mark.parametrize("port", [0, 1023, 65536])
def test_port_rejects_values_outside_unprivileged_range(port: int):
    from scripts.acceptance_server import validate_port

    with pytest.raises(ValueError, match="1024.*65535"):
        validate_port(port)


def test_cli_defaults_to_empty_scenario():
    from scripts.acceptance_server import parse_args

    args = parse_args([])
    assert args.scenario == "empty"
    assert args.port == 8011


def test_cli_accepts_an_explicit_valid_port():
    from scripts.acceptance_server import parse_args

    args = parse_args(["--scenario", "accepted", "--port", "8011"])
    assert args.scenario == "accepted"
    assert args.port == 8011


@pytest.mark.asyncio
async def test_environment_serves_accepted_scenario_and_cleans_owned_resources():
    from scripts.acceptance_server import acceptance_environment

    before = schema_names()
    storage_root: Path | None = None
    schema = ""
    async with acceptance_environment("accepted") as runtime:
        storage_root = runtime.storage_root
        schema = runtime.schema
        assert schema not in before
        assert storage_root.is_dir()
        assert runtime.task_id
        async with runtime.session_factory() as session:
            database, current_schema = (
                await session.execute(text("SELECT current_database(), current_schema()"))
            ).one()
        assert database == "paper_review_test"
        assert current_schema == schema
        async with AsyncClient(
            transport=ASGITransport(app=runtime.app), base_url="http://acceptance"
        ) as client:
            login = await client.post(
                "/api/v1/auth/login",
                json={"username": "expert.zhou", "password": runtime.seed_password},
            )
            assert login.status_code == 200
            token = login.json()["data"]["access_token"]
            tasks = await client.get(
                "/api/v1/expert/tasks", headers={"Authorization": f"Bearer {token}"}
            )
            assert tasks.status_code == 200
            assert runtime.task_id in {item["id"] for item in tasks.json()["data"]}
    assert storage_root is not None and not storage_root.exists()
    assert schema not in schema_names()
    assert schema_names() == before


@pytest.mark.asyncio
async def test_initialization_failure_cleans_schema_and_storage(monkeypatch):
    from scripts import acceptance_server

    before = schema_names()
    observed_storage: Path | None = None

    async def fail_scenario(*_args, **_kwargs):
        nonlocal observed_storage
        observed_storage = acceptance_server.get_settings().storage_root
        raise RuntimeError("scenario failed")

    monkeypatch.setattr(acceptance_server, "_prepare_scenario", fail_scenario)
    with pytest.raises(RuntimeError, match="scenario failed"):
        async with acceptance_server.acceptance_environment("empty"):
            pass
    assert observed_storage is not None and not observed_storage.exists()
    assert schema_names() == before


@pytest.mark.asyncio
async def test_keyboard_interrupt_cleans_only_current_environment():
    from scripts.acceptance_server import acceptance_environment

    before = schema_names()
    storage_root: Path | None = None
    schema = ""
    with pytest.raises(KeyboardInterrupt):
        async with acceptance_environment("empty") as runtime:
            storage_root = runtime.storage_root
            schema = runtime.schema
            raise KeyboardInterrupt
    assert storage_root is not None and not storage_root.exists()
    assert schema not in schema_names()
    assert schema_names() == before


@pytest.mark.parametrize("scenario", ["empty", "operations"])
def test_cli_sigint_cleans_before_reporting_interruption(scenario: str):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    backend_dir = Path(__file__).resolve().parents[1]
    process = subprocess.Popen(
        [
            sys.executable,
            str(backend_dir / "scripts" / "acceptance_server.py"),
            "--scenario",
            scenario,
            "--port",
            str(port),
        ],
        cwd=backend_dir.parent,
        env=os.environ.copy(),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert process.stdout is not None
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    output: list[str] = []
    resource_id = ""
    storage_root: Path | None = None
    try:
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline and process.poll() is None:
            for key, _mask in selector.select(timeout=0.2):
                line = key.fileobj.readline()
                if not line:
                    continue
                output.append(line)
                if line.startswith("resource_id="):
                    resource_id = line.strip().split("=", 1)[1]
                elif line.startswith("storage_root="):
                    storage_root = Path(line.strip().split("=", 1)[1])
                if "Uvicorn running on" in line:
                    process.send_signal(signal.SIGINT)
                    remainder, _ = process.communicate(timeout=20)
                    output.append(remainder)
                    break
            else:
                continue
            break
    finally:
        selector.close()
        if process.poll() is None:
            process.send_signal(signal.SIGINT)
            try:
                remainder, _ = process.communicate(timeout=10)
                output.append(remainder)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    combined = "".join(output)
    assert process.returncode == 130, combined
    if scenario == "operations":
        for name in ("tenant_id", "batch_id", "school_member_id", "student_member_id", "supervisor_member_id", "eligibility_id"):
            assert f"{name}=" in combined
        assert "access_token" not in combined
        assert "password=" not in combined
    assert resource_id.startswith("test_")
    assert storage_root is not None
    assert "CancelledError" not in combined
    assert resource_id not in schema_names()
    assert not storage_root.exists()
