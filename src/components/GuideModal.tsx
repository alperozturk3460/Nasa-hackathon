import { X } from 'lucide-react';

interface GuideModalProps {
  open: boolean;
  onClose: () => void;
}

export function GuideModal({ open, onClose }: GuideModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-2xl bg-[#090f1d] border border-slate-700 rounded-xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-100">
              MissionForge Orbital &amp; Surface Field Guide
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Stages 5 &amp; 6 — Orbital Capture, De-Orbit Targeting, Retro-Descent &amp; Rover Ops
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 max-h-[75vh] overflow-y-auto mission-scroll text-xs text-slate-300 leading-relaxed">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-lg bg-[#0d1527] border border-slate-800">
              <div className="font-display font-semibold text-cyan-300 text-sm">
                5A. Keplerian Orbit &amp; Tsiolkovsky Δv
              </div>
              <p className="mt-1.5">
                Orbital velocity and period follow{' '}
                <span className="font-mono-tabular text-white">v_orb = √(μ / r)</span> and{' '}
                <span className="font-mono-tabular text-white">T = 2π√(r³ / μ)</span>, while craft
                propellant budget uses{' '}
                <span className="font-mono-tabular text-white">Δv = Isp · g₀ · ln(m₀/mf)</span>.
                Switch between Light, Standard, and Heavy buses to test Δv capture margins.
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-[#0d1527] border border-slate-800">
              <div className="font-display font-semibold text-amber-300 text-sm">
                5B. Capture Maneuvers &amp; De-Orbit
              </div>
              <p className="mt-1.5">
                Choose Retro-Burn (100% Δv), Aerobraking (42% Δv on worlds with atmosphere), or
                Gravity Assist (65% Δv). Select a NASA landing site or click the 3D globe, then arm
                de-orbit to fire retro-thrusters overhead via Vis-Viva Hohmann transfer.
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-[#0d1527] border border-slate-800">
              <div className="font-display font-semibold text-emerald-300 text-sm">
                6A. Surface Gravity Retro-Descent
              </div>
              <p className="mt-1.5">
                Vertical powered descent throttles against exact local{' '}
                <span className="font-mono-tabular text-emerald-300">g_surf</span> (e.g. Moon
                1.624 m/s², Mars 3.721 m/s², 16 Psyche 0.144 m/s², and Europa&apos;s{' '}
                <span className="font-mono-tabular text-emerald-300">1.315 m/s²</span> ice shell),
                followed by hatch unlock and ramp deployment.
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-[#0d1527] border border-slate-800">
              <div className="font-display font-semibold text-sky-300 text-sm">
                6B. Rover A* Pathfinding &amp; Controls
              </div>
              <ul className="mt-1.5 space-y-1">
                <li>
                  <span className="font-mono-tabular text-white">Orbit Stage:</span> Click globe to
                  pin site, press <span className="font-mono-tabular text-amber-300">SPACE</span>{' '}
                  to arm de-orbit.
                </li>
                <li>
                  <span className="font-mono-tabular text-white">Click-to-Drive:</span> Click any
                  surface point for shortest obstacle-free pathing around boulders &amp; deep pits.
                </li>
                <li>
                  <span className="font-mono-tabular text-white">Manual Drive:</span>{' '}
                  <span className="font-mono-tabular text-emerald-300">WASD</span> / Arrow Keys or
                  Auto-Roam.
                </li>
                <li>
                  <span className="font-mono-tabular text-white">HUD / Camera:</span> Drag to orbit,
                  scroll to zoom, <span className="font-mono-tabular text-white">H</span> hides HUD.
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-white cursor-pointer"
          >
            Back to MissionForge
          </button>
        </div>
      </div>
    </div>
  );
}
