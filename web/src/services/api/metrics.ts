import authClient from './auth';
import { ApiResponse, RealtimeMetrics } from '../../types';

export const fetchRealtimeMetrics = async (): Promise<ApiResponse<RealtimeMetrics>> => {
  try {
    const response = await authClient.get('/metrics/realtime');
    return response.data;
  } catch (error: any) {
    return {
      success: false,
      error: {
        message: error.response?.data?.error?.message || 'Failed to fetch metrics',
        code: 'METRICS_ERROR',
      },
    };
  }
};

export const fetchSystemMetrics = async (): Promise<ApiResponse<any>> => {
  try {
    const response = await authClient.get('/metrics/system');
    return response.data;
  } catch (error: any) {
    return {
      success: false,
      error: {
        message: error.response?.data?.error?.message || 'Failed to fetch system metrics',
        code: 'SYSTEM_METRICS_ERROR',
      },
    };
  }
};

export const fetchPrometheusMetrics = async (): Promise<string> => {
  try {
    const response = await authClient.get('/metrics/prometheus', {
      headers: {
        'Accept': 'text/plain',
      },
    });
    return response.data;
  } catch (error: any) {
    return '';
  }
};