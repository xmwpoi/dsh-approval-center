# R2 独立包审与可复现性报告（Agent D）

日期：2026-09-30（R2）。复核人：Agent D。工作树 `D:\codex\dsh-notify-D`。
被审对象：A 的候选包 `D:\codex\dsh-notify-A-pack\dsh-approval-center-0.4.0-rc.1.tgz`
（R2 派发书 §当前裁决 3 明确它是**待修订候选，不得作为最终实机签收包**）。

**独立性声明**：下列每个数字都来自 D 自己执行的命令。D 另建了**独立基线 worktree**
`D:\codex\dsh-r2-base`（detached at `222e38afaff6eb10245598776f4c34726a65700f`，`git status` 干净），
以避免 A 工作树的未提交改动污染结论——A 工作树在复核时已有 7 项未提交改动（正在吸收 D 的 R1 交付）。

---

## 0. 结论摘要

| 检查项 | 结论 |
|---|---|
| 候选包 SHA256 与协调者记录一致 | **PASS** |
| 包内 `lib/**` 与干净构建 `222e38a` 逐字节一致 | **PASS（6/6）** |
| 版本 / peer 精确声明 | **PASS**（`0.4.0-rc.1` / `@deepseek-ai/dsh: 0.1.7-rc.2`） |
| 脚本 BOM / ASCII / 语法门 | **PASS**（4 个脚本 BOM 与非 ASCII 要求均满足） |
| **换行门（CRLF）** | **FAIL — 无任何门**，且同包混用 CRLF 与 LF |
| **候选包可从 commit 复现** | **FAIL** — 从 `222e38a` 正常 checkout + `npm pack` 得到**不同 hash** |
| 同工作树两次打包确定性 | **PASS**（两次 hash 完全相同） |
| **审批卡片独立 text 布局** | **FAIL（发布阻断）** — 仍是标题 + 单个 `<text>$Message</text>` |
| **`package.json` description** | **FAIL** — 仍声称 "parallel subagents" |
| `toast.ps1` 任务通知面（Tag/Group/Sound/Show） | **PASS** |
| BOM 退化红例存在 | **PASS**（见 §5） |

---

## 1. 候选包身份

```
路径   : D:\codex\dsh-notify-A-pack\dsh-approval-center-0.4.0-rc.1.tgz
实测SHA: F7C6E74E887A32D6C16B2668466E2E24C3255DC3E684EFAA0743CDA173A2F113
字节数 : 77254
```

与 R2 派发书 §当前裁决 3 记录**完全一致**（SHA 与 77254 bytes 均吻合）。
包内 21 个条目（19 运行文件 + 2 文档），清单见 §3。

## 2. lib 与源码关系（PASS）

把候选包解包后，与**独立基线 worktree** 中 `npm run build`（commit `222e38a`，工作树干净）产物逐文件比对：

| 文件 | 结果 |
|---|---|
| `lib/index.js` | SAME |
| `lib/notifications.js` | SAME |
| `lib/dialog.js` | SAME |
| `lib/host-contract.js` | SAME |
| `lib/queue.js` | SAME |
| `lib/store.js` | SAME |

⇒ 候选包的运行代码**精确对应 commit `222e38a`**，无"包里的 lib 与源码不一致"问题。
`CHANGELOG.md`、`cordis.patch.yml`、`README.md`、`LICENSE`、`package.json`、
其余 `lib/*.d.ts`、`scripts/approval-toast.ps1`、`scripts/approval-uri-handler.ps1`、
`scripts/approval-uri-handler.vbs` 亦与我的重打包**逐字节一致**。

## 3. 脚本编码与换行（部分 FAIL）

### 3.1 BOM / ASCII（PASS）

| 脚本 | 大小 | UTF-8 BOM | 非 ASCII 字节 | 要求 | 结论 |
|---|---|---|---|---|---|
| `approval-toast.ps1` | 25634 | **True** | 9108 | .ps1 含非 ASCII 必须有 BOM | PASS |
| `approval-uri-handler.ps1` | 2329 | False | 0 | 无 BOM 时不得有非 ASCII | PASS |
| `approval-uri-handler.vbs` | 5618 | False | 0 | .vbs 必须纯 ASCII | PASS |
| `toast.ps1` | 5775 | **True** | 1921 | .ps1 含非 ASCII 必须有 BOM | PASS |

