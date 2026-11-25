# Hunt Tracker

Installable iPhone web app (PWA) for whitetail, turkey and bear hunting.

- GPS map (satellite, USGS topo, hybrid, street), waypoints with 16 hunting types, long-press to drop a pin
- Trail recording and blood-trail mode with marked blood spots; follow back to start
- Go-to navigation with distance, bearing and compass arrow
- 7-day hunt forecast per species: moon phase, solunar major/minor periods, PA legal shooting hours,
  wind, pressure trend, temperature, rain, rut timing, and stand picks matched to each stand's good winds
- Hunt log with one-tap sightings, auto weather and moon snapshot, and insights by stand, wind, moon phase and time of day
- Backup and restore (JSON), GPX export and import (onX, Gaia, Garmin)

## Deploy (GitHub Pages)
1. Create a repo and upload these files to the root.
2. Settings → Pages → Deploy from branch → `main` / root.
3. On iPhone, open the Pages URL in Safari → Share → Add to Home Screen.

HTTPS is required for GPS and offline mode; GitHub Pages provides it.
Weather: Open-Meteo (free, no key). Moon and sun: SunCalc. Map: Leaflet.
Legal hours are PA defaults — verify against the current PGC Hunting & Trapping Digest.
