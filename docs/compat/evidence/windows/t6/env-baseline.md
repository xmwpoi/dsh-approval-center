# T6 环境基线（Agent C，2026-09-30）

## 一、测试前 URI 注册值（逐字）

```
"C:\Windows\System32\wscript.exe" //B //Nologo "D:\codex\dsh-approval-center\scripts\approval-uri-handler.vbs" "%1"
```

## 二、⚠️ 漂移记录

- 2026-09-29 只读探针时，该全局 URI 注册指向**生产路径**：
  `C:\Users\A\.dsh\profiles\web\node_modules\dsh-approval-center\scripts\approval-uri-handler.vbs`
- 2026-09-30 备份时已变为上述**共享克隆路径**（`D:\codex\dsh-approval-center\scripts\approval-uri-handler.vbs`）。
- 结论：期间有其他 agent 修改过全局注册。
- 恢复目标 = 用户拍板的"测试前值"，即本文件第一节的**共享克隆路径**。
- 生产原始值另行记录于 runbook §4，不作为本次恢复目标。

## 三、AUMID 基线

- AUMID：`Dev.DSH.ApprovalCenter`
- DisplayName：DSH 审批中控台

## 四、通知中心基线

- AUMID history = 0 条（测试前通知中心对该 AUMID 无历史记录）

## 五、系统环境

| 项目 | 值 |
| --- | --- |
| Windows Build | 26100（OS 10.0.26200） |
| PowerShell | 5.1.26100.9168（System32，无 pwsh） |
| wscript.exe | 在位 |
| VBScript 引擎 | 可用（烟囱探针通过） |
| Node | v24.20.0 |
| pnpm | 12.3.4 |
| git | 2.54.0 |

## 六、备份文件清单

| 文件 | 说明 |
| --- | --- |
| `backup/dshapproval-20260930-114010.reg` | URI 注册导出备份 |
| `backup/aumid-20260930-114010.reg` | AUMID 注册导出备份 |
| `backup/prod-plugin-package.json` | 生产插件 v0.3.0 只读备份 |

## 七、隔离手段四件套

1. **DSH_HOME** → `dsh-home\`（隔离用户主目录）
2. **插件 dataDir** → `data-dir\`（隔离插件数据目录）
3. **URI 切换** → `use-test-uri.ps1`（切换前自动存 uri-before 快照到 `evidence\`）
4. **恢复** → `restore-uri.ps1`（重导入最新 .reg + 自检比对 runbook §0 值）

## 八、环境红线

- 不写 `C:\Users\A\.dsh`
- 不动 `D:\dsh-web-dev`、`D:\dsh-title-dev`
- 测试期批准仅用于可撤销操作

---

## 采集说明

采集命令：`reg export`、`reg query`、`powershell History.GetHistory`、各工具 `--version`。
以上采集过程全部为只读操作，未对系统做任何修改。
