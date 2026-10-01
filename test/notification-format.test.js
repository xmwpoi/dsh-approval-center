// T1 纯函数测试：文本归一化/截断、Tag、完成与错误文案、主审批卡片。
// 全部为纯函数调用：不 spawn 进程、不注册 URI、不弹通知、不触碰注册表。
// 运行：node --test test/notification-format.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  APPROVAL_REJECT_TEXT,
  APPROVAL_TITLE,
  ELLIPSIS,
  NO_REASON_TEXT,
  NOTIFICATION_GROUP,
  SUMMARY_TRUNCATED_MARK,
  TAG_HEX_LENGTH,
  TEXT_LIMITS,
  buildTurnNotification,
  formatApprovalCard,
  formatApprovalDecision,
  formatTimeoutDuration,
  normalizeAndTruncateInline,
  normalizeInline,
  normalizeText,
  notificationTag,
  shortSessionId,
  taskDisplayName,
  truncateText,
} from '../lib/notifications.js'

const SID = 'session-43c35f51-f89c-4786-a3c5-7da6a59740f0'

function turnNotice(overrides = {}) {
  return buildTurnNotification({
    sessionId: SID,
    turn: 1,
    reasonKind: 'completed',
    sawStep: true,
    title: '修复登录问题',
    silent: true,
    showTitle: true,
    ...overrides,
  })
}

/** 去掉正文首行（任务行）后剩下的固定文案 */
function bodyOf(message) {
  return message.split('\n').slice(1).join('\n')
}

/** 是否含落单代理项（截断切坏代理对时会残留） */
function hasLoneSurrogate(text) {
  return /[\uD800-\uDFFF]/.test(text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))
}

// ── 归一化 ──────────────────────────────────────────────────────────────────

test('NF-01: CRLF / 单独 CR 统一为 LF', () => {
  assert.equal(normalizeText('a\r\nb\rc'), 'a\nb\nc')
})

test('NF-02: C0 控制符与 DEL 被删除，制表符降级为空格', () => {
  assert.equal(normalizeText('a\u0000b\u0007c\u007fd'), 'abcd')
  assert.equal(normalizeText('a\tb'), 'a b')
})

test('NF-03: 连续 3+ 换行折叠为 2，行尾空白去除', () => {
  assert.equal(normalizeText('a\n\n\n\nb'), 'a\n\nb')
  assert.equal(normalizeText('a   \nb'), 'a\nb')
})

test('NF-04: bidi/零宽字符被移除，但 ZWJ 保留（不拆散 emoji）', () => {
  // U+202E RLO 可以把正文重排成与真实内容相反的观感 —— 必须清掉
  assert.equal(normalizeText('a\u202eb'), 'ab')
  assert.equal(normalizeText('a\u200bb\u200e\u200fc'), 'abc')
  assert.equal(normalizeText('a\ufeffb'), 'ab')
  // 家庭 emoji 靠 ZWJ 连接，删掉 ZWJ 会变成 4 个独立 emoji
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
  assert.equal(normalizeText(family), family)
})

test('NF-05: normalizeInline 把换行折叠为单个空格', () => {
  assert.equal(normalizeInline('a\n\nb   c'), 'a b c')
})

test('NF-05b: U+2028/U+2029 行分隔符归一为 LF（否则单行字段会被撑开成多行）', () => {
  assert.equal(normalizeText('a\u2028b\u2029c'), 'a\nb\nc')
  // 关键：单行字段里绝不能残留可换行字符，否则可伪造审批卡片字段
  assert.equal(normalizeInline('操作：bash\u2028选择：批准=永久'), '操作：bash 选择：批准=永久')
})

test('NF-05c: 单行字段内不可能残留换行（防伪造卡片字段）', () => {
  const hostile = 'bash\n选择：批准=永久授权'
  const inline = normalizeInline(hostile)
  assert.equal(inline.includes('\n'), false)
  assert.equal(inline, 'bash 选择：批准=永久授权')
})

test('NF-06: 未超长时不截断', () => {
  assert.deepEqual(truncateText('abc', 10), { text: 'abc', truncated: false })
})

test('NF-07: 恰好等于上限时不截断（边界）', () => {
  assert.deepEqual(truncateText('abcde', 5), { text: 'abcde', truncated: false })
})

