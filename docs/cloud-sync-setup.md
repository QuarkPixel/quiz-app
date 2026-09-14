# 云同步（Supabase）配置指南

这套东西的定位：**把 localStorage 当成一个私有 gist** —— 题库和进度同步到你自己的
Supabase 项目，用来换设备时恢复。

## 整体结构

```text
你的浏览器 ──► 你的 Vercel 域名 /api/sync ──► Supabase ──► PostgreSQL
    │                    （哑管道）                  （public.quiz_app_sync）
    │
    └── 持有 Supabase 项目地址 + 密钥，每次请求都带上
```

- **浏览器**持有两样连接信息（存在 `localStorage["quiz_app_sync_config"]` 里），**不上传**。
  地址走 `?url=`，密钥走 `apikey` 头。
- **Vercel 那台函数是哑管道**：**没有任何环境变量、不持有任何密钥、不落盘**。
  它只做三件事：补 CORS、把 `apikey` 注入转发请求、去够 Supabase。
  所以换项目 / 换 key 都不用重新部署，这个部署被别人看到也无所谓（他填他自己的库）。
- **为什么要这一层**：Supabase 的域名在国内直连不稳，而 Vercel 稳定。
  浏览器只访问自己的域名，由这台函数替它去够 Supabase。

## 一、Supabase 侧（一次性）

### 1. 建表

建表 SQL 已经在仓库里：

```
supabase/migrations/20260101000000_quiz_app_sync.sql
```

- **连过 GitHub 集成**（Dashboard → Project Settings → Integrations → GitHub）：
  push 到 `main` 就自动应用，Database → Migrations 里能看到执行记录。
- **没连过**：把文件内容粘到 Dashboard 的 SQL Editor 执行，效果一样。

表结构就三列：

| 列 | 说明 |
|---|---|
| `id` | localStorage 的键名，如 `quiz_app_general` |
| `data` | 原样保存的 JSON |
| `updated_at` | 服务器写入时间，由触发器维护（冲突检测用） |

> 迁移里**刻意没有 RLS 策略**，原因写在文件的注释里：secret key 对应 `service_role`，
> 它带 `BYPASSRLS`，任何策略对它都不生效——写了反而给人「数据被策略保护着」的错觉。

### 2. 拿到地址和密钥

Dashboard → 你的项目 → 左下角 **Project Settings → API Keys**：

| 要的东西 | 长什么样 |
|---|---|
| Project URL | `https://xxxxxxxx.supabase.co` |
| **secret key** | `sb_secret_xxxxxxxx` |

这两样回头分别填进应用设置里的**两个输入框**。

> ⚠️ **用 secret key 的代价**：任何拿到它的人都能**完整读写你的整个 Supabase 项目**，
> 不只是这张表。所以不要提交进仓库、不要贴进公开的地方、不要在截图里露出来。
>
> 想让「密钥可以公开」的话，得改用 publishable key + 一个只有自己知道的 `sync_id` 列
> + RLS 策略（见迁移文件末尾的说明）。那是更安全但更麻烦的路。

## 二、Vercel 侧（一次性）

仓库里已经有 `api/sync/[...path].ts` 和 `vercel.json`，**直接部署即可，不需要配任何环境变量**。

部署完验证一下这台函数活着：

```bash
curl https://<你的域名>/api/sync/_ping
# {"ok":true,"service":"quiz-app-sync-relay"}
```

## 三、应用侧（每台设备一次）

1. 打开应用 → 侧边栏左下角 **全局设置**（滑块图标）→ 底部 **云同步**。
2. 把第 2 步拿到的两样分别填进两个框：
   - **项目地址**：`https://xxxxxxxx.supabase.co`
   - **密钥**：`sb_secret_xxxxxxxx`（默认打码显示，点右侧眼睛图标可临时看清）
3. 点 **保存并测试**。它会分两段告诉你结果：
   - `后端 /api/sync：可达` —— 你的 Vercel 函数在跑
   - `数据表 quiz_app_sync：可读，云端现有 N 项` —— 地址、密钥、表都没问题
4. 点 **立即同步**。第一次会按情况自动决定方向；如果本地和云端**都有数据且内容不同**，
   它不会猜，会列出冲突让你选「保留本地 / 保留云端」。

换设备时重复第 1–3 步，点「立即同步」就会把云端整份拉下来（拉完自动刷新一次页面）。

## 同步的是什么

| 本地存储键 | 内容 |
|---|---|
| `quiz_app_general` | 题库列表与顺序、当前激活题库、全局设置 |
| `quiz_app_questions_<hash>` | 某个题库的题目数组 |
| `quiz_app_state_<hash>` | 某个题库的进度 + 按库设置 + UI 偏好 |

