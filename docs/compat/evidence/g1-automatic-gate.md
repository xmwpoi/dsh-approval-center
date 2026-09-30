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

---

# 第 3 轮：Agent 3（集成收口）合入 windows 分支 + 重打包 + 复跑

执行日期：2026-09-30。执行人：Agent 3。
前置：Agent 1 的 ISSUE-1 修复（`adapt/dsh-017-windows@2ad78cc`，含 T3、T6 归档、映射编码修复、48/48 测试）**已由 Agent C 复审通过**，阻塞解除。
**结论：合入干净无冲突；四项门 PASS（unit 98/98、integration 21/21）；新包已产出；19 条目三方 SHA256 全等；CI 仍 PENDING。**

## 13. 合入 `adapt/dsh-017-windows` → `adapt/dsh-017-host`

### 13.1 合并前状态

| 项 | 值 |
|---|---|
| 合并前 host HEAD | `75a54fa53af79357659db218c053df95f928fa62`（含第 2 轮证据提交） |
| windows 分支 HEAD | `2ad78cc2ff3f5a9b31a0bc07f1fded3b9a888eef` |
| merge base | `07500522325a188e5d3a9823c6dede19ee1b0851`（T3） |
| 合并前冲突预演 | `git merge-tree --write-tree adapt/dsh-017-host adapt/dsh-017-windows` → 单行输出树对象 `5b009da1…`，**无冲突标记** |

### 13.2 合并结果

以 `git merge --no-ff` 执行，**ort 策略自动合并，0 冲突**：

```
Merge branch 'adapt/dsh-017-windows' into adapt/dsh-017-host: T3 token 定向清理 +
T6 实机证据归档 + ISSUE-1 映射编码修复（ANSI 写）+ 5 项中文 StateDir 回归测试
```

合并 commit：`c86c66ac4324600ebfdc63d86bdb05391a8fc3cc`（parents: `75a54fa` + `2ad78cc`）

带入 5 个文件变更：

| 文件 | 变更 |
|---|---|
| `scripts/approval-toast.ps1` | +8/−1（映射写入改 ANSI） |
| `test/dialog.unicode-mapping.test.js` | +139（新增 5 项回归测试） |
| `docs/compat/evidence/windows/t6/T6-results.md` | +82（新增） |
| `docs/compat/evidence/windows/t6/env-baseline.md` | +65（新增） |
| `docs/compat/evidence/windows/t6/toast-entry-baseline.txt` | +3（新增） |

### 13.3 冲突裁决逐条列

**本轮实际冲突数 = 0，无任何文件需要按「以 windows 分支为准」裁决。**

原因：windows 分支自 merge base `0750052` 起只改动了上述 5 个文件；host 分支同期改动的是 `package.json`/`CHANGELOG.md`/`lib/**`/`docs/compat/evidence/g1-automatic-gate.md`/CI 配置——**两侧文件集不相交**，故 git 无需人工裁决。

为履行「逐条列裁决」的要求，对**双方共同祖先之后各自改动过的路径**做穷尽核对，逐条给出裁决：

