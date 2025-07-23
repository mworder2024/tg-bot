import axios from 'axios';
import { ApiResponse, User } from '../../types';

const API_BASE_URL = process.env.REACT_APP_API_URL || '/api/v1';

const authClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
authClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle auth errors
authClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: async (username: string, password: string): Promise<ApiResponse<{ user: User; token: string }>> => {
    try {
      const response = await authClient.post('/auth/login', { username, password });
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: error.response?.data?.error?.message || 'Login failed',
          code: 'LOGIN_ERROR',
        },
      };
    }
  },

  logout: async (): Promise<ApiResponse> => {
    try {
      const response = await authClient.post('/auth/logout');
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: error.response?.data?.error?.message || 'Logout failed',
          code: 'LOGOUT_ERROR',
        },
      };
    }
  },

  refresh: async (): Promise<ApiResponse<{ token: string }>> => {
    try {
      const response = await authClient.post('/auth/refresh');
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: error.response?.data?.error?.message || 'Token refresh failed',
          code: 'REFRESH_ERROR',
        },
      };
    }
  },

  me: async (): Promise<ApiResponse<User>> => {
    try {
      const response = await authClient.get('/auth/me');
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: error.response?.data?.error?.message || 'Failed to get user info',
          code: 'ME_ERROR',
        },
      };
    }
  },
};

export default authClient;