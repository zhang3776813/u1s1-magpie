// 终极对照：复刻 CLI 签名代理转发的完整请求形态，逐变量测试 chat 403 触发条件
// 用法：node _probe-chat-variants.mjs
// 目标：找出服务端 client integrity 判定依赖的请求头差异
import { readFileSync } from "node:fs";

const SITES = { cn: { api: "https://api.u1s1app.com/v1" }, intl: { api: "https://api.u1s1.dev/v1" } };
const VERSION = "1.14.5";
const auth = JSON.parse(readFileSync("C:/Users/ZMY/.config/magpie/plugin-auth.json", "utf8")).u1s1;
const deviceToken = auth.device_token ?? auth.access;
const privateJwk = auth.private_jwk, publicJwk = auth.public_jwk;
const site = SITES[auth.site] ?? SITES.cn;
const b64url = (v) => Buffer.from(typeof v === "string" ? new TextEncoder().encode(v) : v).toString("base64url");

async function dpopHeaders(method, rawUrl) {
  const url = new URL(rawUrl); url.search = ""; url.hash = "";
  const header = b64url(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk: publicJwk }));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceToken));
  const payload = b64url(JSON.stringify({ jti: crypto.randomUUID().replace(/-/g, ""), htm: method.toUpperCase(), htu: url.toString(), iat: Math.floor(Date.now() / 1000), ath: b64url(new Uint8Array(digest)) }));
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${payload}`)));
  return { authorization: `DPoP ${deviceToken}`, dpop: `${header}.${payload}.${b64url(sig)}` };
}

async function getAttestation() {
  const url = `${site.api}/models`;
  const proof = await dpopHeaders("GET", url);
  const h = new Headers({ "x-u1s1-version": VERSION, "x-u1s1-client": "terminal", "x-u1s1-platform": `${process.platform}-${process.arch}`, "content-type": "application/json", ...proof });
  const res = await fetch(url, { method: "GET", headers: h, signal: AbortSignal.timeout(15000) });
  const j = await res.json();
  return { token: j?.client_attestation?.token, status: res.status };
}

const chatUrl = `${site.api}/chat/completions`;
const chatBody = JSON.stringify({ model: "deepseek-flash", messages: [{ role: "user", content: "hi" }], max_tokens: 8, stream: false });

async function tryVariant(name, extraHeaders, extraBody = null) {
  const proof = await dpopHeaders("POST", chatUrl);
  const headers = new Headers({ "x-u1s1-version": VERSION, "x-u1s1-client": "terminal", "x-u1s1-platform": `${process.platform}-${process.arch}`, ...proof });
  headers.set("content-type", "application/json");
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  const att = await getAttestation();
  if (att.token) headers.set("x-u1s1-attestation", att.token);
  const body = extraBody || chatBody;
  try {
    const res = await fetch(chatUrl, { method: "POST", headers, body, signal: AbortSignal.timeout(20000) });
    const text = (await res.text()).slice(0, 120).replace(/\s+/g, " ");
    const brief = /client integrity/.test(text) ? "client-integrity" : text.slice(0, 60);
    console.log(`  [${name}] -> ${res.status}  ${brief}`);
    return res.status;
  } catch (e) {
    console.log(`  [${name}] -> ERROR ${e?.message}`);
    return null;
  }
}

(async () => {
  console.log(`device=${deviceToken.slice(0,8)}... site=${auth.site}`);
  const att = await getAttestation();
  console.log(`attestation: ${att.token ? "OK len="+att.token.length : "无("+att.status+")"}`);
  console.log("\n== chat 变体（全部带 DPoP + 三件套头 + attestation）==\n");

  await tryVariant("插件当前(仅content-type)", {});
  await tryVariant("+Accept:application/json", { "accept": "application/json" });
  await tryVariant("+Accept:text/event-stream", { "accept": "text/event-stream" });
  await tryVariant("+UA:u1s1-cli", { "user-agent": "u1s1-cli" });
  await tryVariant("+Accept json +UA:u1s1-cli", { "accept": "application/json", "user-agent": "u1s1-cli" });
  await tryVariant("SDK完整(stainless头组)", {
    "accept": "text/event-stream",
    "user-agent": "openai-node/0.0.0",
    "x-stainless-lang": "js",
    "x-stainless-package-version": "0.0.0",
    "x-stainless-runtime": "node",
    "x-stainless-runtime-version": process.version,
    "x-stainless-os": process.platform,
    "x-stainless-arch": process.arch,
    "x-stainless-package-name": "@openai/openai",
  });
  await tryVariant("stream:true + event-stream", { "accept": "text/event-stream" }, JSON.stringify({ model: "deepseek-flash", messages: [{ role: "user", content: "hi" }], max_tokens: 8, stream: true }));

  console.log("\n== 对照组：/models 行为 ==\n");
  const mUrl = `${site.api}/models`;
  const mp = await dpopHeaders("GET", mUrl);
  const mh = new Headers({ "x-u1s1-version": VERSION, "x-u1s1-client": "terminal", "x-u1s1-platform": `${process.platform}-${process.arch}`, "content-type": "application/json", ...mp });
  const mres = await fetch(mUrl, { method: "GET", headers: mh, signal: AbortSignal.timeout(15000) });
  console.log(`  /models -> ${mres.status}`);
})();