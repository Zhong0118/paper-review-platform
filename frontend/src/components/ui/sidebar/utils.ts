import type { ComputedRef, Ref } from "vue"
import { createContext } from "reka-ui"

/** 本项目：折叠偏好只存本浏览器 localStorage，不写 cookie（不随请求发给后端） */
export const SIDEBAR_STORAGE_KEY = "bj.sidebar.open"
export function readOpen() {
  try { return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "false" } catch { return true }
}
export const SIDEBAR_WIDTH = "224px"
export const SIDEBAR_WIDTH_MOBILE = "280px"
export const SIDEBAR_WIDTH_ICON = "56px"
export const SIDEBAR_KEYBOARD_SHORTCUT = "b"
export const SIDEBAR_MOBILE_BREAKPOINT = 768

export const [useSidebar, provideSidebarContext] = createContext<{
  state: ComputedRef<"expanded" | "collapsed">
  open: Ref<boolean>
  setOpen: (value: boolean) => void
  isMobile: Ref<boolean>
  openMobile: Ref<boolean>
  setOpenMobile: (value: boolean) => void
  toggleSidebar: () => void
}>("Sidebar")
