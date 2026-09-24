import { useEffect, useRef, useState } from 'react'
import FloodMap from './Map'
import type { ProfileId } from './api'
import { PROFILE_ORDER } from './api'
import ControlPanel, { MissionConfig, VEHICLES } from './ControlPanel'
import RoutePanel from './RoutePanel'
import {
  calculateRoute, simulateFlood, ApiError, LOCATIONS,
  FloodZone, LatLng, RouteResult, SimulateResponse,
} from './api'

type Routes = Partial<Record<ProfileId, RouteResult>>

/* ------------------------------ small pieces ------------------------------ */

function Spinner() {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
  )
}

function ShimmerText({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`fr-shimmer-text bg-clip-text font-extrabold tracking-wider text-transparent ${className}`}
    >
      {children}
    </span>
  )
}

/* --------------------------------- app ----------------------------------- */

export default function App() {
  const [config, setConfig] = useState<MissionConfig>({
    vehicle: 'ambulance',
    originId: 'srm_ramapuram',
    destinationId: 'saidapet',
    floodLevel: 'NORMAL',
  })
  const [routes, setRoutes] = useState<Routes>({})
  const [selected, setSelected] = useState<ProfileId | null>(null)
  const [zones, setZones] = useState<FloodZone[]>([])
  const [simulation, setSimulation] = useState<SimulateResponse | null>(null)
  const [rerouted, setRerouted] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<'idle' | 'calculating' | 'simulating'>('idle')
  const [error, setError] = useState<ApiError | null>(null)
  const [fitSignal, setFitSignal] = useState(0)
  const [flash, setFlash] = useState(false)
  const prevPathRef = useRef<string>('')

  const origin: LatLng = LOCATIONS[config.originId]
  const destination: LatLng = LOCATIONS[config.destinationId]

  // stale-result tracking: mark displayed results outdated when the mission
  // config changes after they were computed
  const routesKey = `${config.vehicle}|${config.originId}|${config.destinationId}`
  const simKey = `${routesKey}|${config.floodLevel}`
  const computedRoutesKey = useRef<string | null>(null)
  const computedSimKey = useRef<string | null>(null)
  const [stale, setStale] = useState(false)

  useEffect(() => {
    const cr = computedRoutesKey.current
    const cs = computedSimKey.current
    if ((cr !== null && cr !== routesKey) || (cs !== null && cs !== simKey)) setStale(true)
  }, [routesKey, simKey])

  const markErr = (e: unknown) => {
    const err = e as ApiError
    setError(err?.message ? err : { message: String(e) })
  }

  // remember the selected route's geometry so we can detect a change
  const rememberPath = (rs: Routes, sel: ProfileId | null) => {
    const p = sel && rs[sel]?.success ? rs[sel]!.path : null
    if (!p) {
      prevPathRef.current = ''
      return
    }
    const key = p.map((pt) => pt.join(',')).join(';')
    if (prevPathRef.current && prevPathRef.current !== key) {
      setRerouted(true)
      setFlash(true)
      setTimeout(() => setFlash(false), 1600)
    }
    prevPathRef.current = key
  }

  async function handleCalculate() {
    setBusy('calculating')
    setError(null)
    try {
      // CALCULATE = clean NORMAL baseline: clear any active flood state and
      // fetch all three profiles so the comparison bar is fully populated.
      const profiles: ProfileId[] = [...PROFILE_ORDER]
      const settled = await Promise.allSettled(
        profiles.map((profile) =>
          calculateRoute({ origin, destination, vehicle: config.vehicle, profile }),
        ),
      )
      const rs: Routes = {}
      const errs: ApiError[] = []
      settled.forEach((s, i) => {
        if (s.status === 'fulfilled' && s.value.success) {
          rs[profiles[i]] = s.value
        } else if (s.status === 'rejected') {
          errs.push(s.reason as ApiError)
        } else {
          errs.push({ message: `${profiles[i]}: ${s.value.error ?? 'no route available'}` })
        }
      })
      if (!Object.keys(rs).length) throw errs[0] ?? { message: 'No route available' }
      setRoutes(rs)
      setZones([]) // back to NORMAL: remove flood zones
      setSimulation(null)
      setSelected('fastest')
      setRerouted(false)
      prevPathRef.current = '' // baseline: don't compare against the flooded route
      rememberPath(rs, 'fastest')
      computedRoutesKey.current = routesKey
      computedSimKey.current = null
      setStale(false)
      setFitSignal((n) => n + 1)
    } catch (e) {
      markErr(e)
    } finally {
      setBusy('idle')
    }
  }

  async function handleSimulate() {
    if (config.floodLevel === 'NORMAL') return
    setBusy('simulating')
    setError(null)
    try {
      const sim = await simulateFlood({
        origin,
        destination,
        vehicle: config.vehicle,
        flood_level: config.floodLevel as 'LOW' | 'MODERATE' | 'SEVERE',
      })
      const rs: Routes = sim.routes
      const feasible = sim.stats.feasible_profiles as ProfileId[]
      const nextSelected: ProfileId | null =
        selected && feasible.includes(selected)
          ? selected
          : ((sim.stats.recommended as ProfileId | null) ?? feasible[0] ?? null)
      setRoutes(rs)
      setSelected(nextSelected)
      setZones(sim.flood_zones)
      setSimulation(sim)
      setRerouted(false) // rememberPath flips this to true if the geometry changed
      rememberPath(rs, feasible.length ? nextSelected : null)
      computedRoutesKey.current = routesKey
      computedSimKey.current = simKey
      setStale(false)
      setFitSignal((n) => n + 1)
    } catch (e) {
      markErr(e)
    } finally {
      setBusy('idle')
    }
  }

  const vehicle = VEHICLES.find((v) => v.id === config.vehicle)!
  const simActive = simulation !== null && zones.length > 0
  const anyRoute = Object.values(routes).some((r) => r?.success)

  return (
    <div className={`flex h-screen flex-col overflow-hidden bg-ops-bg text-ops-text ${flash ? 'fr-flash' : ''}`}>
      {/* header */}
      <header className="relative z-[900] flex items-center justify-between border-b border-ops-edge bg-white/85 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="leading-none">
            <div className="bg-gradient-to-r from-slate-900 via-blue-800 to-indigo-700 bg-clip-text text-lg font-black tracking-widest text-transparent">
              FLOODROUTE
            </div>
            <div className="mt-1 font-mono text-[9px] font-medium tracking-[0.2em] text-ops-muted">
              EMERGENCY ROUTING CONSOLE
            </div>
          </div>
          <span className="ml-1 hidden rounded-md border border-ops-edge bg-ops-bg px-1.5 py-0.5 font-mono text-[10px] font-bold text-ops-muted sm:inline">
            v0.2
          </span>
        </div>

        <div className="flex items-center gap-2.5 text-xs">
          {/* status pill */}
          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 shadow-card transition-colors ${
              simActive ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'
            }`}
          >
            <span className="relative flex h-2.5 w-2.5">
              {simActive && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
              )}
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${simActive ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            </span>
            {simActive ? (
              <ShimmerText className="fr-shimmer-warn text-[11px]">
                🌊 FLOOD SIMULATION — {simulation?.flood_level}
              </ShimmerText>
            ) : (
              <span className="text-[11px] font-bold tracking-wider text-emerald-700">SIMULATION READY</span>
            )}
          </div>

          <span className="hidden rounded-lg border border-ops-edge bg-white px-2.5 py-1.5 font-semibold text-ops-text shadow-card md:inline">
            {vehicle.label}
          </span>
        </div>
      </header>

      {/* main row */}
      <div className="relative flex min-h-0 flex-1">
        {/* left: controls */}
        <aside className="z-[800] w-[290px] shrink-0 border-r border-ops-edge bg-white shadow-card">
          <ControlPanel
            config={config}
            onChange={setConfig}
            onCalculate={handleCalculate}
            onSimulate={handleSimulate}
            busy={busy !== 'idle'}
            simulateArmed={simActive}
          />
        </aside>

        {/* center: map */}
        <main className="relative min-w-0 flex-1">
          <FloodMap
            origin={origin}
            destination={destination}
            zones={zones}
            routes={routes}
            selected={selected}
            onSelect={(p) => setSelected(p)}
            fitSignal={fitSignal}
            simulation={simulation}
          />

          {/* legend overlay (glass) */}
          <div className="absolute bottom-4 right-4 z-[500] w-44 animate-rise rounded-xl border border-white/60 bg-white/80 px-3 py-2.5 text-[11px] shadow-overlay backdrop-blur-md">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
              <span className="text-[10px] font-extrabold tracking-widest text-ops-text">ROUTES</span>
            </div>
            <div className="space-y-1 text-ops-muted">
              {[
                { id: 'fastest', label: 'fastest', cls: 'from-blue-600 to-blue-400' },
                { id: 'safest', label: 'safest', cls: 'from-emerald-600 to-emerald-400' },
                { id: 'high_ground', label: 'high ground', cls: 'from-violet-600 to-violet-400', dashed: true },
                { id: 'shortest', label: 'shortest', cls: 'from-amber-500 to-amber-300', dashed: true },
                { id: 'major_roads', label: 'major roads', cls: 'from-cyan-600 to-cyan-400' },
                { id: 'balanced', label: 'balanced', cls: 'from-rose-600 to-rose-400' },
              ].map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  {r.dashed ? (
                    <span className={`inline-block w-5 border-t-2 border-dashed ${r.cls.replace(/from-(\S+)/, 'border-$1').replace(/to-\S+/, '')}`} />
                  ) : (
                    <span className={`inline-block h-1 w-5 rounded-full bg-gradient-to-r ${r.cls}`} />
                  )}
                  {r.label}
                </div>
              ))}
            </div>
            <div className="mb-1.5 mt-3 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="text-[10px] font-extrabold tracking-widest text-ops-text">FLOOD (SIM.)</span>
            </div>
            <div className="space-y-1 text-ops-muted">
              <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-4 rounded bg-amber-400/40" /> low</div>
              <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-4 rounded bg-amber-500/70" /> moderate</div>
              <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-4 rounded bg-red-500/60" /> severe</div>
              <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-4 rounded border-2 border-red-600 bg-white" /> 🚫 blocked</div>
            </div>
            <div className="mt-2 border-t border-slate-200/70 pt-1.5 text-[9px] text-ops-muted/70">
              © OpenStreetMap contributors
            </div>
          </div>

          {/* error banner (glass) */}
          {error && (
            <div className="absolute left-1/2 top-4 z-[600] w-[420px] -translate-x-1/2 animate-rise rounded-xl border border-red-300/70 bg-white/90 px-4 py-2.5 text-center text-sm text-ops-danger shadow-overlay backdrop-blur-md">
              <div className="flex items-center justify-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-red-100 text-[11px]">⚠</span>
                <b>{error.message}</b>
                <button className="ml-2 rounded-md px-1.5 text-xs text-ops-muted underline underline-offset-2 hover:text-ops-text" onClick={() => setError(null)}>
                  dismiss
                </button>
              </div>
              {error.detail && <div className="mt-0.5 text-xs text-ops-muted">{error.detail}</div>}
            </div>
          )}

          {/* no-route banner (glass) */}
          {simulation && !anyRoute && (
            <div className="absolute left-1/2 top-4 z-[600] w-[460px] -translate-x-1/2 animate-rise rounded-xl border border-red-300/70 bg-white/90 px-4 py-3 text-center shadow-overlay backdrop-blur-md">
              <b className="text-ops-danger">NO FEASIBLE ROUTE</b>
              <div className="mt-0.5 text-xs text-ops-muted">
                {simulation.vehicle} (limit {simulation.vehicle_limit_m} m) cannot enter this area at
                flood level {simulation.flood_level}. Try Fire Engine / Rescue Truck or a lower level.
              </div>
            </div>
          )}
        </main>

        {/* busy overlay */}
        {busy !== 'idle' && (
          <div className="absolute inset-0 z-[700] flex items-center justify-center bg-white/40 backdrop-blur-[3px]">
            <div className="flex animate-rise items-center gap-3 rounded-2xl border border-ops-edge bg-white/95 px-6 py-4 shadow-overlay">
              <Spinner />
              <ShimmerText className={`text-sm ${busy === 'calculating' ? 'fr-shimmer-accent' : 'fr-shimmer-warn'}`}>
                {busy === 'calculating' ? 'CALCULATING ROUTE…' : '🌊 SIMULATING FLOOD…'}
              </ShimmerText>
            </div>
          </div>
        )}
      </div>

      {/* bottom: route comparison */}
      <RoutePanel
        routes={routes}
        selected={selected}
        onSelect={(p) => setSelected(p)}
        simulation={simulation}
        rerouted={rerouted}
        stale={stale}
      />
    </div>
  )
}
