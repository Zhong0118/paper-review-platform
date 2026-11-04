import pytest
from tempfile import TemporaryDirectory
from pathlib import Path
from sqlalchemy.engine import make_url
import os
import shutil
import subprocess
import sys
import stat
import json
from types import SimpleNamespace
from sqlalchemy import create_engine, text
from tests.conftest import _test_url


def test_bundle_location_and_storage_paths_reject_escape(tmp_path):
    from scripts.recovery_drill import _check_archive_dir, _source_files

    source = tmp_path / "source"
    source.mkdir()
    source.chmod(0o700)
    owned = SimpleNamespace(storage_root=source)
    archive = source / "bundle"
    archive.mkdir(mode=0o700)
    with pytest.raises(ValueError, match="inside source"):
        _check_archive_dir(owned, archive)

    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"outside")
    with pytest.raises(ValueError, match="escapes owned storage"):
        _source_files(owned, [("id", str(outside), 7, "", object())])
    (source / "linked.pdf").symlink_to(outside)
    with pytest.raises(ValueError, match="symbolic link"):
        _source_files(owned, [])


@pytest.mark.asyncio
async def test_recovery_cleanup_checks_ownership_before_all_context_deletes():
    """A recovery caller must get a veto before schema, role and storage cleanup."""
    from scripts.acceptance_server import acceptance_environment

    calls = []

    def guard(stage: str):
        calls.append(stage)

    async with acceptance_environment("empty", cleanup_guard=guard, strict_cleanup=True) as runtime:
        assert runtime.schema.startswith("test_")
    assert calls == ["schema", "roles", "storage"]


@pytest.mark.asyncio
async def test_owned_snapshot_rejects_schema_or_storage_replacement():
    """A changed OID or inode must not authorize later destructive cleanup."""
    from scripts.acceptance_server import acceptance_environment
    from scripts.recovery_drill import OwnedResources

    owned = None

    def guard(stage: str):
        if owned is not None:
            owned.assert_cleanup_stage(stage)

    async with acceptance_environment("empty", cleanup_guard=guard, strict_cleanup=True) as runtime:
        owned = OwnedResources.capture(runtime)
        assert owned.owner_role == make_url(os.environ["MIGRATION_DATABASE_URL"]).username
        original_oid = owned.schema_oid
        owned.schema_oid += 1
        with pytest.raises(ValueError, match="schema ownership"):
            owned.assert_cleanup_stage("schema")
        owned.schema_oid = original_oid
        original_inode = owned.storage_inode
        owned.storage_inode += 1
        with pytest.raises(ValueError, match="storage ownership"):
            owned.assert_cleanup_stage("schema")
        owned.storage_inode = original_inode


@pytest.mark.asyncio
async def test_published_backup_is_readable_and_tampering_is_rejected_before_delete():
    """A published result and its completed files need one verified bundle."""
    from scripts.acceptance_server import acceptance_environment
    from scripts.recovery_drill import OwnedResources, backup_owned_resources, validate_bundle

    owned = None

    def guard(stage: str):
        if owned is not None:
            owned.assert_cleanup_stage(stage)

    async with acceptance_environment("published", cleanup_guard=guard, strict_cleanup=True) as runtime:
        owned = OwnedResources.capture(runtime)
        with TemporaryDirectory(prefix="paper-review-bundle-test-") as directory:
            archive_dir = Path(directory)
            manifest = backup_owned_resources(owned, archive_dir)
            assert manifest["revision"] == "0034_public_revision_advice"
            assert len(manifest["tables"]["review_result_versions"]["content_sha256"]) == 64
            assert manifest["tables"]["result_publications"]["count"] == 1
            assert runtime.thesis_id in manifest["references"]["thesis_ids"]
            assert runtime.task_id in manifest["references"]["task_ids"]
            assert len(manifest["references"]["publication_ids"]) == 1
            assert any(item["completed"] for item in manifest["files"])
            validate_bundle(manifest, archive_dir)
            manifest_path = archive_dir / "manifest.json"
            original_manifest = manifest_path.read_bytes()
            manifest_path.write_text(json.dumps({**manifest, "revision": "wrong"}))
            with pytest.raises(ValueError, match="manifest"):
                validate_bundle(manifest, archive_dir)
            manifest_path.write_bytes(original_manifest)
            with (archive_dir / "database.dump").open("ab") as stream:
                stream.write(b"tampered")
            with pytest.raises(ValueError, match="archive hash"):
                validate_bundle(manifest, archive_dir)


