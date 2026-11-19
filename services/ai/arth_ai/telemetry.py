from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import FastAPI

from . import pii

log = logging.getLogger("arth_ai.telemetry")


def scrub_event(event: Any, _hint: Any = None) -> Any:
    """Sentry before_send: drop request bodies, cookies and headers, and mask PII left in messages and exception values."""
    request = event.get("request")
    if isinstance(request, dict):
        for key in ("data", "cookies", "headers", "query_string"):
            request.pop(key, None)
    event.pop("user", None)
    if isinstance(event.get("message"), str):
        event["message"] = pii.mask(event["message"]).text
    logentry = event.get("logentry")
    if isinstance(logentry, dict):
        for key in ("message", "formatted"):
            if isinstance(logentry.get(key), str):
                logentry[key] = pii.mask(logentry[key]).text
        logentry.pop("params", None)
    for exc in (event.get("exception") or {}).get("values") or []:
        if isinstance(exc.get("value"), str):
            exc["value"] = pii.mask(exc["value"]).text
        for frame in (exc.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)
    for crumb in (event.get("breadcrumbs") or {}).get("values") or []:
        if isinstance(crumb.get("message"), str):
            crumb["message"] = pii.mask(crumb["message"]).text
        crumb.pop("data", None)
    return event


def init_sentry(dsn: str | None = None, environment: str | None = None) -> bool:
    dsn = dsn if dsn is not None else os.environ.get("SENTRY_DSN", "")
    if not dsn:
        return False
    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn,
        environment=environment or os.environ.get("SENTRY_ENVIRONMENT", "dev"),
        release=f"arth-ai@{os.environ.get('ARTH_VERSION', 'dev')}",
        send_default_pii=False,
        include_local_variables=False,
        traces_sample_rate=0.0,
        before_send=scrub_event,
    )
    return True


def init_tracing(app: FastAPI, endpoint: str | None = None) -> bool:
    """OTLP/HTTP trace export when OTEL_EXPORTER_OTLP_ENDPOINT is set; FastAPI server spans plus httpx client spans, so
    the traceparent header carries each copilot turn into the api's portfolio calls."""
    endpoint = endpoint if endpoint is not None else os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "")
    if not endpoint:
        return False
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    provider = TracerProvider(resource=Resource.create({"service.name": os.environ.get("OTEL_SERVICE_NAME", "arth-ai")}))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint.rstrip('/')}/v1/traces")))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app, excluded_urls="healthz,readyz,metrics", tracer_provider=provider)
    HTTPXClientInstrumentor().instrument(tracer_provider=provider)
    log.info("tracing to %s", endpoint)
    return True
