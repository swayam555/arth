import type { AlertFired, DigestReady } from "@arth/proto";
import { AlertKind } from "@arth/proto";
import type { Notification } from "./model.js";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

/** Facts only: what crossed and where it is now. No verbs that read as a call to trade (SEBI). */
export function alertNotification(a: AlertFired, name: string | null, payload: Uint8Array): Notification {
  const label = name ? `${a.symbol} (${name})` : a.symbol;
  let body: string;
  switch (a.kind) {
    case AlertKind.ABOVE:
      body = `${a.symbol} crossed above ${inr.format(a.threshold)}. Last traded ${inr.format(a.triggerPrice)}.`;
      break;
    case AlertKind.BELOW:
      body = `${a.symbol} fell below ${inr.format(a.threshold)}. Last traded ${inr.format(a.triggerPrice)}.`;
      break;
    default:
      body = `${a.symbol} moved more than ${a.threshold}% from yesterday's close. Last traded ${inr.format(a.triggerPrice)}.`;
  }
  return {
    userId: a.userId,
    kind: "alert",
    title: `Price alert: ${label}`,
    body,
    url: `arth://instrument/${encodeURIComponent(a.symbol)}?alert=${a.alertId}`,
    collapseId: `alert-${a.alertId}`,
    payload,
  };
}

export function digestNotification(d: DigestReady, payload: Uint8Array): Notification {
  return {
    userId: d.userId,
    kind: "digest",
    title: d.title,
    body: d.body,
    url: `arth://digest/${d.forDate}`,
    collapseId: `digest-${d.forDate}`,
    payload,
  };
}
