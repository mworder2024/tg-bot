import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js';
import { useTheme } from '@mui/material/styles';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

export const RealtimeChart: React.FC = () => {
  const theme = useTheme();

  // Generate sample data for the last 24 hours
  const hours = Array.from({ length: 24 }, (_, i) => {
    const hour = new Date();
    hour.setHours(hour.getHours() - (23 - i));
    return hour.toLocaleTimeString('en-US', { hour: '2-digit', minute: '0' });
  });

  const data = {
    labels: hours,
    datasets: [
      {
        label: 'Games',
        data: hours.map(() => Math.floor(Math.random() * 50) + 10),
        borderColor: theme.palette.primary.main,
        backgroundColor: theme.palette.primary.light + '20',
        tension: 0.4,
      },
      {
        label: 'Players',
        data: hours.map(() => Math.floor(Math.random() * 100) + 50),
        borderColor: theme.palette.success.main,
        backgroundColor: theme.palette.success.light + '20',
        tension: 0.4,
      },
      {
        label: 'Payments',
        data: hours.map(() => Math.floor(Math.random() * 30) + 5),
        borderColor: theme.palette.warning.main,
        backgroundColor: theme.palette.warning.light + '20',
        tension: 0.4,
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          color: theme.palette.text.primary,
        },
      },
      tooltip: {
        mode: 'index',
        intersect: false,
      },
    },
    scales: {
      x: {
        grid: {
          color: theme.palette.divider,
        },
        ticks: {
          color: theme.palette.text.secondary,
        },
      },
      y: {
        grid: {
          color: theme.palette.divider,
        },
        ticks: {
          color: theme.palette.text.secondary,
        },
      },
    },
  };

  return <Line data={data} options={options} />;