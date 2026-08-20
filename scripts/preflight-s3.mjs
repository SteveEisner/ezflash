import {readFile} from 'node:fs/promises'; import {createHash} from 'node:crypto';
const [image,app,receipt]=process.argv.slice(2); if(!image||!app) throw Error('usage: preflight-s3 IMAGE APP [RECEIPT]');
const b=await readFile(image),a=await readFile(app), h=x=>createHash('sha256').update(x).digest('hex');
const parts=[[0,13792],[32768,3072],[57344,8192],[65536,a.length]]; let end=0; for(const [o,n] of parts){if(o<end||o+n>b.length)throw Error('component bounds/overlap');end=o+n;} if(!b.subarray(65536,65536+a.length).equals(a))throw Error('application slice mismatch');
console.log(JSON.stringify({imageBytes:b.length,imageSha256:h(b),applicationBytes:a.length,applicationSha256:h(a),components:parts.map(([offset,lengthBytes])=>({offset,lengthBytes,sha256:h(b.subarray(offset,offset+lengthBytes))}))},null,2));
