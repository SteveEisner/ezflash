# WLEDTubes Easy Flash

WLEDTubes has hundreds of controllers in the wild. We want to update them without plugging every one into a laptop, but we also do not want a new update system to put the whole flock at risk.

The plan has three parts.

## 1. Tubes will eventually update each other

Once the fleet is running the new firmware, one updated Tube will be able to pass an approved update to another compatible Tube nearby.

The update moves one Tube at a time. The receiving Tube installs it, restarts, and proves that it is healthy before continuing. If no suitable Tube appears for 60 seconds, propagation stops.

This is for future updates. It is not how we will force hundreds of old Tubes through their first migration.

## 2. Easy Flash moves the old fleet onto the new firmware

Old Tubes do not understand the new targeting and handoff rules yet. For this first migration, we use the update system they already have:

1. Easy Flash installs the approved bridge firmware on one Tube over USB.
2. A local laptop tool runs the existing Tubes OTA workflow for the nearby legacy devices.
3. Tubes that are powered off, out of range, or fail to return stay unknown instead of being called updated.
4. The S3 updater provides the same practical recovery option at an event for devices that were missed at home.

The operator instruction is deliberately simple:

> Keep the Tubes you want to update plugged in and in range until the update finishes.

The hosted Easy Flash page handles the USB installation. The legacy fleet updater runs locally on the laptop because a static browser page cannot host the Wi-Fi, DNS, and HTTP services used by the old OTA system.

## 3. We roll it out in growing groups

We do not start with the whole fleet.

1. Test the bridge firmware and interrupted-update recovery on Greg's four Tubes.
2. Update a small group and confirm that every observed Tube restarts and rejoins.
3. Increase the group size only after the previous group is reliable.
4. Use Easy Flash for the main migration before the event.
5. Use the S3 updater for stragglers at the rave.
6. Turn on peer-to-peer propagation for later releases after the new targeting protocol is established across the fleet.

A build, successful upload, or reboot is not enough to call a rollout complete. We need to see the Tube return healthy. Devices we cannot see remain unknown and can be handled in a later pass.

## What Easy Flash does today

Easy Flash is a standalone HTTPS site for installing the approved QuinLED Dig2Go Tubes firmware from Chrome or Edge. It uses Web Serial and requires a separate Connect and Install action. Opening the page never writes to a device.

## Developer and safety details

The hosted runtime is static. It has no application server, `/api` dependency, account, telemetry, service worker, automatic port selection, or automatic write.

The browser resolves one release through same-origin static files:

1. `current.json` names the current immutable release.
2. `releases/<release-id>/manifest.json` names the exact Dig2Go USB merged image.
3. The browser fetches that image, verifies its whole-file SHA-256 and length with WebCrypto, and then validates its declared components, slices, hashes, offsets, bounds, and target before a write can begin.

Release IDs and artifact paths are constrained relative paths. Absolute, cross-origin, mutable, and traversal-style release or artifact locations are rejected.

## Safety and evidence boundary

Opening the page never selects a serial port or writes firmware. **Connect** opens one browser chooser; cancelling it leaves no prepared install. **Install** remains a separate explicit action and is enabled only for the currently prepared port and target.

The ESP ROM can prove a compatible chip family, but it cannot prove the controller board is a QuinLED Dig2Go. Unless exact machine evidence exists, the operator must confirm the model printed on the physical controller. That physical confirmation is operator evidence, not chip-derived board proof.

A successful `esptool-js` write return means the writer accepted the requested bytes. This flow performs **no flash readback**, so it does not claim byte-for-byte destination verification. A requested reset also does not prove that WLED booted or that attached lights are healthy; the result asks the operator to check the lights and preserves that health limitation.

Repository builds and previews do not contact or flash a controller. Device access begins only after a person opens the hosted page and explicitly chooses **Connect**; a firmware write still requires the separate **Install** action.

## Running the legacy fleet migration

After Easy Flash installs the USB bridge firmware, run the local adapter from this checkout:

```sh
npm run migrate:fleet -- \
  --serial /dev/cu.usbserial-… \
  --wledtubes ../WLEDTubes
```

The adapter delegates to WLEDTubes' `usermods/Tubes/upgrade_batch.sh` in its Dig2Go-only profile. It records the devices the updater actually observes as updated, skipped, or failed. Powered-off, out-of-range, and otherwise absent devices remain unknown, so finishing a batch does not claim that the whole fleet is current.

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

Each immutable release also carries public provenance under `releases/<release-id>/provenance/`: a normalized build receipt, the canonical update contract, and the exact partition CSV. The manifest binds their release-relative paths and byte hashes. Verification resolves those paths inside the immutable release directory, recomputes every hash, and cross-checks the receipt's separately defined deterministic digest, source commit and cleanliness, build environment, contract and partition geometry, and merged-image component slices. Fixture provenance has the same shape but remains rejected unless verification explicitly opts into fixture mode.

## Tracked `dist` policy

