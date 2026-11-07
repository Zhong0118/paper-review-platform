/**
 * R1 样板隔离（U4 计划 §17.7）：从样板文件出发沿“值导入”走完整依赖图，
 * 不能到达 HTTP 客户端（src/api/request）或任何 store；对 src/api 只允许 `import type`。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(here, '../../..')
const R1 = resolve(here, '..')

const IMPORT = /^\s*import\s+(type\s+)?([^'"]*?)\s*(?:from\s*)?['"]([^'"]+)['"]/gm
const DYNAMIC = /import\(\s*['"]([^'"]+)['"]\s*\)/g

function resolveFile(spec: string, from: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return null // npm 包不在本检查范围
  for (const candidate of [base, `${base}.ts`, `${base}.vue`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && !candidate.endsWith('/') && readdirSafe(candidate) === null) return candidate
  }
  return null
}
function readdirSafe(path: string) {
  try {
    return readdirSync(path)
  } catch {
    return null
  }
}

/** 只返回值导入；`import type` 与全部是 `type X` 的具名导入跳过 */
function valueImports(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const code = file.endsWith('.vue') ? [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n') : text
  const out: string[] = []
  for (const [, typeOnly, clause, spec] of code.matchAll(IMPORT)) {
    if (typeOnly) continue
    const named = clause?.match(/^\{([\s\S]*)\}$/)
    if (named && named[1]!.split(',').map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith('type '))) continue
    out.push(spec!)
  }
  for (const [, spec] of code.matchAll(DYNAMIC)) out.push(spec!)
  return out
}

function reachable(entries: string[]) {
  const seen = new Set<string>()
  const stack = [...entries]
  while (stack.length) {
    const file = stack.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const spec of valueImports(file)) {
      const target = resolveFile(spec, file)
      if (target) stack.push(target)
    }
  }
  return [...seen].map((file) => relative(SRC, file))
}

const entries = readdirSync(R1)
  .filter((name) => name.endsWith('.vue') || name.endsWith('.ts'))
  .map((name) => join(R1, name))

it('R1 samples never reach the HTTP client or a store through value imports', () => {
  const files = reachable(entries)
  expect(files.length).toBeGreaterThan(entries.length)
  expect(files.filter((file) => file === 'api/request.ts' || file.startsWith('stores/'))).toEqual([])
  expect(files.filter((file) => file.startsWith('api/'))).toEqual([])
})

it('the walker does see a value import of the HTTP client (self-check)', () => {
  // 真实专家库页面经 api/expertOperations 用到 HTTP 客户端；走查器必须能发现，否则上面的断言没有意义
  const page = join(SRC, 'modules/expert-management')
  const candidates = readdirSync(page, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.vue') && !name.includes('__tests__'))
    .map((name) => join(page, name))
  expect(reachable(candidates)).toContain('api/request.ts')
})
