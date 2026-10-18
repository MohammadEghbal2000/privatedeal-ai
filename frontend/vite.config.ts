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
      // DealOS DealGraph API (npm run dealos, port 3201), preview only.
      "/dealos": {
        target: "http://127.0.0.1:3201",
        changeOrigin: true,
        rewrite: path => path.replace(/^\/dealos/, ""),
        // That API accepts only the dashboard's own origin. Behind
        // Codespaces port forwarding the browser's origin is the forwarded
        // address, so a same-origin request is passed on as the local
        // dashboard; any other origin is left as it is and refused.
        configure: proxy => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const origin = req.headers.origin;
            if (!origin) return;
            const forwarded = req.headers["x-forwarded-host"];
            const hosts = [
              ...(Array.isArray(forwarded) ? forwarded : [forwarded ?? ""]).flatMap(h => h.split(",")),
              req.headers.host ?? "",
            ].map(h => h.trim()).filter(Boolean);
            try {
              if (hosts.includes(new URL(origin).host)) {
                proxyReq.setHeader("origin", "http://127.0.0.1:5173");
              }
            } catch {
              // "null" or a malformed origin: leave it to be refused.
            }
          });
        },
      },
    },
  },
});
