"""
FloodRoute simulated flood layer.

Everything here is a PROTOTYPE SIMULATION for hackathon demos:
- flood zones are synthetic polygons positioned over the real road corridor
- depths/severities/vehicle thresholds are demo values, NOT official
  hydrological, municipal, or vehicle-manufacturer specifications.

The layer attaches flood state to graph edges dynamically (routing.py
RoadGraph.set_flood_hits) and never rewrites data/processed/roads.geojson.
A deterministic GeoJSON export of the zones is written to
data/processed/flood_zones.geojson so other tools (e.g. the later frontend)
can visualize the same scenario.
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZONES_FILE = os.path.join(ROOT, 'data', 'processed', 'flood_zones.geojson')

# --------------------------------------------------------------------------- #
# Scenario levels: multipliers applied to each zone's base depth (prototype)
# --------------------------------------------------------------------------- #
LEVELS = {
    'LOW': 0.6,
    'MODERATE': 1.0,
    'SEVERE': 1.6,
}

# --------------------------------------------------------------------------- #
# Vehicle parameters (prototype demo values, not official specifications)
# max_flood_depth_m: simulated depth above which the vehicle will not attempt
# the road (edge cost becomes infinite / blocked).
# --------------------------------------------------------------------------- #
VEHICLES = {
    'ambulance':    {'max_flood_depth_m': 0.30},
    'fire_engine':  {'max_flood_depth_m': 0.45},
    'rescue_truck': {'max_flood_depth_m': 0.55},
}

# --------------------------------------------------------------------------- #
# Simulated flood zones for the default scenario.
# radius_m/depth_m are prototype values; positions were chosen on the real
# road corridors (SRM Ramapuram -> Porur -> Kathipara/Guindy -> Saidapet).
# --------------------------------------------------------------------------- #
SCENARIOS = {
    'ramapuram_flood': [
        {'id': 'flood_01', 'name': 'SRM Ramapuram front stretch (simulated)',
         'lon': 80.1805, 'lat': 13.0322, 'radius_m': 250, 'depth_m': 0.25, 'severity': 'moderate'},
        {'id': 'flood_02', 'name': 'Mount-Poonamallee Rd low stretch (simulated)',
         'lon': 80.19706, 'lat': 13.03100, 'radius_m': 280, 'depth_m': 0.40, 'severity': 'severe'},
        {'id': 'flood_03', 'name': 'Jaffer Street / south Guindy stretch (simulated)',
         'lon': 80.1970, 'lat': 13.0120, 'radius_m': 430, 'depth_m': 0.35, 'severity': 'moderate'},
        {'id': 'flood_04', 'name': 'Kathipara approach low ground (simulated)',
         'lon': 80.1990, 'lat': 13.0005, 'radius_m': 320, 'depth_m': 0.55, 'severity': 'severe'},
    ],
}


def circle_polygon(lon, lat, radius_m, n=28):
    """Approximate circle polygon (lon/lat) around a point."""
    rlat = radius_m / 110574.0
    rlon = radius_m / (111320.0 * math.cos(math.radians(lat)))
    return [[round(lon + rlon * math.cos(2 * math.pi * i / n), 6),
             round(lat + rlat * math.sin(2 * math.pi * i / n), 6)] for i in range(n)]


def build_zone_list(scenario='ramapuram_flood', flood_level='MODERATE'):
    """Return zones with geometry + effective (level-scaled) depth."""
    mult = LEVELS[str(flood_level).upper()]
    zones = []
    for z in SCENARIOS[scenario]:
        depth = round(z['depth_m'] * mult, 3)
        zones.append({'id': z['id'],
                      'name': z['name'],
                      'severity': z['severity'],
                      'depth_m': depth,
                      'base_depth_m': z['depth_m'],
                      'flood_level': str(flood_level).upper(),
                      'radius_m': z['radius_m'],
                      'polygon': circle_polygon(z['lon'], z['lat'], z['radius_m'])})
    return zones


def write_zones_geojson(zones, path=ZONES_FILE):
    """Deterministic GeoJSON export of the active simulated zones."""
    features = []
    for z in zones:
        ring = list(z['polygon'])
        ring.append(ring[0])  # close the ring
        features.append({
            'type': 'Feature',
            'geometry': {'type': 'Polygon', 'coordinates': [ring]},
            'properties': {'id': z['id'], 'name': z['name'], 'severity': z['severity'],
                           'depth_m': z['depth_m'], 'base_depth_m': z['base_depth_m'],
                           'flood_level': z['flood_level'], 'radius_m': z['radius_m'],
                           'simulated': True},
        })
    fc = {'type': 'FeatureCollection',
          'name': 'floodroute_simulated_flood_zones',
          'crs': {'type': 'name', 'properties': {'name': 'urn:ogc:def:crs:OGC:1.3:CRS84'}},
          'features': features}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(fc, f, ensure_ascii=False, separators=(',', ':'))
    print(f'[simulation] wrote {path} ({len(features)} simulated zones)')


def activate(graph, scenario='ramapuram_flood', flood_level='MODERATE',
             write_geojson=True):
    """Attach the simulated flood layer to the graph. Returns the zone list."""
    zones = build_zone_list(scenario, flood_level)
    graph.set_flood_hits(zones)
    if write_geojson:
        write_zones_geojson(zones)
    return zones


def zone_of_edge(attrs):
    return attrs.get('flood_zone')


def affected_roads(graph, limit=100):
    """Roads currently carrying simulated flood water (deduped by osm_id)."""
    out = {}
    for attrs in graph.edge_attrs:
        d = attrs.get('flood_depth_m') or 0.0
        if d <= 0:
            continue
        key = attrs.get('osm_id')
        name = attrs.get('name') or f"way {key if key is not None else '?'}"
        cur = out.get(key)
        if cur is None or d > cur['depth_m']:
            out[key] = {'name': name, 'depth_m': d, 'flood_risk': attrs.get('flood_risk'),
                        'zone': attrs.get('flood_zone')}
    lst = sorted(out.values(), key=lambda x: -x['depth_m'])
    return lst[:limit]


def blocked_roads(graph, vehicle='ambulance', limit=100):
    """Flooded roads exceeding a vehicle's prototype depth threshold."""
    vlim = VEHICLES[vehicle]['max_flood_depth_m']
    out = {}
    for attrs in graph.edge_attrs:
        d = attrs.get('flood_depth_m') or 0.0
        if d <= vlim:
            continue
        key = attrs.get('osm_id')
        name = attrs.get('name') or f"way {key if key is not None else '?'}"
        cur = out.get(key)
        if cur is None or d > cur['depth_m']:
            out[key] = {'name': name, 'depth_m': d, 'vehicle': vehicle,
                        'vehicle_limit_m': vlim, 'zone': attrs.get('flood_zone')}
    lst = sorted(out.values(), key=lambda x: -x['depth_m'])
    return lst[:limit]


def zone_summary(zones):
    # polygon included so the frontend can draw the zones on a map
    return [{'id': z['id'], 'name': z['name'], 'severity': z['severity'],
             'depth_m': z['depth_m'], 'radius_m': z['radius_m'],
             'flood_level': z['flood_level'], 'polygon': z['polygon']} for z in zones]