### 3.2 换行（FAIL）

| 脚本 | CR | LF | 形态 |
|---|---|---|---|
| `approval-toast.ps1` | 117 | 117 | pure-CRLF |
| `approval-uri-handler.ps1` | 40 | 40 | pure-CRLF |
| `approval-uri-handler.vbs` | 138 | 138 | pure-CRLF |
| **`toast.ps1`** | **0** | **117** | **pure-LF** |

- **同一个包内混用两种换行**，而仓库 `.gitattributes` 声明 `*.ps1 text eol=crlf`。
- 换行不影响 PowerShell 5.1 解析（BOM 已在位），**不是功能缺陷**；
  但它使候选包**不可由 commit 复现**（见 §4），并让"脚本字节级"证据失去唯一性。
- **`test/` 与 `.github/` 下没有任何换行门**（D 实测 `git grep` 无命中）。
  ⇒ 这个状态可以再次静默进入发布产物，与 `v0.3.1-rc.1` 那次是同一类问题
  （见 `package-repro-review.md`）。

## 4. 打包可复现性（FAIL：不可由 commit 复现）

方法：在**独立基线 worktree**（`222e38a`，干净）连续执行两次
`npm pack --pack-destination <worktree>`，再与候选包比对。

```
pack1 : 433AA74FDD577A976C595ECB24EC5999D87E8FAE2D828FBEC79D4E41F14DEFA6
pack2 : 433AA74FDD577A976C595ECB24EC5999D87E8FAE2D828FBEC79D4E41F14DEFA6
两次相同        : True
与候选包相同    : False（候选 F7C6E74E…）
```

**同一工作树内打包是确定性的（两次 hash 相同）**，所以差异不是"打包随机性"。
逐条目比对后，21 个条目中**只有 1 个不同：`scripts/toast.ps1`**。其根因已定位到**归一化**：

```
commit 222e38a 的 toast.ps1 git blob (原始字节) : size=5775  CR=0    LF=117  sha=B652BCD7…
候选包内      scripts/toast.ps1                : size=5775  CR=0    LF=117  sha=B652BCD7…  ← 与 blob 完全一致
正常 checkout 的工作树 scripts/toast.ps1        : size=5892  CR=117  LF=117  sha=E245EAD6…  ← git 按 eol=crlf 转换
我的重打包    scripts/toast.ps1                : size=5892  CR=117  LF=117  sha=E245EAD6…
```

**判定**：候选包内的 `toast.ps1` 是该文件的 **git blob 原样**（LF），
而 `npm pack` 在正常 checkout 上会因 `.gitattributes` 的 `eol=crlf` 得到 CRLF 版本。
⇒ **候选包不是从 commit 的正常 checkout 打包出来的**，`F7C6E74E…` 无法由
"`git checkout 222e38a` + `npm pack`"复现（只能由 blob 原样装配的树复现）。

按 R2 派发书第 5 条要求：这里**明确给出元数据/归一化原因，并且不擅自声称该包可复现**。
我**不**主张候选包功能有误——其 lib 与所有其他运行文件都与干净构建一致；
但"固定 SHA 全員引用一致"这一 R4 要求目前建立在**一个无法由源码复算的 hash** 上。

**建议（交 A 决策，D 不代改）**：
1. 在 `npm pack` 前把 `scripts/*.ps1`、`scripts/*.vbs` 统一规范为纯 CRLF（与 `.gitattributes` 一致），
   使候选包字节 = 干净 checkout 字节，SHA 可由第三方复算；
2. 给 CI 增加"无孤立 LF"断言（`CR 数 == LF 数`），与既有 BOM/ASCII 门并列；
3. 在最终签收记录里写明该包的换行归一状态，不要把它描述为"与源码逐字节相同"。

## 5. BOM 退化的红例（PASS）

R2 派发书要求"BOM-only 退化必须有红例"。核实 A 已提交的
`test/task-toast-script.test.js`（`222e38a`）确实包含会**变红**的断言：

```js
test('文件非空且带 UTF-8 BOM（PS5.1 无 BOM 按 ANSI 解码 → 中文源码直接语法错误）', () => {
  assert.ok(b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf, '必须带 UTF-8 BOM')
  // 并跑真实 Parser::ParseFile（宿主同款门禁，不在 CI 里弹任何 Toast）
```

