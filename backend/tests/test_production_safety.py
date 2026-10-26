from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.core.config import Settings


URLS = {
    'migration_database_url': 'postgresql+asyncpg://owner@127.0.0.1:5433/paper_review_test',
    'business_database_url': 'postgresql+asyncpg://business@127.0.0.1:5433/paper_review_test',
    'auth_database_url': 'postgresql+asyncpg://auth@127.0.0.1:5433/paper_review_test',
}


@pytest.mark.parametrize('secret', [Settings.model_fields['jwt_secret'].default, '', ' ' * 40, 'short'])
def test_production_rejects_unsafe_jwt(secret):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env='production', **URLS,
                 jwt_secret=secret, seed_password='Synthetic-Seed-Only')


@pytest.mark.parametrize('password', [Settings.model_fields['seed_password'].default, '', '   '])
def test_production_rejects_default_or_blank_seed(password):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env='production', **URLS,
                 jwt_secret='SYNTHETIC-KEY-' * 4, seed_password=password)


def test_production_accepts_explicit_values_and_development_defaults():
    assert Settings(_env_file=None, app_env='production', **URLS,
                    jwt_secret='SYNTHETIC-KEY-' * 4, seed_password='Synthetic-Seed-Only')
    assert Settings(_env_file=None, app_env='development')


def test_validation_error_text_hides_input_credentials():
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, app_env='production', **URLS,
                 jwt_secret='PRIVATE_MARKER', seed_password='PRIVATE_SEED_MARKER')
    leaked = any(value in str(error.value) for value in ('PRIVATE_MARKER', 'PRIVATE_SEED_MARKER'))
    assert not leaked


@pytest.mark.asyncio
@pytest.mark.parametrize('entry', ['function', 'cli'])
async def test_production_seed_refused_before_database_use(monkeypatch, entry):
    from app import seed
    from app.db import session as database
    monkeypatch.setattr(seed, 'get_settings', lambda: SimpleNamespace(app_env='production'))
    session = AsyncMock()
    def forbidden_factory():
        pytest.fail('seed CLI attempted to acquire a database session')
    monkeypatch.setattr(database, 'SessionLocal', forbidden_factory)
    with pytest.raises(RuntimeError, match='production'):
        if entry == 'function':
            await seed.seed_database(session)
        else:
            await seed.main()
    session.execute.assert_not_called()
    session.commit.assert_not_called()
