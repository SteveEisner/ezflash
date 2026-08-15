import assert from "node:assert/strict";
import test from "node:test";
import { initEasyFlash } from "../app.mjs";

class Element {
	constructor(doc){this.doc=doc;this.hidden=false;this.disabled=false;this.checked=false;this.textContent="";this.className="";this.listeners={};this.dataset={};}
	addEventListener(type,handler){this.listeners[type]=handler;}
	dispatch(type){return this.listeners[type]?.({target:this});}
	focus(){this.doc.activeElement=this;}
	append(){} replaceChildren(){}
}
function fixture({exactBoard=false}={}) {
	const doc={activeElement:null,documentElement:{dataset:{}},nodes:{},querySelector(selector){return this.nodes[selector];},createElement(){return new Element(this);}};
	for(const id of ["connect","install","physicalConfirmation","confirmedDig2Go","controllerState","controllerStatus","installTitle","instruction","actionNote","technicalDetails","resultPanel","resultTitle","resultMessage"]) doc.nodes[`#${id}`]=new Element(doc);
	doc.nodes["#install"].hidden=true;doc.nodes["#physicalConfirmation"].hidden=true;doc.nodes["#actionNote"].hidden=true;doc.nodes["#resultPanel"].hidden=true;
	const variant={id:"previous-stable-control",label:"Dig2Go",target:{board:"QuinLED Dig2Go"},artifacts:[]},artifact={transport:"usb",kind:"complete-merged-image"};variant.artifacts=[artifact];
	let installs=0,invalidator=null,lastArgs=null;
	const flash={setInvalidationHandler(handler){invalidator=handler;},async connectToController(){return {token:Object.freeze({id:"token"}),port:{id:"port"},chipName:"ESP32",portInfo:{usbVendorId:1,usbProductId:2},exactBoard};},async installConnectedController(args){installs++;lastArgs=args;return {chipName:"ESP32",sha256:"a".repeat(64),backup:"unavailable",writeEvidence:"Write call returned; no readback performed",readbackVerified:false,health:"unverified"};}};
	const releaseLoader=async()=>({releaseId:"test",variant,artifact:{...artifact,url:"https://flash.test/releases/test/firmware/merged.bin"}});const app=initEasyFlash({document:doc,releaseLoader,flash,navigator:{serial:{requestPort(){}}},isSecureContext:true});
	return {doc,app,flash,counts:()=>installs,args:()=>lastArgs,disconnect:()=>invalidator?.()};
}

test("UI seam blocks unchecked confirmation and passes exact target-bound assertion when checked",async()=>{
	const f=fixture();await f.app.connect();assert.equal(f.doc.activeElement,f.doc.nodes["#confirmedDig2Go"]);assert.match(f.doc.nodes["#controllerStatus"].textContent,/confirm.*then choose Install/i);
	await f.app.install();assert.equal(f.counts(),0);
	f.doc.nodes["#confirmedDig2Go"].checked=true;f.doc.nodes["#confirmedDig2Go"].dispatch("change");await f.app.install();assert.equal(f.counts(),1);
	assert.deepEqual(f.args().physicalConfirmation,{asserted:true,targetId:"previous-stable-control",printedModel:"QuinLED Dig2Go"});assert.equal(f.args().sessionToken.id,"token");assert.equal(f.args().port.id,"port");
});

test("unsupported Web Serial fails before opening a chooser",async()=>{
	const f=fixture();let chooser=0;f.flash.connectToController=async()=>{chooser++;};
	const doc=f.doc;const app=initEasyFlash({document:doc,navigator:{},isSecureContext:true,releaseLoader:async()=>({variant:{},artifact:{}}),flash:f.flash});
	await app.connect();assert.equal(chooser,0);assert.match(doc.nodes["#controllerStatus"].textContent,/Chrome or Edge.*HTTPS/i);
});

test("insecure context fails before opening a chooser",async()=>{
	const f=fixture();let chooser=0;f.flash.connectToController=async()=>{chooser++;};
	const app=initEasyFlash({document:f.doc,navigator:{serial:{requestPort(){}}},isSecureContext:false,releaseLoader:async()=>({variant:{},artifact:{}}),flash:f.flash});
	await app.connect();assert.equal(chooser,0);assert.match(f.doc.nodes["#controllerStatus"].textContent,/HTTPS/i);
});

test("one chooser cancellation leaves the idle reconnect state without a write",async()=>{
	const f=fixture();let chooser=0;f.flash.connectToController=async()=>{chooser++;const error=new Error("cancelled");error.name="NotFoundError";throw error;};
	await f.app.connect();assert.equal(chooser,1);assert.equal(f.counts(),0);assert.equal(f.app.getSelection(),null);assert.equal(f.doc.nodes["#install"].hidden,true);assert.match(f.doc.nodes["#controllerStatus"].textContent,/No controller was selected/i);
});

test("exact evidence focuses Install; disconnect resets confirmation and prevents stale reuse",async()=>{
	const f=fixture({exactBoard:true});await f.app.connect();assert.equal(f.doc.activeElement,f.doc.nodes["#install"]);assert.match(f.doc.nodes["#controllerStatus"].textContent,/choose Install/i);
	f.doc.nodes["#confirmedDig2Go"].checked=true;f.disconnect();assert.equal(f.doc.nodes["#confirmedDig2Go"].checked,false);assert.equal(f.doc.nodes["#install"].hidden,true);assert.equal(f.doc.nodes["#install"].disabled,true);assert.equal(f.doc.activeElement,f.doc.nodes["#connect"]);assert.match(f.doc.nodes["#controllerStatus"].textContent,/disconnected.*reconnect/i);await f.app.install();assert.equal(f.counts(),0);
});

test("install failure returns to focused reconnect and success states the no-readback health limitation",async()=>{
	const failed=fixture({exactBoard:true});failed.flash.installConnectedController=async()=>{throw new Error("write failed");};await failed.app.connect();await failed.app.install();assert.equal(failed.app.getSelection(),null);assert.equal(failed.doc.activeElement,failed.doc.nodes["#connect"]);assert.match(failed.doc.nodes["#controllerStatus"].textContent,/Install stopped: write failed.*Reconnect/i);
	const ok=fixture({exactBoard:true});await ok.app.connect();await ok.app.install();assert.equal(ok.counts(),1);assert.match(ok.doc.nodes["#controllerStatus"].textContent,/health proof is unavailable/i);assert.match(ok.doc.nodes["#resultMessage"].textContent,/did not read the flash back.*(?:or automatically|and did not).*prove/i);
});
