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

// 读 magpie 保存的登录信息（插件刚登录的）
const p = process.env.HOME || os.homedir();
const authFile = p + "/.config/magpie/plugin-auth.json";
console.log("auth file:", authFile, "exists:", (()=>{try{return readFileSync(authFile,"utf8").length>0}catch{return false}})());

async function main(){
  // 用设备码重新登录一次拿到真凭证（避免手插）
  const pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  const priv=await crypto.subtle.exportKey("jwk",pair.privateKey);
  const pub=await crypto.subtle.exportKey("jwk",pair.publicKey);
  const st=await fetch("https://api.u1s1app.com/auth/device/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({public_jwk:pub,device_name:"probe",client_version:"1.14.5"})});
  const sd=await st.json();
  console.log("start:",st.status,JSON.stringify(sd));
  console.log(">>> 请在浏览器打开上面的 verify_url 并批准，然后等 poll...");
  let got=null;
  for(let i=0;i<90;i++){
    await new Promise(r=>setTimeout(r,2000));
    try{
      const pl=await fetch("https://api.u1s1app.com/auth/device/poll",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({poll_secret:sd.poll_secret})});
      const pd=await pl.json();
      if(pd.status==="ok"){got=pd;break;}
    }catch{}
  }
  if(!got){console.log("未批准");process.exit(1);}
  console.log("poll OK. device_token:",got.device_token.slice(0,8)+"...");
  // DPoP 请求 /v1/models，看返回里有没有 client_attestation
  const proof=await dpop(got.device_token,pub,priv,"GET","https://api.u1s1app.com/v1/models");
  const res=await fetch("https://api.u1s1app.com/v1/models",{headers:{...proof,"x-u1s1-version":"1.14.5","x-u1s1-client":"terminal"}});
  const body=await res.json();
  console.log("models HTTP:",res.status);
  console.log("has client_attestation:", !!body?.client_attestation?.token);
  console.log("data count:", Array.isArray(body?.data)?body.data.length:0);
  if(body?.client_attestation?.token) console.log("att token len:", body.client_attestation.token.length);
}
main().catch(e=>{console.error("ERR",e.message);process.exit(1);});
