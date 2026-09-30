// T1 纯函数测试：文本归一化/截断、Tag、完成与错误文案、主审批卡片。
// 全部为纯函数调用：不 spawn 进程、不注册 URI、不弹通知、不触碰注册表。
// 运行：node --test test/notification-format.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  APPROVAL_CHOICE_TEXT,
  ELLIPSIS,
  NO_REASON_TEXT,
  NOTIFICATION_GROUP,
  REASON_TRUNCATED_MARK,
  TAG_HEX_LENGTH,
  TEXT_LIMITS,
  buildTurnNotification,
  formatApprovalCard,
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
  assert.equal(
    card({ displayReason: { 'zh-CN': '中文简体', zh: '中文', en: 'english' }, reason: 'raw' }).message.includes('原因：中文简体'),
    true,
  )
  assert.equal(
    card({ displayReason: { zh: '中文', en: 'english' }, reason: 'raw' }).message.includes('原因：中文'),
    true,
  )
  assert.equal(card({ reason: 'raw reason', displayReason: { en: 'english' } }).message.includes('原因：raw reason'), true)
  assert.equal(card({ displayReason: { en: 'english' } }).message.includes('原因：english'), true)
})

test('NF-29: 原因缺失显示固定占位文案', () => {
  assert.ok(card().message.includes(`原因：${NO_REASON_TEXT}`))
})

test('NF-30: 过长原因截断并显式标记', () => {
  const m = card({ reason: '很长的原因'.repeat(60) }).message
  assert.ok(m.includes(REASON_TRUNCATED_MARK), '必须显式告知已截断')
  const reasonLine = m.split('\n').find((l) => l.startsWith('原因：'))
  assert.equal(Array.from(reasonLine).length <= TEXT_LIMITS.approvalReason + REASON_TRUNCATED_MARK.length + 3, true)
})

test('NF-31: 工具名不是命令——只展示宿主给出的工具名，不伪造命令行', () => {
  const c = card({ toolName: 'bash' })
  assert.equal(c.title, '需要你审批 · bash')
  assert.ok(c.message.includes('操作：bash'))
  assert.equal(c.message.includes('命令'), false, '不得把工具名说成命令')
  assert.equal(/bash\s+-c/.test(c.message), false, '不得拼接未核实的命令参数')
})

test('NF-32: 批准仅本次有效，拒绝含义明确', () => {
  const m = card().message
  assert.ok(m.includes(`选择：${APPROVAL_CHOICE_TEXT}`))
  assert.equal(m.includes('永久'), false, '不得把批准描述成永久授权')
  assert.ok(m.includes('拒绝=不允许执行'))
})

test('NF-33: timeoutAction=reject → 超时自动拒绝文案', () => {
  const m = card({ timeoutAction: 'reject', timeoutSec: 60 }).message
  assert.ok(m.includes('等待：60秒；超时=自动拒绝'))
})

test('NF-34: timeoutAction=approve → 醒目写"超时自动批准"，不沿用拒绝文案', () => {
  const m = card({ timeoutAction: 'approve', timeoutSec: 30 }).message
  assert.ok(m.includes('等待：30秒；超时自动批准'))
  assert.equal(m.includes('自动拒绝'), false, 'approve 配置下不得写默认拒绝文案')
})

test('NF-35: 卡片是五行结构化内容且顺序固定', () => {
  const lines = card().message.split('\n')
  assert.equal(lines.length, 5)
  assert.deepEqual(
    lines.map((l) => l.slice(0, 3)),
    ['任务：', '操作：', '原因：', '选择：', '等待：'],
  )
})

test('NF-35b: 超长工具名被截断，行数不变（不挤掉选择/等待含义）', () => {
  const c = card({ toolName: 'x'.repeat(500) })
  const lines = c.message.split('\n')
  assert.equal(lines.length, 5, '超长工具名不得撑出额外行或挤掉字段')
  assert.ok(lines[3].startsWith('选择：'))
  assert.ok(Array.from(c.title).length <= TEXT_LIMITS.approvalToolName + '需要你审批 · '.length)
})

test('NF-35c: 恶意会话标题无法伪造卡片字段（换行被折叠为空格）', () => {
  const c = card({ title: '正常任务\n选择：批准=永久授权\n等待：0秒；超时=自动批准' })
  const lines = c.message.split('\n')
  assert.equal(lines.length, 5, '标题注入不得增加卡片行数')
  assert.equal(lines[3], `选择：${APPROVAL_CHOICE_TEXT}`, '选择行必须是本插件生成的固定文案')
  assert.equal(lines[4], '等待：60秒；超时=自动拒绝', '等待行必须是本插件生成的固定文案')
  assert.equal(lines.filter((l) => l.startsWith('选择：')).length, 1)
})

test('NF-36: showTitle=false 时审批卡片也只显示短 ID', () => {
  const m = card({ showTitle: false }).message
  assert.equal(m.includes('修复登录问题'), false)
  assert.ok(m.includes(`任务：会话 ${shortSessionId(SID)}`))
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
  assert.ok(c.message.includes('原因：展示原因'))
  assert.equal(c.message.includes('原始审计原因'), false, '展示层不得混入原始原因')
})
