import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Award,
  BatteryCharging,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Crosshair,
  FastForward,
  Flame,
  Flashlight,
  Gauge,
  Layers,
  MapPin,
  Navigation,
  Orbit,
  Play,
  RotateCcw,
  Sparkles,
  Sun,
  Video,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CraftStats, SurfacePhase, WORLDS, WorldId } from '../data/missionData';
import {
  RoverNavTelemetry,
  ScienceMissionState,
  SurfaceCameraMode,
  SurfaceTelemetry,
} from '../three/MissionWorldEngine';
import { AppLang } from './TopBar';

interface FinalVisualOverlayProps {
  lang: AppLang;
  targetWorldId: WorldId;
  stats: CraftStats;
  surfacePhase: SurfacePhase;
  surfaceTelemetry: SurfaceTelemetry;
  cameraMode: SurfaceCameraMode;
  autoRoam: boolean;
  headlightsOn: boolean;
  sunElevationDeg: number;
  autoShowcaseOrbit: boolean;
  roverNav: RoverNavTelemetry;
  scienceState: ScienceMissionState;
  onSelectCameraMode: (mode: SurfaceCameraMode) => void;
  onSetManualThrottle: (pct: number | null) => void;
  onSetSunElevationDeg: (deg: number) => void;
  onToggleAutoShowcaseOrbit: () => void;
  onToggleAutoRoam: () => void;
  onToggleHeadlights: () => void;
  onTriggerChemCam: () => void;
  onStartAutonomousMission: () => void;
  onResetRoverState: () => void;
  onDriveControl: (forward: number, turn: number) => void;
  onCancelRoverRoute: () => void;
  onReplaySequence: () => void;
  onSkipToRover: () => void;
  onReturnToOrbit: () => void;
}

interface OxideValues {
  sio2: number;
  fe2o3: number;
  al2o3: number;
  cao: number;
}

function parseOxideBreakdown(summary: string): OxideValues {
  const sio2Match = summary.match(/%(\d+)\s*SiO2/i);
  const feMatch = summary.match(/%(\d+)\s*Fe2O3/i);
  const alMatch = summary.match(/%(\d+)\s*Al2O3/i);
  const caMatch = summary.match(/%(\d+)\s*CaO/i);
  if (sio2Match && feMatch && alMatch && caMatch) {
    return {
      sio2: Number(sio2Match[1]),
      fe2o3: Number(feMatch[1]),
      al2o3: Number(alMatch[1]),
      cao: Number(caMatch[1]),
    };
  }
  return { sio2: 46, fe2o3: 24, al2o3: 18, cao: 12 };
}

function translateRoverStatus(status: string, isTr: boolean): string {
  if (isTr) return status;
  if (status === 'GÜÇ TÜKENDİ!') return 'POWER DEPLETED!';
  if (status === 'HAREKET HALİNDE') return 'DRIVING / IN MOTION';
  if (status === 'ANALİZ YAPILIYOR') return 'LASER SCAN ACTIVE';
  return 'STANDBY / MMRTG CHARGING';
}

function translateCameraSensor(status: string, isTr: boolean): string {
  if (isTr) return status;
  if (status.includes('Hedef Yakında')) return 'Target Locked (Close Range)';
  if (status.includes('Navigasyon')) return 'Navigation (Active Scan)';
  return 'Wide Angle (Standby)';
}

