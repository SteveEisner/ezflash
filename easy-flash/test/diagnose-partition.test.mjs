import assert from "node:assert/strict";
import test from "node:test";
import { parseEsp32PartitionTable } from "../diagnose.mjs";

const targets = [
  ["classic-esp32-4mb", 0x400000, [{name:"app0", type:0, subtype:0x10, offset:0x10000, size:0x180000}, {name:"ota_1", type:0, subtype:0x11, offset:0x190000, size:0x180000}]],
  ["c3-4mb", 0x400000, [{name:"app0", type:0, subtype:0x10, offset:0x10000, size:0x180000}, {name:"ota_0", type:0, subtype:0x10, offset:0x190000, size:0x180000}]],
  ["s3-16mb", 0x1000000, [{name:"app0", type:0, subtype:0x10, offset:0x10000, size:0x600000}, {name:"ota_0", type:0, subtype:0x10, offset:0x610000, size:0x600000}]]
];
function fixture(entries, magic=[0xaa,0x50]) { const out=new Uint8Array(0x1000+entries.length*32+32); let p=0x1000; for(const e of entries){out.set(magic,p);out[p+2]=e.type;out[p+3]=e.subtype;new DataView(out.buffer).setUint32(p+4,e.offset,true);new DataView(out.buffer).setUint32(p+8,e.size,true);out.set(new TextEncoder().encode(e.name),p+12);p+=32;} out[p]=0xff;out[p+1]=0xff;return out; }

test("accepts little-endian 0xAA 0x50 entries and terminator for all target geometries",()=>{for(const [id,flash,entries] of targets){const result=parseEsp32PartitionTable(fixture(entries),{flashSizeBytes:flash});assert.equal(result.valid,true,id);assert.deepEqual(result.entries.map(e=>e.name),entries.map(e=>e.name));assert.equal(result.entries[0].magic,0x50aa);}});
test("rejects byte-swapped 0x50 0xAA magic",()=>assert.throws(()=>parseEsp32PartitionTable(fixture(targets[0][2],[0x50,0xaa]),{flashSizeBytes:0x400000}),/magic/i));
test("rejects malformed entry bounds",()=>{const bad=[{name:"app0",type:0,subtype:0x10,offset:0x3f0000,size:0x20000}];assert.throws(()=>parseEsp32PartitionTable(fixture(bad),{flashSizeBytes:0x400000}),/bounds/i);});
test("requires a terminator and rejects truncated records",()=>{const bytes=fixture(targets[0][2]).slice(0,-2);assert.throws(()=>parseEsp32PartitionTable(bytes,{flashSizeBytes:0x400000}),/terminator|truncated/i);});
