
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3100",
        changeOrigin: true,
      },
      // Agent chat server (npm run agents), separate from the deal backend.
      "/agent-api": {
        target: "http://127.0.0.1:3200",
        changeOrigin: true,
      },
    },
  },
});
