# Victoria Harbour Digital Twin Air Corridor — source code

This is the source code of the web demo for the capstone project *Digital Twin Air Corridor for Autonomous Low-Altitude Logistics at Victoria Harbour*. It is the same program as `VH_Digital_Twin_Air_Corridor_14_3Dmap.html`, split into separate files so it is easier to read and edit.

## How to run

- Open `index.html` in Chrome or Edge. No build step and no server are needed.
- Internet is needed only for live data and imagery: HKO wind and weather, Open-Meteo, satellite tiles and 3D buildings. Without it the demo falls back to an offline wind snapshot.
- The single-file version (`VH_Digital_Twin_Air_Corridor_14_3Dmap.html`) has everything inlined, so it can be sent as one file.

## File structure

```
index.html            page markup: panel, tabs, cards, overlays
css/style.css         project styles
js/app.js             all project logic (≈ 2,400 lines, see module map)
data/rfz_data.js      official eSUA Drone Map restricted flying zones, 288 polygons (advisory only)
vendor/               third-party libraries, unmodified
  leaflet.js / .css        Leaflet 1.9.4 (BSD-2-Clause): 2D map
  maplibre-gl.js / .css    MapLibre GL JS 4.7.1 (BSD-3-Clause): 3D map
  deck.gl.min.js           deck.gl 9.0.38 (MIT): 3D corridor layers on the 3D map
```

## Module map (`js/app.js`)

| Line | Section | What it does |
|---|---|---|
| 1 | 1. Map | Leaflet map, base layers |
| 22 | 2. Utilities | Distance and bearing, local XY projection, helpers |
| 88 | 3. Route endpoints | 7 ferry piers (PR-xxx) and HKO harbour stations |
| 130 | 5. Official RFZ | Draws the eSUA restricted zones, for reference only |
| 180 | 4. Waypoint graph | Access points (AC-xxx), `BASE_EDGES`, crossing detection, `GRAPH_EDGES` |
| 311 | 6. Wind field | HKO `latest_10min_wind.csv` → power-law height correction → IDW (1/d²) on u/v → wake factor; Open-Meteo and offline snapshot fallbacks |
| 523 | 7. Physical cost and A* | Edge cost = d / v_ground + junction queue W_q; A* search |
| 611 | 8. Layers | Direction-based layers: A 90 m (000–179°), B 110 m (180–359°), E 60 m (emergency) |
| 630 | View switch | 2D map / 3D map switch |
| 644 | Real 3D map | MapLibre + deck.gl: corridors at true altitude, ×1 / ×3 / ×10 heights |
| 816 | 9. Traffic simulation | Sim clock, strategic 4D booking (junction slots, pad window, trajectory probe, vertical take-off/landing column), tactical separation |
| 1313 | 9b. Emergency layer | Diversion via layer E, low-battery handling |
| 1524 | 10. Single-route planning | "Plan one route (A*)" and the route explanation card |
| 1567 | 11–12. Site data / wind card | Wind explanation card |
| 1672 | 13. Batch evaluation | Headless, reproducible conflict evaluation |
| 1673 | Fixed-fleet model | `fleetSim`: fixed fleet, charging, rebalancing (None / Reactive / Proactive), pier view, fleet-size sweep |
| 1990 | 14. Routing cost model | Distance-only vs physical-time cost comparison |
| 2060 | Guide & definitions | Help document, "?" explanations, live explanation cards |
| 2148 | Flight board | Status-bar numbers traced to individual UAVs, phase tags |
| 2307 | 15. HKO weather | Live temperature, humidity and warnings |
| 2369 | 16. Start-up | Initial rendering |

Line numbers are approximate and will shift as the code is edited.

## Key parameters

| Constant | Value | Meaning |
|---|---|---|
| `LEVEL_ALT` | A 90 m, B 110 m, E 60 m | Cruise and emergency layer heights |
| `VERTICAL_SEPARATION` | 15 m | Vertical buffer used in 4D booking |
| `UAV.battery_Wh` | 950 Wh | Battery pack, used by the energy model and fleet model |
| `UNLOAD_S` | 30 s | Time on the pad after touchdown |
| `DEP_PAD_MODE` | `'vertical'` | Take-off climb and landing descent at the same pier are separated in time |
| `EMG_RETRY_S` | 5 s | Re-check interval when no emergency diversion is feasible yet |
| Fleet model | 1.5 kW charging, 120 min, seed 2026, 20 % reserve | Fixed assumptions of the fleet panel |

## External data sources

| Source | URL | Used for |
|---|---|---|
| HKO 10-minute wind | `https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_wind.csv` | Wind at the 4 harbour stations |
| HKO open data | `https://data.weather.gov.hk/weatherAPI/opendata/weather.php` (`rhrread`, `warningInfo`) | Temperature, humidity, warnings |
| Open-Meteo | `https://api.open-meteo.com/v1/forecast` | Wind and weather fallback |
| Esri World Imagery | `server.arcgisonline.com` tiles | Satellite basemap |
| OpenFreeMap | `https://tiles.openfreemap.org/planet` | 3D building heights |
| eSUA Drone Map (CAD) | inlined in `data/rfz_data.js` | Restricted flying zones, advisory only |

## Note

The corridor network assumes no restricted flying zones. The RFZ layer shows the real zones for reference only; actual operation would need approval.
