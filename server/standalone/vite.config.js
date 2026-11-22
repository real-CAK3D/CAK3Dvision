import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { resolveAllowedHosts } from '../../build/allowedHosts.js';
import { createBrowserViteConfig } from '../../build/vite.js';
import { localProviderPlugins } from '../providers/local.js';
import { localMcpPlugin } from '../mcp/plugin.js';
import { apiNotFoundPlugin } from './api-not-found.js';
import { cak3dUsagePlugin } from '../cak3d/usage.js';
import { h2HostPlugin } from '../cak3d/h2Host.js';
import { conformanceReferencesPlugin } from './conformance-references.js';
import { googleTokenUnavailablePlugin } from './google-token-unavailable.js';
import { standaloneVoiceTools } from './voiceTools.js';
import { unwatchedRuntimeDirsPlugin } from './unwatched-cache.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Load this checkout's configuration and attach its local provider middleware. */
export function standaloneConfig(
  { command, mode },
  { nominatimStorageDir } = {},
) {
  const loaded = loadEnv(mode, root, '');
  for (const [key, value] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const tools = standaloneVoiceTools();
  const config = createBrowserViteConfig({
    plugins: [
      ...localProviderPlugins({
        realtime: { tools },
        gemini: { tools },
        nominatimStorageDir,
      }),
      localMcpPlugin(),
      googleTokenUnavailablePlugin(),
      conformanceReferencesPlugin(),
      cak3dUsagePlugin(),
      h2HostPlugin(),
      {
        // CAK3Dvision: Explorer locks the shortcut icons while showing them,
        // and a locked file makes Vite's watcher crash the server (EBUSY).
        name: 'cak3d-unwatched',
        apply: 'serve',
        config: () => ({
          server: { watch: { ignored: ['**/launcher/**', '**/.certs/**'] } },
        }),
      },
      apiNotFoundPlugin(),
      unwatchedRuntimeDirsPlugin(),
    ],
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY,
    cesiumToken: process.env.CESIUM_ION_TOKEN,
    photonUrl: process.env.PHOTON_URL,
    mapillaryToken: process.env.MAPILLARY_CLIENT_TOKEN,
    host: process.env.HOST,
    port: process.env.PORT,
    allowedHosts: resolveAllowedHosts(process.env.GEV_ALLOWED_HOSTS),
    command,
  });
  // CAK3Dvision: optional direct HTTPS (e.g. a `tailscale cert` pair), so the
  // app can be served on the tailnet without a forwarding proxy, which the
  // local request gates refuse on purpose. Unset = upstream behaviour.
  const certFile = process.env.GEV_HTTPS_CERT;
  const keyFile = process.env.GEV_HTTPS_KEY;
  if (certFile && keyFile && config.server) {
    config.server.https = {
      cert: readFileSync(resolve(root, certFile)),
      key: readFileSync(resolve(root, keyFile)),
    };
    config.server.fs?.deny?.push('**/.certs/**', '*.key');
  }
  return config;
}

export default defineConfig(standaloneConfig);
