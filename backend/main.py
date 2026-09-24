"""
FloodRoute backend API (routing + simulated flood layer).

Run from the project root:
    uvicorn backend.main:app --host 127.0.0.1 --port 8000

The road graph is built once at startup and reused for every request; flood
conditions attach to edges dynamically and never rewrite roads.geojson.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import simulation
from .routing import get_graph, RouteNotFound, risk_label

# --------------------------------------------------------------------------- #
# Demo locations (approximate real coordinates; demo points, tweak freely)
# --------------------------------------------------------------------------- #
DEMO_LOCATIONS = {
    'srm_ramapuram': {'lat': 13.032649, 'lon': 80.179635, 'label': 'SRM Ramapuram (demo)'},
    'porur':         {'lat': 13.0370,   'lon': 80.2015,   'label': 'Porur (demo)'},
    'guindy':        {'lat': 12.9940,   'lon': 80.2010,   'label': 'Guindy / Kathipara (demo)'},
    'saidapet':      {'lat': 13.0215,   'lon': 80.2215,   'label': 'Saidapet (demo)'},
}

# route profiles -> A* weights (prototype values; terrain must not override flood)
ROUTE_PROFILES = {
    'fastest':     {'flood_weight': 0.0, 'terrain_weight': 0.0},
    'safest':      {'flood_weight': 1.0, 'terrain_weight': 0.5},
    'high_ground': {'flood_weight': 1.0, 'terrain_weight': 1.5},
}


class LatLng(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


class RouteRequest(BaseModel):
    origin: LatLng
    destination: LatLng
    vehicle: str = 'ambulance'
    profile: str = 'fastest'
    flood_level: str | None = None   # optional: attach simulated flood for this request


class SimulateRequest(BaseModel):
    scenario: str = 'ramapuram_flood'
    # accepts 'LOW'|'MODERATE'|'SEVERE' or 1/2/3 (1=LOW, 2=MODERATE, 3=SEVERE)
    flood_level: str | int = 'MODERATE'
    vehicle: str = 'ambulance'
    origin: LatLng
    destination: LatLng


def _normalize_level(value) -> str:
    """Map flood_level input (name or 1-based index) to a LEVELS key."""
    if isinstance(value, int) or (isinstance(value, str) and value.strip().isdigit()):
        idx = int(value)
        names = sorted(simulation.LEVELS)  # LOW, MODERATE, SEVERE
        if 1 <= idx <= len(names):
            return names[idx - 1]
        raise HTTPException(status_code=400,
                            detail=f'flood_level index {idx} out of range 1..{len(names)}')
    return str(value).strip().upper()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # build/load the graph once when the application starts
    app.state.graph = get_graph()
    yield


app = FastAPI(title='FloodRoute Routing Core', version='0.2.0', lifespan=lifespan)

# allow the vite dev server (and localhost tooling) to call the API directly
app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173'],
    allow_methods=['*'],
    allow_headers=['*'],
)


def _trim_edges(result, limit=50):
    return [{k: v for k, v in e.items()} for e in result['edges'][:limit]]


def _route_payload(result):
    return {
        'success': result['success'],
        'distance_km': result['distance_km'],
        'eta_minutes': result['eta_minutes'],
        'risk': result['risk'],
        'flood_exposure': result['flood_exposure'],
        'terrain_score': result['terrain_score'],
        'blocked_roads': result['blocked_roads'],
        'path': result['path'],
        'origin_node': result['origin_node'],
        'destination_node': result['destination_node'],
        'roads': _trim_edges(result),
    }


@app.get('/')
def root():
    g = app.state.graph
    return {
        'name': 'FloodRoute routing core',
        'status': 'ok',
        'graph': {
            'nodes': g.n_nodes,
            'directed_edges': g.n_edges,
            'total_km': round(g.total_km, 1),
        },
        'elevation': {
            'raster': 'loaded' if g.raster.ok else 'MISSING',
            'source': 'SRTM GL1 (~30 m native), upsampled during preprocessing',
            'range_m': [g.elev_min, g.elev_max],
        },
        'demo_locations': DEMO_LOCATIONS,
        'route_profiles': ROUTE_PROFILES,
        'vehicles': simulation.VEHICLES,
        'note': 'All flood depths, severities and vehicle thresholds are prototype '
                'simulation values, not official specifications.',
        'endpoints': {
            'route': 'POST /api/route  {"origin": {...}, "destination": {...}, '
                     '"vehicle": "ambulance", "profile": "fastest|safest|high_ground"}',
            'simulate': 'POST /api/simulate  {"scenario": "ramapuram_flood", '
                        '"flood_level": "LOW|MODERATE|SEVERE", "vehicle": "ambulance", '
                        '"origin": {...}, "destination": {...}}',
        },
    }


def _resolve_vehicle(name: str):
    if name not in simulation.VEHICLES:
        raise HTTPException(status_code=400,
                            detail=f"unknown vehicle '{name}'. "
                                   f"Available: {sorted(simulation.VEHICLES)}")
    return simulation.VEHICLES[name]


def _check_profile(profile: str):
    if profile not in ROUTE_PROFILES:
        raise HTTPException(status_code=400,
                            detail=f"unknown profile '{profile}'. "
                                   f"Available: {sorted(ROUTE_PROFILES)}")


@app.post('/api/route')
def api_route(req: RouteRequest):
    g = app.state.graph
    vehicle = _resolve_vehicle(req.vehicle)
    _check_profile(req.profile)
    if req.flood_level:
        # transient flood state for this request (cleared right after)
        simulation.activate(g, flood_level=req.flood_level, write_geojson=False)
        try:
            result = g.find_route(req.origin.model_dump(), req.destination.model_dump(),
                                  weights=ROUTE_PROFILES[req.profile], vehicle=vehicle)
        finally:
            g.clear_flood()
    else:
        result = g.find_route(req.origin.model_dump(), req.destination.model_dump(),
                              weights=ROUTE_PROFILES[req.profile], vehicle=vehicle)
    return _route_payload(result)


@app.post('/api/simulate')
def api_simulate(req: SimulateRequest):
    g = app.state.graph
    vehicle = _resolve_vehicle(req.vehicle)
    level = _normalize_level(req.flood_level)
    if level not in simulation.LEVELS:
        raise HTTPException(status_code=400,
                            detail=f"unknown flood_level '{req.flood_level}'. "
                                   f"Available: {sorted(simulation.LEVELS)}")
    if req.scenario not in simulation.SCENARIOS:
        raise HTTPException(status_code=400,
                            detail=f"unknown scenario '{req.scenario}'. "
                                   f"Available: {sorted(simulation.SCENARIOS)}")

    zones = simulation.activate(g, scenario=req.scenario, flood_level=level)
    try:
        routes = {}
        for profile in ('fastest', 'safest', 'high_ground'):
            try:
                r = g.find_route(req.origin.model_dump(), req.destination.model_dump(),
                                 weights=ROUTE_PROFILES[profile], vehicle=vehicle)
                routes[profile] = _route_payload(r)
            except RouteNotFound as e:
                routes[profile] = {'success': False, 'error': str(e)}
        # scan while flood state is still attached to the edges
        affected_full = simulation.affected_roads(g, limit=100000)
        blocked_full = simulation.blocked_roads(g, req.vehicle, limit=100000)
    finally:
        g.clear_flood()

    feasible = [k for k, v in routes.items() if v.get('success')]
    primary = routes.get('fastest') if routes.get('fastest', {}).get('success') else \
        (routes[feasible[0]] if feasible else None)
    # recommend the feasible profile with the least flood exposure (ties -> shorter)
    recommended = None
    if feasible:
        recommended = min(feasible,
                          key=lambda k: (routes[k]['flood_exposure'], routes[k]['distance_km']))
    return {
        'success': any(v.get('success') for v in routes.values()),
        'scenario': req.scenario,
        'flood_level': level,
        'vehicle': req.vehicle,
        'vehicle_limit_m': vehicle['max_flood_depth_m'],
        'note': 'Simulated prototype scenario; depths/thresholds are demo values, '
                'not official specifications.',
        'flood_zones': simulation.zone_summary(zones),
        'affected_roads': affected_full[:50],
        'blocked_roads': blocked_full[:50],
        'routes': routes,
        'stats': {
            'affected_road_count': len(affected_full),
            'blocked_road_count': len(blocked_full),
            'feasible_profiles': feasible,
            'recommended': recommended,
        },
    }
