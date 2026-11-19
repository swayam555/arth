from __future__ import annotations

from alembic import context
from sqlalchemy import create_engine, text

from arth_ai.config import Settings


def _url() -> str:
    url = Settings().database_url
    return url.replace("postgresql://", "postgresql+psycopg://", 1).replace("postgres://", "postgresql+psycopg://", 1)


def run() -> None:
    if context.is_offline_mode():
        context.configure(url=_url(), literal_binds=True, version_table_schema="ai")
        with context.begin_transaction():
            context.run_migrations()
        return
    engine = create_engine(_url())
    with engine.connect() as conn:
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS ai"))
        conn.commit()
        context.configure(connection=conn, version_table_schema="ai")
        with context.begin_transaction():
            context.run_migrations()


run()
