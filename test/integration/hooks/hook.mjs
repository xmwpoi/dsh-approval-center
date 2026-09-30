/**
 * T5 mock 通道的模块拦截：把用户模块图中的 node:child_process 重定向到
 * spawn-shim.mjs（仅替身 powershell.exe 的异步 spawn，其余全透传真实实现）。
 *
 * 为什么是全局重定向：Node 对 node: 内置模块触发 load 钩子时 context.parentURL
 * 为 undefined，无法按"导入方位于插件 lib/ 内"过滤（实测确认）。影响面可控：
 * node:test 内部子进程走内部加载器不经过本钩子；用户图内只有插件会 spawn
 * powershell.exe；未定义 __approvalMockChannel 时（如生产宿主）本钩子也不存在。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const shimPath = join(here, 'spawn-shim.mjs')
// 直接内联源码而非重定向 URL：实测（Node 24）shortCircuit+url 二次进 load 链时
// 默认加载器不回读文件（source undefined → ERR_INVALID_RETURN_PROPERTY_VALUE）。
// shim 不使用相对导入/import.meta，内联等价。
const shimSource = readFileSync(shimPath, 'utf8')

export async function load(url, context, next) {
  if (url === 'node:child_process') {
    return { shortCircuit: true, format: 'module', source: shimSource }
  }
  return next(url, context)
}