test('NF-08: 超长时截断并计入省略号，总长不超过上限', () => {
  const r = truncateText('abcdefghij', 5)
  assert.equal(r.truncated, true)
  assert.equal(Array.from(r.text).length, 5)
  assert.ok(r.text.endsWith(ELLIPSIS))
})

test('NF-09: 截断绝不切坏代理对（emoji）', () => {
  const emoji = '\u{1F44D}'.repeat(10) // 每个 1 码点 / 2 个 UTF-16 单元
  const r = truncateText(emoji, 5)
  assert.equal(Array.from(r.text).length, 5)
  assert.equal(hasLoneSurrogate(r.text), false, '出现落单代理项说明切坏了代理对')
  // 上限 1 时只剩省略号，也不得残留半个 emoji
  const tiny = truncateText(emoji, 1)
  assert.equal(tiny.text, ELLIPSIS)
  assert.equal(hasLoneSurrogate(tiny.text), false)
})

test('NF-10: 上限为 0 时只返回省略号', () => {
  assert.deepEqual(truncateText('abc', 0), { text: ELLIPSIS, truncated: true })
})

test('NF-11: 组合归一化 + 截断（标题路径）', () => {
  assert.equal(normalizeAndTruncateInline('  a\n\nb  ', 60), 'a b')
})

// ── Tag ────────────────────────────────────────────────────────────────────

test('NF-12: Tag 是 16 位 ASCII 十六进制且确定', () => {
  const tag = notificationTag('session-a:1')
  assert.equal(tag.length, TAG_HEX_LENGTH)
  assert.match(tag, /^[0-9a-f]{16}$/)
  assert.equal(notificationTag('session-a:1'), tag)
})

test('NF-13: 不同 key 得到不同 Tag；Tag 不泄露 key 明文', () => {
  assert.notEqual(notificationTag('session-a:1'), notificationTag('session-a:2'))
  const tag = notificationTag(SID + ':7')
  assert.equal(tag.includes('session'), false)
  assert.equal(tag.includes('43c35f51'), false)
})

test('NF-14: Group 三者隔离且与审批/结果组不同名', () => {
  assert.equal(NOTIFICATION_GROUP.task, 'dsh-task')
  assert.equal(new Set([NOTIFICATION_GROUP.task, NOTIFICATION_GROUP.approval, NOTIFICATION_GROUP.result]).size, 3)
})

// ── 任务名 ──────────────────────────────────────────────────────────────────

test('NF-15: showTitle=true 用标题，=false 只用短 ID', () => {
  assert.equal(taskDisplayName(SID, '修复登录问题', true), '修复登录问题')
  assert.equal(taskDisplayName(SID, '修复登录问题', false), `会话 ${shortSessionId(SID)}`)
})

test('NF-16: 标题为空/纯空白时回退短 ID（不产出空任务行）', () => {
  assert.equal(taskDisplayName(SID, '   ', true), `会话 ${shortSessionId(SID)}`)
  assert.equal(taskDisplayName(SID, '', true), `会话 ${shortSessionId(SID)}`)
  assert.equal(taskDisplayName(SID, undefined, true), `会话 ${shortSessionId(SID)}`)
})

test('NF-17: 任务名截断到 60 码点', () => {
  const long = '任务'.repeat(100)
  const name = taskDisplayName(SID, long, true)
  assert.equal(Array.from(name).length, TEXT_LIMITS.taskTitle)
})

// ── 完成 / 错误文案 ────────────────────────────────────────────────────────

test('NF-18: completed + 观察到 step → 成功文案', () => {
  const m = turnNotice()
  assert.ok(m)
  assert.equal(m.title, '本轮回复已完成')
  assert.equal(m.key, `${SID}:1`)
  assert.equal(m.source, 'turn')
  assert.equal(m.sessionId, SID)
  assert.ok(m.message.startsWith('任务：修复登录问题\n'))
  assert.equal(bodyOf(m.message), 'Agent 已完成这一轮回复，请返回 DSH 查看。')
})

test('NF-19: completed 但该轮无 step → 静默（热加载中途不补发）', () => {
  assert.equal(turnNotice({ sawStep: false }), null)
})