@pytest.mark.asyncio
async def test_restored_published_bundle_retains_rows_rules_and_files():
    """Same-name restore must reproduce the published snapshot and file bytes."""
    from scripts.acceptance_server import acceptance_environment
    from scripts.recovery_drill import OwnedResources, backup_owned_resources, restore_owned_resources

    owned = None

    def guard(stage: str):
        if owned is not None:
            owned.assert_cleanup_stage(stage)

    async with acceptance_environment("published", cleanup_guard=guard, strict_cleanup=True) as runtime:
        owned = OwnedResources.capture(runtime)
        with TemporaryDirectory(prefix="paper-review-bundle-test-") as directory:
            archive_dir = Path(directory)
            manifest = backup_owned_resources(owned, archive_dir)
            await runtime.engine.dispose()
            await runtime.auth_engine.dispose()
            restore_owned_resources(owned, manifest, archive_dir)
            assert owned.schema_oid != manifest["schema_oid"]
            # Restore must retain the date predicate's EXECUTE grant and owner-only RLS path.
            from httpx import ASGITransport, AsyncClient
            from tests.helpers import login, auth
            async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
                expert=await login(client,'expert.zhou',runtime.seed_password)
                tasks=await client.get('/api/v1/expert/tasks?time_scope=past_year',headers=auth(expert))
                assert tasks.status_code==200,tasks.text
                assert runtime.task_id in {item['id'] for item in tasks.json()['data']}
            assert owned.storage_root.is_dir()
            assert all(stat.S_IMODE((owned.storage_root / item["path"]).stat().st_mode) == 0o600
                       for item in manifest["files"])


@pytest.mark.asyncio
async def test_changed_storage_inode_never_drops_source_schema(monkeypatch):
    """A target replacement during bundle validation must leave the DB source intact."""
    from scripts.acceptance_server import acceptance_environment
    from scripts import recovery_drill as recovery

    owned = None

    def guard(stage: str):
        if owned is not None:
            owned.assert_cleanup_stage(stage)

    async with acceptance_environment("empty", cleanup_guard=guard, strict_cleanup=True) as runtime:
        owned = recovery.OwnedResources.capture(runtime)
        with TemporaryDirectory(prefix="paper-review-bundle-test-") as directory:
            archive_dir = Path(directory)
            manifest = recovery.backup_owned_resources(owned, archive_dir)
            await runtime.engine.dispose()
            await runtime.auth_engine.dispose()
            original_oid = owned.schema_oid
            source = owned.storage_root
            aside = source.with_name(source.name + "-held-by-test")
            original_validate = recovery.validate_bundle
            foreign_inode = None

            def replace_after_validation(*args):
                nonlocal foreign_inode
                original_validate(*args)
                source.rename(aside)
                source.mkdir()
                foreign_inode = source.lstat().st_ino

            monkeypatch.setattr(recovery, "validate_bundle", replace_after_validation)
            try:
                with pytest.raises(ValueError, match="storage ownership"):
                    recovery.restore_owned_resources(owned, manifest, archive_dir)
                assert owned.schema_oid == original_oid
            finally:
                assert source.lstat().st_ino == foreign_inode
                shutil.rmtree(source)
                aside.rename(source)


def test_recovery_cli_runs_owned_lifecycle_and_reports_validation():
    """The public CLI must perform the drill, not just import its helpers."""
    backend_dir = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "-m", "scripts.recovery_drill"], cwd=backend_dir,
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr[-1000:]
    assert "local_recovery=PASS" in result.stdout
    assert "cleanup=PASS" in result.stdout


def test_recovery_target_rejects_wrong_database_and_port(monkeypatch):
    from scripts import recovery_drill as recovery

    for url in (
        "postgresql+asyncpg://user:example@127.0.0.1:5432/paper_review_test",
        "postgresql+asyncpg://user:example@127.0.0.1:5433/paper_review",
        "postgresql+asyncpg://user:example@db.example:5433/paper_review_test",
    ):
        monkeypatch.setattr(recovery, "get_settings", lambda: SimpleNamespace(database_url=url))
        with pytest.raises(ValueError, match="5433/paper_review_test"):
            recovery._test_url()


@pytest.mark.asyncio
async def test_backup_missing_completed_file_keeps_source():
    from scripts.acceptance_server import acceptance_environment
    from scripts import recovery_drill as recovery

    owned = None

    def guard(stage: str):
        if owned is not None:
            owned.assert_cleanup_stage(stage)

    async with acceptance_environment("published", cleanup_guard=guard, strict_cleanup=True) as runtime:
        owned = recovery.OwnedResources.capture(runtime)
        rows = recovery._database_snapshot(owned)["file_rows"]
        source = next(Path(row[1]) for row in rows if row[4] is not None)
        held = source.with_name(source.name + ".held-by-recovery-test")
        source.rename(held)
        try:
            with TemporaryDirectory(prefix="paper-review-bundle-test-") as directory:
                with pytest.raises(ValueError, match="completed file is missing"):
                    recovery.backup_owned_resources(owned, Path(directory))
            owned.assert_cleanup_stage("schema")
        finally:
            held.rename(source)


