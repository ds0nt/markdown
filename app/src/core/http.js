import { API_URL } from './constants'
import AuthStore from '../stores/auth'
import axios from 'axios'
import assign from 'object-assign'
import {errorFromXHR} from './errors'

//
// HTTP Verbs
//

let iox = method =>
  ([url], options={}) =>
    (data) => {
      let headers = {}
      let { token } = AuthStore.getState()
      if (token) {
        headers.Authorization = `Token ${token}`
      }
      return axios({
        url: `${API_URL}${url}`,
        data,
        options: assign(headers, options),
        method
      })
  }

  // Add a response interceptor
axios.interceptors.response.use(res => res, err => Promise.reject(errorFromXHR(err)))

export default {
  get: iox('GET'),
  post: iox('POST'),
  put: iox('PUT'),
  delete: iox('DELETE'),
  patch: iox('PATCH'),
}
