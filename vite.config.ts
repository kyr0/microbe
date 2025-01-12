import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'esnext', // Ensure modern JS features are supported
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    open: true, // Automatically open the browser
  },
  plugins: [
    {
      name: 'vite-plugin-enable-crossOriginIsolated',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          next();
        });
      },
    },
  ],
});