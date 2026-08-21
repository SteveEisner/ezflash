import { chipFamily } from "./safety-contract.mjs";
const RELEASE_ID=/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,63})$/;
const FILE_NAME=/^[A-Za-z0-9][A-Za-z0-9._-]*\.bin$/;
const TARGETS=new Set(["quinled-dig2go","athom-c3-tubes","waveshare-s3-tubes-remote"]);

function safeReleaseId(value) { if(typeof value!=="string"||!RELEASE_ID.test(value)||/^(?:current|latest)$/i.test(value))throw Error("The release pointer is invalid or mutable");return value; }
function exactSameOriginUrl(path,baseUrl,label) { if(typeof path!=="string"||path.includes("\\")||/[?%#]/.test(path))throw Error(`${label} is invalid`);const base=new URL(baseUrl),resolved=new URL(path,base);if(resolved.origin!==base.origin||resolved.username||resolved.password)throw Error(`${label} must be same-origin`);return resolved; }

// Validates the complete immutable catalog before allowing an operator to select one exact target.
export function validateHostedCatalog(manifest,releaseId,baseUrl) {
	if(manifest?.schemaVersion!==2||manifest.provisional!==true||!Array.isArray(manifest.variants)||manifest.variants.length!==3)throw Error("The provisional release must contain exactly three targets");
	const ids=new Set();
	const catalog=manifest.variants.map(variant=>{
		if(!TARGETS.has(variant?.id)||ids.has(variant.id)||variant.hardwareTested!==false)throw Error("The target catalog is invalid");ids.add(variant.id);
		// Mirrors the write-time refusal in local-flash.mjs: quad flash modes (qio/qout) rewrite the
		// bootloader header and can watchdog-loop boards whose flash wiring cannot fast-boot quad mode.
		const flashMode=variant.target?.flashMode??"keep";
		if(!["keep","dio","dout"].includes(flashMode))throw Error(`Refusing to patch the bootloader flash mode to ${flashMode}; use "keep" unless the override is hardware-proven`);
		const identity=variant.bootIdentity;if(identity?.version!==1||identity.target!==variant.id||identity.source!==variant.source?.commit||!/^[0-9a-f]{40}$/.test(identity.source)||!/^[A-Za-z0-9._-]+$/.test(identity.release)||!Number.isSafeInteger(identity.tubes)||identity.tubes<1)throw Error("The boot identity contract is invalid");
		const candidates=variant.artifacts?.filter(a=>a.transport==="usb"&&a.kind==="complete-merged-image")||[];if(candidates.length!==1)throw Error("Each target must select exactly one merged USB image");
		const artifact={...candidates[0]},prefix=`releases/${releaseId}/firmware/`,file=artifact.path?.slice(prefix.length);
		if(!artifact.path?.startsWith(prefix)||!FILE_NAME.test(file||"")||artifact.path!==`${prefix}${file}`)throw Error("The artifact path is invalid, mutable, or outside this release");
		if(!Number.isSafeInteger(artifact.sizeBytes)||artifact.sizeBytes<=0||!/^[a-f0-9]{64}$/.test(artifact.sha256)||artifact.offset!==0||!Array.isArray(artifact.components))throw Error("The merged USB artifact contract is invalid");
		return {variant,artifact:{...artifact,url:exactSameOriginUrl(artifact.path,baseUrl,"The artifact path").href}};
	});
	if(ids.size!==TARGETS.size)throw Error("The catalog does not contain the exact approved target set");return catalog;
}
export function selectHostedTarget(catalog,targetId) { const selected=catalog.find(({variant})=>variant.id===targetId);if(!selected)throw Error("Unknown target; no firmware was selected");return selected; }
export function resolveDetectedTarget(catalog,observedChip) {
	// Reuse the runtime's family gate: a classic ESP32 die (ESP32-D0WD-V3, PICO...)
	// must resolve to the plain-ESP32 target; an ad-hoc regex here rebirths the
	// original "Unsupported controller chip" defect.
	const family=chipFamily(observedChip);
	const matches=catalog.filter(({variant})=>chipFamily(variant.target.chip)===family);
	if(matches.length===0)throw Error(`Unsupported controller chip ${observedChip}; no firmware was selected`);
	if(matches.length!==1)throw Error(`Ambiguous controller chip ${observedChip}; no firmware was selected`);
	return matches[0];
}
export async function loadHostedRelease({fetchImpl=globalThis.fetch,baseUrl=globalThis.document?.baseURI||import.meta.url,targetId}={}) {
	const pointerResponse=await fetchImpl(new URL("./current.json",baseUrl).href,{cache:"no-store",credentials:"same-origin"});if(!pointerResponse.ok)throw Error("The hosted release pointer is unavailable");const releaseId=safeReleaseId((await pointerResponse.json())?.releaseId);
	const response=await fetchImpl(new URL(`./releases/${releaseId}/manifest.json`,baseUrl).href,{cache:"no-store",credentials:"same-origin"});if(!response.ok)throw Error("The hosted release manifest is unavailable");const manifest=await response.json();const catalog=validateHostedCatalog(manifest,releaseId,baseUrl);
	return targetId?{releaseId,manifest,catalog,...selectHostedTarget(catalog,targetId)}:{releaseId,manifest,catalog};
}
