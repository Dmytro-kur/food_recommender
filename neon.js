import { createClient } from "@neondatabase/neon-js";

const authUrl = import.meta.env.VITE_NEON_AUTH_URL?.trim();
const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL?.trim();

export const neonConfigured = Boolean(authUrl && dataApiUrl);

export const neonClient = neonConfigured
  ? createClient({
      auth: {
        url: authUrl,
      },
      dataApi: {
        url: dataApiUrl,
      },
    })
  : null;
