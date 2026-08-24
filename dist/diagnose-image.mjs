const MAGIC = 0xe9;
const PARTITION_SIZE = 32;
const MAX_PARTITION_TABLE = 0x1000;
const MAX_FLASH = 0x10000000;
const textDecoder = new TextDecoder();
const u32 = (b, p) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(p, true);
const align4 = n => (n + 3) & ~3;

export function parsePartitionTable(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < PARTITION_SIZE || bytes.byteLength > MAX_PARTITION_TABLE || bytes.byteLength % PARTITION_SIZE) throw new Error("Malformed partition table");
  const out = [];
  for (let p = 0; p < bytes.length; p += PARTITION_SIZE) {
    const magic = bytes[p] | (bytes[p + 1] << 8);
    if (bytes[p] === 0xff || magic === 0xebeb) break;
    if (magic !== 0x50aa) throw new Error("Malformed partition table");
    const type = bytes[p + 2], subtype = bytes[p + 3];
    if (type !== 0 && type !== 1) throw new Error("Malformed partition table");
    const offset = u32(bytes, p + 4), size = u32(bytes, p + 8);
    if (!offset || !size || offset % 0x1000 || offset + size > MAX_FLASH) throw new Error("Malformed partition table");
    const label = textDecoder.decode(bytes.subarray(p + 12, p + 28)).replace(/\0.*$/, "");
    out.push({ type, subtype, offset, size, label });
  }
  if (!out.length) throw new Error("Malformed partition table");
  return out;
}

export function selectApplicationPartition(partitions, otaSelect = null) {
  const apps = partitions.filter(p => p.type === 0 && p.subtype >= 0x10 && p.subtype <= 0x1f);
  if (!apps.length) throw new Error("No application partition");
  if (apps.length === 1) return apps[0];
  if (!otaSelect) throw new Error("Ambiguous OTA selection");
  if (!(otaSelect instanceof Uint8Array) || otaSelect.length < 32) throw new Error("Ambiguous OTA selection");
  const entries = [];
  for (let p = 0; p + 32 <= otaSelect.length; p += 32) {
    const seq = u32(otaSelect, p), state = u32(otaSelect, p + 24), expected = u32(otaSelect, p + 28);
    let crc = 0xffffffff;
    // ESP-IDF's otadata CRC covers ota_seq only, with an all-ones seed.
    for (let i = 0; i < 4; i++) { crc ^= otaSelect[p + i]; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc >>>= 0;
    if (seq !== 0xffffffff && crc === expected && ![3, 4].includes(state)) entries.push({ seq, p });
  }
  if (!entries.length) throw new Error("Malformed OTA selection");
  entries.sort((a, b) => b.seq - a.seq);
  if (entries[1]?.seq === entries[0].seq) throw new Error("Ambiguous OTA selection");
  const index = (entries[0].seq - 1) % apps.length;
  if (index < 0 || index >= apps.length) throw new Error("Malformed OTA selection");
  return apps[index];
}

export function imageLength(bytes, limit = bytes?.byteLength) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24 || bytes[0] !== MAGIC || limit > bytes.length) throw new Error("Malformed application image");
  const count = bytes[1]; if (!count || count > 16) throw new Error("Malformed application image");
  let p = 24;
  for (let i = 0; i < count; i++) { if (p + 8 > limit) throw new Error("Interrupted image read"); const len = u32(bytes, p + 4); p += 8 + len; if (p > limit) throw new Error("Interrupted image read"); }
  const end = align4(p + 1) + ((bytes[23] & 1) ? 32 : 0);
  if (end > limit) throw new Error("Interrupted image read");
  return end;
}

