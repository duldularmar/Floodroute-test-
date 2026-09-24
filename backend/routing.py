"""
FloodRoute routing core (extended).

- Builds a directed road graph from data/processed/roads.geojson (real OSM ways).
- Samples SRTM-derived elevation per segment (data/processed/elevation.tif) and
  derives a normalized relative terrain risk (lower ground -> higher risk).
- Supports a dynamic simulated flood layer (backend/simulation.py) that attaches
  flood depth / risk / blocked state to edges WITHOUT rewriting roads.geojson.
- A* over configurable edge cost:
      cost = travel_time * (1 + flood_weight * f(depth, vehicle_limit))
                           * (1 + terrain_weight * g(terrain_risk))
  Depth beyond the vehicle's prototype limit => blocked (infinite cost).

NOTE on elevation: the source is SRTM GL1 (~30 m native resolution), upsampled
during preprocessing. Sampled values are terrain CONTEXT (relative low/high
ground), not flood predictions and not native 15.5 m measurements.

NOTE on risk: all flood depths/severities/thresholds here are PROTOTYPE
SIMULATION VALUES for hackathon demos, not official hydrology or vehicle
specifications.

Only the Python standard library is used for graph/elevation work.
"""
import json
import math
import os
import struct
import sys
from array import array
from heapq import heappush, heappop

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROADS_FILE = os.path.join(ROOT, 'data', 'processed', 'roads.geojson')
ELEVATION_FILE = os.path.join(ROOT, 'data', 'processed', 'elevation.tif')

EARTH_R = 6371000.0  # metres

# urban speed profile (km/h) per OSM highway class; capped by maxspeed tag
SPEED_KMH = {
    'motorway': 80, 'motorway_link': 60,
    'trunk': 65, 'trunk_link': 50,
    'primary': 50, 'primary_link': 40,
    'secondary': 45, 'secondary_link': 35,
    'tertiary': 40, 'tertiary_link': 30,
    'unclassified': 30,
    'residential': 30,
    'living_street': 20,
    'service': 20,
    'road': 30,
}
DEFAULT_SPEED_KMH = 30
MAX_SPEED_KMH = 60          # conservative cap -> keeps A* heuristic admissible
MAX_SPEED_MPS = MAX_SPEED_KMH / 3.6

# prototype risk bands for the *route-level* risk label, by max simulated
# flood depth (m) along the route. Simulated demo values, not official.
RISK_BANDS = [(0.0, 'NONE'), (0.12, 'LOW'), (0.25, 'MODERATE'), (0.45, 'HIGH')]


class RouteNotFound(Exception):
    pass


def risk_label(depth_m):
    if depth_m is None or depth_m <= 0:
        return 'NONE'
    for limit, label in RISK_BANDS[1:]:
        if depth_m <= limit:
            return label
    return 'SEVERE'


