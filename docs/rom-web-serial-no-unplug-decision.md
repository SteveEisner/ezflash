# Athom C3 ROM Web Serial: no-unplug decision

**Decision: BLOCK a claimed no-unplug ROM transaction. Keep Easy Flash as an explicit ROM write with honest post-write verification, and use an application-owned OTA path for already-running devices in a later, separately gated change.**

## Required product transaction

`output off → write → actual restart → exact v15 verify → output normal → Done` is not implementable truthfully with the current Athom C3 native USB Serial/JTAG ROM path, without changing the firmware/update architecture or adding a physical reset/power capability.

The safe current transaction is:

1. Connect: Web Serial selects one port; esptool-js enters the ROM loader and identifies only the chip family.
2. Bind: the operator confirms the printed Athom C3 model; the exact release, target, component geometry, and SHA-256 are bound to the session.
3. Install: the browser validates the merged image immediately before writing and writes only the declared component ranges. No erase-all and no catalog-driven flash-header patching.
4. Reset request: esptool-js `after("hard_reset")` requests the reset constructor's RTS sequence, then the transport is closed.
5. Verify: the browser waits for the port to return and accepts only an exact `WLEDTUBES_BOOT v=1 ...` identity line matching target, source, release, and Tubes count. Pending remains unverified; it is never Done.
6. If the native USB port does not return, the operator reconnects or uses the board's physical reset/power procedure. The UI must not claim restart, output restoration, or success.

This is a **safe ROM recovery/install**, not a no-unplug transaction.

## Why Web Serial cannot prove no-unplug here

- `connectToController()` immediately constructs `Transport` and calls `loader.main()`. That owns the selected port for ROM bootloader traffic; there is no application serial session available to send WLED JSON before the write.
- `beforeWrite` runs after image fetch, component validation, port identity re-check, and immediately before `writeFlash`; it is not an application command channel and cannot turn the ROM session into WLED application protocol.
- In esptool-js, `after("hard_reset")` invokes the transport's hard-reset constructor (RTS/DTR control). It is a **request** to toggle reset control lines, not proof that the ESP32-C3 native USB Serial/JTAG peripheral detached, re-enumerated, and booted the application.
- esptool-js documents ROM `soft_reset` as “run user code” only for ESP8266; for ESP32 ROM it uses a zero-length flash command/finish sequence, while stub support for running user code is not available for ESP32-C3. Therefore `soft_reset` is not a sound C3 fallback.
- Once the ROM write has completed, the browser can close and poll `navigator.serial.getPorts()`, but enumeration/polling cannot electrically reset a board or force native USB/JTAG re-enumeration. A missing return is unknown, not healthy.

The source-level evidence is the pinned adapter call sequence in `easy-flash/local-flash.mjs` and the upstream esptool-js implementation referenced below. No claim here depends on a physical device test.

## Smallest viable alternative

### First install / recovery

Retain ROM Web Serial, but make the operator gate explicit: use the board's physical reset/power action if the native USB port does not return. Keep the current fail-closed result states (`verified`, `pending`, failure); do not add an automatic “output normal” or “Done” transition without the exact boot line.

### Already-running WLEDTubes devices

Use an application-owned OTA transaction rather than ROM Web Serial:

`WLED application command (turn output off + arm one-shot update state) → application OTA upload to validated inactive slot → firmware-controlled reboot → boot identity + one-shot output restore → health proof → Done`.

That path can preserve the application serial/network session long enough to turn output off and can make reboot/output restoration firmware-owned. It requires a dedicated canonical OTA contract, inactive-slot geometry, artifact admission, rollback/timeout behavior, and host/firmware tests. It must not be simulated by adding UI around the ROM writer. First-time/unconfigured devices still use assisted ROM install and do not require network credentials.

## Safety boundaries

- No physical device was opened, flashed, or contacted for this decision.
- No firmware or Easy Flash UI was changed to imply unsupported success.
- Exact identity remains separate from chip-family evidence; `WLEDTUBES_BOOT` remains the only accepted post-boot identity proof.
- A write return is not readback proof. A reset request is not boot proof. A returned USB port without the exact boot line is not health proof.

## Authoritative references

- esptool-js `ESPLoader.after()` and `softReset()` (retrieved 2026-08-24): https://github.com/espressif/esptool-js/blob/main/src/esploader.ts
- Espressif ESP32-C3 USB Serial/JTAG documentation (USB device lifecycle/reset behavior): https://docs.espressif.com/projects/esp-idf/en/latest/esp32c3/api-guides/usb-serial-jtag-console.html
- Espressif ESP32-C3 boot mode/reset documentation: https://docs.espressif.com/projects/esptool/en/latest/esp32c3/esptool/advanced-topics/boot-mode-selection.html
- Local implementation: `easy-flash/local-flash.mjs`, `easy-flash/boot-verification.mjs`, `easy-flash/test/safety-contract.test.mjs`.
