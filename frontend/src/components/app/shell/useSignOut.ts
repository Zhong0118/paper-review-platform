/** 外壳的“退出登录”：调用现有 auth.logout() 后回到登录页。AppShell 本身不读 store。 */
import { useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

export function useSignOut() {
  const auth = useAuthStore()
  const router = useRouter()
  return async () => {
    await auth.logout()
    await router.replace('/login')
  }
}
