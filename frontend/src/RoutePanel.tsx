import type { ProfileId, RouteResult, SimulateResponse } from './api'
import { PROFILE_ORDER } from './api'

const PROFILE_META: Record<
  ProfileId,
  { label: string; sub: string; color: string; ring: string; text: string; icon: React.ReactNode }
> = {
  fastest: {
    label: 'FASTEST',
    sub: 'minimum ETA',
    color: 'border-blue-600',
    ring: 'ring-blue-600',
    text: 'text-blue-700',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2 4.5 13.5H11l-1 8.5L18.5 10.5H12l1-8.5Z" />
      </svg>
    ),
  },
  safest: {
    label: 'SAFEST',
    sub: 'least flood exposure',
    color: 'border-emerald-600',
    ring: 'ring-emerald-600',
    text: 'text-emerald-700',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      </svg>
    ),
  },
  high_ground: {
    label: 'HIGH GROUND',
    sub: 'prefers elevated roads',
    color: 'border-violet-500',
    ring: 'ring-violet-500',
    text: 'text-violet-700',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 20 6-9 4 5 3-4 5 8" />
        <path d="M3 20h18" />
      </svg>
    ),
  },
  shortest: {
    label: 'SHORTEST',
    sub: 'minimum distance',
    color: 'border-amber-500',
    ring: 'ring-amber-500',
    text: 'text-amber-600',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
        <circle cx="4" cy="12" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  major_roads: {
    label: 'MAJOR ROADS',
    sub: 'highways & arterials',
    color: 'border-cyan-600',
    ring: 'ring-cyan-600',
    text: 'text-cyan-700',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 21 9 3" />
        <path d="M20 21 15 3" />
        <path d="M12 7v2.5" />
        <path d="M12 13.5V16" />
        <path d="M12 19.5V21" />
      </svg>
    ),
  },
  balanced: {
    label: 'BALANCED',
    sub: 'compromise of all factors',
    color: 'border-rose-600',
    ring: 'ring-rose-600',
    text: 'text-rose-700',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v18" />
        <path d="M5 7.5h14" />
        <path d="M4 16.5h16" />
      </svg>
    ),
  },
}

const RISK_CHIP: Record<string, string> = {
  NONE: 'bg-emerald-50 text-emerald-700',
  LOW: 'bg-emerald-50 text-emerald-700',
  MODERATE: 'bg-amber-50 text-amber-700',
  HIGH: 'bg-red-50 text-red-700',
  SEVERE: 'bg-red-50 text-red-700',
}

function Metric({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div className="min-w-[62px] flex-1">
      <div className="text-[9px] font-bold tracking-wider text-ops-muted">{label}</div>
      <div className={`font-mono text-[15px] font-extrabold leading-tight ${color ?? 'text-ops-text'}`}>
        {value}
        {unit && <span className="ml-0.5 text-[10px] font-semibold text-ops-muted">{unit}</span>}
      </div>
    </div>
  )
}

export function RouteCard({
  profile, route, selected, onSelect,
}: {
  profile: ProfileId
  route: RouteResult | undefined
  selected: boolean
  onSelect: (p: ProfileId) => void
}) {
  if (!route || !route.success) return null
  const meta = PROFILE_META[profile]
  const riskChip = RISK_CHIP[route.risk] ?? 'bg-slate-100 text-ops-muted'
  return (
    <button
      onClick={() => onSelect(profile)}
      className={`group min-w-[230px] flex-1 rounded-xl border-l-4 bg-white p-3.5 text-left transition-all duration-200 shadow-card
                  ${meta.color} ${selected ? `ring-2 ${meta.ring} -translate-y-0.5 shadow-overlay` : 'hover:-translate-y-0.5 hover:shadow-overlay opacity-90 hover:opacity-100'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className={`flex items-center gap-1.5 ${meta.text}`}>
          {meta.icon}
          <span className="text-sm font-extrabold tracking-wider">
            {meta.label}
          </span>
          {selected && (
            <span className="rounded-full bg-ops-text px-1.5 py-px text-[9px] font-extrabold tracking-widest text-white">
              ACTIVE
            </span>
          )}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${riskChip}`}>
          {route.risk}
        </span>
      </div>
      <div className="mb-2 mt-0.5 text-[10px] font-medium text-ops-muted">{meta.sub}</div>
      <div className="flex gap-3">
        <Metric label="DISTANCE" value={route.distance_km.toFixed(2)} unit="km" />
        <Metric label="ETA" value={route.eta_minutes.toFixed(1)} unit="min" />
        <Metric
          label="EXPOSURE"
          value={route.flood_exposure.toFixed(2)}
          unit="km"
          color={route.flood_exposure > 0 ? 'text-amber-600' : 'text-emerald-600'}
        />
        <Metric label="TERRAIN" value={route.terrain_score.toFixed(2)} />
        {typeof route.avg_speed_kmh === 'number' && route.avg_speed_kmh > 0 && (
          <Metric label="AVG SPEED" value={route.avg_speed_kmh.toFixed(0)} unit="km/h" />
        )}
      </div>
      {route.blocked_roads.length > 0 && (
        <div className="mt-2 flex items-center gap-1 text-[10px] font-bold text-red-600">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" />
          </svg>
          {route.blocked_roads.length} blocked road{route.blocked_roads.length > 1 ? 's' : ''} avoided
        </div>
      )}
    </button>
  )
}

