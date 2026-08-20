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

// Maps a reported board/model/target name onto a recognized Tubes controller. Keep in step
// with the hosted catalog (easy-flash/releases/.../inputs/*server.json adds variants).
const KNOWN_TARGETS = [
  { family: "quinled-dig2go", names: [/quinled\s*dig2go/i, /\bdig2go\b/i, /esp32-(?:devkitc|wrover)/i] },
  { family: "waveshare-s3-touch-amoled-2.16", names: [/waveshare.*s3.*(?:touch|amoled)/i, /esp32-s3(?:-devkitc)?-?1?/i] },
];

function normalizeTarget(rawWord) {
  if (!rawWord) return { word: null, family: null, known: false };
  const word = String(rawWord).trim();
  for (const t of KNOWN_TARGETS) if (t.names.some((re) => re.test(word))) return { word, family: t.family, known: true };
  return { word, family: null, known: false };
}

export function parseDiagnosticText(text = "") {
  const raw = String(text);
  const rescue = RESCUE_PATTERNS.some((pattern) => pattern.test(raw));
  const buttonDiagnostic = raw.match(BUTTON_DIAGNOSTIC)?.[1] ?? null;
  const targetLine = raw.match(/(?:target|board|model)\s*[:=]\s*([^\r\n,]+)/i)?.[1]?.trim() || null;
  const normalizedTarget = normalizeTarget(targetLine);
  const chip = raw.match(/(?:chip|chip family|platform)\s*[:=]\s*([^\r\n,]+)/i)?.[1]?.trim();
  // A connected controller that is quiet is ONLINE (healthy-looking), not unsupported:
  // healthy WLED only prints a banner at boot, then goes silent. Empty output therefore
  // means "online, no fault signature" — NOT "unsupported". "Unsupported" is reserved for
  // not being able to talk to the device at all, which the caller decides (no reader /
  // read failure), not by silence.
  const state = rescue ? "rescue" : (raw.trim() ? "telemetry" : "online");
  return {
    raw,
    state,
    rescue,
    ledsAbsent: rescue,
    networkAbsent: rescue,
    target: normalizedTarget.word || null,
    hardwareFamily: normalizedTarget.family || null,
    targetKnown: normalizedTarget.known,
    chip: chip || null,
    button: buttonDiagnostic,
    buttonProblem: buttonDiagnostic?.toUpperCase() === "STUCK_BUTTON",
    buttonDiagnostics: ["available", "inactive", "healthy"].includes(buttonDiagnostic?.toLowerCase()) ? buttonDiagnostic.toLowerCase() : buttonDiagnostic?.toLowerCase().startsWith("disabled") ? "disabled" : buttonDiagnostic ? "problem" : null,
  };
}

export function diagnoseSummary(diagnostic) {
  if (diagnostic.state === "rescue") return "Rescue mode is active. LEDs and network are intentionally absent; the device may be recoverable.";
  if (diagnostic.unreadable) return "Diagnose could not read the controller. It may be unsupported, disconnected, or on an unrecognized port.";
  if (diagnostic.state === "telemetry") return diagnostic.buttonProblem ? "The device reported a button or target diagnostic. Review it before choosing recovery." : "The device responded with diagnostic telemetry.";
  if (diagnostic.state === "online") return "Controller is online and looks healthy. No rescue, stuck-button, or error signature was observed. (A healthy controller is quiet after boot; lights on confirms it is running.)";
  return "Diagnose could not reach the controller.";
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
    let readFailed = false;
    try {
      if (!port.readable) {
        await port.open({ baudRate });
        opened = true;
      }
      onStatus("Connected read-only. Waiting for a diagnostic banner…");
      reader = port.readable?.getReader();
      if (!reader) return { ...parseDiagnosticText(""), unreadable: true, portInfo: info };
      const rawBytes = new Uint8Array(maxBytes);
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
          readFailed = true;
          break;
        }
        if (result.timeout) { await reader.cancel?.(); break; }
        if (result.done) break;
        if (result.value) {
          const chunk = result.value.subarray(0, maxBytes - bytesRead);
          rawBytes.set(chunk, bytesRead);
          bytesRead += chunk.byteLength;
        }
      }
      // A read that errored (disconnect, invalid state) is genuinely unreadable and must NOT
      // be labeled healthy-online. Only a clean silent read (a healthy quiet board) is "online".
      if (readFailed && bytesRead === 0) return { ...parseDiagnosticText(""), unreadable: true, portInfo: info };
      // Decode only complete UTF-8 code points. TextDecoder's replacement for an incomplete
      // suffix can be three bytes, exceeding the raw byte cap.
      let decodedBytes = rawBytes.subarray(0, bytesRead);
      while (decodedBytes.byteLength) {
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(decodedBytes); break; }
        catch { decodedBytes = decodedBytes.subarray(0, -1); }
      }
      const parsed = parseDiagnosticText(text);
      onText(parsed.raw);
      // A read that errored mid-stream without yielding a signature is unreadable,
      // not "online and healthy" — the reader lost the device.
      if (readFailed && parsed.state === "online") return { ...parsed, unreadable: true, portInfo: info };
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