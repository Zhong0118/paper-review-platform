/**
 * 三种保存合同的纯前端假适配器（规格 v2.1 §3.2）。不发真实请求，不导入 src/api。
 * 字段名取自开发交付报告，U2 以修复快照中的实际 API 类型为准。
 *
 * | 对象         | 版本条件                              | 保存方式 |
 * | 论文草稿     | content_revision 不透明字符串 → expected_content_revision | 自动 |
 * | 普通评阅草稿 | 整数 revision（无草稿为 0）→ expected_revision            | 自动 |
 * | 更正草稿     | 更正申请 version                                        | 手动 |
 */
import { DraftConflictError } from '../kit/draftController'

export type FakeMode = 'ok' | 'slow' | 'fail' | 'conflict'
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 普通评阅：服务端整数 revision，条件不符返回 409 与服务器副本。 */
export function reviewDraftTransport<T>(mode: () => FakeMode, serverCopy: (mine: T) => T) {
  let serverRevision = 4
  return async (snapshot: T, expected_revision: number) => {
    await wait(mode() === 'slow' ? 2600 : 600)
    if (mode() === 'fail') throw new Error('服务暂时不可用（500）')
    if (mode() === 'conflict' || expected_revision !== serverRevision) {
      throw new DraftConflictError<T, number>(serverCopy(snapshot), serverRevision + 1)
    }
    serverRevision += 1
    return { revision: serverRevision }
  }
}

/** 论文草稿：服务端返回新的不透明指纹；前端不解析、不递增，只原样回传。 */
export function thesisDraftTransport<T>(mode: () => FakeMode, serverCopy: (mine: T) => T) {
  let fingerprint = 'cr_7f3a91e2'
  return async (snapshot: T, expected_content_revision: string) => {
    await wait(600)
    if (mode() === 'fail') throw new Error('服务暂时不可用（500）')
    if (mode() === 'conflict' || expected_content_revision !== fingerprint) {
      throw new DraftConflictError<T, string>(serverCopy(snapshot), 'cr_c04d5b18')
    }
    fingerprint = `cr_${Math.random().toString(16).slice(2, 10)}`
    return { revision: fingerprint }
  }
}

/** 更正草稿：手动保存，条件为更正申请 version。 */
export function correctionDraftTransport<T>(mode: () => FakeMode, serverCopy: (mine: T) => T) {
  let requestVersion = 3
  return async (snapshot: T, version: number) => {
    await wait(700)
    if (mode() === 'fail') throw new Error('服务暂时不可用（500）')
    if (mode() === 'conflict' || version !== requestVersion) {
      throw new DraftConflictError<T, number>(serverCopy(snapshot), requestVersion + 1)
    }
    requestVersion += 1
    return { revision: requestVersion }
  }
}
