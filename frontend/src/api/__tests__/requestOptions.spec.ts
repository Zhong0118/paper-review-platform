/** U4-0：新页要用 quiet 等选项；这些函数把可选末尾参数原样转给 httpApi，幂等键与之合并。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }))
vi.mock('../request', () => ({ default: { get: vi.fn() }, httpApi: api }))

import { applyCatalogImport, previewCatalogImport, saveDisciplineSettings } from '../catalogs'
import { correctionCommand, listCorrections } from '../corrections'
import { applyExpertImport, previewExpertImport, replaceConflicts, reviewQualification, setServiceStatus, updateExpert } from '../expertOperations'
import { resolveObjection, startObjection } from '../objections'
import { saveDeadlines, updateBatch, updateMember } from '../schoolOperations'
import { pinPrograms } from '../schoolPrograms'
import { saveSensitiveTerms } from '../sensitiveChecks'

const quiet = { quiet: true }
const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.at(-1)

beforeEach(() => Object.values(api).forEach((fn) => fn.mockReset()))

describe('optional request options', () => {
  it.each([
    ['startObjection', () => startObjection('o1', quiet), api.post],
    ['resolveObjection', () => resolveObjection('o1', { channel: 'ONLINE', conclusion: '维持' }, quiet), api.post],
    ['updateBatch', () => updateBatch('b1', { version: 1 } as never, quiet), api.patch],
    ['saveDeadlines', () => saveDeadlines('b1', 1, 7, 14, quiet), api.put],
    ['pinPrograms', () => pinPrograms('b1', 'c1', 1, quiet), api.put],
    ['updateMember', () => updateMember('m1', { version: 1 } as never, quiet), api.patch],
    ['saveDisciplineSettings', () => saveDisciplineSettings(['0812'], 1, quiet), api.put],
    ['previewCatalogImport', () => previewCatalogImport(quiet), api.post],
    ['applyCatalogImport', () => applyCatalogImport('fp', quiet), api.post],
    ['saveSensitiveTerms', () => saveSensitiveTerms({ expected_version: 1, terms: [] }, quiet), api.put],
    ['updateExpert', () => updateExpert('e1', { version: 1 } as never, quiet), api.patch],
    ['reviewQualification', () => reviewQualification('e1', { version: 1, status: 'APPROVED', reason: '材料齐全' }, quiet), api.post],
    ['setServiceStatus', () => setServiceStatus('e1', { version: 1, status: 'AVAILABLE', reason: '恢复' }, quiet), api.post],
    ['replaceConflicts', () => replaceConflicts('e1', { version: 1, items: [] }, quiet), api.put],
    ['previewExpertImport', () => previewExpertImport(new File(['x'], 'a.xlsx'), quiet), api.post],
    ['listCorrections', () => listCorrections('platform', quiet), api.get],
  ] as const)('%s forwards the options', (_, call, method) => {
    call()
    expect(last(method)).toBe(quiet)
  })

  it('merges options with the idempotency key', () => {
    applyExpertImport('p1', 'k1', quiet)
    expect(last(api.post)).toEqual({ quiet: true, idempotencyKey: 'k1' })
    correctionCommand('decide', 'c1', {}, 'k2', quiet)
    expect(last(api.post)).toEqual({ quiet: true, idempotencyKey: 'k2' })
    correctionCommand('draft', 'c1', {}, 'k3', quiet)
    expect(last(api.put)).toEqual({ quiet: true, idempotencyKey: 'k3' })
  })

  it('keeps the key when no options are given', () => {
    applyExpertImport('p1', 'k1')
    expect(last(api.post)).toEqual({ idempotencyKey: 'k1' })
  })
})

describe('U4-5 settings options', () => {
  it('forwards options and keeps old calls unchanged', async () => {
    const { getDisciplines, getDisciplineSettings } = await import('../catalogs')
    const { previewPrograms, publishPrograms } = await import('../schoolPrograms')
    const { getSensitiveTerms } = await import('../sensitiveChecks')
    const body = { year: 2026, source: '文件', source_version: 'v1', csv: 'x' }
    getDisciplines(quiet)
    expect(api.get).toHaveBeenLastCalledWith('/catalog/disciplines', quiet)
    getDisciplines()
    expect(api.get).toHaveBeenLastCalledWith('/catalog/disciplines')
    getDisciplineSettings(quiet)
    expect(api.get).toHaveBeenLastCalledWith('/school-admin/discipline-settings', quiet)
    getDisciplineSettings()
    expect(api.get).toHaveBeenLastCalledWith('/school-admin/discipline-settings')
    getSensitiveTerms(quiet)
    expect(api.get).toHaveBeenLastCalledWith('/school-admin/sensitive-terms', quiet)
    getSensitiveTerms()
    expect(api.get).toHaveBeenLastCalledWith('/school-admin/sensitive-terms')
    previewPrograms(body, quiet)
    expect(api.post).toHaveBeenLastCalledWith('/school-admin/program-catalogs:preview', body, quiet)
    previewPrograms(body)
    expect(api.post).toHaveBeenLastCalledWith('/school-admin/program-catalogs:preview', body)
    publishPrograms(body, 'fp', quiet)
    expect(api.post).toHaveBeenLastCalledWith('/school-admin/program-catalogs:publish', { ...body, fingerprint: 'fp' }, quiet)
    publishPrograms(body, 'fp')
    expect(api.post).toHaveBeenLastCalledWith('/school-admin/program-catalogs:publish', { ...body, fingerprint: 'fp' })
  })
})

describe('U4-6 expert options', () => {
  it('forwards options and keeps old calls unchanged', async () => {
    const { listExperts, expertOptions } = await import('../expertOperations')
    listExperts({}, quiet)
    expect(api.get).toHaveBeenLastCalledWith('/platform-review/experts', { params: {}, quiet: true })
    listExperts({ keyword: 'AI' })
    expect(api.get).toHaveBeenLastCalledWith('/platform-review/experts', { params: { keyword: 'AI' } })
    expertOptions(quiet)
    expect(api.get).toHaveBeenLastCalledWith('/platform-review/expert-options', quiet)
    expertOptions()
    expect(api.get).toHaveBeenLastCalledWith('/platform-review/expert-options')
  })
})

describe('U4-1/U4-2 list options', () => {
  it('passes quiet to the school lists without changing old calls', async () => {
    const { listSchoolTheses } = await import('../schoolReview')
    const { listSchoolObjections } = await import('../objections')
    listSchoolTheses(undefined, undefined, quiet)
    expect(api.get).toHaveBeenLastCalledWith('/school-review/theses', quiet)
    listSchoolTheses()
    expect(api.get).toHaveBeenLastCalledWith('/school-review/theses')
    listSchoolTheses('past_year', undefined, quiet)
    expect(last(api.get)).toMatchObject({ params: { time_scope: 'past_year' }, quiet: true })
    listSchoolObjections(quiet)
    expect(api.get).toHaveBeenLastCalledWith('/school-review/objections', quiet)
    listSchoolObjections()
    expect(api.get).toHaveBeenLastCalledWith('/school-review/objections')
  })
})

describe('U4-8 system options', () => {
  it('forwards options and keeps old calls unchanged', async () => {
    const { listTenants, listReviewers } = await import('../systemOperations')
    const { searchInstitutions } = await import('../catalogs')
    listTenants(quiet)
    expect(api.get).toHaveBeenLastCalledWith('/system/tenants', quiet)
    listTenants()
    expect(api.get).toHaveBeenLastCalledWith('/system/tenants')
    listReviewers('t1', quiet)
    expect(api.get).toHaveBeenLastCalledWith('/system/tenants/t1/reviewers', quiet)
    listReviewers('t1')
    expect(api.get).toHaveBeenLastCalledWith('/system/tenants/t1/reviewers')
    searchInstitutions('农业 大学', quiet)
    expect(api.get).toHaveBeenLastCalledWith('/system/institutions?q=%E5%86%9C%E4%B8%9A%20%E5%A4%A7%E5%AD%A6', quiet)
    searchInstitutions('x')
    expect(api.get).toHaveBeenLastCalledWith('/system/institutions?q=x')
  })
})
