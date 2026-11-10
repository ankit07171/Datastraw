// Thin fetch wrapper. In dev VITE_API_URL is empty and Vite proxies /api to Express;
// in production set VITE_API_URL to the deployed API (e.g. https://roster-api.onrender.com/api).
const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '') || '/api';

export class ApiError extends Error {
  status: number;
  details?: any;
  constructor(status: number, message: string, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, `Can't reach the API at ${BASE}. Is the server running?`);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText, data.details);
  return data as T;
}

export const api = {
  get: <T>(p: string) => req<T>('GET', p),
  post: <T>(p: string, b?: unknown) => req<T>('POST', p, b ?? {}),
  put: <T>(p: string, b: unknown) => req<T>('PUT', p, b),
  patch: <T>(p: string, b: unknown) => req<T>('PATCH', p, b),
  del: (p: string) => req<void>('DELETE', p),
  url: (p: string) => BASE + p, // for plain links such as the CSV download
};
