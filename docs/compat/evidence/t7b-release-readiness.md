# T7b 发布就绪评估（Agent A）

日期：2026-09-30。前置：G1 签发记录见 [g1-automatic-gate.md](./g1-automatic-gate.md)。
**结论：候选包技术就绪，但 G2（Windows 实机验收）未执行——T7b 不能签发，禁止发布/打 tag/上生产。**

## 1. 门禁状态

| 门 | 状态 | 证据 |
|---|---|---|
| G0 契约冻结 | **PASS** | docs/compat/contract-017.md（e5ace51 起，含修正记录） |
| G1 本地自动门 | **PASS**（2026-09-30 复跑） | typecheck/build PASS；**test:unit 93/93、0 skip**（含 wscript 实执行 U-vbs/01–06 与 U-ps/01–06）；**test:integration 21/21、0 skip**（fixture 精确 0.1.7-rc.2）；commit `bd6baf5` |
| G2 Windows 实机（V01–V20 实机部分） | **未执行（阻断）** | `D:\codex\dsh-approval-center-c-t6\evidence\T6-results.md` 为**空白模板**；`install/`、`logs/`、`data-dir/` 均为空。C 已完成：URI/AUMID 进入时双份备份（11:40、12:59）、环境基线（env-baseline.md）、恢复脚本待按交接单修订为显式备份路径 |
| G3 包内完整性与干净安装 | **PASS**（2026-09-30 复验） | 候选 tgz SHA256 `7ce7acad…819d` 与交接单一致；13/13 打包文件齐全（lib 五模块、四脚本、cordis.patch.yml、文档）；`lib` 与 HEAD 构建产物逐字节一致；全新隔离目录 `npm i` 成功、入口 import 正常、Config schema 识别为 object |
| G4 升级/卸载/回滚 | **PENDING** | 依赖 T6 S13（回滚与恢复）实机证据；操作清单已备（见 §3） |
| GitHub Actions | **PENDING** | 分支 `adapt/dsh-017-host` 未推送 origin，CI 无首轮记录；发布前必须补齐 |

## 2. 候选包固定信息（供 T6/T7 引用）

- 插件 commit：`1d7d2a867850cf43306458acc46c83e14cf8258a`（adapt/dsh-017-host）
- 版本：`0.3.1-rc.1`；peer 精确 `@deepseek-ai/dsh: 0.1.7-rc.2`
- 候选 tgz：`D:\codex\dsh-approval-center-0.3.1-rc.1.tgz`
- SHA256：`7CE7ACAD984B1FF642D30D3CA6112BD5C6A3AA24CFA98E46B554F7A9FACF819D`
- README/CHANGELOG 已按"未发布候选、实机验收进行中"口径撰写（T7a，`1d7d2a8`）——口径与实际状态一致，T6 通过后才允许改写。

## 3. 回滚与升级资料（待 T6 实测确认）

- 存储层：`docs/compat/drafts/store-and-rollback.md`（同 dataDir 单实例锁、升级前停旧实例、WAL 一致性备份要点）。
- 操作清单：`2fc4a25` 合入的升级/WAL 备份/回滚清单（备份命令 Node 24 实测）——**文档级就绪，安装/验证/回滚逐步执行记录必须由 T6 产生**。
- 兼容范围声明：本轮只声明 `0.1.7-rc.2`；0.1.5-rc.1 fixture 已就绪但**无旧版回归用例**，不得承诺双版本支持。

## 4. 解除阻断所需（按派发单 §4 原文执行）

1. C 取得独占 Windows 时段，核对候选 tgz SHA 后按 `D:\codex\dsh-approval-center-c-t6\runbook.md` S1–S14 执行，**先把 restore-uri.ps1 改为接收显式备份路径**（禁止按文件名选"最新"快照）。
2. C 填写 `T6-results.md` 的 S1–S14 与 V01–V20 映射、恢复自检（URI/AUMID 逐值比对进入时值）、每项证据文件路径。
3. A 收到 T6 证据后：审阅每条 → 核对 G2 → 若有修复则重打包/新 SHA/受影响项重测 → 更新 README/CHANGELOG 验收结论 → 签发 G2/G4，T7b 才能转为"就绪"。
4. 发布前还须：CI 首轮结果（推送分支触发）、候选安装/回滚结论、用户发布决定。**这些齐备前不发布、不打 tag、不改生产 profile。**

## 5. 现阶段允许对外声明的话术

- 允许："目标版（0.1.7-rc.2）真实宿主非交互集成 21/21 通过；完整单测 93/93 通过；候选包干净安装烟测通过。"
- 不允许："实机验收通过 / 已发布 / 支持 0.1.5 / 可以上生产。"（T6 未执行，G2/G4 无证据）
