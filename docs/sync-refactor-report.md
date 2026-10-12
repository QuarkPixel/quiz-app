# 云同步层重构：变更报告

> 设计规矩见 [`sync-redesign.md`](./sync-redesign.md)。这份是"改了什么、为什么、验证到什么程度"。

## 一、起因：一个 bug，一族形状

线上反馈：**始终有一道题目待复习**。复习完出来刷新正常，但同步成功之后再刷新，
那道题又回来了；换个设备（B）复习完同样如此。每同步一次复发一次。

复现之后发现不是孤立的一个错，而是**一族**：

| 形状 | 结果 |
|---|---|
| A 本地复习过、云端档位更高 | 又到期（用户报的） |
| B 云端复习过、本地档位更高 | 又到期（反方向同样丢） |
| C 本地答「模糊」/「忘记」、云端档位更高 | 又到期 |
| D 档位相同 | 恰好对（纯属运气） |

**根因是缺一个原语**：`MemoryProgress = {state, level, streak, nextDue, lapses}`
**没有任何时间戳**，两台设备并发改同一张卡时无法判断谁更晚。代码只好拿 `level`
当替身——可 `level` 既不是时钟（复习不一定让它变大），也不单调（答「忘记」会把它降下来）。
更要命的是 `level` 与 `nextDue` 是**耦合**的，所以"按 level 挑赢家"必然把赢家那条
**过期的 `nextDue`** 一起继承过来。

这就是为什么每次只修一个分支就会冒出下一个形状：**洞不在分支里，在缺原语上。**

## 二、改了什么（五个提交）

### 1. 补上修订戳（`refactor(sync): 阶段 0-1`）

- `src/lib/rev.ts`：`nextRev(now, previous) = max(now, previous + 1)`。
  同一毫秒连写也严格递增；本机钟慢于对端时不会盖出更旧的戳。
- `MemoryProgress.rev`（可选，缺省 0 = 老数据）。
- **唯一盖章收口**在 `MemorySession.writeProgress`；拉取 / 合并出来的那份**绝不重盖**
  ——否则两台设备各盖各的，同样的内容会算出不同状态，永远收敛不了。
- `normalizeMemoryProgress` 原样带过去（净化时丢掉就永远合并不对）。

### 2. 换掉合并本身（`refactor(sync): 阶段 2`）

卡片合并 = 按**全序取整条**：① 已掌握 → ② `rev` → ③ `nextDue` → ④ `level` →
⑤ 档位 → ⑥ 规范化 JSON（确定性兜底）；`lapses` 单独取大。

**取整条**是关键：`level` 与 `nextDue` 永远同源，不会再错配。

`mergeCard` 必须满足**交换律 / 结合律 / 幂等**——违反它就会出现"A 算出 X、B 算出 Y"
的隐形 bug，而这正是"换个设备就不对"的来源。写成性质测试（随机卡片两两组合）之后
**当场抓到一个我自己的错**：排序兜底键（⑥）一开始把 `lapses` 也算进去了，
于是"赢家的 `lapses` 不是最大"时合并结果会改掉 `lapses`、排序键跟着变，
**结合律被破坏**。修法是⑥排除 `lapses`；并且用"把 `lapses` 放回键里"反向验证过
那条用例确实会红。

字段归属变成一份声明表（`model/policy.ts`），替掉散落各处的
`Math.max` / `local ?? remote` / `rank` 启发式。其中
**`activePool` / `filterType` 原来的 `local ?? remote` 违反交换律**（谁在本地谁赢），
所以它们被划成"设备本地、不参与同步"。

### 3. 判定不再被调用方改写（`refactor(sync): 阶段 3`）

以前 `judgeBank` 给一个 `verdict`，`buildSyncPlan` 再用一句
`if (merge.kind === "skip") action.verdict = "skip"` **把它改掉**。那句改写把两个
不同的问题混成了一个字段：

