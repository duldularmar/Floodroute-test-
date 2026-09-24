# FloodRoute

Flood-aware driving route planner for the Chennai corridor:
**SRM Ramapuram → Ramapuram → Porur → Guindy/Saidapet**.

Flood simulation, routing (A*), backend API, and frontend map UI come later.
This repository currently contains only the prepared geodata.

## Project structure

```text
FloodRoute/
├── data/
│   ├── raw/
│   │   ├── roads/                  # original OSM downloads (untouched)
│   │   └── elevation/              # original elevation downloads (untouched)
│   ├── processed/
│   │   ├── roads.geojson           # drivable road network (EPSG:4326)
│   │   └── elevation.tif           # terrain raster over the corridor (EPSG:4326)
│   ├── build_roads_geojson.py      # rebuilds processed/roads.geojson from raw quadrants
│   └── build_elevation_corridor.py # rebuilds processed/elevation.tif from raw terrain tiles
├── backend/
│   ├── main.py                     # FastAPI app: GET /, POST /api/route, POST /api/simulate
│   ├── routing.py                  # road graph + SRTM terrain risk + A* (stdlib only)
│   └── simulation.py               # simulated flood scenarios, levels, vehicles
├── frontend/                       # empty for now
├── README.md
└── .gitignore
```

## Data summary

### Roads — `data/processed/roads.geojson`

| | |
|---|---|
| Format | GeoJSON FeatureCollection (LineStrings) |
| CRS | EPSG:4326 / WGS84 (CRS84) |
| Features | 27,651 drivable ways |
| Coverage | lon 80.1108–80.2669, lat 12.9200–13.1139 (corridor + margins) |
| Classes | residential, service, tertiary, living_street, secondary, primary, trunk + links |
| Attributes | `osm_id`, `name`, `highway`, `surface`, `lanes`, `maxspeed`, `oneway`, `bridge`, `tunnel`, `layer`, `service`, `access`, `width` |

Excluded: footways, steps, paths, cycleways, pedestrian-only ways, and ways with
`access`/`motor_vehicle`/`motorcar = no/private`.

Raw sources (`data/raw/roads/`): 4 overlapping Overpass API JSON quadrants
(`osm_q1_sw` … `osm_q4_ne`, dedupe by OSM way id) and a bigger city extract
`planet_80.201_13.062_461dc6cd.osm.geojson(.xz)` kept for reference.

### Elevation — `data/processed/elevation.tif`

| | |
|---|---|
| Format | GeoTIFF, int16, uncompressed, single strip |
| CRS | EPSG:4326 / WGS84 |
| Dimensions | 1512 × 1656 px |
| Resolution | 0.000138889° ≈ 15.5 m |
| Bounds | lon 80.10–80.31, lat 12.91–13.14 (roads bbox fully inside) |
| Elevations | min −19 m, max 155 m, mean ≈ 11.7 m (coastal Chennai — plausible) |
| NoData | −32768 (6 px) |

Built from 25 SRTM-derived AWS Terrain Tiles (Mapzen/Nextzen *terrarium* encoding,
zoom 13) in `data/raw/elevation/terrain_tiles_z13/`, resampled from Web Mercator
to EPSG:4326 by `data/build_elevation_corridor.py`.

`data/raw/elevation/output_SRTMGL1.tif` is **not usable**: its crop
(lat 13.12–13.20) lies entirely north of the road corridor. Kept only as
provenance of the original download.

## Backend (routing + flood-simulation core)

```bash
python -m pip install fastapi uvicorn
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

- `POST /api/route` — single route. Body: `{"origin": {"lat": .., "lon": ..},
  "destination": {...}, "vehicle": "ambulance", "profile": "fastest|safest|high_ground",
  "flood_level": "LOW|MODERATE|SEVERE"}` (`flood_level` optional).
- `POST /api/simulate` — attaches a simulated flood scenario and returns active zones,
  affected/blocked roads and the fastest/safest/high-ground routes side by side.
  `flood_level` accepts the names or 1/2/3.

The graph (94,575 nodes / 197,409 directed edges) is built **once at startup**.
Flood state is attached to edges dynamically and never rewrites `roads.geojson`.
Route profiles are the same A* with different weights:
`fastest` (flood_weight 0), `safest` (flood 1.0 / terrain 0.5),
`high_ground` (flood 1.0 / terrain 1.5).

Vehicles (prototype thresholds): ambulance 0.30 m, fire_engine 0.45 m,
rescue_truck 0.55 m simulated flood depth.

**All flood zones, depths, severities and vehicle thresholds are simulated demo
values for the hackathon MVP — not official hydrological or vehicle specifications.**
Elevation comes from SRTM GL1 (~30 m native, upsampled) and is used as terrain
context (relative low/high ground), not as a flood predictor.

## Rebuilding the processed files

```bash
python data/build_roads_geojson.py       # requires only the standard library
python data/build_elevation_corridor.py  # requires only the standard library
```

Both scripts are pure Python (no GDAL/geopandas needed).

## Attribution

- Map/road data © [OpenStreetMap](https://www.openstreetmap.org) contributors,
  ODbL license.
- Terrain data: SRTM GL1 via AWS Terrain Tiles (Mapzen/Nextzen), public domain /
  NASA-derived.
