import { defineComponent, ref } from 'vue'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeColumns, useColumnPreferences, type ColumnSpec, type ColumnIdentity } from '@/composables/useColumnPreferences'
import SchoolThesisTable from '@/modules/school/components/SchoolThesisTable.vue'
import ExpertTaskTable from '@/modules/review/components/ExpertTaskTable.vue'
import CandidateExpertTable from '@/modules/dispatch/components/CandidateExpertTable.vue'
import type { DemoThesisSummary, ExpertTaskSummary } from '@/demo/types'

const columns: ColumnSpec[] = [
  { id: 'id', label: '论文', required: true, defaultVisible: true },
  { id: 'score', label: '分数', required: false, defaultVisible: true },
  { id: 'actions', label: '操作', required: true, defaultVisible: true },
]
const identity = { id: 'one', role: 'school_reviewer', tenantId: 'school-a' }
const key = (who = identity, table = 'test') => `columns:v1:${who.id}:${who.role}:${who.tenantId || 'platform'}:${table}`
enableAutoUnmount(afterEach)
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())
function harness(table = 'test', defs = columns) {
  const who = ref<ColumnIdentity | null>(identity), allowed = ref(defs)
  let preferences!: ReturnType<typeof useColumnPreferences>
  const wrapper = mount(defineComponent({ setup() {
    preferences = useColumnPreferences(table, 2, allowed, who)
    return { preferences }
  }, template: '<div>{{ preferences.visibleColumns.value.map(c => c.id).join(",") }}</div>' }))
  return { preferences, who, allowed, wrapper }
}

describe('column metadata preferences', () => {
  it('drops unknown/duplicate ids, appends new columns and pins actions', () => {
    expect(normalizeColumns(['score', 'score', 'unknown'], columns).order).toEqual(['score', 'id', 'actions'])
    expect(normalizeColumns(['actions', 'id'], columns).order).toEqual(['id', 'score', 'actions'])
  })
  it('keeps required data visible even with forged empty visibility and unknown fields', () => {
    localStorage.setItem(key(), JSON.stringify({ schemaVersion: 1, order: ['score', 'secret', 'actions'], visibleIds: ['secret'] }))
    const { preferences } = harness()
    expect(preferences.visibleColumns.value.map(c => c.id)).toEqual(['id', 'actions'])
    preferences.setVisible('id', false); preferences.move('actions', 0); preferences.setVisible('secret', true)
    expect(preferences.visibleColumns.value.map(c => c.id)).toEqual(['id', 'actions'])
    expect(preferences.orderedColumns.value.at(-1)?.id).toBe('actions')
  })
  it('persists only metadata and isolates user, role, tenant and table immediately', async () => {
    const { preferences, who } = harness()
    preferences.setVisible('score', false)
    const saved = JSON.parse(localStorage.getItem(key())!)
    expect(Object.keys(saved).sort()).toEqual(['order', 'schemaVersion', 'visibleIds'])
    expect(saved.visibleIds).toEqual(['id', 'actions'])
    for (const next of [{ ...identity, id: 'two' }, { ...identity, role: 'platform_reviewer' }, { ...identity, tenantId: 'school-b' }]) {
      who.value = next
      expect(preferences.visibleColumns.value.map(c => c.id)).toContain('score')
    }
    who.value = identity
    expect(preferences.visibleColumns.value.map(c => c.id)).not.toContain('score')
    expect(harness('other').preferences.visibleColumns.value.map(c => c.id)).toContain('score')
    who.value = null
    expect(preferences.visibleColumns.value.map(c => c.id)).toContain('score')
    preferences.setVisible('score', false)
    expect(localStorage.length).toBe(1)
    await flushPromises()
  })
  it('upgrades old ids while preserving hidden columns and defaulting new ones', () => {
    localStorage.setItem(key(), JSON.stringify({ schemaVersion: 1, order: ['score', 'old', 'id', 'actions'], visibleIds: ['id', 'actions'] }))
    const { preferences } = harness('test', [...columns, { id: 'new', label: '新增', required: false, defaultVisible: true }])
    expect(preferences.orderedColumns.value.map(c => c.id)).toEqual(['score', 'id', 'new', 'actions'])
    expect(preferences.visibleColumns.value.map(c => c.id)).toEqual(['id', 'new', 'actions'])
    preferences.setVisible('new', false)
    expect(JSON.parse(localStorage.getItem(key())!).schemaVersion).toBe(2)
  })
  it.each(['invalid-json', '{"order":null}', '{"schemaVersion":1,"order":[],"visibleIds":"bad"}'])('falls back safely for damaged storage: %s', saved => {
    localStorage.setItem(key(), saved)
    expect(harness().preferences.visibleColumns.value.map(c => c.id)).toEqual(['id', 'score', 'actions'])
  })
  it('supports memory-only choices on storage failure and resets only this key', () => {
    const first = harness(), other = harness('other')
    first.preferences.setVisible('score', false); other.preferences.setVisible('score', false)
    first.preferences.reset()
    expect(localStorage.getItem(key())).toBeNull()
    expect(localStorage.getItem(key(identity, 'other'))).not.toBeNull()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    first.preferences.setVisible('score', false)
    expect(first.preferences.visibleColumns.value.map(c => c.id)).not.toContain('score')
    expect(first.preferences.storageError.value).toBeTruthy()
  })
  it('keeps one business column when every business column is optional', () => {
    const { preferences } = harness('optional', columns.map(c => ({ ...c, required: false, defaultVisible: false })))
    expect(preferences.visibleColumns.value.map(c => c.id)).toEqual(['id', 'actions'])
    preferences.setVisible('id', false)
    expect(preferences.visibleColumns.value.map(c => c.id)).toEqual(['id', 'actions'])
  })
})

