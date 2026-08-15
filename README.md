# WLEDTubes Easy Flash

Standalone HTTPS static Easy Flash site for `flash.rezidence.live`. No server runtime, accounts, telemetry, service worker, or automatic write. Chrome/Edge Web Serial is required.

Actions checks out WLEDTubes at the exact commit in `dependency-lock.json`, validates the approved `esp32_quinled_dig2go_tubes` contract/generator, builds immutable static releases, verifies hashes, and uploads `dist`. The lock currently uses reviewed temporary ref `84801e8e`; promote to `main` only after PR67 lands.

Vercel deploy is a separate protected manual/tag workflow after artifact success. Configure `VERCEL_TOKEN` and `VERCEL_ORG_ID`; no remote/deployment is configured locally.

```sh
npm ci && npm run build && npm run verify && npm test
```
