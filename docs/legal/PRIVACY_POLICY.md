# Arth — Privacy policy and DPDP notice

This policy covers the Arth app and its backend. It is written for India's Digital Personal Data Protection Act, 2023 (DPDP), and the app's behaviour follows it. The short version shown at first launch and under Settings → Privacy notice comes from the same text (`apps/mobile/src/i18n/en.ts`, `privacy.body`, in English and Hindi).

> Arth is a portfolio and engineering demonstration. Whoever runs a deployment of it is the Data Fiduciary for that deployment and must add their legal name and grievance contact before publishing to a store.

## What we collect, and why

| Data | Purpose (consent key) | Required? | Where it lives |
|---|---|---|---|
| Mobile number (+91) | Sign-in by OTP (`core`) | Yes | api Postgres, as a hashed OTP in Redis for at most 5 minutes |
| Watchlists, alerts | Show prices and alert you (`core`) | Yes | api Postgres |
| Transactions and holdings you enter or import (CSV, CAS PDF) | Portfolio analytics (`core`) | Yes | api Postgres. PAN and email from a CAS are masked in the import report and never stored |
| Copilot questions and answers | Answer questions about your portfolio (`ai_copilot`) | Optional | ai Postgres. PII is masked before storage and before any model call. There is also an on-device SQLite copy |
| Voice clips | Transcribe a spoken question (`ai_copilot`) | Optional | Sent to the transcription provider and not kept |
| Push token | Price alerts and the daily digest (`push`) | Optional | api Postgres. Removed on sign-out |
| Crash reports | Fix crashes (`analytics`) | Optional | Sentry, after scrubbing (no user id, request bodies, network breadcrumbs, local variables, screenshots or view hierarchy) |

We do not sell personal data, show ads, or use it to train models.

## Consent

- Each optional purpose is a separate switch on the consent screen and in Settings. Every change is stored as a new row, so there is an append-only consent history, and it takes effect at once:
  - turning `ai_copilot` off blocks the copilot with a 403;
  - turning `push` off unregisters the device;
  - turning `analytics` off shuts down crash reporting on the device.
- Withdrawing consent doesn't affect anything processed before you withdrew it.

## Your rights (DPDP §11–§14)

- **Access and portability:** Settings → Download my data exports everything the api and copilot hold about you as JSON: profile, consents, watchlists, alerts, devices, transactions, imports and chats.
- **Correction:** edit or delete any transaction, watchlist or alert in the app.
- **Erasure:** Settings → Delete account removes your account and publishes `user.deleted`. Every service then erases its copy:
  - the copilot erases chats, usage and digests, committing only after the erase;
  - the device wipes its tokens, cache and chat copy.
- **Grievance redressal:** contact the operator's grievance officer at the address given in the store listing. If you are not satisfied with the response, you can complain to the Data Protection Board of India.
- **Nomination:** you may nominate someone to exercise these rights on your behalf if you die or become incapacitated, by writing to the grievance officer.

## Retention

- Account data is kept until you delete the account.
- OTP codes expire after 5 minutes.
- Refresh tokens expire after 30 days, or earlier on sign-out or reuse detection.
- Crash reports are kept under the Sentry project's retention setting.
- Local caches on the device are cleared on sign-out.

## Security

Security measures:
- TLS at the edge;
- short-lived access tokens held in memory, with the refresh token in the OS secure store;
- refresh-token rotation that revokes the whole token family on reuse;
- rate limits;
- service-to-service JWTs with their own secret and audience;
- an optional biometric app lock.

## Investment advice

Arth is not a SEBI-registered investment adviser or research analyst. Prices in this build are simulated. The copilot explains your own data and public information. It refuses to give buy, sell or hold recommendations or price targets.

## Children

Arth is not meant for anyone under 18. Under DPDP §9 we don't knowingly process children's data.
