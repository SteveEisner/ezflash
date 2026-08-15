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

if(inApp){const flash=document.querySelector('#flashTab'),status=document.querySelector('#statusTab'),flashView=document.querySelector('#flashView'),statusView=document.querySelector('#statusView');const select=showStatus=>{flash.setAttribute('aria-selected',String(!showStatus));status.setAttribute('aria-selected',String(showStatus));flashView.hidden=showStatus;statusView.hidden=!showStatus;if(showStatus&&!status.dataset.loaded)load()};flash.addEventListener('click',()=>select(false));status.addEventListener('click',()=>select(true));[flash,status].forEach((b,i)=>b.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();(i?flash:status).focus();select(!i)}}));}
const text=value=>value==null||value===''?'Not provided':String(value);
const row=(label,value)=>{const d=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=text(value);d.append(dt,dd);return d};
const section=(title,rows)=>{const s=document.createElement('section'),h=document.createElement('h2'),dl=document.createElement('dl');h.textContent=title;rows.forEach(([a,b])=>dl.append(row(a,b)));s.append(h,dl);return s};
const fetchJson=path=>fetch(path,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('evidence unavailable');return r.json()});
async function load(){if(!root||root.dataset.loaded)return;root.dataset.loaded='true';try {const base=inApp?'':'../',current=await fetchJson(`${base}current.json`),release=current.releaseId,manifestPath=validateReleaseRelativePath(current.manifest,{releaseId:release,kind:'manifest'});const manifest=await fetchJson(`${base}${manifestPath}`);const receiptPath=manifest.provenance?.evidence?.receipt?.path;const receipt=receiptPath?await fetchJson(`${base}${validateReleaseRelativePath(receiptPath,{releaseId:release,kind:'receipt'})}`):null;const v=manifest.variants?.[0]||{},a=v.artifacts?.[0]||{},p=manifest.provenance||{};root.replaceChildren(section('Snapshot',[['Release',current.releaseId],['Snapshot generated',current.generatedAt],['Evidence mode',p.mode],['Build time',receipt?.timestamps?.builtAt||receipt?.builtAt],['Deployment time',receipt?.timestamps?.deployedAt]]),section('Source and target',[['Source repository',v.source?.repository],['Full commit',v.source?.commit],['GitHub Actions run',receipt?.ci?.runUrl||receipt?.ci?.runId],['PlatformIO environment',v.target?.environment],['Hardware tested',v.hardwareTested===true?'Yes':'No / not recorded'],['Target',`${v.target?.board||'Not provided'} (${v.target?.chip||'Not provided'})`]]),section('Artifact and contract',[['Artifact length (bytes)',a.sizeBytes],['Artifact SHA-256',a.sha256],['Contract SHA-256',p.contractSha256],['Partition SHA-256',p.partitionSha256],['Tool/build versions',receipt?.tools||receipt?.build?.tools]]));}catch(error){const h=document.createElement('p');h.className='error';h.textContent=`Status evidence unavailable: ${error.message}`;root.replaceChildren(h)}}
if(!inApp)load();
