import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../local-flash.mjs", import.meta.url), "utf8");

test("ROM install does not claim an application-session preflight or soft-reset fallback", () => {
  assert.match(source, /loader\.main\(\)/);
  assert.match(source, /loader\.after\("hard_reset"\)/);
  assert.doesNotMatch(source, /WLEDTUBES_BOOT.*beforeWrite/);
  assert.doesNotMatch(source, /after\("soft_reset"\)/);
});

test("ROM install keeps missing post-boot identity pending instead of Done", () => {
  assert.match(source, /verification\.status===\"pending\"/);
  assert.match(source, /health:verification\.status===\"verified\"\?\"boot-identity-verified\":\"unverified\"/);
  assert.match(source, /pendingVerification=verification\.status===\"pending\"/);
});