export default function RoutePanel({
  routes, selected, onSelect, simulation, rerouted, stale,
}: {
  routes: Partial<Record<ProfileId, RouteResult>>
  selected: ProfileId | null
  onSelect: (p: ProfileId) => void
  simulation: SimulateResponse | null
  rerouted: boolean | null
  stale?: boolean
}) {
  const any = Object.values(routes).some((r) => r?.success)
  if (!any && !simulation) return null

  return (
    <div className="border-t border-ops-edge bg-ops-bg/80 px-4 py-3 backdrop-blur">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-extrabold tracking-widest text-ops-text">ROUTE OPTIONS</h2>
        {simulation && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            {[
              { k: 'scenario', v: simulation.scenario, c: 'text-ops-text' },
              { k: 'level', v: simulation.flood_level, c: 'text-amber-700' },
              { k: 'vehicle', v: `${simulation.vehicle} ≤${simulation.vehicle_limit_m} m`, c: 'text-ops-text' },
              { k: 'affected', v: String(simulation.stats.affected_road_count), c: 'text-amber-700' },
              { k: 'blocked', v: String(simulation.stats.blocked_road_count), c: 'text-red-600' },
              ...(simulation.stats.recommended
                ? [{ k: 'recommended', v: simulation.stats.recommended.replace('_', ' '), c: 'text-emerald-700' }]
                : []),
            ].map(({ k, v, c }) => (
              <span key={k} className="rounded-full border border-ops-edge bg-white px-2 py-0.5 shadow-card">
                <span className="text-ops-muted">{k} </span>
                <b className={`font-mono font-bold ${c}`}>{v}</b>
              </span>
            ))}
          </div>
        )}
      </div>

      {rerouted !== null && (
        <div
          className={`mb-2 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold ${
            rerouted
              ? 'border-amber-300 bg-amber-50 text-amber-700'
              : 'border-ops-edge bg-white text-ops-muted'
          }`}
        >
          {rerouted && <span className="relative flex h-2 w-2"><span className="absolute h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" /><span className="relative h-2 w-2 rounded-full bg-amber-500" /></span>}
          {rerouted
            ? 'ROUTE CHANGED — flood conditions altered the network; A* recalculated.'
            : 'Flood active — routes recalculated.'}
        </div>
      )}

      {stale && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
          </svg>
          MISSION SETTINGS CHANGED — press CALCULATE ROUTE / SIMULATE FLOOD to refresh these results.
        </div>
      )}

      {simulation && simulation.blocked_roads.length > 0 && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5">
          <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-red-600 text-[10px] font-bold text-white">🚫</span>
          <span className="text-[11px] leading-snug">
            <b className="text-red-700">BLOCKED FOR {simulation.vehicle.toUpperCase()} (depth &gt; {simulation.vehicle_limit_m} m): </b>
            <span className="text-slate-700">
              {simulation.blocked_roads.slice(0, 4).map((b) => `${b.name} (${b.depth_m.toFixed(2)} m)`).join(' · ')}
              {simulation.blocked_roads.length > 4 && ` · +${simulation.blocked_roads.length - 4} more`}
            </span>
          </span>
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-1">
        {PROFILE_ORDER.map((p) => (
          <RouteCard key={p} profile={p} route={routes[p]} selected={selected === p} onSelect={onSelect} />
        ))}
        {!any && simulation && (
          <div className="flex-1 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            No feasible route for this vehicle under the current flood conditions.
            Try a different vehicle (higher depth limit) or a lower flood level.
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-ops-muted">
        &quot;Safest&quot; means safest according to the backend&apos;s prototype risk weights —
        not a universally guaranteed safety rating. Terrain score: 0 = high ground, 1 = low ground.
      </p>
    </div>
  )
}
