import { useEffect } from 'react'
import {
  MapContainer, TileLayer, Marker, Polyline, Polygon, Popup, useMap,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { FloodZone, LatLng, RouteResult, SimulateResponse } from './api'

// ---------------- marker icons (inline SVG, no image assets) ---------------- //
const pin = (color: string, glyph: string) =>
  L.divIcon({
    className: 'fr-pin',
    html: `<svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 2 C9 2 5 6.5 5 12 C5 19 15 28 15 28 C15 28 25 19 25 12 C25 6.5 21 2 15 2 Z"
            fill="${color}" stroke="#0b1220" stroke-width="1.5"/>
      <text x="15" y="16.5" font-size="12" text-anchor="middle" fill="#0b1220"
            font-family="system-ui, sans-serif" font-weight="700">${glyph}</text>
    </svg>`,
    iconSize: [30, 30],
    iconAnchor: [15, 28],
  })

const ORIGIN_ICON = pin('#38bdf8', 'A')
const DEST_ICON = pin('#f87171', 'B')
const BLOCKED_ICON = L.divIcon({
  className: 'fr-pin',
  html: `<div style="width:26px;height:26px;border-radius:50%;background:rgba(248,113,113,0.92);
    border:2px solid #0b1220;display:flex;align-items:center;justify-content:center;
    font-size:13px;line-height:1;box-shadow:0 0 6px rgba(248,113,113,0.8)">🚫</div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})

// ---------------- styles per profile ---------------- //
const ROUTE_STYLES: Record<string, { color: string; weight: number }> = {
  fastest: { color: '#38bdf8', weight: 6 },
  safest: { color: '#34d399', weight: 6 },
  high_ground: { color: '#a78bfa', weight: 6 },
}

const UNSELECTED_OPACITY = 0.35
const UNSELECTED_WEIGHT = 3

const SEVERITY_STYLE: Record<string, { color: string; fillOpacity: number }> = {
  low: { color: '#fbbf24', fillOpacity: 0.12 },
  moderate: { color: '#fbbf24', fillOpacity: 0.3 },
  severe: { color: '#f87171', fillOpacity: 0.42 },
}

export type ProfileId = 'fastest' | 'safest' | 'high_ground'

// ---------------- auto-fit helper ---------------- //
function FitAll({
  origin, destination, zones, routes, fitSignal,
}: {
  origin: LatLng | null
  destination: LatLng | null
  zones: FloodZone[]
  routes: Partial<Record<ProfileId, RouteResult>>
  fitSignal: number
}) {
  const map = useMap()
  useEffect(() => {
    const b = L.latLngBounds([] as L.LatLngExpression[])
    const add = (xs: [number, number][]) => xs.forEach(([lon, lat]) => b.extend([lat, lon]))
    if (origin) b.extend([origin.lat, origin.lon])
    if (destination) b.extend([destination.lat, destination.lon])
    zones.forEach((z) => add(z.polygon))
    Object.values(routes).forEach((r) => r?.success && add(r.path))
    if (b.isValid()) {
      map.flyToBounds(b, { padding: [40, 40], maxZoom: 15, duration: 0.8 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal, map])
  return null
}

// ---------------- component ---------------- //
export default function FloodMap({
  origin, destination, zones, routes, selected, onSelect, fitSignal, simulation,
}: {
  origin: LatLng | null
  destination: LatLng | null
  zones: FloodZone[]
  routes: Partial<Record<ProfileId, RouteResult>>
  selected: ProfileId | null
  onSelect: (p: ProfileId) => void
  fitSignal: number
  simulation: SimulateResponse | null
}) {
  // de-dup blocked road names (the backend reports one entry per flooded way)
  const blocked = simulation
    ? Object.values(
        simulation.blocked_roads.reduce<Record<string, { name: string; depth_m: number }>>(
          (acc, b) => {
            if (!acc[b.name] || acc[b.name].depth_m < b.depth_m) {
              acc[b.name] = { name: b.name, depth_m: b.depth_m }
            }
            return acc
          },
          {},
        ),
      )
    : []
  const ordered = (['fastest', 'safest', 'high_ground'] as const)
    .filter((p) => routes[p]?.success)
    .sort((a, b) => (a === selected ? 1 : 0) - (b === selected ? 1 : 0))

  return (
    <MapContainer
      center={[13.018, 80.19]}
      zoom={13}
      className="h-full w-full"
      zoomControl
      attributionControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FitAll
        origin={origin}
        destination={destination}
        zones={zones}
        routes={routes}
        fitSignal={fitSignal}
      />

      {/* flood zones */}
      {zones.map((z) => {
        const s = SEVERITY_STYLE[z.severity] ?? SEVERITY_STYLE.moderate
        const ring = z.polygon.map(([lon, lat]) => [lat, lon] as [number, number])
        return (
          <Polygon
            key={z.id + '-' + z.depth_m}
            positions={ring}
            pathOptions={{
              color: s.color, weight: 1.5, fillColor: s.color,
              fillOpacity: s.fillOpacity, opacity: 0.9,
            }}
          >
            <Popup>
              <div className="text-xs">
                <b>{z.name}</b><br />
                depth {z.depth_m} m &middot; {z.severity} &middot; {z.flood_level} level<br />
                <span className="opacity-60">simulated zone (prototype)</span>
              </div>
            </Popup>
          </Polygon>
        )
      })}

      {/* blocked roads: one red 🚫 marker per flooded way the vehicle cannot enter */}
      {blocked.map((b) => {
        const zone = zones.find((z) =>
          simulation?.affected_roads.some(
            (a) => a.name === b.name && a.zone === z.id,
          ),
        )
        // place the marker at the center of the zone that flooded this road
        const poly = zone?.polygon
        const pos: [number, number] | null = poly
          ? [poly.reduce((s, p) => s + p[1], 0) / poly.length,
             poly.reduce((s, p) => s + p[0], 0) / poly.length]
          : null
        return pos ? (
          <Marker key={'blk-' + b.name} position={pos} icon={BLOCKED_ICON}>
            <Popup>
              <div className="text-xs">
                <b>🚫 {b.name}</b><br />
                depth {b.depth_m.toFixed(2)} m — impassable for {simulation?.vehicle}<br />
                <span className="opacity-60">(simulated prototype threshold)</span>
              </div>
            </Popup>
          </Marker>
        ) : null
      })}

      {/* routes: unselected first, selected last (drawn on top) */}
      {ordered.map((p) => {
        const r = routes[p] as RouteResult
        const sel = p === selected
        const st = ROUTE_STYLES[p]
        return (
          <Polyline
            key={p + '-' + r.distance_km + '-' + r.path.length}
            positions={r.path.map(([lon, lat]) => [lat, lon])}
            pathOptions={{
              color: st.color,
              weight: sel ? st.weight : UNSELECTED_WEIGHT,
              opacity: sel ? 0.95 : UNSELECTED_OPACITY,
              dashArray: p === 'high_ground' ? '10 6' : undefined,
              lineCap: 'round',
            }}
            eventHandlers={{ click: () => onSelect(p) }}
          />
        )
      })}

      {/* origin / destination markers */}
      {origin && (
        <Marker position={[origin.lat, origin.lon]} icon={ORIGIN_ICON}>
          <Popup>Origin</Popup>
        </Marker>
      )}
      {destination && (
        <Marker position={[destination.lat, destination.lon]} icon={DEST_ICON}>
          <Popup>Destination</Popup>
        </Marker>
      )}
    </MapContainer>
  )
}
