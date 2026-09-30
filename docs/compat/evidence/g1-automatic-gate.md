# G1 本地自动门记录

本文件包含两轮记录：

- **第 1 轮（Agent A，2026-09-30）**：针对候选 commit `1d7d2a8` / tgz `7CE7ACAD…F819D` 的签发。
- **第 2 轮（Agent 3，集成收口，2026-09-30）**：在同一 commit 上独立复跑，并补做「tgz 全新隔离安装后从安装包入口复跑集成测试」。**重打包未执行（阻塞，见 §7）。**

---

# 第 1 轮：Agent A 签发记录

签发日期：2026-09-30。签发人：Agent A（主整合）。
**结论：G1 本地自动门 PASS，可以开始 T6。**

## 1. 固定输入

| 项 | 值 | 核验方式 |
|---|---|---|
| 插件 commit | `1d7d2a867850cf43306458acc46c83e14cf8258a`（adapt/dsh-017-host，T7a 候选） | `git rev-parse HEAD`；工作区干净 |
| 候选包 | `D:\codex\dsh-approval-center-0.3.1-rc.1.tgz` | SHA256 `7ce7acad984b1ff642d30d3ca6112bd5c6a3aa24cfa98e46b554f7a9facf819d`（实测 = 交接单 `7CE7…819D`，一致） |
| 候选包内容 | version `0.3.1-rc.1`，peer 精确 `@deepseek-ai/dsh: 0.1.7-rc.2`；lib 与 HEAD 构建产物**逐字节一致**（diff -rq 零差异） | 解包核验 |
| 宿主 fixture | `test/integration/node_modules/@deepseek-ai/*`：dsh-user-approval **0.1.7-rc.2**、cordis 4.0.4、schemastery 3.18.4、cosmokit 1.8.5；全部 dsh-* 传递依赖同为 0.1.7-rc.2 | 逐一读 package.json |
| 环境 | Windows 10.0.26200（正常桌面账户，非沙箱）、Node v24.20.0、PowerShell 5.1.26100.9168（wscript/VBScript 可用） | 现场实测 |

## 2. 执行结果（全部本机实跑，日志 /tmp/g1-*.log）

