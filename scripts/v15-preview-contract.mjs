export const V15_PREVIEW = Object.freeze({
  channel: "local-tailnet-preview-v15", releaseId: "preview-v15-diag-4fa5bc61",
  sourceCommit: "4fa5bc6192f3ecd4bbaf12e3a3917dc4b0febeb8", sourceTree: "c13b1ca5570ffb7ecbd17885e260a08a58893130",
  label: "Preview v15 · Diagnose telemetry",
  targets: Object.freeze([
    Object.freeze({id: "quinled-dig2go", environment: "esp32_quinled_dig2go_tubes"}),
    Object.freeze({id: "athom-c3-tubes", environment: "esp32-c3-athom_tubes"}),
    Object.freeze({id: "waveshare-s3-tubes-remote", environment: "waveshare_s3_tubes_remote"})
  ])
});

// Preview is a receipt-bound build of the complete app, never a reduced shell.
export function assertHolisticPreviewSource({indexHtml, appSource, diagnoseSource, manifest}) {
  const checks = [
    [indexHtml, /flashTab|Flash/], [indexHtml, /diagnoseTab|Diagnose/], [indexHtml, /statusTab|Status/],
    [appSource, /mismatchRecovery|wrong-device|connectedTargetId/], [appSource, /controller|deviceSelect/],
    [appSource, /Done|done/], [diagnoseSource, /telemetry|diagnose/i],
  ];
  if (checks.some(([source, pattern]) => typeof source !== "string" || !pattern.test(source))) throw Error("v15 preview must contain the complete Flash, Diagnose, Status, recovery, selector, and Done app");
  if (!Array.isArray(manifest?.variants) || manifest.variants.length < 1) throw Error("v15 preview must retain the canonical controller catalog");
  return true;
}

// This gate is deliberately separate from production's dependency lock and build command.
export function assertV15PreviewReceipt(receipt) {
  if (receipt?.mode !== "provisional" || receipt?.source?.commit !== V15_PREVIEW.sourceCommit || receipt.source.clean !== true) throw Error("v15 preview requires the exact clean telemetry source");
  if (receipt.targets?.length !== V15_PREVIEW.targets.length) throw Error("v15 preview requires exactly three targets");
  for (let index = 0; index < V15_PREVIEW.targets.length; index++) {
    const expected = V15_PREVIEW.targets[index], actual = receipt.targets[index];
    if (actual?.targetId !== expected.id || actual.environment !== expected.environment) throw Error(`v15 preview target ${index + 1} does not match ${expected.id}/${expected.environment}`);
    if (actual.bootIdentity?.target !== expected.id || actual.bootIdentity?.source !== V15_PREVIEW.sourceCommit || actual.bootIdentity?.tubes !== 15) throw Error(`v15 preview ${expected.id} boot identity is not bound to Tubes v15 PR71`);
  }
  return receipt;
}
