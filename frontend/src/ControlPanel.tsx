import type { FloodLevel, VehicleId } from './api'
import { LOCATIONS } from './api'

export const VEHICLES: { id: VehicleId; label: string; limit: number }[] = [
  { id: 'ambulance', label: 'Ambulance', limit: 0.30 },
  { id: 'fire_engine', label: 'Fire Engine', limit: 0.45 },
  { id: 'rescue_truck', label: 'Rescue Truck', limit: 0.55 },
]

const FLOOD_LEVELS: { id: FloodLevel; label: string }[] = [
  { id: 'NORMAL', label: 'Normal' },
  { id: 'LOW', label: 'Low' },
  { id: 'MODERATE', label: 'Moderate' },
  { id: 'SEVERE', label: 'Severe' },
]

const LOCATION_IDS = Object.keys(LOCATIONS) as (keyof typeof LOCATIONS)[]

export interface MissionConfig {
  vehicle: VehicleId
  originId: string
  destinationId: string
  floodLevel: FloodLevel
}

export default function ControlPanel({
  config, onChange, onCalculate, onSimulate, busy, simulateArmed,
}: {
  config: MissionConfig
  onChange: (c: MissionConfig) => void
  onCalculate: () => void
  onSimulate: () => void
  busy: boolean
  simulateArmed: boolean
}) {
  const set = (patch: Partial<MissionConfig>) => onChange({ ...config, ...patch })
  const vehicle = VEHICLES.find((v) => v.id === config.vehicle)!

  const selectCls =
    'w-full rounded-md border border-ops-edge bg-ops-bg px-3 py-2 text-sm text-ops-text ' +
    'outline-none focus:border-ops-accent transition-colors disabled:opacity-50'

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h2 className="text-xs font-bold tracking-widest text-ops-muted">MISSION</h2>
        <div className="mt-2 h-px bg-ops-edge" />
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold tracking-wide text-ops-muted">VEHICLE</span>
        <select
          className={selectCls}
          value={config.vehicle}
          onChange={(e) => set({ vehicle: e.target.value as VehicleId })}
          disabled={busy}
        >
          {VEHICLES.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-ops-muted">
          max simulated depth {vehicle.limit.toFixed(2)} m (prototype value)
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold tracking-wide text-ops-muted">FROM</span>
        <select
          className={selectCls}
          value={config.originId}
          onChange={(e) => set({ originId: e.target.value })}
          disabled={busy}
        >
          {LOCATION_IDS.map((id) => (
            <option key={id} value={id}>{LOCATIONS[id].label}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold tracking-wide text-ops-muted">DESTINATION</span>
        <select
          className={selectCls}
          value={config.destinationId}
          onChange={(e) => set({ destinationId: e.target.value })}
          disabled={busy}
        >
          {LOCATION_IDS.map((id) => (
            <option key={id} value={id} disabled={id === config.originId}>
              {LOCATIONS[id].label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold tracking-wide text-ops-muted">FLOOD LEVEL</span>
        <select
          className={selectCls}
          value={config.floodLevel}
          onChange={(e) => set({ floodLevel: e.target.value as FloodLevel })}
          disabled={busy}
        >
          {FLOOD_LEVELS.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
      </label>

      <div className="mt-2 flex flex-col gap-2">
        <button
          onClick={onCalculate}
          disabled={busy || config.originId === config.destinationId}
          className="rounded-md bg-ops-accent px-4 py-2.5 text-sm font-bold tracking-wide text-ops-bg
                     transition hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'CALCULATING…' : 'CALCULATE ROUTE'}
        </button>
        <button
          onClick={onSimulate}
          disabled={busy || config.originId === config.destinationId || config.floodLevel === 'NORMAL'}
          title={config.floodLevel === 'NORMAL' ? 'Pick a flood level first (Low/Moderate/Severe)' : undefined}
          className="rounded-md border border-ops-warn/60 bg-ops-warn/10 px-4 py-2.5 text-sm font-bold tracking-wide text-ops-warn
                     transition hover:bg-ops-warn/20 active:bg-ops-warn/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {simulateArmed ? '🌊 SIMULATE FLOOD' : 'SIMULATE FLOOD'}
        </button>
      </div>

      <p className="mt-auto text-[11px] leading-relaxed text-ops-muted">
        Prototype decision-support demo. Flood zones are simulated and vehicle depth
        limits are illustrative — not official hydrology or vehicle specifications.
      </p>
    </div>
  )
}
