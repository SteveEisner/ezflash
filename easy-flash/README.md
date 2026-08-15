# Hosted Easy Flash runtime

This directory contains the source modules and static UI for WLEDTubes Easy Flash. It is not an Electron desktop package and does not require a local Node server in production. The generated hosting graph lives in `../dist/`.

## Participant flow

1. Open the HTTPS site in desktop Chrome or Edge. Safari and Firefox do not expose Web Serial.
2. Connect a known QuinLED Dig2Go with a data-capable USB cable and choose **Connect**. This opens one browser serial-port chooser; it does not write.
3. Review the detected ESP family and selected immutable Dig2Go release. An ESP chip identity does not identify the controller board or attached strip.
4. When asked, check the controller's printed QuinLED Dig2Go label and confirm it. This is physical operator evidence, not automatic board proof.
5. Choose **Install** explicitly. The prepared session is bound to the selected port and target; disconnects, stale sessions, mismatches, or validation failures require a fresh connection.
6. Check the lights after the writer returns and reset is requested. The browser flow has no flash readback and cannot automatically prove the destination bytes, successful WLED boot, or attached-light health.

The browser loads `../dist/current.json`, then the matching immutable release manifest and its exact `complete-merged-image` USB artifact. It rejects unsafe release and artifact paths, verifies whole-image length and SHA-256 before interpreting the image, and applies the manifest component/slice/bounds/target checks before calling the writer.

## Evidence vocabulary

- **Compatible chip:** ESP ROM evidence for the supported MCU family.
- **Operator-confirmed board:** the person checked the model printed on the controller.
- **Writer accepted:** `esptool-js` returned after the requested write; no readback was performed.
- **Restart requested:** a reset was requested; boot and light health remain unverified.

No physical write occurs from page load, manifest fetch, artifact validation, or receipt construction. The only write boundary is the explicit enabled **Install** action for the still-current prepared session.

## Development

Run the repository-level commands from the parent directory:

```sh
npm ci
npm run build
npm run verify
npm test
```

Production static generation requires a fresh dependency-build receipt and artifacts. Reviewed fixtures are available only through the explicit `--fixture` test mode. See the repository README for the tracked `dist` pilot-snapshot policy and supply-chain boundary.

The vendored browser build of Espressif `esptool-js` retains its license at `vendor/esptool-js/LICENSE`; other notices are in `THIRD_PARTY_NOTICES.md`.
