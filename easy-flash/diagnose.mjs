const RESCUE_PATTERNS=[
	/WLED rescue mode: startup button held/i,
	/WLED rescue mode: serial command received/i,
	/WLED rescue mode active\. Flash over serial, or send 'format'\/'reboot'\./i,
	/WLED rescue mode: (?:skipping config|LED output skipped|usermods skipped|WiFi scan skipped|network interfaces skipped)/i
];
const BUTTON_DIAGNOSTIC=/WLED button diagnostics:\s*(STUCK_BUTTON|AVAILABLE|INACTIVE|healthy|disabled \(WLED_DISABLE_STUCK_BUTTON_DIAGNOSTICS\))/ig;
const EXACT_TARGETS=new Map([
	["quinled dig2go","QuinLED Dig2Go"],
	["quinled-dig2go","QuinLED Dig2Go"],
	["athom esp32-c3 controller","Athom ESP32-C3 controller"],
	["athom-c3-tubes","Athom ESP32-C3 controller"],
	["waveshare esp32-s3-touch-amoled-2.16","Waveshare ESP32-S3-Touch-AMOLED-2.16"],
	["waveshare-s3-tubes-remote","Waveshare ESP32-S3-Touch-AMOLED-2.16"]
]);
const DEFAULT_BAUD_RATE=115200,READ_WINDOW_MS=1200,MAX_BYTES=8192;

// Parses only exact WLED rescue/button banners and never promotes a chip family into board identity.
// A connected controller that is quiet is ONLINE (healthy-looking), not unsupported: healthy WLED
// only prints a banner at boot, then goes silent. "Unreadable" is decided by the caller (no reader /
// read failure), not by silence.
export function parseDiagnosticText(text="") {
	const raw=String(text),rescue=RESCUE_PATTERNS.some(pattern=>pattern.test(raw));
	const buttonMatches=[...raw.matchAll(BUTTON_DIAGNOSTIC)],button=buttonMatches.at(-1)?.[1]??null;
	const observedTarget=raw.match(/(?:target|board|model)\s*[:=]\s*([^\r\n,]+)/i)?.[1]?.trim()||null;
	const observedChip=raw.match(/(?:chip|chip family|platform)\s*[:=]\s*([^\r\n,]+)/i)?.[1]?.trim()||null;
	const target=observedTarget?EXACT_TARGETS.get(observedTarget.toLowerCase())||null:null;
	const normalizedButton=button?.toLowerCase();
	return {raw,state:rescue?"rescue":raw.trim()?"telemetry":"online",rescue,ledsAbsent:rescue,networkAbsent:rescue,target,targetIdentity:target?"exact-report":"unknown",observedTarget,chip:observedChip,button,buttonProblem:button?.toUpperCase()==="STUCK_BUTTON",buttonDiagnostics:["available","inactive","healthy"].includes(normalizedButton)?normalizedButton:normalizedButton?.startsWith("disabled")?"disabled":button?"problem":null};
}

export function diagnoseSummary(diagnostic) {
	if(diagnostic.state==="rescue")return "Rescue mode is active. LEDs and network are intentionally absent; the device may be recoverable.";
	if(diagnostic.unreadable)return "Diagnose could not read the controller. It may be unsupported, disconnected, or on an unrecognized port.";
	if(diagnostic.buttonProblem)return "The controller reported STUCK_BUTTON. Inspect the physical input before recovery.";
	if(diagnostic.state==="telemetry")return "The controller responded with read-only diagnostic telemetry.";
	if(diagnostic.state==="online")return "Controller is online and looks healthy. No rescue, stuck-button, or error signature was observed. (A healthy controller is quiet after boot; lights on confirms it is running.)";
	return "Diagnose could not reach the controller.";
}

// Captures a bounded raw byte window before UTF-8 decoding, then closes only the port it opened.
export function createDiagnoseRuntime({serial=globalThis.navigator?.serial,baudRate=DEFAULT_BAUD_RATE,timeoutMs=READ_WINDOW_MS,maxBytes=MAX_BYTES}={}) {
	async function inspect({onText=()=>{},onStatus=()=>{}}={}) {
		if(!serial?.requestPort)throw Error("Open Easy Flash in desktop Chrome or Edge over HTTPS to use serial diagnostics.");
		const port=await serial.requestPort(),portInfo=port.getInfo?.()||{};let opened=false,reader,bytesRead=0,readError=null;
		try {
			if(!port.readable){await port.open({baudRate});opened=true;}onStatus("Connected read-only. Waiting for a diagnostic banner…");reader=port.readable?.getReader();
			if(!reader)return {...parseDiagnosticText(""),unreadable:true,portInfo};const rawBytes=new Uint8Array(maxBytes),deadline=Date.now()+timeoutMs;
			while(bytesRead<maxBytes&&Date.now()<deadline){const remaining=Math.max(1,deadline-Date.now());let result;try{result=await Promise.race([reader.read(),new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),remaining))]);}catch(error){readError=error;break;}if(result.timeout){await reader.cancel?.();break;}if(result.done)break;if(result.value){const chunk=result.value.subarray(0,maxBytes-bytesRead);rawBytes.set(chunk,bytesRead);bytesRead+=chunk.byteLength;}}
			let decoded=rawBytes.subarray(0,bytesRead),text="";while(decoded.byteLength){try{text=new TextDecoder("utf-8",{fatal:true}).decode(decoded);break;}catch{decoded=decoded.subarray(0,-1);}}
			const parsed=parseDiagnosticText(text);onText(parsed.raw);return {...parsed,portInfo,bytesCaptured:bytesRead,unreadable:Boolean(readError&&!bytesRead),readError:readError?.message||null};
		} finally {if(reader)reader.releaseLock();if(opened)await port.close();}
	}
	return {inspect};
}

const runtime=createDiagnoseRuntime();
export const inspect=runtime.inspect;
// AI: end
