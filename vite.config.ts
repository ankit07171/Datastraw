import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the browser calls /api on the Vite origin and Vite forwards it to Express,
// so there are no CORS problems and VITE_API_URL is only needed in production.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
  test: { include: ['src/**/*.test.ts'] },
});
