# Release kit

## Build profiles (`apps/mobile/eas.json`)

| Profile | Output | Channel | Use |
|---|---|---|---|
| `development` | Dev client APK, internal distribution | (any) | Day-to-day work with `expo start --dev-client` |
| `preview` | Release APK, internal distribution | `preview` | Testers, Maestro, perf runs |
| `production` | AAB, remote `versionCode` auto-incremented | `production` | Play internal testing → production |

OTA updates go through `expo-updates`, with `runtimeVersion.policy = appVersion`. Any native change must bump `expo.version`, so an update never reaches a binary it doesn't match.

First-time setup (one time, needs an Expo account):

```sh
cd apps/mobile
npx eas-cli@latest init                # writes extra.eas.projectId (also enables Expo push tokens)
npx eas-cli@latest update:configure     # writes updates.url
npx eas-cli@latest build --profile preview --platform android            # or add --local
npx eas-cli@latest update --channel preview --message "copy fixes"
```

You can build locally without EAS: `npx expo prebuild -p android && cd android && ./gradlew assembleRelease`. The APK lands in `android/app/build/outputs/apk/release/`.

Set these EAS environment variables (and never commit their values): `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WS_URL`, `EXPO_PUBLIC_SENTRY_DSN`.

## Brand assets

`infra/brand/gen_icons.py` draws every icon (app icon, adaptive foreground, background and monochrome, splash and favicon) from one definition: three candles rising on `#0B0F14`. Rerun it after changing the mark.

## Play internal-testing checklist

- [ ] `eas init` has run, so `projectId` is set and Expo push works.
- [ ] Release keystore created (EAS-managed or uploaded). Its SHA-256 replaces the debug fingerprint in `infra/nginx/assetlinks.json`, and `adb shell pm get-app-links in.arth.app` shows `verified`.
- [ ] `production` AAB built; `versionCode` is higher than the last upload.
- [ ] Play Console app created: category Finance; contains ads: No; target audience 18+.
- [ ] Data safety form filled from `docs/legal/PRIVACY_POLICY.md`:
  - collected: phone number, financial info (user-entered holdings), app interactions (chats), crash logs (optional), device ID (push token);
  - encrypted in transit; users can request deletion.
- [ ] Privacy policy hosted at a public URL and linked in the listing.
- [ ] Financial-features declaration answered: the app shows portfolio analytics, gives no advice and makes no trades.
- [ ] Permissions justified:
  - `POST_NOTIFICATIONS` for alerts;
  - `RECORD_AUDIO` for voice questions, only while the mic button is held;
  - `USE_BIOMETRIC` for the app lock.
- [ ] Internal testers list added; the build is uploaded to the **Internal testing** track (`eas submit -p android --profile production` drafts it).
- [ ] Pre-launch report reviewed: no crashes, and accessibility warnings triaged.
- [ ] Maestro suite passes on the preview APK (`maestro test apps/mobile/.maestro`).
- [ ] Cold start and memory measured on a low-end device and written into `docs/perf/REPORT.md`.

## Store listing copy

**Title (30):** Arth: Live Markets & Copilot

**Short description (80):** Live NSE-style prices, your portfolio and an AI copilot that shows its sources.

**Full description:**

Arth is a fast market terminal for Indian investors, with a copilot that explains your own portfolio.

• Live watchlists. Prices stream over a single connection and update many times a second. On 2G and 3G the update rate drops automatically to save data.
• Candlestick charts you can pinch, pan and scrub, with SMA, EMA, VWAP and RSI, and market depth.
• Portfolio from your broker's tradebook CSV or your CAS statement, with P&L, XIRR, allocation and movers repriced live.
• Ask "why is my portfolio down today?" The copilot answers from your own numbers, shows charts, and cites its sources. It won't tell you what to buy or sell.
• Price alerts and an end-of-day digest by push notification.
• English and Hindi, voice questions, dark mode, biometric lock.
• Your data is yours: download it or delete it in two taps. Optional features are off until you switch them on.

Arth is not a SEBI-registered adviser and does not provide investment advice. Prices in this build are simulated.

## Demo video script (≈90 s, screen recording on the emulator)

| t | Shot | Voice-over |
|---|---|---|
| 0–8 s | Cold start → OTP login → consent screen | "Arth signs you in with your mobile. Every optional use of your data is a switch you control." |
| 8–22 s | Watchlist with 200 rows, fast scroll, prices flashing | "Two hundred live rows over one WebSocket. The server conflates ticks, and only on-screen rows subscribe." |
| 22–38 s | Open RELIANCE chart → pinch/pan → crosshair → RSI | "Skia chart, ten thousand candles, gestures on the UI thread." |
| 38–52 s | Portfolio → import CSV preview → commit → donut | "Import a tradebook, preview it, commit, and the portfolio reprices from the same stream." |
| 52–75 s | Copilot: "Why is my portfolio down today?" → streamed answer, chart block, tap citation | "Every number traces back to a tool call, and sources are cited. Ask it what to buy…" (shows refusal) |
| 75–85 s | Create alert → push arrives → tap opens instrument | "Alerts fire server-side and deep-link straight into the chart." |
| 85–90 s | Settings → Download my data / Delete account | "Export or erase everything, any time." |

Record with `adb shell screenrecord /sdcard/arth.mp4` (180 s limit). Convert a GIF for the README with `ffmpeg -i arth.mp4 -vf "fps=12,scale=360:-1" docs/media/demo.gif`.