- `merge.kind === "skip"` = 云端有没有本地没见过的卡 → 决定**要不要把合并结果写回本地**
- `push` = 本地改过 → 决定**要不要上传**

于是"这一轮没什么可合并的"被判成"这一轮什么都不用做"：本地改动永远传不上去，
而基准线照常刷新，下一轮判成 pull、云端旧进度反手覆盖回来。

现在 `BankDecision { action, upload, merged?, progressMerged }`：两个问题两个字段，
`decideBank` 一次给全，谁都不用再改它。顺带删掉 `mergedFromProgress`
（定义了但**没有任何地方读**）。

### 4. 设备本地字段不参与同步，也不能被同步擦掉（`阶段 3` + `c634b84`）

`ui` / `filterType` / `activePool` / `roundMastered` / `roundGoal` / `roundPoolIds` /
`learningPool` 从快照里剥掉。两条边界都要顾：

- **收集本地与解云端都要剥**——只剥一边会让进度哈希永远对不上（"永远待同步"），
  而且升级前推上去的老快照会把别的设备的界面状态灌回本地；
- 写回本地统一走 `localwrite.applyRemoteState`（**唯一**落盘入口），
  它用 `attachDeviceLocal` 贴回**本机那份**（漏了就是"同步一次，界面状态和
  当前这一轮的池子凭空消失"）。

第 4 条里"云端也要剥"这一半是**先写迁移护栏时被抓住的**（见下）。

### 5. 拆掉混在一起的职责（`refactor(sync): 阶段 4`）

纯搬迁，不改行为：

- `merge.ts`（1041 行）→ `planner.ts` 537 + `general.ts` 261 + `remote.ts` 148 + 类型进 `types.ts`
- `engine.svelte.ts`（1528）→ 1234，抽出 `localwrite.ts` 359（落到本地 + 记账，全是
  显式传参的纯函数 / 只碰 localStorage 的函数）
- `progressMerge.ts` 442 → 117（规矩搬进 `model/`，只剩门面）

## 三、验证

| 手段 | 结果 |
|---|---|
| 线上复现脚本（改前失败） | **两个都转为通过**（已转成永久护栏） |
| 形状矩阵（A/B/C/D + 掌握终态 + 计数 + 老数据没戳） | 11 条 |
| 代数性质（交换 / 结合 / 幂等 / 顺序无关 / 三一律 / 传递性） | 7 条 |
| 策略与设备本地字段（含迁移边界） | 7 + 2 条 |
| 全套 | **1222 通过**，`svelte-check` 0 错，`vite build` 通过 |
| 每个提交单独 checkout 跑全套 | 全部绿（可 bisect） |

**编译期穷尽护栏**：给状态加字段却忘了登记 → `pnpm check` 直接不过。四项
（卡片 / `StoredState` 顶层 / `MemoryStoredState` / `GeneralSnapshot`）都实测验证过会红。

## 四、顺手挖出来的问题

1. **`tests/` 完全不参与类型检查**：`tsconfig.json` 的 `include` 只有 `src/**`。
   我本来把护栏写在测试里，加了个假字段发现**检查依然 0 错**，才知道等于没写。
   护栏因此搬进 `src/features/sync/model/policy.ts`。
   约 7000 行测试里的写法错误目前**没有任何工具兜住**——这是流水线里的既有缺口。
2. **`pickScalar`（设置类字段）两边都改时"听本地的"违反交换律**：两台设备会永远
   互相覆盖。改成"取规范化 JSON 较大的那份"（确定、两边一致）。代价是"这一轮谁赢"
   没有语义依据（设置没有戳）——**已知取舍**，写在注释里。
3. **`mergedFromProgress` 是死代码**（定义了、没人读），已删。

## 五、没有做的（明确记录）

- **没有改用现成的同步库。** 理由见设计说明附录 A：面向 Gitee Gist 的适配器
  **一个都不存在**；库只覆盖"合并算谁赢"，覆盖不了记账 / 调度 / 基准线 / blob 级竞态；
  而且"已掌握不许回退"与"删除不能压过编辑"这两条领域规矩**没有库会替我们实现**
  （实测 Automerge 3.5.0 与文档化的 Yjs 行为都会丢掉"父键删除 vs 嵌套编辑"里的编辑）。
