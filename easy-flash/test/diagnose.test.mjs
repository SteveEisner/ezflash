import assert from "node:assert/strict";
import test from "node:test";
import { createDiagnoseRuntime, parseDiagnosticText } from "../diagnose.mjs";

test("parses exact rescue and button banners without broad rescue matches", () => {
  assert.equal(parseDiagnosticText("WLED rescue mode active. Flash over serial, or send 'format'/'reboot'.").rescue, true);
  assert.equal(parseDiagnosticText("AP mode active; no network yet").rescue, false);
  assert.equal(parseDiagnosticText("WLED button diagnostics: STUCK_BUTTON").buttonProblem, true);
  assert.equal(parseDiagnosticText("WLED button diagnostics: healthy").buttonDiagnostics, "healthy");
  assert.equal(parseDiagnosticText("WLED button diagnostics: disabled (WLED_DISABLE_STUCK_BUTTON_DIAGNOSTICS)").buttonDiagnostics, "disabled");
});

function mockPort({ chunks = [], rejectRead = false, hang = false } = {}) {
  let released = false;
  let closed = false;
  let cancelled = false;
  const reader = {
    async read() {
      if (rejectRead) throw new Error("device disconnected");
      if (hang) return await new Promise(() => {});
      const chunk = chunks.shift();
      return chunk === undefined ? { done: true } : { value: new TextEncoder().encode(chunk), done: false };
    },
    releaseLock() { released = true; },
    async cancel() { cancelled = true; },
  };
  let isOpen = false;
  return {
    get readable() { return isOpen ? { getReader: () => reader } : null; },
    async open(options) { this.openOptions = options; isOpen = true; },
    async close() { closed = true; },
    getInfo: () => ({ usbVendorId: 1234 }),
    state: () => ({ released, closed, cancelled }),
  };
}

test("opens a closed port, reads telemetry, and closes only what it opened", async () => {
  const port = mockPort({ chunks: ["WLED button diagnostics: healthy\n"] });
  const result = await createDiagnoseRuntime({ serial: { requestPort: async () => port } }).inspect();
  assert.equal(port.openOptions.baudRate, 115200);
  assert.equal(result.buttonDiagnostics, "healthy");
  assert.deepEqual(port.state(), { released: true, closed: true, cancelled: false });
});

test("timeout cancels and cleans up the bounded read", async () => {
  const port = mockPort({ hang: true });
  const result = await createDiagnoseRuntime({ serial: { requestPort: async () => port }, timeoutMs: 5 }).inspect();
  assert.equal(result.state, "unsupported");
  assert.deepEqual(port.state(), { released: true, closed: true, cancelled: true });
});

test("missing telemetry is not healthy and disconnect still releases and closes", async () => {
  const port = mockPort({ rejectRead: true });
  const result = await createDiagnoseRuntime({ serial: { requestPort: async () => port } }).inspect();
  assert.equal(result.state, "unsupported");
  assert.deepEqual(port.state(), { released: true, closed: true, cancelled: false });
});
