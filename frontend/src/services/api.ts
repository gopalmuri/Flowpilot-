export interface HealthServices {
  database: string;
  redis: string;
  [key: string]: string;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unavailable';
  project: string;
  version: string;
  environment: string;
  services: HealthServices;
  timestamp: string;
  latencyMs?: number;
}

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || '';

export async function fetchHealthStatus(): Promise<HealthResponse> {
  const startTime = performance.now();
  try {
    const url = `${API_BASE_URL}/api/v1/health`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });
    const latencyMs = Math.round(performance.now() - startTime);

    if (!response.ok) {
      return {
        status: 'degraded',
        project: 'FlowPilot',
        version: '1.0.0',
        environment: 'development',
        services: { database: 'unknown', redis: 'unknown' },
        timestamp: new Date().toISOString(),
        latencyMs,
      };
    }

    const data = await response.json();
    return {
      ...data,
      latencyMs,
    };
  } catch (_error) {
    const latencyMs = Math.round(performance.now() - startTime);
    return {
      status: 'unavailable',
      project: 'FlowPilot',
      version: '1.0.0',
      environment: 'development',
      services: { database: 'disconnected', redis: 'disconnected' },
      timestamp: new Date().toISOString(),
      latencyMs,
    };
  }
}