@pytest.mark.asyncio
async def test_failed_dump_keeps_owned_source(monkeypatch):
    from scripts.acceptance_server import acceptance_environment
    from scripts import recovery_drill as recovery

    owned = None

    def guard(stage: str):
        if owned is not None:
            owned.assert_cleanup_stage(stage)

    async with acceptance_environment("empty", cleanup_guard=guard, strict_cleanup=True) as runtime:
        owned = recovery.OwnedResources.capture(runtime)

        def fail_dump(*_args):
            raise RuntimeError("injected dump failure")

        monkeypatch.setattr(recovery.DockerPostgres, "dump", fail_dump)
        with TemporaryDirectory(prefix="paper-review-bundle-test-") as directory:
            with pytest.raises(RuntimeError, match="injected dump failure"):
                recovery.backup_owned_resources(owned, Path(directory))
        owned.assert_cleanup_stage("schema")


@pytest.mark.asyncio
async def test_restore_command_failure_does_not_restart_application(monkeypatch):
    from scripts.acceptance_server import acceptance_environment
    from scripts import recovery_drill as recovery

    owned = None

    def guard(stage: str):
        if owned is not None:
            owned.assert_cleanup_stage(stage)

    async with acceptance_environment("empty", cleanup_guard=guard, strict_cleanup=True) as runtime:
        owned = recovery.OwnedResources.capture(runtime)
        with TemporaryDirectory(prefix="paper-review-bundle-test-") as directory:
            archive_dir = Path(directory)
            manifest = recovery.backup_owned_resources(owned, archive_dir)
            await runtime.engine.dispose()
            await runtime.auth_engine.dispose()

            def fail_restore(*_args):
                raise RuntimeError("injected pg_restore failure")

            monkeypatch.setattr(recovery.DockerPostgres, "restore", fail_restore)
            with pytest.raises(RuntimeError, match="injected pg_restore failure"):
                recovery.restore_owned_resources(owned, manifest, archive_dir)
            assert owned.schema_oid is None
            assert not owned.storage_root.exists()
    assert owned is not None and not owned.storage_root.exists()


@pytest.mark.asyncio
async def test_recovery_refuses_business_role_with_bypassrls():
    """A restored app identity cannot masquerade as an RLS-checked role."""
    from scripts.acceptance_server import acceptance_environment
    from scripts.recovery_drill import OwnedResources

    async with acceptance_environment("empty", strict_cleanup=True) as runtime:
        role = make_url(os.environ["BUSINESS_DATABASE_URL"]).username
        assert role and role.startswith("rls_")
        engine = create_engine(_test_url().replace("+asyncpg", "+psycopg"), isolation_level="AUTOCOMMIT")
        try:
            with engine.connect() as conn:
                conn.execute(text(f'ALTER ROLE "{role}" BYPASSRLS'))
            with pytest.raises(ValueError, match="BYPASSRLS"):
                OwnedResources.capture(runtime)
        finally:
            with engine.connect() as conn:
                conn.execute(text(f'ALTER ROLE "{role}" NOBYPASSRLS'))
            engine.dispose()


def test_dump_archive_is_private_before_pg_dump_writes(monkeypatch, tmp_path):
    """A transient archive may never be world-readable during the dump."""
    from scripts import recovery_drill as recovery

    client = object.__new__(recovery.DockerPostgres)
    monkeypatch.setattr(client, "_command", lambda *_args: ["pg_dump"])

    def fake_run(_args, *, stdout, stderr):
        assert stat.S_IMODE(os.fstat(stdout.fileno()).st_mode) == 0o600
        stdout.write(b"archive")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(recovery.subprocess, "run", fake_run)
    old_umask = os.umask(0o022)
    try:
        client.dump("test_" + "a" * 32, tmp_path / "database.dump")
    finally:
        os.umask(old_umask)


def test_transport_rejects_older_restore_tool_before_credential_file(monkeypatch):
    from scripts import recovery_drill as recovery

    client = recovery.DockerPostgres(_test_url())
    monkeypatch.setattr(client, "_inspect", lambda: setattr(client, "container_id", "owned-container"))

    def fake_run(args, **_kwargs):
        if args[-2:] == ["pg_dump", "--version"]:
            return SimpleNamespace(stdout="pg_dump (PostgreSQL) 16.15")
        if args[-2:] == ["pg_restore", "--version"]:
            return SimpleNamespace(stdout="pg_restore (PostgreSQL) 15.19")
        raise AssertionError("no credential file should be created")

    monkeypatch.setattr(recovery.subprocess, "run", fake_run)
    with pytest.raises(ValueError, match="pg_restore"):
        client.__enter__()


@pytest.mark.asyncio
async def test_owned_capture_rejects_role_connection_to_other_database():
    from scripts.acceptance_server import acceptance_environment
    from scripts.recovery_drill import OwnedResources

    async with acceptance_environment("empty", strict_cleanup=True) as runtime:
        original = os.environ["BUSINESS_DATABASE_URL"]
        os.environ["BUSINESS_DATABASE_URL"] = original.replace("/paper_review_test", "/paper_review")
        try:
            with pytest.raises(ValueError, match="role database"):
                OwnedResources.capture(runtime)
        finally:
            os.environ["BUSINESS_DATABASE_URL"] = original
