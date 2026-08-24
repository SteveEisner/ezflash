import { ESPLoader, Transport } from "./vendor/esptool-js/bundle.js";
import { inspectImageBytes, classifyDiagnose } from "./diagnose-image.mjs";

const RESCUE_PATTERNS=[/WLED rescue mode(?::| active)/i];
const ERROR_PATTERNS=[/Guru Meditation|panic|fatal|brownout|assert|error:/i];
const DEFAULT_BAUD_RATE=115200,READ_WINDOW_MS=6000,MAX_BYTES=8192;
export function parseDiagnosticText(text=""){
 const raw=String(text), rescue=RESCUE_PATTERNS.some(p=>p.test(raw));
 const target=raw.match(/(?:target|board|model)\s*[:=]\s*([^\r\n,]+)/i)?.[1]?.trim()||null;
 const chip=raw.match(/(?:chip|chip family|platform)\s*[:=]\s*([^\r\n,]+)/i)?.[1]?.trim()||null;
 const tubes=raw.match(/\btubes\s*[:=]?\s*(\d+)/i)?.[1] ? Number(raw.match(/\btubes\s*[:=]?\s*(\d+)/i)[1]) : null;
 const version=raw.match(/\b(?:version|release)\s*[:=]\s*([^\s\r\n]+)/i)?.[1]||null;
 const rescueValue=raw.match(/WLEDTUBES_DIAG\s+rescue=(ACTIVE|INACTIVE)/i)?.[1]||null;
 const button=raw.match(/WLEDTUBES_DIAG\s+button=(STUCK_BUTTON|ACTIVE|INACTIVE|UNAVAILABLE)/i)?.[1]||([...raw.matchAll(/WLED button diagnostics:\s*(STUCK_BUTTON|AVAILABLE\/INACTIVE|AVAILABLE|INACTIVE|healthy)/gi)].at(-1)?.[1]?.toUpperCase()||null);
 const malformed=raw.trim()&&ERROR_PATTERNS.some(p=>p.test(raw))&&(!target||!chip||!tubes);
 const complete=Boolean(target&&chip&&tubes!==null&&rescueValue&&button);
 const buttonProblem=button==="STUCK_BUTTON";
 return {raw,state:rescue||rescueValue==="ACTIVE"?"rescue":malformed?"malformed":complete?"telemetry":raw.trim()?"partial":"unsupported",rescue:rescue||rescueValue==="ACTIVE",malformed,ledsAbsent:rescue,networkAbsent:rescue,target,observedTarget:target,chip,tubes,version,button,buttonProblem,buttonDiagnostics:button?.toLowerCase()||null,targetIdentity:target?undefined:"unknown"};
}
export function diagnosePresentation(d={}){
 const complete=d.state==="telemetry"&&d.target&&d.chip&&d.tubes!==null&&d.rescue===false&&d.button&&!d.buttonProblem;
 const supported=Boolean(d.target||d.targetIdentity&&d.targetIdentity!=="unknown"||(d.portInfo?.usbVendorId===0x303a&&d.portInfo?.usbProductId===0x1001));
 const benign=Boolean(d.rescue===false&&(d.rescueValue==="INACTIVE"||/rescue=INACTIVE/i.test(d.raw||"")||complete));
 if(d.rescue||d.buttonProblem||d.state==="malformed")return {tone:"red",label:"Broke",summary:d.rescue?"The controller is in rescue mode.":d.buttonProblem?"The controller reported STUCK_BUTTON.":"The controller reported conflicting or fatal information.",next:"Review the technical details before using Flash.",action:"Check another USB device"};
 if(complete&&d.tubes<15)return {tone:"yellow",label:"Old",summary:"This is a complete trusted Tubes identity below the current accepted generation.",next:"",action:"Check another USB device"};
 if(complete&&d.tubes===15)return {tone:"green",label:"Healthy",summary:"This is a complete current Tubes v15 identity with rescue inactive and no observed button fault.",next:"",action:"Check another USB device"};
 if(supported&&benign)return {tone:"green",label:"Healthy",summary:"The supported controller responded normally and reported no explicit fault.",next:"",action:"Check another USB device"};
 return {tone:"yellow",label:"Unknown",summary:"The controller did not provide a valid supported diagnostic report.",next:"",action:"Choose USB device again"};
}
export function diagnoseSummary(d){return diagnosePresentation(d).summary;}
export function createReadOnlyInspector({loaderFactory = async ({port, baudRate, onStatus}) => { const transport = new Transport(port); const loader = new ESPLoader({ transport, baudrate: baudRate, romBaudrate: baudRate, terminal: { clean: onStatus, write: onStatus, writeLine: onStatus } }); await loader.main(); return { loader, transport }; }} = {}) {
 return async function inspect({ port, targetId, currentSha256, currentLength, onStatus = () => {} }) {
  const { loader, transport } = await loaderFactory({ port, baudRate: DEFAULT_BAUD_RATE, onStatus });
  try {
   const read = async (offset, length) => new Uint8Array(await loader.readFlash({ offset, length, reportProgress: () => {} }));
   const partitionTable = await read(0x8000, 0x1000);
   const otaSelect = await read(0xd000, 0x2000);
   const partitions = (await import("./diagnose-image.mjs")).parsePartitionTable(partitionTable);
   const apps = partitions.filter(p => p.type === 0 && p.subtype >= 0x10 && p.subtype <= 0x1f);
   const max = Math.max(...apps.map(p => p.size));
   const appBytes = await read(apps.length > 1 ? 0x10000 : apps[0].offset, max);
   return inspectImageBytes({ partitionTable, otaSelect: apps.length > 1 ? otaSelect : null, appBytes, targetId, currentSha256, currentLength });
  } finally { await transport.disconnect?.(); await transport.close?.(); }
 };
}

