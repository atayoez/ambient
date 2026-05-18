import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [
    // React Compiler (stable 1.0). Auto-memoizes components + hook
    // returns so manual React.memo / useMemo / useCallback aren't
    // needed in 95% of cases. The compiler runs as a Babel plugin
    // inside @vitejs/plugin-react's transform pipeline — no separate
    // build step. Bails out of any component that breaks the Rules
    // of React (mutating state, conditional hooks) so the worst case
    // is "this file doesn't get optimized," never broken behavior.
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', {}]],
      },
    }),
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
