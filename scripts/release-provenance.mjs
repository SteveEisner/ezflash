import {createHash} from 'node:crypto';
import {readFile, realpath, stat} from 'node:fs/promises';
import {dirname, resolve, sep} from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function fileEvidence(path) { const bytes=await readFile(path); return {path, lengthBytes:bytes.length, sha256:sha256(bytes)}; }
export function requireHash(value,label,kind='sha256') { const re=kind==='commit'?/^[0-9a-f]{40}$/:/^[0-9a-f]{64}$/; if(!re.test(value||'')) throw Error(`${label} must be an immutable full ${kind}`); }
export function safeRelative(value,label) {
  if(typeof value!=='string'||!value||value.includes('\\')||value.startsWith('/')||value.split('/').some(x=>!x||x==='.'||x==='..')||/^[a-z][a-z0-9+.-]*:/i.test(value)) throw Error(`${label} must be a safe immutable relative path`);
  return value;
}
export async function containedFile(base, relative, label) {
  safeRelative(relative,label); const baseReal=await realpath(base), file=await realpath(resolve(base,relative));
  if(!file.startsWith(baseReal+sep)) throw Error(`${label} escapes receipt directory`);
  if(!(await stat(file)).isFile()) throw Error(`${label} is not a file`); return file;
}
export function stable(value) { if(Array.isArray(value)) return value.map(stable); if(value&&typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])); return value; }
export const jsonHash = value => sha256(Buffer.from(JSON.stringify(stable(value))));
export function receiptDir(path) { return dirname(resolve(path)); }
