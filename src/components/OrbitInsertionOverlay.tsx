import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Crosshair,
  FastForward,
  Flame,
  Globe,
  MapPin,
  Navigation,
  Thermometer,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  computeRequiredInsertionDeltaV,
  CRAFT_CLASSES,
  CraftClassId,
  CraftStats,
  evaluateOrbitInsertion,
  LANDING_SITES,
  ManeuverType,
  WORLDS,
  WorldId,
} from '../data/missionData';
import { OrbitTelemetry, OrbitTimeWarp } from '../three/MissionWorldEngine';
import { AppLang } from './TopBar';

interface OrbitInsertionOverlayProps {
  lang: AppLang;
  targetWorldId: WorldId;
  craftClass: CraftClassId;
  stats: CraftStats;
  telemetry: OrbitTelemetry;
  orbitHoloGridVisible: boolean;
  onToggleOrbitHoloGrid: () => void;
  onSelectCraftClass: (id: CraftClassId) => void;
  onSelectSiteAngle: (deg: number) => void;
  onSetTimeWarp: (warp: OrbitTimeWarp) => void;
  onArmDeorbit: () => void;
  onCancelArm: () => void;
}

const TIME_WARP_OPTIONS: OrbitTimeWarp[] = [1, 2, 4];

export function OrbitInsertionOverlay({
  lang,
  targetWorldId,
  craftClass,
  stats,
  telemetry,
  orbitHoloGridVisible,
  onToggleOrbitHoloGrid,
  onSelectCraftClass,
  onSelectSiteAngle,
  onSetTimeWarp,
  onArmDeorbit,
  onCancelArm,
}: OrbitInsertionOverlayProps) {
  const world = WORLDS[targetWorldId];
  const sites = LANDING_SITES[targetWorldId];
  const isTr = lang === 'tr';
  const [selectedManeuver, setSelectedManeuver] = useState<ManeuverType>(world.recommendedManeuver);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  useEffect(() => {
    setSelectedManeuver(WORLDS[targetWorldId].recommendedManeuver);
  }, [targetWorldId]);

  const maneuverOptions: { id: ManeuverType; label: string; hint: string }[] = [
    { id: 'retro_burn', label: isTr ? 'Retro-Ateşleme' : 'Retro-Burn', hint: '100% Δv' },
    {
      id: 'aerobraking',
      label: isTr ? 'Aerofrenleme' : 'Aerobraking',
      hint: isTr ? '42% Δv (Atmo)' : '42% Δv (Atmo)',
    },
    {
      id: 'gravity_assist',
      label: isTr ? 'Kütleçekim Sapanı' : 'Gravity Assist',
      hint: '65% Δv',
    },
  ];

  const craftBusLabels: Record<CraftClassId, string> = {
    light: isTr ? 'Hafif' : 'Light',
    standard: isTr ? 'Standart' : 'Standard',
    heavy: isTr ? 'Ağır' : 'Heavy',
  };

  const maneuverEvaluation = useMemo(() => {
    return evaluateOrbitInsertion({
      world,
      stats,
      maneuver: selectedManeuver,
      approachAngleDeg: world.idealAngleDeg,
      burnTimingAccuracy: 0.92,
    });
  }, [world, stats, selectedManeuver]);

  const requiredCaptureDv = useMemo(
    () =>
      computeRequiredInsertionDeltaV({
        world,
        maneuver: selectedManeuver,
        burnTimingAccuracy: 0.92,
      }),
    [world, selectedManeuver]
  );

  const statusLabel =
    telemetry.phase === 'descending'
      ? isTr
        ? 'DE-ORBIT ATEŞLEMESİ AKTİF'
        : 'DE-ORBIT BURN ACTIVE'
      : telemetry.phase === 'armed'
      ? isTr
        ? 'HEDEF ÜSTÜ GEÇİŞ BEKLENİYOR'
        : 'WAITING FOR OVERHEAD PASS'
      : isTr
      ? 'YÖRÜNGEDE DÖNÜYOR'
      : 'ORBITING PLANET';

  const statusClasses =
    telemetry.phase === 'descending'
      ? 'bg-amber-500/20 border-amber-400 text-amber-200'
      : telemetry.phase === 'armed'
      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
      : 'bg-cyan-500/15 border-cyan-500/50 text-cyan-200';

  return (
    <>
      <div className="pointer-events-auto absolute top-4 left-4 z-20 flex flex-wrap items-center gap-2">
        <div className="bg-[#080d1a]/92 border border-slate-800 rounded-lg px-3.5 py-2 text-xs">
          <span className="font-display font-semibold text-cyan-300">
            {isTr
              ? 'Yörünge Taraması & De-Orbit İniş Hedefleme'
              : 'Orbital Survey & De-Orbit Targeting'}
          </span>
          <span className="mx-2 text-slate-600">·</span>
          <span className="text-slate-300">
            {world.name} · v_orb {telemetry.orbitalVelocityKms} km/s ·{' '}
            {isTr ? 'Araç Δv' : 'Craft Δv'} {stats.deltaV.toLocaleString()} m/s
          </span>
        </div>

        {/* Orbital Time Warp Controls (1x / 2x / 4x) */}
        <div className="bg-[#080d1a]/94 border border-slate-800 rounded-lg p-1 flex items-center gap-1">
          <span className="px-2 text-[10px] font-mono-tabular text-slate-400 flex items-center gap-1">
            <FastForward className="w-3 h-3 text-cyan-400" />
            {isTr ? 'ZAMAN HIZI' : 'TIME WARP'}
          </span>
          {TIME_WARP_OPTIONS.map((w) => {
            const active = telemetry.timeWarp === w;
            return (
              <button
                key={w}
                type="button"
                onClick={() => onSetTimeWarp(w)}
                className={`px-2.5 py-1 rounded text-[11px] font-mono-tabular font-bold transition-colors cursor-pointer ${
                  active
                    ? 'bg-cyan-500 text-slate-950'
                    : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {w}x
              </button>
            );
          })}
        </div>

        {/* 3D Holographic Coordinate Grid Toggle */}
        <button
          type="button"
          onClick={onToggleOrbitHoloGrid}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono-tabular font-semibold transition-colors cursor-pointer ${
            orbitHoloGridVisible
              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
              : 'bg-[#080d1a]/94 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          <Globe className="w-3.5 h-3.5 text-cyan-400" />
          <span>
            {isTr ? '3B Holo Ağ' : '3D Holo Grid'}:{' '}
            {orbitHoloGridVisible ? (isTr ? 'AÇIK' : 'ON') : isTr ? 'KAPALI' : 'OFF'}
          </span>
        </button>
      </div>

      <aside
        className={`pointer-events-auto absolute top-3 right-3 ${
          panelCollapsed ? '' : 'bottom-3'
        } w-[378px] max-w-[92vw] z-20 flex flex-col bg-[#080d19]/94 border border-slate-800/90 rounded-xl overflow-hidden shadow-2xl`}
      >
        <div className="px-4 py-3 border-b border-slate-800/80">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-mono-tabular text-cyan-400">
              {isTr ? 'YÖRÜNGE BULUŞMASI (STARSHIP)' : 'ORBITAL RENDEZVOUS (STARSHIP)'}
            </span>
            <div className="flex items-center gap-1.5">
              <span
                className={`px-2 py-0.5 rounded border text-[10px] font-mono-tabular font-bold ${statusClasses}`}
              >
                {statusLabel}
              </span>
              <button
                type="button"
                onClick={() => setPanelCollapsed((prev) => !prev)}
                aria-label={panelCollapsed ? 'Expand orbital panel' : 'Collapse orbital panel'}
                className="p-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 cursor-pointer"
              >
                {panelCollapsed ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronUp className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
          <h2 className="font-display text-base font-bold text-slate-100 mt-1">
            {isTr ? `${world.name} İniş Bölgesi Seçimi` : `Select ${world.name} Landing Zone`}
          </h2>
          {!panelCollapsed && (
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              {isTr
                ? `${telemetry.altitudeKm} km irtifada yörüngede (${telemetry.orbitalPeriodMin} dk periyot). Yakalama manevrasını seçin, gezegen üzerinde iniş alanını işaretleyin ve alçalmayı başlatın.`
                : `Orbiting at ${telemetry.altitudeKm} km (${telemetry.orbitalPeriodMin} min period). Choose a capture maneuver, pin a site on the planet, and arm de-orbit descent.`}
            </p>
          )}
        </div>

        {!panelCollapsed && (
          <div className="flex-1 overflow-y-auto mission-scroll p-3.5 space-y-3.5">
            {/* Live Keplerian Orbital & Alignment Telemetry */}
            <div className="p-3 rounded-lg bg-[#0b1222] border border-slate-800 space-y-2">
              <div className="grid grid-cols-2 gap-2 pb-2 border-b border-slate-800/80 text-[11px] font-mono-tabular">
                <div>
                  <div className="text-slate-400 text-[10px]">
                    {isTr ? 'YÖRÜNGE İRTİFASI' : 'ORBIT ALTITUDE'}
                  </div>
                  <div className="text-cyan-300 font-bold">{telemetry.altitudeKm} km</div>
                </div>
                <div>
                  <div className="text-slate-400 text-[10px]">
                    {isTr ? 'YÖRÜNGE HIZI (v_orb)' : 'ORBITAL SPEED (v_orb)'}
                  </div>
                  <div className="text-slate-100 font-bold">{telemetry.orbitalVelocityKms} km/s</div>
                </div>
                <div>
                  <div className="text-slate-400 text-[10px]">
                    {isTr ? 'YÖRÜNGE PERİYODU' : 'ORBITAL PERIOD'}
                  </div>
                  <div className="text-slate-200">
                    {telemetry.orbitalPeriodMin} {isTr ? 'dk' : 'min'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 text-[10px]">
                    {isTr ? 'DE-ORBIT Δv' : 'DE-ORBIT BURN'}
                  </div>
                  <div className="text-amber-300 font-bold">{telemetry.deorbitBurnMs} m/s</div>
                </div>
                <div>
                  <div className="text-slate-400 text-[10px] flex items-center gap-1">
                    <Thermometer className="w-3 h-3 text-orange-400" />
                    {isTr ? 'TPS ISI KALKANI' : 'TPS HEATSHIELD'}
                  </div>
                  <div
                    className={`font-bold ${
                      telemetry.tpsTempC > 600 ? 'text-rose-400' : 'text-emerald-300'
                    }`}
                  >
                    {telemetry.tpsTempC} °C
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 text-[10px]">
                    {isTr ? 'GİRİŞ G-YÜKÜ' : 'ENTRY DECEL LOAD'}
                  </div>
                  <div className="text-amber-200 font-bold">{telemetry.accelG.toFixed(2)} G</div>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs font-mono-tabular">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Navigation className="w-3.5 h-3.5 text-cyan-400" />
                  {isTr ? 'Starship Yörünge Açısı' : 'Spacecraft Orbit Angle'}
                </span>
                <span className="text-cyan-300 font-bold">{telemetry.craftAngleDeg}°</span>
              </div>

              <div className="flex items-center justify-between text-xs font-mono-tabular">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
                  {isTr ? 'Seçili İniş Bölgesi Açısı' : 'Selected Site Angle'}
                </span>
                <span className="text-emerald-300 font-bold">{telemetry.siteAngleDeg}°</span>
              </div>

              <div className="pt-1">
                <div className="flex justify-between text-[11px] font-mono-tabular mb-1">
                  <span className="text-slate-300">
                    {isTr ? 'Hedef Hizalanma Oranı' : 'Overhead Alignment'}
                  </span>
                  <span className="text-emerald-300 font-bold">{telemetry.alignmentPct}%</span>
                </div>
                <div className="h-2 bg-slate-900 border border-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-100 ${
                      telemetry.phase === 'descending'
                        ? 'bg-amber-400'
                        : telemetry.alignmentPct > 85
                        ? 'bg-emerald-400'
                        : 'bg-cyan-400'
                    }`}
                    style={{ width: `${telemetry.alignmentPct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Spacecraft Bus Preset (Tsiolkovsky Δv) */}
            <div className="p-3 rounded-lg bg-[#0b1222] border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono-tabular text-slate-300">
                <span>{isTr ? 'STARSHIP SINIFI (TSIOLKOVSKY Δv)' : 'SPACECRAFT BUS PRESET'}</span>
                <span className="text-emerald-300">
                  {isTr ? 'Mevcut' : 'Avail'}: {stats.deltaV.toLocaleString()} m/s Δv
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {CRAFT_CLASSES.map((bus) => {
                  const active = craftClass === bus.id;
                  return (
                    <button
                      key={bus.id}
                      type="button"
                      disabled={telemetry.phase === 'descending'}
                      onClick={() => onSelectCraftClass(bus.id)}
                      className={`px-2 py-1.5 rounded-md border text-center transition-colors cursor-pointer disabled:opacity-60 ${
                        active
                          ? 'bg-[#0e1b33] border-cyan-400 text-cyan-200'
                          : 'bg-[#080d19] border-slate-800 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <div className="text-[11px] font-semibold">{craftBusLabels[bus.id]}</div>
                      <div className="text-[9px] font-mono-tabular opacity-80">
                        Isp {bus.ispSec}s
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Capture Maneuver Validation (Oberth / Aerobraking / Gravity Assist) */}
            <div className="p-3 rounded-lg bg-[#0b1222] border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono-tabular text-slate-300">
                <span>{isTr ? 'YÖRÜNGE YAKALAMA MANEVRASI' : 'CAPTURE MANEUVER'}</span>
                <span className="text-cyan-300">
                  {isTr ? 'Gerekli' : 'Req'}: {requiredCaptureDv.toLocaleString()} m/s Δv
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {maneuverOptions.map((opt) => {
                  const active = selectedManeuver === opt.id;
                  const invalidAirless = opt.id === 'aerobraking' && !world.hasAtmosphere;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={telemetry.phase === 'descending'}
                      onClick={() => setSelectedManeuver(opt.id)}
                      className={`px-2 py-1.5 rounded-md border text-center transition-colors cursor-pointer disabled:opacity-60 ${
                        active
                          ? invalidAirless
                            ? 'bg-rose-950/70 border-rose-400 text-rose-200'
                            : 'bg-[#0e1b33] border-cyan-400 text-cyan-200'
                          : 'bg-[#080d19] border-slate-800 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <div className="text-[11px] font-semibold">{opt.label}</div>
                      <div className="text-[9px] font-mono-tabular opacity-80">{opt.hint}</div>
                    </button>
                  );
                })}
              </div>
              <div
                className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-[11px] leading-snug ${
                  maneuverEvaluation.success
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                    : 'bg-rose-950/50 border-rose-500/50 text-rose-200'
                }`}
              >
                {maneuverEvaluation.success ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-400" />
                )}
                <div>
                  <div className="font-semibold">{maneuverEvaluation.title}</div>
                  <div className="opacity-90 mt-0.5">{maneuverEvaluation.explanation}</div>
                </div>
              </div>
            </div>

            {/* NASA Candidate Landing Sites */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-mono-tabular text-slate-300 mb-2">
                <span>
                  {isTr ? 'NASA ADAY İNİŞ BÖLGELERİ' : 'NASA CANDIDATE LANDING SITES'}
                </span>
                <span className="text-cyan-400">
                  {isTr ? 'veya 3B küreye tıklayın' : 'or click 3D globe'}
                </span>
              </div>

              <div className="space-y-2">
                {sites.map((site) => {
                  const angleDiff = Math.abs(
                    ((telemetry.siteAngleDeg - site.angleDeg + 540) % 360) - 180
                  );
                  const selected = angleDiff <= 6;
                  const riskColor =
                    site.risk === 'HIGH'
                      ? 'text-rose-300 bg-rose-950/60 border-rose-500/40'
                      : site.risk === 'MODERATE'
                      ? 'text-amber-300 bg-amber-950/60 border-amber-500/40'
                      : 'text-emerald-300 bg-emerald-950/60 border-emerald-500/40';

                  return (
                    <button
                      key={site.id}
                      type="button"
                      disabled={telemetry.phase === 'descending'}
                      onClick={() => onSelectSiteAngle(site.angleDeg)}
                      className={`w-full text-left rounded-lg border p-2.5 transition-colors cursor-pointer disabled:opacity-60 ${
                        selected
                          ? 'bg-[#0e1b33] border-emerald-400'
                          : 'bg-[#0b1120] border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display font-semibold text-xs text-slate-100 flex items-center gap-1.5">
                          <MapPin
                            className={`w-3.5 h-3.5 shrink-0 ${
                              selected ? 'text-emerald-400' : 'text-slate-400'
                            }`}
                          />
                          {site.name}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[9px] font-mono-tabular font-bold ${riskColor}`}
                        >
                          {site.risk}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[10px] font-mono-tabular text-cyan-300/90 mt-1">
                        <span>{site.terrainType}</span>
                        <span>{site.angleDeg}°</span>
                      </div>

                      <div className="text-[11px] text-slate-400 mt-1 leading-snug">
                        {site.description}
                      </div>

                      <div className="text-[10px] font-mono-tabular text-amber-300/90 mt-1">
                        {isTr ? 'Bilimsel Değer' : 'Science'}: {site.scienceValue}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Action Button */}
        <div className="p-3.5 border-t border-slate-800/80">
          {telemetry.phase === 'orbiting' && (
            <button
              type="button"
              disabled={!maneuverEvaluation.success}
              onClick={onArmDeorbit}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-xs font-bold text-slate-950 transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <Flame className="w-4 h-4" />
              <span>
                {maneuverEvaluation.success
                  ? isTr
                    ? 'De-Orbit İnişini Hazırla (Hedef Üstünde Ateşle) [SPACE]'
                    : 'Arm De-Orbit Descent (Land When Overhead) [SPACE]'
                  : isTr
                  ? 'Yukarıdan Geçerli Bir Yakalama Manevrası Seçin'
                  : 'Select Valid Capture Maneuver Above'}
              </span>
            </button>
          )}

          {telemetry.phase === 'armed' && (
            <button
              type="button"
              onClick={onCancelArm}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-xs font-bold text-slate-950 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
              <span>
                {isTr
                  ? 'Hedef Üstü Geçiş Bekleniyor... (İptal İçin Tıklayın)'
                  : 'Tracking Overhead Pass... (Click to Cancel)'}
              </span>
            </button>
          )}

          {telemetry.phase === 'descending' && (
            <div className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-950/70 border border-amber-500/60 text-xs font-bold text-amber-200">
              <Flame className="w-4 h-4 text-amber-400" />
              <span>
                {isTr
                  ? 'Raptor Retro-İticiler Ateşlendi · Yüzeye Alçalıyor...'
                  : 'Retro-Thrusters Firing · Descending to Surface...'}
              </span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
