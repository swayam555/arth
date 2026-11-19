import * as Sentry from "@sentry/react-native";
import { scrubBreadcrumb, scrubEvent } from "./scrub";

type SentryLike = Pick<typeof Sentry, "init" | "captureException" | "close">;

let enabled = false;

/** Starts crash reporting only when a DSN is configured and the user has allowed it; otherwise every call is a no-op. */
export function initCrashReporting(dsn: string | undefined = process.env.EXPO_PUBLIC_SENTRY_DSN, sdk: SentryLike = Sentry): boolean {
  if (!dsn) return false;
  if (enabled) return true;
  sdk.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENV ?? (__DEV__ ? "dev" : "prod"),
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
  enabled = true;
  return true;
}

export function reportError(err: unknown, tags?: Record<string, string>, sdk: SentryLike = Sentry): void {
  if (!enabled) return;
  sdk.captureException(err, tags ? { tags } : undefined);
}

/** Called when analytics consent is withdrawn: flushes nothing further and shuts the client down. */
export async function stopCrashReporting(sdk: SentryLike = Sentry): Promise<void> {
  if (!enabled) return;
  enabled = false;
  await sdk.close();
}
