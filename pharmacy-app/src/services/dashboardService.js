import axios from 'axios';
import { API_BASE_URL } from '../config/api';
export async function getDashboard(signal) {
  const response = await axios.get(`${API_BASE_URL}/dashboard`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    signal, timeout: 15000,
  });
  return response.data.data;
}
