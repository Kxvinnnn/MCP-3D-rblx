import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Disable failing default WebSocket in proxy/iframe mode, or use clientPort 443 when HMR is explicitly enabled.
      hmr: process.env.DISABLE_HMR === 'false' ? { clientPort: 443 } : false,
      // Disable file watching when HMR is disabled to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
