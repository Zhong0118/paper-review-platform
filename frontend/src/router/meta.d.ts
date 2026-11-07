import 'vue-router'

import type { RoleCode } from '@/types/roles'

declare module 'vue-router' {
  interface RouteMeta {
    roleCodes: RoleCode[]
    layout: 'auth' | 'admin' | 'portal' | 'review'
    /** 原始页面编号；U4-8 起新增的工作空间路由（如 /system/catalog）不设 */
    pageId?: string
    /** U1 原型路由，仅开发环境存在 */
    prototype?: boolean
  }
}
