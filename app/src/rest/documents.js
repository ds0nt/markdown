import http from '../core/http'
export default {
  sync   : ()       => http.get('/documents'),
  fetch  : (id)     => http.get('/documents/' + id),
  create : (data)     => http.post('/documents', data ),
  update : (id, data) => http.put('/documents/' + id, data ),
  delete : (id)       => http.delete('/documents/' + id),
}
