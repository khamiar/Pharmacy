import axios from 'axios';
import { API_BASE_URL } from '../config/api';
export async function catalogRequest(resource, { method = 'GET', id = '', action = '', data, params, signal } = {}) {
  const response = await axios({
    url: `${API_BASE_URL}/${resource}${id ? `/${id}` : ''}${action ? `/${action}` : ''}`,
    method, data, params, signal, timeout: 15000,
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
  });
  return response.data.data;
}
export function catalogError(error) {
  return error.response?.data?.message || 'Unable to reach the server. Check your connection and try again.';
}
