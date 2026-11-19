import { PushTransportError, type PushMessage, type PushResult, type PushSender } from "./model.js";

interface Ticket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

const RETRYABLE = new Set(["MessageRateExceeded"]);

/** Expo push service. Batches are capped at 100 messages per request by Expo. */
export class ExpoSender implements PushSender {
  readonly name = "expo";

  constructor(
    private readonly url = "https://exp.host/--/api/v2/push/send",
    private readonly accessToken?: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const out: PushResult[] = [];
    for (let i = 0; i < messages.length; i += 100) out.push(...(await this.batch(messages.slice(i, i + 100))));
    return out;
  }

  private async batch(messages: PushMessage[]): Promise<PushResult[]> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify(
          messages.map((m) => ({
            to: m.to,
            title: m.title,
            body: m.body,
            data: m.data,
            sound: "default",
            priority: "high",
            channelId: m.data.kind === "alert" ? "alerts" : "digest",
            collapseId: m.collapseId,
          })),
        ),
      });
    } catch (err) {
      throw new PushTransportError(`expo unreachable: ${(err as Error).message}`);
    }
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get("retry-after"));
      throw new PushTransportError(`expo ${res.status}`, Number.isFinite(ra) && ra > 0 ? ra * 1_000 : undefined);
    }
    if (!res.ok) {
      const text = await res.text();
      return messages.map((m) => ({ status: "error", to: m.to, error: `http_${res.status}: ${text.slice(0, 200)}`, retryable: false, deviceGone: false }));
    }
    const body = (await res.json()) as { data?: Ticket[] };
    const tickets = body.data ?? [];
    return messages.map((m, i): PushResult => {
      const t = tickets[i];
      if (t?.status === "ok") return { status: "ok", to: m.to };
      const code = t?.details?.error ?? "Unknown";
      return { status: "error", to: m.to, error: code, retryable: RETRYABLE.has(code), deviceGone: code === "DeviceNotRegistered" };
    });
  }
}

/** Logs instead of sending; the default without network access or in local stacks. */
export class LogSender implements PushSender {
  readonly name = "log";
  readonly sent: PushMessage[] = [];

  constructor(private readonly log?: (m: PushMessage) => void) {}

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    for (const m of messages) {
      this.sent.push(m);
      this.log?.(m);
    }
    return messages.map((m) => ({ status: "ok", to: m.to }));
  }
}
