import http from '../core/http'

export default {
  login: http.post `/auth/login`,
  register: http.post `/auth/register`,
}
