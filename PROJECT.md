# u1s1 × Magpie 插件 — 项目文档

> 交付基线：2026-11-03 · 对照 u1s1-cli 1.14.5 官方源码 · Magpie 插件协议（OpenCode 1.x / 2.x 双兼容）

## 项目结构

```
E:\WorkSpace\其他\
├─ u1s1-magpie\             # 可发版插件（交付物）
│  ├─ index.mjs             # 插件主体（provider / auth / loader / models）
│  ├─ package.json          # 包元数据 + magpie 配置
│  └─ README.md             # 对外安装/使用文档
├─ u1s1-magpie.zip          # 打包件（magpie plugin add ./u1s1-magpie 用）
├─ PROJECT.md               # 本项目文档（本文件）
├─ docs\
│  └─ diagnostics-2026-11-03.txt  # 诊断基线（发版/回归对照）
├─ _u1s1-src\               # u1s1-cli 官方源码（协议提取来源，勿改）
│  └─ package\dist\         #   api.js / device-auth.js / login.js / site.js / config.*
├─ _probe-u1s1.mjs          # 开发用诊断探针（网关连通/attestation/META 基线）
├─ _probe-chat-variants.mjs # 开发用 chat 变体对照探针（定位 client integrity 判定依据）
├─ _probe.mjs / _probe2.mjs / _probe3.mjs   # 早期临时探针（可清理，不影响交付）
└─ 已安装路径               # C:\Users\ZMY\Downloads\u1s1-magpie\（Magpie 实际加载）
```

## 插件接口说明（index.mjs）

| 导出/钩子 | 说明 |
|---|---|
| `U1S1Plugin`（命名导出） | 插件工厂；返回 `{config, auth, provider}`。另有 `export default` 供 OpenCode 2.x 双兼容 |
| `config(cfg)` | 声明 provider `u1s1`：`npm:@ai-sdk/openai-compatible`、`api:https://api.u1s1app.com/v1`、兜底 `models` |
| `auth.provider` | 固定 `"u1s1"` |
| `auth.methods[0]` | 设备码登录：`authorize()` → 返回 `{url, method:"auto", callback}`；`callback()` 轮询 `poll` 取凭证并 `GET /me` 取 accountId |
| `auth.loader(getAuth)` | 每请求挂载：`baseURL` + 自定义 `fetch`（注入 DPoP/三件套头/attestation；401→加 `X-Magpie-Sign-In: expired`） |
| `provider.models(provider, {auth})` | 登录后 `GET /v1/models` 实时刷新模型列表（含 context/max/price/vision）；401→重登、403→透传原文 |

### 协议对照（对照 `_u1s1-src/package/dist/`）

- 站点：cn `api.u1s1app.com/v1`（默认）/ intl `api.u1s1.dev/v1`（自动切换）→ `site.js`
- 设备码：`POST /auth/device/start`（传 `public_jwk`）→ `POST /auth/device/poll`（回 `u1s1-`/`u1s1d-`）→ `login.js`
- 鉴权：P-256 DPoP（`jti/htm/htu去query/iat/ath`）+ `Authorization: DPoP <token>`；仅 token 退化为 Bearer → `device-auth.js`
- 请求头：`user-agent: u1s1-cli`（**服务端 client integrity 识别依据，必须**）+ `x-u1s1-version` / `x-u1s1-client:terminal` / `x-u1s1-platform` / `x-u1s1-attestation` → `device-auth.js`
- attestation：`GET /v1/models` → `client_attestation.token/expires_in`（7 天、自愈刷新）→ `api.js`
- 聊天：`POST {api}/chat/completions`（OpenAI 兼容，Magpie 网关转 Anthropic）→ `api.js` / `bench.js`
- 模型字段：`context_length` / `max_tokens` / `price{input,output,cache_read}` / `vision` / `reasoning` → `config.d.ts ApiModel`

> **运行关键**：`User-Agent` 必须是 `u1s1-cli`。服务端 client integrity 按它识别官方客户端；缺失即 403（`provider test` 曾实测 403→补 UA 后 200 通过）。

### 错误语义（对照 CLI `AuthError`/`AccessDeniedError`）

- **401** = 凭证失效（设备被移除/换钥）→ 重登，loader 加 `X-Magpie-Sign-In`
- **403** = 登录有效但被服务端拒绝（client integrity / 客户端限制）。本插件场景下，**403 通常是 `User-Agent` 缺失/被覆盖**（服务端按 UA 识别官方客户端）；确认 `user-agent: u1s1-cli` 已带上即消解。真·账号级 403 则透传原文、重登无效

## 命令速查

```sh
# 安装 / 登录 / 状态 / 测试 / 卸载
magpie plugin add ./u1s1-magpie
magpie plugin login u1s1
magpie plugin
magpie provider test u1s1
magpie plugin remove u1s1

# CLI 入口（本机，带参数即 CLI 模式；无 CLI 时 GUI 首页「Provider test」等效）
D:\install_path\magpie\magpie-windows-amd64.exe <子命令>

# 语法校验 / 诊断
node --check u1s1-magpie/index.mjs
node _probe-u1s1.mjs      # 插件同款签名直连网关（dev，不进包）
```

## 操作命令记录（2026-11-03）

1. 定位 u1s1：jiti 缓存 → `_u1s1-src/package/dist/`；Magpie 本体 `D:\install_path\magpie\magpie-windows-amd64.exe`
2. 核对插件两份副本一致；核对 protocol 与 CLI 源码四项（site/login/device-auth/api）
3. 修复 `models()`：字段映射（`context_window`→`context_length` 等）、401/403 语义、真实价格/输出上限/vision
4. loader 补 401 `X-Magpie-Sign-In`；新增 `messageOf()` 透传原文
5. 兜底列表换 `GET /v1/models` 实测值；README/package.json 产品化
6. 同步 `Downloads\u1s1-magpie\`；CLI 实测 `plugin`(on/signed in) 与 `provider test u1s1`
7. **chat 403 定位修复**：抓包逐变量测试 → 缺 `User-Agent: u1s1-cli` 触发 client integrity 403；补 UA 后 `provider test u1s1` chat **200 通过**（2045ms/2916ms 稳定）
8. 打包 `u1s1-magpie.zip`

## 诊断基线（2026-11-03，发版/回归基准）

完整输出见 `docs/diagnostics-2026-11-03.txt`。关键断言：

| 项 | 基线值 |
|---|---|
| `GET /v1/models`（无/有 attestation） | 200；`client_attestation` len=151、expires_in=604800 |
| 模型 | 3 个：deepseek-flash（default）、qwen3.8-flash、glm-5.3-flash |
| deepseek-flash 上下文/输出 | 1048576 / 384000 |
| qwen3.8-flash 上下文/输出 | 1000000 / 131072 |
| glm-5.3-flash 上下文/输出 | 1048576 / 131072 |
| 三模型 | 均 reasoning + vision |
| `POST /chat/completions`（带/不带 attestation） | **403 client integrity** → 2026-11-03 修复：缺 `User-Agent: u1s1-cli`，补上后 **200 通过**（provider test ✓ chat · deepseek-flash） |
| 凭证 | keypair 有、device_token/api_key 形态正确、站点 cn、accountId 517835354@qq.com |

**回归判定**：`provider test u1s1` 的 chat 应显示 `✓`。若 403，先查 `user-agent` 头是否被覆盖。