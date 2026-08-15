const RESCUE_PATTERNS = [
  /rescue|safe[- ]mode|recovery|waiting for firmware|no network|ap mode/i,
];

export function parseDiagnosticText(text = "") {
  const raw = String(text);
  const lower = raw.toLowerCase();
  const rescue = RESCUE_PATTERNS.some((pattern) => pattern.test(raw));
  const button = raw.match(/(?:button|key|input)\s*[:=]?\s*([a-z0-9 _-]+?)(?:\s+(?:stuck|held|unexpected)|[\r\n]|$)/i);
  const target = raw.match(/(?:target|board|model)\s*[:=]\s*([^\r\n,]+)/i)?.[1]?.trim();
  const chip = raw.match(/(?:chip|chip family|platform)\s*[:=]\s*([^\r\n,]+)/i)?.[1]?.trim();
  return {
    raw,
    state: rescue ? "rescue" : raw.trim() ? "telemetry" : "unsupported",
    rescue,
    ledsAbsent: rescue,
    networkAbsent: rescue,
    target: target || null,
    chip: chip || null,
    button: button ? button[1].trim() : null,
    buttonProblem: /stuck|held|unexpected button|button error/i.test(raw),
  };
}

export function diagnoseSummary(diagnostic) {
  if (diagnostic.state === "rescue") return "Rescue mode is active. LEDs and network are intentionally absent; the device may be recoverable.";
  if (diagnostic.state === "telemetry") return diagnostic.buttonProblem ? "The device reported a button or target diagnostic. Review it before choosing recovery." : "The device responded with diagnostic telemetry.";
  return "No supported diagnostic telemetry was found. This does not prove the device is healthy or faulty.";
}

export function createDiagnoseRuntime({ serial = globalThis.navigator?.serial } = {}) {
  async function inspect({ onText = () => {}, onStatus = () => {} } = {}) {
    if (!serial?.requestPort) throw new Error("Open Easy Flash in desktop Chrome or Edge over HTTPS to use serial diagnostics.");
    const port = await serial.requestPort();
    const info = port.getInfo?.() || {};
    const diagnostic = parseDiagnosticText("");
    onStatus("Connected read-only. Waiting for a diagnostic banner…");
    // Do not open, reset, write, or invoke a bootloader. A port that is already
    // open may expose boot/runtime text; otherwise report telemetry as unknown.
    if (port.readable) {
      const reader = port.readable.getReader();
      try {
        const decoder = new TextDecoder();
        const result = await Promise.race([
          reader.read().then(({ value }) => decoder.decode(value || new Uint8Array())),
          new Promise((resolve) => setTimeout(() => resolve(""), 1200)),
        ]);
        const parsed = parseDiagnosticText(result);
        onText(parsed.raw);
        return { ...parsed, portInfo: info };
      } finally { reader.releaseLock(); }
    }
    return { ...diagnostic, portInfo: info };
  }
  return { inspect };
}

const runtime = createDiagnoseRuntime();
export const inspect = runtime.inspect;
