/**
 * 受控 spawn 假实现（node:child_process 的用户图替身）。
 * 通过 load 钩子全局重定向（Node 对内置模块的 load 钩子不带 parentURL，
 * 无法按导入方过滤——见 hook.mjs）。真实模块用 process.getBuiltinModule
 * 获取，绕开钩子避免递归。
 *
 * 替身范围：仅异步 spawn 且 command === 'powershell.exe'（审批 Toast / 结果
 * 回执 / 定向清理三条路径——本进程内只有插件会这样调用）。node:test 自身的
 * 子进程走内部加载器不经本钩子；spawnSync（assertScriptsUsable 的真实语法门）
 * 保持真实实现。
 * 测试通过 globalThis.__approvalMockChannel 拿到记录并驱动 exit/error，
 * 覆盖退出码 0/1/2/3/4 的完整映射（dialog.mapExitCode 契约）。
 * kill() 置 killed 并异步发 exit；kill 后 PowerShell finally 不保证执行这一
 * 实机假设由 T3/T6 验证，不在本替身的职责内。
 */
const real = process.getBuiltinModule('node:child_process')

export function spawn(command, args, options) {
  const channel = globalThis.__approvalMockChannel
  if (channel && command === 'powershell.exe') {
    const child = new (process.getBuiltinModule('node:events').EventEmitter)()
    child.killed = false
    child.kill = () => {
      child.killed = true
      queueMicrotask(() => child.emit('exit', null, 'SIGTERM'))
      return true
    }
    const record = { command, args, child }
    channel.spawns.push(record)
    channel.onSpawn?.(record)
    return child
  }
  return real.spawn(command, args, options)
}

export const spawnSync = real.spawnSync
export const exec = real.exec
export const execSync = real.execSync
export const execFile = real.execFile
export const execFileSync = real.execFileSync
export const fork = real.fork
export const ChildProcess = real.ChildProcess
export default real
