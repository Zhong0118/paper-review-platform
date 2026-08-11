export interface DisciplineOption {
  code: string
  name: string
  parentCode?: string
}

export type DisciplineCatalogType = 'ACADEMIC' | 'PROFESSIONAL'

export interface DisciplineCatalogEntry extends DisciplineOption {
  categoryCode: string
  categoryName: string
  type: DisciplineCatalogType
  aliases: string[]
}
