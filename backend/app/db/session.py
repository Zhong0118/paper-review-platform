from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

settings = get_settings()
engine = create_async_engine(settings.business_database_url or settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
auth_engine = create_async_engine(settings.auth_database_url or settings.database_url, pool_pre_ping=True)
AuthSessionLocal = async_sessionmaker(auth_engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


async def get_auth_session() -> AsyncIterator[AsyncSession]:
    async with AuthSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
