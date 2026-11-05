import type { RouteRecordRaw } from 'vue-router'

import { studentNotificationRoutes } from './studentNotificationRoutes'

export const appRoutes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: '登录',
    component: () => import('@/modules/auth/pages/LoginPage.vue'),
    meta: { roleCodes: [], layout: 'auth', pageId: 'PAGE-001' },
  },
  ...studentNotificationRoutes,
  {
    path: '/student/thesis/edit',
    name: '论文编辑与提交',
    // U2-3：真实模式用新的编辑页（新建态 + 分段编辑）；demo 模式保留旧页
    component: () => import.meta.env.VITE_DEMO_MODE === 'true'
      ? import('@/modules/thesis/pages/ThesisEditPage.vue')
      : import('@/modules/thesis/workspace/StudentThesisEditor.vue'),
    meta: { roleCodes: ['student'], layout: 'portal', pageId: 'PAGE-003' },
  },
  {
    path: '/school/preparation',
    name: '送审准备',
    // U2-1：真实模式用新清单与核验台；demo 模式保留旧页（U2 计划 §4.1）
    component: () => import.meta.env.VITE_DEMO_MODE === 'true'
      ? import('@/modules/school/pages/PreparationListPage.vue')
      : import('@/modules/school/preparation/SchoolPreparationPage.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-004' },
  },
  {
    path: '/school/progress',
    name: '评审进度',
    component: () => import('@/modules/school/pages/ReviewProgressPage.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-005' },
  },
  {
    path: '/platform/experts',
    name: '专家库',
    component: () => import.meta.env.VITE_DEMO_MODE === 'true'
      ? import('@/modules/expert-management/pages/ExpertLibraryPage.vue')
      // U4-6：真实模式改用专家库工作空间（旧 RealExpertLibraryPage 已在 U4-9 删除）
      : import('@/modules/expert-management/library/ExpertLibraryDesk.vue'),
    meta: { roleCodes: ['platform_reviewer'], layout: 'admin', pageId: 'PAGE-006' },
  },
  {
    path: '/platform/dispatch',
    name: '送审运营台',
    // U2-5：真实模式用派单台；demo 模式保留旧工作台（U2 计划 §4）
    component: () => import.meta.env.VITE_DEMO_MODE === 'true'
      ? import('@/modules/dispatch/pages/DispatchWorkbenchPage.vue')
      : import('@/modules/dispatch/desk/PlatformDispatchDesk.vue'),
    meta: { roleCodes: ['platform_reviewer'], layout: 'admin', pageId: 'PAGE-007' },
  },
  {
    path: '/expert/tasks',
    name: '专家任务',
    component: () => import('@/modules/review/pages/ExpertTasksPage.vue'),
    meta: { roleCodes: ['expert'], layout: 'portal', pageId: 'PAGE-008' },
  },
  {
    path: '/expert/invitation',
    name: '评审邀请',
    component: () => import('@/modules/review/pages/InvitationPage.vue'),
    meta: { roleCodes: ['expert'], layout: 'portal', pageId: 'PAGE-009' },
  },
  {
    path: '/expert/review',
    name: '在线评阅',
    // U2-2：真实模式用专注评阅；demo 模式保留旧页（U2 计划 §4）
    component: () => import.meta.env.VITE_DEMO_MODE === 'true'
      ? import('@/modules/review/pages/ReviewWorkspacePage.vue')
      : import('@/modules/review/desk/ExpertReviewDesk.vue'),
    meta: { roleCodes: ['expert'], layout: 'review', pageId: 'PAGE-010' },
  },
  {
    path: '/school/results',
    name: '结果处理',
    // U4-1：真实模式用结果处理工作空间；demo 模式保留旧页
    component: () => import.meta.env.VITE_DEMO_MODE === 'true'
      ? import('@/modules/result/pages/ResultProcessingPage.vue')
      : import('@/modules/result/processing/SchoolResultsDesk.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-011' },
  },
  {
    path: '/supervisor/results',
    name: '导师评审结果',
    // U2-6：真实模式用只读正式反馈；demo 模式保留旧页
    component: () => import.meta.env.VITE_DEMO_MODE === 'true'
      ? import('@/modules/result/pages/SupervisorResultPage.vue')
      : import('@/modules/result/feedback/SupervisorFeedbackPage.vue'),
    meta: { roleCodes: ['supervisor'], layout: 'portal', pageId: 'PAGE-013' },
  },
  {
    path: '/expert/finance',
    name: '费用与提现',
    component: () => import('@/modules/review/pages/ExpertFinancePage.vue'),
    meta: { roleCodes: ['expert'], layout: 'portal', pageId: 'PAGE-014' },
  },
  {
    path: '/exports',
    name: '导出中心',
    component: () => import('@/modules/shared/pages/ExportCenterPage.vue'),
    meta: {
      roleCodes: ['school_reviewer', 'platform_reviewer'],
      layout: 'admin',
      pageId: 'PAGE-016',
    },
  },
  {
    path: '/system/tenants',
    name: '租户与权限',
    // U4-8：真实模式用学校管理工作空间；demo 模式保留旧页
    component: () => import.meta.env.VITE_DEMO_MODE === 'true'
      ? import('@/modules/system/pages/TenantPermissionsPage.vue')
      : import('@/modules/system/tenants/TenantDesk.vue'),
    meta: { roleCodes: ['system_admin'], layout: 'admin', pageId: 'PAGE-017' },
  },
  {
    // U4-8（E10）：官方基础目录从学校管理页分出；同为 system_admin，不设 pageId
    path: '/system/catalog',
    name: '官方基础目录',
    component: () => import('@/modules/system/catalog/OfficialCatalogPage.vue'),
    meta: { roleCodes: ['system_admin'], layout: 'admin' },
  },
  {
    path: '/audit',
    name: '审计查询',
    component: () => import('@/modules/system/pages/AuditQueryPage.vue'),
    meta: {
      roleCodes: ['system_admin', 'school_reviewer', 'platform_reviewer'],
      layout: 'admin',
      pageId: 'PAGE-018',
    },
  },
  {
    path: '/school/objections',
    name: '异议处理',
    // U4-2：真实模式用异议处理工作空间；demo 模式保留旧页
    component: () => import.meta.env.VITE_DEMO_MODE === 'true'
      ? import('@/modules/school/pages/ObjectionWorkbenchPage.vue')
      : import('@/modules/school/objections/SchoolObjectionsDesk.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-019' },
  },
  {
    path: '/platform/corrections',
    name: '评阅更正审批',
    // U4-7：真实模式用更正审批工作空间；demo 模式保留旧页
    component: () => import.meta.env.VITE_DEMO_MODE === 'true'
      ? import('@/modules/expert-management/pages/CorrectionApprovalPage.vue')
      : import('@/modules/expert-management/corrections/CorrectionApprovalDesk.vue'),
    meta: { roleCodes: ['platform_reviewer'], layout: 'admin', pageId: 'PAGE-020' },
  },
  {
    path: '/expert/profile',
    name: '个人资料与资格',
    component: () => import('@/modules/review/pages/ExpertProfilePage.vue'),
    meta: { roleCodes: ['expert'], layout: 'portal', pageId: 'PAGE-021' },
  },
  {
    path: '/platform/settlements',
    name: '费用结算',
    component: () => import('@/modules/finance/pages/SettlementWorkbenchPage.vue'),
    meta: { roleCodes: ['platform_reviewer'], layout: 'admin', pageId: 'PAGE-022' },
  },
  {
    path: '/school/batch-rules',
    name: '批次与评审规则',
    // U4-3：真实模式用批次与规则工作空间；demo 模式保留旧页
    component: () => import.meta.env.VITE_DEMO_MODE === 'true'
      ? import('@/modules/school/pages/BatchRulesPage.vue')
      : import('@/modules/school/settings/BatchSettingsPage.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-023' },
  },
  {
    path: '/school/account',
    name: '学校账户与账单',
    component: () => import('@/modules/school/pages/SchoolAccountPage.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-024' },
  },
  {
    path: '/school/sensitive-terms',
    name: '本校材料检测词表',
    // U4-5 检测词表工作空间；U4-9 起两种模式共用（旧页已删除，演示菜单不显示此项）
    component: () => import('@/modules/school/settings/TermSettingsPage.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-027' },
  },
  {
    path: '/school/disciplines',
    name: '本校送审学科',
    // U4-5 学科与专业工作空间；U4-9 起两种模式共用（旧页已删除，演示菜单不显示此项）
    component: () => import('@/modules/school/settings/DisciplineSettingsPage.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-026' },
  },
  {
    path: '/school/members',
    name: '成员与送审资格',
    // U4-4 成员与资格工作空间；U4-9 起两种模式共用（旧页已删除，演示菜单不显示此项）
    component: () => import('@/modules/school/settings/MemberSettingsPage.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-025' },
  },
]