- **传输 / 调度 / 基准线记账**仍是自己写的（库也管不了）。本轮的改动让它们**更可推理**
  （`localwrite.ts` + 显式 `upload` 字段），但**没有重写**。
- **blob 级的读-改-写竞态不但存在，而且会真的丢数据**（见下面 §六 F1）。
  本报告早先写"基准线能探测并在下一轮重新合并"——**那句话是错的**，
  已由独立审计与一条新写的端到端用例各自复现推翻。
- **`engine.svelte.ts` 仍是 1234 行**（调度 / 状态机 / 错误处理）。进一步拆分
  （`schedule.ts` / `status.ts`）收益递减，本轮没做。
- 两个独立审计（合并模型 / 传输层）在写这份报告时**仍在运行**，结论未纳入。

---

## 六、审计发现的、**尚未修复**的问题（按优先级）

这一轮跑了两份独立审计（合并模型 / 传输层）。合并模型那份在写这份报告时仍未返回；
传输层那份复现了 4 个数据丢失级问题。下面是**已经复现、但这一轮没有动**的，
连同最小修法与判据，供下一轮直接接手。

### F1（高）blob 竞态没被探测到：输家下一轮判成 `pull`，改动**本地与云端一起消失**

**两个独立来源都复现了**：独立审计的 `race.test.ts`，以及我新写的一条端到端用例
（`tests/syncTwoDevice.test.ts` 里的「并发写同一个分片」，未提交，见下）。

序列：

```
A、B 都同步过（v1），X 与 Y 落在同一片
A 改了 X（第 4 轮）→ A 同步 → 云端 = v1+A，A 的基准行 remoteHash = 它自己推的那份
B 的写入（基于它那份陈旧的 v1）落地 → 云端 X 回到第 1 轮
A 再同步（本地没动过）→ 判成 pull → 用云端覆盖本地
⇒ A 的改动本地也没了、云端也没有，永久丢失；A 还显示「已同步」（绿灯）
```

**根因**：`localAt <= syncedAt → pull` 分不出「云端是别人基于旧副本写的」还是
「云端真的更新」。A 自己的上传刷新了 `syncedAt`，于是 `localChanged=false`。

**两个已经存在、却没用上的信号**：`row.remoteHash`（=「我推上去的是什么」）
与当前云端完整哈希；以及 `local.fullHash === row.remoteHash`。

**最小修法**：补一个原语——「**云端已经不是我账本上记的那份了，但我本地就是那份**」
（`local.fullHash === row.remoteHash && remote.fullHash !== row.remoteHash`），
这种情况**绝不能判 pull**，要么按卡合并（以 `row.snapshot` 为三方基准）并把结果推上去，
要么直接报冲突让人看。mtime 只能当次要信号。

### F2（高）云端分片读不出来 ⇒ 本地题库被**静默删除**；general 读不出来 ⇒ 设置本地与云端一起被清空

`decodePayload` 对「版本比我新」「格式不对」是**故意返回 null** 的，
注释写着「调用方应当跳过它而不是当成损坏数据删掉」——但判定层把
`file.json == null` 当成"这个题库云端没有"，于是推出 `deleteLocal`。
`unreadableShards` 收集了却**从来没被消费**；`gitee.ts` 也忽略了 GitHub 那个
`truncated` 标志（Gitee 行为无文档）。

复现（审计）：A 有题库 X（正在看）并答到第 7 轮未同步 → 把云端 `banks-4.json`
改成垃圾 → A 同步 → **`removed=1`、提示「删除 1 · 设置已更新」、整页刷新一次**、
`quiz_app_questions_X` 与 `quiz_app_state_X` 双双删除、账本行清掉、而云端那个坏文件
**原样没动**。把云端文件恢复后再同步，X 回来了但带着**云端的**旧进度——第 7 轮那次
答题永久丢失。

