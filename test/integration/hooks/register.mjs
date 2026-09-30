/**
 * T5 集成测试的模块拦截注册入口（node --import）。
 * 用法：node --import ./test/integration/hooks/register.mjs --test test/integration/<file>.test.js
 */
import { register } from 'node:module'
register(new URL('./hook.mjs', import.meta.url))
