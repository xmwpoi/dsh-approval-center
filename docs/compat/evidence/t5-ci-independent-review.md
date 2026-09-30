# CI 独立复核报告（Agent B，2026-09-30，Unicode 候选轮）

任务来源：`dsh-approval-center-017-unicode-next-dispatch.md` → Agent B（只读复核远端 CI）。
复核对象：GitHub 仓库 `xmwpoi/dsh-approval-center` 的两轮 CI 运行、PR #2 检查状态、以及运行 commit 的静态审查。全程只读：未推送任何分支、未触发 release workflow、未运行本地 wscript/真实 Toast。
本地复核分支：`D:\codex\dsh-approval-center-B` 的 `adapt/dsh-017-t5-review`（新增本报告与 commit，不推主分支）。`gh` 已认证（xmwpoi），API 与日志直读。

## 1. 两轮 CI 运行核对（API 实测）

| Run | head_sha | 结论 | jobs | 计数（日志实读） |
|---|---|---|---|---|
| 36707444272（第二轮，修复 commit） | `637163f6`（=`637163f667769307d02e68fdfa71f864a38d5b94` ✓） | success | check + integration 均 success | check：tests 98 / pass 98 / fail 0 / skipped 0；integration：tests 21 / pass 21 / fail 0 / skipped 0（另 todo 0 / cancelled 0） |
| 36708669093（最新，候选证据 commit） | `d642c225`（=`d642c225dcf5a004a88a4bd164105fb13db38cab` ✓） | success | check + integration 均 success | check：98/98/0/0；integration：21/21/0/0 |

- 两轮事件均为 `pull_request`、分支 `adapt/dsh-017-host`、run_attempt 1（无重跑洗白）。
- **首轮失败如实保留**：run 列表显示 `760e5b41`（09-30 10:46）conclusion=failure，未被删除或改写——与派发包"首轮 95/98 FAIL 如实保留"一致。
- **PR #2**：head `d642c225`，两项 check（check、integration）COMPLETED/SUCCESS，`isDraft: true` —— 与"PR 保持 Draft、未发布"一致。

三个 commit（`637163f` / `77cd166` / `d642c22`）均存在于本地主仓对象库，链路与派发包一致；`d642c22` 仅补证据文档，入包 src/scripts 无变化（diff 核实）。

## 2. fixture 强制门 / 旧版仅观察（d642c22 的 ci.yml 实读）

- `integration` job（windows-latest、Node 24）：`npm ci` → `build` → **"install exact DSH 0.1.7-rc.2 test fixture (mandatory)"**——`npm ci --ignore-scripts` 后逐包断言 `dsh-llm/dsh-scope/dsh-session/dsh-user-approval` 的 version 必须严格等于 `0.1.7-rc.2`，否则 throw（版本漂移即红）→ `npm run test:integration`。目标版是硬门。
- 旧版 fixture 步骤名为 **"(observation only)"** 且 `continue-on-error: true`；`test:integration` 脚本只含 `approval-flow` + `lifecycle` 两个文件（实读 d642c22 的 package.json），旧版用例（B 的 `legacy-015-observe.test.js`）未被并入门禁——**旧版仅观察形态成立**，peer 声明不受影响。
- `test:unit` 为显式 8 文件列表（含新增 `test/dialog.unicode-mapping.test.js`），人工 `test/approval.test.js` 不在任何自动门内。

## 3. VBS 测试异步判定与拒绝日志（静态审查，1d7d2a8→637163f diff）

`runVbs` 由 spawnSync（GUI 进程句柄挂起风险）改为异步 `spawn` + 50ms 结果文件轮询 + 10s 死限 + 进程回收（kill/unref）。**安全判据是收紧而非放松**：

- 负向用例（非法 id / 非法 decision）：必须等到处理器进程退出 **且** 调试日志（`DSH_APPROVAL_DEBUG_LOG`）出现 `accepted=False` 才判定通过——旧的"等 1.5s 没文件"式判定可能把"处理器还没来得及写"误判为拒绝；新判据要求处理器自证拒绝。
- 正向用例：结果文件首行必须与 URI 中的 decision 精确相等。
- 原有安全语义全部保留：非法 id（路径穿越/非 hex/超长/%00）不写任何文件；**相对路径映射不可信、回落默认目录**；映射夹具改为带 BOM 的 UTF-16 LE（与脚本运行时一致），`<id>.dir` 仅接受盘符/UNC 根路径。

`637163f` 对 scripts 的修复（映射文件统一 UTF-16 LE+BOM；VBS 以 Unicode 打开并剥离 `U+FEFF`；PS/.NET 显式 `Encoding.Unicode` 读写）方向正确：不再依赖宿主代码页，中文+空格 StateDir 在英文 runner 上可表示。src/ 零变化（包运行逻辑只在脚本层）。

## 4. release.yml 静态审查

- **tag/version 校验**：发布前 `Verify tag matches package version`——`package.json` version 加 `v` 前缀与 `github.ref_name` 做**大小写敏感**（`-cne`）全等比较，不符即 throw。
- **发布前自动门与 CI 同级**：typecheck → build → test:unit → 强制 0.1.7-rc.2 fixture 安装（带同款版本漂移断言）→ `test:integration`。tag 触发的 release 会重跑全部自动门，不是只 build/pack。
- **RC prerelease**：`if ($tag -match '-') { --prerelease }` —— `v0.3.1-rc.1` 含 `-`，将自动标 prerelease，符合 contract-017 §7/计划书要求。
- `npm pack` 后校验 tarball 七个必需条目（lib 入口/声明、cordis.patch.yml、三个 ps1/vbs 脚本）；npm publish 保持注释未启用（无需 npm 账号，Release 附件分发）。
- 小备忘（非阻断）：ci.yml 的字节级编码门（PS1 BOM / VBS 纯 ASCII 逐字节断言）未在 release.yml 重复出现——release 仍会经 `test:unit` 的 `dialog.scripts.test.js`（`assertScriptsUsable` 运行时校验）覆盖 BOM/ASCII/语法，但严格度略低于 CI 的逐字节门。PR 合并前 CI 必绿即可覆盖此差异；若未来 release 可脱离 CI 单独触发，建议把编码门同步进 release.yml。

## 5. 结论与边界

- **PASS**：两轮 run 的提交、结论、计数（98/98、21/21、0 fail/skip）与派发包陈述完全一致；首轮失败保留；PR #2 双检查 SUCCESS 且维持 Draft。
- **PASS**：目标版 fixture 强制门带版本漂移断言；旧版 fixture 明确"观察 only"，未入门禁、不影响 peer。
- **PASS**：VBS 测试异步化的判定更严格，拒绝路径需处理器日志自证；映射安全判据（根路径校验、相对路径不可信）完整保留。
- **PASS**：release.yml 具备 tag/version 校验与 RC prerelease 标注，发布前重跑同级自动门。
- **边界**：本复核只读远端 CI 与静态代码；未复验候选 tgz SHA `7002324BF8B19749...`（归 C 的实机入口），未宣称 G1/G2/G3 任何一门签收；GitHub CI 首轮（95/98）失败细节未逐条追（其保留状态已核实，修复后的两轮已绿）。
