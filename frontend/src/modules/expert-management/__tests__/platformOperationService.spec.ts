import { describe, expect, it } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import type { ExpertProfilePatch, StorageLike } from '@/demo/types'

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

describe('platform operation service', () => {
  it('enforces platform-only actions and projects expert profile changes', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    const profiles = await service.listExpertProfiles()
    expect(profiles).toHaveLength(3)
    const target = profiles[0]
    expect(target.allowedActions).toContain('SET_SERVICE_STATUS')

    await service.setExpertServiceStatus(target.id, 'DISABLED', '暂时满负载')
    const updated = (await service.listExpertProfiles()).find((p) => p.id === target.id)
    expect(updated?.serviceStatus).toBe('DISABLED')

    await service.reviewExpertQualification(target.id, 'APPROVED', '材料齐全')
    expect(
      (await service.listExpertProfiles()).find((p) => p.id === target.id)?.qualification,
    ).toBe('APPROVED')
  })

  it('rejects non-platform actions on expert profiles', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const target = (await service.listExpertProfiles())[0]

    // 资格审核通过后为终态：重复审核属于非运营动作。
    await service.reviewExpertQualification(target.id, 'APPROVED', '材料齐全')
    await expect(service.reviewExpertQualification(target.id, 'APPROVED', '重复审核')).rejects.toMatchObject({
      name: 'PlatformOperationError',
      code: 'ILLEGAL_ACTION',
    })
  })

  it('requires a reason when rejecting a qualification review', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const target = (await service.listExpertProfiles())[0]

    await expect(service.reviewExpertQualification(target.id, 'REJECTED', '  ')).rejects.toMatchObject({
      name: 'PlatformOperationError',
      code: 'INVALID_INPUT',
    })
    await service.reviewExpertQualification(target.id, 'REJECTED', '学科方向不符')
    expect(
      (await service.listExpertProfiles()).find((p) => p.id === target.id)?.qualification,
    ).toBe('REJECTED')
  })

  it('allows a second review attempt after a rejected qualification', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const target = (await service.listExpertProfiles())[0]
    await service.reviewExpertQualification(target.id, 'REJECTED', '材料不齐')

    await service.reviewExpertQualification(target.id, 'APPROVED', '补交材料已核验')

    expect(
      (await service.listExpertProfiles()).find((p) => p.id === target.id)?.qualification,
    ).toBe('APPROVED')
  })

  it('rejects disabling an expert without a reason', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const target = (await service.listExpertProfiles())[0]

    await expect(service.setExpertServiceStatus(target.id, 'DISABLED', '')).rejects.toMatchObject({
      name: 'PlatformOperationError',
      code: 'INVALID_INPUT',
    })
    await expect(service.setExpertServiceStatus(target.id, 'ACTIVE', '')).rejects.toMatchObject({
      name: 'PlatformOperationError',
      code: 'INVALID_INPUT',
    })
  })

  it('keeps service status stable across service reconstruction', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    const target = (await service.listExpertProfiles())[0]
    await service.setExpertServiceStatus(target.id, 'DISABLED', '暂时满负载')

    const restored = createScenarioService({ storage, demoMode: true })
    expect((await restored.listExpertProfiles()).find((p) => p.id === target.id)).toMatchObject({
      serviceStatus: 'DISABLED',
    })
  })

  it('returns immutable expert profile snapshots', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const profiles = await service.listExpertProfiles()

    expect(() => {
      profiles[0].name = '被页面篡改的专家'
    }).toThrow()
    expect(() => {
      profiles[0].researchTags.push('越权标签')
    }).toThrow()
    expect(() => {
      profiles[0].allowedActions.push('FABRICATED_ACTION')
    }).toThrow()
  })

  it('normalizes research tags to a deduplicated trimmed list within the eight-tag limit', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const target = (await service.listExpertProfiles())[0]

    await service.updateExpertProfile(target.id, {
      researchTags: [' 知识图谱 ', '知识图谱', '机器学习', '  '],
    })

    expect((await service.listExpertProfiles()).find((p) => p.id === target.id)).toMatchObject({
      researchTags: ['知识图谱', '机器学习'],
    })
  })

  it('rejects more than eight research tags at the profile boundary', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const target = (await service.listExpertProfiles())[0]

    await expect(
      service.updateExpertProfile(target.id, { researchTags: Array.from({ length: 9 }, (_, i) => `方向${i}`) }),
    ).rejects.toMatchObject({
      name: 'PlatformOperationError',
      code: 'INVALID_INPUT',
    })
  })

  it('rejects updates that cross the allowed profile patch boundary', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const target = (await service.listExpertProfiles())[0]

    await expect(service.updateExpertProfile(target.id, { name: '越权改名' })).rejects.toMatchObject({
      name: 'PlatformOperationError',
      code: 'INVALID_INPUT',
    })
    await expect(service.updateExpertProfile(target.id, { id: 'expert-99' })).rejects.toMatchObject({
      name: 'PlatformOperationError',
      code: 'INVALID_INPUT',
    })
  })

  it('creates a new expert profile with reviewable types scoped to its discipline', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })

    const created = await service.createExpertProfile({
      name: '林晚晴',
      unit: '东江理工大学',
      title: '副教授',
      discipline: { code: '0835', name: '软件工程' },
      researchTags: ['可信软件'],
      avoidSchools: ['海岳大学'],
    })

    expect(created).toMatchObject({
      name: '林晚晴',
      unit: '东江理工大学',
      title: '副教授',
      discipline: { code: '0835', name: '软件工程' },
      researchTags: ['可信软件'],
      avoidSchools: ['海岳大学'],
      qualification: 'REVIEWING',
      serviceStatus: 'ACTIVE',
    })
    expect(created.reviewableTypes).toEqual(['硕士学位论文'])
    expect(created.payoutStatus).toBe('PENDING')
    expect((await service.listExpertProfiles())).toHaveLength(4)
  })

  it('filters the expert library by qualification and service status', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })

    const approving = await service.listExpertProfiles({ qualification: 'APPROVED' })
    expect(approving).toHaveLength(2)
    expect(approving.every((p) => p.qualification === 'APPROVED')).toBe(true)

    const active = await service.listExpertProfiles({ serviceStatus: 'ACTIVE' })
    expect(active.every((p) => p.serviceStatus === 'ACTIVE')).toBe(true)
  })

  it('keeps the match seam available as an empty list until dispatch lands', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })

    const matches = await service.listExpertMatches('thesis-main')

    expect(matches).toEqual([])
  })

  it('ignores non-platform query filters when listing expert profiles', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })

    // 学生端专属的 stage 过滤对专家库不生效，属于窄化接口的边界。
    const profiles = await service.listExpertProfiles({
      stage: 'COMPLETED',
    } as unknown as ExpertProfilePatch)

    expect(profiles).toHaveLength(3)
  })

  it('projects the ten queue names for the operations workbench', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })

    const queues = await service.listOperationsQueues()

    expect(Object.keys(queues)).toHaveLength(10)
    expect(Object.keys(queues).sort()).toEqual(
      [
        'PENDING_ASSIGNMENT',
        'PENDING_ACCEPTANCE',
        'IN_REVIEW',
        'DUE_SOON',
        'OVERDUE',
        'PENDING_REASSIGNMENT',
        'PENDING_SUPPLEMENT',
        'CORRECTION_PENDING',
        'SETTLEMENT_PENDING',
        'COMPLETED',
      ].sort(),
    )
    expect(queues.PENDING_ASSIGNMENT).toBeGreaterThan(0)
  })

  it('rejects all platform actions when demo mode is disabled', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: false })

    await expect(service.listExpertProfiles()).rejects.toMatchObject({
      name: 'PlatformOperationError',
      code: 'DEMO_MODE_DISABLED',
    })
    await expect(service.setExpertServiceStatus('expert-17', 'DISABLED', '原因')).rejects.toMatchObject({
      name: 'PlatformOperationError',
      code: 'DEMO_MODE_DISABLED',
    })
    await expect(service.reviewExpertQualification('expert-17', 'APPROVED', '原因')).rejects.toMatchObject({
      name: 'PlatformOperationError',
      code: 'DEMO_MODE_DISABLED',
    })
    await expect(service.listOperationsQueues()).rejects.toMatchObject({
      name: 'PlatformOperationError',
      code: 'DEMO_MODE_DISABLED',
    })
  })
})
