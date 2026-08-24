export const V15_PREVIEW = Object.freeze({
  channel: "local-tailnet-preview-v15", releaseId: "preview-v15-pr71-f1e48710",
  sourceCommit: "f1e48710c51e2fed3255a12d52e5605a8c863f63", sourceTree: "9d0252683990e8469318a7042d56d12623323d47",
  label: "Preview v15 · PR #71",
  targets: Object.freeze([
    Object.freeze({id: "quinled-dig2go", environment: "esp32_quinled_dig2go_tubes"}),
    Object.freeze({id: "athom-c3-tubes", environment: "esp32-c3-athom_tubes"}),
    Object.freeze({id: "waveshare-s3-tubes-remote", environment: "waveshare_s3_tubes_remote"})
  ])
});

// This gate is deliberately separate from production's dependency lock and build command.
export function assertV15PreviewReceipt(receipt) {
  if (receipt?.mode !== "provisional" || receipt?.source?.commit !== V15_PREVIEW.sourceCommit || receipt.source.clean !== true) throw Error("v15 preview requires the exact clean PR71 source");
  if (receipt.targets?.length !== V15_PREVIEW.targets.length) throw Error("v15 preview requires exactly three targets");
  for (let index = 0; index < V15_PREVIEW.targets.length; index++) {
    const expected = V15_PREVIEW.targets[index], actual = receipt.targets[index];
    if (actual?.targetId !== expected.id || actual.environment !== expected.environment) throw Error(`v15 preview target ${index + 1} does not match ${expected.id}/${expected.environment}`);
    if (actual.bootIdentity?.target !== expected.id || actual.bootIdentity?.source !== V15_PREVIEW.sourceCommit || actual.bootIdentity?.tubes !== 15) throw Error(`v15 preview ${expected.id} boot identity is not bound to Tubes v15 PR71`);
  }
  return receipt;
}
