import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FinalVisualOverlay } from './components/FinalVisualOverlay';
import { GuideModal } from './components/GuideModal';
import { OrbitInsertionOverlay } from './components/OrbitInsertionOverlay';
import { AppLang, TopBar } from './components/TopBar';
import {
  computeCraftStats,
  CraftClassId,
  DEFAULT_HANGAR_CONFIG,
  HangarConfig,
  LANDING_SITES,
  SceneStage,
  SurfacePhase,
  WORLDS,
  WorldId,
} from './data/missionData';
import {
  MissionWorldEngine,
  OrbitTelemetry,
  OrbitTimeWarp,
  RoverNavTelemetry,
  ScienceMissionState,
  SurfaceCameraMode,
  SurfaceTelemetry,
} from './three/MissionWorldEngine';
import { missionAudio } from './utils/audio';

const INITIAL_ORBIT_TELEMETRY: OrbitTelemetry = {
  craftAngleDeg: 0,
  siteAngleDeg: 35,
  alignmentPct: 0,
  altitudeKm: WORLDS.moon.orbitAltitudeKm,
  orbitalVelocityKms: WORLDS.moon.orbitMetrics.orbitalVelocityKms,
  orbitalPeriodMin: WORLDS.moon.orbitMetrics.orbitalPeriodMin,
  deorbitBurnMs: WORLDS.moon.orbitMetrics.deorbitBurnMs,
  phase: 'orbiting',
  timeWarp: 1,
  tpsTempC: 20,
  accelG: 0,
};

const INITIAL_SURFACE_TELEMETRY: SurfaceTelemetry = {
  altitudeM: 150,
  verticalSpeedMs: 19,
  surfaceGravityMs2: WORLDS.moon.surfaceGravity,
  maneuverLabel: 'HLS POWERED DESCENT',
  fuelPct: 100,
  manualThrottlePct: null,
  pitchDeg: 14,
  mach: 0,
  dynamicPressureKpa: 0,
  gLoad: 0.27,
};

const INITIAL_ROVER_NAV: RoverNavTelemetry = {
  active: false,
  targetX: null,
  targetZ: null,
  distanceM: 0,
  obstacleNotice: null,
};

const INITIAL_SCIENCE_STATE: ScienceMissionState = {
  totalTargets: 4,
  collectedCount: 0,
  samples: [],
  activeScanLabel: null,
  scanningProgress: 0,
  missionComplete: false,
  lastSpectroReadout: null,
  autonomousMissionActive: false,
  roverStatus: 'BEKLİYOR / ŞARJ OLUYOR',
  batteryPct: 100,
  maxBattery: 100,
  totalDistanceM: 0,
  sensorTempC: -62.5,
  sensorRadUsv: 0.42,
  sensorSlopeDeg: 0,
  sensorIrReflectance: 0.34,
  sensorCameraStatus: 'Geniş Açı (Bekleme)',
  spectrometerSummary: 'Tarama bekleniyor...',
  systemLog: 'Hazır. Otonom görev başlatın veya zemine tıklayın.',
  roverX: 0,
  roverZ: 3.1,
  roverHeading: 0,
  maxMapRadius: 21,
  radarTargets: [],
  radarCraters: [],
  radarRoute: [],
};

const CAMERA_MODE_ORDER: SurfaceCameraMode[] = [
  'chase',
  'starship_cam',
  'pad_cam',
  'rover_cam',
];