# --------------------------------------------------------------------------- #
# Elevation raster (minimal uncompressed int16 GeoTIFF reader)
# --------------------------------------------------------------------------- #
class ElevationRaster:
    """Reads the single-strip int16 GeoTIFF written by data/build_elevation_corridor.py."""

    def __init__(self, path):
        self.ok = False
        self.values = None
        if not os.path.exists(path):
            print(f'[routing] WARNING: elevation file missing: {path}')
            return
        with open(path, 'rb') as f:
            data = f.read()
        bo = '<' if data[:2] == b'II' else '>'
        ifd = struct.unpack(bo + 'I', data[4:8])[0]
        n = struct.unpack(bo + 'H', data[ifd:ifd + 2])[0]
        tags = {}
        for i in range(n):
            en = data[ifd + 2 + 12 * i: ifd + 2 + 12 * (i + 1)]
            tag, typ, cnt = struct.unpack(bo + 'HHI', en[:8])
            if tag in (256, 257, 258, 259, 273, 279, 33550, 33922, 42113):
                if typ == 3 and cnt == 1:
                    tags[tag] = struct.unpack(bo + 'H', en[8:10])[0]
                elif typ == 4 and cnt == 1:
                    tags[tag] = struct.unpack(bo + 'I', en[8:12])[0]
                elif typ == 12:
                    off = struct.unpack(bo + 'I', en[8:12])[0]
                    tags[tag] = struct.unpack(bo + f'{cnt}d', data[off:off + 8 * cnt])
                elif typ == 2:
                    off = struct.unpack(bo + 'I', en[8:12])[0]
                    tags[tag] = data[off:off + cnt].rstrip(b'\x00').decode()
        self.width = tags[256]
        self.height = tags[257]
        sx, sy = tags[33550][0], tags[33550][1]
        self.lon0, self.lat0 = tags[33922][3], tags[33922][4]
        self.lon1 = self.lon0 + sx * self.width
        self.lat1 = self.lat0 + sy * self.height  # sy negative (south-up)
        strip = tags[273]
        nbytes = tags[279]
        self.nodata = float(tags.get(42113, -32768))
        raw = data[strip:strip + nbytes]
        self.values = array('h')
        self.values.frombytes(raw)
        if sys.byteorder != 'little':
            self.values.byteswap()
        if len(self.values) != self.width * self.height:
            raise ValueError('elevation raster: unexpected pixel count')
        self.res_deg = sx
        self.ok = True
        print(f'[routing] elevation raster loaded: {self.width}x{self.height}, '
              f'bounds lon {self.lon0:.4f}..{self.lon1:.4f} lat {self.lat1:.4f}..{self.lat0:.4f}')

    def sample(self, lon, lat):
        """Approximate elevation (m) at lon/lat, or None if outside / nodata."""
        if not self.ok:
            return None
        if not (self.lon0 <= lon <= self.lon1 and self.lat1 <= lat <= self.lat0):
            return None
        ix = int((lon - self.lon0) / self.res_deg)
        iy = int((self.lat0 - lat) / abs(self.res_deg))
        ix = min(self.width - 1, max(0, ix))
        iy = min(self.height - 1, max(0, iy))
        v = self.values[iy * self.width + ix]
        return None if v == self.nodata else float(v)


