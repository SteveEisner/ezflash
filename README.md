# WLEDTubes Easy Flash

WLEDTubes Easy Flash is a standalone HTTPS site for installing the approved QuinLED Dig2Go Tubes firmware from Chrome or Edge with Web Serial. The hosted runtime is static: it has no application server, `/api` dependency, account, telemetry, service worker, automatic port selection, or automatic write.

The browser resolves one release through same-origin static files:

1. `current.json` names the current immutable release.
2. `releases/<release-id>/manifest.json` names the exact Dig2Go USB merged image.
3. The browser fetches that image, verifies its whole-file SHA-256 and length with WebCrypto, and then validates its declared components, slices, hashes, offsets, bounds, and target before a write can begin.

Release IDs and artifact paths are constrained relative paths. Absolute, cross-origin, mutable, and traversal-style release or artifact locations are rejected.

## Safety and evidence boundary

Opening the page never selects a serial port or writes firmware. **Connect** opens one browser chooser; cancelling it leaves no prepared install. **Install** remains a separate explicit action and is enabled only for the currently prepared port and target.

The ESP ROM can prove a compatible chip family, but it cannot prove the controller board is a QuinLED Dig2Go. Unless exact machine evidence exists, the operator must confirm the model printed on the physical controller. That physical confirmation is operator evidence, not chip-derived board proof.

A successful `esptool-js` write return means the writer accepted the requested bytes. This flow performs **no flash readback**, so it does not claim byte-for-byte destination verification. A requested reset also does not prove that WLED booted or that attached lights are healthy; the result asks the operator to check the lights and preserves that health limitation.

This repository correction includes no device access, firmware write, deployment, DNS change, push, or remote mutation.

## Reproducible release input

`dependency-lock.json` pins Steve Eisner's WLEDTubes repository, a full immutable source commit, and `esp32_quinled_dig2go_tubes`. The production build path must consume a fresh machine receipt/output directory from that exact dependency checkout after its prerequisite web build, canonical contract generation/validation, PlatformIO build, and authoritative merged-image construction. It fails closed when required provenance or artifacts are missing; it does not silently package the checked-in pilot binaries.

Fixture mode exists only for reviewed local tests and must be selected explicitly with `--fixture`. It is not a production release input.

```sh
npm ci
node scripts/build-firmware.mjs --source ../WLEDTubes --output build/easy-flash-firmware
EASY_FLASH_BUILD_RECEIPT=build/easy-flash-firmware/build-receipt.json npm run build
npm run verify
npm test
```

The GitHub build workflow has read-only repository permission, uses immutable action revisions, performs the dependency build and standalone verification, and uploads `dist` for human review. It does not deploy. Steve owns Vercel; [`vercel.json`](vercel.json) and [`_headers`](_headers) are handoff configuration only.

## Tracked `dist` policy

`dist/` remains tracked as a generated, verified **pilot snapshot** so the complete static hosting graph can be reviewed without running a device or deployment. It is not evidence of a current dependency build merely because it is present in Git. Any production candidate must regenerate it from the fresh machine receipt, run release verification and tests, and review the resulting diff. Generated firmware binaries are never auto-committed or auto-deployed.

Third-party notices are in [`NOTICES.md`](NOTICES.md) and [`easy-flash/THIRD_PARTY_NOTICES.md`](easy-flash/THIRD_PARTY_NOTICES.md).
