const RELEASE_ID=/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,63})$/;
const FILE_NAME=/^[A-Za-z0-9][A-Za-z0-9._-]*\.bin$/;

function responseError(label) { return new Error(`The hosted ${label} is unavailable`); }
function safeReleaseId(value) {
	if (typeof value!=="string" || !RELEASE_ID.test(value) || /^(?:current|latest)$/i.test(value)) throw new Error("The release pointer is invalid or mutable");
	return value;
}
function exactSameOriginUrl(path,baseUrl,label) {
	if (typeof path!=="string" || path.includes("\\") || path.includes("%") || path.includes("?") || path.includes("#")) throw new Error(`${label} is invalid`);
	const base=new URL(baseUrl),resolved=new URL(path,base);
	if (resolved.origin!==base.origin || resolved.username || resolved.password) throw new Error(`${label} must be same-origin`);
	return resolved;
}

export async function loadHostedRelease({fetchImpl=globalThis.fetch,baseUrl=globalThis.document?.baseURI || import.meta.url}={}) {
	const pointerUrl=new URL("./current.json",baseUrl);
	const pointerResponse=await fetchImpl(pointerUrl.href,{cache:"no-store",credentials:"same-origin"});
	if (!pointerResponse.ok) throw responseError("release pointer");
	const releaseId=safeReleaseId((await pointerResponse.json())?.releaseId);
	const manifestUrl=new URL(`./releases/${releaseId}/manifest.json`,baseUrl);
	const manifestResponse=await fetchImpl(manifestUrl.href,{cache:"no-store",credentials:"same-origin"});
	if (!manifestResponse.ok) throw responseError("release manifest");
	const manifest=await manifestResponse.json();
	if (manifest?.schemaVersion!==2 || !Array.isArray(manifest.variants) || manifest.variants.length!==1) throw new Error("The Dig2Go release manifest is invalid");
	const variant=manifest.variants[0];
	if (variant?.target?.board!=="QuinLED Dig2Go" || variant?.target?.hardwareFamily!=="quinled-dig2go") throw new Error("The release is not for a QuinLED Dig2Go");
	const candidates=variant.artifacts?.filter(({transport,kind})=>transport==="usb" && kind==="complete-merged-image") || [];
	if (candidates.length!==1) throw new Error("The Dig2Go manifest must select exactly one merged USB image");
	const artifact={...candidates[0]};
	const prefix=`releases/${releaseId}/firmware/`,fileName=artifact.path?.slice(prefix.length);
	if (!artifact.path?.startsWith(prefix) || !FILE_NAME.test(fileName || "") || artifact.path!==`${prefix}${fileName}`) throw new Error("The artifact path is invalid, mutable, or outside this release");
	const artifactUrl=exactSameOriginUrl(artifact.path,baseUrl,"The artifact path");
	if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes<=0 || !/^[a-f0-9]{64}$/.test(artifact.sha256) || artifact.offset!==0 || !Array.isArray(artifact.components)) throw new Error("The merged USB artifact contract is invalid");
	return {releaseId,manifest,variant,artifact:{...artifact,url:artifactUrl.href}};
}