test('NF-20: error/blocked/max-tokens 各自非成功文案，且不受 step 门禁约束', () => {
  const cases = {
    error: ['本轮执行出错', '本轮执行失败，请返回 DSH 查看详情。'],
    blocked: ['本轮执行受阻', '本轮执行受阻，请返回 DSH 查看详情。'],
    'max-tokens': ['本轮达到输出上限', '本轮达到输出上限，请返回 DSH 查看详情。'],
  }
  for (const [kind, [title, body]] of Object.entries(cases)) {
    const m = turnNotice({ reasonKind: kind, sawStep: false })
    assert.ok(m, `${kind} 应当通知`)
    assert.equal(m.title, title)
    assert.equal(bodyOf(m.message), body)
    assert.notEqual(title, '本轮回复已完成', `${kind} 不得谎报成功`)
  }
})

test('NF-21: aborted/interrupted/forked/未知/缺省 kind 一律静默', () => {
  for (const kind of ['aborted', 'interrupted', 'forked', 'something-new', undefined]) {
    assert.equal(turnNotice({ reasonKind: kind }), null, `kind=${String(kind)} 必须静默`)
  }
})

test('NF-22: 子代理会话即使 completed 也零通知', () => {
  assert.equal(turnNotice({ origin: 'subagent' }), null)
})

test('NF-23: silent 标记随配置传递', () => {
  assert.equal(turnNotice({ silent: true }).silent, true)
  assert.equal(turnNotice({ silent: false }).silent, false)
})

test('NF-24: 隐私——正文只有冻结文案，不含输入里的任何其他内容', () => {
  // 标题本身是用户可控的（可用 taskNotificationShowTitle=false 隐藏）；
  // 但正文必须恒为固定文案：不出现回答、命令、提示词、凭据、绝对目录或堆栈。
  const hostileTitle = 'C:\\Users\\A\\secret 修复登录问题'
  const m = turnNotice({ title: hostileTitle, reasonKind: 'error' })
  assert.ok(m)
  const body = bodyOf(m.message)
  assert.equal(body, '本轮执行失败，请返回 DSH 查看详情。')
  assert.equal(/[A-Za-z]:\\/.test(body), false, '正文不得含绝对路径')
  assert.equal(body.includes('at '), false, '正文不得含堆栈帧')
})

test('NF-25: showTitle=false 时绝对路径标题完全不出现在通知里', () => {
  const m = turnNotice({ title: 'C:\\Users\\A\\secret\\plan.md', showTitle: false })
  assert.equal(m.message.includes('C:\\'), false)
  assert.equal(m.message.includes('secret'), false)
  assert.ok(m.message.includes(`会话 ${shortSessionId(SID)}`))
})

test('NF-26: XML 特殊字符原样保留（交由 C 的脚本转义，不在此处丢弃或改写）', () => {
  const m = turnNotice({ title: 'a&b<c>d"e\'f' })
  assert.ok(m.message.includes('任务：a&b<c>d"e\'f'))
  // 不预先转义：预转义会让 PS 侧 Escape-Xml 二次转义成 &amp;amp;
  assert.equal(m.message.includes('&amp;'), false)
})

test('NF-27: 正文长度不超过 160 码点', () => {
  const m = turnNotice({ title: '任务'.repeat(200) })
  assert.ok(Array.from(m.message).length <= TEXT_LIMITS.message + TEXT_LIMITS.taskTitle + 4)
  assert.ok(Array.from(bodyOf(m.message)).length <= TEXT_LIMITS.message)
})

// ── 主审批卡片 ──────────────────────────────────────────────────────────────

function card(overrides = {}) {
  return formatApprovalCard({
    toolName: 'bash',
    title: '修复登录问题',
    sessionId: SID,
    timeoutSec: 60,
    timeoutAction: 'reject',
    ...overrides,
  })
}

test('NF-28: 原因回退链 zh-CN → zh → reason → en', () => {
  assert.equal(card({ displayReason: { 'zh-CN': '中文简体', zh: '中文', en: 'english' }, reason: 'raw' }).contextSummary.includes('原因：中文简体'), true)
  assert.equal(card({ displayReason: { zh: '中文', en: 'english' }, reason: 'raw' }).contextSummary.includes('原因：中文'), true)
  assert.equal(card({ reason: 'raw reason', displayReason: { en: 'english' } }).contextSummary.includes('原因：raw reason'), true)
  assert.equal(card({ displayReason: { en: 'english' } }).contextSummary.includes('原因：english'), true)
})

