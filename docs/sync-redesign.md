# 云同步层重构（设计说明）

> 这份文档是同步层的**规矩唯一真相**。代码要能从这里逐条对上；
> 改动同步语义时先改这里，再改代码，最后加测试。

## 1. 为什么重构

线上连续暴露了三个形状不同、根因相同的 bug：

| # | 形状 | 结果 |
|---|---|---|
| A | 本地复习过（升级 + 推到将来），云端档位更高但**今天到期** | 云端赢，把旧的 `nextDue` 一起带回来 → **又变回待复习** |
| B | 镜像：云端复习过，本地档位更高 | 本地赢 → 同样**又到期**（反方向的复习也被撤销） |
| C | 本地答「模糊」（退一级 + 推到将来），云端档位更高 | 云端赢 → **又到期** |

D（档位相同）恰好对，纯属运气。

**根因**：`mergeProgressMap` 选赢家时用的是单个标量 `rank = 档位 × 1000 + level`，
然后把**整条记录**拿走。两个问题叠在一起：

1. `MemoryProgress` 里**没有任何时间戳**，两台设备并发改了同一张卡时，
   系统没有任何依据判断谁更晚。代码拿 `level` 当"更新"的替身——
   可 `level` 既不是时钟（复习不会必然让它变大），也不单调（「忘记」会把它降下来）。
2. `level` 和 `nextDue` 是**耦合**的（复习同时改这两个），所以"按 level 挑"必然
   把赢家那条的 `nextDue` 一起继承过来——包括它过期的那个。

所以每修一个分支就冒出下一个形状。**这不是 bug，是缺了一个原语。**

## 2. 目标与不变量

重构后这些必须成立，并且**每一条都有测试钉住**：

- **I1 不撤销复习**：某台设备今天复习过的卡，与任何更旧的副本合并后，不得变成"今天到期"。
- **I2 已掌握是终态**：`mastered` 一旦达成，与任何副本合并后都不能退回 `learning` / `reviewing`。
- **I3 计数不倒退**：`lapses` 取两边最大值。
- **I4 合并是格运算**：`merge` 满足**交换律**、**结合律**、**幂等律**。
  这条最要紧——违反它就会出现"A 算出 X、B 算出 Y"的隐形 bug，而这正是"换个设备就不对"的来源。
- **I5 收敛**：任意两台设备在交换完各自掌握的副本后，必须得到**逐字节相同**的结果。
- **I6 不丢改动**：本地相对基准改过的东西，最终一定会上传；不会因为"这一轮没什么可合并的"而被丢掉。
- **I7 删除不压过编辑**：一边删、一边改 → 报冲突让人裁决，不许静默删。
- **I8 设备本地字段不跨设备污染**：UI 状态、会话池子不参与同步。

## 3. 模型

### 3.1 修订戳（补上的那个原语）

`MemoryProgress` 增加一个单调字段：

```ts
/** 这条进度最后一次被改动的时刻（毫秒）。没有 = 0 = 「早于任何带戳的改动」。 */
rev: number;
```

写入规则（只有一个收口，见 `MemorySession.writeProgress`）：

```
rev = max(Date.now(), 本机已见过的同一条卡的最大 rev + 1)
```

第二条是为了让**同一毫秒内的连续写入**也严格递增（同一次答题可能写两次）；
"已见过"包含从云端拉回来的那份，所以本机的戳不会因为设备钟慢而落后于对端。

### 3.2 卡片的合并（唯一的算子）

```
order(a, b) 是一个**全序**，依次比较：
  ① a.state === "mastered"   （true 在前）    ← I2
  ② rev                      （大的在前）    ← 并发更新的裁决依据
  ③ nextDue                  （大的在前）    ← I1：复习过的不许被拽回到期
  ④ level                    （大的在前）
  ⑤ state 档位                （mastered > reviewing > learning）
  ⑥ 规范化 JSON 文本           （纯粹为了确定性，兜底）

merge(a, b) = { ...max_by_order(a, b), lapses: max(a.lapses, b.lapses) }
```

