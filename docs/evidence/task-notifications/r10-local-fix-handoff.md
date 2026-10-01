# R10 主对话定向修复交接

## 来源与实际完成

用户授权：“我批准你读取agentc的内容直接在本对话内进行修改”。读取C的R9生产formatter实机报告（commit3acb61d），在A既有干净树中直接修复；没有启动内部代理，没有修改B/C/D树。

source：`6f875cb98946162a6e2b8082d2df0c08718637d6`，分支`adapt/dsh-018-notify-a`，本地已提交，未push。
父HEAD：`9c496f373c80414444e0d038819c4ba62311127e`。

唯一新候选：`D:\codex\r10-local-fix\build-a\dsh-approval-center-0.4.0-rc.1.tgz`。
副本：`D:\codex\r10-local-fix\build-b\dsh-approval-center-0.4.0-rc.1.tgz`。
完整SHA256：`BCE6E51DEC67774C9DB47E1BD8D25ED6699FB4AA8A9FF23249CFD07D6DF1C6F3`。
大小：**90288 B**。
旧AF92候选因原因截断提示FAIL不能发布；所有历史包/worktree保留，未删除覆盖。

## 修改范围

- `src/notifications.ts`：approvalReason **36→20**。truncateText已把省略号计入预算，原因行连“原因：”最多23码点；不是20字再额外加省略号。
- `lib/notifications.js`、`lib/notifications.d.ts`：重新构建同步。
- `test/notification-format.test.js`：新增NF-49，20/21/32/36/37/100/1000字符，检查显示行预算、正确摘要标记、安全decision完整；更新过期预算注释。
- `test/integration/approval-card-line-budget.test.js`：B-5由“必须保留36码点”改为20边界及长原因含标签≤23、省略号/提示保留；仍不声称像素证明。
- `docs/design/task-notification-contract.md`：20/20/20显示预算及省略号计入；删除“逻辑预算内⇒用户可见”的错误推导。
- `CHANGELOG.md`：真实两text布局与20原因摘要，标明最终包像素复验尚待完成。

只改变卡片显示摘要；index审计仍`reason: req.reason ?? ''`，原始请求原因不被此预算截断。批准范围、timeout动作、字段接线、队列/卸载、参数门、退出码、PS/URI/token全部未修改。不引入attribution布局、新依赖或像素测量引擎。

## 实际验证

1. NF-49先对旧36预算运行：1fail，`reason=21, line=24`；修改预算+build后1pass。测试不是编译或探针错误导致红灯。
2. 沙箱首轮`npm test`：typecheck/build成功，unit **275pass/7fail/0skip**（282项）。7项均既有wscript/VBS超时，集成因unit失败未运行。日志保留：`D:\codex\r10-local-fix\npm-test.log`。
3. 经自动权限审批在正常桌面执行同树`npm test`：**unit282/282、integration117/117，0fail/0skip**；typecheck/build成功。7个VBS用例全部转绿。日志：`D:\codex\r10-local-fix\npm-test-desktop.log`。真实URI处理器测试使用仓库隔离状态目录；审批/任务投递由mock拦截，本轮未投递Toast或操作HKCU注册。
4. `git diff --check`通过；修复提交前工作树干净，提交只含上述7文件。
5. 两个新detached源码worktree从source构建；**共用A既有node_modules只读目录junction**，不是两次独立npm ci。`npm run build`+`npm pack`，两包hash完全相同。初次pack默认npm-cache受沙箱限制EPERM，改用各自D盘cache成功；未修改系统cache配置。
6. 解包候选，`node D:\codex\r10-local-fix\verify-package.mjs`：**21/21入包文件与build-a源码/构建逐字节一致**，两tgz同hash；toast两脚本BOM+CRLF、handlers ASCII+CRLF；读取包内formatter确认预算20，导出14份生产夹具。
7. verifier第一版错误要求所有PS1都有BOM，ASCII URI-handler因此失败；按仓库规则修正为两个toast脚本BOM、两个handler ASCII后通过。是验证脚本缺陷，不是包缺陷，未改handler。

## 复验入口

```powershell
git -C 'D:\codex\dsh-notify-A' show --stat 6f875cb98946162a6e2b8082d2df0c08718637d6
Get-FileHash -Algorithm SHA256 -LiteralPath 'D:\codex\r10-local-fix\build-a\dsh-approval-center-0.4.0-rc.1.tgz'
node 'D:\codex\r10-local-fix\verify-package.mjs'
# 完整自动门在A目录：npm test；wscript用例需正常桌面权限。
# 不单独无hook运行集成；package.json的test:integration已包含正确--import。
```

实际包解包：`D:\codex\r10-local-fix\unpack\package\`。
生产formatter夹具：`D:\codex\r10-local-fix\formatter-fixtures.json`（14例）由包内lib直接生成，非手工context。
verifier：`D:\codex\r10-local-fix\verify-package.mjs`。
新build目录/cache/log/包均保留；未清理。

## 下一步与所需协同

用户确认本交接验收后：B/D并行对**新source+新SHA**独立复核。各自遵守既有TASK范围与删除限制，不写A树；不要用AF92绿结果代替本包签收。优先审预算改变对截断标记、20/21边界、emoji、真实approve/reject文案、原始审计原因的影响；PS未变但参数门需核保留。远端CI本轮未触发，由A后续协同推送/记录，不冒称CI已绿。

B交`D:\codex\dsh-notify-B-r9\HANDOFF-agent-b-r10-wiring-signoff.md`；D交`D:\codex\dsh-notify-D\docs\evidence\task-notifications\r10-package-signoff.md`。

两份经用户验收后，C在**新获准独占静音窗口**按包内formatter复验20/21/32/36/37/100/1000原因、长任务/工具名、approve/reject/真实timeout文案；固定安全行、对象、原因摘要、截断提示必须实际可见。不以≤23码点推导像素PASS；当前100%测量不能外推125/150%。新包布局证据重新拍，旧SHA布局PASS不得迁移。
C交`D:\codex\dsh-notify-C\docs\evidence\task-notifications\r10-final-windows-results.md`，D再审证据交r10-final-evidence-signoff.md，然后A/主代理完成最终发布评估。M7此前只证明条目在列时，不能外推所有新卡片展开态安全/摘要字段可见；按实际新截图记录。

## 未完成与权限边界

- 新包像素验收仍PENDING，当前只是已实现最小候选修复，不宣布实机问题已闭合。
- 新source远端CI、B/D独立签收未完成。
- 125/150%DPI、真实child委派、生产模型体验未测，不外推。
- 没有push、merge、tag、Release、生产升级；没有删除文件/worktree/旧包/通知或修改注册表。
- 本地branch比远端多本修复及后续docs-only交接；其他agent开始前必须以具体source而非旧远端HEAD为准。
