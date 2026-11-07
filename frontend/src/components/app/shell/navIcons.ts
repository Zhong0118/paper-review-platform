/**
 * R1 侧栏图标：按真实路由路径取图标（Lucide，导航 18px）。
 * 菜单本身仍只由 router/menus.ts 的 portalMenus 决定，这里不增减条目。
 */
import type { Component } from 'vue'
import {
  BookOpenCheck,
  Building2,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  FilePenLine,
  FileText,
  Inbox,
  Library,
  ListChecks,
  MessageSquareWarning,

  Send,
  Tags,
  UserRoundCheck,
  Users,
  CalendarRange,
  GraduationCap,
} from '@lucide/vue'

const ICONS: Record<string, Component> = {
  '/school/preparation': ClipboardCheck,
  '/school/progress': ListChecks,
  '/school/results': FileCheck2,
  '/school/objections': MessageSquareWarning,
  '/school/batch-rules': CalendarRange,
  '/school/members': Users,
  '/school/disciplines': GraduationCap,
  '/school/sensitive-terms': Tags,
  '/platform/dispatch': Send,
  '/platform/experts': UserRoundCheck,
  '/platform/corrections': FilePenLine,
  '/student/dashboard': FileText,
  '/student/results': BookOpenCheck,
  '/supervisor/results': BookOpenCheck,
  '/expert/tasks': Inbox,
  '/system/tenants': Building2,
  '/system/catalog': Library,
}

export const navIcon = (path?: string): Component => (path && ICONS[path]) || ClipboardList