- 取**整条**记录，`level` 与 `nextDue` 永远同源，不会再错配。
- `lapses` 不在 `order` 里参与比较，只是在选完之后取大 → 不影响全序，
  且 `max` 是格运算，所以 I4 仍然成立。
- `order` 是全序 ⇒ `max` 满足交换律/结合律/幂等 ⇒ **I4、I5 成立**。

### 3.3 每个字段的归属（声明表）

`src/features/sync/model/policy.ts` 是唯一写规矩的地方。
**新增可同步字段必须在这里登记**，否则测试会红（有一条覆盖性测试）。

| 归属 | 语义 | 算子 | 现有字段 |
|---|---|---|---|
| `card` | 记忆模式每张卡 | §3.2 的 `merge` | `memory.progress[*]` |
| `highWater` | 只涨不落的集合 | 并集，减去"两边都不再包含"的（墓碑） | `masteredIds` |
| `counter` | 计数 | `max` | `currentRound`、`masteredMistakes[*]` |
| `lww` | 单值，三方比较 | 谁相对基准改了听谁的；都改了听本地的 | `settings`、`memory.settings` |
| `dayScoped` | 带 `day` 的当天状态 | `day` 大的整条赢；同一天按各自的算子 | `memory.retry`、`memory.review` |
| `highWaterNumber` | 只涨不落的数值 | `max` | `memory.learnedDay` |
| `list` | 有序列表 | 三方 + 顺序合并 | `general.library` |
| `deviceLocal` | **不同步**，拉取时保留本机的 | — | `ui`、`filterType`、`activePool`、`roundMastered`、`roundGoal`、`roundPoolIds`、`learningPool` |

`deviceLocal` 那一行是有意的行为变更：`activePool` 之类是**会话状态**，
按 `local ?? remote` 合并不满足交换律（谁在本地谁赢）⇒ 直接违反 I4。
把它们排除在同步之外，比给它们编一条没有语义依据的规矩更诚实。

### 3.4 快照

```
BankSnapshot   = { mode, name, questions, state?: SyncableBankState }
GeneralSnapshot= { library, activeBank, defaultSettings, globalSettings }
```

`SyncableBankState` 只含上面表里登记的字段。收集时把 `deviceLocal` 剥掉，
拉取时把它们**原样保留本机的**（不是删掉）。

## 4. 传输层的现实（不归合并管，但必须认清）

远端是**一个哑 blob 存储**：一条 Gitee Gist，最多 10 个文件
（`_general.json` + `banks-0..8.json`），每个文件是 deflate+base64 的整体负载。

**没有服务端合并，也没有 per-file 版本号。** 于是存在一个**读-改-写竞态**：

```
A 读分片 → B 读分片 → A 写（基准+A 的改动）→ B 写（基准+B 的改动）
→ A 的改动从云端消失（它从来没进过 B 的那份副本）
```

**任何合并算法都救不了这个**——它救的是"两边都读到的编辑"。
Yjs / Automerge / TinyBase 都一样：它们合并的是双方**都见过**的状态。
所以：

- 合并语义（谁赢）→ 可以交给库，也可以自己写（本方案自己写，见 §3）
- 传输 / 调度 / 基准线记账 / 上面这个 blob 竞态 → **库一点都不管，永远得自己写**

现状靠"三方基准 + 内容哈希"来**探测**这个竞态（A 下次同步会发现云端不是它推的那份，
于是重新合并上传）。重构要保住这条探测，并**为它补一条端到端测试**（§6 矩阵里的"并发写同一片"）。

另外两条实测约束（`scripts/gitee-*-probe.mjs` 是唯一的证据来源）：

- 10 个文件的上限**没有任何官方文档**（Gitee OpenAPI spec 与帮助中心全站都查不到），
  是实测结论 ⇒ 想扩容只能把分片写得更大（单个 gist 文件大小上限同样无文档，需要时现场探）。
- Gitee 的 `Access-Control-Expose-Headers` 只有 `Etag, total_count, total_page`，
  **浏览器读不到限流头**，只能从 403/429 反推。

