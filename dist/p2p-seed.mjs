const OPEN_LINE=/TUBE_PROPAGATE_SELECT open=20000/;

export function createP2PSeedRuntime({delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=2500}={}) {
  let binding=null;
  function bind({port,token,targetId,verified}) {
    if(!verified||targetId!=="quinled-dig2go"||!port?.getInfo||!token) return null;
    binding=Object.freeze({port,token,targetId,portInfo:Object.freeze({...port.getInfo()})});
    return binding;
  }
  async function seed(candidate,{onStatus=()=>{}}={}) {
    if(!binding||candidate!==binding)throw Error("The verified Dig2Go session is stale; install or verify it again");
    const info=binding.port.getInfo();if(info.usbVendorId!==binding.portInfo.usbVendorId||info.usbProductId!==binding.portInfo.usbProductId)throw Error("The connected USB device changed; seed was not started");
    const port=binding.port;onStatus("Opening the verified Dig2Go serial session…");await port.open({baudRate:115200});let reader;
    try {const writer=port.writable.getWriter();await writer.write(new TextEncoder().encode("Q\n"));writer.releaseLock();onStatus("Seed command sent. Double-click exactly one Dig2Go within 20 seconds.");reader=port.readable.getReader();const timeout=delay(timeoutMs).then(()=>({timeout:true})),read=reader.read();const result=await Promise.race([read,timeout]);if(result.timeout)return {status:"sent",acknowledged:false,retryable:true};const text=new TextDecoder().decode(result.value||new Uint8Array());return {status:"sent",acknowledged:OPEN_LINE.test(text),retryable:!OPEN_LINE.test(text)};} finally {try{await reader?.cancel();}catch{}try{reader?.releaseLock();}catch{}try{await port.close();}catch{}binding=null;}
  }
  return {bind,seed};
}
