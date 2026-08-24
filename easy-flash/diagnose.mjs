const RESCUE_PATTERNS=[/WLED rescue mode(?::| active)/i];
const ERROR_PATTERNS=[/Guru Meditation|panic|fatal|brownout|assert|error:/i];
const BUTTON_DIAGNOSTIC=/WLED button diagnostics:\s*(STUCK_BUTTON|AVAILABLE\/INACTIVE|AVAILABLE|INACTIVE|healthy|disabled \(WLED_DISABLE_STUCK_BUTTON_DIAGNOSTICS\))/i;
const DEFAULT_BAUD_RATE=115200,READ_WINDOW_MS=1200,MAX_BYTES=8192;
export function parseDiagnosticText(text=""){
 const raw=String(text), rescue=RESCUE_PATTERNS.some(p=>p.test(raw)), buttonDiagnostic=[...raw.matchAll(new RegExp(BUTTON_DIAGNOSTIC.source,"gi"))].at(-1)?.[1]??null;
 const target=raw.match(/(?:target|board|model)\s*[:=]\s*([^\r\n,]+)/i)?.[1]?.trim()||null;
 const chip=raw.match(/(?:chip|chip family|platform)\s*[:=]\s*([^\r\n,]+)/i)?.[1]?.trim()||null;
 const malformed=raw.trim()&&(!target&&!chip)&&ERROR_PATTERNS.some(p=>p.test(raw));
 const buttonProblem=buttonDiagnostic?.toUpperCase()==="STUCK_BUTTON", normalizedButton=buttonDiagnostic?.toLowerCase()||null;
 return {raw,state:rescue?"rescue":malformed?"malformed":raw.trim()?"telemetry":"unsupported",rescue,malformed,ledsAbsent:rescue,networkAbsent:rescue,target,observedTarget:target,chip,button:buttonDiagnostic,buttonProblem,buttonDiagnostics:normalizedButton,targetIdentity:target?undefined:"unknown"};
}
export function diagnosePresentation(d={}){
 if(d.state==="rescue")return {tone:"red",label:"Controller needs attention",summary:"The controller started in recovery mode.",next:"Confirm the exact target before using Flash; Diagnose does not start recovery.",action:"Check another USB device",recovery:true};
 if(d.buttonProblem)return {tone:"red",label:"Controller needs attention",summary:"The controller reported that its button may be stuck.",next:"Follow the controller's button recovery guidance before checking again.",action:"Check another USB device",recovery:true};
 if(d.state==="malformed"||d.error)return {tone:"red",label:"Controller needs attention",summary:"The controller responded, but its information conflicted or could not be read.",next:"Review the technical details before checking again.",action:"Check another USB device"};
 if(d.state==="telemetry"&&d.target&&d.chip&&d.buttonDiagnostics!=="stuck_button")return {tone:"green",label:"Controller looks good",summary:"The controller responded and did not report a problem.",next:"",action:"Check another USB device"};
 if((d.bytesCaptured??0)>0)return {tone:"yellow",label:"Couldn’t check this controller",summary:"The controller connected, but it did not provide enough information to confirm its condition.",next:"",action:"Choose USB device again"};
 return {tone:"yellow",label:"Couldn’t check this controller",summary:"The controller connected, but it did not provide enough information to confirm its condition.",next:"",action:"Choose USB device again"};
}
export function diagnoseSummary(d){return diagnosePresentation(d).summary;}
export function createDiagnoseRuntime({serial=globalThis.navigator?.serial,baudRate=DEFAULT_BAUD_RATE,timeoutMs=READ_WINDOW_MS,maxBytes=MAX_BYTES}={}){async function inspect({onText=()=>{},onStatus=()=>{}}={}){if(!serial?.requestPort)throw new Error("Open Easy Flash in desktop Chrome or Edge over HTTPS to use serial diagnostics.");const port=await serial.requestPort(),info=port.getInfo?.()||{};let opened=false,reader,text="",bytesRead=0;try{if(!port.readable){await port.open({baudRate});opened=true}onStatus("Connected read-only. Waiting for a diagnostic banner…");reader=port.readable?.getReader();if(!reader)return {...parseDiagnosticText(""),portInfo:info,bytesCaptured:0};const rawBytes=new Uint8Array(maxBytes),deadline=Date.now()+timeoutMs;while(bytesRead<maxBytes&&Date.now()<deadline){let result;try{result=await Promise.race([reader.read(),new Promise(r=>setTimeout(()=>r({timeout:true}),Math.max(1,deadline-Date.now())))])}catch{break}if(result.timeout){await reader.cancel?.();break}if(result.done)break;if(result.value){const chunk=result.value.subarray(0,maxBytes-bytesRead);rawBytes.set(chunk,bytesRead);bytesRead+=chunk.byteLength}}let decoded=rawBytes.subarray(0,bytesRead);while(decoded.byteLength){try{text=new TextDecoder("utf-8",{fatal:true}).decode(decoded);break}catch{decoded=decoded.subarray(0,-1)}}const parsed=parseDiagnosticText(text);onText(parsed.raw);return {...parsed,portInfo:info,bytesCaptured:bytesRead}}finally{reader?.releaseLock();if(opened)await port.close()}}return {inspect}};
const runtime=createDiagnoseRuntime();export const inspect=runtime.inspect;
