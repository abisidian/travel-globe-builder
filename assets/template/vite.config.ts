import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 地球独立成包，先呈现界面，再按需加载三维渲染依赖。
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
          if (id.includes('node_modules/react-globe.gl/') || id.includes('node_modules/globe.gl/') || id.includes('node_modules/three-globe/')) return 'globe';
        },
      },
    },
  },
});
