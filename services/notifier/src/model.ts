export type NotificationKind = "alert" | "digest";

export interface Notification {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Deep link the app opens on tap. */
  url: string;
  /** Collapses repeats on the device (one banner per alert / per day's digest). */
  collapseId: string;
  /** Original Kafka payload, kept for the DLQ. */
  payload: Uint8Array;
}

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: { url: string; kind: NotificationKind };
  collapseId: string;
}

export type PushResult =
  | { status: "ok"; to: string }
  | { status: "error"; to: string; error: string; retryable: boolean; deviceGone: boolean };

/** Thrown for failures of the whole request (network, 5xx, 429), which are always retryable. */
export class PushTransportError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface PushSender {
  readonly name: string;
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

export interface Recipient {
  pushConsent: boolean;
  tokens: string[];
}

export interface Directory {
  recipient(userId: string): Promise<Recipient>;
  instrumentName(symbol: string): Promise<string | null>;
  removeToken(userId: string, token: string): Promise<void>;
}

export interface FailedDelivery {
  userId: string;
  kind: NotificationKind;
  payload: Uint8Array;
  reason: string;
  attempts: number;
}
