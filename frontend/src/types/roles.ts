export type RoleCode =
  | 'system_admin'
  | 'school_reviewer'
  | 'platform_reviewer'
  | 'student'
  | 'supervisor'
  | 'expert'

export interface NavigationItem {
  label: string
  path: string
  description?: string
  badge?: string | number
}
