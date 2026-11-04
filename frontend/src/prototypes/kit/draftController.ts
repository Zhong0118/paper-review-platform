/**
 * 草稿保存状态机（规格 §10.1）。
 *
 * 区分三份内容：最新输入 local、正在发送的快照、服务器已确认的快照。
 * - 同一时刻只有一个保存请求；请求期间的新输入合并进下一次保存，不丢弃。
 * - 只有服务器确认的内容等于最新输入时才是 saved。
 * - 失败保留输入，可重试；冲突暂停自动保存，保留本地，交给用户核对。
 * - flush() 供“保存并退出”使用：等在途请求和尾随输入都确认后才返回 true。
 *
 * 版本条件 R 由调用方的 transport 决定，控制器只原样保存与回传，不解析、不加 1：
 * - 论文草稿：不透明字符串 content_revision（expected_content_revision）
 * - 普通评阅草稿：整数 revision，无草稿为 0（expected_revision）
 * - 正式结果更正：更正申请自身 version，且 autosave=false 手动保存
 * 原型由假适配器驱动；U2 须优先复用修复快照中已验收的保存队列，用其回归测试证明行为不变。
 */
import { computed, ref, shallowRef, type Ref } from 'vue'

export type DraftState = 'clean' | 'dirty' | 'saving' | 'saved' | 'failed' | 'conflict' | 'locked'

export class DraftConflictError<T, R = unknown> extends Error {
  constructor(
    readonly server: T,
    readonly revision: R,
  ) {
    super('draft conflict')
    this.name = 'DraftConflictError'
  }
}

export interface DraftControllerOptions<T, R> {
  initial: T
  /** 服务端给出的版本条件，原样回传 */
  revision: R
  save: (snapshot: T, baseRevision: R) => Promise<{ revision: R }>
  debounceMs?: number
  /** false = 手动保存（更正稿）：输入只标记有修改，不自动发送 */
  autosave?: boolean
}

const key = (value: unknown) => JSON.stringify(value)
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function createDraftController<T, R = number>(options: DraftControllerOptions<T, R>) {
  const debounceMs = options.debounceMs ?? 800
  const autosave = options.autosave ?? true
  const local = shallowRef<T>(clone(options.initial)) as Ref<T>
  const revision = shallowRef(options.revision) as Ref<R>
  const savedAt = ref<Date | null>(null)
  const error = ref<string | null>(null)
  const conflict = shallowRef<{ server: T; revision: R } | null>(null)
  const locked = ref(false)
  const inFlight = ref(false)

  let confirmedKey = key(options.initial)
  let everSaved = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let current: Promise<void> | null = null
  const localKey = ref(confirmedKey)
  const confirmedTick = ref(0)

  const state = computed<DraftState>(() => {
    void confirmedTick.value
    if (locked.value) return 'locked'
    if (conflict.value) return 'conflict'
    if (inFlight.value) return 'saving'
    const synced = localKey.value === confirmedKey
    if (error.value && !synced) return 'failed'
    if (synced) return everSaved ? 'saved' : 'clean'
    return 'dirty'
  })

  function clearTimer() {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  function schedule() {
    clearTimer()
    if (locked.value || conflict.value) return
    timer = setTimeout(() => {
      timer = null
      void run()
    }, debounceMs)
  }

  function run(): Promise<void> {
    if (current) return current
    if (locked.value || conflict.value || localKey.value === confirmedKey) return Promise.resolve()
    const snapshot = clone(local.value)
    const snapshotKey = key(snapshot)
    inFlight.value = true
    current = options
      .save(snapshot, revision.value)
      .then((result) => {
        revision.value = result.revision
        confirmedKey = snapshotKey
        everSaved = true
        savedAt.value = new Date()
        error.value = null
      })
      .catch((reason: unknown) => {
        if (reason instanceof DraftConflictError) {
          conflict.value = { server: reason.server as T, revision: reason.revision as R }
          clearTimer()
        } else {
          error.value = reason instanceof Error ? reason.message : '保存失败'
        }
      })
      .finally(() => {
        inFlight.value = false
        current = null
        confirmedTick.value++
        // 请求期间若有新输入且防抖已到期，立即补发最新内容（手动模式不补发）
        if (autosave && !error.value && !conflict.value && timer === null && localKey.value !== confirmedKey) void run()
      })
    return current
  }

  function update(next: T) {
    if (locked.value) return
    local.value = clone(next)
    localKey.value = key(next)
    if (localKey.value === confirmedKey) {
      clearTimer()
      return
    }
    if (autosave) schedule()
  }

  /** 立即保存最新输入并等待确认；失败或冲突返回 false，输入保留。 */
  async function flush(): Promise<boolean> {
    clearTimer()
    error.value = null
    for (let attempt = 0; attempt < 5; attempt++) {
      if (current) await current
      if (conflict.value || error.value) return false
      if (locked.value) return true
      if (localKey.value === confirmedKey) return true
      await run()
    }
    return localKey.value === confirmedKey
  }

  /** 冲突后由用户选择载入服务端版本；本地内容应先由界面提供复制。 */
  function acceptServer() {
    if (!conflict.value) return
    const { server, revision: serverRevision } = conflict.value
    local.value = clone(server)
    localKey.value = key(server)
    confirmedKey = localKey.value
    revision.value = serverRevision
    everSaved = false
    error.value = null
    conflict.value = null
    confirmedTick.value++
  }

  function lock() {
    clearTimer()
    locked.value = true
  }

  function dispose() {
    clearTimer()
  }

  return { local, state, revision, savedAt, error, conflict, autosave, update, flush, save: flush, acceptServer, lock, dispose }
}

export type DraftController<T, R = number> = ReturnType<typeof createDraftController<T, R>>
