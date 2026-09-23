import axios from "axios";
import { API_BASE_URL } from "../config/api";

export const loginUser = async (credentials) => {
  const response = await axios.post(
    `${API_BASE_URL}/auth/login`,
    { ...credentials, email: credentials.email.trim().toLowerCase() },
    { timeout: 15000 }
  );

  return response.data;
};

export const registerUser = async (userData)=>{
    const response = await axios.post(
        `${API_BASE_URL}/auth/register`,
        { ...userData, email: userData.email.trim().toLowerCase() },
        { timeout: 15000 }
    );
    
    return response.data;
}

export const getProfile = async (token) => {
  const response = await axios.get(`${API_BASE_URL}/auth/me`, {
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return response.data;
}
export function authErrorMessage(error, fallback) {
  if (!error.response) return 'Cannot reach the server. Check your connection and try again.';
  return error.response.data?.message || fallback;
}
