import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], base: './', server: { host: '127.0.0.1', port: 5174, strictPort: true }, build: { outDir: 'dist' }, test: { include: ['tests/unit/**/*.test.ts?(x)'], environment: 'jsdom', setupFiles: './src/renderer/test/setup.ts', css: true } });
