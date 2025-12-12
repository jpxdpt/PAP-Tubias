import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // Port 6000 é bloqueada por alguns browsers (ERR_UNSAFE_PORT). Usamos 5173.
    port: 5173,
  },
})
