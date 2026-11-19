"""Generates dashboards/arth.json. Run: python3 infra/grafana/gen_dashboard.py"""

import json
from pathlib import Path

DS = {"type": "prometheus", "uid": "prometheus"}
panels: list[dict] = []
y = 0


def row(title: str) -> None:
    global y
    panels.append({"type": "row", "title": title, "collapsed": False, "gridPos": {"h": 1, "w": 24, "x": 0, "y": y}, "panels": []})
    y += 1


def ts(title: str, exprs: list[tuple[str, str]], unit: str = "short", w: int = 8, x: int = 0) -> None:
    panels.append(
        {
            "type": "timeseries",
            "title": title,
            "datasource": DS,
            "gridPos": {"h": 8, "w": w, "x": x, "y": y},
            "fieldConfig": {"defaults": {"unit": unit, "custom": {"lineWidth": 1, "fillOpacity": 8}}, "overrides": []},
            "options": {"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}},
            "targets": [{"datasource": DS, "expr": e, "legendFormat": l, "refId": chr(65 + i)} for i, (e, l) in enumerate(exprs)],
        }
    )


def stat(title: str, expr: str, unit: str = "short", x: int = 0, w: int = 4) -> None:
    panels.append(
        {
            "type": "stat",
            "title": title,
            "datasource": DS,
            "gridPos": {"h": 4, "w": w, "x": x, "y": y},
            "fieldConfig": {"defaults": {"unit": unit}, "overrides": []},
            "options": {"reduceOptions": {"calcs": ["lastNotNull"]}, "colorMode": "value", "graphMode": "area"},
            "targets": [{"datasource": DS, "expr": expr, "refId": "A"}],
        }
    )


def q(p: str, metric: str, by: str = "") -> str:
    grp = f"le{',' + by if by else ''}"
    return f"histogram_quantile({p}, sum by ({grp}) (rate({metric}_bucket[$__rate_interval])))"


row("Overview")
stat("WS connections", "sum(arth_gw_connections)", x=0)
stat("Ticks/s in", "sum(rate(arth_agg_ticks_total[$__rate_interval]))", "ops", x=4)
stat("p99 tick→socket", q("0.99", "arth_gw_delta_age_seconds"), "s", x=8)
stat("Kafka lag (agg)", "sum(arth_agg_consumer_lag)", x=12)
stat("API p95", q("0.95", "http_server_requests_seconds"), "s", x=16)
stat("Copilot TTFT p95", q("0.95", "arth_ai_ttft_seconds"), "s", x=20)
y += 4

row("Stream gateway")
ts("Connections and subscriptions", [("sum(arth_gw_connections)", "connections"), ("sum(arth_gw_subscriptions)", "subscriptions"), ("sum(arth_gw_watched_symbols)", "watched symbols")])
ts("Tick → socket latency", [(q("0.5", "arth_gw_delta_age_seconds"), "p50"), (q("0.95", "arth_gw_delta_age_seconds"), "p95"), (q("0.99", "arth_gw_delta_age_seconds"), "p99")], "s", x=8)
ts(
    "Egress and backpressure",
    [
        ("sum(rate(arth_gw_bytes_sent_total[$__rate_interval]))", "bytes/s"),
        ("sum(rate(arth_gw_frames_dropped_total[$__rate_interval]))", "frames dropped/s"),
        ("sum(rate(arth_gw_slow_closed_total[$__rate_interval]))", "slow consumers closed/s"),
        ("sum by (reason) (rate(arth_gw_upgrades_rejected_total[$__rate_interval]))", "rejected {{reason}}"),
    ],
    x=16,
)
y += 8

row("Ingest pipeline")
ts("Feed and aggregator throughput", [("sum(rate(arth_feed_ticks_total[$__rate_interval]))", "feed ticks/s"), ("sum(rate(arth_agg_ticks_total[$__rate_interval]))", "aggregated ticks/s"), ("sum(rate(arth_agg_quotes_published_total[$__rate_interval]))", "quotes/s"), ("sum by (reason) (rate(arth_agg_ticks_dropped_total[$__rate_interval]))", "dropped {{reason}}")], "ops")
ts("Aggregator flush and tick age", [(q("0.95", "arth_agg_flush_seconds"), "flush p95"), (q("0.95", "arth_agg_tick_age_seconds"), "tick age p95")], "s", x=8)
ts("Consumer lag", [("sum(arth_agg_consumer_lag)", "aggregator lag")], x=16)
y += 8

row("Alerts and notifications")
ts("Alerts", [("sum(arth_alerts_armed)", "armed"), ("sum by (kind) (rate(arth_alerts_fired_total[$__rate_interval]))", "fired {{kind}}/s"), ("sum(rate(arth_alerts_suppressed_total[$__rate_interval]))", "suppressed/s")])
ts("Alert latency", [(q("0.95", "arth_alerts_eval_seconds"), "eval p95"), (q("0.95", "arth_alerts_fire_latency_seconds"), "tick→fired p95"), (q("0.95", "arth_notify_deliver_seconds", "kind"), "deliver p95 {{kind}}")], "s", x=8)
ts("Push outcomes", [("sum by (kind, outcome) (rate(arth_notify_total[$__rate_interval]))", "{{kind}} {{outcome}}"), ("sum(rate(arth_notify_tokens_removed_total[$__rate_interval]))", "tokens pruned/s")], x=16)
y += 8

row("API (Spring Boot)")
ts("Request rate by status", [("sum by (status) (rate(http_server_requests_seconds_count{application=\"arth-api\"}[$__rate_interval]))", "{{status}}")], "reqps")
ts("Latency p95 by route", [(q("0.95", "http_server_requests_seconds", "uri"), "{{uri}}")], "s", x=8)
ts("JVM", [("sum(jvm_memory_used_bytes{area=\"heap\"})", "heap used"), ("sum(hikaricp_connections_active)", "db conns active")], "bytes", x=16)
y += 8

row("AI copilot")
ts("Turns by outcome", [("sum by (outcome) (rate(arth_ai_turns_total[$__rate_interval]))", "{{outcome}}"), ("sum by (kind) (rate(arth_ai_guard_total[$__rate_interval]))", "guard {{kind}}")], "ops")
ts("Copilot latency", [(q("0.5", "arth_ai_ttft_seconds"), "TTFT p50"), (q("0.95", "arth_ai_ttft_seconds"), "TTFT p95"), (q("0.95", "arth_ai_turn_seconds"), "turn p95"), (q("0.95", "arth_ai_tool_seconds", "tool"), "tool {{tool}} p95")], "s", x=8)
ts("Tokens and grounding", [("sum by (dir) (rate(arth_ai_tokens_total[$__rate_interval]))", "tokens {{dir}}/s"), ("sum by (result) (rate(arth_ai_grounding_total[$__rate_interval]))", "grounding {{result}}")], x=16)
y += 8

row("Runtime")
ts("Node event-loop lag p99", [("max by (service) (nodejs_eventloop_lag_p99_seconds)", "{{service}}")], "s")
ts("Resident memory", [("max by (service) (process_resident_memory_bytes{service!=\"\"})", "{{service}}"), ("process_resident_memory_bytes{job=\"ai\"}", "ai")], "bytes", x=8)
ts("CPU", [("sum by (job) (rate(process_cpu_seconds_total[$__rate_interval]))", "{{job}}")], "percentunit", x=16)
y += 8

dash = {
    "uid": "arth-overview",
    "title": "Arth — overview",
    "tags": ["arth"],
    "timezone": "browser",
    "schemaVersion": 41,
    "version": 1,
    "refresh": "10s",
    "time": {"from": "now-30m", "to": "now"},
    "templating": {"list": []},
    "annotations": {"list": []},
    "panels": [dict(p, id=i + 1) for i, p in enumerate(panels)],
}
out = Path(__file__).parent / "dashboards" / "arth.json"
out.write_text(json.dumps(dash, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {out} ({len(panels)} panels)")