export function sha256Hex(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error("Invalid hash input");
  const K=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];
  const h=[1779033703,-1150833019,1013904242,-1521486534,1359893119,-1694144372,528734635,1541459225]; const n=bytes.length, a=new Uint8Array(((n+9+63)>>6)<<6); a.set(bytes); a[n]=128; new DataView(a.buffer).setUint32(a.length-4,n*8,false);
  for(let o=0;o<a.length;o+=64){const w=new Int32Array(64),v=h.slice();for(let i=0;i<16;i++)w[i]=new DataView(a.buffer,o+i*4,4).getInt32(0,false);for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2],s0=(x>>>7|x<<25)^(x>>>18|x<<14)^(x>>>3),s1=(y>>>17|y<<15)^(y>>>19|y<<13)^(y>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)|0}for(let i=0;i<64;i++){const [A,B,C,D,E,F,G,H]=v,S1=(E>>>6|E<<26)^(E>>>11|E<<21)^(E>>>25|E<<7),ch=(E&F)^(~E&G),t1=(H+S1+ch+(K[i]+w[i]))|0,S0=(A>>>2|A<<30)^(A>>>13|A<<19)^(A>>>22|A<<10),maj=(A&B)^(A&C)^(B&C);v[0]=(t1+S0+maj)|0;v[1]=A;v[2]=B;v[3]=C;v[4]=(D+t1)|0;v[5]=E;v[6]=F;v[7]=G}for(let i=0;i<8;i++)h[i]=(h[i]+v[i])|0}return h.map(x=>(x>>>0).toString(16).padStart(8,"0")).join("");
}

export const KNOWN_LEGACY_APPLICATIONS = Object.freeze([
  { targetId: "quinled-dig2go", generation: "v14", appOffset: 0x10000, appLength: 1260208, sha256: "d6b0168bcecf8f5404653b9bac69ee3d21ddcb1f1514733d3dfe4343a6808d35", provenance: "dist/releases/provisional-pr70-45318507/manifest.json application component" },
  { targetId: "athom-c3-tubes", generation: "v14", appOffset: 0x10000, appLength: 1198432, sha256: "b120770cf7cf6670a89513d550763d740ae867a8aed889ad55637c34833a6f24", provenance: "dist/releases/provisional-pr70-45318507/manifest.json application component" },
  { targetId: "waveshare-s3-tubes-remote", generation: "v14", appOffset: 0x10000, appLength: 1209056, sha256: "3b0fb00eb191e1887bab193c60323e559e7349edae5ab60606414a8910ca443f", provenance: "dist/releases/provisional-pr70-45318507/manifest.json application component" }
]);

export function classifyDiagnose({ normalBoot = false, targetId = null, measuredSha256 = null, currentSha256 = null, measuredLength = null, currentLength = null, broken = false } = {}) {
  if (broken) return { state: "BROKEN", label: "Broke" };
  if (!normalBoot || !targetId || !measuredSha256 || !currentSha256 || measuredLength == null || currentLength == null) return { state: "UNKNOWN", label: "Unknown" };
  const hash = measuredSha256.toLowerCase(), current = currentSha256.toLowerCase();
  if (hash === current && measuredLength === currentLength) return { state: "HEALTHY", label: "Healthy" };
  const legacy = KNOWN_LEGACY_APPLICATIONS.find(e => e.targetId === targetId && e.sha256 === hash && e.appLength === measuredLength);
  return legacy ? { state: "OLD", label: "Old", generation: legacy.generation } : { state: "BROKEN", label: "Broke" };
}

export function inspectImageBytes({ partitionTable, appBytes, otaSelect, targetId, currentSha256, currentLength, normalBoot = true, broken = false }) {
  const partitions = parsePartitionTable(partitionTable);
  const active = selectApplicationPartition(partitions, otaSelect);
  if (!targetId) throw new Error("Unknown target");
  if (appBytes.length > active.size) throw new Error("Application exceeds partition");
  const length = imageLength(appBytes);
  const measured = sha256Hex(appBytes.subarray(0, length));
  return { ...classifyDiagnose({ normalBoot, targetId, measuredSha256: measured, currentSha256, measuredLength: length, currentLength, broken }), targetId, activeImageLength: length, activeImageSha256: measured, activePartition: active };
}
