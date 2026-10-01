/**
 * 主/子身份适配器单元测试（A 独占，契约 §2.4/§2.6）。
 *
 * R2 §3 关注点：registry 查询面（ctx.agents.get）的解析顺序第 2 步必须真实可用。
 * 集成层无法覆盖"id-only 请求"——真实宿主的 ApprovalService.request 需要
 * agent.session 才能判 open turn（dsh-user-approval/lib/index.js:50 hasOpenTurn），
 * 因此该路径只能在单元层验证。这里同时固化 R1 的 cordis 教训：
 * 服务未注入时属性访问会抛，调用方必须经 safeAgentLookup。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifySessionOrigin,
  resolveRequestSession,
  latestTitleFromEvents,
} from '../lib/host-contract.js'

/** 最小会话替身：与宿主一样，header/id 都是只读结构面。 */
const sessionWith = (header) => ({ id: 's1', ...(header === undefined ? {} : { header }) })

test('classifySessionOrigin：origin === subagent 是唯一子代理判据', () => {
  assert.equal(classifySessionOrigin({ origin: 'subagent' }), 'subagent')
})

test('classifySessionOrigin：root 会话 origin 缺省 → root（不存在 root 字面量）', () => {
  assert.equal(classifySessionOrigin({}), 'root')
  assert.equal(classifySessionOrigin({ origin: undefined }), 'root')
})

test('classifySessionOrigin：header 缺失 → unknown（不可当作主会话）', () => {
  assert.equal(classifySessionOrigin(undefined), 'unknown')
})

test('classifySessionOrigin：parentSession/delegationDepth/isSeeded 不得影响判定', () => {
  // fork 根会话：parentSession 存在但 origin 缺省 → 必须仍是主会话
  assert.equal(
    classifySessionOrigin({ parentSession: 'parent-1', delegationDepth: 0 }),
    'root',
    'fork 根会话不得被误判为子代理',
  )
  // 子代理：即使 depth 缺省，origin=subagent 仍是子代理
  assert.equal(classifySessionOrigin({ origin: 'subagent' }), 'subagent')
})

test('resolveRequestSession：优先 req.agent.session（运行时增强），不查 registry', () => {
  const direct = sessionWith({})
  let lookupCalls = 0
  const got = resolveRequestSession(
    { agent: { id: 's1', session: direct } },
    () => { lookupCalls++; return undefined },
  )
  assert.equal(got, direct)
  assert.equal(lookupCalls, 0, 'session 已在场时不得再查 registry')
})

test('resolveRequestSession：id-only 请求经 registry 查回（解析顺序第 2 步）', () => {
  const viaRegistry = sessionWith({})
  const got = resolveRequestSession(
    { agent: { id: 's9' } },
    (id) => (id === 's9' ? { session: viaRegistry } : undefined),
  )
  assert.equal(got, viaRegistry, 'registry 命中必须被使用')
})

test('resolveRequestSession：registry 查不到 → undefined（身份不可确认，安全转交）', () => {
  assert.equal(resolveRequestSession({ agent: { id: 'nope' } }, () => undefined), undefined)
})

test('resolveRequestSession：无 id 且无 session → undefined', () => {
  assert.equal(resolveRequestSession({ agent: {} }), undefined)
  assert.equal(resolveRequestSession(undefined), undefined)
})

test('resolveRequestSession：registry 抛异常 → undefined（不得让审批请求崩在 waterfall）', () => {
  const got = resolveRequestSession(
    { agent: { id: 'boom' } },
    () => { throw new Error('service disposed') },
  )
  assert.equal(got, undefined)
})

test('resolveRequestSession：registry 返回的对象没有 session → undefined', () => {
  assert.equal(resolveRequestSession({ agent: { id: 's1' } }, () => ({})), undefined)
})

test('latestTitleFromEvents：取最后一条 session/title', () => {
  const events = [
    { type: 'turn/start', data: {} },
    { type: 'session/title', data: { title: '旧标题' } },
    { type: 'turn/end', data: { turn: 1 } },
    { type: 'session/title', data: { title: '新标题' } },
  ]
  assert.equal(latestTitleFromEvents(events), '新标题')
})

test('latestTitleFromEvents：非字符串 / 空白标题被忽略', () => {
  const events = [
    { type: 'session/title', data: { title: 12345 } },
    { type: 'session/title', data: { title: '   ' } },
    { type: 'session/title', data: { title: '有效标题' } },
    { type: 'session/title', data: { title: null } },
  ]
  assert.equal(latestTitleFromEvents(events), '有效标题')
})

test('latestTitleFromEvents：无可用标题 / 非数组输入 → undefined', () => {
  assert.equal(latestTitleFromEvents([{ type: 'turn/start', data: {} }]), undefined)
  assert.equal(latestTitleFromEvents([]), undefined)
  assert.equal(latestTitleFromEvents(undefined), undefined)
  assert.equal(latestTitleFromEvents([{ type: 'session/title' }]), undefined)
})
