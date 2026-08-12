import { inject, type InjectionKey } from 'vue'

import { createScenarioService } from './scenarioService'
import type { PlatformOperationService, ScenarioService, StudentPortalService } from './types'

function browserStorage() {
  return typeof window === 'undefined' ? undefined : window.localStorage
}

function createUnavailableService(): ScenarioService {
  const unavailable = async () => {
    throw new Error('真实服务尚未配置，请检查 API 环境和部署配置。')
  }

  return {
    getStudentEligibility: unavailable,
    loginAs: unavailable,
    submitThesis: unavailable,
    confirmAnonymization: unavailable,
    confirmDispatch: unavailable,
    assignExperts: unavailable,
    acceptTask: unavailable,
    saveReviewDraft: unavailable,
    getSnapshot: unavailable,
    submitFinalReview: unavailable,
    publishResult: unavailable,
    getStudentThesis: unavailable,
    createStudentDraft: unavailable,
    saveStudentDraft: unavailable,
    submitStudentThesis: unavailable,
    deleteStudentDraft: unavailable,
    withdrawStudentThesis: unavailable,
    requestStudentWithdrawal: unavailable,
    getStudentResult: unavailable,
    submitStudentObjection: unavailable,
    listStudentNotifications: unavailable,
    listSchoolNotifications: unavailable,
    markStudentNotificationRead: unavailable,
    markAllStudentNotificationsRead: unavailable,
    listRoleNotifications: unavailable,
    markRoleNotificationRead: unavailable,
    markAllRoleNotificationsRead: unavailable,
    loadStudentScenario: unavailable,
    setStudentDemoEligibility: unavailable,
    setStudentDemoFileValidation: unavailable,
    resetStudentDemo: unavailable,
    listStudentTheses: unavailable,
    listSchoolTheses: unavailable,
    submitThesisAsSchool: unavailable,
    previewBatchImport: unavailable,
    listPublishedResults: unavailable,
    listReviewResults: unavailable,
    listExpertTasks: unavailable,
    listOperationsItems: unavailable,
    getSchoolAccount: unavailable,
    getSchoolBills: unavailable,
    getExpertAccount: unavailable,
    listExpertLedger: unavailable,
    submitWithdrawal: unavailable,
    acceptExpertTask: unavailable,
    rejectExpertTask: unavailable,
    loadExpertScenario: unavailable,
    listExpertProfiles: unavailable,
    createExpertProfile: unavailable,
    updateExpertProfile: unavailable,
    setExpertServiceStatus: unavailable,
    reviewExpertQualification: unavailable,
    listExpertMatches: unavailable,
    listOperationsQueues: unavailable,
    listDispatchTheses: unavailable,
    assignExpertToThesis: unavailable,
    reassignExpertTask: unavailable,
    remindExpertTask: unavailable,
    extendExpertTask: unavailable,
    listPlatformAuditLog: unavailable,
    listCorrectionRequests: unavailable,
    requestCorrection: unavailable,
    decideCorrection: unavailable,
    listReviewVersions: unavailable,
    listWithdrawals: unavailable,
    reviewWithdrawal: unavailable,
    recordWithdrawalPayment: unavailable,
    getExpertProfile: unavailable,
    saveExpertProfile: unavailable,
    loadPlatformScenario: unavailable,
    reset: unavailable,
  }
}

export function createScenarioServiceProvider(
  demoMode = import.meta.env.VITE_DEMO_MODE === 'true',
): ScenarioService {
  return demoMode
    ? createScenarioService({ storage: browserStorage(), demoMode })
    : createUnavailableService()
}

export const scenarioService = createScenarioServiceProvider()

export const scenarioServiceKey: InjectionKey<ScenarioService> = Symbol('scenario-service')
export const studentPortalServiceKey: InjectionKey<StudentPortalService> = scenarioServiceKey

export function useScenarioService(): ScenarioService {
  const service = inject(scenarioServiceKey)
  if (!service) throw new Error('场景服务尚未注入')
  return service
}

export function useStudentPortalService(): StudentPortalService {
  return useScenarioService()
}

export function usePlatformOperationService(): PlatformOperationService {
  return useScenarioService()
}
