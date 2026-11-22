# CAK3Dvision: API keys

Fill the keys into `G:\CAK3Dvision\.env.new-keys`, which is git-ignored, then ask Claude to merge them into `.env` and restart the server.

## Already set (copied from Hack-Top)

Google Maps, Cesium ion, TomTom, NASA FIRMS and AISStream.

## Still missing

| # | Key (`.env` name) | What it turns on | Cost | Where to get it |
|---|---|---|---|---|
| 1 | **OpenSky** (`OPENSKY_CLIENT_ID` + `OPENSKY_CLIENT_SECRET`) | More flight-polling credits. Flights already work anonymously. | Free | Make an account at [opensky-network.org](https://opensky-network.org). Then go to **Account → API Client** and create a client. It gives you both the ID and the secret. |
| 2 | **Mapillary** (`MAPILLARY_CLIENT_TOKEN`) | Street Level photo coverage and photos | Free | [mapillary.com/dashboard/developers](https://www.mapillary.com/dashboard/developers). Register an application with **Read** access, then copy its **Client Token** (starts with `MLY\|`). |
| 3 | **World News API** (`WORLDNEWSAPI_KEY`) | News layer → **Local** (the news of the country in view) | Free plan: 50 points/day. The app caps itself at 30 reads/day, about 45 points. | [worldnewsapi.com/console](https://worldnewsapi.com/console/). Its terms say caching needs their written permission, and the app caches each country for up to 1 hour. |
| 4 | **Gemini** (`GEMINI_API_KEY`) | Gemini Live voice control and typed chat | Has a free tier, then metered | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| 5 | **OpenAI** (`OPENAI_API_KEY`) | Voice control (Realtime) and the AI HUD summary | **Metered, pay per use** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys). Set a monthly budget under **Settings → Limits** before you use it. |
| 6 | **Google server key** (`GOOGLE_MAPS_SERVER_API_KEY`), optional | Bills place search apart from the 3D tiles, so each can get its own cap | Metered (same Google billing account) | [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Create API key. Restrict it to the **Places API** only. |
| 7 | **Liveuamap** (`LIVEUAMAP_API_KEY`), skip unless wanted | Precise conflict points in the News layer. Conflicts already works through GDELT without it. | **Paid subscription** | [liveuamap.com/promo/api](https://liveuamap.com/promo/api) |
| 8 | **Launch Library 2** (`LL2_API_TOKEN`), skip unless wanted | Higher rocket-launch request limits. Works without a key. | **Paid** (Patreon); there's no free key | [thespacedevs.com/supportus](https://thespacedevs.com/supportus) |

Suggested order: 1 to 3 are free and quick. 4 and 5 are only worth getting if you want to talk to the globe. 7 and 8 cost money and add little.

## Where your existing keys' limits live

These are the places to set hard caps, so a provider stops you before you go over.

- **Google Maps (3D tiles, Street View, places):** [Google Cloud Console](https://console.cloud.google.com/).
  - **Billing → Budgets & alerts** sends email alerts at whatever percentages you choose.
  - **APIs & Services → Map Tiles API → Quotas** lets you set a hard requests-per-day cap. Do the same for Places and Street View.
  - Under **Credentials**, restrict the browser key to the Map Tiles API and Maps JavaScript API, with an HTTP-referrer restriction for `https://nukebox.tailac984b.ts.net:4173/*`.
- **Cesium ion:** [ion.cesium.com](https://ion.cesium.com/) → Usage shows your monthly streaming and storage against the Community plan quota.
- **TomTom:** [my.tomtom.com](https://my.tomtom.com/) → Dashboard shows usage. The app also stops itself at 6,000 tiles/day (`TOMTOM_DAILY_TILE_BUDGET`).
- **NASA FIRMS / AISStream:** free with fair-use rate limits, no billing.
- **OpenAI:** platform.openai.com → Settings → Limits (monthly budget and alert). **Gemini:** AI Studio / Cloud Console quotas.

## Usage dashboard

Open **https://nukebox.tailac984b.ts.net:4173/usage** to see calls per key today and this month against your limits. Type a per-day or per-month limit and press Save.

- Server-side keys with **Hard stop** on are refused locally once they reach a limit, so they cannot bill past it.
- Browser-side keys (Google 3D tiles, Cesium) are counted only. Cap those in the provider console links above.
- The globe shows a small pill at the top when anything reaches 80%.
