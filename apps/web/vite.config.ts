import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite (dev).
 *
 * - host: padrão 127.0.0.1 (somente esta máquina). Defina WEB_HOST=0.0.0.0
 *   (via .env ou variável de ambiente) para abrir no PC da equipe pela LAN.
 *   Não exponha à internet sem aprovação e HTTPS (ver AGENTS.md).
 * - fs.deny: mesmo com a Web na rede, o dev server NUNCA serve dados
 *   (`var/` com SQLite/anexos) nem arquivos de segredo (.env, chaves).
 * - Proxy /api -> API em 127.0.0.1:PORT: mesma origem no navegador, sem CORS
 *   e sem expor a API diretamente — ela NUNCA precisa sair daqui.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: process.env.WEB_HOST || '127.0.0.1',
    port: Number(process.env.WEB_PORT) || 5173,
    strictPort: true,
    fs: {
      deny: [
        '**/.env',
        '**/.env.*',
        '**/var/**',
        '**/*.db',
        '**/*.db-*',
        '**/*.sqlite',
        '**/*.sqlite-*',
        '**/*.crt',
        '**/*.pem',
        '**/*.key',
      ],
    },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${Number(process.env.PORT) || 3000}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
