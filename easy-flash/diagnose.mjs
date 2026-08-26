const RESCUE_PATTERNS=[/WLED rescue mode(?::| active)/i];
const ERROR_PATTERNS=[/Guru Meditation|panic|fatal|brownout|assert|error:/i];
const DEFAULT_BAUD_RATE=115200,READ_WINDOW_MS=6000,MAX_BYTES=8192;
const USB_CONTROLLERS=new Map([[0x303a,"Espressif USB controller"]]);
const PARTITION_TABLE_OFFSET=0x1000,PARTITION_ENTRY_SIZE=32,PARTITION_MAGIC=0x50aa,PARTITION_TERMINATOR=0xffff;
function usbController(info={}){return USB_CONTROLLERS.get(Number(info.usbVendorId))||null}
function partitionError(message){throw new RangeError(`ESP32 partition table ${message}`)}
export function parseEsp32PartitionTable(input,{flashSizeBytes,tableOffset=PARTITION_TABLE_OFFSET,maxEntries=95}={}){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input||[]);
 if(!Number.isInteger(flashSizeBytes)||flashSizeBytes<=0)partitionError("requires a positive flash size");
 if(!Number.isInteger(tableOffset)||tableOffset<0||tableOffset%0x1000)partitionError("has an invalid offset");
 if(bytes.byteLength<tableOffset+PARTITION_ENTRY_SIZE)partitionError("is truncated");
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),entries=[];let terminated=false;
 for(let index=0;index<maxEntries;index++){
  const offset=tableOffset+index*PARTITION_ENTRY_SIZE;
  if(offset+PARTITION_ENTRY_SIZE>bytes.byteLength)partitionError("is truncated before terminator");
  const magic=view.getUint16(offset,true);
  if(magic===PARTITION_TERMINATOR){terminated=true;break}
  if(magic!==PARTITION_MAGIC)partitionError(`entry ${index} has invalid magic 0x${magic.toString(16)}`);
  const type=view.getUint8(offset+2),subtype=view.getUint8(offset+3),partOffset=view.getUint32(offset+4,true),size=view.getUint32(offset+8,true);
  if(!size||partOffset>=flashSizeBytes||size>flashSizeBytes-partOffset)partitionError(`entry ${index} is out of bounds`);
  const labelBytes=bytes.subarray(offset+12,offset+28);let end=labelBytes.indexOf(0);if(end<0)end=labelBytes.length;
  const name=new TextDecoder().decode(labelBytes.subarray(0,end));entries.push({index,magic,type,subtype,name,offset:partOffset,size});
 }
 if(!terminated)partitionError("has no terminator");
 return {valid:true,magic:PARTITION_MAGIC,entries,terminatorOffset:tableOffset+entries.length*PARTITION_ENTRY_SIZE};
}
function versionGeneration(version){const match=String(version||"").match(/(?:v|version\s*)?(13|14|15)(?:\.\d+)?$/i);return match?Number(match[1]):null}
export function parseDiagnosticText(text=""){
 const raw=String(text), rescue=RESCUE_PATTERNS.some(p=>p.test(raw));
 const target=raw.match(/(?:target|board|model)\s*[:=]\s*([^\r\n,]+)/i)?.[1]?.trim()||null;
 const chip=raw.match(/(?:chip|chip family|platform)\s*[:=]\s*([^\r\n,]+)/i)?.[1]?.trim()||null;
 const tubes=raw.match(/\btubes\s*[:=]?\s*(\d+)/i)?.[1] ? Number(raw.match(/\btubes\s*[:=]?\s*(\d+)/i)[1]) : null;
 const version=raw.match(/\b(?:version|release)\s*[:=]\s*([^\s\r\n]+)/i)?.[1]||null;
 const rescueValue=raw.match(/WLEDTUBES_DIAG\s+rescue=(ACTIVE|INACTIVE)/i)?.[1]||null;
 const button=raw.match(/WLEDTUBES_DIAG\s+button=(STUCK_BUTTON|ACTIVE|INACTIVE|UNAVAILABLE)/i)?.[1]||([...raw.matchAll(/WLED button diagnostics:\s*(STUCK_BUTTON|AVAILABLE\/INACTIVE|AVAILABLE|INACTIVE|healthy)/gi)].at(-1)?.[1]?.toUpperCase()||null);
 const malformed=raw.trim()&&ERROR_PATTERNS.some(p=>p.test(raw))&&(!target||!chip||tubes===null);
 const complete=Boolean(target&&chip&&tubes!==null&&rescueValue&&button);
 const buttonProblem=button==="STUCK_BUTTON";
 return {raw,state:rescue||rescueValue==="ACTIVE"?"rescue":malformed?"malformed":complete?"telemetry":raw.trim()?"partial":"unsupported",rescue:rescue||rescueValue==="ACTIVE",rescueValue,malformed,ledsAbsent:rescue,networkAbsent:rescue,target,observedTarget:target,chip,tubes,version,versionGeneration:versionGeneration(version),button,buttonProblem,buttonDiagnostics:button?.toLowerCase()||null,targetIdentity:target?undefined:"unknown"};
}
export function diagnosePresentation(d={}){
 const identity=Boolean(d.target&&d.chip&&d.tubes!==null&&d.rescue===false&&d.button&&!d.buttonProblem);
 const trustedGeneration=d.versionGeneration||versionGeneration(d.version);
 const supported=Boolean(d.portInfo?.usbVendorId===0x303a&&d.portInfo?.usbProductId===0x1001);
 if(d.rescue||d.buttonProblem||d.state==="malformed")return {tone:"red",label:"Broke",summary:d.rescue?"Rescue mode is active.":d.buttonProblem?"The controller reported a stuck button.":"The controller reported a fault or reset problem.",next:"Review the technical details before using Flash.",action:"Check another controller"};
 if(identity&&trustedGeneration&&trustedGeneration<15)return {tone:"yellow",label:"Old",summary:`This controller reported trusted Tubes v${trustedGeneration} firmware.`,next:"Flash only if you want the current Tubes firmware.",action:"Check another controller"};
 if(identity&&trustedGeneration===15)return {tone:"green",label:"Healthy",summary:"This controller reported current trusted Tubes v15 firmware.",next:"",action:"Check another controller"};
 if(d.portSelected&&d.bytesCaptured>0)return {tone:"yellow",label:"Unknown",summary:"Controller connected",next:"Easy Flash could not identify its Tubes firmware version. If the lights are working, no action is required; use Flash only if behavior is wrong or an update is desired.",action:"Check another controller"};
 return {tone:"yellow",label:"Unknown",summary:"Couldn’t read this controller",next:"Check the USB cable, then choose Diagnose again in Chrome or Edge.",action:"Check another controller"};
}
export function diagnoseSummary(d){return diagnosePresentation(d).summary;}
export function createDiagnoseRuntime({serial=globalThis.navigator?.serial,baudRate=DEFAULT_BAUD_RATE,timeoutMs=READ_WINDOW_MS,maxBytes=MAX_BYTES}={}){async function inspect({onText=()=>{},onStatus=()=>{}}={}){if(!serial?.requestPort)throw new Error("Open Easy Flash in desktop Chrome or Edge over HTTPS to use serial diagnostics.");const port=await serial.requestPort(),info=port.getInfo?.()||{};let opened=false,reader,text="",bytesRead=0;try{if(!port.readable){await port.open({baudRate});opened=true}onStatus("Connected read-only. Waiting for a diagnostic banner…");reader=port.readable?.getReader();if(!reader)return {...parseDiagnosticText(""),portInfo:info,portSelected:true,connected:true,readStatus:"No readable serial stream",bytesCaptured:0};const rawBytes=new Uint8Array(maxBytes),deadline=Date.now()+timeoutMs;while(bytesRead<maxBytes&&Date.now()<deadline){let result;try{result=await Promise.race([reader.read(),new Promise(r=>setTimeout(()=>r({timeout:true}),Math.max(1,deadline-Date.now())))])}catch{break}if(result.timeout){await reader.cancel?.();break}if(result.done)break;if(result.value){const chunk=result.value.subarray(0,maxBytes-bytesRead);rawBytes.set(chunk,bytesRead);bytesRead+=chunk.byteLength}}let decoded=rawBytes.subarray(0,bytesRead);while(decoded.byteLength){try{text=new TextDecoder("utf-8",{fatal:true}).decode(decoded);break}catch{decoded=decoded.subarray(0,-1)}}const parsed=parseDiagnosticText(text),controller=usbController(info);onText(parsed.raw);return {...parsed,portInfo:info,portSelected:true,connected:true,readStatus:bytesRead?"Read-only evidence captured":"No diagnostic bytes captured",usbController:controller,observedTarget:parsed.target||controller,chip:parsed.chip||controller,bytesCaptured:bytesRead}}finally{reader?.releaseLock();if(opened)await port.close()}}return {inspect}};
const runtime=createDiagnoseRuntime();export const inspect=runtime.inspect;