export function createDiagnoseRuntime({serial=globalThis.navigator?.serial,baudRate=DEFAULT_BAUD_RATE,timeoutMs=READ_WINDOW_MS,maxBytes=MAX_BYTES,inspector=createReadOnlyInspector()}={}){async function inspect({targetId,currentSha256,currentLength,onText=()=>{},onStatus=()=>{}}={}){if(!serial?.requestPort)throw new Error("Open Easy Flash in desktop Chrome or Edge over HTTPS to use serial diagnostics.");const port=await serial.requestPort(),info=port.getInfo?.()||{};let opened=false,reader,text="",bytesRead=0;try{if(!port.readable){await port.open({baudRate});opened=true}onStatus("Connected read-only. Reading diagnostic banner and active image…");reader=port.readable?.getReader();if(!reader)return {...parseDiagnosticText(""),portInfo:info,bytesCaptured:0};const rawBytes=new Uint8Array(maxBytes),deadline=Date.now()+timeoutMs;while(bytesRead<maxBytes&&Date.now()<deadline){let result;try{result=await Promise.race([reader.read(),new Promise(r=>setTimeout(()=>r({timeout:true}),Math.max(1,deadline-Date.now())))])}catch{break}if(result.timeout){await reader.cancel?.();break}if(result.done)break;if(result.value){const chunk=result.value.subarray(0,maxBytes-bytesRead);rawBytes.set(chunk,bytesRead);bytesRead+=chunk.byteLength}}let decoded=rawBytes.subarray(0,bytesRead);while(decoded.byteLength){try{text=new TextDecoder("utf-8",{fatal:true}).decode(decoded);break}catch{decoded=decoded.subarray(0,-1)}}const parsed=parseDiagnosticText(text);onText(parsed.raw);if(!targetId)return {...parsed,portInfo:info,bytesCaptured:bytesRead};const image=await inspector({port,targetId,currentSha256,currentLength,onStatus});return {...parsed,...image,portInfo:info,bytesCaptured:bytesRead}}finally{reader?.releaseLock();if(opened)await port.close()}}return {inspect}};
const runtime=createDiagnoseRuntime();export const inspect=runtime.inspect;
