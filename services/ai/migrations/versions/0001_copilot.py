"""copilot schema: rag documents, chat history, usage

Revision ID: 0001
Revises:
"""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute(
        """
        CREATE TABLE ai.documents (
          id           bigserial PRIMARY KEY,
          source       text NOT NULL,
          kind         text NOT NULL CHECK (kind IN ('filing', 'news', 'glossary')),
          symbols      text[] NOT NULL DEFAULT '{}',
          title        text NOT NULL,
          url          text,
          published_at timestamptz,
          body         text NOT NULL,
          hash         text NOT NULL UNIQUE,
          created_at   timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX documents_symbols_gin ON ai.documents USING gin (symbols)")
    op.execute("CREATE INDEX documents_kind_published ON ai.documents (kind, published_at DESC)")
    op.execute(
        """
        CREATE TABLE ai.document_chunks (
          id          bigserial PRIMARY KEY,
          document_id bigint NOT NULL REFERENCES ai.documents(id) ON DELETE CASCADE,
          ord         int NOT NULL,
          heading     text NOT NULL DEFAULT '',
          text        text NOT NULL,
          embedding   vector(1024) NOT NULL,
          tsv         tsvector GENERATED ALWAYS AS (to_tsvector('english', heading || ' ' || text)) STORED,
          UNIQUE (document_id, ord)
        )
        """
    )
    op.execute("CREATE INDEX chunks_tsv_gin ON ai.document_chunks USING gin (tsv)")
    op.execute("CREATE INDEX chunks_embedding_hnsw ON ai.document_chunks USING hnsw (embedding vector_cosine_ops)")
    op.execute(
        """
        CREATE TABLE ai.chat_sessions (
          id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    uuid NOT NULL,
          title      text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX chat_sessions_user ON ai.chat_sessions (user_id, updated_at DESC)")
    op.execute(
        """
        CREATE TABLE ai.chat_messages (
          id         bigserial PRIMARY KEY,
          session_id uuid NOT NULL REFERENCES ai.chat_sessions(id) ON DELETE CASCADE,
          user_id    uuid NOT NULL,
          role       text NOT NULL CHECK (role IN ('user', 'assistant')),
          content    text NOT NULL,
          blocks     jsonb NOT NULL DEFAULT '[]',
          citations  jsonb NOT NULL DEFAULT '[]',
          meta       jsonb NOT NULL DEFAULT '{}',
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX chat_messages_session ON ai.chat_messages (session_id, id)")
    op.execute("CREATE INDEX chat_messages_user ON ai.chat_messages (user_id, id)")
    op.execute(
        """
        CREATE TABLE ai.ai_usage (
          user_id       uuid NOT NULL,
          day           date NOT NULL,
          input_tokens  bigint NOT NULL DEFAULT 0,
          output_tokens bigint NOT NULL DEFAULT 0,
          requests      int NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, day)
        )
        """
    )


def downgrade() -> None:
    for t in ("ai_usage", "chat_messages", "chat_sessions", "document_chunks", "documents"):
        op.execute(f"DROP TABLE IF EXISTS ai.{t} CASCADE")
