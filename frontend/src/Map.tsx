import React, { useEffect } from 'react'
import {
  MapContainer, TileLayer, Marker, Polyline, Polygon, Popup, useMap,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { FloodZone, LatLng, RouteResult, SimulateResponse, ProfileId } from './api'
import { PROFILE_ORDER } from './api'

// re-export so existing imports from './Map' keep working
export type { ProfileId }

// ---------------- marker icons (inline SVG, no image assets) ---------------- //
const pin = (color: string, glyph: string) =>
  L.divIcon({
    className: 'fr-pin',
    html: `<svg width="34" height="42" viewBox="0 0 34 42" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="17" cy="38" rx="8" ry="2.6" fill="rgba(15,23,42,0.18)"/>
      <path d="M17 4 C11 4 7 8.3 7 13.5 C7 20.5 17 30 17 30 C17 30 27 20.5 27 13.5 C27 8.3 23 4 17 4 Z"
            fill="${color}" stroke="#ffffff" stroke-width="2"/>
      <circle cx="17" cy="13.5" r="6.5" fill="rgba(255,255,255,0.25)"/>
      <text x="17" y="17.5" font-size="11" text-anchor="middle" fill="#ffffff"
            font-family="Inter, system-ui, sans-serif" font-weight="800">${glyph}</text>
    </svg>`,
    iconSize: [34, 42],
    iconAnchor: [17, 38],
  })

const ORIGIN_ICON = pin('#2563eb', 'A')
const DEST_ICON = pin('#dc2626', 'B')

// soft halo under the origin pin with a CSS pulse ring (styles in index.css)
const ORIGIN_HALO_ICON = L.divIcon({
  className: 'fr-origin-pulse',
  html: `<div><span class="fr-ring"></span></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

const BLOCKED_ICON = L.divIcon({
  className: 'fr-pin',
  html: `<div style="width:26px;height:26px;border-radius:50%;background:rgba(220,38,38,0.92);
    border:2px solid #ffffff;display:flex;align-items:center;justify-content:center;
    font-size:13px;line-height:1;box-shadow:0 2px 8px rgba(15,23,42,0.25)">🚫</div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})

// ---------------- styles per profile ---------------- //
interface RouteStyle { color: string; weight: number; glow: string; casing: string; dashArray?: string }
const ROUTE_STYLES: Record<string, RouteStyle> = {
  fastest: { color: '#2563eb', weight: 5, glow: 'rgba(37, 99, 235, 0.35)', casing: '#1e40af' },
  safest: { color: '#059669', weight: 5, glow: 'rgba(5, 150, 105, 0.35)', casing: '#065f46' },
  high_ground: { color: '#7c3aed', weight: 5, glow: 'rgba(124, 58, 237, 0.35)', casing: '#5b21b6', dashArray: '10 6' },
  shortest: { color: '#f59e0b', weight: 5, glow: 'rgba(245, 158, 11, 0.35)', casing: '#b45309', dashArray: '2 7' },
  major_roads: { color: '#0891b2', weight: 5, glow: 'rgba(8, 145, 178, 0.35)', casing: '#155e75' },
  balanced: { color: '#e11d48', weight: 5, glow: 'rgba(225, 29, 72, 0.30)', casing: '#9f1239' },
}

const UNSELECTED_OPACITY = 0.35
const UNSELECTED_WEIGHT = 3

const SEVERITY_STYLE: Record<string, { color: string; fillOpacity: number }> = {
  low: { color: '#d97706', fillOpacity: 0.14 },
  moderate: { color: '#d97706', fillOpacity: 0.32 },
  severe: { color: '#dc2626', fillOpacity: 0.4 },
}

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
  // group blocked roads by their flood zone so each zone with impassable roads
  // gets exactly one 🚫 marker (backend tags every blocked road with its zone id)
  const blockedZones = zones
    .map((zone) => ({
      zone,
      roads: (simulation?.blocked_roads ?? []).filter((b) => b.zone === zone.id),
    }))
    .filter((g) => g.roads.length > 0)
  const ordered = PROFILE_ORDER
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

      {/* blocked roads: one 🚫 marker per flood zone containing roads the
          vehicle cannot enter (backend tags each blocked road with its zone) */}
      {blockedZones.map(({ zone, roads }) => {
        const poly = zone.polygon
        const pos: [number, number] = [
          poly.reduce((s, p) => s + p[1], 0) / poly.length,
          poly.reduce((s, p) => s + p[0], 0) / poly.length,
        ]
        return (
          <Marker key={'blk-' + zone.id + '-' + zone.depth_m} position={pos} icon={BLOCKED_ICON}>
            <Popup>
              <div className="text-xs">
                <b>🚫 {roads.length} blocked road{roads.length > 1 ? 's' : ''} — {zone.name}</b><br />
                {roads.slice(0, 6).map((b) => (
                  <div key={b.name + b.depth_m}>
                    {b.name} — {b.depth_m.toFixed(2)} m
                  </div>
                ))}
                {roads.length > 6 && <div className="opacity-60">+ {roads.length - 6} more…</div>}
                <div className="mt-1 opacity-60">
                  deeper than the {simulation?.vehicle} limit ({simulation?.vehicle_limit_m} m) —
                  simulated prototype threshold
                </div>
              </div>
            </Popup>
          </Marker>
        )
      })}

      {/* routes: unselected first, selected last (drawn on top) */}
      {ordered.map((p) => {
        const r = routes[p] as RouteResult
        const sel = p === selected
        const st = ROUTE_STYLES[p]
        const path = r.path.map(([lon, lat]) => [lat, lon] as [number, number])
        if (!sel) {
          return (
            <Polyline
              key={p + '-' + r.distance_km + '-' + r.path.length}
              positions={path}
              pathOptions={{
                color: st.color,
                weight: UNSELECTED_WEIGHT,
                opacity: UNSELECTED_OPACITY,
                dashArray: st.dashArray,
                lineCap: 'round',
              }}
              eventHandlers={{ click: () => onSelect(p) }}
            />
          )
        }
        return (
          <React.Fragment key={p + '-' + r.distance_km + '-' + r.path.length}>
            {/* soft glow underlay */}
            <Polyline positions={path} pathOptions={{ color: st.glow, weight: st.weight + 12, opacity: 0.35, lineCap: 'round' }} interactive={false} />
            {/* dark casing */}
            <Polyline positions={path} pathOptions={{ color: st.casing, weight: st.weight + 4, opacity: 0.9, lineCap: 'round' }} interactive={false} />
            {/* main line */}
            <Polyline
              positions={path}
              pathOptions={{
                color: st.color,
                weight: st.weight,
                opacity: 0.98,
                dashArray: st.dashArray,
                lineCap: 'round',
              }}
              eventHandlers={{ click: () => onSelect(p) }}
            />
          </React.Fragment>
        )
      })}

      {/* origin / destination markers */}
      {origin && (
        <Marker position={[origin.lat, origin.lon]} icon={ORIGIN_ICON}>
          <Popup>Origin</Popup>
        </Marker>
      )}
      {origin && <Marker position={[origin.lat, origin.lon]} icon={ORIGIN_HALO_ICON} interactive={false} />}
      {destination && (
        <Marker position={[destination.lat, destination.lon]} icon={DEST_ICON}>
          <Popup>Destination</Popup>
        </Marker>
      )}
    </MapContainer>
  )
}
