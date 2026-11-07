import { httpApi, type RequestOptions } from './request'
import { optionArgs } from './optionArgs'
export interface CatalogOption { code: string; name: string; category_code?: string; category_name?: string; kind?: string; source_version?: string }
export interface InstitutionOption extends CatalogOption { province: string; city: string; level: string }
export interface DisciplineSettings { configured: boolean; codes: string[]; version: number }
export interface ImportPreview { fingerprint: string; disciplines: {added:number;changed:number;unchanged:number}; institutions: {added:number;changed:number;unchanged:number}; sources: Array<{name:string;version:string;url:string}> }
export const getDisciplines = (options?:RequestOptions) => httpApi.get<CatalogOption[]>('/catalog/disciplines', ...optionArgs(options))
export const getMyDisciplines = () => httpApi.get<CatalogOption[]>('/catalog/my-disciplines')
export const getDisciplineSettings = (options?:RequestOptions) => httpApi.get<DisciplineSettings>('/school-admin/discipline-settings', ...optionArgs(options))
export const saveDisciplineSettings = (codes:string[], expected_version:number, options?:RequestOptions) => httpApi.put<DisciplineSettings>('/school-admin/discipline-settings',{codes,expected_version}, ...optionArgs(options))
export const searchInstitutions = (q:string, options?:RequestOptions) => httpApi.get<InstitutionOption[]>(`/system/institutions?q=${encodeURIComponent(q)}`, ...optionArgs(options))
export const previewCatalogImport = (options?:RequestOptions) => httpApi.post<ImportPreview>('/system/catalog-import:preview',{}, ...optionArgs(options))
export const applyCatalogImport = (fingerprint:string, options?:RequestOptions) => httpApi.post<ImportPreview>('/system/catalog-import:apply',{fingerprint}, ...optionArgs(options))
