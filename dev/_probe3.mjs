import { readFileSync } from "node:fs";
import os from "node:os";
function b64url(v){const b=typeof v==="string"?new TextEncoder().encode(v):v;return Buffer.from(b).toString("base64url");}
async function dpop(devTok,pub,priv,method,rawUrl){
  const url=new URL(rawUrl);url.search="";url.hash="";
  const h=b64url(JSON.stringify({typ:"dpop+jwt",alg:"ES256",jwk:pub}));
  const ath=b64url(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(devTok))));
  const p=b64url(JSON.stringify({jti:crypto.randomUUID().replace(/-/g,""),htm:method.toUpperCase(),htu:url.toString(),iat:Math.floor(Date.now()/1000),ath}));
  const k=await crypto.subtle.importKey("jwk",priv,{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const s=b64url(new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},k,new TextEncoder().encode(h+"."+p))));
  return {authorization:`DPoP ${devTok}`,dpop:`${h}.${p}.${s}`};
}
const p=process.env.HOME||os.homedir();
const raw=JSON.parse(readFileSync(p+"/.config/magpie/plugin-auth.json","utf8"));
const a=raw["u1s1"];
const base="https://api.u1s1app.com/v1";

const proofM=await dpop(a.device_token,a.public_jwk,a.private_jwk,"GET",base+"/models");
const modelsRes=await fetch(base+"/models",{headers:{...proofM,"x-u1s1-version":"1.14.5","x-u1s1-client":"terminal"}});
const modelsBody=await modelsRes.json();
const att=modelsBody.client_attestation?.token;
console.log("att:", att?att.slice(0,18)+"...("+att.length+")":"NONE");

const proofC=await dpop(a.device_token,a.public_jwk,a.private_jwk,"POST",base+"/chat/completions");
const headers={...proofC,"content-type":"application/json","x-u1s1-version":"1.14.5","x-u1s1-client":"terminal"};
if(att) headers["x-u1s1-attestation"]=att;
const res=await fetch(base+"/chat/completions",{
  method:"POST",headers,
  body:JSON.stringify({model:"deepseek-flash",messages:[{role:"user",content:"ping"}],max_tokens:16,stream:false}),
  signal:AbortSignal.timeout(60000),
});
const body=await res.text();
console.log("chat HTTP:",res.status);
console.log("body:",body.slice(0,600));