const paper = { id:'paper', studentName:'校内学生', studentId:'student', title:'列设置验收论文', anonymousId:'P1', discipline:{code:'0812',name:'计算机'}, submissionSource:'STUDENT', stage:'SUBMITTED', updatedAt:'2026-10-26' } as DemoThesisSummary
const task = { id:'task', status:'IN_REVIEW', anonymousId:'T1', anonymousTitle:'匿名论文', discipline:{code:'0812',name:'计算机'}, allowedActions:['CONTINUE_REVIEW'], overdue:false, dueAt:'', fee:0 } as ExpertTaskSummary
const candidate = { id:'expert', rowType:'eligible' as const, alias:'E1', name:'测试专家', unit:'测试单位', title:'教授', discipline:{code:'0812',name:'计算机'}, fields:['方向'], keywordHits:[], conflictHit:false, activeTasks:0, acceptanceRate:'', onTimeRate:'', avgCompletionDays:0, feeStandard:0, matchReason:'可派' }
const cases = [
  { name:'school', component:SchoolThesisTable, props:{ rows:[paper], preferenceIdentity:identity } },
  { name:'expert', component:ExpertTaskTable, props:{ rows:[task], preferenceIdentity:{...identity, role:'expert', tenantId:null}, showFee:false } },
  { name:'candidate', component:CandidateExpertTable, props:{ rows:[candidate], modelValue:[], preferenceIdentity:{...identity, role:'platform_reviewer', tenantId:null}, showDemoMetrics:false, mobile:true } },
]
it('forged real-task preferences cannot reveal the demo fee column', () => {
  const who = { ...identity, role: 'expert', tenantId: 'platform' }
  localStorage.setItem(key(who, 'expert-tasks'), JSON.stringify({ schemaVersion: 1, order: ['fee', 'id', 'actions'], visibleIds: ['fee', 'id', 'actions'] }))
  const wrapper = mount(ExpertTaskTable, { props: { rows: [task], preferenceIdentity: who, showFee: false }, global: { stubs: { RouterLink: true } } })
  expect(wrapper.find('[data-column-header="fee"]').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('¥')
  expect(wrapper.findAll('[data-column-header]').map(c => c.attributes('data-column-header'))).toEqual(['id', 'status', 'title', 'discipline', 'acceptBy', 'dueAt', 'actions'])
})
for (const fixture of cases) {
  it(`${fixture.name}: headers/cells follow one order, visibility persists and actions remain last`, async () => {
    const wrapper = mount(fixture.component as typeof SchoolThesisTable, { props: fixture.props as never, global:{stubs:{RouterLink:{template:'<a><slot/></a>'}}} })
    await wrapper.get('[data-column-settings]').trigger('click')
    await wrapper.get('input[data-column-toggle="discipline"]').setValue(false)
    expect(wrapper.find('[data-column-header="discipline"]').exists()).toBe(false)
    expect(wrapper.find('[data-column-cell="discipline"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-column-header]').at(-1)?.attributes('data-column-header')).toBe('actions')
    expect(wrapper.findAll('[data-column-cell]').at(-1)?.attributes('data-column-cell')).toBe('actions')
    wrapper.unmount()
    const again = mount(fixture.component as typeof SchoolThesisTable, { props: fixture.props as never, global:{stubs:{RouterLink:true}} })
    expect(again.find('[data-column-header="discipline"]').exists()).toBe(false)
    await again.get('[data-column-settings]').trigger('click')
    await again.get('[data-reset-columns]').trigger('click')
    expect(again.find('[data-column-header="discipline"]').exists()).toBe(true)
  })
}
it('drag and keyboard reorder consistently; focus follows the same column', async () => {
  const wrapper = mount(SchoolThesisTable, { props:{rows:[paper], preferenceIdentity:identity}, attachTo: document.body })
  await wrapper.get('[data-column-settings]').trigger('click')
  const before = wrapper.findAll('[data-column-header]').map(x => x.attributes('data-column-header'))
  await wrapper.get('[data-column-drag="discipline"]').trigger('dragstart', { dataTransfer:{setData:vi.fn()} })
  await wrapper.get('[data-column-option="student"]').trigger('drop')
  expect(wrapper.findAll('[data-column-header]')[0].attributes('data-column-header')).toBe('discipline')
  await wrapper.get('[data-column-option="discipline"]').trigger('keydown', {key:'ArrowDown'})
  await wrapper.get('[data-column-option="discipline"]').trigger('keydown', {key:'ArrowDown'})
  await flushPromises()
  expect(wrapper.findAll('[data-column-header]').map(x => x.attributes('data-column-header'))).toEqual(before)
  expect(document.activeElement?.getAttribute('data-column-option')).toBe('discipline')
  await wrapper.get('input[data-column-toggle="student"]').setValue(false)
  for (const input of wrapper.findAll('input[data-column-toggle]:not(:disabled)')) await input.setValue(false)
  expect(wrapper.find('[data-column-header="thesis"]').exists()).toBe(true)
  expect(wrapper.find('[data-column-header="actions"]').exists()).toBe(true)
  await wrapper.get('[data-column-panel]').trigger('keydown', {key:'Escape'})
  expect(document.activeElement?.hasAttribute('data-column-settings')).toBe(true)
})