## 5. 模块划分（拆掉 1041 行的 `merge.ts` 和 1528 行的 engine）

```
src/features/sync/
  model/
    clock.ts        修订戳：nextRev / observe
    policy.ts       ★ §3.3 的声明表（唯一写规矩的地方）
    merge.ts        ★ 纯函数：按 policy 做三方合并（替掉 progressMerge + mergeQuizState + mergeMemoryState）
    policy.test.ts  覆盖性测试：可同步字段没登记就红
  codec.ts          快照 ↔ 分片文件的装拆（从 collect/merge 拆出来）
  remote.ts         云端文件 → RemoteState（从旧 merge.ts 拆出 buildRemoteState）
  collect.ts        本地 → 快照（只收登记过的字段）
  plan.ts           ★ 唯一决定 push / pull / merge / delete / conflict / skip
  apply.ts          ★ 唯一把计划落到本地 / 云端的地方
  storage.ts        mtime / 同步元数据 / localStorage 包装（保持）
  engine.svelte.ts  只做编排：调度、状态机、错误处理、刷新让路
  summary.ts        文案（保持）
```

关键结构改动：**判定不再被调用方改写**。
旧代码里 `judgeBank` 给结论、`buildSyncPlan` 又用一句 `action.verdict = "skip"` 覆盖它——
上一个线上 bug（本地改动传不上去）就长在那句改写里。新 `plan.ts` 里
"要不要上传"和"要不要把合并结果写回本地"是**两个独立字段**，各有各的名字：

```ts
interface BankPlan {
  action: "skip" | "upload" | "download" | "merge" | "deleteRemote" | "deleteLocal" | "conflict";
  /** 要写回本地的合并结果（只有 action === "merge" 时有） */
  merged?: BankSnapshot;
  /** 这一轮要上传这个题库吗（与 merged 无关，可以同时为真） */
  upload: boolean;
}
```

## 6. 测试策略

1. **矩阵测试**：把 `(基准, 本地, 云端)` 的形状列全（每张卡的档位高低 × 复习与否 ×
   模糊/忘记 × mastered × 只有一侧存在 × 空进度），逐条断言 §2 的不变量。
   每个已复现的线上形状都变成一条永久用例。
2. **性质测试**：随机生成三份快照，断言交换律 / 结合律 / 幂等（I4）与收敛（I5）。
3. **端到端**：`tests/syncSupport.ts` 的内存 Gitee 上跑双设备来回，
   覆盖"并发写同一片"的竞态（§4）与刷新让路。
4. **覆盖性**：`policy.test.ts` 保证 §3.3 的表与实际快照字段一一对应——
   以后加字段忘了登记，测试会红，而不是等到线上。

## 7. 迁移

- 老数据没有 `rev` ⇒ 视为 `0`。任何带戳的改动都新于它，所以第一次本机写入后自然接管。
- 两边都是 `0` 时靠 §3.2 的 ③④⑤⑥ 裁决，仍然是全序 ⇒ 仍然满足 I4/I5。
- `deviceLocal` 字段从快照里剥掉后，**必须把本机那份保留**，否则拉取会把
  UI 状态和会话池子清空。这是一处容易漏的地方，单独有测试。

## 8. 分阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| 0 | 本文档 | — |
| 1 | `clock.ts` + `rev` 字段 + 写入收口 stamping | 单测：递增、吸收对端更大的戳 |
| 2 | `model/`：policy 表 + 新 `merge.ts`（纯） | 矩阵 + 性质测试全绿；替换 `progressMerge` |
| 3 | `plan.ts` / `apply.ts` / `codec.ts` / `remote.ts` 拆出来 | 旧的 `judgeBank` 与 verdict 改写消失；既有护栏全绿 |
| 4 | `deviceLocal` 剥离 + 拉取保留本机 | 新增迁移测试 |
| 5 | engine 瘦身 + 基准线记账复核 | 全套 + build |
| 6 | 文档汇总 + 变更报告 | — |
