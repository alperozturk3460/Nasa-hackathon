import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  CraftStats,
  HangarConfig,
  LANDING_SITES,
  SceneStage,
  SurfacePhase,
  WORLDS,
  WorldId,
} from '../data/missionData';
import { computeVisVivaSpeedKms } from '../physics/orbitalMechanics';
import { missionAudio } from '../utils/audio';
import {
  buildColonyStructures,
  buildDropSpaceship,
  buildRoverVehicle,
  createAtmosphereMesh,
  CURIOSITY_WHEEL_HUBS,
  LandingVehicleRig,
  RoverVehicleRig,
  SpacecraftPBRAssets,
} from './models';
import {
  createAsteroidPBR,
  createEarthPBR,
  createETFoamPBR,
  createEuropaIcePBR,
  createJupiterPBR,
  createKaptonFoilPBR,
  createMarsPBR,
  createMilkyWayBackdropTexture,
  createMoonPBR,
  createShuttleTilesPBR,
  createSmokePuffTexture,
  createSoftGlowTexture,
  createSolarCellPBR,
  fbm3,
  PBRTextureSet,
} from './proceduralTextures';
import {
  clampToFreeSurfacePoint,
  findShortestObstacleFreePath,
  generateWorldObstacles,
  getCraterDisplacement,
  getWorldCraters,
  ROVER_COLLISION_RADIUS,
  RoverNavTelemetry,
  ScienceMissionState,
  ScienceSampleRecord,
  SurfaceObstacle,
} from './surfaceNavigation';

export type { RoverNavTelemetry, ScienceMissionState, ScienceSampleRecord };

export type OrbitTimeWarp = 1 | 2 | 4;
export type SurfaceCameraMode = 'chase' | 'starship_cam' | 'pad_cam' | 'rover_cam';

export interface ProjectedLabel {
  id: string;
  x: number;
  y: number;
  visible: boolean;
  hovered: boolean;
  selected: boolean;
}

export interface LaunchTelemetry {
  phase: 'pad' | 'countdown' | 'liftoff' | 'booster_sep' | 'payload_deploy' | 'complete';
  countdownValue: number;
  altitudeKm: number;
  velocityKmh: number;
  accelG: number;
  fuelPct: number;
  stageLabel: string;
  sepVelocityMs: number;
}

export interface OrbitTelemetry {
  craftAngleDeg: number;
  siteAngleDeg: number;
  alignmentPct: number;
  altitudeKm: number;
  orbitalVelocityKms: number;
  orbitalPeriodMin: number;
  deorbitBurnMs: number;
  phase: 'orbiting' | 'armed' | 'descending';
  timeWarp: OrbitTimeWarp;
  tpsTempC: number;
  accelG: number;
}

export interface SurfaceTelemetry {
  altitudeM: number;
  verticalSpeedMs: number;
  surfaceGravityMs2: number;
  maneuverLabel: string;
  fuelPct: number;
  manualThrottlePct: number | null;
  pitchDeg: number;
  mach: number;
  dynamicPressureKpa: number;
  gLoad: number;
}

export interface EngineCallbacks {
  onSelectWorld?: (worldId: WorldId) => void;
  onUpdateLabels?: (labels: ProjectedLabel[]) => void;
  onUpdatePlanetCardPos?: (pos: { x: number; y: number; visible: boolean }) => void;
  onLaunchTelemetry?: (t: LaunchTelemetry) => void;
  onLaunchComplete?: () => void;
  onJourneyProgress?: (progress: number) => void;
  onJourneyComplete?: () => void;
  onOrbitStateUpdate: (state: OrbitTelemetry) => void;
  onOrbitDescentComplete: () => void;
  onSurfacePhaseChange: (phase: SurfacePhase) => void;
  onSurfaceTelemetry?: (t: SurfaceTelemetry) => void;
  onRoverNavUpdate?: (nav: RoverNavTelemetry) => void;
  onScienceUpdate?: (state: ScienceMissionState) => void;
  onCameraModeChange?: (mode: SurfaceCameraMode) => void;
}

const SURFACE_METERS_PER_UNIT = 2.0;
const ORBIT_PLANET_RADIUS = 4.3;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _upAxis = new THREE.Vector3(0, 1, 0);
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _col = new THREE.Color();

