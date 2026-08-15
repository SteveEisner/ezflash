const RESCUE_PATTERNS = [
  /WLED rescue mode: startup button held/i,
  /WLED rescue mode: serial command received/i,
  /WLED rescue mode active\. Flash over serial, or send 'format'\/'reboot'\./i,
  /WLED rescue mode: (?:skipping config|LED output skipped|usermods skipped|WiFi scan skipped|network interfaces skipped)/i,
];
const BUTTON_DIAGNOSTIC = /WLED button diagnostics:\s*(STUCK_BUTTON|AVAILABLE|INACTIVE|healthy|disabled \(WLED_DISABLE_STUCK_BUTTON_DIAGNOSTICS\))/i;
const DEFAULT_BAUD_RATE = 115200;
const READ_WINDOW_MS = 1200;
const MAX_BYTES = 8192;

export function parseDiagnosticText(text = "") {
  const raw = String(text);
  const rescue = RESCUE_PATTERNS.some((pattern) => pattern.test(raw));
  const buttonDiagnostic = raw.match(BUTTON_DIAGNOSTIC)?.[1] ?? null;
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
    button: buttonDiagnostic,
    buttonProblem: buttonDiagnostic?.toUpperCase() === "STUCK_BUTTON",
    buttonDiagnostics: ["available", "inactive", "healthy"].includes(buttonDiagnostic?.toLowerCase()) ? buttonDiagnostic.toLowerCase() : buttonDiagnostic?.toLowerCase().startsWith("disabled") ? "disabled" : buttonDiagnostic ? "problem" : null,
  };
}

export function diagnoseSummary(diagnostic) {
  if (diagnostic.state === "rescue") return "Rescue mode is active. LEDs and network are intentionally absent; the device may be recoverable.";
  if (diagnostic.state === "telemetry") return diagnostic.buttonProblem ? "The device reported a button or target diagnostic. Review it before choosing recovery." : "The device responded with diagnostic telemetry.";
  return "No supported diagnostic telemetry was found. This does not prove the device is healthy or faulty.";
}

export function createDiagnoseRuntime({ serial = globalThis.navigator?.serial, baudRate = DEFAULT_BAUD_RATE, timeoutMs = READ_WINDOW_MS, maxBytes = MAX_BYTES } = {}) {
  async function inspect({ onText = () => {}, onStatus = () => {} } = {}) {
    if (!serial?.requestPort) throw new Error("Open Easy Flash in desktop Chrome or Edge over HTTPS to use serial diagnostics.");
    const port = await serial.requestPort();
    const info = port.getInfo?.() || {};
    let opened = false;
    let reader;
    let text = "";
    let bytesRead = 0;
    try {
      if (!port.readable) {
        await port.open({ baudRate });
        opened = true;
      }
      onStatus("Connected read-only. Waiting for a diagnostic banner…");
      reader = port.readable?.getReader();
      if (!reader) return { ...parseDiagnosticText(""), portInfo: info };
      const decoder = new TextDecoder();
      const deadline = Date.now() + timeoutMs;
      while (bytesRead < maxBytes && Date.now() < deadline) {
        const remaining = Math.max(1, deadline - Date.now());
        let result;
        try {
          result = await Promise.race([
            reader.read(),
            new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), remaining)),
          ]);
        } catch {
          break;
        }
        if (result.timeout) { await reader.cancel?.(); break; }
        if (result.done) break;
        if (result.value) {
          const chunk = result.value.subarray(0, maxBytes - bytesRead);
          bytesRead += chunk.byteLength;
          text += decoder.decode(chunk, { stream: bytesRead < maxBytes });
        }
      }
      text += decoder.decode();
      const parsed = parseDiagnosticText(text);
      onText(parsed.raw);
      return { ...parsed, portInfo: info };
    } finally {
      if (reader) reader.releaseLock();
      if (opened) await port.close();
    }
  }
  return { inspect };
}

const runtime = createDiagnoseRuntime();
export const inspect = runtime.inspect;
