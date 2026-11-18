# Keylite Client

Local-first password manager for opaque KDBX vaults, designed to sync with the [Keylite server](https://github.com/softplus10/keylite).

## Applications

- `web/`: SvelteKit 5 client rendered in the browser (SSR disabled). Cloudflare Workers Static Assets builds and deploys the production site.
- `extension/`: Chrome Manifest V3 wrapper around the static web app.
- `android/`: Capacitor Android wrapper, using the native Android Keystore for account credentials.

## Account-number authentication

Keylite uses a generated account number instead of email or a login password. The server stores only a domain-separated BLAKE3 digest of the number, not the original. On registration, save a separate copy immediately: losing the number prevents account recovery.

The login credential is **not** the KDBX master password. The latter is never saved to the account-credential store or transmitted to the Keylite API. Bearer session tokens remain only in application memory and are refreshed by signing in with the saved account number after a restart.

Use the **Remember this device** checkbox to control whether the account number is retained. Signing out clears the saved device credential. The stored credential is scoped to the chosen backend URL.

### Storage guarantees and limitations

- Web browser and Chrome extension: the account number is encrypted using AES-256-GCM, with a non-extractable Web Crypto key persisted via IndexedDB structured cloning. Browser profile clearing may remove this storage.
- Android: `@aparajita/capacitor-secure-storage` uses Android Keystore-backed encryption. Install and sync the native Capacitor Android project for this functionality.
- Neither implementation protects against malicious JavaScript already executing with the same application origin/extension privileges. Avoid untrusted third-party scripts, use strict CSP, and keep the device/browser updated.
- This encrypted browser storage is **not a recovery backup**. Keep the account number in an independent trusted place.

## Build

```sh
cd web
npm install
npm run check
npm run build
```

Cloudflare Workers Builds deploys the `web/build` output as `keylite-web` on pushes to the `main` branch. Backend default: `https://keylite.u72mlzb.workers.dev`.

This is experimental software. Before storing irreplaceable secrets, test encrypted KDBX export and restore, secure native packaging, and browser extension functionality.
