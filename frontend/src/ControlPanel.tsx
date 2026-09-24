import { useEffect, useState } from 'react'
import type { FloodLevel, VehicleId } from './api'
import { LOCATIONS } from './api'

export const VEHICLES: { id: VehicleId; label: string; limit: number }[] = [
  { id: 'ambulance', label: 'Ambulance', limit: 0.30 },
  { id: 'fire_engine', label: 'Fire Engine', limit: 0.45 },
  { id: 'rescue_truck', label: 'Rescue Truck', limit: 0.55 },
]

const FLOOD_LEVELS: { id: FloodLevel; label: string; hint?: string }[] = [
  { id: 'NORMAL', label: 'Normal', hint: 'no simulation' },
  { id: 'LOW', label: 'Low', hint: 'shallow pooling' },
  { id: 'MODERATE', label: 'Moderate', hint: 'streets flooding' },
  { id: 'SEVERE', label: 'Severe', hint: 'major inundation' },
]

const LOCATION_IDS = Object.keys(LOCATIONS) as (keyof typeof LOCATIONS)[]

export interface MissionConfig {
  vehicle: VehicleId
  originId: string
  destinationId: string
  floodLevel: FloodLevel
}

function Field({
  label, children, highlight,
}: {
  label: string
  children: React.ReactNode
  highlight?: boolean
}) {
  return (
    <label className={`block rounded-xl border p-2.5 transition-colors focus-within:border-blue-400 focus-within:bg-white
                      ${highlight ? 'animate-rise border-amber-400 bg-amber-50/70 ring-2 ring-amber-200' : 'border-ops-edge bg-ops-bg/60'}`}>
      <span className="mb-1 flex items-center gap-1.5 px-0.5 text-[10px] font-extrabold tracking-widest text-ops-muted">
        {label}
      </span>
      {children}
    </label>
  )
}

const selectCls =
  'w-full rounded-lg border border-ops-edge bg-white px-3 py-2 text-sm font-medium text-ops-text ' +
  'outline-none transition-colors focus:border-blue-500 disabled:opacity-50'

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
  const meterPct = (vehicle.limit / 0.6) * 100

  // warn inline (instead of a dead disabled button) when simulating at NORMAL
  const [needLevel, setNeedLevel] = useState(false)
  useEffect(() => {
    if (config.floodLevel !== 'NORMAL') setNeedLevel(false)
  }, [config.floodLevel])

  const handleSimulateClick = () => {
    if (config.floodLevel === 'NORMAL') {
      setNeedLevel(true)
      return
    }
    onSimulate()
  }

  return (
    <div className="flex h-full flex-col gap-3.5 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-extrabold tracking-widest text-ops-text">MISSION</h2>
        <div className="h-px flex-1 bg-gradient-to-r from-ops-edge to-transparent" />
      </div>

      {/* vehicle */}
      <Field label="VEHICLE">
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
        <div className="mt-2 px-0.5">
          <div className="flex items-center justify-between text-[10px] font-semibold text-ops-muted">
            <span>max water depth</span>
            <span className="font-mono font-bold text-amber-600">{vehicle.limit.toFixed(2)} m</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-red-500 transition-all duration-500"
              style={{ width: `${meterPct}%` }}
            />
          </div>
        </div>
      </Field>

      {/* route endpoints */}
      <Field label="FROM">
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
      </Field>

      <Field label="DESTINATION">
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
      </Field>

      {/* flood level */}
      <Field label="FLOOD LEVEL" highlight={needLevel}>
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
        <div className="mt-1.5 px-0.5 text-[10px] font-medium text-ops-muted">
          {FLOOD_LEVELS.find((l) => l.id === config.floodLevel)?.hint}
        </div>
      </Field>

      {/* actions */}
      <div className="mt-1 flex flex-col gap-2.5">
        <button
          onClick={onCalculate}
          disabled={busy || config.originId === config.destinationId}
          className="group relative overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 text-sm font-extrabold tracking-wide text-white
                     shadow-accent-glow transition-all hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0
                     disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0"
        >
          <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          {busy ? 'CALCULATING…' : 'CALCULATE ROUTE'}
        </button>
        <button
          onClick={handleSimulateClick}
          disabled={busy || config.originId === config.destinationId}
          className="rounded-xl border-2 border-amber-500/70 bg-amber-50 px-4 py-3 text-sm font-extrabold tracking-wide text-amber-700
                     shadow-warn-glow transition-all hover:-translate-y-0.5 hover:bg-amber-100 active:translate-y-0
                     disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0"
        >
          {simulateArmed ? '🌊 SIMULATE FLOOD' : 'SIMULATE FLOOD'}
        </button>
        {needLevel && (
          <div className="animate-rise flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-snug text-amber-700">
            <span>⚠</span>
            <span>Pick a flood level first (Low / Moderate / Severe) — simulation runs against the selected level.</span>
          </div>
        )}
      </div>

      <p className="mt-auto border-t border-ops-edge pt-3 text-[11px] leading-relaxed text-ops-muted">
        Prototype decision-support demo. Flood zones are simulated and vehicle depth
        limits are illustrative — not official hydrology or vehicle specifications.
      </p>
    </div>
  )
}
