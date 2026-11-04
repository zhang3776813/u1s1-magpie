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
console.log("auth: site=",a.site,"device_token len=",a.device_token.length,"has priv=",!!a.private_jwk);
async function main(){
  const proof=await dpop(a.device_token,a.public_jwk,a.private_jwk,"GET","https://api.u1s1app.com/v1/models");
  const res=await fetch("https://api.u1s1app.com/v1/models",{headers:{...proof,"x-u1s1-version":"1.14.5","x-u1s1-client":"terminal","x-u1s1-platform":"win32-x64"}});
  const body=await res.json();
  console.log("models HTTP:",res.status);
  console.log("has client_attestation:", !!body?.client_attestation?.token);
  console.log("data count:", Array.isArray(body?.data)?body.data.length:0);
  if(body?.client_attestation?.token) console.log("att token len:", body.client_attestation.token.length);
  if(body?.data) console.log("model ids:", body.data.map(m=>m.id||m).slice(0,10).join(", "));
}
main().catch(e=>{console.error("ERR",e.message);process.exit(1);});