| 门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npm run typecheck` | **PASS**（exit 0） |
| 构建 | `npm run build` | **PASS**（exit 0，产物未产生 git 变更 = 已同步） |
| 完整单测 | `npm run test:unit` | **93/93 PASS，0 fail，0 skip**（exit 0） |
| 集成（目标版） | `npm run test:integration`（`--import ./test/integration/hooks/register.mjs`，fixture 精确 0.1.7-rc.2） | **21/21 PASS，0 fail，0 skip**（exit 0） |

### 2.1 单测完整性声明（针对交接单 §0 的 81 项受限子集）

本次为正常桌面账户完整执行，**不是 81 项子集**。关键实执行用例全部真实运行：

- **U-vbs/01–06**：`wscript.exe` 真实执行 approval-uri-handler.vbs（approve/reject 回写、路径穿越与非 hex id 拒写、非法 decision 拒写、合法映射目录、相对路径回落），全部 PASS（实测耗时 33ms–6283ms，非 mock）。
- **U-ps/01–06**：PowerShell 版 URI 处理器同矩阵真实执行，全部 PASS。
- **S-01–S-04**：真实脚本 BOM/ASCII 静态门 + PS 5.1 Parser::ParseFile 语法门（含中文+空格路径），PASS。
- 两条原接线故障用例（卸载中止 → unavailable；批准后 SQLite 结算失败不放行、回执无"已批准"）均在 93 项内转绿。

## 3. CI / release 配置核验

- `ci.yml`：`check`（typecheck+build+test:unit+编码/PS5.1 门）与 `integration`（fixture 精确安装 + `test:integration`；0.1.5-rc.1 回归观察 `continue-on-error`）——配置正确。
- `release.yml`：tag 触发，打包前跑 typecheck/build/test:unit/test:integration——配置正确；**未触发**（遵守"不要为验证 release workflow 提前触发发布"）。
- **CI 运行状态：PENDING**——分支 `adapt/dsh-017-host` 尚未推送 origin，GitHub Actions 无首轮记录。按派发单 §1，本地完整自动门可放行 C；CI 结果是正式发布前必须补齐的证据（G4 前置）。

## 4. PASS / FAIL / PENDING 汇总（第 1 轮）

| 项 | 状态 |
|---|---|
| typecheck / build | PASS |
| 完整 test:unit 93/93（含 VBS/PS 实执行） | PASS |
| 目标版 test:integration 21/21，fixture 0.1.7-rc.2 精确 | PASS |
| 候选 tgz SHA256 与交接单一致、lib=HEAD | PASS |
| 版本/peer 声明（0.3.1-rc.1 / 精确 0.1.7-rc.2） | PASS |
| GitHub Actions 首轮 | **PENDING**（分支未推送） |
| 0.1.5-rc.1 旧版回归用例 | **PENDING**（fixture 已就绪、无用例；不构成双版本支持承诺） |
| 深层 JSON Schema 投影 | PENDING（留 T6 或完整宿主引导验证） |

## 5. 签发

**G1 本地 PASS，可以开始 T6。**
C 使用固定候选包 `dsh-approval-center-0.3.1-rc.1.tgz`（SHA256 `7CE7ACAD984B1FF642D30D3CA6112BD5C6A3AA24CFA98E46B554F7A9FACF819D`）按 runbook S1–S14 执行；任何入包文件变化都会使本 SHA 失效，须重打包并重测受影响项。

---

# 第 2 轮：Agent 3（集成收口）独立复跑记录

执行日期：2026-09-30。执行人：Agent 3。
**结论：G1 自动门 PASS（全部四项 + 隔离安装复跑）；重打包 PENDING（阻塞于 Agent 1 的 ISSUE-1 修复尚未合入）。**

## 6. 环境与固定输入（实测）

| 项 | 值 | 获取方式 |
|---|---|---|
| 仓库 / 分支 | `D:\codex\dsh-approval-center`，`adapt/dsh-017-host` | `git rev-parse --abbrev-ref HEAD` |
| commit | `29eac51e3efe662b291e77fa1c225943cebdb07c` | `git rev-parse HEAD` |
| 工作区 | 干净（`git status --porcelain` 空输出） | 实测 |
| 账户 | `DESKTOP-3ROFSHU\A`，**正常桌面交互账户，非受限沙箱**（组含 INTERACTIVE / CONSOLE LOGON） | `WindowsIdentity::GetCurrent()` |
| 操作系统 | Microsoft Windows NT 10.0.26200.0 | `[Environment]::OSVersion` |
| Node / npm | v24.20.0 / 11.19.0 | `node --version` / `npm --version` |
| PowerShell | 5.1.26100.9168（`powershell.exe` 真 5.1） | `$PSVersionTable` |
| wscript | `C:\Windows\System32\wscript.exe` 存在，**实测可执行**（探针 `WScript.Echo` 输出 `wscript-ok`，exit 0） | 实测 |
| 候选 tgz | `D:\codex\dsh-approval-center-0.3.1-rc.1.tgz` | 实测 |
| 候选 SHA256 | `7CE7ACAD984B1FF642D30D3CA6112BD5C6A3AA24CFA98E46B554F7A9FACF819D` | `Get-FileHash`，与交接单一致 |
| 日志目录 | `D:\codex\dsh-approval-center-3\logs\` | — |

> 说明：本机 `Get-CimInstance Win32_OperatingSystem` 返回"拒绝访问"（WMI 权限），故 OS 版本改由 `[Environment]::OSVersion` 取得；`whoami.exe` 亦被拒绝，身份由 `WindowsIdentity` API 取得。两者均不影响门禁结论。

## 7. 重打包状态：**PENDING（阻塞）**

派发单要求「合入 ISSUE-1 修复后重打包」。截至本次执行，**前置依赖未满足**：

| 检查项 | 实测结果 |
|---|---|
| Agent 1 分支 `adapt/dsh-017-issue1-encoding` | 存在，但 HEAD 仍为 `1d7d2a8`（= 未修复的基线），**无任何新 commit** |
| Agent 1 worktree `D:\codex\dsh-approval-center-1` | 存在，**改动未提交**：`scripts/approval-toast.ps1`（+14/-1）、`test/dialog.uri-handler.test.js`（+208） |
| `adapt/dsh-017-host`（整合分支） | HEAD 仍为 `29eac51`，**未包含修复** |
| ISSUE-1 缺陷本体 | **仍存在于当前树**：`scripts/approval-toast.ps1:316` 用 `UTF8Encoding($false)`（无 BOM）写 `<id>.dir` 映射，而 `scripts/approval-uri-handler.vbs:77` 用 `OpenTextFile(mapPath, 1)`（默认 ANSI/CP936）读 → 非 ASCII 私有 StateDir 解析成乱码 → 回落默认目录 → 等待方看不到结果 → 审批超时（fail-closed） |
| Agent C 复审 | 未见通过记录 |

**因此：本次不执行 `npm run build` → `npm pack`，不产生新 tgz，不签发新 SHA。**
旧 SHA `7CE7ACAD984B1FF642D30D3CA6112BD5C6A3AA24CFA98E46B554F7A9FACF819D` **仍然有效**（它精确对应未修复的 `1d7d2a8`），但**不能作为 ISSUE-1 修复后的候选包**使用。

重打包所需条件（待满足后由 Agent 3 或接手者执行）：
1. Agent 1 提交修复 → 经 Agent C 复审通过 → 合入 `adapt/dsh-017-host`；
2. 在干净目录 `npm install`（Node 24）→ `npm run build` → `npm pack`；
3. 记录新 commit、19 项条目清单、新 tgz 绝对路径与 SHA256；
4. 版本策略：维持 `0.3.1-rc.1` 则须在 CHANGELOG 未发布段注明「rc.1 重打包（ISSUE-1 修复）」；改 `0.3.1-rc.2` 则须同步 `package.json` 并说明。

## 8. 执行结果（本轮实测）

全部命令在 `D:\codex\dsh-approval-center`（commit `29eac51`，工作区干净）执行。

| # | 门 | 命令 | 结果 | 日志 |
|---|---|---|---|---|
| 1 | 类型 | `npm run typecheck` | **PASS**（exit 0） | `logs\g1-typecheck.log` |
| 2 | 构建 | `npm run build` | **PASS**（exit 0）；构建后 `git status --porcelain` 为空 ⇒ 产物与 HEAD 同步 | `logs\g1-build.log` |
| 3 | 完整单测 | `npm run test:unit` | **93 tests / 93 pass / 0 fail / 0 cancelled / 0 skipped**（exit 0，duration 19582ms） | `logs\g1-test-unit.log` |
| 4 | 集成（目标版） | `npm run test:integration` | **21 tests / 21 pass / 0 fail / 0 skipped**（exit 0，duration 4334ms） | `logs\g1-test-integration.log` |
| 5 | 隔离安装复跑 | 见 §9 | **21 tests / 21 pass / 0 fail / 0 skipped**（exit 0） | `logs\g1-isolated-install-integration.log` |

### 8.1 完整单测 = 93 项，**不是 81 子集**

`node --test` 汇总行原文：`tests 93 / pass 93 / fail 0 / skipped 0`。VBS 与 PS 处理器均为**真实进程执行**（非 mock），耗时证明其真实运行：

- `U-vbs/01–06`（wscript.exe 真实执行）：54.2ms / 34.0ms / **6270.7ms** / **1581.6ms** / 37.2ms / 36.3ms — 全 PASS
- `U-ps/01–06`（powershell.exe 真实执行）：216.1ms / 208.6ms / **6706.5ms** / **1665.4ms** / 203.0ms / 207.2ms — 全 PASS
- `S-01–S-04`：脚本 BOM/ASCII 字节门 + PS 5.1 `Parser::ParseFile` 语法门（含中文+空格路径）— 全 PASS
- 两条原接线故障用例转绿：卸载中止 → `unavailable`；批准后 SQLite 结算失败不放行且回执不含"已批准"

### 8.2 集成测试 = 21 项，0 skip，fixture 精确 `0.1.7-rc.2`

`test:integration` 以 `--import ./test/integration/hooks/register.mjs` 运行，**不拉起人工 `test/approval.test.js`**。fixture 逐包实测版本：

| 包 | 版本 |
|---|---|
| `@deepseek-ai/dsh-llm` / `dsh-scope` / `dsh-session` / `dsh-user-approval` | **0.1.7-rc.2** |
| `@deepseek-ai/dsh-timeout` / `dsh-brand` / `dsh-util-crypto` / `dsh-util-values` / `dsh-typert-protocol` | **0.1.7-rc.2** |
| `@deepseek-ai/cordis` | 4.0.4 |
| `@deepseek-ai/schemastery` | 3.18.4 |
| `@deepseek-ai/cosmokit` | 1.8.5 |

汇总行原文：`tests 21 / suites 8 / pass 21 / fail 0 / skipped 0`。

## 9. 新 tgz 全新隔离目录安装后复跑集成测试

目的：验证「打包 → 安装 → 从**安装包入口**运行」这条链路，而不是只验证仓库工作树。

| 步骤 | 命令 / 操作 | 结果 |
|---|---|---|
| 1 | `D:\codex\dsh-approval-center-3\isolated-install\pkg\` 新建空目录，仅含 `package.json`（`a3-isolated-consumer`，private） | OK |
| 2 | `npm install file:./dsh-approval-center-0.3.1-rc.1.tgz` | exit 0，added 520 packages |
| 3 | 校验安装后 `node_modules\dsh-approval-center\package.json` version | `0.3.1-rc.1` |
| 4 | 校验安装后入口存在 | `lib\index.js` 存在 |
| 5 | 复制 `test/integration/`（去掉 `node_modules`）到隔离目录，`npm ci --ignore-scripts` | exit 0，14 packages |
| 6 | 设 `DSH_PLUGIN_ENTRY=<隔离安装>\node_modules\dsh-approval-center\lib\index.js`，运行 `node --import ./hooks/register.mjs --test --test-concurrency=1 approval-flow.test.js lifecycle.test.js` | **21/21 PASS，0 fail，0 skip**（exit 0） |

`DSH_PLUGIN_ENTRY` 是 harness 既有的注入点（`test/integration/helpers/harness.mjs:22`，注释明确用于「T7a 候选包烟测可指向干净目录安装后的入口」）。

### 9.1 包内条目与逐字节一致性

`npm pack --dry-run` 报告 `total files: 19`；实际 `tar -tzf` 同为 **19 项**：

```
package/LICENSE                                  package/lib/dialog.js
package/package.json                             package/lib/host-contract.js
package/CHANGELOG.md                             package/lib/index.js
package/README.md                                package/lib/queue.js
package/cordis.patch.yml                         package/lib/store.js
package/scripts/approval-toast.ps1               package/lib/dialog.d.ts
package/scripts/approval-uri-handler.ps1         package/lib/host-contract.d.ts
package/scripts/approval-uri-handler.vbs         package/lib/index.d.ts
package/scripts/toast.ps1                        package/lib/queue.d.ts
                                                 package/lib/store.d.ts
