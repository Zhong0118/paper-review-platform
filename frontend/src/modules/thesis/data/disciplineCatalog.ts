import type { DisciplineCatalogEntry } from '../types'

import catalog from './graduate-disciplines-2022.json'

export const disciplineCatalog = catalog.entries as DisciplineCatalogEntry[]

export function searchDisciplines(query: string): DisciplineCatalogEntry[] {
  const keyword = query.trim().toLocaleLowerCase('zh-CN')
  if (!keyword) return [...disciplineCatalog]

  return disciplineCatalog.filter((entry) =>
    [entry.code, entry.name, ...entry.aliases].some((value) =>
      value.toLocaleLowerCase('zh-CN').includes(keyword),
    ),
  )
}