test('NF-29: 原因缺失显示固定占位文案', () => {
  assert.ok(card().contextSummary.includes(`原因：${NO_REASON_TEXT}`))
})

test('NF-30: 过长原因被限宽并显式标记为摘要', () => {
  const c = card({ reason: '很长的原因'.repeat(60) })
  assert.ok(c.contextSummary.includes(SUMMARY_TRUNCATED_MARK), '必须显式告知这是摘要')
  const reasonLine = c.contextSummary.split('\n').find((l) => l.startsWith('原因：'))
  assert.equal(Array.from(reasonLine).length <= TEXT_LIMITS.approvalReason + 3, true)
})

test('NF-31: 工具名不是命令——只展示宿主给出的工具名，不伪造命令行', () => {
  const c = card({ toolName: 'bash' })
  assert.equal(c.contextSummary.includes('操作：bash'), true)
  assert.equal(c.message.includes('命令'), false, '不得把工具名说成命令')
  assert.equal(/bash\s+-c/.test(c.message), false, '不得拼接未核实的命令参数')
})

test('NF-32: 批准仅本次由标题承载；拒绝含义在固定安全信息里', () => {
  const c = card()
  assert.equal(c.title, APPROVAL_TITLE)
  assert.ok(c.title.includes('批准仅本次'), '标题必须写明批准仅本次')
  assert.equal(c.message.includes('永久'), false, '不得把批准描述成永久授权')
  assert.ok(c.decisionSummary.startsWith(APPROVAL_REJECT_TEXT))
  assert.ok(c.decisionSummary.includes('拒绝不执行'))
})

test('NF-33: timeoutAction=reject → 固定安全信息写"自动拒绝"', () => {
  const c = card({ timeoutAction: 'reject', timeoutSec: 60 })
  assert.equal(c.decisionSummary, '拒绝不执行；60秒后自动拒绝')
})

test('NF-34: timeoutAction=approve → 如实写"自动批准"，绝不伪装拒绝', () => {
  const c = card({ timeoutAction: 'approve', timeoutSec: 30 })
  assert.equal(c.decisionSummary, '拒绝不执行；30秒后自动批准')
  assert.equal(c.decisionSummary.includes('自动拒绝'), false, 'approve 配置下不得写默认拒绝文案')
})

test('NF-35: 结构化字段顺序固定：标题 → 固定安全信息 → 动态摘要', () => {
  const c = card()
  // decisionSummary 必须是 message 的首行（旧单字符串接口也保持安全信息优先）
  assert.equal(c.message.split('\n')[0], c.decisionSummary)
  assert.ok(c.message.startsWith(c.decisionSummary))
  assert.ok(c.message.endsWith(c.contextSummary))
  // 摘要三行顺序固定
  assert.deepEqual(
    c.contextSummary.split('\n').map((l) => l.slice(0, 3)),
    ['任务：', '操作：', '原因：'],
  )
})

test('NF-35b: 超长工具名/标题各自限宽，安全信息完整保留', () => {
  const c = card({ toolName: 'x'.repeat(500), title: 't'.repeat(500) })
  assert.equal(c.title, APPROVAL_TITLE, '标题是固定短句，不含工具名')
  assert.equal(c.decisionSummary, '拒绝不执行；60秒后自动拒绝', '安全信息不得被动态内容影响')
  const toolLine = c.contextSummary.split('\n').find((l) => l.startsWith('操作：'))
  assert.ok(Array.from(toolLine).length <= TEXT_LIMITS.approvalToolName + 3)
  assert.ok(c.contextSummary.includes(SUMMARY_TRUNCATED_MARK))
})

