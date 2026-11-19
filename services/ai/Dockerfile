# syntax=docker/dockerfile:1.7
FROM ghcr.io/astral-sh/uv:0.13.3 AS uv

FROM python:3.13.16-slim-trixie AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY arth_ai arth_ai
COPY migrations migrations
COPY alembic.ini ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev

FROM python:3.13.16-slim-trixie
RUN useradd --system --uid 10001 arth
WORKDIR /app
COPY --from=build /app /app
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1
USER arth
EXPOSE 8090
CMD ["sh", "-c", "alembic upgrade head && python -m arth_ai.rag.seed && exec uvicorn arth_ai.main:app --host 0.0.0.0 --port 8090 --workers 1 --no-access-log"]
