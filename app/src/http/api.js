import http from '../core/http'

export default {
  login: http.post `/auth/login`,
  register: http.post `/auth/register`,
  syncDocuments  : http.get `/api/documents`,
  fetchDocument  : id => http.get(`/api/documents/${id}`)(),
  createDocument : data => http.post(`/api/documents`)(data),
  updateDocument : (id, data) => http.put(`/api/documents/${id}`)(data),
  deleteDocument : id => http.delete(`/api/documents/${id}`)(),
  importUrl: data => http.post `/api/importurl` (data),
}
