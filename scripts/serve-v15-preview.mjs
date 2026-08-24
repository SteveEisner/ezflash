#!/usr/bin/env node
import {createReadStream} from "node:fs";
import {stat} from "node:fs/promises";
import {createServer} from "node:http";
import {extname,relative,resolve} from "node:path";
const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]},root=resolve(value("--root")||"build/v15-preview-site"),port=Number(value("--port")||8843);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error("preview port must be an unprivileged TCP port");
const types={".html":"text/html; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".bin":"application/octet-stream"};
const headers={"Cache-Control":"no-store","Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'","Permissions-Policy":"serial=(self)","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
createServer(async(request,response)=>{const pathname=new URL(request.url,"http://localhost").pathname,path=resolve(root,pathname==="/"?"index.html":`.${pathname}`),rel=relative(root,path);if(rel.startsWith("..")||rel.startsWith("/")){response.writeHead(403,headers).end("Forbidden");return;}try{if(!(await stat(path)).isFile())throw Error();response.writeHead(200,{...headers,"Content-Type":types[extname(path)]||"application/octet-stream"});createReadStream(path).pipe(response);}catch{response.writeHead(404,{...headers,"Content-Type":"text/plain; charset=utf-8"}).end("Not found");}}).listen(port,"127.0.0.1",()=>console.log(`v15 preview: http://127.0.0.1:${port}`));