`dist/` remains tracked as a generated, verified **pilot snapshot** so the complete static hosting graph can be reviewed without running a device or deployment. It is not evidence of a current dependency build merely because it is present in Git. Any production candidate must regenerate it from the fresh machine receipt, run release verification and tests, and review the resulting diff. Generated firmware binaries are never auto-committed or auto-deployed.

## Integration-agent guide

This repository is a delivery adapter, not a second firmware authority. An integrating agent must preserve these ownership boundaries:

- `SteveEisner/WLEDtubes` owns firmware source, hardware targets, PlatformIO environments, partition geometry, and the canonical update contract.
- `dependency-lock.json` selects one full WLEDTubes commit and one approved environment. Update both the lock and the workflow checkout/ref/release ID together; never point at a floating branch.
- Easy Flash owns the static browser UI, Web Serial adapter, release packaging and verification, GitHub Actions build lane, and Vercel-ready static configuration.
- Vercel serves the reviewed tracked `dist/`. It must not compile firmware, obtain GitHub secrets, or redefine target identity.

### What GitHub Actions does

On a push, pull request, or manual dispatch, [`.github/workflows/build.yml`](.github/workflows/build.yml):

1. checks out Easy Flash and the exact WLEDTubes commit pinned in `dependency-lock.json`;
2. installs the pinned Node/Python build prerequisites;
3. runs the WLED web prerequisite, validates deterministic contract generation, and compiles only `esp32_quinled_dig2go_tubes`;
4. creates the merged USB recovery image from authoritative build outputs and canonical offsets;
5. emits and verifies a production build receipt binding repository, full commit, clean-tree state, environment, contract, partition, artifacts, and component hashes;
6. generates `dist/current.json`, the immutable release manifest, firmware, and public provenance bundle;
7. verifies the release and runs the static, supply-chain, browser-state, and safety suites;
8. confirms source/configuration files were not changed by generation; and
9. uploads `easy-flash-dist` for human review.

The workflow deliberately does **not** deploy, push generated files, create releases, contact a device, or use Vercel credentials. Cross-platform toolchain metadata can make separately built firmware bytes differ; every fresh artifact is therefore admitted by its own verified source-bound receipt rather than by assuming macOS and Linux outputs are byte-identical.

### Integrating a new canonical WLEDTubes revision

1. Start from a reviewed WLEDTubes commit that already contains the required target, contract, partition definition, and build scripts.
2. Update `dependency-lock.json` with the exact 40-character upstream commit and approved environment.
3. Update the immutable checkout ref and `EASY_FLASH_RELEASE` in `.github/workflows/build.yml`. The release ID must be stable and must match the generated `current.json`/manifest paths.
4. Run a fresh production build and verification:

   ```sh
   npm ci
   node scripts/build-firmware.mjs \
     --source ../WLEDTubes \
     --output build/easy-flash-firmware
   EASY_FLASH_BUILD_RECEIPT=build/easy-flash-firmware/build-receipt.json \
   EASY_FLASH_RELEASE=<immutable-release-id> \
     npm run build
   npm run verify
   npm test
   npm run test:easy-flash
   git diff --check
   ```

5. Review the complete `dist/` diff and public provenance. Do not accept missing evidence, a dirty source checkout, the wrong environment, changed partition geometry, duplicate/missing components, or a mutable/cross-origin artifact path.
6. Push normally and require the GitHub Actions run to build and upload a green `easy-flash-dist` artifact.
7. Download that exact CI artifact, run `npm run verify` against it, and inspect the hosted beginner flow before promoting the tracked snapshot or asking the hosting owner to deploy.

### Invariants an integrating agent must not weaken

- Opening the page and **Connect** never write firmware; only **Install** may cross the write boundary.
- Generic ESP ROM/VID/PID evidence does not prove a QuinLED Dig2Go. When exact machine proof is unavailable, the printed-model confirmation remains required and target-bound.
- The prepared session is bound to an immutable token and the exact `SerialPort`; disconnect, reconnect, port replacement, or changed chip evidence invalidates it.
- Whole-image length/SHA-256 and every required component ID, offset, bound, overlap rule, and slice hash are checked immediately before write.
- `eraseAll` remains false. Backup, readback, boot health, and mesh rejoin are never claimed when they were not observed.
- No runtime Node server, `/api` firmware route, service worker, telemetry, account, firmware chooser, automatic write, or parallel hardware-identity registry may be introduced.

### Vercel handoff

[`vercel.json`](vercel.json) explicitly sets `outputDirectory` to `dist` and leaves install/build commands empty. Connecting the repository should serve the reviewed tracked snapshot; Vercel must not invoke the receipt-dependent production builder. `current.json` revalidates, while immutable release paths receive long-lived caching. The hosting owner remains responsible for the Vercel project and DNS.

Third-party notices are in [`NOTICES.md`](NOTICES.md) and [`easy-flash/THIRD_PARTY_NOTICES.md`](easy-flash/THIRD_PARTY_NOTICES.md).
