# G1 本地自动门签发记录（Agent A）

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

## 4. PASS / FAIL / PENDING 汇总

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
