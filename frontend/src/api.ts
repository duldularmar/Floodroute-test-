// API client for the FloodRoute backend. No routing/flood logic here — the
// backend is the single source of truth; this just talks to it.

const BASE_URL: string =
  (import.meta as any).env?.VITE_API_BASE_URL || '' // '' = same-origin (vite proxy)

// ---------------- types (mirror backend responses) ---------------- //
export interface LatLng {
  lat: number
  lon: number
}

export type VehicleId = 'ambulance' | 'fire_engine' | 'rescue_truck'
export type FloodLevel = 'NORMAL' | 'LOW' | 'MODERATE' | 'SEVERE'

export interface FloodZone {
  id: string
  name: string
  severity: 'moderate' | 'severe' | 'low' | string
  depth_m: number
  radius_m: number
  flood_level: string
  polygon: [number, number][] // [[lon, lat], ...]
}

export interface RoadAttr {
  osm_id?: number
  name?: string
  highway?: string
  surface?: string
  lanes?: string | number
  maxspeed?: string | number
  oneway?: string
  bridge?: string
  tunnel?: string
  layer?: string
  service?: string
  elevation_m?: number | null
  terrain_risk?: number
  flood_depth_m?: number
  flood_risk?: string
  flood_zone?: string | null
}

export interface RouteResult {
  success: boolean
  distance_km: number
  eta_minutes: number
  risk: string
  flood_exposure: number // km of flooded road on the route
  terrain_score: number // 0 (high ground) .. 1 (low ground)
  blocked_roads: string[]
  path: [number, number][] // [[lon, lat], ...]
  origin_node: number
  destination_node: number
  roads?: RoadAttr[]
  error?: string
}

export interface RouteProfile {
  fastest?: RouteResult
  safest?: RouteResult
  high_ground?: RouteResult
}

export interface SimulateResponse {
  success: boolean
  scenario: string
  flood_level: string
  vehicle: string
  vehicle_limit_m: number
  note: string
  flood_zones: FloodZone[]
  affected_roads: { name: string; depth_m: number; flood_risk: string; zone: string }[]
  blocked_roads: { name: string; depth_m: number; vehicle: string; vehicle_limit_m: number }[]
  routes: RouteProfile
  stats: {
    affected_road_count: number
    blocked_road_count: number
    feasible_profiles: string[]
    recommended: string | null
  }
}

// ---------------- demo locations (mirror backend DEMO_LOCATIONS) ---------------- //
export const LOCATIONS: Record<string, LatLng & { label: string }> = {
  srm_ramapuram: { lat: 13.032649, lon: 80.179635, label: 'SRM Ramapuram' },
  porur: { lat: 13.037, lon: 80.2015, label: 'Porur' },
  guindy: { lat: 12.994, lon: 80.201, label: 'Guindy / Kathipara' },
  saidapet: { lat: 13.0215, lon: 80.2215, label: 'Saidapet' },
}

// ---------------- API calls ---------------- //
export interface ApiError {
  message: string
  status?: number
  detail?: string
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw { message: 'Backend unavailable — is it running on port 8000?' } as ApiError
  }
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j.detail ?? JSON.stringify(j)
    } catch {
      detail = res.statusText
    }
    throw { message: `API error ${res.status}`, status: res.status, detail } as ApiError
  }
  return res.json()
}

export async function calculateRoute(opts: {
  origin: LatLng
  destination: LatLng
  vehicle: VehicleId
  profile: 'fastest' | 'safest' | 'high_ground'
  flood_level?: FloodLevel // 'NORMAL' -> omitted so the backend routes on clean state
}): Promise<RouteResult> {
  const body: Record<string, unknown> = {
    origin: opts.origin,
    destination: opts.destination,
    vehicle: opts.vehicle,
    profile: opts.profile,
  }
  if (opts.flood_level && opts.flood_level !== 'NORMAL') body.flood_level = opts.flood_level
  return post<RouteResult>('/api/route', body)
}

export async function simulateFlood(opts: {
  origin: LatLng
  destination: LatLng
  vehicle: VehicleId
  flood_level: 'LOW' | 'MODERATE' | 'SEVERE'
}): Promise<SimulateResponse> {
  return post<SimulateResponse>('/api/simulate', {
    scenario: 'ramapuram_flood',
    flood_level: opts.flood_level,
    vehicle: opts.vehicle,
    origin: opts.origin,
    destination: opts.destination,
  })
}
