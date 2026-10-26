import { httpApi } from './request'
export interface CatalogOption { code: string; name: string; category_code?: string; category_name?: string; kind?: string; source_version?: string }
export interface InstitutionOption extends CatalogOption { province: string; city: string; level: string }
export interface DisciplineSettings { configured: boolean; codes: string[]; version: number }
export interface ImportPreview { fingerprint: string; disciplines: {added:number;changed:number;unchanged:number}; institutions: {added:number;changed:number;unchanged:number}; sources: Array<{name:string;version:string;url:string}> }
export const getDisciplines = () => httpApi.get<CatalogOption[]>('/catalog/disciplines')
export const getMyDisciplines = () => httpApi.get<CatalogOption[]>('/catalog/my-disciplines')
export const getDisciplineSettings = () => httpApi.get<DisciplineSettings>('/school-admin/discipline-settings')
export const saveDisciplineSettings = (codes:string[], expected_version:number) => httpApi.put<DisciplineSettings>('/school-admin/discipline-settings',{codes,expected_version})
export const searchInstitutions = (q:string) => httpApi.get<InstitutionOption[]>(`/system/institutions?q=${encodeURIComponent(q)}`)
export const previewCatalogImport = () => httpApi.post<ImportPreview>('/system/catalog-import:preview',{})
export const applyCatalogImport = (fingerprint:string) => httpApi.post<ImportPreview>('/system/catalog-import:apply',{fingerprint})