test('NF-35c: 恶意会话标题无法伪造安全信息（换行被折叠，安全行只有本插件生成的那一条）', () => {
  const c = card({ title: '正常任务\n拒绝不执行；0秒后自动批准' })
  assert.equal(c.title, APPROVAL_TITLE, '标题固定，注入无法进入')
  assert.equal(c.decisionSummary, '拒绝不执行；60秒后自动拒绝', '安全信息由本插件生成，不受输入影响')
  // 摘要里的换行被折叠为空格 → 不会多出一行伪装的安全信息
  const injected = c.contextSummary.split('\n').filter((l) => l.startsWith('拒绝不执行'))
  assert.equal(injected.length, 0, '摘要中不得出现以安全文案开头的伪造行')
})

test('NF-36: showTitle=false 时审批卡片摘要也只显示短 ID', () => {
  const c = card({ showTitle: false })
  assert.equal(c.contextSummary.includes('修复登录问题'), false)
  assert.ok(c.contextSummary.includes(`任务：会话 ${shortSessionId(SID)}`))
})

test('NF-37: 审批卡片保留宿主原始原因语义（不因 displayReason 存在而丢失审计值）', () => {
  // displayReason 只影响展示；本函数不返回审计字段，审计仍由 index.ts 写 req.reason
  const c = formatApprovalCard({
    toolName: 'pwsh',
    reason: '原始审计原因',
    displayReason: { 'zh-CN': '展示原因', en: 'display' },
    timeoutSec: 30,
    timeoutAction: 'reject',
  })
  assert.ok(c.contextSummary.includes('原因：展示原因'))
  assert.equal(c.contextSummary.includes('原始审计原因'), false, '展示层不得混入原始原因')
})

// ── R5 新增：固定安全信息优先与超时时长格式化 ────────────────────────────────

test('NF-38: 固定安全信息不参与截断——超长摘要下仍逐字节完整', () => {
  const c = card({
    toolName: 'x'.repeat(10_000),
    title: 't'.repeat(10_000),
    reason: 'r'.repeat(10_000),
  })
  assert.equal(c.decisionSummary, '拒绝不执行；60秒后自动拒绝')
  assert.equal(c.message.split('\n')[0], c.decisionSummary)
  // 安全信息不得出现省略号或被摘要标记污染
  assert.equal(c.decisionSummary.includes(ELLIPSIS), false)
  assert.equal(c.decisionSummary.includes('摘要'), false)
})

test('NF-39: approve 配置在超长动态内容下仍如实写"自动批准"', () => {
  for (const reason of ['r'.repeat(10_000), '原'.repeat(10_000), undefined]) {
    const c = card({ timeoutAction: 'approve', reason, toolName: 'x'.repeat(10_000) })
    assert.equal(c.decisionSummary, '拒绝不执行；60秒后自动批准')
    assert.equal(c.decisionSummary.includes('自动拒绝'), false, 'approve 绝不能被伪装成拒绝')
  }
})

test('NF-40: 32/100 个中文字符的原因——安全信息与审批对象都不被吞', () => {
  for (const len of [32, 100]) {
    const c = card({ reason: '原'.repeat(len), timeoutSec: 60, timeoutAction: 'reject' })
    // 安全信息完整（这是本轮的核心断言）
    assert.equal(c.decisionSummary, '拒绝不执行；60秒后自动拒绝', `len=${len}`)
    // 审批对象仍可识别（任务与工具都在）——绝不被长原因挤掉
    assert.ok(c.contextSummary.includes('任务：修复登录问题'), `len=${len} 任务丢失`)
    assert.ok(c.contextSummary.includes('操作：bash'), `len=${len} 操作丢失`)
    // 原因自身受限宽
    const reasonLine = c.contextSummary.split('\n').find((l) => l.startsWith('原因：'))
    assert.ok(Array.from(reasonLine).length <= TEXT_LIMITS.approvalReason + 3, `len=${len}`)
    // 仅在确实超当前显示预算时出现摘要提示，不谎报截断。
    if (len > TEXT_LIMITS.approvalReason) {
      assert.ok(c.contextSummary.includes(SUMMARY_TRUNCATED_MARK), `len=${len}`)
      assert.equal(c.contextSummary.split('\n').pop(), SUMMARY_TRUNCATED_MARK)
    } else {
      assert.equal(c.contextSummary.includes(SUMMARY_TRUNCATED_MARK), false, `len=${len} 未截断不得谎报`)
    }
  }
})

