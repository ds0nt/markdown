import axios from 'axios'
import { API_URL } from '../core/constants'
import validator from 'validator'

function validate(data) {
}

let endpoint = API_URL + '/documents'
export default {
  sync   : ()       => axios.get( endpoint ),
  fetch  : (id)     => axios.get( endpoint + `/${id}` ),
  create : (data)     => axios.post( endpoint, data ),
  update : (id, data) => axios.put( endpoint + `/${id}`, data ),
  delete : (id)       => axios.delete( endpoint + `/${id}` ),
}
