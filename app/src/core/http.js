import { API_URL } from './constants'
import AuthStore from '../stores/auth'
import axios from 'axios'
import assign from 'object-assign'
import {errorFromXHR} from './errors'

//
// HTTP Verbs
//

let iox = method =>
  (url, options={}) =>
    (data) => {

      return axios({
        url: `${API_URL}${url}`,
        data,
        options,
        method
      })
  }

axios.interceptors.request.use(req => {
  let { token } = AuthStore.getState()
  if (token) {
    req.headers = {
      Authorization: `Token ${token}`
    }
  }
  return req
})
  // Add a response interceptor
axios.interceptors.response.use(res => res, err => Promise.reject(errorFromXHR(err)))

export default {
  get: iox('GET'),
  post: iox('POST'),
  put: iox('PUT'),
  delete: iox('DELETE'),
  patch: iox('PATCH'),
}