| # | 路径 | host 侧 | windows 侧 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | `scripts/approval-toast.ps1` | 未改（沿用基线 UTF-8 写法） | **改**：`WriteAllText(..., [System.Text.Encoding]::Default)` | **采纳 windows** | 即 ISSUE-1 修复本体，C 已复审通过；host 侧无竞争改动 |
| 2 | `test/dialog.unicode-mapping.test.js` | 不存在 | **新增** | **采纳 windows** | ISSUE-1 回归测试（含清理路径第 2 个受害者） |
| 3 | `docs/compat/evidence/windows/t6/T6-results.md` | 不存在 | **新增** | **采纳 windows** | T6 实机证据归档，G2 通道层收口依据 |
| 4 | `docs/compat/evidence/windows/t6/env-baseline.md` | 不存在 | **新增** | **采纳 windows** | 同上 |
| 5 | `docs/compat/evidence/windows/t6/toast-entry-baseline.txt` | 不存在 | **新增** | **采纳 windows** | 同上 |
| 6 | `package.json` | **改**：`test:unit` 已含 7 个测试文件（含 T2/T4 的 `queue`/`store`） | 旧形态（无 `test:unit`，仅有 `test`/`typecheck`） | **采纳 host** | host 侧含 T2/T4 的脚本聚合，较新；windows 分支自 merge base 起**未改** `package.json`（已核 `git diff --name-only 0750052 adapt/dsh-017-windows` 不含它），故非冲突项 |
| 7 | `CHANGELOG.md` | **改**：含 `0.3.1-rc.1` 未发布段 | 旧形态（无该段） | **采纳 host** | 同上，windows 侧未改此文件（`git diff --stat` 显示 host→windows 为 −6 行纯回退，非其自身改动） |
| 8 | `.github/workflows/ci.yml`、`release.yml` | **改**：含 `check`/`integration` 分层门禁 | 旧形态（无这些 job） | **采纳 host** | 同上，windows 侧未改 CI |
| 9 | `lib/**` | 构建产物与 src 同步 | 旧构建产物 | **采纳 host** | windows 侧未改 `lib/`；合并后由 `npm run build` 重新校验一致 |
| 10 | `docs/compat/evidence/g1-automatic-gate.md` | 含第 1、2 轮记录 | 不存在 | **采纳 host** | 本轮在其后**追加**第 3 轮，前两轮原文不改 |

> 说明：第 6–9 项之所以"采纳 host"，是因为它们在 windows 分支上**从未被修改**——`git diff --stat 0750052 adapt/dsh-017-windows` 仅列出 §13.2 的 5 个文件。因此它们不构成合并冲突，只是被本轮穷尽核对列出以满足"逐条列裁决"要求。

### 13.4 合并后完整性校验

| 校验 | 结果 |
|---|---|
| 合并后工作区 | 干净（`git status --porcelain` 空） |
| ISSUE-1 修复在位 | `scripts/approval-toast.ps1:322` = `[System.IO.File]::WriteAllText($mappingFile, $StateDir, [System.Text.Encoding]::Default)` ✅ |
| `ci.yml` 未被回退 | `check:`(L15) 与 `integration:`(L56) 两个 job 均在 ✅ |
| CHANGELOG `0.3.1-rc.1` 段未被回退 | 存在（L3）✅ |
| `package.json` version | `0.3.1-rc.1` ✅ |

## 14. 合入后发现并修复的接线缺口（重要）

**问题**：windows 分支的 `test/dialog.unicode-mapping.test.js`（5 项测试）**未被纳入 `test:unit`**。

根因：windows 分支自 merge base `0750052` 分叉，其 `package.json` 停留在**没有 `test:unit` 脚本**的旧形态（只有 `prepare`/`build`/`clean`/`test`/`test:approval`/`typecheck`）。`test:unit` 是 host 分支后来（T5）才引入的聚合脚本，windows 侧无从得知要追加新文件。合并后 `test:unit` 仍只列 7 个文件，新测试**不会被执行**——若不复核，98 项会静默退化成 93 项。

**修复**：在 `package.json` 的 `test:unit` 末尾追加 `test/dialog.unicode-mapping.test.js`（该文件属 Agent 3 独占范围）。修复后 93 → **98** 项，与派发要求的「约 98 项」一致。

commit：`70cb25c30c17c16c4eb1ea7f74d8d0682e748309`
`重打包准备: test:unit 纳入 dialog.unicode-mapping.test.js（93->98）；CHANGELOG 注明重打包（T6 收口 + ISSUE-1 修复）`

## 15. 重打包（干净目录，Node 24）

### 15.1 流程