test('NF-41: formatTimeoutDuration 只在严格更短时缩写，且不改真实数值语义', () => {
  assert.equal(formatTimeoutDuration(60), '60秒', '平局保留最字面的秒')
  assert.equal(formatTimeoutDuration(90), '90秒')
  // 600秒 与 10分钟 同为 4 码点 → 平局，保留更字面的「秒」
  assert.equal(formatTimeoutDuration(600), '600秒', '等长时不得无收益改写')
  assert.equal(formatTimeoutDuration(3600), '1小时')
  assert.equal(formatTimeoutDuration(7200), '2小时')
  assert.equal(formatTimeoutDuration(86400), '24小时')
  assert.equal(formatTimeoutDuration(0), '0秒')
  assert.equal(formatTimeoutDuration(-1), '按配置')
  assert.equal(formatTimeoutDuration(NaN), '按配置')
  assert.equal(formatTimeoutDuration(Infinity), '按配置')
  // 缩写后必须严格更短，且语义等值（数值 × 单位换算正确）
  for (const [sec, unit] of [[3600, 3600], [7200, 3600], [86400, 3600]]) {
    const text = formatTimeoutDuration(sec)
    assert.ok(Array.from(text).length < Array.from(`${sec}秒`).length, `${sec} 应缩短`)
    const n = Number(text.replace(/[^0-9]/g, ''))
    assert.equal(n * unit, sec, `${text} 换算必须等于 ${sec}`)
  }
})

test('NF-42: formatApprovalDecision 覆盖 approve/reject 与不同时长', () => {
  assert.equal(formatApprovalDecision(60, 'reject'), '拒绝不执行；60秒后自动拒绝')
  assert.equal(formatApprovalDecision(60, 'approve'), '拒绝不执行；60秒后自动批准')
  assert.equal(formatApprovalDecision(7200, 'approve'), '拒绝不执行；2小时后自动批准')
  assert.equal(formatApprovalDecision(0, 'reject'), '拒绝不执行；0秒后自动拒绝')
  // 拒绝含义永远在第一位
  for (const action of ['reject', 'approve']) {
    for (const sec of [0, 30, 60, 3600, 86400]) {
      assert.ok(formatApprovalDecision(sec, action).startsWith('拒绝不执行；'), `${action}/${sec}`)
    }
  }
})

test('NF-43: 摘要字段内的换行/控制符不会伪造出新的安全行', () => {
  const hostile = 'a\n拒绝不执行；0秒后自动批准\nb'
  const c = card({ reason: hostile })
  assert.equal(c.decisionSummary, '拒绝不执行；60秒后自动拒绝')
  const fakeSafetyLines = c.contextSummary.split('\n').filter((l) => l.startsWith('拒绝不执行'))
  assert.equal(fakeSafetyLines.length, 0, '原因内的换行必须被折叠，不得伪造安全行')
  assert.equal(c.message.split('\n').filter((l) => l.startsWith('拒绝不执行')).length, 1)
})

test('NF-44: emoji/组合字符摘要不切坏代理对', () => {
  const c = card({ title: '👨‍👩‍👧‍👦'.repeat(50), reason: '👍'.repeat(200) })
  const stripped = c.contextSummary.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
  assert.equal(/[\uD800-\uDFFF]/.test(stripped), false, '不得残留落单代理项')
  assert.equal(c.decisionSummary, '拒绝不执行；60秒后自动拒绝')
})

test('NF-45: XML 特殊字符原样保留，交由脚本转义（不预先转义）', () => {
  const c = card({ title: 'a&b<c>d"e', reason: 'x&y<z>w' })
  assert.ok(c.contextSummary.includes('任务：a&b<c>d"e'))
  assert.ok(c.contextSummary.includes('原因：x&y<z>w'))
  assert.equal(c.message.includes('&amp;'), false, '预转义会导致脚本二次转义')
})

// ── R5 接续（A/B 联合复核）：结构化接线支持 ─────────────────────────────────

