import axios from 'axios'

import http, { httpApi } from './request'

export function prepareUpload(payload: {
  thesis_id: string
  purpose: 'original' | 'anonymous'
  filename: string
  content_type: string
}) {
  return httpApi.post<{ file_id: string; upload_url: string; purpose: string }>(
    '/files:prepare-upload',
    payload,
  )
}

export async function uploadFileContent(uploadUrl: string, file: Blob, token: string) {
  await axios.put(uploadUrl, file, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type || 'application/octet-stream' },
  })
}

export function completeUpload(fileId: string, revision: string) {
  return httpApi.post<{ file_id: string; sha256: string | null; content_revision: string }>(`/files/${fileId}:complete`, undefined, {headers:{'If-Draft-Revision':revision}})
}

export async function uploadThesisFile(options: {
  revision: string
  thesisId: string
  purpose: 'original' | 'anonymous'
  file: File
  token: string
}) {
  const prepared = await prepareUpload({
    thesis_id: options.thesisId,
    purpose: options.purpose,
    filename: options.file.name,
    content_type: options.file.type || 'application/pdf',
  })
  await uploadFileContent(prepared.upload_url, options.file, options.token)
  return completeUpload(prepared.file_id, options.revision)
}


// Use the authenticated, audited content endpoint; never persist file bytes or URLs.
export async function getFileContent(fileId: string): Promise<Blob> {
  const response = await http.get<Blob>(`/files/${fileId}/content`, { responseType: 'blob' })
  return response.data
}
