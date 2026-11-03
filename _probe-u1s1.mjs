// 诊断探针：用插件同款签名直连 u1s1 网关，验证 /models 与 /chat/completions 真实状态
// 用法：node _probe-u1s1.mjs
// 输出对密钥做脱敏；脚本自行读取 plugin-auth.json，不外传凭证。
import { readFileSync } from "node:fs";

const SITES = {
  cn: { api: "https://api.u1s1app.com/v1" },
  intl: { api: "https://api.u1s1.dev/v1" },
};
const VERSION = "1.14.5";

const authFile = "C:/Users/ZMY/.config/magpie/plugin-auth.json";
const all = JSON.parse(readFileSync(authFile, "utf8"));
const auth = all.u1s1;
if (!auth) { console.error("plugin-auth.json 里没有 u1s1 记录"); process.exit(1); }

const deviceToken = auth.device_token ?? auth.access;
const apiKey = auth.api_key ?? auth.refresh;
const privateJwk = auth.private_jwk;
const publicJwk = auth.public_jwk;
const site = SITES[auth.site] ?? SITES.cn;
console.log(`站点: ${auth.site}  api: ${site.api}`);
console.log(`device_token: ${deviceToken ? deviceToken.slice(0, 8) + "..." : "无"}  api_key: ${apiKey ? apiKey.slice(0, 6) + "..." : "无"}  keypair: ${privateJwk && publicJwk ? "有" : "无"}`);

const b64url = (v) => Buffer.from(typeof v === "string" ? new TextEncoder().encode(v) : v).toString("base64url");

async function dpopHeaders(method, rawUrl) {
  const url = new URL(rawUrl); url.search = ""; url.hash = "";
  const header = b64url(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk: publicJwk }));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceToken));
  const payload = b64url(JSON.stringify({
    jti: crypto.randomUUID().replace(/-/g, ""),
    htm: method.toUpperCase(),
    htu: url.toString(),
    iat: Math.floor(Date.now() / 1000),
    ath: b64url(new Uint8Array(digest)),
  }));
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${payload}`)));
  return { authorization: `DPoP ${deviceToken}`, dpop: `${header}.${payload}.${b64url(sig)}` };
}

async function signedHeaders(method, url, attestation) {
  const h = new Headers();
  h.set("content-type", "application/json");
  h.set("x-u1s1-version", VERSION);
  h.set("x-u1s1-client", "terminal");
  h.set("x-u1s1-platform", `${process.platform}-${process.arch}`);
  const proof = await dpopHeaders(method, url);
  h.set("authorization", proof.authorization);
  h.set("dpop", proof.dpop);
  if (attestation) h.set("x-u1s1-attestation", attestation);
  return h;
}

async function peek(label, url, init) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let preview = text.slice(0, 400).replace(/\s+/g, " ");
    console.log(`\n[${label}] ${init?.method ?? "GET"} ${url}`);
    console.log(`  status: ${res.status}`);
    // 脱敏：任何形似凭证的串打码
    preview = preview.replace(/u1s1d?-[A-Za-z0-9_-]{16,}/g, (m) => m.slice(0, 8) + "...");
    console.log(`  body: ${preview}`);
    return { res, text };
  } catch (e) {
    console.log(`\n[${label}] 失败: ${e?.cause?.code ?? ""} ${e?.message}`);
    return { res: null, text: "" };
  }
}

// 1) GET /models（不带 attestation）
const modelsUrl = `${site.api}/models`;
const m1 = await peek("models(无attestation)", modelsUrl, { method: "GET", headers: await signedHeaders("GET", modelsUrl) });

// 提取 attestation + 模型概况
let att = null;
try {
  const j = JSON.parse(m1.text);
  att = j?.client_attestation?.token;
  const ids = Array.isArray(j?.data) ? j.data.map((x) => (typeof x === "string" ? x : x?.id)).filter(Boolean) : [];
  const first = Array.isArray(j?.data) && j.data[0] && typeof j.data[0] === "object" ? j.data[0] : null;
  console.log(`  模型数: ${ids.length}  前3: ${ids.slice(0, 3).join(", ")}`);
  // 全量紧凑元数据（供插件兜底列表对照）
  if (Array.isArray(j?.data)) {
    for (const m of j.data) {
      if (m && typeof m === "object") {
        console.log(`  META ${JSON.stringify({ id: m.id, name: m.name, context_length: m.context_length, max_tokens: m.max_tokens, reasoning: m.reasoning, vision: m.vision, is_default: m.is_default, price: m.price })}`);
      }
    }
  }
  if (first) console.log(`  首模型字段: ${JSON.stringify({ id: first.id, context_length: first.context_length, max_tokens: first.max_tokens, reasoning: first.reasoning, price: first.price }).slice(0, 300)}`);
  console.log(`  client_attestation: ${att ? `有 (len=${att.length}, expires_in=${j?.client_attestation?.expires_in})` : "无"}`);
} catch { /* 非 JSON */ }

// 2) GET /models（带 attestation，若第 1 步拿到）
if (att) {
  await peek("models(带attestation)", modelsUrl, { method: "GET", headers: await signedHeaders("GET", modelsUrl, att) });
}

// 3) POST /chat/completions 最小请求（带 attestation）
const chatUrl = `${site.api}/chat/completions`;
const body = JSON.stringify({
  model: "deepseek-flash",
  messages: [{ role: "user", content: "hi" }],
  max_tokens: 8,
  stream: false,
});
const chat = await peek("chat(带attestation)", chatUrl, {
  method: "POST",
  headers: await signedHeaders("POST", chatUrl, att),
  body,
});

// 4) 对照：chat 不带 attestation
await peek("chat(无attestation)", chatUrl, {
  method: "POST",
  headers: await signedHeaders("POST", chatUrl),
  body,
});

console.log("\n=== 探针结束 ===");