**不上传**的：

| 本地存储键 | 为什么 |
|---|---|
| `quiz_app_sync_config` | 里面是 Supabase 地址和密钥，传上去会出现「拉下来把自己连到错地方」 |
| `quiz_app_sync_meta` | 本地同步元数据（每一行上次同步到哪），传上去没有意义 |
| `quiz_app_sync_mtime:*` | 每一行的本地修改时间，同上 |

## 同步语义

- **本地改动**：2 秒防抖后自动上传（按行比对，只传变的行）。
- **拉取时机**：页面重新可见 / 窗口获得焦点（30 秒节流）/ 每 3 分钟轮询 / 点「立即同步」。
- **冲突**（同一行两边都改过）：**绝不自动选边**。冲突的那一行谁都不动，其余行照常同步，
  由你在设置面板里选「保留本地」或「保留云端」。
- **首次同步**：云端为空 → 上传本地；本地为空 → 下载云端；两边一致 → 只记基准线；
  两边都有且不同 → 列出冲突让你选。
- **删除**：本地删掉一个题库后，云端那一行会在下次同步时回收。判据是「这台设备见过这一行」，
  **别的设备新增的行不会被误删**。
- **拉取后整页刷新**：题目和进度在内存里有好几份缓存，刷新是唯一不会漏掉某一处、
  也不会把「答题到一半」搞成状态撕裂的做法。只有真的写入了不同内容才刷新，
  所以不会出现「刷新 → 同步 → 刷新」的死循环。

## 手动操作（设置面板 →「更多操作」）

- **用本地覆盖云端**（二次确认）：把本地整份推上去，云端多出来的行删掉。慎用。
- **用云端覆盖本地**（二次确认）：把云端整份拉下来覆盖本地。慎用。
- **忘记同步记录**：清掉本地同步元数据（不动云端数据），下次同步按「首次同步」处理。
  **不知道选哪边时的逃生口**。

## 故障排查

| 现象 | 原因 | 怎么办 |
|---|---|---|
| `后端 /api/sync：不可达` | 没部署到 Vercel / 本地开发没起 dev server | 确认是从 Vercel 域名打开的；本地开发见下 |
| `密钥被 Supabase 拒绝了` | 密钥不属于这个项目，或没复制完整 | 回 Settings → API Keys 重新复制整段 |
| `云端没有这张表` | 迁移没部署 | 把 `supabase/migrations` 推到 `main`，或手动执行 SQL |
| `项目地址应该形如 …` | 地址栏里填的不是项目地址 | 应该形如 `https://xxxx.supabase.co`，不要带 `/rest/v1` 之类的路径 |
| 一直在「冲突」 | 两台设备改了同一个题库 | 在设置面板里选一边；实在不确定就先「忘记同步记录」 |
| 换了题库后进度对不上 | 冲突时选了「保留云端」 | 预期行为，云端那份覆盖了本地 |

### 本地开发时怎么用云同步

`vite.config.ts` 里已经把 `/api/sync` 代理到线上部署，所以 `pnpm dev` 下浏览器看到的
仍是同源，前端一行代码都不用改：

```bash
pnpm dev                                            # 代理到仓库里写死的线上地址
SYNC_DEV_ORIGIN=https://别的域名 pnpm dev            # 换一个后端
VITE_SYNC_RELAY=https://别的域名/api/sync pnpm dev   # 直接用某个后端地址（跨域）
```

## 相关代码

```
supabase/migrations/20260101000000_quiz_app_sync.sql   建表 + updated_at 触发器
api/sync/[...path].ts                                  Vercel 哑管道（零环境变量 + /_ping）
src/features/sync/types.ts                             常量与类型
src/features/sync/config.svelte.ts                     地址 / 密钥的净化、校验与掩码展示
src/features/sync/relay.ts                             配置 + 同源路径 → 同步目标（纯本地）
src/features/sync/storage.ts                           收集本地快照、同步元数据、localStorage 钩子
src/features/sync/plan.ts                              逐行三方合并（纯函数，易测）
src/features/sync/remote.ts                            PostgREST 客户端（只抓 fetch，不引 supabase-js）
src/features/sync/engine.svelte.ts                     同步引擎（防抖 / 轮询 / 冲突 / 换设备）
src/components/settings/SyncSettings.svelte            全局设置里的同步区块
tests/sync.test.ts                                     配置校验 / 合并判定 / 孤儿行 / 首次同步取向
```
