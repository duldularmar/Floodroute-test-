import type { ProfileId } from './Map'
import type { RouteResult, SimulateResponse } from './api'

const PROFILE_META: Record<ProfileId, { label: string; sub: string; color: string; ring: string; text: string }> = {
  fastest: { label: 'FASTEST', sub: 'minimum ETA', color: 'border-ops-accent', ring: 'ring-ops-accent', text: 'text-ops-accent' },
  safest: { label: 'SAFEST', sub: 'least flood exposure', color: 'border-ops-ok', ring: 'ring-ops-ok', text: 'text-ops-ok' },
  high_ground: { label: 'HIGH GROUND', sub: 'prefers elevated roads', color: 'border-purple-400', ring: 'ring-purple-400', text: 'text-purple-300' },
}

const RISK_COLOR: Record<string, string> = {
  NONE: 'text-ops-ok',
  LOW: 'text-ops-ok',
  MODERATE: 'text-ops-warn',
  HIGH: 'text-ops-danger',
  SEVERE: 'text-ops-danger',
}

function Metric({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div className="flex-1">
      <div className="text-[10px] font-semibold tracking-wider text-ops-muted">{label}</div>
      <div className={`text-base font-bold leading-tight ${color ?? 'text-ops-text'}`}>
        {value}
        {unit && <span className="ml-0.5 text-[11px] font-medium text-ops-muted">{unit}</span>}
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
  const riskColor = RISK_COLOR[route.risk] ?? 'text-ops-text'
  return (
    <button
      onClick={() => onSelect(profile)}
      className={`min-w-[210px] flex-1 rounded-lg border-l-4 bg-ops-panel p-3 text-left transition
                  ${meta.color} ${selected ? `ring-2 ${meta.ring} shadow-lg shadow-black/30` : 'opacity-80 hover:opacity-100'}`}
    >
      <div className="flex items-baseline justify-between">
        <span className={`text-sm font-extrabold tracking-wider ${meta.text}`}>
          {meta.label}{selected ? ' ★' : ''}
        </span>
        <span className={`text-[10px] font-bold uppercase ${riskColor}`}>risk {route.risk}</span>
      </div>
      <div className={`mb-1 text-[10px] text-ops-muted`}>{meta.sub}</div>
      <div className="mt-2 flex gap-3">
        <Metric label="DISTANCE" value={route.distance_km.toFixed(2)} unit="km" />
        <Metric label="ETA" value={route.eta_minutes.toFixed(1)} unit="min" />
        <Metric label="FLOOD EXPOSURE" value={route.flood_exposure.toFixed(2)} unit="km"
                color={route.flood_exposure > 0 ? 'text-ops-warn' : 'text-ops-ok'} />
        <Metric label="TERRAIN" value={route.terrain_score.toFixed(2)} />
      </div>
      {route.blocked_roads.length > 0 && (
        <div className="mt-1 text-[10px] text-ops-danger">
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
    <div className="border-t border-ops-edge bg-ops-bg/95 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-bold tracking-widest text-ops-muted">ROUTE OPTIONS</h2>
        {simulation && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ops-muted">
            <span>scenario <b className="text-ops-text">{simulation.scenario}</b></span>
            <span>level <b className="text-ops-warn">{simulation.flood_level}</b></span>
            <span>vehicle <b className="text-ops-text">{simulation.vehicle}</b> (limit {simulation.vehicle_limit_m} m)</span>
            <span>affected roads <b className="text-ops-warn">{simulation.stats.affected_road_count}</b></span>
            <span>blocked <b className="text-ops-danger">{simulation.stats.blocked_road_count}</b></span>
            {simulation.stats.recommended && (
              <span>recommended <b className="text-ops-ok">{simulation.stats.recommended.replace('_', ' ')}</b></span>
            )}
          </div>
        )}
      </div>

      {rerouted !== null && (
        <div className={`mb-2 rounded-md border px-3 py-1.5 text-xs font-bold tracking-wide
          ${rerouted ? 'border-ops-warn/50 bg-ops-warn/10 text-ops-warn' : 'border-ops-edge bg-ops-panel text-ops-muted'}`}>
          {rerouted
            ? '⚠ ROUTE CHANGED — flood conditions altered the network; A* recalculated.'
            : 'Flood active — routes recalculated.'}
        </div>
      )}

      {stale && (
        <div className="mb-2 rounded-md border border-ops-accent/40 bg-ops-accent/10 px-3 py-1.5 text-xs font-bold tracking-wide text-ops-accent">
          MISSION SETTINGS CHANGED — press CALCULATE ROUTE / SIMULATE FLOOD to refresh these results.
        </div>
      )}

      {simulation && simulation.blocked_roads.length > 0 && (
        <div className="mb-2 rounded-md border border-ops-danger/40 bg-ops-danger/10 px-3 py-1.5">
          <span className="text-[10px] font-bold tracking-wider text-ops-danger">🚫 BLOCKED FOR {simulation.vehicle.toUpperCase()} (depth &gt; {simulation.vehicle_limit_m} m): </span>
          <span className="text-[11px] text-ops-text/85">
            {simulation.blocked_roads.slice(0, 4).map((b) => `${b.name} (${b.depth_m.toFixed(2)} m)`).join(' · ')}
            {simulation.blocked_roads.length > 4 && ` · +${simulation.blocked_roads.length - 4} more`}
          </span>
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-1">
        {(['fastest', 'safest', 'high_ground'] as const).map((p) => (
          <RouteCard key={p} profile={p} route={routes[p]} selected={selected === p} onSelect={onSelect} />
        ))}
        {!any && simulation && (
          <div className="flex-1 rounded-lg border border-ops-danger/50 bg-ops-danger/10 p-4 text-sm text-ops-danger">
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