| 步骤 | 命令 / 操作 | 结果 |
|---|---|---|
| 1 | `git archive --format=tar -o head.tar HEAD`（HEAD = `70cb25c`） | exit 0，808960 字节 |
| 2 | 解包到全新空目录 `D:\codex\dsh-approval-center-3\repack` | 确认**无 `.git`、无 `node_modules`** |
| 3 | `npm install --no-audit --no-fund` | exit 0，added 6 packages（`.npmrc` 的 `omit=peer` 生效，未灌入 DSH 依赖树） |
| 4 | `npm run build` | exit 0 |
| 5 | 干净目录 `lib/**` 与仓库 `lib/**` 逐文件 SHA256 比对 | **10/10 IDENTICAL**（构建可复现） |
| 6 | `npm pack` | exit 0，`total files: 19` |

> 注：首次尝试用 `git archive \| tar -x` 管道解包失败（tar 报 bad header checksum）——这是本沙箱下"程序捕获另一程序管道输出"的限制，非仓库问题。改用 `-o` 落盘再解包即正常。

### 15.2 新包固定信息

| 项 | 值 |
|---|---|
| **新 tgz 绝对路径** | `D:\codex\dsh-approval-center-0.3.1-rc.1-t6-issue1.tgz` |
| **新 SHA256** | `9F13E71BF14F26D9D4840032DA3C5409CBCE43F93CBA47BA0F61B947E25ECFA8` |
| 新包大小 | 47170 字节 |
| 包内条目数 | **19** |
| 版本 | `0.3.1-rc.1`（维持不变） |
| peer | `@deepseek-ai/dsh: 0.1.7-rc.2`（精确，未变） |
| 构建 commit | `70cb25c30c17c16c4eb1ea7f74d8d0682e748309` |
| **旧 SHA（作废）** | `7CE7ACAD984B1FF642D30D3CA6112BD5C6A3AA24CFA98E46B554F7A9FACF819D`（对应未修复的 `1d7d2a8`） |

> 文件名带 `-t6-issue1` 后缀是**为了不覆盖旧 tgz 造成 SHA 混淆**；包内 `package.json` 的 `name`/`version` 仍为标准 `dsh-approval-center@0.3.1-rc.1`，`release.yml` 的 `dsh-approval-center-*.tgz` glob 亦能匹配（实际发布时由 `npm pack` 现场产出标准名）。C 安装时直接用该绝对路径即可。

### 15.3 新包 19 条目清单

```
package/LICENSE                              package/lib/dialog.d.ts
package/package.json                         package/lib/host-contract.d.ts
package/CHANGELOG.md                         package/lib/index.d.ts
package/README.md                            package/lib/queue.d.ts
package/cordis.patch.yml                     package/lib/store.d.ts
package/lib/dialog.js                        package/scripts/approval-toast.ps1
package/lib/host-contract.js                 package/scripts/approval-uri-handler.ps1
package/lib/index.js                         package/scripts/approval-uri-handler.vbs
package/lib/queue.js                         package/scripts/toast.ps1
package/lib/store.js
```

### 15.4 新旧包逐条目差异（哪些入包文件变了）

19 项中**恰好 3 项变化**，其余 16 项字节相同：

| 条目 | 状态 | 原因 |
|---|---|---|
| `scripts/approval-toast.ps1` | **CHANGED** | ISSUE-1 修复（UTF-8 → ANSI 写映射） |
| `package.json` | **CHANGED** | `test:unit` 纳入新测试文件 |
| `CHANGELOG.md` | **CHANGED** | 新增「重打包（T6 收口 + ISSUE-1 修复）」段 |
| 其余 16 项 | same | — |

**`lib/**` 全部 10 个文件与旧包字节相同**——本次是脚本层修复，未改 `src/`，符合预期。

### 15.5 CHANGELOG 注明（按派发要求）

版本**维持 `0.3.1-rc.1`**，已在未发布段新增子节：

> `### 重打包（T6 收口 + ISSUE-1 修复）`
> 明确「入包文件已变更，此前的候选包 SHA256 作废，须以本段对应的重打包产物为准」，并分列 ISSUE-1 修复内容、`-CleanupToken` 补测、T6 证据归档。

## 16. G1 第 3 轮：四项门 + 隔离安装复跑 + 三方比对

