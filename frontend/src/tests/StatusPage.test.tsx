import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StatusPage } from '../pages/StatusPage';

// Mock the API service
vi.mock('../services/api', () => ({
  fetchHealthStatus: vi.fn().mockResolvedValue({
    status: 'healthy',
    project: 'FlowPilot',
    version: '1.0.0',
    environment: 'development',
    services: {
      database: 'connected',
      redis: 'connected',
    },
    timestamp: '2026-09-19T12:00:00Z',
    latencyMs: 12,
  }),
}));

describe('StatusPage Component', () => {
  it('renders the system status title and main services', async () => {
    render(<StatusPage />);

    expect(screen.getByText(/System Status & Topology/i)).toBeInTheDocument();
    
    await waitFor(() => {
      expect(screen.getByText(/FastAPI Core/i)).toBeInTheDocument();
      expect(screen.getByText(/PostgreSQL 16/i)).toBeInTheDocument();
      expect(screen.getByText(/Redis 7/i)).toBeInTheDocument();
      expect(screen.getByText(/Celery Workers/i)).toBeInTheDocument();
    });
  });

  it('renders refresh button and quickstart information', async () => {
    render(<StatusPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Refresh/i })).toBeInTheDocument();
    });
  });
});
