/**
 * CAK3Dvision usage telemetry: which upstream URL belongs to which paid/quota'd
 * provider. One classifier for both sides: the server's own outgoing calls and
 * the browser-side calls the beacon reports (Google 3D tiles, Cesium ion, ...).
 */

/** Display metadata per provider. `side` says who makes the calls. */
export const PROVIDERS = Object.freeze({
  'google-3d-tiles': {
    label: 'Google Photorealistic 3D Tiles',
    key: 'GOOGLE_MAPS_API_KEY',
    side: 'browser',
    console: 'https://console.cloud.google.com/google/maps-apis/quotas',
    note: 'Billed by Google per root tileset request (the "root" row). Tile counts are for context.',
  },
  'google-places': {
    label: 'Google Places / Geocoding',
    key: 'GOOGLE_MAPS_SERVER_API_KEY or GOOGLE_MAPS_API_KEY',
    side: 'server',
    console: 'https://console.cloud.google.com/google/maps-apis/quotas',
  },
  'google-streetview': {
    label: 'Google Street View',
    key: 'GOOGLE_MAPS_API_KEY',
    side: 'both',
    console: 'https://console.cloud.google.com/google/maps-apis/quotas',
    note: 'Metadata lookups are free at Google; images and panoramas are billed.',
  },
  'google-maps-js': {
    label: 'Google Maps JavaScript API',
    key: 'GOOGLE_MAPS_API_KEY',
    side: 'browser',
    console: 'https://console.cloud.google.com/google/maps-apis/quotas',
  },
  'cesium-ion': {
    label: 'Cesium ion',
    key: 'CESIUM_ION_TOKEN',
    side: 'browser',
    console: 'https://ion.cesium.com/usage',
    note: 'Cesium bills by data streamed per month; bytes appear only when the CDN exposes them.',
  },
  tomtom: {
    label: 'TomTom Traffic',
    key: 'TOMTOM_API_KEY',
    side: 'server',
    console: 'https://my.tomtom.com/',
  },
  firms: {
    label: 'NASA FIRMS',
    key: 'FIRMS_MAP_KEY',
    side: 'server',
    console: 'https://firms.modaps.eosdis.nasa.gov/api/map_key/',
    note: 'Free; NASA rate-limits per 10 minutes.',
  },
  opensky: {
    label: 'OpenSky Network',
    key: 'OPENSKY_CLIENT_ID',
    side: 'server',
    console: 'https://opensky-network.org/',
    note: 'OpenSky meters credits per call (bigger areas cost more); this counts calls.',
  },
  openai: {
    label: 'OpenAI',
    key: 'OPENAI_API_KEY',
    side: 'both',
    console: 'https://platform.openai.com/usage',
    note: 'Billed by tokens and audio minutes; set the real cap at platform.openai.com Settings > Limits.',
  },
  gemini: {
    label: 'Google Gemini',
    key: 'GEMINI_API_KEY',
    side: 'both',
    console: 'https://aistudio.google.com/usage',
  },
  worldnewsapi: {
    label: 'World News API',
    key: 'WORLDNEWSAPI_KEY',
    side: 'server',
    console: 'https://worldnewsapi.com/console/',
    note: 'Free plan 50 points/day, about 1.5 points per read.',
  },
  liveuamap: {
    label: 'Liveuamap',
    key: 'LIVEUAMAP_API_KEY',
    side: 'server',
    console: 'https://liveuamap.com/promo/api',
  },
  ll2: {
    label: 'Launch Library 2',
    key: 'LL2_API_TOKEN',
    side: 'server',
    console: 'https://thespacedevs.com/',
  },
  mapillary: {
    label: 'Mapillary',
    key: 'MAPILLARY_CLIENT_TOKEN',
    side: 'both',
    console: 'https://www.mapillary.com/dashboard/developers',
  },
});

/**
 * Map an upstream URL to [providerId, metric], or null when it is not a
 * tracked provider.
 * @param {string|URL} input
 * @returns {[string, string] | null}
 */
export function classifyUsage(input) {
  let u;
  try {
    u = input instanceof URL ? input : new URL(String(input));
  } catch {
    return null;
  }
  const h = u.hostname.toLowerCase();
  const p = u.pathname;
  if (h === 'tile.googleapis.com')
    return ['google-3d-tiles', p.includes('/root.json') ? 'root' : 'tiles'];
  if (h === 'places.googleapis.com')
    return [
      'google-places',
      p.includes('searchNearby')
        ? 'nearby-search'
        : p.includes('searchText')
          ? 'text-search'
          : 'other',
    ];
  if (h === 'maps.googleapis.com') {
    if (p.startsWith('/maps/api/streetview/metadata'))
      return ['google-streetview', 'metadata'];
    if (p.startsWith('/maps/api/streetview'))
      return ['google-streetview', 'images'];
    if (p.startsWith('/maps/api/geocode')) return ['google-places', 'geocode'];
    if (p.startsWith('/maps/api/place')) return ['google-places', 'legacy'];
    if (p.startsWith('/maps/api/js')) return ['google-maps-js', 'loads'];
    return ['google-maps-js', 'other'];
  }
  if (h.endsWith('streetviewpixels-pa.googleapis.com'))
    return ['google-streetview', 'panorama-tiles'];
  if (h === 'generativelanguage.googleapis.com') return ['gemini', 'requests'];
  if (h === 'api.tomtom.com')
    return ['tomtom', p.includes('/tile/') ? 'tiles' : 'requests'];
  if (h === 'cesium.com' || h.endsWith('.cesium.com'))
    return ['cesium-ion', h.startsWith('api.') ? 'api' : 'assets'];
  if (h === 'firms.modaps.eosdis.nasa.gov') return ['firms', 'requests'];
  if (h === 'opensky-network.org' || h.endsWith('.opensky-network.org'))
    return ['opensky', h.startsWith('auth.') ? 'auth' : 'requests'];
  if (h === 'api.openai.com')
    return [
      'openai',
      p.includes('/realtime')
        ? 'realtime'
        : p.includes('/responses')
          ? 'responses'
          : p.includes('/chat')
            ? 'chat'
            : 'other',
    ];
  if (h === 'worldnewsapi.com' || h.endsWith('.worldnewsapi.com'))
    return ['worldnewsapi', 'reads'];
  if (h === 'liveuamap.com' || h.endsWith('.liveuamap.com'))
    return ['liveuamap', 'requests'];
  if (h === 'll.thespacedevs.com') return ['ll2', 'requests'];
  if (h.endsWith('.mapillary.com') && h !== 'www.mapillary.com')
    return ['mapillary', h.startsWith('tiles.') ? 'tiles' : 'requests'];
  return null;
}
