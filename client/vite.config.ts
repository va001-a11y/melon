import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The launcher picks free ports and passes them in, so Melon never collides
// with another project (5173 is also Vite's default). Falls back to the
// usual pair when run directly with `npm run dev`.
const clientPort = Number(process.env.MELON_CLIENT_PORT) || 5173;
const serverPort = Number(process.env.VEDAI_SERVER_PORT) || 5175;

export default defineConfig({
  plugins: [react()],
  server: {
    port: clientPort,
    // Bind explicitly to IPv4. On Windows "localhost" often resolves to IPv6
    // ::1 first, which silently breaks the proxy below and surfaces in the app
    // as "Server not reachable" even though the server is running fine.
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${serverPort}`,
        changeOrigin: true,
      },
    },
  },
});
