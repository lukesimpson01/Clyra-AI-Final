import { defineConfig } from 'vite';
import { localApi } from './server/localApi.js';

export default defineConfig({
  plugins: [{
    name: 'frame-local-api',
    configureServer(server) { server.middlewares.use('/api', localApi); },
    configurePreviewServer(server) { server.middlewares.use('/api', localApi); },
  }],
});
