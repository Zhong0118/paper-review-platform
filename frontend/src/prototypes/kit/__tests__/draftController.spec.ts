import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDraftController, DraftConflictError } from '../draftController'

type Doc = { text: string }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createDraftController', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts clean and becomes dirty on edit', () => {
    const save = vi.fn()
    const draft = createDraftController<Doc>({ initial: { text: 'a' }, revision: 1, save, debounceMs: 500 })
    expect(draft.state.value).toBe('clean')
    draft.update({ text: 'ab' })
    expect(draft.state.value).toBe('dirty')
    expect(save).not.toHaveBeenCalled()
  })

  it('returns to clean when the edit is undone before saving', () => {
    const draft = createDraftController<Doc>({ initial: { text: 'a' }, revision: 1, save: vi.fn(), debounceMs: 500 })
    draft.update({ text: 'ab' })
    draft.update({ text: 'a' })
    expect(draft.state.value).toBe('clean')
  })

  it('saves after the debounce and reports saved only for the confirmed snapshot', async () => {
    const save = vi.fn().mockResolvedValue({ revision: 2 })
    const draft = createDraftController<Doc>({ initial: { text: 'a' }, revision: 1, save, debounceMs: 500 })
    draft.update({ text: 'ab' })
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledWith({ text: 'ab' }, 1)
    expect(draft.state.value).toBe('saved')
    expect(draft.revision.value).toBe(2)
    expect(draft.savedAt.value).not.toBeNull()
  })

  it('keeps one request in flight and coalesces later edits into the next save', async () => {
    const first = deferred<{ revision: number }>()
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ revision: 3 })
    const draft = createDraftController<Doc>({ initial: { text: 'a' }, revision: 1, save, debounceMs: 100 })

    draft.update({ text: 'b' })
    await vi.advanceTimersByTimeAsync(100)
    expect(draft.state.value).toBe('saving')

    draft.update({ text: 'bc' })
    draft.update({ text: 'bcd' })
    await vi.advanceTimersByTimeAsync(100)
    expect(save).toHaveBeenCalledTimes(1)

    first.resolve({ revision: 2 })
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith({ text: 'bcd' }, 2)
    expect(draft.state.value).toBe('saved')
    expect(draft.revision.value).toBe(3)
  })

  it('does not show saved while newer input is still unconfirmed', async () => {
    const first = deferred<{ revision: number }>()
    const second = deferred<{ revision: number }>()
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const draft = createDraftController<Doc>({ initial: { text: 'a' }, revision: 1, save, debounceMs: 100 })

    draft.update({ text: 'b' })
    await vi.advanceTimersByTimeAsync(100)
    draft.update({ text: 'bc' })
    first.resolve({ revision: 2 })
    await vi.advanceTimersByTimeAsync(0)
    expect(draft.state.value).not.toBe('saved')
  })

  it('keeps the local input after a failure and retries the latest content', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('500')).mockResolvedValueOnce({ revision: 2 })
    const draft = createDraftController<Doc>({ initial: { text: 'a' }, revision: 1, save, debounceMs: 100 })
    draft.update({ text: 'typed' })
    await vi.advanceTimersByTimeAsync(100)
    expect(draft.state.value).toBe('failed')
    expect(draft.local.value).toEqual({ text: 'typed' })

    await expect(draft.flush()).resolves.toBe(true)
    expect(save).toHaveBeenLastCalledWith({ text: 'typed' }, 1)
    expect(draft.state.value).toBe('saved')
  })

  it('flush waits for the in-flight request and the trailing edit before resolving', async () => {
    const first = deferred<{ revision: number }>()
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ revision: 3 })
    const draft = createDraftController<Doc>({ initial: { text: 'a' }, revision: 1, save, debounceMs: 1000 })
    draft.update({ text: 'b' })
    await vi.advanceTimersByTimeAsync(1000)
    draft.update({ text: 'bc' })

    let done: boolean | undefined
    void draft.flush().then((ok) => (done = ok))
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBeUndefined()

    first.resolve({ revision: 2 })
    await vi.runAllTimersAsync()
    expect(done).toBe(true)
    expect(save).toHaveBeenLastCalledWith({ text: 'bc' }, 2)
  })

  it('flush resolves false when the save fails so the caller can stay on the page', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'))
    const draft = createDraftController<Doc>({ initial: { text: 'a' }, revision: 1, save, debounceMs: 1000 })
    draft.update({ text: 'b' })
    await expect(draft.flush()).resolves.toBe(false)
    expect(draft.local.value).toEqual({ text: 'b' })
  })

  it('stops autosave on conflict, keeps local, and exposes the server copy', async () => {
    const save = vi.fn().mockRejectedValue(new DraftConflictError({ text: 'server' }, 5))
    const draft = createDraftController<Doc>({ initial: { text: 'a' }, revision: 1, save, debounceMs: 100 })
    draft.update({ text: 'mine' })
    await vi.advanceTimersByTimeAsync(100)
    expect(draft.state.value).toBe('conflict')
    expect(draft.local.value).toEqual({ text: 'mine' })
    expect(draft.conflict.value).toEqual({ server: { text: 'server' }, revision: 5 })

    draft.update({ text: 'mine2' })
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1)
    expect(draft.state.value).toBe('conflict')
  })

  it('loading the server copy after a conflict resets to clean at the server revision', async () => {
    const save = vi.fn().mockRejectedValue(new DraftConflictError({ text: 'server' }, 5))
    const draft = createDraftController<Doc>({ initial: { text: 'a' }, revision: 1, save, debounceMs: 100 })
    draft.update({ text: 'mine' })
    await vi.advanceTimersByTimeAsync(100)
    draft.acceptServer()
    expect(draft.local.value).toEqual({ text: 'server' })
    expect(draft.revision.value).toBe(5)
    expect(draft.state.value).toBe('clean')
  })

  it('locks the draft so later edits are ignored', () => {
    const save = vi.fn()
    const draft = createDraftController<Doc>({ initial: { text: 'a' }, revision: 1, save, debounceMs: 100 })
    draft.lock()
    draft.update({ text: 'b' })
    expect(draft.local.value).toEqual({ text: 'a' })
    expect(draft.state.value).toBe('locked')
  })

  it('passes an opaque string revision back verbatim without parsing it', async () => {
    const save = vi.fn().mockResolvedValueOnce({ revision: 'sha256:9f2c' }).mockResolvedValueOnce({ revision: 'sha256:01ab' })
    const draft = createDraftController<Doc, string>({ initial: { text: 'a' }, revision: 'sha256:77e1', save, debounceMs: 100 })
    draft.update({ text: 'b' })
    await vi.advanceTimersByTimeAsync(100)
    draft.update({ text: 'c' })
    await vi.advanceTimersByTimeAsync(100)
    expect(save.mock.calls.map((call) => call[1])).toEqual(['sha256:77e1', 'sha256:9f2c'])
    expect(draft.revision.value).toBe('sha256:01ab')
  })

  it('in manual mode only marks dirty and never sends until save() is called', async () => {
    const save = vi.fn().mockResolvedValue({ revision: 4 })
    const draft = createDraftController<Doc>({ initial: { text: 'a' }, revision: 3, save, debounceMs: 100, autosave: false })
    draft.update({ text: 'b' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
    expect(draft.state.value).toBe('dirty')
    await expect(draft.save()).resolves.toBe(true)
    expect(save).toHaveBeenCalledWith({ text: 'b' }, 3)
    expect(draft.state.value).toBe('saved')
  })

  it('in manual mode keeps the input after a failed save and does not retry on its own', async () => {
    const save = vi.fn().mockRejectedValue(new Error('500'))
    const draft = createDraftController<Doc>({ initial: { text: 'a' }, revision: 3, save, autosave: false })
    draft.update({ text: 'b' })
    await expect(draft.save()).resolves.toBe(false)
    draft.update({ text: 'bc' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(draft.local.value).toEqual({ text: 'bc' })
    expect(draft.state.value).toBe('failed')
  })
})
