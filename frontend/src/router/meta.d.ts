import 'vue-router'

import type { RoleCode } from '@/types/roles'

declare module 'vue-router' {
  interface RouteMeta {
    roleCodes: RoleCode[]
    layout: 'auth' | 'admin' | 'portal' | 'review'
    pageId: string
    /** U1 原型路由，仅开发环境存在 */
    prototype?: boolean
  }
}