环境与第 2 轮一致：`DESKTOP-3ROFSHU\A` 正常桌面交互账户；Windows NT 10.0.26200.0；Node v24.20.0；npm 11.19.0；PowerShell 5.1.26100.9168；`wscript.exe` 可用。

### 16.1 四项门（commit `70cb25c`，工作区干净）

| # | 门 | 命令 | 结果 | 日志 |
|---|---|---|---|---|
| 1 | 类型 | `npm run typecheck` | **PASS**（exit 0） | `logs\g1r3-typecheck.log` |
| 2 | 构建 | `npm run build` | **PASS**（exit 0） | `logs\g1r3-build.log` |
| 3 | 完整单测 | `npm run test:unit` | **98 tests / 98 pass / 0 fail / 0 cancelled / 0 skipped**（exit 0，duration 22735ms） | `logs\g1r3-test-unit.log` |
| 4 | 集成（目标版） | `npm run test:integration` | **21 tests / 21 pass / 0 fail / 0 skipped**（exit 0，duration 4217ms） | `logs\g1r3-test-integration.log` |

### 16.2 98 项构成：新增 5 项确认真实执行

第 3 轮的 5 项新增（全部 PASS，非 skip）：

```
✔ ISSUE-1/清理路径: 中文私有 StateDir 下 -CleanupToken 经映射命中并双清（Agent 1 发现的第二个受害者） (398.0ms)
✔ ISSUE-1/静态: approval-toast.ps1 的映射写入必须是 ANSI（Encoding.Default） (0.5ms)
✔ ISSUE-1/VBS: ANSI 映射 -> 中文+空格 StateDir 命中 (199.3ms)
✔ ISSUE-1/PS 回退: ANSI 映射 -> 中文+空格 StateDir 命中 (327.1ms)
✔ ISSUE-1/对照: UTF-8 旧写法仍会回落默认目录（记录处理器既有语义，不因本修复改变） (2263.3ms)
```

原有真实进程执行用例仍全绿（wscript/PS 非 mock）：

```
✔ U-vbs/01: approve 决定写入默认状态目录 (38.6ms)
✔ U-vbs/03: 非法 id（路径穿越/非 hex）→ 不写任何文件 (6280.0ms)
✔ U-ps/01: approve 决定写入默认状态目录 (216.9ms)
✔ U-ps/03: 非法 id（路径穿越/非 hex）→ 不写任何文件 (6661.8ms)
```

`U-ps/04` 等其余 U 系列同前两轮一致通过。

### 16.3 集成测试 fixture 仍精确 `0.1.7-rc.2`

汇总原文 `tests 21 / suites 8 / pass 21 / fail 0 / skipped 0`；`dsh-llm` / `dsh-scope` / `dsh-session` / `dsh-user-approval` 实测均为 `0.1.7-rc.2`。

### 16.4 新 tgz 隔离安装后从安装包入口复跑集成

