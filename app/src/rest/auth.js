import axios from 'axios'
import { API_URL } from '../core/constants'

export default {
  login: data => axios.get(`${API_URL}/auth/login`, data)
}
