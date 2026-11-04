export interface ProtoAccount {
  name: string
  username: string
  role: string
  /** 服务端返回的学校代码；平台级账号写“平台级账号”。不猜学校名称。 */
  org: string
}

export interface NavItem {
  label: string
  to?: string
  count?: number
  active?: boolean
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

export interface MockPage {
  heading?: string
  lines: string[]
}