⇒ 去掉 BOM 或把文件退化成纯 BOM，该用例都会失败。**BOM 方向的红例存在。**
**但换行方向没有任何红例**（§3.2），这是需要补的对应门。

## 6. 脚本行为面复核（PASS）

### 6.1 任务通知 `scripts/toast.ps1`

| 项 | 实测 |
|---|---|
| 参数面 | `param(` 含 `-Tag`（`^[0-9a-f]{16}$`＋`[ValidateSet]`）、`-Group`、`-Sound`（`[ValidateSet('', 'silent', 'default')]`） |
| 参数校验 | `-Tag` 非法 → `TOAST FAILED: -Tag must match ^[0-9a-f]{16}$`；`-Group` 非法 → 只接受 `dsh-task`（双端校验的脚本侧） |
| 兼容旧路径 | `-Tag/-Group/-Sound` 缺省时完全复刻旧行为（随机 Tag + `dsh-result` + 不写 `<audio>`） |
| 静音 | `silent` → `<audio silent="true"/>` ✅ |
| 系统默认音 | `default` → `<audio src="ms-winsoundevent:Notification.Default"/>` ✅（**这回答了用户指南 PENDING-6**） |
| `<audio>` 位置 | `<toast>` 直接子元素、位于 `<visual>` 之后，符合 toastschema/element-audio |
| XML 转义 | `Escape-Xml` 存在，`<text>` 包的是转义后内容 |
| 真实 Show | `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)` |
| 退出码语义 | 注释明确 `0 = Show() 未抛异常`，并强调"**绝不代表用户已看到/听到**"——符合验收铁律 |

### 6.2 **审批布局未同步（发布阻断，FAIL）**

候选包 `scripts/approval-toast.ps1` 的卡片结构实测：

```
<text> 元素数: 2
  <text>$(Escape-Xml $Title)</text>
  <text>$(Escape-Xml $Message)</text>
```

- 结构化卡片（任务 / 操作 / 原因 / 选择 / 等待）被压进**单个 `<text>$Message</text>`**，
  而**两个脚本里都没有任何** `任务：`/`操作：`/`原因：`/`选择：`/`等待：` 的行级标记（实测 0 处）。
- 与 C 所述"独立 text 布局"**尚未同步**，与 R2 派发书 §当前裁决 6 的第一条一致。
- **诚实边界**：D **没有**在 Windows 上实机观察渲染结果，因此**不主张**"通知一定显示成一行"。
  D 主张的是**结构事实**：布局没有同步为独立 text 元素。
  ToastGeneric 对单个 `<text>` 内 `\n` 是否折行需 **C 的实机确认**；
  若折叠，则用户会看到一整行连排的审批信息，"选择/等待"的可读性受损。
- 这条是**发布阻断**：R2 门禁 R2 要求"审批布局最终包可读并正确回传"。

## 7. `package.json` description（FAIL，A 修）

`package.json` 的 `description` 经 **UTF-8 字节解码**（排除 Windows 控制台把 UTF-8 当 CP936 的乱码干扰）实测为：

```
DSH (DeepSeek Harness) plugin: Windows notification-center approvals (approve/reject buttons)
and completion notifications for parallel subagents — a task control center for human-in-the-loop approvals.
```

⇒ 仍声称 `completion notifications for parallel subagents`，与本轮"**全部子代理通知关闭**"
的修订需求直接矛盾（R2 派发书 §当前裁决 6 第二条）。`package.json` 属 A 所有权，D 不代改。
运行代码与测试均不受影响，但 R4 要求"README 描述不夸大"，description 属同一叙述面。

## 8. 未做与边界

- **未在 Windows 上运行任何真实 Toast / wscript / 未改 HKCU**。本报告全部为静态 + 打包层复核。
- **未验证候选包在真实 0.1.7-rc.2 宿主上的运行**（那属 C 的 R2 独占实机，见 R2 派发书第三批）。
- **未修改候选包、未重打包进 `dsh-notify-A-pack`、未创建/发布任何 Release**。
- 未评判 A/B/C 的源码质量（分工不同）；本报告只回答"这个包是否可复现、可签收"。
- 复核时 A 工作树有 7 项未提交改动（A 正在吸收 D 的 R1 交付），因此 D 使用了独立
  `dsh-r2-base` worktree，未使用 A 工作树的构建产物。