| 步骤 | 操作 | 结果 |
|---|---|---|
| 1 | 全新空目录 `D:\codex\dsh-approval-center-3\isolated-r3\pkg\`，仅含私有 `package.json` | OK |
| 2 | `npm install file:./dsh-approval-center-0.3.1-rc.1.tgz`（即新包） | exit 0 |
| 3 | 安装后 version | `0.3.1-rc.1` |
| 4 | 安装后脚本含修复 | `approval-toast.ps1:322` 为 `[System.Text.Encoding]::Default` ✅ |
| 5 | 复制 `test/integration/`（去 `node_modules`）→ `npm ci --ignore-scripts` | exit 0，14 packages，四包均 `0.1.7-rc.2` |
| 6 | `DSH_PLUGIN_ENTRY=<隔离安装>\node_modules\dsh-approval-center\lib\index.js` 运行两集成文件 | **21/21 PASS，0 fail，0 skip**（exit 0） |

日志：`logs\g1r3-isolated-integration.log`

### 16.5 19 条目 SHA256 三方比对（tgz 解包 == 隔离安装 == 仓库工作树）

```
CHANGELOG.md                       IDENTICAL      lib/index.js                       IDENTICAL
LICENSE                            IDENTICAL      lib/queue.d.ts                     IDENTICAL
README.md                          IDENTICAL      lib/queue.js                       IDENTICAL
cordis.patch.yml                   IDENTICAL      lib/store.d.ts                     IDENTICAL
package.json                       IDENTICAL      lib/store.js                       IDENTICAL
lib/dialog.d.ts                    IDENTICAL      scripts/approval-toast.ps1         IDENTICAL
lib/dialog.js                      IDENTICAL      scripts/approval-uri-handler.ps1   IDENTICAL
lib/host-contract.d.ts             IDENTICAL      scripts/approval-uri-handler.vbs   IDENTICAL
lib/host-contract.js               IDENTICAL      scripts/toast.ps1                  IDENTICAL
lib/index.d.ts                     IDENTICAL
```

**mismatches: 0 / 19** —— 三方逐字节一致。

### 16.6 脚本编码门复核（新增/变更脚本）

| 脚本 | 判据 | 结果 |
|---|---|---|
| `scripts/approval-toast.ps1` | 含非 ASCII（9375 字节）时须有 UTF-8 BOM | bom=True ✅ |
| `scripts/approval-uri-handler.vbs` | 必须纯 ASCII | nonAscii=0 ✅ |
| `scripts/approval-toast.ps1` | PS 5.1 `Parser::ParseFile` 语法 | 0 errors ✅ |

## 17. CI 检查（沿用第 2 轮 4 项风险结论）

### 17.1 推送状态：仍未推送 ⇒ PENDING

```
git ls-remote --heads origin          → 仅 f608abd  refs/heads/main
git branch -r --contains HEAD         → （空）
git rev-list --count origin/main..HEAD → 27
```

**GitHub Actions 首轮结果：PENDING（无运行记录）。**
**触发条件（必须写明）**：`ci.yml` 的 `push` 只监听 `main`（`branches: [main]`），因此**把 `adapt/dsh-017-host` 直接推到 origin 不会触发 CI**；要取得首轮结果，**需开 PR 或推 main 触发**（`pull_request` 未限定分支，开 PR 即触发）。

本轮**未推送、未打 tag、未触发 `release.yml`**（红线遵守）。

### 17.2 四项风险（第 2 轮结论沿用，本轮复核仍成立）

| # | 风险 | 本轮复核 |
|---|---|---|
| 1 | `ci.yml` 的 `push` 只监听 `main`；直推 adapt 分支不触发 CI | ✅ 仍成立（`ci.yml:4-5` = `push: branches: [main]`）。**需开 PR 或推 main 触发** |
| 2 | `release.yml` 开放 `workflow_dispatch`，有写权限者可手动触发并**真的创建 Release** | ✅ 仍成立（`release.yml:18`）。本轮未触发；发布前须确认无人误触 |
| 3 | `release.yml` 无独立脚本编码门（仅 `ci.yml check` 有） | ✅ 仍成立；其 `test:unit` 经 `dialog.scripts.test.js` 部分覆盖 S-01–S-04 |
| 4 | `ci.yml` 的 integration job 不校验 tarball 条目（仅 `release.yml` 校验） | ✅ 仍成立；本轮已本地实测 19 项齐全（§15.3/§16.5） |

### 17.3 门禁一致性（本轮复核）

`ci.yml`：`check`（`npm ci` → typecheck → build → test:unit → 脚本编码/PS5.1 语法门）与 `integration`（`needs: check`；精确 `0.1.7-rc.2` fixture 安装 + 版本漂移断言 → `test:integration`；`fixture-015` 为 `continue-on-error` 观察项）——与本地门禁一致。
`release.yml`：tag 触发；`npm ci` → typecheck → build → test:unit → 精确 fixture → `test:integration` → `npm pack` → tarball 7 必需条目校验 → `gh release create`——与本地一致，且本轮新包 19 项已覆盖其要求的 7 项。

## 18. PASS / FAIL / PENDING 汇总（第 3 轮）

### PASS

| 项 | 证据 |
|---|---|
| 合入 `adapt/dsh-017-windows@2ad78cc` | merge commit `c86c66a`，**0 冲突**，裁决逐条列于 §13.3 |
| ISSUE-1 修复在合并后树中生效 | `approval-toast.ps1:322` 用 `Encoding::Default` |
| 接线缺口修复（新测试纳入 `test:unit`） | `package.json` commit `70cb25c`；93 → 98 |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0；干净目录构建 `lib` 与仓库逐文件 SHA256 全等 |
| `npm run test:unit` — **98/98，0 fail，0 skip** | 含 5 项新增 ISSUE-1 测试 + wscript/PS 实执行 |
| `npm run test:integration` — **21/21，0 fail，0 skip** | fixture 精确 `0.1.7-rc.2` |
| 干净目录 `npm install` → `build` → `npm pack` | exit 0；19 条目 |
| 新 tgz 隔离安装后从安装包入口复跑集成 | **21/21，0 fail，0 skip** |
| 19 条目三方 SHA256 比对 | **0 / 19 mismatch** |
| 脚本编码门 | ps1 BOM ✅、vbs 纯 ASCII ✅、PS5.1 解析 0 error ✅ |
| CHANGELOG 重打包注明 | 「重打包（T6 收口 + ISSUE-1 修复）」 |
| 版本维持 `0.3.1-rc.1` + peer 精确 `0.1.7-rc.2` | 实测 |
| `ci.yml`/`release.yml` 与本地门禁一致 | §17.3 |

### FAIL

**无。** 本轮未观察到任何门禁失败。

### PENDING

| 项 | 原因 | 解除条件 |
|---|---|---|
| GitHub Actions 首轮结果 | 分支未推送 | **需开 PR 或推 main 触发**（直推 adapt 分支不触发，见 §17.1） |
| G2 Windows 实机（E6/V17 用新包重测） | 需 Agent C 用新包实机重测 | 交 Agent C 执行 |
| G4 发布/打 tag/回滚结论 | 依赖 G2 + CI | 见派发单 |
| 0.1.5-rc.1 旧版回归用例 | fixture 就绪但无用例 | 补用例；不构成双版本支持承诺 |

## 19. 边界声明（第 3 轮）

- 本轮**未发布、未打 tag、未改生产 profile、未动 HKCU**；`release.yml` 未触发。
- 本轮修改文件：`package.json`（`test:unit` 纳入新测试）、`CHANGELOG.md`（按派发要求注明重打包）、本证据文件（追加第 3 轮）。**第 1、2 轮原文未改动。**
- **未修改 `src/`、`scripts/`、`test/`**——`scripts/approval-toast.ps1` 与 `test/dialog.unicode-mapping.test.js` 的变更全部来自 windows 分支合并带入，非本轮直接编辑。
- 集成测试通知通道仍为 **mock spawn**；**真实 Toast / URI 点击属 G2（Agent C）范围**，本文件不作实机通过声明。
- **新包未经 Agent C 用新包复审 + 实机重测（E6/V17）前，不得称"验收通过"。**

## 20. 远端 CI：跨代码页修复后 G1 PASS（2026-09-30）

首轮 PR CI `760e5b4` 为 95/98，暴露 ANSI 映射对系统代码页的依赖；详见 [CI 分轮记录](./ci-first-run.md)。此失败不改写前述本机历史 PASS，但阻止复用旧候选签发。

Unicode 修复 commit `637163f667769307d02e68fdfa71f864a38d5b94` 的 [第二轮 Actions](https://github.com/xmwpoi/dsh-approval-center/actions/runs/36707444272) 已成功：`check` 安装/typecheck/build、98/98 单测、编码/语法门 PASS；`integration` 两版精确 fixture 安装 PASS，目标版 21/21 PASS，0 fail/skip。测试发生在远端 Windows runner；本机通知脚本测试因用户反馈提示音暂停。

这关闭了“CI 无首轮记录”的阻断，**不代替修改运行脚本后的新包 G2 实机复测**。新包 SHA/G3 记录及 C 签收见最新 [T7b 评估](./t7b-release-readiness.md)。
