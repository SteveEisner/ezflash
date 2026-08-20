const root=typeof document==='undefined'?null:document.querySelector('#status');
const inApp=Boolean(root&&document.querySelector('#statusTab'));

export function validateReleaseRelativePath(value,{releaseId,kind='evidence'}={}) {
  if(typeof value!=='string'||!value||/[\\?#]/.test(value)||/%5c|%2f|%2e/i.test(value)) throw new Error(`invalid ${kind} path`);
  if(value.startsWith('/')||/^[a-z][a-z\d+.-]*:/i.test(value)) throw new Error(`invalid ${kind} path`);
  let decoded; try { decoded=decodeURIComponent(value); } catch { throw new Error(`invalid ${kind} path`); }
  if(decoded!==value||decoded.split('/').includes('..')||decoded.split('/').includes('')) throw new Error(`invalid ${kind} path`);
  const prefix=`releases/${releaseId}/`;
  if(!/^[a-z0-9][a-z0-9._-]*$/i.test(releaseId||'')||!value.startsWith(prefix)) throw new Error(`${kind} outside immutable release`);
  if(kind==='manifest'&&!value.endsWith('/manifest.json')) throw new Error('invalid manifest path');
  if(kind==='receipt'&&!value.startsWith(`${prefix}provenance/`)) throw new Error('receipt outside release provenance');
  return value;
}

export function formatOtaSlot(slot) {
  if(!slot||typeof slot!=='object') return slot;
  return [['Partition name',slot.name??slot.partition??'Not provided'],['Partition index',slot.index??'Not provided'],['Offset',slot.offset??'Not provided'],['Size (bytes)',slot.sizeBytes??slot.size??'Not provided']].map(([label,value])=>`${label}: ${text(value)}`).join(' · ');
}

const text=value=>value==null||value===''?'Not provided':String(value);
const row=(label,value)=>{const d=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=text(value);d.append(dt,dd);return d};
const section=(title,rows,className='')=>{const s=document.createElement('section'),h=document.createElement('h2'),dl=document.createElement('dl');if(className)s.className=className;h.textContent=title;rows.forEach(([a,b])=>dl.append(row(a,b)));s.append(h,dl);return s};
const targetLabels={'quinled-dig2go':'QuinLED Dig2Go','athom-c3-tubes':'Athom ESP32-C3 controller','waveshare-s3-tubes-remote':'Waveshare ESP32-S3-Touch-AMOLED-2.16'};
const device=(v)=>{const t=v.target||{},a=v.artifacts?.find(x=>x.kind==='complete-merged-image')||v.artifacts?.[0]||{},d=document.createElement('details');d.className='device-card';const summary=document.createElement('summary');summary.textContent=`${targetLabels[v.id]||v.label||t.board||v.id} · ${t.chip||'Not provided'} · ${v.hardwareTested===true?'Hardware tested':'Not hardware tested'} · ${text(a.sizeBytes)} bytes`;const body=document.createElement('div');body.append(section('Environment',[['PlatformIO environment',t.environment],['Target',`${t.board||'Not provided'} (${t.chip||'Not provided'})`],['Hardware tested',v.hardwareTested===true?'Yes':'No / not recorded'],['Artifact size (bytes)',a.sizeBytes]]),section('Hashes and layout',[['Merged artifact SHA-256',a.sha256],['Partition table',v.partition?.csv],['Partition SHA-256',v.partition?.tableSha256||v.provenance?.partitionSha256],['OTA slot',formatOtaSlot(v.partition?.otaSlot)]]));d.append(summary,body);return d};
const fetchJson=path=>fetch(path,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('evidence unavailable');return r.json()});
export function renderStatus(container,{current,manifest,receipt}){const p=manifest.provenance||{},variants=manifest.variants||[];const shared=section('Release evidence',[['Release',current.releaseId],['Snapshot generated',current.generatedAt],['Evidence mode',p.mode],['Build time',receipt?.timestamps?.builtAt||receipt?.builtAt],['Deployment time',receipt?.timestamps?.deployedAt],['Source repository',variants[0]?.source?.repository],['Full commit',variants[0]?.source?.commit],['GitHub Actions run',receipt?.ci?.runUrl||receipt?.ci?.runId]],'status-card release-card');const firmware=document.createElement('section');firmware.className='status-card firmware-card';const heading=document.createElement('h2');heading.textContent='Supported firmware';const list=document.createElement('div');list.className='device-list';variants.forEach(v=>list.append(device(v)));if(list.addEventListener)list.addEventListener('toggle',event=>{if(!event.target.open)return;list.querySelectorAll('details').forEach(item=>{if(item!==event.target)item.open=false})},true);firmware.append(heading,list);container.replaceChildren(shared,firmware)}
async function load(){if(!root||root.dataset.loaded)return;root.dataset.loaded='true';try {const base=inApp?'':'../',current=await fetchJson(`${base}current.json`),release=current.releaseId,manifestPath=validateReleaseRelativePath(current.manifest,{releaseId:release,kind:'manifest'});const manifest=await fetchJson(`${base}${manifestPath}`);const receiptPath=manifest.provenance?.evidence?.receipt?.path;const receipt=receiptPath?await fetchJson(`${base}${validateReleaseRelativePath(receiptPath,{releaseId:release,kind:'receipt'})}`):null;renderStatus(root,{current,manifest,receipt})}catch(error){const h=document.createElement('p');h.className='error';h.textContent=`Status evidence unavailable: ${error.message}`;root.replaceChildren(h)}}
if(inApp)document.addEventListener('easy-flash:status-selected',load);if(!inApp)load();
