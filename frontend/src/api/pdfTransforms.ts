import { httpApi } from './request'
import { prepareUpload, uploadFileContent } from './files'
export type PdfPurpose = 'original' | 'anonymous'
export type PdfOperation = 'MERGE' | 'EXTRACT' | 'DELETE_PAGES'
export interface PdfTransform {operation_id:string;new_file_id:string;page_count:number;source_version:string;status:'READY'|'APPLIED'|'CANCELLED'}
export interface PdfTransformRequest {expected_version:number;purpose:PdfPurpose;operation:PdfOperation;sources:{file_id:string;pages:number[]}[]}
export const generatePdfTransform = (thesisId:string, body:PdfTransformRequest, key:string) =>
  httpApi.post<PdfTransform>(`/theses/${thesisId}/pdf-transforms`, body, {idempotencyKey:key,timeout:85000})
export const applyPdfTransform = (id:string,version:number,revision:string) => httpApi.post<PdfTransform & {content_revision:string}>(`/pdf-transforms/${id}:apply`,{expected_version:version},{headers:{'If-Draft-Revision':revision}})
export const cancelPdfTransform = (id:string,version:number) => httpApi.post<PdfTransform>(`/pdf-transforms/${id}:cancel`,{expected_version:version})
export async function uploadTransformSource(thesisId:string,purpose:PdfPurpose,file:File,token:string){
 const prepared=await prepareUpload({thesis_id:thesisId,purpose,filename:file.name,content_type:'application/pdf'})
 await uploadFileContent(prepared.upload_url,file,token)
 await httpApi.post(`/files/${prepared.file_id}:complete-transform-source`)
 return prepared.file_id
}
