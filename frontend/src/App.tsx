import { useEffect, useRef, useState } from 'react'
import FloodMap, { ProfileId } from './Map'
import ControlPanel, { MissionConfig, VEHICLES } from './ControlPanel'
import RoutePanel from './RoutePanel'
import {
  calculateRoute, simulateFlood, ApiError, LOCATIONS,
  FloodZone, LatLng, RouteResult, SimulateResponse,
} from './api'

type Routes = Partial<Record<ProfileId, RouteResult>>

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
      const profiles: ProfileId[] = ['fastest', 'safest', 'high_ground']
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
      <header className="flex items-center justify-between border-b border-ops-edge bg-ops-panel px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-lg font-black tracking-widest">FLOODROUTE</span>
          <span className="rounded bg-ops-edge px-2 py-0.5 text-[10px] font-bold tracking-wider text-ops-muted">
            ROUTING CORE v0.2
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${simActive ? 'animate-pulse bg-ops-warn' : 'bg-ops-ok'}`} />
          <span className={simActive ? 'font-bold text-ops-warn' : 'text-ops-ok'}>
            {simActive ? `🌊 FLOOD SIMULATION ACTIVE — ${simulation?.flood_level}` : '● SIMULATION READY'}
          </span>
          <span className="ml-2 text-ops-muted">{vehicle.label}</span>
        </div>
      </header>

      {/* main row */}
      <div className="relative flex min-h-0 flex-1">
        {/* left: controls */}
        <aside className="w-[280px] shrink-0 border-r border-ops-edge bg-ops-panel">
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

          {/* legend overlay */}
          <div className="absolute bottom-4 right-4 z-[500] rounded-lg border border-ops-edge bg-ops-bg/90 px-3 py-2 text-[11px] shadow-lg">
            <div className="mb-1 font-bold tracking-wider text-ops-muted">ROUTES</div>
            <div className="flex items-center gap-2"><span className="inline-block h-0.5 w-4 rounded bg-ops-accent" /> fastest</div>
            <div className="flex items-center gap-2"><span className="inline-block h-0.5 w-4 rounded bg-ops-ok" /> safest</div>
            <div className="flex items-center gap-2"><span className="inline-block w-4 border-t-2 border-dashed border-purple-400" /> high ground</div>
            <div className="mb-1 mt-2 font-bold tracking-wider text-ops-muted">FLOOD (SIMULATED)</div>
            <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-4 rounded bg-ops-warn/30" /> low</div>
            <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-4 rounded bg-ops-warn/70" /> moderate</div>
            <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-4 rounded bg-ops-danger/50" /> severe</div>
            <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-4 rounded border-2 border-ops-danger" /> 🚫 blocked</div>
            <div className="mt-1 text-[10px] text-ops-muted">© OpenStreetMap contributors</div>
          </div>

          {/* error banner */}
          {error && (
            <div className="absolute left-1/2 top-4 z-[600] w-[420px] -translate-x-1/2 rounded-lg border border-ops-danger/60 bg-ops-danger/15 px-4 py-2 text-center text-sm text-ops-danger shadow-xl backdrop-blur">
              <b>⚠ {error.message}</b>
              {error.detail && <div className="mt-0.5 text-xs opacity-80">{error.detail}</div>}
              <button className="ml-3 underline underline-offset-2" onClick={() => setError(null)}>dismiss</button>
            </div>
          )}

          {/* no-route banner */}
          {simulation && !anyRoute && (
            <div className="absolute left-1/2 top-4 z-[600] w-[460px] -translate-x-1/2 rounded-lg border border-ops-danger/60 bg-ops-danger/20 px-4 py-3 text-center shadow-xl backdrop-blur">
              <b className="text-ops-danger">NO FEASIBLE ROUTE</b>
              <div className="text-xs text-ops-text/80">
                {simulation.vehicle} (limit {simulation.vehicle_limit_m} m) cannot enter this area at
                flood level {simulation.flood_level}. Try Fire Engine / Rescue Truck or a lower level.
              </div>
            </div>
          )}
        </main>

        {/* busy overlay */}
        {busy !== 'idle' && (
          <div className="absolute inset-0 z-[700] flex items-center justify-center bg-ops-bg/40 backdrop-blur-[2px]">
            <div className="rounded-lg border border-ops-edge bg-ops-panel px-5 py-3 text-sm font-bold tracking-wider text-ops-accent shadow-2xl">
              {busy === 'calculating' ? 'CALCULATING ROUTE…' : '🌊 SIMULATING FLOOD…'}
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
