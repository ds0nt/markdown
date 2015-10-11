import http from '../core/http'
export default {
  sync   : http.get`/api/documents`,
  fetch  : id => http.get`/api/documents/${id}`(),
  create : data => http.post`/api/documents`(data),
  update : id => http.put`/api/documents/${id}`(),
  delete : id => http.delete`/api/documents/${id}`(),
}
