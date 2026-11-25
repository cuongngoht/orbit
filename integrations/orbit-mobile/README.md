# Orbit Mobile (iOS)

Native iOS shell (`WKWebView` via `flutter_inappwebview`) + native authentication backed by **iOS Keychain** for Orbit Web (`integrations/orbit-web`).

## Authentication Flow (Level B)

1. User enters username/email + password (and optional server URL / Access Token) in the native Flutter login screen (`lib/screens/login_screen.dart`).
2. App posts to `POST /api/auth/mobile/login` with `X-Orbit-Web: 1` and a persistent per-device UUID (`deviceId`).
3. Server returns a 30-day `refreshToken` (stored exclusively in **iOS Keychain**, never in WebView storage) and a 30-second single-use `exchangeCode`.
4. Embedded `WKWebView` loads the Orbit Web origin and pulls `exchangeCode` via the `takeBootstrap` JS bridge (gated to exact same-origin URLs), exchanging it at `POST /api/auth/mobile/exchange` for Orbit Web's standard `HttpOnly; SameSite=Strict` session cookie.
5. When the browser cookie expires, Orbit Web invokes `onAuthExpired`, triggering single-flight refresh token rotation in Flutter (`POST /api/auth/mobile/refresh`) and issuing a fresh 30-second `exchangeCode`.
6. Signing out revokes the token family on the server, deletes Keychain tokens, and wipes WebView cookies, storage, and cache.

## Requirements

- macOS with Xcode and CocoaPods (`pod`)
- Flutter SDK (`>= 3.47`)
- iPhone with Developer Mode enabled (*Settings -> Privacy & Security -> Developer Mode*)
- Orbit Web backend updated to schema version 2 (`mobile_auth`, applied automatically on startup)

## Development & Tests

```bash
cd integrations/orbit-mobile
flutter pub get
flutter analyze
flutter test
```

## Build & Install via USB Cable

Plug your iPhone in via USB, unlock it, and check the device ID with `flutter devices`.

### Recommended: Release Build with Pre-configured Server URL

```bash
cd integrations/orbit-mobile
flutter run --release \
  --dart-define=ORBIT_WEB_URL=https://orbit.example.com
```

> **Why `--release`?** iOS blocks JIT compilation when a cable/debugger is detached; a Debug build crashes upon reopening after unplugging. Always use `--release` when installing for standalone use.

### Open in Xcode for Signing Team Setup

If `flutter run --release` asks you to select a Development Team:

```bash
open integrations/orbit-mobile/ios/Runner.xcworkspace
```

1. Select **Runner** target -> **Signing & Capabilities**.
2. Choose your **Team** (free Apple ID or Apple Developer Program) and ensure a unique Bundle Identifier if needed.
3. Run once from Xcode (set Scheme -> Run -> Build Configuration: **Release**), or re-run `flutter run --release --dart-define=ORBIT_WEB_URL=https://orbit.example.com`.
4. On your iPhone (first time with a personal Apple ID): *Settings -> General -> VPN & Device Management* -> **Trust** your certificate.
   - Free Apple ID certificates remain valid for **7 days** (reinstall via USB to renew).
   - Paid Apple Developer Program certificates remain valid for **1 year**.