function buildConfigForWorld(craftClass: CraftClassId, worldId: WorldId): HangarConfig {
  const world = WORLDS[worldId];
  return {
    craftClass,
    shieldTier: world.requiredShield,
    powerSource: world.solarFluxRatio < 0.2 ? 'nuclear_rtg' : 'solar_array',
  };
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<MissionWorldEngine | null>(null);

  const [stage, setStage] = useState<SceneStage>('orbit_insertion');
  const [targetWorldId, setTargetWorldId] = useState<WorldId>('moon');
  const [hangarConfig, setHangarConfig] = useState<HangarConfig>({ ...DEFAULT_HANGAR_CONFIG });

  // Stage 5: Orbit Circling & Landing Site Targeting
  const [orbitTelemetry, setOrbitTelemetry] = useState<OrbitTelemetry>(INITIAL_ORBIT_TELEMETRY);

  // Stage 6: Belly-Flop & Flip-and-Burn Landing -> Ramp Deployment -> Rover ChemCam Exploration
  const [surfacePhase, setSurfacePhase] = useState<SurfacePhase>('descending');
  const [surfaceTelemetry, setSurfaceTelemetry] = useState<SurfaceTelemetry>(
    INITIAL_SURFACE_TELEMETRY
  );
  const [cameraMode, setCameraMode] = useState<SurfaceCameraMode>('chase');
  const [autoRoam, setAutoRoam] = useState(false);
  const [headlightsOn, setHeadlightsOn] = useState(false);
  const [sunElevationDeg, setSunElevationDeg] = useState(48);
  const [autoShowcaseOrbit, setAutoShowcaseOrbit] = useState(false);
  const [orbitHoloGridVisible, setOrbitHoloGridVisible] = useState(true);
  const [roverNav, setRoverNav] = useState<RoverNavTelemetry>(INITIAL_ROVER_NAV);
  const [scienceState, setScienceState] = useState<ScienceMissionState>(INITIAL_SCIENCE_STATE);

  const [lang, setLang] = useState<AppLang>('tr');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [hudHidden, setHudHidden] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [webglError, setWebglError] = useState(false);

  const craftStats = useMemo(
    () => computeCraftStats(hangarConfig, targetWorldId),
    [hangarConfig, targetWorldId]
  );

  const switchStage = useCallback(
    (nextStage: SceneStage) => {
      missionAudio.playClick();
      setStage(nextStage);
      if (nextStage === 'orbit_insertion') {
        const w = WORLDS[targetWorldId];
        const defaultSite = LANDING_SITES[targetWorldId][0];
        setOrbitTelemetry((prev) => ({
          craftAngleDeg: 0,
          siteAngleDeg: defaultSite.angleDeg,
          alignmentPct: 0,
          altitudeKm: w.orbitAltitudeKm,
          orbitalVelocityKms: w.orbitMetrics.orbitalVelocityKms,
          orbitalPeriodMin: w.orbitMetrics.orbitalPeriodMin,
          deorbitBurnMs: w.orbitMetrics.deorbitBurnMs,
          phase: 'orbiting',
          timeWarp: prev.timeWarp,
          tpsTempC: 20,
          accelG: 0,
        }));
      } else if (nextStage === 'final_visual') {
        const w = WORLDS[targetWorldId];
        setSurfacePhase('descending');
        setSurfaceTelemetry({
          altitudeM: 150,
          verticalSpeedMs: 19,
          surfaceGravityMs2: w.surfaceGravity,
          maneuverLabel: w.hasAtmosphere ? 'BELLY FLOP SKYDIVE' : 'HLS POWERED DESCENT',
          fuelPct: 100,
          manualThrottlePct: null,
          pitchDeg: w.hasAtmosphere ? 73 : 14,
          mach: w.hasAtmosphere ? 0.08 : 0,
          dynamicPressureKpa: w.hasAtmosphere ? 0.42 : 0,
          gLoad: Number(((w.surfaceGravity * (w.hasAtmosphere ? 1.0 : 1.65)) / 9.80665).toFixed(2)),
        });
        setAutoRoam(false);
        setRoverNav(INITIAL_ROVER_NAV);
      }
      engineRef.current?.setStage(nextStage);
    },
    [targetWorldId]
  );

  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    try {
      const engine = new MissionWorldEngine(
        mount,
        hangarConfig,
        craftStats,
        targetWorldId,
        {
          onOrbitStateUpdate: (state) => {
            setOrbitTelemetry(state);
          },
          onOrbitDescentComplete: () => {
            setStage('final_visual');
            setSurfacePhase('descending');
            setSurfaceTelemetry((prev) => ({
              altitudeM: 150,
              verticalSpeedMs: 19,
              surfaceGravityMs2: prev.surfaceGravityMs2,
              maneuverLabel: 'HLS POWERED DESCENT',
              fuelPct: 100,
              manualThrottlePct: prev.manualThrottlePct,
              pitchDeg: 14,
              mach: 0,
              dynamicPressureKpa: 0,
              gLoad: Number((prev.surfaceGravityMs2 / 9.80665).toFixed(2)),
            }));
            setAutoRoam(false);
            setRoverNav(INITIAL_ROVER_NAV);
            engine.setStage('final_visual');
          },
          onSurfacePhaseChange: (phase) => {
            setSurfacePhase(phase);
          },
          onSurfaceTelemetry: (st) => {
            setSurfaceTelemetry(st);
          },
          onRoverNavUpdate: (nav) => {
            setRoverNav(nav);
          },
          onScienceUpdate: (sci) => {
            setScienceState(sci);
          },
          onCameraModeChange: (mode) => {
            setCameraMode(mode);
          },
        }
      );

      const canvas = mount.querySelector('canvas');
      const handleLost = (e: Event) => {
        e.preventDefault();
        setWebglError(true);
      };
      const handleRestored = () => setWebglError(false);
      canvas?.addEventListener('webglcontextlost', handleLost);
      canvas?.addEventListener('webglcontextrestored', handleRestored);

      engineRef.current = engine;

      return () => {
        canvas?.removeEventListener('webglcontextlost', handleLost);
        canvas?.removeEventListener('webglcontextrestored', handleRestored);
        engine.dispose();
        engineRef.current = null;
      };
    } catch {
      setWebglError(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectWorld = useCallback(
    (worldId: WorldId) => {
      missionAudio.playClick();
      setTargetWorldId(worldId);
      const nextConfig = buildConfigForWorld(hangarConfig.craftClass, worldId);
      setHangarConfig(nextConfig);
      const nextStats = computeCraftStats(nextConfig, worldId);

      const w = WORLDS[worldId];
      const defaultSite = LANDING_SITES[worldId][0];
      setOrbitTelemetry((prev) => ({
        craftAngleDeg: 0,
        siteAngleDeg: defaultSite.angleDeg,
        alignmentPct: 0,
        altitudeKm: w.orbitAltitudeKm,
        orbitalVelocityKms: w.orbitMetrics.orbitalVelocityKms,
        orbitalPeriodMin: w.orbitMetrics.orbitalPeriodMin,
        deorbitBurnMs: w.orbitMetrics.deorbitBurnMs,
        phase: 'orbiting',
        timeWarp: prev.timeWarp,
        tpsTempC: 20,
        accelG: 0,
      }));
      setSurfacePhase('descending');
      setSurfaceTelemetry({
        altitudeM: 150,
        verticalSpeedMs: 19,
        surfaceGravityMs2: w.surfaceGravity,
        maneuverLabel: w.hasAtmosphere ? 'BELLY FLOP SKYDIVE' : 'HLS POWERED DESCENT',
        fuelPct: 100,
        manualThrottlePct: null,
        pitchDeg: w.hasAtmosphere ? 73 : 14,
        mach: w.hasAtmosphere ? 0.08 : 0,
        dynamicPressureKpa: w.hasAtmosphere ? 0.42 : 0,
        gLoad: Number(((w.surfaceGravity * (w.hasAtmosphere ? 1.0 : 1.65)) / 9.80665).toFixed(2)),
      });
      setAutoRoam(false);
      setRoverNav(INITIAL_ROVER_NAV);
      setScienceState(INITIAL_SCIENCE_STATE);

      engineRef.current?.updateCraftConfig(nextConfig, nextStats);
      engineRef.current?.focusWorld(worldId);
    },
    [hangarConfig.craftClass]
  );

  const handleSelectCraftClass = useCallback(
    (craftClass: CraftClassId) => {
      missionAudio.playSnap();
      const nextConfig = { ...hangarConfig, craftClass };
      setHangarConfig(nextConfig);
      const nextStats = computeCraftStats(nextConfig, targetWorldId);
      engineRef.current?.updateCraftConfig(nextConfig, nextStats);
    },
    [hangarConfig, targetWorldId]
  );

  const handleSetTimeWarp = useCallback((warp: OrbitTimeWarp) => {
    missionAudio.playClick();
    engineRef.current?.setOrbitTimeWarp(warp);
  }, []);

  const handleSelectCameraMode = useCallback((mode: SurfaceCameraMode) => {
    missionAudio.playClick();
    setCameraMode(mode);
    engineRef.current?.setSurfaceCameraMode(mode);
  }, []);

  const handleSetManualThrottle = useCallback((pct: number | null) => {
    engineRef.current?.setManualThrottle(pct);
    setSurfaceTelemetry((prev) => ({
      ...prev,
      manualThrottlePct: pct,
    }));
  }, []);

  const handleToggleHeadlights = useCallback(() => {
    missionAudio.playClick();
    const next = engineRef.current?.toggleRoverHeadlights() ?? !headlightsOn;
    setHeadlightsOn(next);
  }, [headlightsOn]);

  const handleTriggerChemCam = useCallback(() => {
    engineRef.current?.triggerChemCamScan();
  }, []);

  const handleSetSunElevationDeg = useCallback((deg: number) => {
    setSunElevationDeg(deg);
    engineRef.current?.setSunElevationDeg(deg);
  }, []);

  const handleToggleAutoShowcaseOrbit = useCallback(() => {
    missionAudio.playClick();
    setAutoShowcaseOrbit((prev) => {
      const next = !prev;
      engineRef.current?.setAutoShowcaseOrbit(next);
      return next;
    });
  }, []);

  const handleToggleOrbitHoloGrid = useCallback(() => {
    missionAudio.playClick();
    setOrbitHoloGridVisible((prev) => {
      const next = !prev;
      engineRef.current?.setOrbitHoloGridVisible(next);
      return next;
    });
  }, []);

  // Keyboard shortcuts: H for HUD, Space in Orbit stage, C/M/L/F/WASD in Surface stage
  useEffect(() => {
    const pressedKeys = new Set<string>();

    const syncRoverKeys = () => {
      let forward = 0;
      let turn = 0;
      if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp')) forward += 1;
      if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown')) forward -= 1;
      if (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft')) turn += 1;
      if (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight')) turn -= 1;
      engineRef.current?.setRoverDriveInput({ forward, turn });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (guideOpen) return;

      if (e.code === 'KeyH') {
        setHudHidden((prev) => !prev);
        return;
      }

      if (e.code === 'Space' && stage === 'orbit_insertion') {
        e.preventDefault();
        if (orbitTelemetry.phase === 'orbiting') {
          missionAudio.playClick();
          engineRef.current?.armDeorbitDescent();
        } else if (orbitTelemetry.phase === 'armed') {
          missionAudio.playClick();
          engineRef.current?.cancelDeorbitArm();
        }
        return;
      }

      if (stage === 'final_visual') {
        if (e.code === 'KeyC') {
          e.preventDefault();
          const nextIdx = (CAMERA_MODE_ORDER.indexOf(cameraMode) + 1) % CAMERA_MODE_ORDER.length;
          handleSelectCameraMode(CAMERA_MODE_ORDER[nextIdx]);
          return;
        }

        if (e.code === 'KeyM' && surfacePhase === 'descending') {
          e.preventDefault();
          missionAudio.playClick();
          handleSetManualThrottle(surfaceTelemetry.manualThrottlePct === null ? 78 : null);
          return;
        }

        if (e.code === 'KeyL' && surfacePhase === 'rover_active') {
          e.preventDefault();
          handleToggleHeadlights();
          return;
        }

        if (e.code === 'KeyF' && surfacePhase === 'rover_active') {
          e.preventDefault();
          handleTriggerChemCam();
          return;
        }

        if (
          surfacePhase === 'rover_active' &&
          (e.code === 'KeyW' ||
            e.code === 'KeyA' ||
            e.code === 'KeyS' ||
            e.code === 'KeyD' ||
            e.code === 'ArrowUp' ||
            e.code === 'ArrowDown' ||
            e.code === 'ArrowLeft' ||
            e.code === 'ArrowRight')
        ) {
          e.preventDefault();
          pressedKeys.add(e.code);
          syncRoverKeys();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (pressedKeys.has(e.code)) {
        pressedKeys.delete(e.code);
        if (stage === 'final_visual' && surfacePhase === 'rover_active') {
          syncRoverKeys();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      engineRef.current?.setRoverDriveInput({ forward: 0, turn: 0 });
    };
  }, [
    guideOpen,
    stage,
    orbitTelemetry.phase,
    surfacePhase,
    cameraMode,
    surfaceTelemetry.manualThrottlePct,
    handleSelectCameraMode,
    handleSetManualThrottle,
    handleToggleHeadlights,
    handleTriggerChemCam,
  ]);

  const handleResetMission = useCallback(() => {
    missionAudio.playClick();
    setHangarConfig({ ...DEFAULT_HANGAR_CONFIG });
    setTargetWorldId('moon');
    setOrbitTelemetry(INITIAL_ORBIT_TELEMETRY);
    setSurfacePhase('descending');
    setSurfaceTelemetry(INITIAL_SURFACE_TELEMETRY);
    setCameraMode('chase');
    setAutoRoam(false);
    setHeadlightsOn(false);
    setSunElevationDeg(48);
    setAutoShowcaseOrbit(false);
    setOrbitHoloGridVisible(true);
    setRoverNav(INITIAL_ROVER_NAV);
    setScienceState(INITIAL_SCIENCE_STATE);
    setStage('orbit_insertion');
    const nextStats = computeCraftStats(DEFAULT_HANGAR_CONFIG, 'moon');
    engineRef.current?.setOrbitTimeWarp(1);
    engineRef.current?.setManualThrottle(null);
    engineRef.current?.setSunElevationDeg(48);
    engineRef.current?.setAutoShowcaseOrbit(false);
    engineRef.current?.setOrbitHoloGridVisible(true);
    engineRef.current?.setSurfaceCameraMode('chase');
    engineRef.current?.updateCraftConfig(DEFAULT_HANGAR_CONFIG, nextStats);
    engineRef.current?.focusWorld('moon');
    engineRef.current?.setStage('orbit_insertion');
  }, []);

  return (
    <div className="relative w-screen h-screen flex flex-col bg-[#03050c] text-slate-100 overflow-hidden">
      <TopBar
        stage={stage}
        onStageChange={switchStage}
        targetWorldId={targetWorldId}
        onSelectWorld={handleSelectWorld}
        lang={lang}
        onToggleLang={() => {
          missionAudio.playClick();
          setLang((prev) => (prev === 'tr' ? 'en' : 'tr'));
        }}
        audioEnabled={audioEnabled}
        onToggleAudio={() => {
          const next = !audioEnabled;
          setAudioEnabled(next);
          missionAudio.setEnabled(next);
        }}
        hudHidden={hudHidden}
        onToggleHud={() => setHudHidden((prev) => !prev)}
        onOpenGuide={() => {
          missionAudio.playClick();
          setGuideOpen(true);
        }}
        onResetMission={handleResetMission}
      />

      <main className="relative flex-1 w-full h-full overflow-hidden">
        {/* Isolated WebGL Mount Container */}
        <div ref={canvasMountRef} className="absolute inset-0 w-full h-full" />

        {webglError && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#060911] p-6 text-center">
            <div className="max-w-md bg-[#0b1222] border border-slate-800 rounded-xl p-6">
              <h2 className="font-display text-lg font-bold text-white">
                3D Graphics Context Unavailable
              </h2>
              <p className="text-xs text-slate-400 mt-2">
                WebGL rendering was interrupted. Reload the page to reinitialize MissionForge.
              </p>
            </div>
          </div>
        )}

        {!hudHidden && stage === 'orbit_insertion' && (
          <OrbitInsertionOverlay
            lang={lang}
            targetWorldId={targetWorldId}
            craftClass={hangarConfig.craftClass}
            stats={craftStats}
            telemetry={orbitTelemetry}
            orbitHoloGridVisible={orbitHoloGridVisible}
            onToggleOrbitHoloGrid={handleToggleOrbitHoloGrid}
            onSelectCraftClass={handleSelectCraftClass}
            onSelectSiteAngle={(deg) => {
              missionAudio.playSnap();
              engineRef.current?.selectLandingSiteAngle(deg);
            }}
            onSetTimeWarp={handleSetTimeWarp}
            onArmDeorbit={() => {
              missionAudio.playClick();
              engineRef.current?.armDeorbitDescent();
            }}
            onCancelArm={() => {
              missionAudio.playClick();
              engineRef.current?.cancelDeorbitArm();
            }}
          />
        )}

        {!hudHidden && stage === 'final_visual' && (
          <FinalVisualOverlay
            lang={lang}
            targetWorldId={targetWorldId}
            stats={craftStats}
            surfacePhase={surfacePhase}
            surfaceTelemetry={surfaceTelemetry}
            cameraMode={cameraMode}
            autoRoam={autoRoam}
            headlightsOn={headlightsOn}
            sunElevationDeg={sunElevationDeg}
            autoShowcaseOrbit={autoShowcaseOrbit}
            roverNav={roverNav}
            scienceState={scienceState}
            onSelectCameraMode={handleSelectCameraMode}
            onSetManualThrottle={handleSetManualThrottle}
            onSetSunElevationDeg={handleSetSunElevationDeg}
            onToggleAutoShowcaseOrbit={handleToggleAutoShowcaseOrbit}
            onToggleAutoRoam={() => {
              missionAudio.playClick();
              const next = !autoRoam;
              setAutoRoam(next);
              engineRef.current?.setRoverDriveInput({ autoRoam: next });
            }}
            onToggleHeadlights={handleToggleHeadlights}
            onTriggerChemCam={handleTriggerChemCam}
            onStartAutonomousMission={() => {
              missionAudio.playClick();
              engineRef.current?.startAutonomousRoverMission();
            }}
            onResetRoverState={() => {
              missionAudio.playClick();
              setAutoRoam(false);
              engineRef.current?.resetRoverState();
            }}
            onDriveControl={(forward, turn) => {
              engineRef.current?.setRoverDriveInput({ forward, turn });
            }}
            onCancelRoverRoute={() => {
              missionAudio.playClick();
              engineRef.current?.clearRoverNavigation();
            }}
            onReplaySequence={() => {
              missionAudio.playClick();
              setAutoRoam(false);
              setRoverNav(INITIAL_ROVER_NAV);
              engineRef.current?.replaySurfaceSequence();
            }}
            onSkipToRover={() => {
              missionAudio.playClick();
              engineRef.current?.skipToRoverActive();
            }}
            onReturnToOrbit={() => switchStage('orbit_insertion')}
          />
        )}

        {hudHidden && (
          <div className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
            <button
              type="button"
              onClick={() => setHudHidden(false)}
              className="px-4 py-2 rounded-lg bg-[#080d1a]/92 border border-cyan-500/40 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 cursor-pointer"
            >
              {lang === 'tr' ? 'HUD Göster [H]' : 'Show HUD [H]'}
            </button>
          </div>
        )}
      </main>

      <GuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