# --------------------------------------------------------------------------- #
# Geometry helpers
# --------------------------------------------------------------------------- #
def haversine_m(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def point_segment_distance_deg(px, py, ax, ay, bx, by):
    """Distance (degrees, approx planar) from point P to segment AB."""
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _parse_maxspeed(val):
    try:
        v = int(str(val).strip().split()[0])
        return v if 5 <= v <= 130 else None
    except (ValueError, TypeError, IndexError):
        return None


# --------------------------------------------------------------------------- #
# Graph
# --------------------------------------------------------------------------- #
class RoadGraph:
    """
    Directed graph over road vertices.
    - nodes: every distinct geometry vertex of the OSM ways
    - edges: per road segment, honoring oneway
    Adjacency: adj[u] = list of (v, length_m, time_s, geom, edge_idx)
    edge_attrs[idx] holds the road attributes plus dynamic flood fields:
        elevation_m, terrain_risk, flood_depth_m, flood_risk, blocked, flood_zone
    Flood fields are mutated dynamically by the simulation layer; the original
    roads.geojson is never rewritten.
    """

    GRID_DEG = 0.002  # ~220 m snap grid

    def __init__(self, roads_path=ROADS_FILE, elevation_path=ELEVATION_FILE):
        self.raster = ElevationRaster(elevation_path)
        self.node_keys = {}          # (lon, lat) -> node id
        self.node_coords = []        # node id -> (lon, lat)
        self.adj = []                # node id -> list of (v, length_m, time_s, geom, edge_idx)
        self.edge_attrs = []         # edge idx -> attribute dict (shared by both directions)
        self.edge_mid = []           # edge idx -> (lon, lat) midpoint
        self._grid = {}              # (cx, cy) -> [node ids]
        self._flood_hits = None      # set of edge idx currently intersecting flood zones
        self._build(roads_path)
        self._compute_terrain()

    # ---------------- construction ---------------- #
    def _node_id(self, lon, lat):
        key = (lon, lat)
        nid = self.node_keys.get(key)
        if nid is None:
            nid = len(self.node_coords)
            self.node_keys[key] = nid
            self.node_coords.append(key)
            self.adj.append([])
        return nid

    def _build(self, path):
        with open(path, encoding='utf-8') as f:
            gj = json.load(f)
        kept_attrs = ('osm_id', 'name', 'highway', 'surface', 'lanes', 'maxspeed',
                      'oneway', 'bridge', 'tunnel', 'layer', 'service', 'access', 'width')
        n_segs = 0
        n_oneway = 0
        total_m = 0.0
        for ft in gj['features']:
            props = ft['properties']
            coords = ft['geometry']['coordinates']
            ids = [self._node_id(lon, lat) for lon, lat in coords]
            merged = [ids[0]]
            for nid in ids[1:]:
                if nid != merged[-1]:
                    merged.append(nid)
            if len(merged) < 2:
                continue
            oneway = str(props.get('oneway', '')).lower() in ('yes', 'true', '1')
            if oneway:
                n_oneway += 1
            attrs = {k: props[k] for k in kept_attrs if k in props}
            for i in range(len(merged) - 1):
                a, b = merged[i], merged[i + 1]
                lon1, lat1 = self.node_coords[a]
                lon2, lat2 = self.node_coords[b]
                length = haversine_m(lon1, lat1, lon2, lat2)
                if length < 0.05:
                    continue
                kmh = SPEED_KMH.get(props.get('highway', ''), DEFAULT_SPEED_KMH)
                ms = _parse_maxspeed(props.get('maxspeed'))
                if ms is not None:
                    kmh = min(kmh, ms)
                kmh = min(kmh, MAX_SPEED_KMH)
                time_s = length / (kmh / 3.6)
                idx = len(self.edge_attrs)
                fwd_geom = [(lon1, lat1), (lon2, lat2)]
                self.edge_attrs.append(attrs)
                self.edge_mid.append(((lon1 + lon2) / 2.0, (lat1 + lat2) / 2.0))
                self.adj[a].append((b, length, time_s, fwd_geom, idx))
                if not oneway:
                    self.adj[b].append((a, length, time_s, fwd_geom[::-1], idx))
                total_m += length
                n_segs += 1
        # spatial grid for nearest-node lookup
        cs = self.GRID_DEG
        for nid, (lon, lat) in enumerate(self.node_coords):
            self._grid.setdefault((int(lon / cs), int(lat / cs)), []).append(nid)
        self.n_nodes = len(self.node_coords)
        self.n_edges = sum(len(lst) for lst in self.adj)
        self.total_km = total_m / 1000.0
        print(f'[routing] graph built: {self.n_nodes} nodes, {self.n_edges} directed edges '
              f'({n_segs} segments, {n_oneway} oneway ways), {self.total_km:.1f} km total')

    # ---------------- terrain ---------------- #
    def _compute_terrain(self):
        """
        Sample elevation per edge midpoint; normalized terrain risk (0 high..1 low).

        Normalization uses the road corridor's OWN elevation distribution
        (empirical percentiles), not the full raster range: the raster includes
        distant hills the road network never touches, which would compress all
        corridor scores into one undiscriminating band. 'Relative low ground'
        means low compared with the rest of the drivable corridor.
        """
        vals = []
        for idx, (lon, lat) in enumerate(self.edge_mid):
            e = self.raster.sample(lon, lat)
            self.edge_attrs[idx]['elevation_m'] = e
            vals.append(e)
        valid = [v for v in vals if v is not None]
        if not valid:
            self.elev_min = self.elev_max = None
            return
        self.elev_min = min(valid)
        self.elev_max = max(valid)
        valid_sorted = sorted(valid)
        n = len(valid_sorted)

        def low_ground_score(e):
            # 1.0 = lowest sampled segment, 0.0 = highest sampled segment
            import bisect
            rank = bisect.bisect_left(valid_sorted, e)
            return 1.0 - (rank / max(1, n - 1))

        print(f'[routing] terrain: {len(valid)} segments sampled, '
              f'corridor range {self.elev_min:.0f}..{self.elev_max:.0f} m '
              f'(raster span {self.raster.lat1:.3f}..{self.raster.lat0:.3f} lat)')
        for idx, e in enumerate(vals):
            if e is None:
                self.edge_attrs[idx]['terrain_risk'] = 0.5  # unknown -> neutral
            else:
                r = low_ground_score(e)
                self.edge_attrs[idx]['terrain_risk'] = round(min(1.0, max(0.0, r)), 4)

    # ---------------- flood layer (dynamic) ---------------- #
    def set_flood_hits(self, zone_list):
        """
        Attach simulated flood zones to edges (called by simulation layer).
        zone_list: list of dicts {id, depth_m, severity, polygon: [(lon, lat), ...]}
        Stores per-edge max depth + zone id in edge_attrs. Idempotent per call.
        """
        hits = {}  # edge idx -> (depth, zone_id, severity)
        for zone in zone_list:
            poly = zone['polygon']
            n = len(poly)
            cx = sum(p[0] for p in poly) / n
            cy = sum(p[1] for p in poly) / n
            rad_deg = zone['radius_m'] / (111320.0 * math.cos(math.radians(cy)))
            rad_lat = zone['radius_m'] / 110574.0
            for idx, (mx, my) in enumerate(self.edge_mid):
                # quick bbox reject then precise-ish segment distance
                if abs(mx - cx) > rad_deg * 1.6 or abs(my - cy) > rad_lat * 1.6:
                    continue
                d = min(
                    point_segment_distance_deg(mx, my, poly[i][0], poly[i][1],
                                               poly[(i + 1) % n][0], poly[(i + 1) % n][1])
                    for i in range(n)
                )
                if d <= rad_deg:
                    prev = hits.get(idx)
                    if prev is None or zone['depth_m'] > prev[0]:
                        hits[idx] = (zone['depth_m'], zone['id'], zone.get('severity', 'unknown'))
        self._flood_hits = hits
        for idx, attrs in enumerate(self.edge_attrs):
            h = hits.get(idx)
            if h:
                attrs['flood_depth_m'] = h[0]
                attrs['flood_risk'] = risk_label(h[0])
                attrs['flood_zone'] = h[1]
            else:
                attrs['flood_depth_m'] = 0.0
                attrs['flood_risk'] = 'NONE'
                attrs['flood_zone'] = None
            attrs['blocked'] = False

    def clear_flood(self):
        self._flood_hits = None
        for attrs in self.edge_attrs:
            attrs['flood_depth_m'] = 0.0
            attrs['flood_risk'] = 'NONE'
            attrs['flood_zone'] = None
            attrs['blocked'] = False

    # ---------------- nearest node ---------------- #
    def nearest_node(self, lon, lat, max_deg=0.02):
        """Snap to nearest graph node (expanding-ring grid search)."""
        cs = self.GRID_DEG
        cx, cy = int(lon / cs), int(lat / cs)
        best, bestd = None, float('inf')
        r = 0
        while True:
            for i in range(cx - r, cx + r + 1):
                for j in range(cy - r, cy + r + 1):
                    if r and max(abs(i - cx), abs(j - cy)) != r:
                        continue
                    for nid in self._grid.get((i, j), ()):
                        nlon, nlat = self.node_coords[nid]
                        d = (nlon - lon) ** 2 + (nlat - lat) ** 2
                        if d < bestd:
                            bestd, best = d, nid
            if best is not None and math.sqrt(bestd) <= (r - 1) * cs:
                break
            r += 1
            if r > 60:
                break
        if best is None or math.sqrt(bestd) > max_deg:
            return None
        return best

    # ---------------- A* ---------------- #
    def find_route(self, origin, destination, weights=None, vehicle=None):
        """
        A* with configurable cost.

        origin/destination: {'lat':..,'lon':..}. weights: dict with optional keys
        flood_weight (default 0), terrain_weight (default 0). vehicle: dict with
        'max_flood_depth_m' (edges deeper than the limit are blocked) or None.

        Cost per edge = time_s * (1 + fw * (depth/limit)^2 * 9) * (1 + tw*terrain_risk)
        (multipliers >= 1, so the straight-line time heuristic stays admissible).
        Returns route dict; raises RouteNotFound.
        """
        w = weights or {}
        fw = float(w.get('flood_weight', 0.0))
        tw = float(w.get('terrain_weight', 0.0))
        vlimit = vehicle.get('max_flood_depth_m') if vehicle else None

        olat, olon = self._as_latlon(origin)
        dlat, dlon = self._as_latlon(destination)
        start = self.nearest_node(olon, olat)
        goal = self.nearest_node(dlon, dlat)
        if start is None:
            raise RouteNotFound(f'origin ({olat}, {olon}) is too far from the road network')
        if goal is None:
            raise RouteNotFound(f'destination ({dlat}, {dlon}) is too far from the road network')

        if start == goal:
            lon, lat = self.node_coords[start]
            return {'success': True, 'distance_km': 0.0, 'eta_minutes': 0.0,
                    'risk': 'NONE', 'flood_exposure': 0.0, 'terrain_score': 0.0,
                    'blocked_roads': [], 'path': [[lon, lat]],
                    'origin_node': start, 'destination_node': goal, 'edges': []}

        def h(nid):
            nlon, nlat = self.node_coords[nid]
            return haversine_m(nlon, nlat, *self.node_coords[goal]) / MAX_SPEED_MPS

        def edge_cost(time_s, attrs):
            depth = attrs.get('flood_depth_m') or 0.0
            if vlimit is not None and depth > vlimit:
                return None  # blocked for this vehicle (prototype threshold)
            m = 1.0
            if fw > 0 and depth > 0 and vlimit:
                m += fw * (depth / vlimit) ** 2 * 9.0
            elif fw > 0 and depth > 0:
                m += fw * min(depth / 0.3, 1.0) * 9.0
            if tw > 0:
                m += tw * (attrs.get('terrain_risk') or 0.0)
            return time_s * m

        gscore = {start: 0.0}
        came = {}   # node -> (prev_node, geom, length_m, time_s, edge_idx)
        closed = set()
        blocked_seen = {}
        heap = []
        counter = 0
        heappush(heap, (h(start), counter, start))
        found = False
        while heap:
            _f, _, u = heappop(heap)
            if u in closed:
                continue
            if u == goal:
                found = True
                break
            closed.add(u)
            gu = gscore[u]
            for (v, length, time_s, geom, idx) in self.adj[u]:
                if v in closed:
                    continue
                attrs = self.edge_attrs[idx]
                c = edge_cost(time_s, attrs)
                if c is None:
                    name = attrs.get('name') or f"way {attrs.get('osm_id', '?')}"
                    blocked_seen[name] = max(blocked_seen.get(name, 0.0),
                                             attrs.get('flood_depth_m') or 0.0)
                    continue
                ng = gu + c
                if ng < gscore.get(v, float('inf')):
                    gscore[v] = ng
                    came[v] = (u, geom, length, time_s, idx)
                    counter += 1
                    heappush(heap, (ng + h(v), counter, v))
        if not found:
            detail = f'; blocked roads encountered: {len(blocked_seen)}' if blocked_seen else ''
            raise RouteNotFound('no path found between origin and destination' + detail)

        # reconstruct
        path = []
        dist_m = 0.0
        true_time = 0.0
        flooded_m = 0.0
        terr_sum = 0.0
        used_idx = []
        node = goal
        while node != start:
            prev, geom, length, time_s, idx = came[node]
            path.extend(geom[1:] if path else geom)
            dist_m += length
            true_time += time_s
            attrs = self.edge_attrs[idx]
            if (attrs.get('flood_depth_m') or 0.0) > 0:
                flooded_m += length
            terr_sum += attrs.get('terrain_risk') or 0.0
            used_idx.append(idx)
            node = prev
        path.reverse()
        used_idx.reverse()
        max_depth = max((self.edge_attrs[i].get('flood_depth_m') or 0.0) for i in used_idx)
        seen = set()
        edges = []
        for idx in used_idx:
            if idx not in seen:
                seen.add(idx)
                edges.append(self.edge_attrs[idx])
        return {'success': True,
                'distance_km': round(dist_m / 1000.0, 3),
                'eta_minutes': round(true_time / 60.0, 2),
                'risk': risk_label(max_depth),
                'flood_exposure': round(flooded_m / 1000.0, 3),
                'terrain_score': round(terr_sum / max(1, len(used_idx)), 3),
                'blocked_roads': sorted(blocked_seen),
                'path': [[lon, lat] for lon, lat in path],
                'origin_node': start,
                'destination_node': goal,
                'edges': edges}

    @staticmethod
    def _as_latlon(x):
        if isinstance(x, dict):
            return float(x['lat']), float(x['lon'])
        lat, lon = x
        return float(lat), float(lon)


# module-level singleton so the graph is built once per process
_graph = None


def get_graph():
    global _graph
    if _graph is None:
        _graph = RoadGraph()
    return _graph