general 那份：云端 `_general.json` 变垃圾 → `remote.general === null` 被当成
「云端没有 general」→ 用 `EMPTY_GENERAL` 合并并 `generalPush` 强制上传 →
`defaultSettings` / `globalSettings` 在**本地和云端都变成 `{}`**。

**最小修法**：`unreadableShards.length > 0`，或
`remote.general === null && remote.generalHash !== ""` 时，**整轮中止并报错**；
**绝不从读不出来的分片推出 `deleteLocal` / `deleteRemote`**。

### F3（中高）`localAt <= syncedAt` 会把真实的本地改动误判成"没动过"

两种触发，都复现了：

- **时钟回拨**：`mtime < syncedAt` ⇒ 判 pull ⇒ B 刚做完的复习被云端旧值盖掉，
  提示「下载 1」，指示点还变绿；
- **同步进行中又答了一题**（`mtime == syncedAt`；生产上是 1ms 窗口，
  但 Firefox 把 `Date.now()` 钳到 2ms、开启 RFP 后 100ms）：账本自己都报
  `pendingChanges=true`（它**知道**这题没传上去），下一轮却把它 pull 掉了。
  这正是线上报过的形状，而且两条记账路径（按哈希的 pending vs 按 mtime 的判定）
  互相矛盾，**破坏性的那条赢了**。

**最小修法**：`computePendingChanges` 说"没传上去"时，下一轮必须 push/merge，
绝不能 pull；基准线的时间戳要记「**实际被上传的那份内容**」的时间，
而不是 `execute` 开始时的 `now`。

### F4（中低）iOS「钩子失灵」那条兜底路径只能变黄，永远排不上上传

`pollLocalChanges → schedulePush` 会被 `hasLocalDirtyKeys()`（`mtime > 0`）挡掉，
而 mtime 正是靠那个**没生效**的 `setItem` 包装写的。复现：探针报 `silent` 之后
本地改一笔，5 秒后 `pendingChanges=true` 且**同步次数 0**；25 秒后仍是 0；
只有 3 分钟那次轮询才上传。而且两个轮询都要求页面可见，后台标签页什么也不做。
文档里写的「脏了就标黄并**排队上传**」——后半句是死的。

### F5（中）账本把每个题库的全文又存了一份，且 `saveSyncMeta` 失败是静默的

`SyncRowMeta.snapshot` 存了整个题目数组 + 进度。实测：200 题的题库
`quiz_app_questions_X` = 37 071 B，而 `quiz_app_sync_meta` = 37 532 B（**1.01 倍**，
本地占用约 2 倍），也是最容易先撞上 localStorage 约 5 MB 配额的那个键。
写失败被 `console.warn` 吞掉 → `computePendingChanges` 永远读到旧行 →
指示灯永远黄、每轮都基于陈旧基准重新规划、而"内容没变就不传"的短路让它变成
**静默空转**。

### F6 / F7（低）

- `settledThisRound`（"冻结分片不给别的题库写新基准"）目前是**死代码**：
  `execute` 只在 `plan.conflicts.length === 0` 时才走到，所以它永远返回 true，
  那条规矩**没有测试覆盖**。等允许"逐题库上传 + 逐分片冻结"之后它会变成承重墙。
- 创建 Gist 的响应丢了 ⇒ 孤儿 Gist；下次同步再建一个，且每个孤儿都能通过
  `looksLikeSyncGist` 出现在选择列表里。

### 审计判为**干净**的部分

部分上传 / `deleteFiles` 中途失败、GET 网络失败、冲突冻结（一条未裁决冲突冻结
**整轮**，而不只是那一片）、顺序（非并发）的同片编辑、双向删除传播、
强制覆盖两条路径、`run()` 串行化、开关清的清理、冲突签名去重、
`pruneConflictSeen` 往返——都没发现问题。
