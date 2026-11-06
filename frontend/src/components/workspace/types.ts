/** 工作空间外壳的展示数据；来自登录用户与 portalMenus，不另造权限。 */
export interface WorkspaceAccount {
  name: string
  username: string
  role: string
  /** 服务端返回的学校代码；不猜学校名称 */
  org: string
}

export interface NavItem {
  label: string
  to?: string
  count?: number
  active?: boolean
  /** 选图标用的真实路径；链接被改写时（原型）保留原路径，默认取 to */
  iconKey?: string
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

/** 保存状态：只有服务器确认最新内容时才是 saved */
export type DraftState = 'clean' | 'dirty' | 'saving' | 'saved' | 'failed' | 'conflict' | 'locked'