```

**19 项全部逐一 SHA256 比对：tgz 解包产物 == 隔离安装后的文件 == 仓库工作树文件，0 处不一致。**
（新增的 `test/dialog.uri-handler.test.js` 增量不入包——`package.json` 的 `files` 仅含 `lib`/`scripts`/`cordis.patch.yml`/`README.md`/`CHANGELOG.md`/`LICENSE`。）

## 10. CI 检查

### 10.1 分支推送状态：**未推送**

```
git ls-remote --heads origin   →  仅 f608abd  refs/heads/main
git branch -r --contains HEAD  →  （空）
git rev-list --count origin/main..HEAD  →  21
```

`adapt/dsh-017-host` 及其 21 个 commit **未推送到 origin**。
⇒ **GitHub Actions 首轮结果：PENDING（无运行记录）**，与第 1 轮结论一致。

### 10.2 `ci.yml` 与本地门禁一致性

| 本地门 | `ci.yml` 对应 | 一致性 |
|---|---|---|
| `npm ci`（lock 同步） | `check` job `npm ci` | ✅ 已实测 `npm ci --dry-run` exit 0（lock 同步） |
| `npm run typecheck` | `check` job | ✅ 同名脚本 |
| `npm run build` | `check` job | ✅ 同名脚本 |
| `npm run test:unit`（93 项） | `check` job | ✅ 同名脚本，同一份 93 项 |
| 脚本 BOM/ASCII + PS5.1 语法门 | `check` job「assert script encodings and PowerShell syntax」 | ✅ 与 `test/dialog.scripts.test.js` 的 S-01–S-04 同判据，CI 内额外独立复算 |
| `npm run test:integration`（21 项） | `integration` job（`needs: check`） | ✅ 同名脚本；`working-directory: test/integration` 先 `npm ci --ignore-scripts` 装精确 `0.1.7-rc.2` 并做版本漂移断言（失败即 throw ⇒ 强制门） |
| 0.1.5-rc.1 旧版 fixture | `integration` job，`continue-on-error: true` | ✅ 与「旧版观察、非强制门、不构成双版本支持承诺」口径一致 |
| `npm test`（聚合） | 未直接使用；拆成两个 job 覆盖同一命令集合 | ✅ 等价 |

**fixture lock 同步已实测**：`test/integration` 与 `test/integration/fixture-015` 的 `npm ci --ignore-scripts --dry-run` 均 exit 0，CI 的 `npm ci` 不会因 lock 失步而失败。

### 10.3 `release.yml` 与本地门禁一致性

| 项 | 结果 |
|---|---|
| 触发 | `push: tags: ['v*']` + **`workflow_dispatch`** |
| 门禁 | `npm ci` → `typecheck` → `build` → `test:unit` → 精确 `0.1.7-rc.2` fixture 安装（含漂移断言）→ `test:integration` → `npm pack` → 校验 tarball 必需条目 → `gh release create` |
| 与本地一致性 | ✅ 与本地 `npm test` 同命令集合 |
| tarball 校验 | 要求 7 个条目（`lib/index.js`、`lib/index.d.ts`、`cordis.patch.yml`、四个 scripts）——本轮 19 项中全部存在 ✅ |
| 是否触发 | **未触发**。遵守红线「不要为验证 release workflow 触发发布」，未打 tag、未手动 dispatch |
| 版本号一致 | `release.yml` 注释示例用 `v0.3.0`；当前候选为 `0.3.1-rc.1`。**打 tag 时必须用 `v0.3.1-rc.1`**，且 `files` 校验用的 glob `dsh-approval-center-*.tgz` 与该版本匹配 ✅ |

### 10.4 需关注的 CI 风险（供 Agent C / 发布决策）

1. **`ci.yml` 的 `push` 只监听 `main`**（`branches: [main]`）。把 `adapt/dsh-017-host` 直接推送到 origin **不会**触发 CI；要拿到首轮结果，必须**开 PR**（`pull_request` 未限定分支，会触发）或推送 `main`。这是「分支已推送则记录 Actions 首轮结果」这一要求最容易踩空的地方。
2. **`release.yml` 开放了 `workflow_dispatch`**：任何有写权限者都可手动触发并**真的创建 GitHub Release**。发布前请确认无人误触；本轮未触发。
3. **`release.yml` 没有独立的脚本编码门**（`ci.yml check` 才有）。其 `test:unit` 会经 `test/dialog.scripts.test.js` 覆盖 S-01–S-04，属部分覆盖；如需与 `ci.yml` 完全对齐，可考虑在 `release.yml` 增加同名步骤。
4. **`ci.yml` 的 integration job 不校验 tarball 条目**（仅 `release.yml` 校验）。本地第 9 节已实测 19 项齐全。

## 11. PASS / FAIL / PENDING 汇总（第 2 轮）

### PASS

| 项 | 证据 |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0；构建后工作区无 git 变更 |
| `npm run test:unit` — **93/93，0 fail，0 skip** | 含 wscript/PS 真实执行（U-vbs/01–06、U-ps/01–06）与 S-01–S-04 |
| `npm run test:integration` — **21/21，0 fail，0 skip** | fixture 精确 `0.1.7-rc.2`，经 `hooks/register.mjs` |
| tgz 全新隔离安装后从安装包入口复跑集成 | **21/21，0 fail，0 skip** |
| 包内 19 项条目完整性 | `npm pack --dry-run` 与 `tar -tzf` 同为 19 项 |
| tgz == 安装产物 == 仓库工作树 | 19 项逐一 SHA256，0 处不一致 |
| 候选 SHA256 与交接单一致 | `7CE7ACAD…F819D` |
| 版本/peer 声明 | `0.3.1-rc.1` / peer 精确 `@deepseek-ai/dsh: 0.1.7-rc.2` |
| `ci.yml` / `release.yml` 与本地门禁一致 | §10.2 / §10.3 |
| fixture lock 同步（CI `npm ci` 不会失步） | 两处 `npm ci --dry-run` 均 exit 0 |
| 环境具备完整桌面能力（wscript 实执行） | 探针 exit 0 |

### FAIL

**无。** 本轮未观察到任何门禁失败。

### PENDING

| 项 | 原因 | 解除条件 |
|---|---|---|
| **重打包（新 commit / 新 tgz / 新 SHA）** | **阻塞**：Agent 1 的 ISSUE-1 修复未提交、未复审、未合入；`adapt/dsh-017-host` HEAD 仍为 `29eac51`，缺陷仍在树中 | Agent 1 提交 → Agent C 复审通过 → 合入 → 干净目录 install/build/pack |
| CHANGELOG「rc.1 重打包（ISSUE-1 修复）」或版本升至 `0.3.1-rc.2` | 依赖重打包 | 随重打包一并处理 |
| GitHub Actions 首轮结果 | 分支未推送；且 `ci.yml` push 仅监听 `main`，直推 adapt 分支不触发 | 推送 `main` 或开 PR 后记录首轮 |
| 0.1.5-rc.1 旧版回归用例 | fixture 已就绪但无用例 | 补用例；不构成双版本支持承诺 |
| 深层 JSON Schema 投影 | 需完整宿主引导 | T6 / V19 |
| G2 Windows 实机（V01–V20）、G4 发布 | 依赖新包 + C 的 E6/V17 重测 | 见派发单 §4 |

## 12. 边界声明

- 本轮**未发布、未打 tag、未改生产 profile、未动 HKCU**；`release.yml` 未触发。
- 本轮**未修改 `src/`、`scripts/`、`test/`**；仅新增本证据文件。工作区保持干净。
- 集成测试的通知通道为 **mock spawn**（`spawn-shim`），但 `ApprovalService`、Cordis waterfall、SQLite 审计、队列与卸载均为**真实实现**；**真实 Toast / URI 点击属 G2（Agent C 实机）范围**，本文件不作实机通过声明。
- 新包未经 Agent C 复审 + 实机重测（E6）前，**不得称"验收通过"**。
