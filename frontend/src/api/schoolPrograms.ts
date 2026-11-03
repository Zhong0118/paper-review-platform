import {httpApi} from './request'

export interface ProgramKey {catalog_id:string;code:string}
export interface ProgramOption {code:string;name:string;official_code:string;official_name:string}
export interface ProgramOptions {catalog_id:string|null;items:ProgramOption[]}
export interface SavedProgram extends ProgramKey {name:string;year:number;revision:number}
export interface CatalogVersion {id:string;year:number;revision:number;count:number;source:string;source_version:string;published_at:string}
export interface ImportInput {year:number;source:string;source_version:string;csv:string}
interface Entry {name:string;official_code:string;official_name:string;active:boolean;source:string;source_version:string}
export interface CatalogPreview {revision:number;retained:number;fingerprint:string|null;errors:string[];
  changes:Array<{code:string;action:string;before:Entry|null;after:Entry}>}

const base='/school-admin/program-catalogs'
export const studentPrograms=(thesisId?:string)=>httpApi.get<ProgramOptions>('/catalog/student-programs',
  thesisId ? {params:{thesis_id:thesisId}} : undefined)
export const listProgramVersions=()=>httpApi.get<CatalogVersion[]>(base)
export const previewPrograms=(body:ImportInput)=>httpApi.post<CatalogPreview>(base+':preview',body)
export const publishPrograms=(body:ImportInput,fingerprint:string)=>httpApi.post<CatalogVersion>(base+':publish',{...body,fingerprint})
export const pinPrograms=(batchId:string,catalog_id:string,expected_version:number)=>
  httpApi.put(`/school-admin/batches/${batchId}/program-catalog`,{catalog_id,expected_version})