export class MissionWorldEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private isSoftwareGl = false;
  private frameId = 0;
  private disposed = false;

  private activeStage: SceneStage = 'orbit_insertion';
  private targetWorldId: WorldId = 'moon';
  private currentConfig: HangarConfig;
  private callbacks: EngineCallbacks;

  private maxAnisotropy = 8;

  // PBR Texture Suites for Stages 5 & 6
  private earthPBR: PBRTextureSet;
  private moonPBR: PBRTextureSet;
  private marsPBR: PBRTextureSet;
  private jupiterPBR: PBRTextureSet;
  private europaPBR: PBRTextureSet;
  private asteroidPBR: PBRTextureSet;
  private proximaPBR: PBRTextureSet;
  private milkyWayTexture: THREE.Texture;
  private glowTexture: THREE.Texture;
  private smokeTexture: THREE.Texture;
  private spacecraftAssets: SpacecraftPBRAssets;

  private starField!: THREE.InstancedMesh;
  private skyBackdrop!: THREE.Mesh;
  private hemiLight!: THREE.HemisphereLight;
  private keyLight!: THREE.DirectionalLight;
  private rimLight!: THREE.DirectionalLight;
  private sunVisualGroup!: THREE.Group;
  private sunElevationDeg = 48;

  // Scene root groups for Stages 5 & 6
  private orbitGroup = new THREE.Group();
  private finalGroup = new THREE.Group();

  private cameraFocusTarget: THREE.Vector3 | null = null;
  private cameraFocusPos: THREE.Vector3 | null = null;
  private userOrbiting = false;
  private autoShowcaseOrbit = false;

  // Stage 5: Orbit Circling & Landing Site Selection -> Slow Spiral De-Orbit Descent
  private orbitPlanetMesh!: THREE.Mesh;
  private orbitAtmoMesh!: THREE.Mesh;
  private orbitHoloGridGroup!: THREE.Group;
  private orbitCraft!: THREE.Group;
  private orbitCraftRig: LandingVehicleRig | null = null;
  private orbitReticleGroup!: THREE.Group;
  private orbitReticleMat!: THREE.MeshBasicMaterial;
  private orbitCraftFlame!: THREE.Mesh;
  private orbitPlasmaMesh!: THREE.Mesh;
  private orbitRingLine!: THREE.LineLoop;
  private orbitDescentLine!: THREE.Line;
  private landingBeaconGroup!: THREE.Group;
  private candidatePinsGroup = new THREE.Group();
  private orbitCraftAngle = 0; // radians
  private selectedSiteAngleDeg = 35;
  private orbitPhase: 'orbiting' | 'armed' | 'descending' = 'orbiting';
  private orbitTimeWarp: OrbitTimeWarp = 1;
  private orbitDescentT = 0;
  private orbitDescentStartAngle = 0;
  private orbitDescentSweep = Math.PI * 2;
  private orbitTouchdownTimer = -1;
  private lastOrbitUiPush = 0;

  // Stage 6: Vertical Landing -> Ramp -> Rover Exit + Craters, Pits, Physical Obstacles & Shortest Pathfinding
  private landingVehicle: LandingVehicleRig | null = null;
  private landerScorchMesh: THREE.Mesh | null = null;
  private landerScorchIntensity = 0;
  private roverVehicle: RoverVehicleRig | null = null;
  private surfaceTerrainMesh: THREE.Mesh | null = null;
  private surfaceObstacles: SurfaceObstacle[] = [];
  private roverPathWaypoints: THREE.Vector2[] = [];
  private roverWaypointIdx = 0;
  private roverNavLine!: THREE.Line;
  private roverTargetBeacon!: THREE.Group;
  private roverBumpTimer = 0;
  private lastBumpAudioTime = 0;
  private obstacleNoticeTimer = 0;
  private currentObstacleNotice: string | null = null;
  private lastRoverNavPush = 0;
  private surfacePhase: SurfacePhase = 'descending';
  private surfaceCameraMode: SurfaceCameraMode = 'chase';
  private manualThrottlePct: number | null = null;
  private landerFuelPct = 100;
  private flipBurnIgnited = false;
  private surfaceTimer = 0;
  private landerY = 75;
  private landerVelY = 0;
  private landerCompression = 0;
  private landerCompressionVel = 0;
  private landerFlameFade = 1;
  private lastSurfacePush = 0;
  private rampAngle = 0;
  private roverPos = new THREE.Vector3(0, 0.48, -0.05);
  private roverHeading = 0;
  private roverDriveInput = { forward: 0, turn: 0, autoRoam: false };
  private roverHeadlightsOn = false;
  private wheelTrackMesh: THREE.InstancedMesh | null = null;
  private wheelTrackCount = 0;
  private lastWheelTrackPos = new THREE.Vector2(0, 0);
  private chemCamBeamLine: THREE.Line | null = null;
  private chemCamSparkSprite: THREE.Sprite | null = null;
  private chemCamScanTimer = 0;
  private chemCamActiveTarget: SurfaceObstacle | null = null;
  private pendingScanObstacleId: number | null = null;
  private collectedSamples: ScienceSampleRecord[] = [];
  private lastSpectroReadout: string | null = null;
  // ASI Telemetry & Autonomous Rover Mechanics
  private autonomousMissionActive = false;
  private roverBattery = 100.0;
  private roverMaxBattery = 100.0;
  private roverTotalDistanceM = 0.0;
  private sensorTempC = -45.0;
  private sensorRadUsv = 55.0;
  private sensorSlopeDeg = 0.0;
  private sensorIrReflectance = 0.85;
  private sensorCameraStatus = 'Geniş Açı (Bekleme)';
  private spectrometerSummary = 'Analiz bekleniyor...';
  private systemLog = 'Sistem aktif. Hedef seçin veya Görev Başlatın.';
  private lastSensorUpdateTime = 0;
  private lastScienceUiPush = 0;
  private surfaceDustPool: {
    sprite: THREE.Sprite;
    vel: THREE.Vector3;
    age: number;
    active: boolean;
    baseScale: number;
  }[] = [];
  private finalRadarDish: THREE.Group | null = null;
  private finalCloudsMesh: THREE.Mesh | null = null;

  // Raycasting
  private raycaster = new THREE.Raycaster();
  private pointerNDC = new THREE.Vector2();
  private lastHoverCheck = 0;
  private pointerDownPos = new THREE.Vector2();

  constructor(
    container: HTMLElement,
    initialConfig: HangarConfig,
    _initialStats: CraftStats,
    initialWorld: WorldId,
    callbacks: EngineCallbacks
  ) {
    this.container = container;
    this.currentConfig = { ...initialConfig };
    this.targetWorldId = initialWorld;
    this.callbacks = callbacks;

    this.isSoftwareGl = this.detectSoftwareWebGL();
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.88;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height);
    container.appendChild(this.renderer.domElement);

    this.maxAnisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02040a);

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42;
    pmremGenerator.dispose();

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 750);
    this.camera.position.set(0, 15.5, 18.5);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 45;
    this.controls.addEventListener('start', () => {
      this.userOrbiting = true;
      this.cameraFocusTarget = null;
      this.cameraFocusPos = null;
    });
    this.controls.addEventListener('end', () => {
      this.userOrbiting = false;
    });

    // Generate Procedural PBR Texture Suites for Planets & Spacecraft
    this.earthPBR = createEarthPBR(this.maxAnisotropy);
    this.moonPBR = createMoonPBR(this.maxAnisotropy, false);
    this.marsPBR = createMarsPBR(this.maxAnisotropy, false);
    this.jupiterPBR = createJupiterPBR(this.maxAnisotropy);
    this.europaPBR = createEuropaIcePBR(this.maxAnisotropy);
    this.asteroidPBR = createAsteroidPBR(this.maxAnisotropy);
    this.proximaPBR = createMarsPBR(this.maxAnisotropy, true);
    this.milkyWayTexture = createMilkyWayBackdropTexture();
    this.glowTexture = createSoftGlowTexture();
    this.smokeTexture = createSmokePuffTexture();

    this.spacecraftAssets = {
      kapton: createKaptonFoilPBR(this.maxAnisotropy),
      solar: createSolarCellPBR(this.maxAnisotropy),
      shuttleWhite: createShuttleTilesPBR(this.maxAnisotropy, false),
      shuttleBlack: createShuttleTilesPBR(this.maxAnisotropy, true),
      etFoam: createETFoamPBR(this.maxAnisotropy),
      glow: this.glowTexture,
    };

    if (!this.isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      this.composer = new EffectComposer(this.renderer);
      this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.composer.setSize(width, height);
      const renderPass = new RenderPass(this.scene, this.camera);
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.14,
        0.28,
        0.96
      );
      const outputPass = new OutputPass();
      this.composer.addPass(renderPass);
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(outputPass);
    }

    this.setupLighting();
    this.buildSkyAndStars();
    this.buildOrbitInsertionScene();
    this.buildFinalVisualScene();

    this.scene.add(this.orbitGroup, this.finalGroup);
    this.setStage('orbit_insertion');

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.clock.start();
    this.tick();
  }

  private detectSoftwareWebGL(): boolean {
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    } catch {
      return true;
    }
  }

  private setupLighting(): void {
    this.hemiLight = new THREE.HemisphereLight(0xa5c8ff, 0x0a1020, 0.38);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff4e0, 1.65);
    this.keyLight.position.set(22, 34, 24);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.left = -24;
    this.keyLight.shadow.camera.right = 24;
    this.keyLight.shadow.camera.top = 24;
    this.keyLight.shadow.camera.bottom = -24;
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0x38bdf8, 0.42);
    this.rimLight.position.set(-22, 14, -24);
    this.scene.add(this.rimLight);

    // Solar Photosphere, Corona Halo & Multi-Ring Lens Flare Group
    this.sunVisualGroup = new THREE.Group();
    const sunCore = new THREE.Mesh(
      new THREE.SphereGeometry(2.8, 24, 20),
      new THREE.MeshBasicMaterial({ color: 0xfffbeb })
    );
    this.sunVisualGroup.add(sunCore);

    const coronaSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xfde68a,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    coronaSprite.scale.setScalar(30);
    this.sunVisualGroup.add(coronaSprite);

    const outerFlareSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.36,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    outerFlareSprite.scale.set(64, 18, 1);
    this.sunVisualGroup.add(outerFlareSprite);

    const warmHaloSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xf97316,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    warmHaloSprite.scale.setScalar(52);
    this.sunVisualGroup.add(warmHaloSprite);

    this.scene.add(this.sunVisualGroup);
    this.setSunElevationDeg(this.sunElevationDeg);
  }

  public setSunElevationDeg(deg: number): void {
    this.sunElevationDeg = THREE.MathUtils.clamp(deg, 5, 85);
    const elevRad = THREE.MathUtils.degToRad(this.sunElevationDeg);
    const azimuthRad = 0.72; // ~41° azimuth for dramatic crater rim lighting
    const dist = 42;
    const horiz = Math.cos(elevRad) * dist;
    const lx = Math.cos(azimuthRad) * horiz;
    const ly = Math.max(3.2, Math.sin(elevRad) * dist);
    const lz = Math.sin(azimuthRad) * horiz;

    this.keyLight.position.set(lx, ly, lz);
    this.sunVisualGroup.position.set(lx * 4.6, ly * 4.6, lz * 4.6);

    // Smooth color temperature & intensity transition from Dusk/Night (5°) -> Golden Hour (22°) -> Midday (55°+)
    const t = THREE.MathUtils.clamp((this.sunElevationDeg - 5) / 55, 0, 1);
    const duskCol = new THREE.Color(0xf97316);
    const goldenCol = new THREE.Color(0xfde68a);
    const noonCol = new THREE.Color(0xfff4e0);

    if (t < 0.35) {
      this.keyLight.color.copy(duskCol).lerp(goldenCol, t / 0.35);
    } else {
      this.keyLight.color.copy(goldenCol).lerp(noonCol, (t - 0.35) / 0.65);
    }

    this.keyLight.intensity = THREE.MathUtils.lerp(0.52, 1.72, Math.pow(t, 0.75));
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.12, 0.40, t);
    this.rimLight.intensity = THREE.MathUtils.lerp(0.62, 0.38, t);
  }

  public setAutoShowcaseOrbit(enabled: boolean): void {
    this.autoShowcaseOrbit = enabled;
    if (enabled) {
      this.userOrbiting = false;
    }
  }

  public setOrbitHoloGridVisible(visible: boolean): void {
    if (this.orbitHoloGridGroup) {
      this.orbitHoloGridGroup.visible = visible;
    }
  }

  private buildSkyAndStars(): void {
    this.skyBackdrop = new THREE.Mesh(
      new THREE.SphereGeometry(290, 48, 32),
      new THREE.MeshBasicMaterial({
        map: this.milkyWayTexture,
        side: THREE.BackSide,
        depthWrite: false,
      })
    );
    this.scene.add(this.skyBackdrop);

    const count = 1200;
    const geo = new THREE.OctahedronGeometry(0.16, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.starField = new THREE.InstancedMesh(geo, mat, count);
    for (let i = 0; i < count; i++) {
      const r = 145 + Math.random() * 125;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      _v1.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
      _euler.set(0, 0, 0);
      _quat.setFromEuler(_euler);
      const s = 0.35 + Math.random() * 1.35;
      _scale.set(s, s, s);
      _mat4.compose(_v1, _quat, _scale);
      this.starField.setMatrixAt(i, _mat4);
      const tint = Math.random();
      _col.setHex(tint < 0.22 ? 0x93c5fd : tint < 0.38 ? 0xfde68a : 0xf8fafc);
      this.starField.setColorAt(i, _col);
    }
    this.starField.instanceMatrix.needsUpdate = true;
    if (this.starField.instanceColor) this.starField.instanceColor.needsUpdate = true;
    this.starField.computeBoundingSphere();
    this.scene.add(this.starField);
  }

  private getWorldPBR(worldId: WorldId): PBRTextureSet {
    switch (worldId) {
      case 'earth':
        return this.earthPBR;
      case 'moon':
        return this.moonPBR;
      case 'mars':
        return this.marsPBR;
      case 'jupiter':
        return this.jupiterPBR;
      case 'asteroid':
        return this.asteroidPBR;
      case 'colony':
        return this.proximaPBR;
    }
  }

  private getVisualOrbitRadius(worldId: WorldId): number {
    const world = WORLDS[worldId];
    const altRatio = world.orbitAltitudeKm / Math.max(1, world.meanRadiusKm);
    return ORBIT_PLANET_RADIUS + THREE.MathUtils.clamp(0.75 + Math.sqrt(altRatio) * 3.1, 1.35, 3.3);
  }

  private refreshOrbitRingGeometry(orbitRadius: number): void {
    if (!this.orbitRingLine) return;
    const pos = this.orbitRingLine.geometry.attributes.position as THREE.BufferAttribute;
    const count = pos.count;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      pos.setXYZ(i, Math.cos(a) * orbitRadius, 0, Math.sin(a) * orbitRadius);
    }
    pos.needsUpdate = true;
    this.orbitRingLine.computeLineDistances();
  }

  private buildOrbitInsertionScene(): void {
    this.orbitPlanetMesh = new THREE.Mesh(
      new THREE.SphereGeometry(ORBIT_PLANET_RADIUS, 64, 48),
      new THREE.MeshStandardMaterial({
        map: this.moonPBR.map,
        normalMap: this.moonPBR.normalMap,
        roughnessMap: this.moonPBR.roughnessMap,
        roughness: 0.8,
      })
    );
    this.orbitGroup.add(this.orbitPlanetMesh);

    this.orbitAtmoMesh = createAtmosphereMesh(4.56, 0x38bdf8, 0.48, 3.0);
    this.orbitGroup.add(this.orbitAtmoMesh);

    // 3D Holographic Planetary Coordinate Grid & Dynamic Altitude Projection Rings
    this.orbitHoloGridGroup = new THREE.Group();
    const wireSphereGeo = new THREE.WireframeGeometry(
      new THREE.SphereGeometry(ORBIT_PLANET_RADIUS + 0.06, 24, 16)
    );
    const wireSphere = new THREE.LineSegments(
      wireSphereGeo,
      new THREE.LineBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.orbitHoloGridGroup.add(wireSphere);

    // Polar & Equatorial Holographic Reference Rings
    [0, Math.PI / 2].forEach((rotX, idx) => {
      const holoRing = new THREE.Mesh(
        new THREE.RingGeometry(ORBIT_PLANET_RADIUS + 0.42 + idx * 0.38, ORBIT_PLANET_RADIUS + 0.45 + idx * 0.38, 64),
        new THREE.MeshBasicMaterial({
          color: idx === 0 ? 0x38bdf8 : 0x10b981,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.24,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      holoRing.rotation.x = rotX;
      this.orbitHoloGridGroup.add(holoRing);
    });
    this.orbitGroup.add(this.orbitHoloGridGroup);

    // Dashed Circular Orbit Ring matching target world's physical altitude-to-radius ratio
    const orbitRadius = this.getVisualOrbitRadius(this.targetWorldId);
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * orbitRadius, 0, Math.sin(a) * orbitRadius));
    }
    this.orbitRingLine = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineDashedMaterial({
        color: 0x38bdf8,
        dashSize: 0.72,
        gapSize: 0.38,
        transparent: true,
        opacity: 0.9,
      })
    );
    this.orbitRingLine.computeLineDistances();
    this.orbitGroup.add(this.orbitRingLine);

    // Selected Landing Site Laser Beacon on the Planet Surface
    this.landingBeaconGroup = new THREE.Group();
    const beaconRing = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.42, 32),
      new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide, transparent: true, opacity: 0.95 })
    );
    this.landingBeaconGroup.add(beaconRing);

    const beaconPin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 1.15, 12),
      new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.9 })
    );
    beaconPin.rotation.x = Math.PI / 2;
    beaconPin.position.z = 0.58;
    this.landingBeaconGroup.add(beaconPin);

    const beaconTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x6ee7b7 })
    );
    beaconTip.position.z = 1.16;
    this.landingBeaconGroup.add(beaconTip);
    this.orbitGroup.add(this.landingBeaconGroup);

    this.orbitGroup.add(this.candidatePinsGroup);

    // Predicted Spiral De-Orbit Descent Path Line (121 vertices)
    const arcPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 120; i++) arcPts.push(new THREE.Vector3());
    this.orbitDescentLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(arcPts),
      new THREE.LineDashedMaterial({ color: 0xf59e0b, dashSize: 0.4, gapSize: 0.28 })
    );
    this.orbitDescentLine.visible = false;
    this.orbitGroup.add(this.orbitDescentLine);

    // Realistically Scaled Orbiting SpaceX Starship (1:5.53 aspect ratio, legs stowed in orbit)
    this.orbitCraft = new THREE.Group();
    this.orbitCraftRig = buildDropSpaceship(this.spacecraftAssets, this.currentConfig);
    this.orbitCraftRig.root.scale.setScalar(0.135);
    this.orbitCraftRig.root.position.set(0, -0.45, 0);
    this.orbitCraftRig.legsGroup.visible = false;
    this.orbitCraftRig.flameGroup.visible = false;
    this.orbitCraft.add(this.orbitCraftRig.root);

    this.orbitReticleGroup = new THREE.Group();
    this.orbitReticleMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
    const reticleRing = new THREE.Mesh(new THREE.RingGeometry(0.50, 0.57, 36), this.orbitReticleMat);
    this.orbitReticleGroup.add(reticleRing);
    for (let t = 0; t < 4; t++) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.03), this.orbitReticleMat);
      const ang = (t * Math.PI) / 2;
      tick.position.set(Math.cos(ang) * 0.65, Math.sin(ang) * 0.65, 0);
      tick.rotation.z = ang;
      this.orbitReticleGroup.add(tick);
    }
    this.orbitCraft.add(this.orbitReticleGroup);

    this.orbitCraftFlame = new THREE.Mesh(
      new THREE.ConeGeometry(0.068, 0.46, 14),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.orbitCraftFlame.rotation.x = Math.PI;
    this.orbitCraftFlame.position.set(0, -0.44, 0);
    this.orbitCraftFlame.visible = false;
    this.orbitCraft.add(this.orbitCraftFlame);

    // Ionized Atmospheric Re-Entry Plasma Sheath around windward TPS heatshield
    this.orbitPlasmaMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.65),
      new THREE.MeshBasicMaterial({
        color: 0xf97316,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.orbitPlasmaMesh.scale.set(0.68, 1.65, 0.78);
    this.orbitPlasmaMesh.position.set(0, 0.02, -0.05);
    this.orbitPlasmaMesh.visible = false;
    this.orbitCraft.add(this.orbitPlasmaMesh);

    this.orbitGroup.add(this.orbitCraft);

    this.refreshOrbitSiteMarkers();
  }

  private refreshOrbitSiteMarkers(): void {
    while (this.candidatePinsGroup.children.length > 0) {
      this.candidatePinsGroup.remove(this.candidatePinsGroup.children[0]);
    }
    const sites = LANDING_SITES[this.targetWorldId];
    const R = 4.34;
    for (const site of sites) {
      const rad = THREE.MathUtils.degToRad(site.angleDeg);
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 14, 12),
        new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
      );
      pin.position.set(Math.cos(rad) * R, 0, Math.sin(rad) * R);
      this.candidatePinsGroup.add(pin);
    }
    this.updateSelectedSiteBeacon();
  }

  private updateSelectedSiteBeacon(): void {
    const rad = THREE.MathUtils.degToRad(this.selectedSiteAngleDeg);
    const R = 4.35;
    const bx = Math.cos(rad) * R;
    const bz = Math.sin(rad) * R;
    this.landingBeaconGroup.position.set(bx, 0, bz);
    this.landingBeaconGroup.lookAt(bx * 2, 0, bz * 2);
  }

  private getTerrainHeightAt(worldId: WorldId, x: number, z: number): number {
    if (worldId === 'earth') return 0.18;

    const centerDist = Math.sqrt(x * x + z * z);
    const padBlend = THREE.MathUtils.smoothstep(centerDist, 4.0, 9.2);
    const craterDelta = getCraterDisplacement(worldId, x, z) * padBlend;

    if (worldId === 'asteroid') {
      const r2 = x * x + z * z;
      return (
        -(r2 / 140) +
        (fbm3(x * 0.08, 0.5, z * 0.08, 4, 901) - 0.5) * 1.4 * padBlend +
        craterDelta
      );
    }

    const R = 110;
    const r2 = x * x + z * z;
    const curvature = -(r2 / (2 * R));

    const nx = x * 0.055;
    const nz = z * 0.055;
    let h = fbm3(nx, 0.5, nz, 5, worldId === 'moon' ? 21 : worldId === 'mars' ? 51 : 81);

    if (worldId === 'moon') {
      h = (h - 0.45) * 3.4 * padBlend;
    } else if (worldId === 'jupiter') {
      const ridge = Math.abs(Math.sin(x * 0.14 + h * 3.2)) * 1.35;
      h = ((h - 0.5) * 1.6 + ridge) * padBlend;
    } else {
      const colonyBlend =
        worldId === 'colony' ? THREE.MathUtils.smoothstep(centerDist, 9.0, 18.0) : padBlend;
      h = (h - 0.45) * 4.0 * colonyBlend;
    }

    return curvature + h + craterDelta;
  }

  private createPlanetaryTerrain(worldId: WorldId): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(240, 240, 160, 160);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, this.getTerrainHeightAt(worldId, x, z));
    }
    geo.computeVertexNormals();

    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * 4.5, uv.getY(i) * 4.5);
    }

    const pbr =
      worldId === 'moon'
        ? this.moonPBR
        : worldId === 'mars'
        ? this.marsPBR
        : worldId === 'jupiter'
        ? this.europaPBR
        : worldId === 'asteroid'
        ? this.asteroidPBR
        : this.proximaPBR;

    const mat = new THREE.MeshStandardMaterial({
      map: pbr.map,
      normalMap: pbr.normalMap ?? null,
      normalScale: new THREE.Vector2(1.4, 1.4),
      roughnessMap: pbr.roughnessMap ?? null,
      roughness: worldId === 'jupiter' ? 0.35 : 0.88,
      metalness: worldId === 'asteroid' ? 0.32 : worldId === 'jupiter' ? 0.12 : 0.04,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildFinalVisualScene(): void {
    for (let i = 0; i < 28; i++) {
      const sMat = new THREE.SpriteMaterial({
        map: this.smokeTexture,
        color: 0xe2e8f0,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(sMat);
      sprite.visible = false;
      this.finalGroup.add(sprite);
      this.surfaceDustPool.push({
        sprite,
        vel: new THREE.Vector3(),
        age: 0,
        active: false,
        baseScale: 1.1,
      });
    }
    this.rebuildFinalVisual();
  }

  private spawnSurfaceDust(x: number, y: number, z: number, spread = 2.6): void {
    const puff = this.surfaceDustPool.find((p) => !p.active);
    if (!puff) return;
    puff.active = true;
    puff.age = 0;
    puff.baseScale = 0.9 + Math.random() * 0.9;
    puff.sprite.visible = true;
    puff.sprite.position.set(
      x + (Math.random() - 0.5) * 1.4,
      y + 0.35,
      z + (Math.random() - 0.5) * 1.4
    );
    puff.sprite.scale.setScalar(puff.baseScale);
    puff.sprite.material.opacity = 0.62;
    puff.vel.set(
      (Math.random() - 0.5) * spread,
      0.35 + Math.random() * 0.65,
      (Math.random() - 0.5) * spread
    );
  }

  private rebuildFinalVisual(): void {
    const dustSprites = new Set(this.surfaceDustPool.map((d) => d.sprite));
    for (let i = this.finalGroup.children.length - 1; i >= 0; i--) {
      const child = this.finalGroup.children[i];
      if (!dustSprites.has(child as THREE.Sprite)) {
        this.finalGroup.remove(child);
      }
    }
    this.surfaceDustPool.forEach((d) => {
      d.active = false;
      d.sprite.visible = false;
    });
    this.finalRadarDish = null;
    this.finalCloudsMesh = null;

    const worldId = this.targetWorldId;
    const dustTint =
      worldId === 'mars' || worldId === 'colony'
        ? 0xfdba74
        : worldId === 'jupiter'
        ? 0xe0f2fe
        : 0xcbd5e1;
    this.surfaceDustPool.forEach((d) => d.sprite.material.color.setHex(dustTint));

    this.surfaceTerrainMesh = null;
    this.surfaceObstacles = generateWorldObstacles(worldId);

    if (worldId === 'earth') {
      const earth = new THREE.Mesh(
        new THREE.SphereGeometry(24, 72, 56),
        new THREE.MeshStandardMaterial({
          map: this.earthPBR.map,
          normalMap: this.earthPBR.normalMap,
          normalScale: new THREE.Vector2(1.2, 1.2),
          roughnessMap: this.earthPBR.roughnessMap,
          roughness: 0.72,
        })
      );
      earth.position.set(0, -25.2, -3);
      this.finalGroup.add(earth);

      if (this.earthPBR.cloudsMap) {
        const clouds = new THREE.Mesh(
          new THREE.SphereGeometry(24.28, 64, 48),
          new THREE.MeshStandardMaterial({
            map: this.earthPBR.cloudsMap,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
          })
        );
        clouds.position.copy(earth.position);
        this.finalCloudsMesh = clouds;
        this.finalGroup.add(clouds);
      }

      const atmo = createAtmosphereMesh(24.95, 0x38bdf8, 0.48, 3.4);
      atmo.position.copy(earth.position);
      this.finalGroup.add(atmo);

      const deck = new THREE.Mesh(
        new THREE.CylinderGeometry(16, 17, 0.36, 48),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.58, metalness: 0.65 })
      );
      deck.position.y = 0;
      deck.receiveShadow = true;
      this.finalGroup.add(deck);
      this.surfaceTerrainMesh = deck;

      const padCircle = new THREE.Mesh(
        new THREE.RingGeometry(3.5, 3.9, 48),
        new THREE.MeshBasicMaterial({ color: 0xd97706, side: THREE.DoubleSide })
      );
      padCircle.rotation.x = -Math.PI / 2;
      padCircle.position.y = 0.19;
      this.finalGroup.add(padCircle);
    } else {
      const terrain = this.createPlanetaryTerrain(worldId);
      this.finalGroup.add(terrain);
      this.surfaceTerrainMesh = terrain;

      if (worldId === 'moon') {
        const distantEarth = new THREE.Mesh(
          new THREE.SphereGeometry(2.8, 40, 32),
          new THREE.MeshStandardMaterial({
            map: this.earthPBR.map,
            roughnessMap: this.earthPBR.roughnessMap,
            roughness: 0.72,
          })
        );
        distantEarth.position.set(-15, 15, -48);
        distantEarth.add(createAtmosphereMesh(2.94, 0x38bdf8, 0.45, 3.2));
        this.finalGroup.add(distantEarth);
      }

      if (worldId === 'jupiter') {
        const giantJupiter = new THREE.Mesh(
          new THREE.SphereGeometry(17.5, 64, 48),
          new THREE.MeshStandardMaterial({
            map: this.jupiterPBR.map,
            normalMap: this.jupiterPBR.normalMap,
            roughness: 0.72,
          })
        );
        giantJupiter.position.set(-14, 17, -44);
        giantJupiter.add(createAtmosphereMesh(18.15, 0xfbbf24, 0.36, 3.0));
        this.finalGroup.add(giantJupiter);
      }

      if (worldId === 'colony') {
        const colony = buildColonyStructures(this.spacecraftAssets.solar);
        colony.root.position.set(-8.5, 0, -5.5);
        this.finalRadarDish = colony.radarDish;
        this.finalGroup.add(colony.root);
      }
    }

    this.buildSurfaceObstacleMeshes(worldId);

    // Persistent Regolith Wheel Track InstancedMesh (up to 380 tire tread imprints)
    const trackGeo = new THREE.PlaneGeometry(0.16, 0.28);
    trackGeo.rotateX(-Math.PI / 2);
    const trackMat = new THREE.MeshBasicMaterial({
      color: worldId === 'mars' || worldId === 'colony' ? 0x431407 : worldId === 'jupiter' ? 0x38bdf8 : 0x1e293b,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.wheelTrackMesh = new THREE.InstancedMesh(trackGeo, trackMat, 380);
    this.wheelTrackMesh.count = 0;
    this.wheelTrackCount = 0;
    this.finalGroup.add(this.wheelTrackMesh);

    // ChemCam Pulsed Laser Spectrometer Beam + Spark Glow
    const laserPts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 1)];
    this.chemCamBeamLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(laserPts),
      new THREE.LineBasicMaterial({
        color: 0xf43f5e,
        transparent: true,
        opacity: 0.95,
      })
    );
    this.chemCamBeamLine.visible = false;
    this.finalGroup.add(this.chemCamBeamLine);

    this.chemCamSparkSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xfb7185,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.chemCamSparkSprite.scale.setScalar(0.85);
    this.chemCamSparkSprite.visible = false;
    this.finalGroup.add(this.chemCamSparkSprite);

    const navPts: THREE.Vector3[] = [];
    for (let i = 0; i < 160; i++) navPts.push(new THREE.Vector3());
    this.roverNavLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(navPts),
      new THREE.LineDashedMaterial({ color: 0x22d3ee, dashSize: 0.65, gapSize: 0.35 })
    );
    this.roverNavLine.visible = false;
    this.finalGroup.add(this.roverNavLine);

    this.roverTargetBeacon = new THREE.Group();
    const targetRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.66, 32),
      new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide, transparent: true, opacity: 0.92 })
    );
    targetRing.rotation.x = -Math.PI / 2;
    this.roverTargetBeacon.add(targetRing);

    const targetPin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 1.3, 12),
      new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.85 })
    );
    targetPin.position.y = 0.65;
    this.roverTargetBeacon.add(targetPin);

    const targetOrb = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x6ee7b7 })
    );
    targetOrb.position.y = 1.32;
    this.roverTargetBeacon.add(targetOrb);
    this.roverTargetBeacon.visible = false;
    this.finalGroup.add(this.roverTargetBeacon);

    this.landingVehicle = buildDropSpaceship(this.spacecraftAssets, this.currentConfig);
    this.finalGroup.add(this.landingVehicle.root);

    // Starship Raptor Plume Thermal Ground Scorch Decal
    const scorchCanvas = document.createElement('canvas');
    scorchCanvas.width = 256;
    scorchCanvas.height = 256;
    const sCtx = scorchCanvas.getContext('2d');
    if (sCtx) {
      const grad = sCtx.createRadialGradient(128, 128, 6, 128, 128, 124);
      grad.addColorStop(0.0, 'rgba(251, 146, 60, 0.85)');
      grad.addColorStop(0.22, 'rgba(15, 23, 42, 0.92)');
      grad.addColorStop(0.58, 'rgba(2, 6, 23, 0.68)');
      grad.addColorStop(1.0, 'rgba(2, 6, 23, 0.0)');
      sCtx.fillStyle = grad;
      sCtx.fillRect(0, 0, 256, 256);
    }
    const scorchTex = new THREE.CanvasTexture(scorchCanvas);
    scorchTex.colorSpace = THREE.SRGBColorSpace;
    const scorchGeo = new THREE.PlaneGeometry(5.6, 5.6);
    scorchGeo.rotateX(-Math.PI / 2);
    this.landerScorchMesh = new THREE.Mesh(
      scorchGeo,
      new THREE.MeshBasicMaterial({
        map: scorchTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      })
    );
    const padCenterY = this.getTerrainHeightAt(worldId, 0, 0);
    this.landerScorchMesh.position.set(0, padCenterY + 0.03, 0);
    this.finalGroup.add(this.landerScorchMesh);

    this.roverVehicle = buildRoverVehicle(this.spacecraftAssets);
    this.roverVehicle.headlightGroup.visible = this.roverHeadlightsOn;
    this.finalGroup.add(this.roverVehicle.root);

    this.collectedSamples = [];
    this.lastSpectroReadout = null;
    this.chemCamScanTimer = 0;
    this.chemCamActiveTarget = null;
    this.pendingScanObstacleId = null;
    this.autonomousMissionActive = false;
    this.roverBattery = 100.0;
    this.roverMaxBattery = 100.0;
    this.roverTotalDistanceM = 0.0;
    this.spectrometerSummary = 'Analiz bekleniyor...';
    this.systemLog = 'Sistem aktif. Yüzeye tıklayın veya Görev Başlatın.';

    this.resetSurfaceSequence();
    this.pushScienceTelemetry(true);
  }

  private buildSurfaceObstacleMeshes(worldId: WorldId): void {
    const pbr =
      worldId === 'moon'
        ? this.moonPBR
        : worldId === 'mars'
        ? this.marsPBR
        : worldId === 'jupiter'
        ? this.europaPBR
        : worldId === 'asteroid'
        ? this.asteroidPBR
        : this.proximaPBR;

    const rockMat = new THREE.MeshStandardMaterial({
      map: pbr.map,
      normalMap: pbr.normalMap ?? null,
      roughness: worldId === 'jupiter' ? 0.34 : 0.88,
      metalness: worldId === 'asteroid' ? 0.35 : 0.06,
    });

    const iceMat = new THREE.MeshPhysicalMaterial({
      color: 0xbfe7ff,
      roughness: 0.16,
      metalness: 0.12,
      clearcoat: 0.85,
      transparent: true,
      opacity: 0.9,
    });

    const looseRockMat = new THREE.MeshStandardMaterial({
      map: pbr.map,
      color: 0xf59e0b,
      roughness: 0.55,
      metalness: 0.32,
      emissive: 0x78350f,
      emissiveIntensity: 0.18,
    });

    const deckPropMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.42,
      metalness: 0.72,
    });

    const hazardAmberMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });

    const rockGeo = new THREE.IcosahedronGeometry(0.92, 2);
    const rPos = rockGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < rPos.count; i++) {
      const vx = rPos.getX(i);
      const vy = rPos.getY(i);
      const vz = rPos.getZ(i);
      const d = 0.76 + fbm3(vx * 2.6, vy * 2.6, vz * 2.6, 3, 44) * 0.46;
      rPos.setXYZ(i, vx * d, vy * d, vz * d);
    }
    rockGeo.computeVertexNormals();

    for (const obs of this.surfaceObstacles) {
      if (obs.kind === 'lander' || obs.kind === 'colony') continue;

      const gy = this.getTerrainHeightAt(worldId, obs.x, obs.z);

      if (obs.kind === 'pit') {
        const pitGroup = new THREE.Group();
        const pitSpec = getWorldCraters(worldId).find(
          (c) => c.isDeepPit && Math.hypot(c.x - obs.x, c.z - obs.z) < 0.5
        );
        const rimR = pitSpec ? pitSpec.radius : obs.radius;
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          const rx = obs.x + Math.cos(a) * rimR;
          const rz = obs.z + Math.sin(a) * rimR;
          const ry = this.getTerrainHeightAt(worldId, rx, rz);
          const rimRock = new THREE.Mesh(rockGeo, rockMat);
          rimRock.position.set(rx, ry + 0.12, rz);
          rimRock.scale.set(0.38, 0.28, 0.38);
          rimRock.rotation.y = a;
          rimRock.castShadow = true;
          pitGroup.add(rimRock);

          if (k % 2 === 0) {
            const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.55, 8), hazardAmberMat);
            beacon.position.set(rx, ry + 0.36, rz);
            pitGroup.add(beacon);
          }
        }
        this.finalGroup.add(pitGroup);
        obs.mesh = pitGroup;
      } else if (obs.kind === 'deck_prop') {
        const box = new THREE.Mesh(new THREE.BoxGeometry(obs.radius * 1.45, obs.height, obs.radius * 1.45), deckPropMat);
        box.position.set(obs.x, gy + obs.height * 0.5, obs.z);
        box.castShadow = true;
        box.receiveShadow = true;
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(obs.radius * 1.48, 0.1, obs.radius * 1.48), hazardAmberMat);
        stripe.position.y = obs.height * 0.32;
        box.add(stripe);
        this.finalGroup.add(box);
        obs.mesh = box;
      } else if (obs.kind === 'ice_spire') {
        const spire = new THREE.Mesh(new THREE.ConeGeometry(obs.radius * 0.85, obs.height, 6), iceMat);
        spire.position.set(obs.x, gy + obs.height * 0.44, obs.z);
        spire.rotation.y = obs.id * 0.9;
        spire.castShadow = true;
        this.finalGroup.add(spire);
        obs.mesh = spire;
      } else if (obs.kind === 'loose_rock') {
        const rock = new THREE.Mesh(rockGeo, looseRockMat);
        rock.position.set(obs.x, gy + obs.radius * 0.58, obs.z);
        rock.scale.setScalar(obs.radius * 1.05);
        rock.rotation.set(obs.id * 0.4, obs.id * 1.2, 0);
        rock.castShadow = true;
        rock.receiveShadow = true;
        this.finalGroup.add(rock);
        obs.mesh = rock;
      } else {
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.position.set(obs.x, gy + obs.radius * 0.42, obs.z);
        rock.scale.set(obs.radius * 1.05, obs.height * 0.82, obs.radius * 0.96);
        rock.rotation.set(obs.id * 0.3, obs.id * 1.3, 0);
        rock.castShadow = true;
        rock.receiveShadow = true;
        this.finalGroup.add(rock);
        obs.mesh = rock;
      }

      if (obs.isScienceTarget) {
        const sciGroup = new THREE.Group();
        sciGroup.position.set(obs.x, gy + 0.08, obs.z);
        const sciRing = new THREE.Mesh(
          new THREE.RingGeometry(obs.radius + 0.18, obs.radius + 0.34, 28),
          new THREE.MeshBasicMaterial({
            color: 0x22d3ee,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
          })
        );
        sciRing.rotation.x = -Math.PI / 2;
        sciGroup.add(sciRing);

        const sciDiamond = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.16, 0),
          new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
        );
        sciDiamond.position.y = obs.height + 0.55;
        sciGroup.add(sciDiamond);

        this.finalGroup.add(sciGroup);
        obs.beaconGroup = sciGroup;
      }
    }
  }

  private stampRoverWheelTracks(): void {
    if (!this.wheelTrackMesh) return;
    const dist = Math.hypot(
      this.roverPos.x - this.lastWheelTrackPos.x,
      this.roverPos.z - this.lastWheelTrackPos.y
    );
    if (dist < 0.28) return;
    this.lastWheelTrackPos.set(this.roverPos.x, this.roverPos.z);

    const cosH = Math.cos(this.roverHeading);
    const sinH = Math.sin(this.roverHeading);
    const lateralOffsets = [-0.25, 0.25];

    for (const lat of lateralOffsets) {
      const idx = this.wheelTrackCount % 380;
      const wx = this.roverPos.x + cosH * lat - sinH * 0.12;
      const wz = this.roverPos.z - sinH * lat - cosH * 0.12;
      const wy = this.getTerrainHeightAt(this.targetWorldId, wx, wz) + 0.025;

      _v1.set(wx, wy, wz);
      _euler.set(0, this.roverHeading, 0);
      _quat.setFromEuler(_euler);
      _scale.set(1, 1, 1);
      _mat4.compose(_v1, _quat, _scale);
      this.wheelTrackMesh.setMatrixAt(idx, _mat4);
      this.wheelTrackCount++;
    }
    this.wheelTrackMesh.count = Math.min(380, this.wheelTrackCount);
    this.wheelTrackMesh.instanceMatrix.needsUpdate = true;
  }

  public setOrbitTimeWarp(warp: OrbitTimeWarp): void {
    this.orbitTimeWarp = warp;
    this.pushOrbitTelemetry(true);
  }

  public setManualThrottle(pct: number | null): void {
    this.manualThrottlePct = pct === null ? null : THREE.MathUtils.clamp(pct, 0, 140);
  }

  public setSurfaceCameraMode(mode: SurfaceCameraMode): void {
    this.surfaceCameraMode = mode;
    this.userOrbiting = false;
    this.callbacks.onCameraModeChange?.(mode);
  }

  public toggleRoverHeadlights(): boolean {
    this.roverHeadlightsOn = !this.roverHeadlightsOn;
    if (this.roverVehicle) {
      this.roverVehicle.headlightGroup.visible = this.roverHeadlightsOn;
    }
    return this.roverHeadlightsOn;
  }

  private getNearestScannableObstacle(maxRangeUnits = 6.5): SurfaceObstacle | null {
    let best: SurfaceObstacle | null = null;
    let bestScore = Infinity;
    for (const obs of this.surfaceObstacles) {
      if (obs.kind === 'lander' || obs.kind === 'colony' || obs.kind === 'pit') continue;
      const d = Math.hypot(obs.x - this.roverPos.x, obs.z - this.roverPos.z);
      if (d > maxRangeUnits) continue;
      // Prioritize unscanned primary science targets, then unscanned rocks, then closest rock
      const priorityPenalty = obs.scanned ? 18 : obs.isScienceTarget ? -6 : 0;
      const score = d + priorityPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = obs;
      }
    }
    return best;
  }

  private generateOxideBreakdown(obs: SurfaceObstacle): string {
    const seed = (obs.id * 97 + this.targetWorldId.charCodeAt(0) * 31) % 100;
    const n1 = (seed % 17) * 0.45;
    const n2 = ((seed * 3) % 13) * 0.42;
    const n3 = ((seed * 7) % 11) * 0.38;

    if (this.targetWorldId === 'mars' || this.targetWorldId === 'colony') {
      const sio2 = (41.2 + n1).toFixed(1);
      const fe2o3 = (18.4 + n2).toFixed(1);
      const al2o3 = (11.6 + n3).toFixed(1);
      const rem = Math.max(4, 100 - parseFloat(sio2) - parseFloat(fe2o3) - parseFloat(al2o3)).toFixed(1);
      return `%${sio2} SiO₂, %${fe2o3} Fe₂O₃, %${al2o3} Al₂O₃, %${rem} Diğer`;
    }
    if (this.targetWorldId === 'jupiter') {
      const h2o = (64.0 + n1).toFixed(1);
      const mgso4 = (19.2 + n2).toFixed(1);
      const na2co3 = (8.4 + n3 * 0.6).toFixed(1);
      const rem = Math.max(2, 100 - parseFloat(h2o) - parseFloat(mgso4) - parseFloat(na2co3)).toFixed(1);
      return `%${h2o} H₂O Buz, %${mgso4} MgSO₄, %${na2co3} Na₂CO₃, %${rem} Diğer`;
    }
    // Lunar / Asteroid / Earth anorthositic-basaltic breakdown matching user's project
    const compSiO2 = (40.5 + n1).toFixed(1);
    const compAl2O3 = (20.8 + n2).toFixed(1);
    const compCaO = (11.2 + n3).toFixed(1);
    const remainder = Math.max(
      4,
      100 - parseFloat(compSiO2) - parseFloat(compAl2O3) - parseFloat(compCaO)
    ).toFixed(1);
    return `%${compSiO2} SiO₂, %${compAl2O3} Al₂O₃, %${compCaO} CaO, %${remainder} Diğer`;
  }

  public startAutonomousRoverMission(): void {
    if (this.surfacePhase !== 'rover_active') {
      this.skipToRoverActive();
    }
    // If all primary targets were already scanned, reset them so a fresh mission can run
    const unscannedPrimary = this.surfaceObstacles.filter((o) => o.isScienceTarget && !o.scanned);
    if (unscannedPrimary.length === 0) {
      for (const o of this.surfaceObstacles) {
        if (o.isScienceTarget) o.scanned = false;
      }
      this.collectedSamples = [];
    }

    this.autonomousMissionActive = true;
    this.roverDriveInput.autoRoam = false;
    this.roverBattery = this.roverMaxBattery;
    const remainingCount = this.surfaceObstacles.filter((o) => o.isScienceTarget && !o.scanned).length;
    this.systemLog = `Görev Başladı: ${remainingCount} Örnek Otonom Toplanacak.`;
    this.planNextAutonomousTarget();
    this.pushScienceTelemetry(true);
  }

  public resetRoverState(): void {
    this.autonomousMissionActive = false;
    this.pendingScanObstacleId = null;
    this.chemCamActiveTarget = null;
    this.chemCamScanTimer = 0;
    if (this.chemCamBeamLine) this.chemCamBeamLine.visible = false;
    if (this.chemCamSparkSprite) this.chemCamSparkSprite.visible = false;
    this.roverDriveInput = { forward: 0, turn: 0, autoRoam: false };
    this.clearRoverNavigation();
    this.roverBattery = this.roverMaxBattery;
    this.roverTotalDistanceM = 0;

    if (this.surfacePhase === 'rover_active' && this.roverVehicle) {
      const startY = this.getTerrainHeightAt(this.targetWorldId, 0, 4.2);
      this.roverPos.set(0, startY, 4.2);
      this.roverHeading = 0;
      this.roverVehicle.root.visible = true;
      this.roverVehicle.root.scale.setScalar(1.0);
      this.roverVehicle.root.position.copy(this.roverPos);
      this.roverVehicle.root.rotation.set(0, 0, 0);
    }
    this.systemLog = 'Sistem Sıfırlandı. Serbest sürüş aktif.';
    this.pushScienceTelemetry(true);
  }

  private planNextAutonomousTarget(): void {
    if (!this.autonomousMissionActive) return;
    const remaining = this.surfaceObstacles.filter((o) => o.isScienceTarget && !o.scanned);
    if (remaining.length === 0) {
      this.autonomousMissionActive = false;
      this.systemLog = 'GÖREV BAŞARIYLA TAMAMLANDI!';
      this.pushScienceTelemetry(true);
      return;
    }

    // Pick closest unscanned primary science target
    let closest = remaining[0];
    let minDist = Infinity;
    for (const t of remaining) {
      const d = Math.hypot(t.x - this.roverPos.x, t.z - this.roverPos.z);
      if (d < minDist) {
        minDist = d;
        closest = t;
      }
    }

    this.pendingScanObstacleId = closest.id;
    const angle = Math.atan2(this.roverPos.x - closest.x, this.roverPos.z - closest.z);
    const stopR = closest.radius + ROVER_COLLISION_RADIUS + 0.85;
    this.plotShortestRoverRoute(
      closest.x + Math.sin(angle) * stopR,
      closest.z + Math.cos(angle) * stopR
    );
    this.systemLog = `Otonom Rota: ${closest.label} (${(minDist * SURFACE_METERS_PER_UNIT).toFixed(1)} m)`;
    this.pushScienceTelemetry(true);
  }

  public triggerChemCamScan(obstacleId?: number): void {
    if (this.surfacePhase !== 'rover_active') return;
    let target: SurfaceObstacle | null = null;
    if (obstacleId !== undefined) {
      target = this.surfaceObstacles.find((o) => o.id === obstacleId) ?? null;
    } else {
      target = this.getNearestScannableObstacle(6.8);
    }
    if (!target) {
      this.currentObstacleNotice = 'No rock specimen within 13 m ChemCam range';
      this.systemLog = 'Menzilde (13 m) analiz edilecek kaya bulunamadı.';
      this.obstacleNoticeTimer = 2.2;
      this.pushRoverNavTelemetry(true);
      this.pushScienceTelemetry(true);
      return;
    }
    const dist = Math.hypot(target.x - this.roverPos.x, target.z - this.roverPos.z);
    if (dist > 6.8) {
      this.pendingScanObstacleId = target.id;
      const angle = Math.atan2(this.roverPos.x - target.x, this.roverPos.z - target.z);
      const stopR = target.radius + ROVER_COLLISION_RADIUS + 0.9;
      this.plotShortestRoverRoute(
        target.x + Math.sin(angle) * stopR,
        target.z + Math.cos(angle) * stopR
      );
      this.currentObstacleNotice = `Driving to ${target.label} for ChemCam Scan...`;
      this.systemLog = `Rota Onaylandı: ${target.label} hedefine ilerleniyor...`;
      this.obstacleNoticeTimer = 2.4;
      this.pushRoverNavTelemetry(true);
      this.pushScienceTelemetry(true);
      return;
    }

    this.chemCamActiveTarget = target;
    this.chemCamScanTimer = 1.15;
    this.pendingScanObstacleId = null;
    this.systemLog = `Örnek Analiz Ediliyor: ${target.label}...`;
    missionAudio.playLaserPulse();
    this.pushScienceTelemetry(true);
  }

  private pushScienceTelemetry(force = false): void {
    if (!this.callbacks.onScienceUpdate) return;
    const now = performance.now();
    if (!force && now - this.lastScienceUiPush < 95) return;
    this.lastScienceUiPush = now;

    const totalTargets = this.surfaceObstacles.filter((o) => o.isScienceTarget).length;
    const primaryCollected = this.surfaceObstacles.filter((o) => o.isScienceTarget && o.scanned).length;
    const nearTarget = this.getNearestScannableObstacle(6.5);

    const isMoving =
      this.roverDriveInput.forward !== 0 ||
      this.roverDriveInput.turn !== 0 ||
      this.roverDriveInput.autoRoam ||
      this.roverWaypointIdx < this.roverPathWaypoints.length;

    const roverStatus: ScienceMissionState['roverStatus'] =
      this.roverBattery <= 0.05
        ? 'GÜÇ TÜKENDİ!'
        : this.chemCamScanTimer > 0
        ? 'ANALİZ YAPILIYOR'
        : isMoving
        ? 'HAREKET HALİNDE'
        : 'BEKLİYOR / ŞARJ OLUYOR';

    const radarTargets = this.surfaceObstacles
      .filter((o) => o.kind !== 'lander' && o.kind !== 'colony' && o.kind !== 'pit')
      .map((o) => ({
        id: o.id,
        x: o.x,
        z: o.z,
        scanned: Boolean(o.scanned),
        isPrimary: Boolean(o.isScienceTarget),
      }));

    const radarCraters = getWorldCraters(this.targetWorldId).map((c) => ({
      x: c.x,
      z: c.z,
      radius: c.radius,
      depth: c.depth,
    }));

    const radarRoute: { x: number; z: number }[] = [];
    if (this.roverWaypointIdx < this.roverPathWaypoints.length) {
      radarRoute.push({ x: this.roverPos.x, z: this.roverPos.z });
      for (let i = this.roverWaypointIdx; i < this.roverPathWaypoints.length; i++) {
        radarRoute.push({
          x: this.roverPathWaypoints[i].x,
          z: this.roverPathWaypoints[i].y,
        });
      }
    }

    this.callbacks.onScienceUpdate({
      totalTargets,
      collectedCount: primaryCollected,
      samples: [...this.collectedSamples],
      activeScanLabel: this.chemCamActiveTarget
        ? this.chemCamActiveTarget.label
        : nearTarget
        ? `${nearTarget.label} (${(Math.hypot(nearTarget.x - this.roverPos.x, nearTarget.z - this.roverPos.z) * SURFACE_METERS_PER_UNIT).toFixed(1)} m)`
        : null,
      scanningProgress:
        this.chemCamScanTimer > 0
          ? Math.round(THREE.MathUtils.clamp(1 - this.chemCamScanTimer / 1.15, 0, 1) * 100)
          : 0,
      missionComplete: totalTargets > 0 && primaryCollected >= totalTargets,
      lastSpectroReadout: this.lastSpectroReadout,
      autonomousMissionActive: this.autonomousMissionActive,
      roverStatus,
      batteryPct: Number(Math.max(0, this.roverBattery).toFixed(1)),
      maxBattery: this.roverMaxBattery,
      totalDistanceM: Number(this.roverTotalDistanceM.toFixed(1)),
      sensorTempC: Number(this.sensorTempC.toFixed(1)),
      sensorRadUsv: Number(this.sensorRadUsv.toFixed(1)),
      sensorSlopeDeg: Number(this.sensorSlopeDeg.toFixed(1)),
      sensorIrReflectance: Number(this.sensorIrReflectance.toFixed(2)),
      sensorCameraStatus: this.sensorCameraStatus,
      spectrometerSummary: this.spectrometerSummary,
      systemLog: this.systemLog,
      roverX: this.roverPos.x,
      roverZ: this.roverPos.z,
      roverHeading: this.roverHeading,
      maxMapRadius: this.targetWorldId === 'earth' ? 16 : 45,
      radarTargets,
      radarCraters,
      radarRoute,
    });
  }

  public replaySurfaceSequence(): void {
    this.resetSurfaceSequence();
  }

  public skipToRoverActive(): void {
    if (!this.landingVehicle || !this.roverVehicle) return;
    const groundY = this.getTerrainHeightAt(this.targetWorldId, 0, 0);
    this.userOrbiting = false;
    this.landerY = groundY;
    this.landerVelY = 0;
    this.landerCompression = 0.06;
    this.landerCompressionVel = 0;
    this.landerFlameFade = 0;
    this.landerScorchIntensity = 0.85;
    if (this.landerScorchMesh) {
      (this.landerScorchMesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
    }
    this.rampAngle = 1.90;
    this.landingVehicle.root.position.set(0, groundY, 0);
    this.landingVehicle.bodyGroup.position.y = -this.landerCompression;
    this.landingVehicle.bodyGroup.rotation.set(0, 0, 0);
    this.landingVehicle.legsGroup.rotation.set(0, 0, 0);
    this.landingVehicle.legsGroup.visible = true;
    this.landingVehicle.fwdFlaps.forEach((f) => (f.rotation.z = 0));
    this.landingVehicle.aftFlaps.forEach((f) => (f.rotation.z = 0));
    for (const leg of this.landingVehicle.legRigs) {
      leg.upperPivot.position.y = 0.68 - this.landerCompression;
      leg.upperPivot.rotation.z = 0.56 + this.landerCompression * 0.65;
      leg.lowerPivot.rotation.z = 0.56 + this.landerCompression * 0.65;
    }
    this.landingVehicle.flameGroup.visible = false;
    this.landingVehicle.rampPivot.rotation.x = this.rampAngle;
    this.landingVehicle.bayLight.intensity = 2.5;

    this.roverPos.set(0, this.getTerrainHeightAt(this.targetWorldId, 0, 4.2), 4.2);
    this.roverHeading = 0;
    this.lastWheelTrackPos.set(this.roverPos.x, this.roverPos.z);
    this.roverVehicle.root.visible = true;
    this.roverVehicle.root.scale.setScalar(1.0);
    this.roverVehicle.root.position.copy(this.roverPos);
    this.roverVehicle.root.rotation.set(0, 0, 0);
    this.clearRoverNavigation();

    this.surfacePhase = 'rover_active';
    this.surfaceTimer = 0;
    this.callbacks.onSurfacePhaseChange('rover_active');
    const gSurf = WORLDS[this.targetWorldId].surfaceGravity;
    this.callbacks.onSurfaceTelemetry?.({
      altitudeM: 0,
      verticalSpeedMs: 0,
      surfaceGravityMs2: gSurf,
      maneuverLabel: 'LANDED & SECURED',
      fuelPct: Math.round(this.landerFuelPct),
      manualThrottlePct: this.manualThrottlePct,
      pitchDeg: 0,
      mach: 0,
      dynamicPressureKpa: 0,
      gLoad: Number((gSurf / 9.80665).toFixed(2)),
    });
    this.cameraFocusTarget = new THREE.Vector3(0, groundY + 1.8, 2.4);
    this.cameraFocusPos = new THREE.Vector3(6.8, groundY + 4.2, 12.6);
    this.pushScienceTelemetry();
  }

  private resetSurfaceSequence(): void {
    if (!this.landingVehicle || !this.roverVehicle) return;
    const world = WORLDS[this.targetWorldId];
    const hasAtmo = world.hasAtmosphere;
    const groundY = this.getTerrainHeightAt(this.targetWorldId, 0, 0);
    this.userOrbiting = false;
    this.surfacePhase = 'descending';
    this.surfaceTimer = 0;
    this.landerY = groundY + 75.0; // 150 m approach altitude (1u = 2.0m)
    this.landerVelY = -9.5; // -19.0 m/s initial descent rate
    this.landerCompression = 0;
    this.landerCompressionVel = 0;
    this.landerFlameFade = 1;
    this.landerScorchIntensity = 0;
    if (this.landerScorchMesh) {
      (this.landerScorchMesh.material as THREE.MeshBasicMaterial).opacity = 0;
    }
    this.landerFuelPct = 100;
    this.flipBurnIgnited = !hasAtmo;
    this.rampAngle = 0;
    this.roverHeading = 0;
    this.roverBumpTimer = 0;
    this.currentObstacleNotice = null;
    this.roverDriveInput = { forward: 0, turn: 0, autoRoam: false };
    this.clearRoverNavigation();

    const initialPitch = hasAtmo ? 1.28 : 0.24; // 73° Belly-Flop on atmospheric worlds vs. 14° HLS Powered Descent on airless worlds
    this.landingVehicle.root.position.set(0, this.landerY, 0);
    this.landingVehicle.bodyGroup.position.y = 0;
    this.landingVehicle.bodyGroup.rotation.set(initialPitch, 0, 0);
    this.landingVehicle.legsGroup.rotation.set(initialPitch, 0, 0);
    this.landingVehicle.legsGroup.visible = false;
    this.landingVehicle.fwdFlaps.forEach((f) => (f.rotation.z = 0));
    this.landingVehicle.aftFlaps.forEach((f) => (f.rotation.z = 0));
    for (const leg of this.landingVehicle.legRigs) {
      leg.upperPivot.position.y = 0.68;
      leg.upperPivot.rotation.z = 0.56;
      leg.lowerPivot.rotation.z = 0.56;
    }
    this.landingVehicle.flameGroup.visible = !hasAtmo;
    this.landingVehicle.rampPivot.rotation.x = 0;
    this.landingVehicle.bayLight.intensity = 0;

    this.roverPos.set(0, this.landerY + 0.48, -0.05);
    this.lastWheelTrackPos.set(0, -0.05);
    this.roverVehicle.root.visible = false; // Enclosed behind closed Starship cargo door during descent
    this.roverVehicle.root.scale.setScalar(1.0);
    this.roverVehicle.root.position.copy(this.roverPos);
    this.roverVehicle.root.rotation.set(0, 0, 0);

    // Immediately lock camera onto the high-altitude SpaceX Starship on Frame 0 so it is never out of view
    this.controls.target.set(0, this.landerY + 2.4, 0);
    this.camera.position.set(14.5, this.landerY + 4.8, 24.5);
    this.controls.update();
    this.cameraFocusTarget = null;
    this.cameraFocusPos = null;

    this.callbacks.onSurfacePhaseChange('descending');
    this.callbacks.onSurfaceTelemetry?.({
      altitudeM: Math.round(75 * SURFACE_METERS_PER_UNIT),
      verticalSpeedMs: Number((9.5 * SURFACE_METERS_PER_UNIT).toFixed(1)),
      surfaceGravityMs2: world.surfaceGravity,
      maneuverLabel: hasAtmo ? 'BELLY FLOP SKYDIVE' : 'HLS POWERED DESCENT',
      fuelPct: 100,
      manualThrottlePct: this.manualThrottlePct,
      pitchDeg: Math.round(THREE.MathUtils.radToDeg(initialPitch)),
      mach: hasAtmo ? 0.08 : 0,
      dynamicPressureKpa: hasAtmo ? 0.42 : 0,
      gLoad: Number(((world.surfaceGravity * (hasAtmo ? 1.0 : 1.65)) / 9.80665).toFixed(2)),
    });
  }

  public clearRoverNavigation(): void {
    this.roverPathWaypoints = [];
    this.roverWaypointIdx = 0;
    if (this.roverNavLine) this.roverNavLine.visible = false;
    if (this.roverTargetBeacon) this.roverTargetBeacon.visible = false;
    this.pushRoverNavTelemetry(true);
  }

  private pushRoverNavTelemetry(force = false): void {
    if (!this.callbacks.onRoverNavUpdate) return;
    const now = performance.now();
    if (!force && now - this.lastRoverNavPush < 90) return;
    this.lastRoverNavPush = now;

    const active = this.roverWaypointIdx < this.roverPathWaypoints.length;
    let dist = 0;
    let targetX: number | null = null;
    let targetZ: number | null = null;
    if (active) {
      let prevX = this.roverPos.x;
      let prevZ = this.roverPos.z;
      for (let i = this.roverWaypointIdx; i < this.roverPathWaypoints.length; i++) {
        const wp = this.roverPathWaypoints[i];
        dist += Math.hypot(wp.x - prevX, wp.y - prevZ);
        prevX = wp.x;
        prevZ = wp.y;
      }
      const last = this.roverPathWaypoints[this.roverPathWaypoints.length - 1];
      targetX = last.x;
      targetZ = last.y;
    }

    this.callbacks.onRoverNavUpdate({
      active,
      targetX,
      targetZ,
      distanceM: Number((dist * SURFACE_METERS_PER_UNIT).toFixed(1)),
      obstacleNotice: this.currentObstacleNotice,
    });
  }

  private updateRoverNavLineMesh(): void {
    if (!this.roverNavLine || this.roverWaypointIdx >= this.roverPathWaypoints.length) {
      if (this.roverNavLine) this.roverNavLine.visible = false;
      return;
    }

    const pts: THREE.Vector3[] = [];
    let prevX = this.roverPos.x;
    let prevZ = this.roverPos.z;
    for (let i = this.roverWaypointIdx; i < this.roverPathWaypoints.length; i++) {
      const wp = this.roverPathWaypoints[i];
      const segDist = Math.hypot(wp.x - prevX, wp.y - prevZ);
      const steps = Math.max(1, Math.ceil(segDist / 0.65));
      for (let s = i === this.roverWaypointIdx ? 0 : 1; s <= steps; s++) {
        const t = s / steps;
        const px = prevX + (wp.x - prevX) * t;
        const pz = prevZ + (wp.y - prevZ) * t;
        pts.push(new THREE.Vector3(px, this.getTerrainHeightAt(this.targetWorldId, px, pz) + 0.14, pz));
      }
      prevX = wp.x;
      prevZ = wp.y;
    }

    const maxVerts = 160;
    const linePos = this.roverNavLine.geometry.attributes.position as THREE.BufferAttribute;
    const count = Math.min(maxVerts, pts.length);
    for (let i = 0; i < maxVerts; i++) {
      const src = pts[Math.min(i, Math.max(0, count - 1))] || this.roverPos;
      linePos.setXYZ(i, src.x, src.y, src.z);
    }
    linePos.needsUpdate = true;
    this.roverNavLine.geometry.setDrawRange(0, count);
    this.roverNavLine.computeLineDistances();
    this.roverNavLine.visible = count >= 2;
  }

  private plotShortestRoverRoute(goalX: number, goalZ: number): void {
    const maxR = this.targetWorldId === 'earth' ? 14.0 : 45.0;
    const path = findShortestObstacleFreePath(
      this.roverPos.x,
      this.roverPos.z,
      goalX,
      goalZ,
      this.surfaceObstacles,
      maxR
    );
    if (path.length < 2) return;

    this.roverDriveInput.autoRoam = false;
    this.roverPathWaypoints = path;
    this.roverWaypointIdx = 1;

    const finalWp = path[path.length - 1];
    const gy = this.getTerrainHeightAt(this.targetWorldId, finalWp.x, finalWp.y);
    this.roverTargetBeacon.position.set(finalWp.x, gy + 0.12, finalWp.y);
    this.roverTargetBeacon.visible = true;
    this.updateRoverNavLineMesh();
    this.pushRoverNavTelemetry(true);
  }

  public setRoverDriveInput(input: { forward?: number; turn?: number; autoRoam?: boolean }): void {
    if (input.forward !== undefined) this.roverDriveInput.forward = input.forward;
    if (input.turn !== undefined) this.roverDriveInput.turn = input.turn;
    if (input.autoRoam !== undefined) this.roverDriveInput.autoRoam = input.autoRoam;
  }

  public setStage(stage: SceneStage): void {
    this.activeStage = stage;
    this.orbitGroup.visible = stage === 'orbit_insertion';
    this.finalGroup.visible = stage === 'final_visual';

    const world = WORLDS[this.targetWorldId];
    const pbr = this.getWorldPBR(this.targetWorldId);

    if (stage === 'orbit_insertion') {
      this.userOrbiting = false;
      this.controls.enabled = true;
      this.controls.minDistance = 9;
      this.controls.maxDistance = 32;
      this.orbitPhase = 'orbiting';
      this.orbitCraftAngle = 0;
      this.orbitDescentT = 0;
      this.orbitTouchdownTimer = -1;
      this.orbitCraftFlame.visible = false;
      this.orbitPlasmaMesh.visible = false;
      this.orbitDescentLine.visible = false;

      const defaultSite = LANDING_SITES[this.targetWorldId][0];
      this.selectedSiteAngleDeg = defaultSite.angleDeg;

      const mat = this.orbitPlanetMesh.material as THREE.MeshStandardMaterial;
      mat.map = pbr.map;
      mat.normalMap = pbr.normalMap ?? null;
      mat.roughnessMap = pbr.roughnessMap ?? null;
      mat.color.setHex(0xffffff);
      mat.needsUpdate = true;

      this.orbitAtmoMesh.visible = world.hasAtmosphere || world.id === 'jupiter';
      const atmoUniforms = (this.orbitAtmoMesh.material as THREE.ShaderMaterial).uniforms;
      if (atmoUniforms?.uColor) {
        atmoUniforms.uColor.value.set(world.accentColor);
      }

      this.refreshOrbitRingGeometry(this.getVisualOrbitRadius(this.targetWorldId));
      this.refreshOrbitSiteMarkers();
      this.pushOrbitTelemetry(true);
      this.cameraFocusTarget = new THREE.Vector3(0, 0, 0);
      this.cameraFocusPos = new THREE.Vector3(0, 14.5, 17.5);
    } else if (stage === 'final_visual') {
      this.userOrbiting = false;
      this.controls.enabled = true;
      this.controls.minDistance = 3.5;
      this.controls.maxDistance = 95;
      this.rebuildFinalVisual();
    }
  }

  public selectLandingSiteAngle(angleDeg: number): void {
    this.selectedSiteAngleDeg = ((angleDeg % 360) + 360) % 360;
    this.updateSelectedSiteBeacon();
    this.pushOrbitTelemetry(true);
  }

  public armDeorbitDescent(): void {
    if (this.orbitPhase === 'descending') return;
    this.orbitPhase = 'armed';
    this.pushOrbitTelemetry(true);
  }

  public cancelDeorbitArm(): void {
    if (this.orbitPhase === 'armed') {
      this.orbitPhase = 'orbiting';
      this.pushOrbitTelemetry(true);
    }
  }

  private pushOrbitTelemetry(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastOrbitUiPush < 70) return;
    this.lastOrbitUiPush = now;

    const world = WORLDS[this.targetWorldId];
    const craftDeg = ((THREE.MathUtils.radToDeg(this.orbitCraftAngle) % 360) + 360) % 360;
    let diff = Math.abs(craftDeg - this.selectedSiteAngleDeg);
    if (diff > 180) diff = 360 - diff;
    const alignmentPct = Math.round(Math.max(0, 1 - diff / 180) * 100);

    const descentFrac = this.orbitPhase === 'descending' ? Math.min(1, this.orbitDescentT) : 0;
    const currentAltKm = Math.round(world.orbitAltitudeKm * (1 - descentFrac));
    const rCurrentKm = world.meanRadiusKm + Math.max(0, currentAltKm);
    const vCurrentKms =
      this.orbitPhase === 'descending'
        ? computeVisVivaSpeedKms(
            world.muKm3s2,
            rCurrentKm,
            (world.meanRadiusKm + world.orbitAltitudeKm + world.meanRadiusKm) * 0.5
          )
        : world.orbitMetrics.orbitalVelocityKms;

    const heatCurve = Math.sin(Math.pow(descentFrac, 0.85) * Math.PI);
    const tpsTempC =
      this.orbitPhase === 'descending'
        ? Math.round(20 + heatCurve * (world.hasAtmosphere ? 1420 : 280))
        : 20;
    const accelG =
      this.orbitPhase === 'descending'
        ? Number(((world.hasAtmosphere ? 3.4 : 1.75) * heatCurve + 0.35).toFixed(2))
        : 0;

    this.callbacks.onOrbitStateUpdate({
      craftAngleDeg: Math.round(craftDeg),
      siteAngleDeg: Math.round(this.selectedSiteAngleDeg),
      alignmentPct,
      altitudeKm: currentAltKm,
      orbitalVelocityKms: Number(vCurrentKms.toFixed(3)),
      orbitalPeriodMin: world.orbitMetrics.orbitalPeriodMin,
      deorbitBurnMs: world.orbitMetrics.deorbitBurnMs,
      phase: this.orbitPhase,
      timeWarp: this.orbitTimeWarp,
      tpsTempC,
      accelG,
    });
  }

  public focusWorld(worldId: WorldId): void {
    this.targetWorldId = worldId;
    if (this.activeStage === 'orbit_insertion') {
      this.setStage('orbit_insertion');
    } else if (this.activeStage === 'final_visual') {
      this.rebuildFinalVisual();
    }
  }

  public updateCraftConfig(config: HangarConfig, _stats: CraftStats): void {
    this.currentConfig = { ...config };
    this.rebuildOrbitCraft();
    if (this.activeStage === 'final_visual') {
      this.rebuildFinalVisual();
    }
  }

  private rebuildOrbitCraft(): void {
    if (!this.orbitCraft) return;
    if (this.orbitCraftRig) {
      this.orbitCraft.remove(this.orbitCraftRig.root);
    }
    this.orbitCraftRig = buildDropSpaceship(this.spacecraftAssets, this.currentConfig);
    this.orbitCraftRig.root.scale.setScalar(0.135);
    this.orbitCraftRig.root.position.set(0, -0.45, 0);
    this.orbitCraftRig.legsGroup.visible = false;
    this.orbitCraftRig.flameGroup.visible = false;
    this.orbitCraft.add(this.orbitCraftRig.root);
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
  }

  private handleResize = (): void => {
    if (this.disposed) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setSize(width, height);
      this.bloomPass?.setSize(width, height);
    }
  };

  private updateNDC(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private handlePointerMove = (e: PointerEvent): void => {
    const now = performance.now();
    if (now - this.lastHoverCheck < 50) return;
    this.lastHoverCheck = now;

    this.updateNDC(e);
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);

    if (this.activeStage === 'orbit_insertion') {
      const hits = this.raycaster.intersectObject(this.orbitPlanetMesh, false);
      this.renderer.domElement.style.cursor = hits.length > 0 ? 'crosshair' : 'grab';
    } else if (
      this.activeStage === 'final_visual' &&
      this.surfacePhase === 'rover_active' &&
      this.surfaceTerrainMesh
    ) {
      const hits = this.raycaster.intersectObject(this.surfaceTerrainMesh, false);
      this.renderer.domElement.style.cursor = hits.length > 0 ? 'crosshair' : 'grab';
    } else {
      this.renderer.domElement.style.cursor = 'grab';
    }
  };

  private handlePointerDown = (e: PointerEvent): void => {
    this.pointerDownPos.set(e.clientX, e.clientY);
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y) > 6) return;

    this.updateNDC(e);
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);

    if (this.activeStage === 'orbit_insertion' && this.orbitPhase !== 'descending') {
      const hits = this.raycaster.intersectObject(this.orbitPlanetMesh, false);
      if (hits.length > 0) {
        const pt = hits[0].point;
        const deg = ((THREE.MathUtils.radToDeg(Math.atan2(pt.z, pt.x)) % 360) + 360) % 360;
        missionAudio.playSnap();
        this.selectLandingSiteAngle(deg);
      }
    } else if (
      this.activeStage === 'final_visual' &&
      this.surfacePhase === 'rover_active' &&
      this.surfaceTerrainMesh
    ) {
      const hits = this.raycaster.intersectObject(this.surfaceTerrainMesh, false);
      if (hits.length > 0) {
        const pt = hits[0].point;
        missionAudio.playClick();
        if (this.autonomousMissionActive) {
          this.autonomousMissionActive = false;
          this.systemLog = 'Görev İptal Edildi. Manuel Kontrol.';
        }
        // Check if user clicked on or near a scannable science specimen/rock
        const clickedObs = this.surfaceObstacles.find(
          (o) =>
            o.kind !== 'lander' &&
            o.kind !== 'colony' &&
            o.kind !== 'pit' &&
            Math.hypot(pt.x - o.x, pt.z - o.z) <= o.radius + 1.15
        );
        if (clickedObs) {
          this.triggerChemCamScan(clickedObs.id);
        } else {
          this.pendingScanObstacleId = null;
          this.plotShortestRoverRoute(pt.x, pt.z);
          this.systemLog = 'Rota Onaylandı. İlerliyor.';
          this.pushScienceTelemetry(true);
        }
      }
    }
  };

  private tick = (): void => {
    if (this.disposed) return;

    const dt = Math.min(0.05, this.clock.getDelta());
    const elapsed = this.clock.elapsedTime;
    this.starField.rotation.y += dt * 0.003;

    if (this.activeStage === 'orbit_insertion') {
      this.updateOrbitInsertion(dt, elapsed);
    } else if (this.activeStage === 'final_visual') {
      this.updateFinalVisual(dt, elapsed);
    }

    if (this.composer && !this.isSoftwareGl) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private updateOrbitInsertion(dt: number, elapsed: number): void {
    this.orbitPlanetMesh.rotation.y += dt * 0.06;
    if (this.orbitHoloGridGroup) {
      this.orbitHoloGridGroup.rotation.y = this.orbitPlanetMesh.rotation.y;
    }
    const world = WORLDS[this.targetWorldId];
    const orbitRadius = this.getVisualOrbitRadius(this.targetWorldId);
    const planetSurfaceR = ORBIT_PLANET_RADIUS + 0.03;
    const siteRad = THREE.MathUtils.degToRad(this.selectedSiteAngleDeg);

    // Calm, physically scaled Keplerian orbital angular rate (21..42s per full revolution)
    const omegaOrbit = THREE.MathUtils.clamp(
      22 / Math.max(45, world.orbitMetrics.orbitalPeriodMin),
      0.15,
      0.30
    );

    const pulse = 1 + Math.sin(elapsed * 5.0) * 0.15;
    this.landingBeaconGroup.scale.setScalar(pulse);

    // Update orbital tracking reticle tint & billboard orientation toward camera
    if (this.orbitReticleGroup && this.orbitReticleMat) {
      const reticleHex =
        this.orbitPhase === 'descending'
          ? 0xf59e0b
          : this.orbitPhase === 'armed'
          ? 0x10b981
          : 0x22d3ee;
      this.orbitReticleMat.color.setHex(reticleHex);
      this.orbitReticleMat.opacity = 0.78 + Math.sin(elapsed * 4.0) * 0.14;
      this.orbitCraft.getWorldQuaternion(_quat);
      this.orbitReticleGroup.quaternion.copy(_quat).invert().multiply(this.camera.quaternion);
    }

    if (this.orbitPhase === 'orbiting' || this.orbitPhase === 'armed') {
      this.orbitPlasmaMesh.visible = false;
      this.orbitCraftAngle =
        (this.orbitCraftAngle + dt * omegaOrbit * this.orbitTimeWarp) % (Math.PI * 2);

      this.orbitCraft.position.set(
        Math.cos(this.orbitCraftAngle) * orbitRadius,
        0,
        Math.sin(this.orbitCraftAngle) * orbitRadius
      );

      _v1.set(-Math.sin(this.orbitCraftAngle), 0, Math.cos(this.orbitCraftAngle)).normalize();
      this.orbitCraft.quaternion.setFromUnitVectors(_upAxis, _v1);

      if (this.orbitPhase === 'armed') {
        // Compute forward angular arc from current spacecraft position to the selected landing site
        let angularDiff = siteRad - this.orbitCraftAngle;
        while (angularDiff <= 0) angularDiff += Math.PI * 2;

        // Trigger Hohmann de-orbit retro-burn in the natural upstream transfer sector (80°..235° ahead of site)
        // without ever adding an extra +2π full loop!
        if (angularDiff >= Math.PI * 0.44 && angularDiff <= Math.PI * 1.30) {
          this.orbitPhase = 'descending';
          this.orbitDescentT = 0;
          this.orbitTouchdownTimer = -1;
          this.orbitDescentStartAngle = this.orbitCraftAngle;
          this.orbitDescentSweep = angularDiff;

          this.orbitCraftFlame.visible = true;
          this.orbitDescentLine.visible = true;

          const linePos = this.orbitDescentLine.geometry.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i <= 120; i++) {
            const t = i / 120;
            const easedR = THREE.MathUtils.smoothstep(t, 0, 1);
            const r = Math.max(planetSurfaceR, THREE.MathUtils.lerp(orbitRadius, planetSurfaceR, easedR));
            const theta = this.orbitDescentStartAngle + this.orbitDescentSweep * t;
            linePos.setXYZ(i, Math.cos(theta) * r, 0, Math.sin(theta) * r);
          }
          linePos.needsUpdate = true;
          this.orbitDescentLine.computeLineDistances();

          missionAudio.playIgnition();
          this.pushOrbitTelemetry(true);
        }
      }
      this.pushOrbitTelemetry();
    } else if (this.orbitPhase === 'descending') {
      if (this.orbitTouchdownTimer < 0) {
        // Continuity with orbital angular speed at t=0, followed by progressive retro-braking deceleration (~11-12s duration)
        const brakingFactor = THREE.MathUtils.lerp(1.0, 0.44, this.orbitDescentT);
        const baseDescentRate = THREE.MathUtils.clamp(
          (omegaOrbit * 1.12) / Math.max(1.4, this.orbitDescentSweep),
          0.072,
          0.11
        );
        this.orbitDescentT = Math.min(
          1,
          this.orbitDescentT + dt * baseDescentRate * brakingFactor * this.orbitTimeWarp
        );
        const t = this.orbitDescentT;
        const easedR = THREE.MathUtils.smoothstep(t, 0, 1);
        const pitchProgress = THREE.MathUtils.smoothstep(t, 0.18, 0.86);

        const minSafeR = planetSurfaceR + 0.22 * (1 - pitchProgress);
        const r = Math.max(minSafeR, THREE.MathUtils.lerp(orbitRadius, planetSurfaceR, easedR));
        const theta = this.orbitDescentStartAngle + this.orbitDescentSweep * t;
        this.orbitCraftAngle = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

        this.orbitCraft.position.set(Math.cos(theta) * r, 0, Math.sin(theta) * r);

        _v1.set(-Math.sin(theta), 0, Math.cos(theta)).normalize();
        _v2.set(Math.cos(theta), 0, Math.sin(theta)).normalize();
        _v3.copy(_v1).lerp(_v2, pitchProgress).normalize();
        this.orbitCraft.quaternion.setFromUnitVectors(_upAxis, _v3);

        this.orbitCraftFlame.visible = true;
        this.orbitCraftFlame.scale.set(1, 0.78 + Math.sin(elapsed * 42) * 0.18, 1);
        if (this.orbitCraftRig) {
          this.orbitCraftRig.flameGroup.visible = true;
          this.orbitCraftRig.flameGroup.scale.set(1, 0.8 + Math.sin(elapsed * 42) * 0.18, 1);
        }

        // Ionized atmospheric re-entry plasma sheath on atmospheric worlds
        const showPlasma = world.hasAtmosphere && t > 0.14 && t < 0.92;
        this.orbitPlasmaMesh.visible = showPlasma;
        if (showPlasma) {
          const plasmaMat = this.orbitPlasmaMesh.material as THREE.MeshBasicMaterial;
          const pIntensity = Math.sin(((t - 0.14) / 0.78) * Math.PI);
          plasmaMat.opacity = THREE.MathUtils.clamp(
            pIntensity * (0.68 + Math.sin(elapsed * 32) * 0.16),
            0.05,
            0.88
          );
          plasmaMat.color.setHex(pIntensity > 0.65 ? 0xfb7185 : 0xf97316);
        }

        this.pushOrbitTelemetry();

        if (this.orbitDescentT >= 1) {
          this.orbitTouchdownTimer = 0;
          this.orbitCraftFlame.visible = false;
          if (this.orbitCraftRig) {
            this.orbitCraftRig.flameGroup.visible = false;
          }
          this.orbitPlasmaMesh.visible = false;
          this.orbitCraft.position.set(
            Math.cos(siteRad) * planetSurfaceR,
            0,
            Math.sin(siteRad) * planetSurfaceR
          );
          _v2.set(Math.cos(siteRad), 0, Math.sin(siteRad)).normalize();
          this.orbitCraft.quaternion.setFromUnitVectors(_upAxis, _v2);
          missionAudio.playSuccess();
        }
      } else {
        this.orbitTouchdownTimer += dt;
        if (this.orbitTouchdownTimer >= 1.15) {
          this.callbacks.onOrbitDescentComplete();
          return;
        }
      }
    }

    if (!this.userOrbiting && this.cameraFocusTarget && this.cameraFocusPos) {
      this.controls.target.lerp(this.cameraFocusTarget, 0.08);
      this.camera.position.lerp(this.cameraFocusPos, 0.08);
      if (this.camera.position.distanceTo(this.cameraFocusPos) < 0.25) {
        this.cameraFocusTarget = null;
        this.cameraFocusPos = null;
      }
    }
    this.controls.update();
  }

  private updateFinalVisual(dt: number, elapsed: number): void {
    for (const p of this.surfaceDustPool) {
      if (!p.active) continue;
      p.age += dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(p.baseScale + p.age * 1.9);
      p.sprite.material.opacity = Math.max(0, 0.56 - p.age * 0.38);
      if (p.age > 1.45) {
        p.active = false;
        p.sprite.visible = false;
      }
    }

    if (this.finalRadarDish) {
      this.finalRadarDish.rotation.y = Math.sin(elapsed * 0.7) * 0.85;
    }
    if (this.finalCloudsMesh) {
      this.finalCloudsMesh.rotation.y += dt * 0.02;
    }

    // Pulse Science Target Beacons
    for (const obs of this.surfaceObstacles) {
      if (obs.beaconGroup) {
        const diamond = obs.beaconGroup.children[1] as THREE.Mesh | undefined;
        const ring = obs.beaconGroup.children[0] as THREE.Mesh | undefined;
        if (diamond) {
          diamond.rotation.y = elapsed * 2.2;
          diamond.position.y = obs.height + 0.55 + Math.sin(elapsed * 3.4 + obs.id) * 0.1;
          (diamond.material as THREE.MeshBasicMaterial).color.setHex(
            obs.scanned ? 0x10b981 : 0x38bdf8
          );
        }
        if (ring) {
          (ring.material as THREE.MeshBasicMaterial).color.setHex(
            obs.scanned ? 0x10b981 : 0x22d3ee
          );
        }
      }
    }

    if (!this.landingVehicle || !this.roverVehicle) return;

    const worldId = this.targetWorldId;
    const world = WORLDS[worldId];
    const groundY = this.getTerrainHeightAt(worldId, 0, 0);
    const bayFloorY = groundY + 0.48 - this.landerCompression;

    if (this.surfacePhase === 'descending') {
      const distToGround = Math.max(0, this.landerY - groundY);
      const gSurface = world.surfaceGravity;
      const hasAtmo = world.hasAtmosphere;

      let pitchRad = 0;
      let maneuverLabel = 'VERTICAL TERMINAL FLARE';
      let flapDeflection = 0;

      if (hasAtmo) {
        // Atmospheric World: SpaceX Starship Belly-Flop (150 m -> 68 m), Flip-and-Burn (68 m -> 32 m), & Terminal Hover Flare (< 32 m)
        if (distToGround > 34) {
          pitchRad = 1.28 + Math.sin(elapsed * 2.6) * 0.04;
          maneuverLabel = 'BELLY FLOP SKYDIVE';
        } else if (distToGround > 16) {
          if (!this.flipBurnIgnited) {
            this.flipBurnIgnited = true;
            missionAudio.playIgnition();
          }
          const flipT = THREE.MathUtils.smoothstep(34 - distToGround, 0, 18);
          pitchRad = THREE.MathUtils.lerp(1.28, 0, flipT);
          maneuverLabel = 'FLIP & BURN MANEUVER';
        } else {
          if (!this.flipBurnIgnited) {
            this.flipBurnIgnited = true;
            missionAudio.playIgnition();
          }
          pitchRad = 0;
          maneuverLabel = distToGround < 6 ? 'TOUCHDOWN HOVER FLARE' : 'VERTICAL RETRO-DESCENT';
        }
        flapDeflection = distToGround > 16 ? Math.sin(elapsed * 5.5) * 0.26 + 0.22 : 0.04;
      } else {
        // Airless World (Moon, Europa, 16 Psyche): Continuous HLS Powered Retro-Propulsive Descent (no aerodynamic Belly-Flop)
        if (!this.flipBurnIgnited) {
          this.flipBurnIgnited = true;
          missionAudio.playIgnition();
        }
        if (distToGround > 24) {
          const hlsT = THREE.MathUtils.clamp((distToGround - 24) / 51, 0, 1);
          pitchRad = THREE.MathUtils.lerp(0.05, 0.24, hlsT);
          maneuverLabel = 'HLS POWERED DESCENT';
        } else if (distToGround > 8) {
          pitchRad = THREE.MathUtils.lerp(0, 0.05, (distToGround - 8) / 16);
          maneuverLabel = 'TERMINAL RETRO-BURN';
        } else {
          pitchRad = 0;
          maneuverLabel = 'VACUUM TOUCHDOWN FLARE';
        }
        flapDeflection = 0; // Aero-flaps locked neutral in vacuum
      }

      this.landingVehicle.bodyGroup.rotation.x = pitchRad;
      this.landingVehicle.legsGroup.rotation.x = pitchRad;
      this.landingVehicle.legsGroup.visible = distToGround < 26;

      this.landingVehicle.fwdFlaps.forEach((f, idx) => {
        const side = idx === 0 ? -1 : 1;
        f.rotation.z = side * flapDeflection;
      });
      this.landingVehicle.aftFlaps.forEach((f, idx) => {
        const side = idx === 0 ? -1 : 1;
        f.rotation.z = side * (flapDeflection * 1.15);
      });

      let throttleRatio = 0;
      if (this.manualThrottlePct !== null) {
        // Manual Pilot Throttle Mode (0% .. 140%)
        const t01 = this.manualThrottlePct / 100;
        const hoverAcc = Math.max(2.6, gSurface * 0.45);
        const netAcc = (t01 - 0.72) * hoverAcc * 2.9 - this.landerVelY * 0.22;
        this.landerVelY = THREE.MathUtils.clamp(this.landerVelY + netAcc * dt, -13.5, 3.0);
        this.landerY = Math.min(
          groundY + 80,
          Math.max(groundY, this.landerY + this.landerVelY * dt)
        );
        throttleRatio = t01 * 1.25;
      } else {
        // Autopilot Two-Regime Powered Retro-Braking
        const targetVel =
          distToGround > 10
            ? -THREE.MathUtils.clamp(distToGround * 0.16 + 1.8, 2.0, 9.8)
            : -Math.max(0.24, Math.pow(distToGround / 10, 0.78) * 3.4);
        const accelResponse = THREE.MathUtils.clamp(2.4 + gSurface * 0.22, 2.2, 5.2);
        this.landerVelY = THREE.MathUtils.damp(this.landerVelY, targetVel, accelResponse, dt);
        this.landerY = Math.max(groundY, this.landerY + this.landerVelY * dt);

        const flareBoost = distToGround < 12 ? 0.22 : 0;
        if (hasAtmo) {
          throttleRatio =
            distToGround <= 34
              ? THREE.MathUtils.clamp(0.55 + gSurface / 14 + flareBoost, 0.55, 1.42)
              : 0;
        } else {
          // Continuous retro-propulsion on airless worlds
          throttleRatio = THREE.MathUtils.clamp(0.48 + gSurface / 14 + flareBoost, 0.48, 1.38);
        }
      }

      const enginesFiring = throttleRatio > 0.05;
      this.landerFuelPct = Math.max(
        0,
        this.landerFuelPct - dt * (enginesFiring ? 1.8 * throttleRatio : 0.08)
      );

      this.landingVehicle.root.position.set(0, this.landerY, 0);
      this.landingVehicle.bodyGroup.position.y = 0;
      this.landingVehicle.flameGroup.visible = enginesFiring;
      if (enginesFiring) {
        this.landingVehicle.flameGroup.scale.set(
          throttleRatio,
          (0.8 + Math.sin(elapsed * 42) * 0.16) * throttleRatio,
          throttleRatio
        );
      }

      this.roverPos.set(0, this.landerY + 0.48, -0.05);
      this.roverVehicle.root.visible = false;
      this.roverVehicle.root.position.copy(this.roverPos);

      if (enginesFiring && distToGround < 22) {
        const scorchRate = THREE.MathUtils.clamp((22 - distToGround) / 18, 0.15, 1.0);
        this.landerScorchIntensity = Math.min(
          0.88,
          this.landerScorchIntensity + dt * 0.48 * scorchRate * throttleRatio
        );
        if (this.landerScorchMesh) {
          (this.landerScorchMesh.material as THREE.MeshBasicMaterial).opacity =
            this.landerScorchIntensity;
        }
      }

      if (enginesFiring && distToGround < 9.5 && Math.random() < (distToGround < 4 ? 0.85 : 0.48)) {
        this.spawnSurfaceDust(0, groundY, 0, 3.6);
      }

      const speedMs = Math.abs(this.landerVelY) * SURFACE_METERS_PER_UNIT;
      const soundSpeedMs =
        worldId === 'earth' ? 340 : worldId === 'mars' ? 240 : worldId === 'colony' ? 315 : 0;
      const mach =
        hasAtmo && soundSpeedMs > 0 ? Number((speedMs / soundSpeedMs).toFixed(2)) : 0;
      const rho0 =
        worldId === 'earth' ? 1.225 : worldId === 'mars' ? 0.020 : worldId === 'colony' ? 1.45 : 0;
      const dynamicPressureKpa = hasAtmo
        ? Number(((0.5 * rho0 * speedMs * speedMs * 0.045) * (0.4 + distToGround / 75)).toFixed(2))
        : 0;
      const gLoad = Number(
        ((gSurface + (enginesFiring ? throttleRatio * gSurface * 1.35 : 0)) / 9.80665).toFixed(2)
      );

      const now = performance.now();
      if (this.callbacks.onSurfaceTelemetry && now - this.lastSurfacePush >= 80) {
        this.lastSurfacePush = now;
        this.callbacks.onSurfaceTelemetry({
          altitudeM: Math.round(distToGround * SURFACE_METERS_PER_UNIT),
          verticalSpeedMs: Number(speedMs.toFixed(1)),
          surfaceGravityMs2: gSurface,
          maneuverLabel,
          fuelPct: Math.round(this.landerFuelPct),
          manualThrottlePct: this.manualThrottlePct,
          pitchDeg: Math.round(THREE.MathUtils.radToDeg(pitchRad)),
          mach,
          dynamicPressureKpa,
          gLoad,
        });
      }

      if (this.landerY <= groundY + 0.008) {
        this.landerY = groundY;
        this.landerCompression = 0;
        this.landerCompressionVel = THREE.MathUtils.clamp(
          Math.abs(this.landerVelY) * 0.9,
          0.45,
          1.35
        );
        this.landerFlameFade = 1;
        this.landingVehicle.root.position.set(0, groundY, 0);
        this.landingVehicle.bodyGroup.rotation.set(0, 0, 0);
        this.landingVehicle.legsGroup.rotation.set(0, 0, 0);
        this.landingVehicle.legsGroup.visible = true;
        this.landingVehicle.fwdFlaps.forEach((f) => (f.rotation.z = 0));
        this.landingVehicle.aftFlaps.forEach((f) => (f.rotation.z = 0));
        this.roverPos.set(0, groundY + 0.48, -0.05);
        this.roverVehicle.root.visible = false;
        this.roverVehicle.root.position.copy(this.roverPos);
        missionAudio.playSnap();
        this.surfacePhase = 'landed';
        this.surfaceTimer = 0;
        this.callbacks.onSurfacePhaseChange('landed');
        this.callbacks.onSurfaceTelemetry?.({
          altitudeM: 0,
          verticalSpeedMs: 0,
          surfaceGravityMs2: gSurface,
          maneuverLabel: 'TOUCHDOWN CONFIRMED',
          fuelPct: Math.round(this.landerFuelPct),
          manualThrottlePct: this.manualThrottlePct,
          pitchDeg: 0,
          mach: 0,
          dynamicPressureKpa: 0,
          gLoad: Number((gSurface / 9.80665).toFixed(2)),
        });
        this.cameraFocusTarget = new THREE.Vector3(0, groundY + 2.5, 0.8);
        this.cameraFocusPos = new THREE.Vector3(7.2, groundY + 3.8, 14.8);
      }
    } else if (this.surfacePhase === 'landed') {
      this.surfaceTimer += dt;

      // Damped shock-absorber spring compression across all 4 landing legs
      const springForce = -78 * this.landerCompression - 14 * this.landerCompressionVel;
      this.landerCompressionVel += springForce * dt;
      this.landerCompression = THREE.MathUtils.clamp(
        this.landerCompression + this.landerCompressionVel * dt,
        0,
        0.22
      );
      this.landingVehicle.bodyGroup.position.y = -this.landerCompression;
      this.roverPos.set(0, groundY + 0.48 - this.landerCompression, -0.05);
      this.roverVehicle.root.visible = false;
      this.roverVehicle.root.position.copy(this.roverPos);

      for (const leg of this.landingVehicle.legRigs) {
        leg.upperPivot.position.y = 0.68 - this.landerCompression;
        leg.upperPivot.rotation.z = 0.56 + this.landerCompression * 0.65;
        leg.lowerPivot.rotation.z = 0.56 + this.landerCompression * 0.65;
      }

      // Smoothly spool down retro-thruster exhaust plume instead of cutting abruptly
      if (this.landerFlameFade > 0) {
        this.landerFlameFade = Math.max(0, this.landerFlameFade - dt * 2.8);
        if (this.landerFlameFade <= 0.01) {
          this.landingVehicle.flameGroup.visible = false;
        } else {
          this.landingVehicle.flameGroup.scale.setScalar(this.landerFlameFade);
        }
      }

      if (this.surfaceTimer >= 1.35) {
        this.surfacePhase = 'ramp_deploy';
        this.surfaceTimer = 0;
        this.roverPos.set(0, bayFloorY, -0.05);
        this.roverVehicle.root.position.copy(this.roverPos);
        this.roverVehicle.root.scale.setScalar(1.0);
        this.roverVehicle.root.visible = true; // Reveal stowed rover inside bay as ramp opens
        missionAudio.playSnap();
        this.callbacks.onSurfacePhaseChange('ramp_deploy');
      }
    } else if (this.surfacePhase === 'ramp_deploy') {
      this.roverVehicle.root.visible = true;
      this.roverPos.set(0, bayFloorY, -0.05);
      this.roverVehicle.root.position.copy(this.roverPos);
      this.rampAngle = Math.min(1.90, this.rampAngle + dt * 1.15);
      this.landingVehicle.rampPivot.rotation.x = this.rampAngle;
      this.landingVehicle.bayLight.intensity = Math.min(2.8, this.landingVehicle.bayLight.intensity + dt * 3.0);

      if (this.rampAngle >= 1.895) {
        this.surfacePhase = 'rover_exit';
        this.surfaceTimer = 0;
        this.callbacks.onSurfacePhaseChange('rover_exit');
      }
    } else if (this.surfacePhase === 'rover_exit') {
      this.roverVehicle.root.visible = true;
      this.roverVehicle.root.scale.setScalar(1.0);
      const speed = 1.35;
      this.roverPos.z += speed * dt;

      if (this.roverPos.z < 0.58) {
        this.roverPos.y = bayFloorY;
        this.roverVehicle.root.rotation.x = 0;
      } else if (this.roverPos.z <= 1.98) {
        const rampT = (this.roverPos.z - 0.58) / (1.98 - 0.58);
        const endGroundY = this.getTerrainHeightAt(worldId, 0, 1.98);
        this.roverPos.y = THREE.MathUtils.lerp(bayFloorY, endGroundY, rampT);
        this.roverVehicle.root.rotation.x = 0.32;
      } else {
        this.roverPos.y = this.getTerrainHeightAt(worldId, this.roverPos.x, this.roverPos.z);
        this.roverVehicle.root.rotation.x = THREE.MathUtils.damp(this.roverVehicle.root.rotation.x, 0, 8, dt);
        this.stampRoverWheelTracks();
      }

      this.roverVehicle.root.position.copy(this.roverPos);
      const wheelSpin = (speed * dt) / 0.12;
      for (const w of this.roverVehicle.wheels) {
        w.rotation.x += wheelSpin;
      }
      this.roverVehicle.mastHead.rotation.y = Math.sin(elapsed * 1.6) * 0.45;

      if (this.roverPos.z >= 4.2) {
        this.roverVehicle.root.scale.setScalar(1.0);
        this.surfacePhase = 'rover_active';
        this.surfaceTimer = 0;
        missionAudio.playSuccess();
        this.callbacks.onSurfacePhaseChange('rover_active');
        this.cameraFocusTarget = new THREE.Vector3(0, groundY + 1.8, 2.4);
        this.cameraFocusPos = new THREE.Vector3(6.8, groundY + 4.2, 12.6);
        this.pushScienceTelemetry();
      }
    } else if (this.surfacePhase === 'rover_active') {
      if (this.roverBumpTimer > 0) this.roverBumpTimer = Math.max(0, this.roverBumpTimer - dt);
      if (this.obstacleNoticeTimer > 0) {
        this.obstacleNoticeTimer = Math.max(0, this.obstacleNoticeTimer - dt);
        if (this.obstacleNoticeTimer <= 0) {
          this.currentObstacleNotice = null;
          this.pushRoverNavTelemetry(true);
        }
      }

      // Active ChemCam Laser Spectroscopy Scan update
      if (this.chemCamScanTimer > 0 && this.chemCamActiveTarget) {
        this.chemCamScanTimer = Math.max(0, this.chemCamScanTimer - dt);
        const target = this.chemCamActiveTarget;
        const targetY =
          this.getTerrainHeightAt(worldId, target.x, target.z) + target.height * 0.55;

        this.roverVehicle.mastHead.getWorldPosition(_v1);
        _v2.set(target.x, targetY, target.z);

        if (this.chemCamBeamLine) {
          const beamPos = this.chemCamBeamLine.geometry.attributes.position as THREE.BufferAttribute;
          beamPos.setXYZ(0, _v1.x, _v1.y, _v1.z);
          beamPos.setXYZ(1, _v2.x, _v2.y, _v2.z);
          beamPos.needsUpdate = true;
          this.chemCamBeamLine.visible = Math.sin(elapsed * 55) > -0.35;
        }
        if (this.chemCamSparkSprite) {
          this.chemCamSparkSprite.position.copy(_v2);
          this.chemCamSparkSprite.scale.setScalar(0.55 + Math.sin(elapsed * 48) * 0.25);
          this.chemCamSparkSprite.visible = true;
        }
        if (Math.random() < 0.35) {
          this.spawnSurfaceDust(target.x, targetY - 0.2, target.z, 0.9);
        }

        if (this.chemCamScanTimer > 0) {
          // Animate IDD Robotic Arm turret during active rock analysis
          this.roverVehicle.armJoint.rotation.y = Math.sin(elapsed * 8.0) * 0.35;
          this.roverVehicle.armHead.rotation.x = 0.32 + Math.sin(elapsed * 12.0) * 0.16;
        }

        if (this.chemCamScanTimer <= 0) {
          if (this.chemCamBeamLine) this.chemCamBeamLine.visible = false;
          if (this.chemCamSparkSprite) this.chemCamSparkSprite.visible = false;

          target.scanned = true;
          const mineral = target.mineralComposition ?? 'Silicate Regolith Breccia (SiO₂ · MgO)';
          const oxideBreakdown = this.generateOxideBreakdown(target);
          this.spectrometerSummary = oxideBreakdown;
          this.lastSpectroReadout = `${target.label}: ${mineral} (${oxideBreakdown})`;
          if (!this.collectedSamples.some((s) => s.id === target.id)) {
            this.collectedSamples.push({
              id: target.id,
              label: target.label,
              mineralComposition: mineral,
              oxideBreakdown,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            });
          }
          this.chemCamActiveTarget = null;
          missionAudio.playSuccess();
          this.currentObstacleNotice = `Sample Logged: ${target.label}`;
          this.systemLog = `Örnek Toplandı! ${target.label} analizi tamamlandı.`;
          this.obstacleNoticeTimer = 2.6;
          this.pushRoverNavTelemetry(true);

          if (this.autonomousMissionActive) {
            this.planNextAutonomousTarget();
          }
        }
        this.pushScienceTelemetry(true);
      } else {
        if (this.chemCamBeamLine) this.chemCamBeamLine.visible = false;
        if (this.chemCamSparkSprite) this.chemCamSparkSprite.visible = false;
      }

      if (this.roverTargetBeacon.visible) {
        const pulse = 1 + Math.sin(elapsed * 4.5) * 0.12;
        this.roverTargetBeacon.scale.setScalar(pulse);
      }

      let fwd = this.roverDriveInput.forward;
      let turn = this.roverDriveInput.turn;

      if (fwd !== 0 || turn !== 0) {
        if (this.roverPathWaypoints.length > 0) {
          this.autonomousMissionActive = false;
          this.pendingScanObstacleId = null;
          this.clearRoverNavigation();
        }
      } else if (this.roverWaypointIdx < this.roverPathWaypoints.length) {
        const wp = this.roverPathWaypoints[this.roverWaypointIdx];
        const dx = wp.x - this.roverPos.x;
        const dz = wp.y - this.roverPos.z;
        const distToWp = Math.hypot(dx, dz);
        const isLast = this.roverWaypointIdx === this.roverPathWaypoints.length - 1;

        if (distToWp < (isLast ? 0.36 : 0.48)) {
          this.roverWaypointIdx++;
          if (this.roverWaypointIdx >= this.roverPathWaypoints.length) {
            this.clearRoverNavigation();
            if (this.pendingScanObstacleId !== null) {
              const scanId = this.pendingScanObstacleId;
              this.pendingScanObstacleId = null;
              this.triggerChemCamScan(scanId);
            } else {
              missionAudio.playSuccess();
              this.currentObstacleNotice = 'Destination Reached';
              this.systemLog = 'Hedefe Ulaşıldı.';
              this.obstacleNoticeTimer = 2.0;
              this.pushRoverNavTelemetry(true);
            }
          } else {
            this.updateRoverNavLineMesh();
          }
        } else {
          const desiredHeading = Math.atan2(dx, dz);
          let angleErr = desiredHeading - this.roverHeading;
          while (angleErr > Math.PI) angleErr -= Math.PI * 2;
          while (angleErr < -Math.PI) angleErr += Math.PI * 2;

          this.roverHeading += Math.max(-1, Math.min(1, angleErr * 2.6)) * dt * 2.8;
          fwd = Math.abs(angleErr) > 1.1 ? 0.35 : 1.05;
        }
      } else if (this.roverDriveInput.autoRoam) {
        fwd = 0.65;
        turn = Math.sin(elapsed * 0.45) * 0.42;
      }

      // Compute real-time Terrain Slope (EĞİM) in degrees
      const hX1 = this.getTerrainHeightAt(worldId, this.roverPos.x + 0.15, this.roverPos.z);
      const hX2 = this.getTerrainHeightAt(worldId, this.roverPos.x - 0.15, this.roverPos.z);
      const hZ1 = this.getTerrainHeightAt(worldId, this.roverPos.x, this.roverPos.z + 0.15);
      const hZ2 = this.getTerrainHeightAt(worldId, this.roverPos.x, this.roverPos.z - 0.15);
      const dHx = (hX1 - hX2) / 0.3;
      const dHz = (hZ1 - hZ2) / 0.3;
      this.sensorSlopeDeg = Math.atan(Math.sqrt(dHx * dHx + dHz * dHz)) * (180 / Math.PI);

      // Periodic 500ms Sensor Suite update (Temperature, Radiation, IR Reflectance, Camera Status)
      const nowMs = performance.now();
      if (nowMs - this.lastSensorUpdateTime > 500) {
        this.lastSensorUpdateTime = nowMs;
        const baseWorldTemp =
          worldId === 'earth'
            ? 18
            : worldId === 'mars'
            ? -58
            : worldId === 'jupiter'
            ? -162
            : worldId === 'colony'
            ? -28
            : -45;
        let elevTempOffset = 0;
        if (this.roverPos.y < -0.6) elevTempOffset = -95; // Deep crater shadow cold trap
        else if (this.roverPos.y > 0.4) elevTempOffset = 22; // Sunlit crater rim
        this.sensorTempC = baseWorldTemp + elevTempOffset + (Math.random() * 3.6 - 1.8);

        const baseRad =
          worldId === 'jupiter'
            ? 420
            : worldId === 'mars'
            ? 34
            : worldId === 'earth'
            ? 0.2
            : 55;
        this.sensorRadUsv =
          baseRad + (this.roverPos.y > 0.5 ? 14 : 0) + Math.random() * (worldId === 'earth' ? 0.08 : 8.5);

        const baseIr = worldId === 'jupiter' ? 0.92 : 0.85;
        this.sensorIrReflectance =
          baseIr + (this.roverPos.y < -0.6 ? -0.14 : 0) + (Math.random() * 0.04 - 0.02);
      }

      // If battery is depleted, halt movement until MMRTG nuclear source recharges buffer
      if (this.roverBattery <= 0.05) {
        fwd = 0;
        turn = 0;
        this.systemLog = 'DURUM: GÜÇ TÜKENDİ! MMRTG nükleer reaktör şarj ediyor...';
      }

      if (turn !== 0) {
        this.roverHeading += turn * dt * 1.35;
      }

      if (fwd !== 0) {
        const moveSpeed = fwd * 2.15;
        let nextX = this.roverPos.x + Math.sin(this.roverHeading) * moveSpeed * dt;
        let nextZ = this.roverPos.z + Math.cos(this.roverHeading) * moveSpeed * dt;

        const maxDist = worldId === 'earth' ? 14.0 : 45.0;
        const rFromCenter = Math.hypot(nextX, nextZ);
        if (rFromCenter > maxDist) {
          const clampScale = maxDist / rFromCenter;
          nextX *= clampScale;
          nextZ *= clampScale;
          if (this.roverDriveInput.autoRoam) {
            this.roverHeading += dt * 1.6;
          }
        }

        let hitNotice: string | null = null;
        for (let iter = 0; iter < 2; iter++) {
          for (let i = 0; i < this.surfaceObstacles.length; i++) {
            const obs = this.surfaceObstacles[i];
            const dx = nextX - obs.x;
            const dz = nextZ - obs.z;
            const dist = Math.hypot(dx, dz);
            const minD = ROVER_COLLISION_RADIUS + obs.radius;

            if (dist < minD) {
              const nx = dist > 0.001 ? dx / dist : Math.sin(this.roverHeading);
              const nz = dist > 0.001 ? dz / dist : Math.cos(this.roverHeading);
              const overlap = minD - dist;

              if (obs.movable) {
                const rockPushX = obs.x - nx * (overlap * 0.88);
                const rockPushZ = obs.z - nz * (overlap * 0.88);
                const safeRockPos = clampToFreeSurfacePoint(
                  rockPushX,
                  rockPushZ,
                  this.surfaceObstacles.filter((other) => other.id !== obs.id),
                  maxDist - 0.5,
                  obs.radius
                );
                obs.x = safeRockPos.x;
                obs.z = safeRockPos.z;
                if (obs.mesh) {
                  const rockY = this.getTerrainHeightAt(worldId, obs.x, obs.z);
                  obs.mesh.position.set(obs.x, rockY + obs.radius * 0.58, obs.z);
                  obs.mesh.rotation.x += nz * overlap * 0.8;
                  obs.mesh.rotation.z -= nx * overlap * 0.8;
                  if (obs.beaconGroup) {
                    obs.beaconGroup.position.set(obs.x, rockY + 0.08, obs.z);
                  }
                }
                nextX = obs.x + nx * (minD + 0.01);
                nextZ = obs.z + nz * (minD + 0.01);
                hitNotice = `Pushing: ${obs.label}`;
              } else {
                nextX = obs.x + nx * (minD + 0.015);
                nextZ = obs.z + nz * (minD + 0.015);
                hitNotice = `Blocked by ${obs.label}`;
                if (this.roverDriveInput.autoRoam) {
                  this.roverHeading += dt * 1.9;
                }
              }

              if (elapsed - this.lastBumpAudioTime > 0.45) {
                this.lastBumpAudioTime = elapsed;
                this.roverBumpTimer = 0.22;
                missionAudio.playSnap();
              }
            }
          }
        }

        if (hitNotice) {
          this.currentObstacleNotice = hitNotice;
          this.obstacleNoticeTimer = 1.6;
        }

        const stepDistUnits = Math.hypot(nextX - this.roverPos.x, nextZ - this.roverPos.z);
        this.roverTotalDistanceM += stepDistUnits * SURFACE_METERS_PER_UNIT;
        this.roverBattery = Math.max(
          0,
          this.roverBattery - stepDistUnits * 1.35 * (1 + this.sensorSlopeDeg * 0.025)
        );

        this.roverPos.x = nextX;
        this.roverPos.z = nextZ;
        this.stampRoverWheelTracks();

        if (this.roverWaypointIdx < this.roverPathWaypoints.length) {
          this.updateRoverNavLineMesh();
          this.pushRoverNavTelemetry();
        }

        const wheelSpin = (moveSpeed * dt) / 0.14;
        for (const w of this.roverVehicle.wheels) {
          w.rotation.x += wheelSpin;
        }

        // Curiosity 5-DOF Robotic Arm active scanning motion while driving
        this.roverVehicle.armJoint.rotation.y = Math.sin(elapsed * 3.0) * 0.48;
        this.roverVehicle.armHead.rotation.x = Math.sin(elapsed * 5.0) * 0.28;
      } else {
        // Stationary: MMRTG Nuclear Radioisotope Power Source recharges buffer battery + Arm returns smoothly to stow
        if (this.roverBattery < this.roverMaxBattery) {
          this.roverBattery = Math.min(this.roverMaxBattery, this.roverBattery + dt * 3.6);
        }
        if (this.chemCamScanTimer <= 0) {
          this.roverVehicle.armJoint.rotation.y *= 0.92;
          this.roverVehicle.armHead.rotation.x *= 0.92;
        }
      }

      // Update Camera Sensor status string
      const nearestSci = this.getNearestScannableObstacle(5.0);
      if (nearestSci && !nearestSci.scanned) {
        this.sensorCameraStatus = 'Hedef Yakında (Odaklanıldı)';
      } else if (fwd !== 0 || turn !== 0) {
        this.sensorCameraStatus = 'Navigasyon (Aktif Tarama)';
      } else {
        this.sensorCameraStatus = 'Geniş Açı (Bekleme)';
      }

      this.pushScienceTelemetry();

      // 3D Longitudinal Pitch + Lateral Roll & 6-Wheel Independent Rocker-Bogie Terrain Conformance
      const sinH = Math.sin(this.roverHeading);
      const cosH = Math.cos(this.roverHeading);
      const frontY = this.getTerrainHeightAt(
        worldId,
        this.roverPos.x + sinH * 0.25,
        this.roverPos.z + cosH * 0.25
      );
      const rearY = this.getTerrainHeightAt(
        worldId,
        this.roverPos.x - sinH * 0.25,
        this.roverPos.z - cosH * 0.25
      );
      const leftY = this.getTerrainHeightAt(
        worldId,
        this.roverPos.x - cosH * 0.24,
        this.roverPos.z + sinH * 0.24
      );
      const rightY = this.getTerrainHeightAt(
        worldId,
        this.roverPos.x + cosH * 0.24,
        this.roverPos.z - sinH * 0.24
      );

      const ry = (frontY + rearY + leftY + rightY) * 0.25;
      const bumpLift =
        this.roverBumpTimer > 0 ? Math.sin((this.roverBumpTimer / 0.22) * Math.PI) * 0.04 : 0;
      this.roverPos.y = THREE.MathUtils.damp(this.roverPos.y, ry + bumpLift, 14, dt);
      this.roverVehicle.root.position.copy(this.roverPos);

      const pitch = Math.atan2(rearY - frontY, 0.50) + (this.roverBumpTimer > 0 ? -0.06 : 0);
      const roll = Math.atan2(leftY - rightY, 0.48);

      this.roverVehicle.root.rotation.order = 'YXZ';
      this.roverVehicle.root.rotation.y = this.roverHeading;
      this.roverVehicle.root.rotation.x = THREE.MathUtils.damp(
        this.roverVehicle.root.rotation.x,
        pitch,
        10,
        dt
      );
      this.roverVehicle.root.rotation.z = THREE.MathUtils.damp(
        this.roverVehicle.root.rotation.z,
        roll,
        10,
        dt
      );

      // Articulate each of the 6 Curiosity wheels vertically to conform to local crater slope
      const roverScale = 0.22;
      const sinPitch = Math.sin(this.roverVehicle.root.rotation.x);
      const sinRoll = Math.sin(this.roverVehicle.root.rotation.z);
      for (let i = 0; i < this.roverVehicle.wheels.length; i++) {
        const wMesh = this.roverVehicle.wheels[i];
        const hub = CURIOSITY_WHEEL_HUBS[i];
        if (!wMesh || !hub) continue;
        const lx = hub[0] * roverScale;
        const lz = hub[2] * roverScale;
        const wx = this.roverPos.x + lx * cosH + lz * sinH;
        const wz = this.roverPos.z - lx * sinH + lz * cosH;
        const wheelGroundY = this.getTerrainHeightAt(worldId, wx, wz);
        const chassisYAtWheel = this.roverPos.y - lz * sinPitch - lx * sinRoll;
        const localDeltaY = THREE.MathUtils.clamp(
          (wheelGroundY - chassisYAtWheel) / roverScale,
          -0.18,
          0.18
        );
        wMesh.position.y = THREE.MathUtils.damp(wMesh.position.y, hub[1] + localDeltaY, 16, dt);
      }

      this.roverVehicle.mastHead.rotation.y =
        this.surfaceCameraMode === 'rover_cam'
          ? 0
          : fwd !== 0
          ? Math.sin(elapsed * 2.0) * 0.75
          : Math.sin(elapsed * 0.6) * 0.3;
    }

    // Multi-Angle Camera System: Chase (OrbitControls), StarshipHullCam, LandingPadCam, or RoverNavCam
    this.controls.enabled = this.surfaceCameraMode === 'chase';
    if (this.surfaceCameraMode === 'starship_cam') {
      // Mounted near Starship upper dorsal hull looking down along the stainless steel barrel & flaps toward the pad
      const bodyPitch = this.landingVehicle.bodyGroup.rotation.x;
      const camLocal = _v1.set(1.85, 5.8, 2.65);
      camLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), bodyPitch);
      camLocal.y += this.landerY;

      const lookLocal = _v2.set(0, -1.2, 0);
      lookLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), bodyPitch);
      lookLocal.y += Math.max(groundY, this.landerY);

      this.camera.position.lerp(camLocal, 1 - Math.exp(-16 * dt));
      this.controls.target.lerp(lookLocal, 1 - Math.exp(-18 * dt));
      this.camera.lookAt(this.controls.target);
    } else if (this.surfaceCameraMode === 'pad_cam') {
      // Low-angle ground camera stationed near the landing pad edge looking up at Starship or across at the Rover
      _v1.set(9.2, groundY + 1.25, 11.8);
      if (this.surfacePhase === 'descending' || this.surfacePhase === 'landed' || this.surfacePhase === 'ramp_deploy') {
        _v2.set(0, this.landerY + 2.6, 0);
      } else {
        _v2.set(this.roverPos.x, this.roverPos.y + 0.55, this.roverPos.z);
      }
      this.camera.position.lerp(_v1, 1 - Math.exp(-12 * dt));
      this.controls.target.lerp(_v2, 1 - Math.exp(-14 * dt));
      this.camera.lookAt(this.controls.target);
    } else if (this.surfaceCameraMode === 'rover_cam') {
      // First-Person Stereo NavCam mounted on the Perseverance Rover mastHead
      const sinH = Math.sin(this.roverHeading);
      const cosH = Math.cos(this.roverHeading);
      _v1.set(
        this.roverPos.x + sinH * 0.28,
        this.roverPos.y + 0.92,
        this.roverPos.z + cosH * 0.28
      );
      const lookX = this.roverPos.x + sinH * 6.5;
      const lookZ = this.roverPos.z + cosH * 6.5;
      const lookY = this.getTerrainHeightAt(worldId, lookX, lookZ) + 0.45;
      _v2.set(lookX, lookY, lookZ);
      this.camera.position.copy(_v1);
      this.controls.target.copy(_v2);
      this.camera.lookAt(_v2);
    } else {
      // 'chase' mode: OrbitControls with automatic descent tracking or 360° Cinematic Auto-Showcase
      if (this.autoShowcaseOrbit && !this.userOrbiting) {
        const orbitAngle = elapsed * 0.34;
        if (this.surfacePhase === 'rover_active' || this.surfacePhase === 'rover_exit') {
          const radius = 5.4 + Math.sin(elapsed * 0.55) * 1.1;
          const height = 1.85 + Math.cos(elapsed * 0.45) * 0.55;
          _v1.set(this.roverPos.x, this.roverPos.y + 0.45, this.roverPos.z);
          _v2.set(
            this.roverPos.x + Math.cos(orbitAngle) * radius,
            Math.max(groundY + 0.85, this.roverPos.y + height),
            this.roverPos.z + Math.sin(orbitAngle) * radius
          );
        } else {
          const radius = 14.5;
          _v1.set(0, this.landerY + 2.5, 0);
          _v2.set(
            Math.cos(orbitAngle) * radius,
            Math.max(groundY + 3.2, this.landerY + 3.8),
            Math.sin(orbitAngle) * radius
          );
        }
        this.controls.target.lerp(_v1, 1 - Math.exp(-8 * dt));
        this.camera.position.lerp(_v2, 1 - Math.exp(-5 * dt));
      } else if (this.surfacePhase === 'descending' && !this.userOrbiting) {
        const distToGround = Math.max(0, this.landerY - groundY);
        const altFrac = THREE.MathUtils.clamp(distToGround / 75.0, 0, 1);
        const desiredTargetY = this.landerY + THREE.MathUtils.lerp(2.7, 2.4, altFrac);
        const desiredPosX = THREE.MathUtils.lerp(7.2, 14.5, altFrac);
        const desiredPosY = Math.max(
          groundY + 3.8,
          this.landerY + THREE.MathUtils.lerp(3.8, 4.8, altFrac)
        );
        const desiredPosZ = THREE.MathUtils.lerp(14.8, 24.5, altFrac);
        const targetAlpha = 1 - Math.exp(-18.0 * dt);
        const posAlpha = 1 - Math.exp(-10.0 * dt);
        _v1.set(0, desiredTargetY, 0);
        _v2.set(desiredPosX, desiredPosY, desiredPosZ);
        this.controls.target.lerp(_v1, targetAlpha);
        this.camera.position.lerp(_v2, posAlpha);
        this.cameraFocusTarget = null;
        this.cameraFocusPos = null;
      } else if (!this.userOrbiting && this.cameraFocusTarget && this.cameraFocusPos) {
        this.controls.target.lerp(this.cameraFocusTarget, 0.08);
        this.camera.position.lerp(this.cameraFocusPos, 0.08);
        if (this.camera.position.distanceTo(this.cameraFocusPos) < 0.25) {
          this.cameraFocusTarget = null;
          this.cameraFocusPos = null;
        }
      }
      this.controls.update();
    }
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResize);
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);

    this.controls.dispose();
    this.composer?.dispose();

    this.earthPBR.dispose();
    this.moonPBR.dispose();
    this.marsPBR.dispose();
    this.jupiterPBR.dispose();
    this.europaPBR.dispose();
    this.asteroidPBR.dispose();
    this.proximaPBR.dispose();
    this.milkyWayTexture.dispose();
    this.glowTexture.dispose();
    this.smokeTexture.dispose();
    this.spacecraftAssets.kapton.dispose();
    this.spacecraftAssets.solar.dispose();
    this.spacecraftAssets.shuttleWhite.dispose();
    this.spacecraftAssets.shuttleBlack.dispose();
    this.spacecraftAssets.etFoam.dispose();

    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Sprite) {
        if ('geometry' in obj && obj.geometry) obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });

    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
