# Easy Flash v15 accepted release candidate

This receipt is portable test evidence for the accepted whole-app tree. It is not a production firmware manifest.

- Repository: `https://github.com/theysayheygreg/WLEDTubes-Easy-Flash.git`
- Base/tree: `462a288` / `3dd90ad9e88c9613fe859ce936f56ad95b144b44`
- Firmware source commit/tree: `f662c58c9b9cbe88914a4ea772763eb90dc52033` / `189defbe6b5a1a6682bdfc08d4497fdb49ad026b`
- Physical result: Flash passed on all three targets; Done and power-cycle accepted.
- Diagnose: ongoing/blocked and explicitly excluded from the completion claim.
- Production: blocked pending SteveEisner/WLEDtubes immutable Actions/Release assets and manifest; no Preview fallback.

| target | merged/application SHA-256 | size (bytes) | physical result |
|---|---|---:|---|
| `quinled-dig2go` | `b62655eb384f9e31d0f388bf6d3f6e968f0abed3856791191fd61a0ef6b523d1` | 1344512 | Flash passed; Done/power-cycle accepted |
| `athom-c3-tubes` | `7416b69815f59847cdd89902774b127d93e3400ab32c8ceec1ecfb6335178e02` | 1283568 | Flash passed; Done/power-cycle accepted |
| `waveshare-s3-tubes-remote` | `ee0f1befcff7e1904f6afe5390c0df0e04bd1530bb6b5ec808f6c5a9fee9e653` | 1306704 | Flash passed; Done/power-cycle accepted |

The tested source includes the accepted C3 lifecycle fix through `152e6c75` and the Diagnose telemetry commits `4fa5bc61`, `a6493b2c`, `f662c58c`. Telemetry is therefore honestly included in these tested bytes; no telemetry-free rebuild has physical acceptance.

Commits after `462a288` (`552718f`, `740028d`, `f28d179`) and future Diagnose work are not included. No production binaries or competing production hashes are committed.
