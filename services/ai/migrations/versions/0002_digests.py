"""daily portfolio digests

Revision ID: 0002
Revises: 0001
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE ai.digests (
          id           uuid PRIMARY KEY,
          user_id      uuid NOT NULL,
          for_date     date NOT NULL,
          body         jsonb NOT NULL,
          data_version text NOT NULL DEFAULT '',
          created_at   timestamptz NOT NULL DEFAULT now(),
          notified_at  timestamptz,
          UNIQUE (user_id, for_date)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ai.digests")