export function FinalVisualOverlay({
  lang,
  targetWorldId,
  stats,
  surfacePhase,
  surfaceTelemetry,
  cameraMode,
  autoRoam,
  headlightsOn,
  sunElevationDeg,
  autoShowcaseOrbit,
  roverNav,
  scienceState,
  onSelectCameraMode,
  onSetManualThrottle,
  onSetSunElevationDeg,
  onToggleAutoShowcaseOrbit,
  onToggleAutoRoam,
  onToggleHeadlights,
  onTriggerChemCam,
  onStartAutonomousMission,
  onResetRoverState,
  onDriveControl,
  onCancelRoverRoute,
  onReplaySequence,
  onSkipToRover,
  onReturnToOrbit,
}: FinalVisualOverlayProps) {
  const world = WORLDS[targetWorldId];
  const isTr = lang === 'tr';

  const surfaceSteps: { id: SurfacePhase; label: string }[] = [
    { id: 'descending', label: isTr ? '1. Alçalma' : '1. Descent' },
    { id: 'landed', label: isTr ? '2. Konma' : '2. Touchdown' },
    { id: 'ramp_deploy', label: isTr ? '3. Rampa Açılışı' : '3. Ramp Deploy' },
    { id: 'rover_exit', label: isTr ? '4. Rover İnişi' : '4. Rover Exit' },
    { id: 'rover_active', label: isTr ? '5. Yüzey Keşfi' : '5. Explore' },
  ];

  const cameraModes: { id: SurfaceCameraMode; label: string }[] = [
    { id: 'chase', label: isTr ? 'Takip Kamerası' : 'Chase Orbit' },
    { id: 'starship_cam', label: 'Starship Cam' },
    { id: 'pad_cam', label: isTr ? 'İniş Alanı' : 'Pad Cam' },
    { id: 'rover_cam', label: 'MastCam (1P)' },
  ];

  const activeStepIdx = surfaceSteps.findIndex((s) => s.id === surfacePhase);
  const [freeExploreDismissed, setFreeExploreDismissed] = useState(false);
  const [asiCollapsed, setAsiCollapsed] = useState(false);
  const [landerCardCollapsed, setLanderCardCollapsed] = useState(false);
  const [selectedMineralSample, setSelectedMineralSample] = useState<
    ScienceMissionState['samples'][number] | null
  >(null);
  const [descentHistory, setDescentHistory] = useState<{ alt: number; vel: number }[]>([
    { alt: 150, vel: 19 },
  ]);
  const radarCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!scienceState.missionComplete) {
      setFreeExploreDismissed(false);
    }
  }, [scienceState.missionComplete, targetWorldId]);

  useEffect(() => {
    if (scienceState.samples.length > 0) {
      setSelectedMineralSample(scienceState.samples[scienceState.samples.length - 1]);
    } else {
      setSelectedMineralSample(null);
    }
  }, [scienceState.samples.length, targetWorldId]);

  // Record live Altitude & Vertical Speed history for the Descent Telemetry Sparkline
  useEffect(() => {
    if (surfacePhase === 'descending') {
      setDescentHistory((prev) => {
        if (surfaceTelemetry.altitudeM >= 148 && prev.length > 4) {
          return [{ alt: surfaceTelemetry.altitudeM, vel: surfaceTelemetry.verticalSpeedMs }];
        }
        return [
          ...prev.slice(-39),
          { alt: surfaceTelemetry.altitudeM, vel: surfaceTelemetry.verticalSpeedMs },
        ];
      });
    } else if (surfacePhase === 'landed') {
      setDescentHistory((prev) => [...prev.slice(-39), { alt: 0, vel: 0 }]);
    }
  }, [surfacePhase, surfaceTelemetry.altitudeM, surfaceTelemetry.verticalSpeedMs]);

  const descentSparklinePaths = useMemo(() => {
    const pts =
      descentHistory.length > 1
        ? descentHistory
        : [
            { alt: 150, vel: 19 },
            { alt: 150, vel: 19 },
          ];
    const w = 260;
    const h = 44;
    const altPoints = pts
      .map((p, idx) => {
        const x = (idx / Math.max(1, pts.length - 1)) * w;
        const y = h - Math.min(1, Math.max(0, p.alt / 155)) * (h - 6) - 3;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const velPoints = pts
      .map((p, idx) => {
        const x = (idx / Math.max(1, pts.length - 1)) * w;
        const y = h - Math.min(1, Math.max(0, p.vel / 28)) * (h - 6) - 3;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    return { altPoints, velPoints };
  }, [descentHistory]);

  const activeOxides = useMemo(() => {
    const sourceText = selectedMineralSample?.oxideBreakdown || scienceState.spectrometerSummary;
    return parseOxideBreakdown(sourceText);
  }, [selectedMineralSample, scienceState.spectrometerSummary]);

  const spectralSparklinePath = useMemo(() => {
    const w = 276;
    const h = 42;
    const steps = 42;
    const points: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const nm = 400 + t * 500;
      const pSio2 = Math.exp(-Math.pow((nm - 485) / 38, 2)) * (activeOxides.sio2 / 60);
      const pAl = Math.exp(-Math.pow((nm - 590) / 34, 2)) * (activeOxides.al2o3 / 35);
      const pCa = Math.exp(-Math.pow((nm - 685) / 32, 2)) * (activeOxides.cao / 30);
      const pFe = Math.exp(-Math.pow((nm - 790) / 42, 2)) * (activeOxides.fe2o3 / 45);
      const val = Math.min(1, 0.12 + pSio2 * 0.65 + pAl * 0.55 + pCa * 0.5 + pFe * 0.72);
      const x = t * w;
      const y = h - val * (h - 6) - 3;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return points.join(' ');
  }, [activeOxides]);

  // Draw Live 2D Topographic Radar Canvas
  useEffect(() => {
    const canvas = radarCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;
    const half = size / 2;
    const maxR = Math.max(12, scienceState.maxMapRadius || 45);
    const toPx = (coord: number) => half + (coord / maxR) * (half - 6);

    ctx.fillStyle = '#040914';
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(34, 211, 238, 0.14)';
    ctx.lineWidth = 1;
    [0.33, 0.66, 0.95].forEach((frac) => {
      ctx.beginPath();
      ctx.arc(half, half, (half - 4) * frac, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.beginPath();
    ctx.moveTo(half, 0);
    ctx.lineTo(half, size);
    ctx.moveTo(0, half);
    ctx.lineTo(size, half);
    ctx.stroke();

    for (const c of scienceState.radarCraters) {
      const cx = toPx(c.x);
      const cz = toPx(c.z);
      const cr = Math.max(2.5, (c.radius / maxR) * (half - 6));
      ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.35)';
      ctx.beginPath();
      ctx.arc(cx, cz, cr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (scienceState.radarRoute.length >= 2) {
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      scienceState.radarRoute.forEach((pt, idx) => {
        const px = toPx(pt.x);
        const pz = toPx(pt.z);
        if (idx === 0) ctx.moveTo(px, pz);
        else ctx.lineTo(px, pz);
      });
      ctx.stroke();
    }

    for (const t of scienceState.radarTargets) {
      const tx = toPx(t.x);
      const tz = toPx(t.z);
      if (t.isPrimary) {
        ctx.fillStyle = t.scanned ? '#10b981' : '#f59e0b';
        ctx.beginPath();
        ctx.arc(tx, tz, t.scanned ? 2.6 : 3.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = t.scanned ? '#34d399' : 'rgba(148, 163, 184, 0.45)';
        ctx.beginPath();
        ctx.arc(tx, tz, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(half - 2.5, half - 2.5, 5, 5);

    const rx = toPx(scienceState.roverX);
    const rz = toPx(scienceState.roverZ);
    const sinH = Math.sin(scienceState.roverHeading);
    const cosH = Math.cos(scienceState.roverHeading);

    ctx.strokeStyle = 'rgba(248, 113, 113, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(rx, rz);
    ctx.lineTo(rx + sinH * 8, rz + cosH * 8);
    ctx.stroke();

    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(rx, rz, 3.3, 0, Math.PI * 2);
    ctx.fill();
  }, [
    asiCollapsed,
    scienceState.roverX,
    scienceState.roverZ,
    scienceState.roverHeading,
    scienceState.maxMapRadius,
    scienceState.radarCraters,
    scienceState.radarTargets,
    scienceState.radarRoute,
  ]);

  const isManualThrottle = surfaceTelemetry.manualThrottlePct !== null;

  const statusColorClass =
    scienceState.roverStatus === 'GÜÇ TÜKENDİ!'
      ? 'text-rose-400'
      : scienceState.roverStatus === 'HAREKET HALİNDE'
      ? 'text-cyan-300'
      : scienceState.roverStatus === 'ANALİZ YAPILIYOR'
      ? 'text-amber-300'
      : 'text-emerald-400';

  const sunTimePresetLabel =
    sunElevationDeg <= 10
      ? isTr
        ? 'Gece'
        : 'Night'
      : sunElevationDeg <= 22
      ? isTr
        ? 'Alacakaranlık'
        : 'Dusk'
      : isTr
      ? 'Gündüz'
      : 'Day';

  return (
    <>
      {/* First-Person Curiosity Remote Sensing Mast (ChemCam / MastCam / NavCam) Reticle Overlay */}
      {cameraMode === 'rover_cam' && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="w-72 h-48 border border-cyan-400/30 rounded-lg relative flex items-center justify-center">
            <div className="absolute top-2 left-2.5 text-[10px] font-mono-tabular text-cyan-300/80">
              MSL CURIOSITY · CHEMCAM &amp; MASTCAM
            </div>
            <div className="absolute bottom-2 right-2.5 text-[10px] font-mono-tabular text-emerald-300/80">
              APXS / MAHLI 5-DOF TURRET
            </div>
            <Crosshair className="w-6 h-6 text-cyan-400/55" />
          </div>
        </div>
      )}

      {/* Top Bar: Step Sequence + Sun Angle & Cinematic Tour + Multi-Angle Camera Switcher */}
      <div className="pointer-events-auto absolute top-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-[#080d1a]/94 border border-slate-800 rounded-lg p-1.5 flex flex-wrap items-center gap-1">
            {surfaceSteps.map((step, idx) => {
              const active = step.id === surfacePhase;
              const completed = idx < activeStepIdx;
              return (
                <div
                  key={step.id}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono-tabular font-medium transition-colors ${
                    active
                      ? 'bg-emerald-500 text-slate-950 font-bold'
                      : completed
                      ? 'bg-cyan-950/70 text-cyan-300 border border-cyan-500/30'
                      : 'text-slate-500'
                  }`}
                >
                  {step.label}
                </div>
              );
            })}
          </div>

          {surfacePhase !== 'rover_active' ? (
            <button
              type="button"
              onClick={onSkipToRover}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0b1222]/94 border border-slate-700 hover:border-cyan-400 text-xs font-medium text-cyan-200 cursor-pointer"
            >
              <FastForward className="w-3.5 h-3.5" />
              <span>{isTr ? 'Rover Keşfine Geç' : 'Skip to Rover'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onReplaySequence}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0b1222]/94 border border-slate-700 hover:border-amber-400 text-xs font-medium text-amber-200 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{isTr ? 'İnişi Tekrarla' : 'Replay Landing'}</span>
            </button>
          )}

          {surfacePhase === 'rover_active' && roverNav.active && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#081524]/95 border border-cyan-500/60 text-xs font-mono-tabular text-cyan-200">
              <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>
                {isTr ? 'En Kısa Rota' : 'Shortest Route'} · {roverNav.distanceM.toFixed(1)} m
              </span>
              <button
                type="button"
                onClick={onCancelRoverRoute}
                aria-label="Cancel rover route"
                className="ml-1 p-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {surfacePhase === 'rover_active' && roverNav.obstacleNotice && (
            <div className="px-3 py-1.5 rounded-lg bg-[#1c1408]/95 border border-amber-500/60 text-xs font-mono-tabular text-amber-200">
              {roverNav.obstacleNotice}
            </div>
          )}
        </div>

        {/* Right Top Bar: Sun Angle Slider + Cinematic Camera Tour + Camera Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-[#080d1a]/94 border border-slate-800 rounded-lg px-2.5 py-1 flex items-center gap-2">
            <Sun
              className={`w-3.5 h-3.5 ${
                sunElevationDeg <= 20 ? 'text-orange-400' : 'text-amber-300'
              }`}
            />
            <span className="text-[10px] font-mono-tabular text-slate-300">
              {isTr ? 'GÜNEŞ' : 'SUN'} {sunElevationDeg}° ({sunTimePresetLabel})
            </span>
            <input
              type="range"
              min={5}
              max={85}
              step={1}
              value={sunElevationDeg}
              onChange={(e) => onSetSunElevationDeg(Number(e.target.value))}
              aria-label="Sun elevation angle"
              className="w-20 accent-amber-400 cursor-pointer"
            />
            <div className="flex items-center gap-1 border-l border-slate-800 pl-1.5">
              {[
                { label: isTr ? 'Gündüz' : 'Day', deg: 58 },
                { label: isTr ? 'Alacakaranlık' : 'Dusk', deg: 14 },
                { label: isTr ? 'Gece' : 'Night', deg: 6 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => onSetSunElevationDeg(preset.deg)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono-tabular transition-colors cursor-pointer ${
                    Math.abs(sunElevationDeg - preset.deg) <= 4
                      ? 'bg-amber-400 text-slate-950 font-bold'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* 360° Cinematic Auto-Showcase Tour Toggle */}
          <button
            type="button"
            onClick={onToggleAutoShowcaseOrbit}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-mono-tabular font-semibold transition-colors cursor-pointer ${
              autoShowcaseOrbit
                ? 'bg-emerald-500 border-emerald-400 text-slate-950 font-bold'
                : 'bg-[#080d1a]/94 border-slate-800 text-cyan-200 hover:border-cyan-400'
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            <span>
              {isTr ? 'Sinematik Tur' : 'Cinematic Tour'}:{' '}
              {autoShowcaseOrbit ? (isTr ? 'AÇIK' : 'ON') : isTr ? 'KAPALI' : 'OFF'}
            </span>
          </button>

          {/* Multi-Angle Camera Mode Bar ([C] shortcut) */}
          <div className="bg-[#080d1a]/94 border border-slate-800 rounded-lg p-1 flex items-center gap-1">
            <span className="px-2 text-[10px] font-mono-tabular text-slate-400 flex items-center gap-1">
              <Camera className="w-3.5 h-3.5 text-cyan-400" />
              CAM [C]
            </span>
            {cameraModes.map((cam) => {
              const active = cameraMode === cam.id;
              return (
                <button
                  key={cam.id}
                  type="button"
                  onClick={() => onSelectCameraMode(cam.id)}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono-tabular font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'bg-slate-900/75 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {cam.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* [ ASİ TELEMETRY ] Collapsible Modular Radar, Sensor, Spectral Sparkline & 3D Mineral Card */}
      {surfacePhase === 'rover_active' && (
        <aside className="pointer-events-auto absolute top-16 right-4 z-20 w-[346px] max-w-[94vw] max-h-[calc(100vh-148px)] overflow-y-auto mission-scroll bg-[#080d19]/95 border border-emerald-500/45 rounded-xl p-3.5 shadow-2xl space-y-2.5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-mono-tabular font-bold text-emerald-400 tracking-wide flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              {isTr ? '[ ASİ TELEMETRİ ]' : '[ ASI TELEMETRY ]'}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono-tabular text-cyan-300">
                MSL CURIOSITY (CLEAN)
              </span>
              <button
                type="button"
                onClick={() => setAsiCollapsed((prev) => !prev)}
                aria-label={asiCollapsed ? 'Expand ASI Telemetry' : 'Collapse ASI Telemetry'}
                className="p-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 cursor-pointer"
              >
                {asiCollapsed ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronUp className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Rover Status, MMRTG Nuclear Battery & Collected Sample Counter */}
          <div className="space-y-1.5 text-[11px] font-mono-tabular">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">{isTr ? 'DURUM:' : 'STATUS:'}</span>
              <span className={`font-bold ${statusColorClass}`}>
                {translateRoverStatus(scienceState.roverStatus, isTr)}
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1">
                  <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
                  {isTr ? 'GÜÇ (MMRTG NÜKLEER):' : 'POWER (MMRTG NUCLEAR):'}
                </span>
                <span className="text-slate-100 font-bold">
                  {scienceState.batteryPct.toFixed(1)} / {scienceState.maxBattery}
                </span>
              </div>
              <div className="h-1.5 bg-slate-900 border border-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-150 ${
                    scienceState.batteryPct < 25 ? 'bg-rose-500' : 'bg-emerald-400'
                  }`}
                  style={{ width: `${Math.min(100, scienceState.batteryPct)}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-0.5">
              <span className="text-amber-300 font-bold">
                {isTr ? 'TOPLANAN ÖRNEK:' : 'COLLECTED SAMPLES:'}
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/50 text-amber-200 font-bold">
                {scienceState.collectedCount} / {scienceState.totalTargets} (
                {isTr ? 'Toplam' : 'Total'}: {scienceState.samples.length})
              </span>
            </div>
          </div>

          {!asiCollapsed && (
            <>
              {/* Live 2D Topographic Radar + 6-Sensor Telemetry Grid */}
              <div className="grid grid-cols-[124px_1fr] gap-2.5 items-center bg-[#0b1222] border border-slate-800/90 rounded-lg p-2">
                <div className="flex flex-col items-center">
                  <div className="w-[116px] h-[116px] rounded-md border border-emerald-500/50 overflow-hidden bg-[#040914]">
                    <canvas
                      ref={radarCanvasRef}
                      width={116}
                      height={116}
                      className="w-full h-full block"
                    />
                  </div>
                  <span className="text-[9px] font-mono-tabular text-slate-400 mt-1">
                    RADAR · {scienceState.totalDistanceM.toFixed(1)} m
                  </span>
                </div>

                <div className="space-y-1 text-[10px] font-mono-tabular">
                  <div className="text-emerald-400 font-bold border-b border-slate-800 pb-0.5 mb-1">
                    {isTr ? 'SENSÖR VERİLERİ' : 'SENSOR SUITE'}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">{isTr ? 'SICAKLIK:' : 'TEMP:'}</span>
                    <span className="text-cyan-200 font-semibold">{scienceState.sensorTempC} °C</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">{isTr ? 'RADYASYON:' : 'RADIATION:'}</span>
                    <span className="text-amber-200 font-semibold">
                      {scienceState.sensorRadUsv} µSv/h
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">{isTr ? 'EĞİM (3B):' : 'SLOPE (3D):'}</span>
                    <span
                      className={`font-semibold ${
                        scienceState.sensorSlopeDeg > 14 ? 'text-rose-400' : 'text-emerald-300'
                      }`}
                    >
                      {scienceState.sensorSlopeDeg}°
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">{isTr ? 'KIZILÖTESİ:' : 'IR ALBEDO:'}</span>
                    <span className="text-slate-200 font-semibold">
                      {scienceState.sensorIrReflectance} ε
                    </span>
                  </div>
                  <div className="pt-0.5 border-t border-slate-800/80">
                    <span className="text-slate-400 block text-[9px]">
                      {isTr ? 'KAMERA:' : 'OPTICS:'}
                    </span>
                    <span className="text-cyan-300 font-semibold block truncate">
                      {translateCameraSensor(scienceState.sensorCameraStatus, isTr)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quantitative Oxide Spectrometer + 400-900nm Wavelength Sparkline */}
              <div className="rounded-lg bg-[#0c1426] border border-slate-800 px-2.5 py-2 text-[10px] font-mono-tabular space-y-1.5">
                <div className="flex items-center justify-between text-amber-300 font-bold">
                  <span className="flex items-center gap-1">
                    <Activity className="w-3.5 h-3.5 text-cyan-400" />
                    {isTr ? 'SPEKTROMETRE (400–900 nm LIBS):' : 'SPECTROMETER (400–900 nm LIBS):'}
                  </span>
                  {scienceState.scanningProgress > 0 && (
                    <span className="text-rose-400">{scienceState.scanningProgress}%</span>
                  )}
                </div>
                <div className="text-emerald-300 leading-snug">
                  {scienceState.spectrometerSummary}
                </div>

                {/* Live 400-900nm Spectral Wavelength Curve */}
                <div className="bg-[#060b16] border border-slate-800/90 rounded p-1.5">
                  <svg
                    viewBox="0 0 276 42"
                    className="w-full h-10 overflow-visible"
                    aria-label="Spectral emission wavelength graph"
                  >
                    <line x1="0" y1="14" x2="276" y2="14" stroke="#1e293b" strokeDasharray="2 2" />
                    <line x1="0" y1="28" x2="276" y2="28" stroke="#1e293b" strokeDasharray="2 2" />
                    <polyline
                      fill="none"
                      stroke="#22d3ee"
                      strokeWidth="1.8"
                      points={spectralSparklinePath}
                    />
                  </svg>
                  <div className="flex justify-between text-[8px] text-slate-400 pt-0.5">
                    <span>400nm (UV)</span>
                    <span className="text-cyan-300">SiO₂ {activeOxides.sio2}%</span>
                    <span className="text-amber-300">Al₂O₃ {activeOxides.al2o3}%</span>
                    <span className="text-emerald-300">CaO {activeOxides.cao}%</span>
                    <span className="text-rose-300">Fe₂O₃ {activeOxides.fe2o3}%</span>
                    <span>900nm (NIR)</span>
                  </div>
                </div>
              </div>

              {/* 3D Cross-Section Scientific Mineral Identity Card */}
              {selectedMineralSample && (
                <div className="rounded-lg bg-[#091326] border border-cyan-500/45 p-2.5 space-y-2 text-[10px] font-mono-tabular">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                    <span className="text-cyan-300 font-bold flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-emerald-400" />
                      {isTr ? '3B MİNERAL KESİT KARTI' : '3D MINERAL CROSS-SECTION CARD'}
                    </span>
                    <span className="text-[9px] text-amber-300">
                      {selectedMineralSample.timestamp}
                    </span>
                  </div>

                  {scienceState.samples.length > 1 && (
                    <div className="flex flex-wrap gap-1">
                      {scienceState.samples.map((s, idx) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSelectedMineralSample(s)}
                          className={`px-1.5 py-0.5 rounded text-[9px] cursor-pointer ${
                            selectedMineralSample.id === s.id
                              ? 'bg-cyan-500 text-slate-950 font-bold'
                              : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          #{idx + 1} {s.label.split(' ')[0]}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-[84px_1fr] gap-2.5 items-center">
                    <div className="w-[82px] h-[82px] rounded-md bg-[#040812] border border-slate-800 flex flex-col items-center justify-center p-1">
                      <svg viewBox="0 0 80 80" className="w-16 h-16">
                        <polygon
                          points="40,6 72,22 66,58 40,74 14,58 8,22"
                          fill="#1e293b"
                          stroke="#38bdf8"
                          strokeWidth="1.4"
                        />
                        <polygon
                          points="40,16 62,28 57,52 40,64 23,52 18,28"
                          fill="#0f766e"
                          stroke="#34d399"
                          strokeWidth="1.2"
                        />
                        <polygon
                          points="40,27 52,34 49,47 40,53 31,47 28,34"
                          fill="#b45309"
                          stroke="#fbbf24"
                          strokeWidth="1.2"
                        />
                        <line x1="40" y1="6" x2="40" y2="40" stroke="#f43f5e" strokeDasharray="2 2" />
                        <circle cx="40" cy="40" r="3" fill="#f43f5e" />
                      </svg>
                      <span className="text-[8px] text-cyan-300">
                        {isTr ? '3B Katman Kesiti' : '3D Core Section'}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="text-slate-100 font-bold truncate">
                        {selectedMineralSample.label}
                      </div>
                      <div className="text-cyan-300 text-[9px] leading-tight">
                        {selectedMineralSample.mineralComposition}
                      </div>
                      <div className="space-y-0.5 pt-0.5">
                        {[
                          {
                            label: isTr ? 'SiO₂ (Silikat)' : 'SiO₂ (Silica)',
                            pct: activeOxides.sio2,
                            color: 'bg-cyan-400',
                          },
                          {
                            label: isTr ? 'Fe₂O₃ (Hematit)' : 'Fe₂O₃ (Ferric)',
                            pct: activeOxides.fe2o3,
                            color: 'bg-rose-400',
                          },
                          {
                            label: isTr ? 'Al₂O₃ (Alümina)' : 'Al₂O₃ (Alumina)',
                            pct: activeOxides.al2o3,
                            color: 'bg-amber-400',
                          },
                          {
                            label: isTr ? 'CaO (Kalsit)' : 'CaO (Calcite)',
                            pct: activeOxides.cao,
                            color: 'bg-emerald-400',
                          },
                        ].map((ox) => (
                          <div key={ox.label} className="space-y-0.5">
                            <div className="flex justify-between text-[8px]">
                              <span className="text-slate-400">{ox.label}</span>
                              <span className="text-slate-200 font-bold">%{ox.pct}</span>
                            </div>
                            <div className="h-1 bg-slate-900 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${ox.color}`}
                                style={{ width: `${Math.min(100, ox.pct)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* System Log (stat-log) */}
              <div className="text-[11px] font-mono-tabular text-slate-300 bg-slate-950/70 border border-slate-800/80 rounded px-2.5 py-1.5 truncate">
                {scienceState.systemLog}
              </div>

              {/* Autonomous Mission & Instrument Action Buttons */}
              <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={onStartAutonomousMission}
                  className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    scienceState.autonomousMissionActive
                      ? 'bg-emerald-400 text-slate-950'
                      : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                  }`}
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>
                    {scienceState.autonomousMissionActive
                      ? isTr
                        ? 'Görev Aktif'
                        : 'Mission Active'
                      : isTr
                      ? 'Görev Başlat'
                      : 'Start Mission'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={onTriggerChemCam}
                  className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-rose-500 hover:bg-rose-400 text-slate-950 text-xs font-bold transition-colors cursor-pointer"
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  <span>{isTr ? 'Lazer Analiz [F]' : 'Laser Scan [F]'}</span>
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onToggleHeadlights}
                  className={`flex-1 py-1.5 px-2.5 rounded-lg border text-[11px] font-mono-tabular font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    headlightsOn
                      ? 'bg-amber-400/20 border-amber-400 text-amber-200'
                      : 'bg-slate-900 border-slate-700 text-slate-400'
                  }`}
                >
                  <Flashlight className="w-3.5 h-3.5" />
                  <span>
                    {isTr ? 'Ön Farlar' : 'Headlights'}:{' '}
                    {headlightsOn ? (isTr ? 'AÇIK [L]' : 'ON [L]') : isTr ? 'KAPALI [L]' : 'OFF [L]'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={onResetRoverState}
                  className="py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono-tabular text-slate-300 cursor-pointer"
                >
                  {isTr ? 'Sıfırla' : 'Reset'}
                </button>
              </div>
            </>
          )}
        </aside>
      )}

      {/* Mission Science Success Report Modal (4/4 Primary Samples Collected) */}
      {surfacePhase === 'rover_active' &&
        scienceState.missionComplete &&
        !freeExploreDismissed && (
          <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/65 p-4">
            <div className="w-full max-w-lg bg-[#080e1d] border border-emerald-500/60 rounded-2xl p-5 shadow-2xl space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400 flex items-center justify-center text-emerald-300">
                    <Award className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-mono-tabular font-bold text-emerald-400">
                      {isTr
                        ? 'OTONOM YÜZEY GÖREVİ TAMAMLANDI'
                        : 'AUTONOMOUS SURFACE MISSION COMPLETE'}
                    </div>
                    <h3 className="font-display text-lg font-bold text-white">
                      {world.name} · NASA Curiosity (MSL){' '}
                      {isTr ? 'Analiz Raporu' : 'Science Report'}
                    </h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFreeExploreDismissed(true)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                {isTr
                  ? `${world.name} yüzeyindeki ${scienceState.totalTargets} ana jeolojik hedef NASA Curiosity (MSL) Rover tarafından lazer spektrometre ile analiz edilerek kayıt altına alındı.`
                  : `All ${scienceState.totalTargets} primary geological targets on ${world.name} have been analyzed and logged by NASA Curiosity (MSL) ChemCam/APXS spectroscopy.`}
              </p>

              <div className="max-h-52 overflow-y-auto mission-scroll space-y-2 pr-1">
                {scienceState.samples.map((s) => (
                  <div
                    key={s.id}
                    className="p-2.5 rounded-lg bg-[#0c1528] border border-slate-800 flex items-start gap-2.5"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <div className="font-semibold text-slate-100">{s.label}</div>
                      <div className="text-[11px] text-cyan-300 mt-0.5">
                        {s.mineralComposition}
                      </div>
                      <div className="text-[10px] font-mono-tabular text-amber-300 mt-0.5">
                        {isTr ? 'SPEKTROMETRE' : 'SPECTROMETER'}: {s.oxideBreakdown}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={onReturnToOrbit}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-cyan-200 cursor-pointer"
                >
                  {isTr ? 'Yörüngeye Dön (5. Aşama)' : 'Return to Orbit (Stage 5)'}
                </button>
                <button
                  type="button"
                  onClick={() => setFreeExploreDismissed(true)}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-xs font-bold text-slate-950 cursor-pointer"
                >
                  {isTr ? 'Serbest Keşfe Devam Et' : 'Continue Free Exploration'}
                </button>
              </div>
            </div>
          </div>
        )}

      {/* Bottom HUD: Collapsible Planet/Descent Telemetry + Mach/q/G + Live Descent Sparkline + Rover Controls */}
      <div className="pointer-events-auto absolute bottom-4 left-4 right-4 z-20 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-lg w-full sm:w-auto bg-[#080d19]/94 border border-slate-800 rounded-xl p-4 space-y-2 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-mono-tabular text-cyan-400">
              {world.category} ·{' '}
              {world.id === 'jupiter'
                ? `EUROPA ${world.surfaceGravity} m/s²`
                : `${world.surfaceGravity} m/s² ${isTr ? 'YERÇEKİMİ' : 'GRAVITY'}`}{' '}
              · {world.radiationHazard} {isTr ? 'RADYASYON' : 'RADIATION'}
            </div>
            <button
              type="button"
              onClick={() => setLanderCardCollapsed((prev) => !prev)}
              aria-label={landerCardCollapsed ? 'Expand mission card' : 'Collapse mission card'}
              className="p-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 cursor-pointer"
            >
              {landerCardCollapsed ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-white">{world.name}</h2>
            {surfacePhase === 'descending' && (
              <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/60 text-[10px] font-mono-tabular font-bold text-amber-200">
                {surfaceTelemetry.maneuverLabel}
              </span>
            )}
          </div>

          {!landerCardCollapsed && (
            <>
              {surfacePhase === 'descending' && (
                <div className="space-y-2 pt-1">
                  {/* 7-Metric Engineering Descent Telemetry Grid (Altitude, Sink Rate, Pitch, Fuel, Mach, Dynamic Pressure q, G-Load) */}
                  <div className="grid grid-cols-4 gap-2 text-[11px] font-mono-tabular bg-[#0c1426] border border-slate-800 rounded-md px-2.5 py-1.5">
                    <div>
                      <span className="text-slate-400 block text-[9px]">
                        {isTr ? 'İRTİFA' : 'ALTITUDE'}
                      </span>
                      <span className="text-cyan-300 font-bold">{surfaceTelemetry.altitudeM} m</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[9px]">
                        {isTr ? 'DİKEY HIZ' : 'SINK RATE'}
                      </span>
                      <span className="text-amber-300 font-bold">
                        -{surfaceTelemetry.verticalSpeedMs.toFixed(1)} m/s
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[9px]">
                        {isTr ? 'YUNUSLAMA (PITCH)' : 'PITCH ANGLE'}
                      </span>
                      <span className="text-emerald-300 font-bold">{surfaceTelemetry.pitchDeg}°</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[9px]">
                        {isTr ? 'HEADER YAKIT' : 'HEADER FUEL'}
                      </span>
                      <span className="text-rose-300 font-bold">{surfaceTelemetry.fuelPct}%</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[9px]">
                        {isTr ? 'MACH SAYISI' : 'MACH NUMBER'}
                      </span>
                      <span className="text-slate-100 font-bold">
                        {world.hasAtmosphere ? `M ${surfaceTelemetry.mach.toFixed(2)}` : 'VACUUM'}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-400 block text-[9px]">
                        {isTr ? 'DİNAMİK BASINÇ (q)' : 'DYNAMIC PRESSURE (q)'}
                      </span>
                      <span className="text-cyan-200 font-bold">
                        {world.hasAtmosphere
                          ? `${surfaceTelemetry.dynamicPressureKpa.toFixed(2)} kPa`
                          : '0.00 kPa (Vacuum)'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[9px]">
                        {isTr ? 'G-KUVVETİ' : 'G-LOAD'}
                      </span>
                      <span className="text-amber-200 font-bold">
                        {surfaceTelemetry.gLoad.toFixed(2)} G
                      </span>
                    </div>
                  </div>

                  {/* Live Altitude-Velocity Descent Sparkline Curve */}
                  <div className="bg-[#060b16] border border-slate-800/90 rounded-md px-2.5 py-1.5">
                    <div className="flex items-center justify-between text-[9px] font-mono-tabular mb-1">
                      <span className="text-cyan-300 font-semibold">
                        {isTr
                          ? 'CANLI İNİŞ PROFİLİ (İRTİFA vs. DÜŞÜŞ HIZI)'
                          : 'LIVE DESCENT PROFILE (ALTITUDE vs. SINK RATE)'}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-cyan-300">
                          — {isTr ? 'İrtifa (m)' : 'Altitude (m)'}
                        </span>
                        <span className="text-amber-300">
                          — {isTr ? 'Hız (m/s)' : 'Speed (m/s)'}
                        </span>
                      </div>
                    </div>
                    <svg
                      viewBox="0 0 260 44"
                      className="w-full h-11 overflow-visible"
                      aria-label="Live altitude and sink rate descent telemetry graph"
                    >
                      <line x1="0" y1="14" x2="260" y2="14" stroke="#1e293b" strokeDasharray="2 2" />
                      <line x1="0" y1="29" x2="260" y2="29" stroke="#1e293b" strokeDasharray="2 2" />
                      <polyline
                        fill="none"
                        stroke="#22d3ee"
                        strokeWidth="1.8"
                        points={descentSparklinePaths.altPoints}
                      />
                      <polyline
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="1.5"
                        points={descentSparklinePaths.velPoints}
                      />
                    </svg>
                  </div>

                  {/* Autopilot vs. Optional Manual Raptor Throttle Control */}
                  <div className="p-2.5 rounded-lg bg-[#0b1222] border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono-tabular text-slate-300 flex items-center gap-1.5">
                        <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                        {isTr ? 'UÇUŞ BİLGİSAYARI:' : 'FLIGHT COMPUTER:'}{' '}
                        {isManualThrottle
                          ? isTr
                            ? 'MANUEL GAZ KONTROLÜ'
                            : 'MANUAL THROTTLE'
                          : isTr
                          ? 'OTOPİLOT (VARSAYILAN)'
                          : 'AUTOPILOT (DEFAULT)'}
                      </span>
                      <button
                        type="button"
                        onClick={() => onSetManualThrottle(isManualThrottle ? null : 78)}
                        className={`px-2.5 py-1 rounded text-[10px] font-mono-tabular font-bold border transition-colors cursor-pointer ${
                          isManualThrottle
                            ? 'bg-amber-500 border-amber-400 text-slate-950'
                            : 'bg-slate-900 border-slate-700 text-cyan-200 hover:border-cyan-400'
                        }`}
                      >
                        {isManualThrottle
                          ? isTr
                            ? 'Otopilota Geç [M]'
                            : 'Switch to Autopilot [M]'
                          : isTr
                          ? 'Manuel İtki [M]'
                          : 'Manual Thrust [M]'}
                      </button>
                    </div>

                    {isManualThrottle && (
                      <div className="flex items-center gap-3">
                        <Flame className="w-4 h-4 text-amber-400 shrink-0" />
                        <input
                          type="range"
                          min={0}
                          max={140}
                          step={2}
                          value={surfaceTelemetry.manualThrottlePct ?? 78}
                          onChange={(e) => onSetManualThrottle(Number(e.target.value))}
                          className="flex-1 accent-amber-400 cursor-pointer"
                        />
                        <span className="w-12 text-right text-xs font-mono-tabular font-bold text-amber-300">
                          {surfaceTelemetry.manualThrottlePct}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <p className="text-xs text-slate-300 leading-relaxed">
                {surfacePhase === 'descending' &&
                  (world.hasAtmosphere
                    ? isTr
                      ? 'SpaceX Starship atmosferik dünyada yatay Belly-Flop aerodinamik dalışı ve 68 m irtifada Raptor Flip-and-Burn dikey ateşlemesi uyguluyor.'
                      : 'SpaceX Starship executing horizontal Belly-Flop skydiver descent with actuating aero-flaps, followed by Raptor Flip-and-Burn ignition at 68 m.'
                    : isTr
                    ? 'Havasız (vakum) dünyada aerodinamik sürükleme olmadığı için SpaceX Starship doğrudan dikey HLS İtkili İniş (Powered Retro-Descent) profili uyguluyor.'
                    : 'Airless vacuum environment (q = 0 kPa): SpaceX Starship executing continuous HLS Powered Retro-Propulsive Descent with flaps locked neutral.')}
                {surfacePhase === 'landed' &&
                  (isTr
                    ? 'Yüzeye konma onaylandı! Raptor motorlarının altında termal yanık izi oluştu, sönümlemeli iniş ayakları darbeyi emiyor.'
                    : 'Touchdown confirmed! Thermal scorch plume imprinted beneath Raptor nozzles; landing legs absorbing impulse.')}
                {surfacePhase === 'ramp_deploy' &&
                  (isTr
                    ? 'Starship yük bölmesinden gezegen yüzeyine konuşlandırma rampası indiriliyor.'
                    : 'Lowering deployment ramp from the Starship payload bay onto the planetary surface.')}
                {surfacePhase === 'rover_exit' &&
                  (isTr
                    ? 'NASA Curiosity (MSL) Rover, 6 tekerlekli Rocker-Bogie süspansiyonu ve arka MMRTG nükleer güç kaynağı ile rampadan yüzeye iniyor.'
                    : 'NASA Curiosity (MSL) rover rolling down the deployment ramp with 6-wheel Rocker-Bogie suspension and rear MMRTG nuclear source.')}
                {surfacePhase === 'rover_active' &&
                  (isTr
                    ? `${world.name} yüzey keşfi aktif. [ASİ TELEMETRİ] panelinden "Görev Başlat" ile 4 hedefi otonom toplayın, zemine tıklayın veya WASD ile sürün (${stats.totalMassKg.toLocaleString()} kg).`
                    : `${world.finalSummary} Click "Start Mission" in [ASI TELEMETRY] for full autonomous multi-target sample collection, click any terrain/rock point, or drive with WASD (${stats.totalMassKg.toLocaleString()} kg).`)}
              </p>
            </>
          )}
        </div>

        {/* Interactive Rover D-Pad & Auto-Roam when Rover is Active */}
        {surfacePhase === 'rover_active' && (
          <div className="bg-[#080d19]/95 border border-emerald-500/45 rounded-xl px-4 py-3 flex items-center gap-4 shadow-xl">
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                aria-label="Drive Forward"
                onPointerDown={() => onDriveControl(1, 0)}
                onPointerUp={() => onDriveControl(0, 0)}
                onPointerLeave={() => onDriveControl(0, 0)}
                className="w-9 h-8 rounded-md bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 border border-slate-700 flex items-center justify-center text-slate-100 cursor-pointer"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Turn Left"
                  onPointerDown={() => onDriveControl(0.4, 1)}
                  onPointerUp={() => onDriveControl(0, 0)}
                  onPointerLeave={() => onDriveControl(0, 0)}
                  className="w-9 h-8 rounded-md bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 border border-slate-700 flex items-center justify-center text-slate-100 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label="Reverse"
                  onPointerDown={() => onDriveControl(-1, 0)}
                  onPointerUp={() => onDriveControl(0, 0)}
                  onPointerLeave={() => onDriveControl(0, 0)}
                  className="w-9 h-8 rounded-md bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 border border-slate-700 flex items-center justify-center text-slate-100 cursor-pointer"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label="Turn Right"
                  onPointerDown={() => onDriveControl(0.4, -1)}
                  onPointerUp={() => onDriveControl(0, 0)}
                  onPointerLeave={() => onDriveControl(0, 0)}
                  className="w-9 h-8 rounded-md bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 border border-slate-700 flex items-center justify-center text-slate-100 cursor-pointer"
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[10px] font-mono-tabular text-slate-400">
                {isTr ? 'YÜZEYE TIKLA VEYA WASD' : 'CLICK TERRAIN OR WASD'}
              </div>
              <button
                type="button"
                onClick={onToggleAutoRoam}
                className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  autoRoam
                    ? 'bg-emerald-500 border-emerald-400 text-slate-950'
                    : 'bg-slate-800 border-slate-700 text-cyan-200 hover:border-cyan-400'
                }`}
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>
                  {autoRoam
                    ? isTr
                      ? 'Serbest Sürüş: AÇIK'
                      : 'Free Roam: ON'
                    : isTr
                    ? 'Serbest Sürüş'
                    : 'Free Roam'}
                </span>
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onReturnToOrbit}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-xs font-bold text-slate-950 cursor-pointer"
          >
            <Orbit className="w-3.5 h-3.5" />
            <span>{isTr ? 'Yörüngeye Dön (5. Aşama)' : 'Back to Orbit (Stage 5)'}</span>
          </button>
        </div>
      </div>
    </>
  );
}
