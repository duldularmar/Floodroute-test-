"""
FloodRoute data prep: build data/processed/roads.geojson
Source: 4 raw Overpass JSON quadrants in data/raw/roads (inline node geometry + tags).

- Dedupe by OSM way id (quadrants overlap at their edges).
- Keep drivable road classes only (drop footway/steps/path/cycleway/pedestrian
  and non-road infrastructure). Respect access restrictions for cars.
- Carry routing-useful attributes; validate every coordinate.
Output: EPSG:4326 GeoJSON FeatureCollection of LineStrings.
"""
import json
import os

RAW_DIR = 'data/raw/roads'
QUADS = ['osm_q1_sw', 'osm_q2_se', 'osm_q3_nw', 'osm_q4_ne']
OUT = 'data/processed/roads.geojson'

# drivable highway classes (approximate OSM values used for car routing)
DRIVABLE = {
    'motorway', 'motorway_link',
    'trunk', 'trunk_link',
    'primary', 'primary_link',
    'secondary', 'secondary_link',
    'tertiary', 'tertiary_link',
    'unclassified', 'residential', 'living_street',
    'service', 'road',
}

KEEP_PROPS = ['name', 'highway', 'surface', 'lanes', 'maxspeed', 'oneway',
              'bridge', 'tunnel', 'layer', 'service', 'access', 'width']

# loose sanity window around Chennai (reject obviously bad coordinates)
LON_MIN, LON_MAX = 79.8, 80.5
LAT_MIN, LAT_MAX = 12.7, 13.7

ways = {}
dropped_class = {}
dropped_access = 0
dropped_geom = 0

for q in QUADS:
    path = os.path.join(RAW_DIR, q + '.json')
    d = json.load(open(path, encoding='utf-8'))
    for e in d.get('elements', []):
        if e.get('type') != 'way':
            continue
        wid = e.get('id')
        if wid in ways:
            continue  # duplicate from overlapping quadrants
        tags = e.get('tags', {}) or {}
        hw = tags.get('highway')
        if hw not in DRIVABLE:
            dropped_class[hw or '<none>'] = dropped_class.get(hw or '<none>', 0) + 1
            continue
        # car access: skip ways cars may not use
        mv = tags.get('motor_vehicle')
        mc = tags.get('motorcar')
        acc = tags.get('access')
        blocked = {'no', 'private'}
        mv_ok = mv not in blocked
        mc_ok = mc not in blocked
        acc_ok = acc not in blocked
        override = {'yes', 'permissive', 'destination'}
        if not ((mv_ok and mc_ok and acc_ok) or
                (mv in override) or (mc in override) or (acc in override and (mv_ok and mc_ok))):
            dropped_access += 1
            continue
        geom = e.get('geometry') or []
        coords = []
        ok = True
        for pt in geom:
            lon, lat = pt.get('lon'), pt.get('lat')
            if lon is None or lat is None:
                ok = False
                break
            if not (LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX):
                ok = False
                break
            coords.append((round(lon, 7), round(lat, 7)))
        if not ok or len(coords) < 2:
            dropped_geom += 1
            continue
        props = {'osm_id': wid}
        for k in KEEP_PROPS:
            if k in tags:
                props[k] = tags[k]
        ways[wid] = {'type': 'Feature',
                     'properties': props,
                     'geometry': {'type': 'LineString', 'coordinates': coords}}

features = list(ways.values())
fc = {'type': 'FeatureCollection',
      'name': 'floodroute_roads',
      'crs': {'type': 'name', 'properties': {'name': 'urn:ogc:def:crs:OGC:1.3:CRS84'}},
      'features': features}

os.makedirs('data/processed', exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(fc, f, ensure_ascii=False, separators=(',', ':'))

# ---- report ----
print(f'wrote {OUT} ({os.path.getsize(OUT)/1e6:.1f} MB)')
print('kept features:', len(features))
print('dropped by non-drivable class:', sum(dropped_class.values()))
print('dropped by car-access restriction:', dropped_access)
print('dropped by bad geometry:', dropped_geom)
print('dropped classes (top):', sorted(dropped_class.items(), key=lambda x: -x[1])[:12])

lons, lats, hw = [], [], {}
for ft in features:
    for c in ft['geometry']['coordinates']:
        lons.append(c[0]); lats.append(c[1])
    h = ft['properties'].get('highway')
    hw[h] = hw.get(h, 0) + 1
print('bbox:', (min(lons), min(lats), max(lons), max(lats)))
print('class distribution:', sorted(hw.items(), key=lambda x: -x[1]))

# landmark proximity spot-check (~220 m radius in degrees)
landmarks = [('SRM Ramapuram', 80.2105, 13.0539),
             ('Porur Jn', 80.2015, 13.0370),
             ('Guindy Kathipara', 80.2010, 12.9940),
             ('Saidapet', 80.2215, 13.0215)]
for name, lo, la in landmarks:
    n = 0
    for ft in features:
        for c in ft['geometry']['coordinates']:
            if abs(c[0] - lo) < 0.002 and abs(c[1] - la) < 0.002:
                n += 1
                break
    print(f'  ways within ~220 m of {name}: {n}')
