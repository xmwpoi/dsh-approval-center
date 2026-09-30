# Unicode 候选包实机复测与 G2 签收（Agent C，2026-09-30）

执行依据：`D:\codex\dsh-approval-center-017-unicode-next-dispatch.md` §Agent C。
本轮为**新 SHA 重新签 G2**；不替代、不覆盖 `T6-results.md` 各历史轮次。

## 0. 结论

**G2（Unicode 候选包实际签收范围）：PASS — 5/5 用例 PASS，0 FAIL，0 新增 PENDING。**
签收对象：`D:\codex\dsh-approval-center-unicode-candidate\dsh-approval-center-0.3.1-rc.1.tgz`
SHA256 `7002324BF8B19749BAC058FB18306711FC76F0DB3FE7A6C1EAF4BCEC0F6ACB4A`（实测一致）。

仍属全项目 PENDING（非本轮产生、不阻断本轮签收）：V16 真实子代理会话（无凭据）、大批次实机、生产回装 0.3.0 演练、CI 首轮已于远端 PASS（run 36707444272 / 36708669093）。

## 1. 固定输入与环境

| 项 | 值 |
|---|---|
| 候选包 SHA256 | `7002324B…C0F6ACB4A`（实测 = 派发单） |
| 构建/修复 commit | 包构建 `77cd166a…`，运行修复 `637163f6…`（主仓 HEAD `d642c22` 仅证据提交） |
| version / peer | 0.3.1-rc.1 / `@deepseek-ai/dsh: 0.1.7-rc.2` |
| 修复方案核验（解包只读） | `approval-toast.ps1:319` 映射写 `[System.Text.Encoding]::Unicode`；VBS `OpenTextFile(…,-1)`（TristateTrue）+ 去 BOM 字符；PS handler 与 `Get-MarkerDir` 均 `ReadAllText(…, Encoding.Unicode)` |
| 宿主 / OS / PS / Node | 0.1.7-rc.2（隔离完整宿主，含 peers）/ Windows 10.0.26200 x64（Build 26100）/ 5.1.26100.9168（System32）/ v24.20.0 |
| 时段 | 2026-09-30 19:39–19:52（用户确认的独占桌面时段） |
| 进入时备份 | `backup\dshapproval-entry-20260930-193952.reg` + `aumid-entry-20260930-193952.reg`（进入时值=生产路径 `C:\Users\A\.dsh\profiles\web\...`） |
| 安装 | 隔离 `c-t6\dsh-home` profile web，`plugin add` 新 tgz，version 0.3.1-rc.1 实测 |

## 2. 用例结果

| # | 用例 | 结果 | 证据要点 |
|---|---|---|---|
| U1a | 中文+空格 StateDir approve（VBS 主路） | **PASS** | exit 0；映射文件头 2 字节 `FF FE`（UTF-16 LE BOM，运行中实抓）；结果落映射目录并自清 |
| U1b | 中文 StateDir reject（VBS 主路） | **PASS**（重跑轮） | 首跑被真人抢先点击批准（exit 0）+ 我方 reject 激活迟到成孤儿回落（内容 `reject`@19:40:15，已实证并清理）；快速重跑 exit 1，映射目录命中且自清 |
| U2 | 同路径改 PS 回退处理器 approve | **PASS** | exit 0；切换前后注册证据 `logs/unicode-uri-{vbs,ps}-active.txt`；映射目录自清、默认目录无孤儿 |
| U3 | ASCII StateDir 回归 | **PASS** | exit 0；映射 `FF FE` 核验；自清、无孤儿 |
| U4 | 强杀 → 残留 → 定向清理（中文映射目录命中） | **PASS** | 0.6s 击杀 → `.pending`+toast 双残留 → `-CleanupToken`（`Get-MarkerDir` 经 UTF-16 映射命中中文目录）→ 文件 0 残留 + `TOAST_REMOVED_BY_CLEANUP`，exit 0；重复清理幂等 exit 0 |
| U5 | URI/AUMID 逐值恢复 + 只清本人 | **PASS** | `restore-uri.ps1` SELF-CHECK PASS + 独立 `reg query` 佐证（生产路径逐字一致）；通知中心 dsh-approval 组=0、总数 11 与进入时一致（3 条基线 + 8 条此前无法归属回执，未动）；本人 6 个 token 状态文件双目录零残留；测试安装已卸载 |

## 3. 说明与边界

- **真人干扰如实记录**：桌面真人在 toast 弹出后数秒内点击批准（U1a、U1b 首跑）。U1b 首跑的"exit 0"是真人决策而非 reject 路径失效——孤儿回落文件内容（reject@19:40:15）与我的激活时间线互相印证；重跑以 1.5s 快速激活抢前，取得干净 exit 1。**reject 经 VBS 主路径在中文映射目录下的正确性由重跑轮确立。**
- 协议激活 = Windows 处理 toast 按钮点击的同一 ShellExecute 路径（同 T6-results.md §5.4 方法声明）。
- 全程未动生产 profile/DB、未用生产凭据；唯一注册写操作为测试 URI 切换（已逐值恢复）。
- 日志：本目录同级 `c-t6\logs\unicode-uri-*.txt`、`c-t6\evidence\entry-backup-ts-unicode.txt`。

## 4. 签收

- 签署人：Agent C
- 范围：上列 5 用例 + §0 声明的 PENDING 边界；不构成大批次/生产回装/V16 的完成声明。
