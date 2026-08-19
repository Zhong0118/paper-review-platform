import 'vue-router'

import type { RoleCode } from '@/types/roles'

declare module 'vue-router' {
  interface RouteMeta {
    roleCodes: RoleCode[]
    layout: 'auth' | 'admin' | 'portal' | 'review'
    pageId: string
  }
}
