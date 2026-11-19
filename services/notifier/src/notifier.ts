import { backoffMs, type RetryPolicy } from "./retry.js";
import { PushTransportError, type Directory, type FailedDelivery, type Notification, type PushSender } from "./model.js";

export type Outcome = "sent" | "no_consent" | "no_devices" | "dead_lettered";

export interface NotifierDeps {
  sender: PushSender;
  directory: Directory;
  deadLetter: (f: FailedDelivery) => Promise<void>;
  policy: RetryPolicy;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
}

/**
 * Delivers one notification to every device of a user who has granted the `push` purpose. Transport failures and
 * retryable ticket errors are retried with jittered backoff; unregistered devices are forgotten; whatever is still
 * failing after the last attempt goes to the DLQ with the original payload so it can be replayed.
 */
export class Notifier {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly d: NotifierDeps) {
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async deliver(n: Notification): Promise<{ outcome: Outcome; attempts: number; removed: number }> {
    const r = await this.d.directory.recipient(n.userId);
    if (!r.pushConsent) return { outcome: "no_consent", attempts: 0, removed: 0 };
    if (!r.tokens.length) return { outcome: "no_devices", attempts: 0, removed: 0 };

    let pending = r.tokens;
    let removed = 0;
    let reason = "";
    let attempt = 0;
    let retryAfter: number | undefined;
    while (pending.length && attempt < this.d.policy.attempts) {
      if (attempt > 0) await this.sleep(Math.max(retryAfter ?? 0, backoffMs(attempt - 1, this.d.policy, this.d.rand)));
      attempt++;
      try {
        const results = await this.d.sender.send(
          pending.map((to) => ({ to, title: n.title, body: n.body, data: { url: n.url, kind: n.kind }, collapseId: n.collapseId })),
        );
        const retry: string[] = [];
        for (const res of results) {
          if (res.status === "ok") continue;
          if (res.deviceGone) {
            await this.d.directory.removeToken(n.userId, res.to);
            removed++;
          } else if (res.retryable) {
            retry.push(res.to);
            reason = res.error;
          } else {
            reason = res.error;
          }
        }
        pending = retry;
        retryAfter = undefined;
      } catch (err) {
        if (!(err instanceof PushTransportError)) throw err;
        reason = err.message;
        retryAfter = err.retryAfterMs;
      }
    }
    if (pending.length) {
      await this.d.deadLetter({ userId: n.userId, kind: n.kind, payload: n.payload, reason, attempts: attempt });
      return { outcome: "dead_lettered", attempts: attempt, removed };
    }
    return { outcome: "sent", attempts: attempt, removed };
  }
}