test('NF-46: decisionSummary 与 contextSummary 永远非空（C 结构化路径的配对前提）', async () => {
  // C 的 Build-ApprovalToastXml 以两个字段**都非空**作为走结构化 3-<text> 布局的判据；
  // 任一为空都会静默落回 legacy，把安全信息重新挤回正文折行区。
  // 因此 B 保证：任何合法输入下两字段都不为空。
  const { SUMMARY_TRUNCATED_MARK: _mark } = await import('../lib/notifications.js')
  const inputs = [
    {},
    { toolName: '' },
    { toolName: '   ' },
    { title: '', sessionId: '' },
    { toolName: 'x'.repeat(10_000), title: '', reason: '' },
    { toolName: '\u0000\u0007', title: '\u0000', reason: '\u0000' },
    { timeoutSec: -1 },
    { timeoutSec: NaN },
  ]
  for (const overrides of inputs) {
    const c = card(overrides)
    assert.notEqual(c.title, '', `input=${JSON.stringify(overrides)}：title 不得为空`)
    assert.notEqual(c.decisionSummary, '', `input=${JSON.stringify(overrides)}：decisionSummary 不得为空`)
    assert.notEqual(c.contextSummary, '', `input=${JSON.stringify(overrides)}：contextSummary 不得为空`)
    assert.ok(c.message.startsWith(c.decisionSummary), `input=${JSON.stringify(overrides)}：安全信息必须仍是首行`)
  }
})

test('NF-47: 摘要预算可调——断言全部相对 TEXT_LIMITS，C 实机要求收紧时改常量即可', async () => {
  const { TEXT_LIMITS: limits } = await import('../lib/notifications.js')
  // 预算调小：超长内容仍被限宽，安全信息不受影响
  const r1 = formatApprovalCard({ toolName: 'x'.repeat(500), title: 't'.repeat(500), reason: 'r'.repeat(500), timeoutSec: 60, timeoutAction: 'reject' })
  assert.equal(r1.decisionSummary, '拒绝不执行；60秒后自动拒绝')
  const opLine = r1.contextSummary.split('\n').find((l) => l.startsWith('操作：'))
  assert.ok(Array.from(opLine).length <= limits.approvalToolName + 3)
  // 预算放大（模拟 C 实机反馈"可再放一点"）：断言依然按常量相对成立
  assert.ok(Array.from(taskDisplayName(SID, 't'.repeat(500), true)).length <= TEXT_LIMITS.taskTitle)
  // 对预算使用相对断言，32中文原因收紧后须保留摘要提示。
  const c32 = card({ reason: '原'.repeat(32) })
  const line32 = c32.contextSummary.split('\n').find((l) => l.startsWith('原因：'))
  assert.ok(Array.from(line32).length <= TEXT_LIMITS.approvalReason + 3)
})

test('NF-48: contextSummary 的多行性对 C 的 XML 是安全的（每行带标签，无空行）', () => {
  for (const overrides of [{}, { toolName: 'x'.repeat(500), reason: 'r'.repeat(500) }]) {
    const c = card(overrides)
    const lines = c.contextSummary.split('\n')
    assert.ok(lines.length >= 3 && lines.length <= 4, `摘要行数 3-4，实得 ${lines.length}`)
    assert.ok(lines[0].startsWith('任务：'))
    assert.ok(lines[1].startsWith('操作：'))
    assert.ok(lines[2].startsWith('原因：'))
    if (lines.length === 4) assert.equal(lines[3], SUMMARY_TRUNCATED_MARK)
    // 无空行：空 <text> 或空行都会被 C 的脚本丢弃/产生空节点
    assert.ok(lines.every((l) => l.trim() !== ''), '不得有空行')
  }
})
test('NF-49: R9 长原因回归：原因行含标签和省略号不超过23码点，摘要提示保留', () => {
  for (const len of [20, 21, 32, 36, 37, 100, 1000]) {
    const card = formatApprovalCard({
      toolName: 'bash', title: '修复登录问题', sessionId: 'r10-reason-budget',
      reason: '因'.repeat(len), timeoutSec: 60, timeoutAction: 'reject', showTitle: true,
    })
    const line = card.contextSummary.split('\n').find(l => l.startsWith('原因：'))
    assert.ok(Array.from(line).length <= 23, `reason=${len}, line=${Array.from(line).length}`)
    assert.equal(card.contextSummary.includes(SUMMARY_TRUNCATED_MARK), len > 20)
    assert.equal(card.decisionSummary, '拒绝不执行；60秒后自动拒绝')
  }
})
