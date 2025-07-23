import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { authApi } from '../services/api/auth';
import { setAuth, clearAuth } from '../store/slices/authSlice';
import { User } from '../types';
import { AppDispatch } from '../store';

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();

  const checkAuth = useCallback(async () => {
    const storedToken = localStorage.getItem('token');
    if (storedToken) {
      try {
        const response = await authApi.me();
        if (response.success && response.data) {
          setUser(response.data);
          setToken(storedToken);
          setIsAuthenticated(true);
          dispatch(setAuth({ user: response.data, token: storedToken }));
        } else {
          localStorage.removeItem('token');
        }
      } catch (error) {
        localStorage.removeItem('token');
      }
    }
    setLoading(false);
  }, [dispatch]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (username: string, password: string) => {
    const response = await authApi.login(username, password);
    if (response.success && response.data) {
      const { user, token } = response.data;
      localStorage.setItem('token', token);
      setUser(user);
      setToken(token);
      setIsAuthenticated(true);
      dispatch(setAuth({ user, token }));
      navigate('/dashboard');
    } else {
      throw new Error(response.error?.message || 'Login failed');
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('token');
      setUser(null);
      setToken(null);
      setIsAuthenticated(false);
      dispatch(clearAuth());
      navigate('/login');
    }
  };

  const refreshToken = async () => {
    try {
      const response = await authApi.refresh();
      if (response.success && response.data) {
        const { token } = response.data;
        localStorage.setItem('token', token);
        setToken(token);
        dispatch(setAuth({ user: user!, token }));
      } else {
        await logout();
      }
    } catch (error) {
      await logout();
    }
  };

  const value = {
    isAuthenticated,
    user,
    token,
    loading,
    login,
    logout,
    refreshToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};