import {
  computeHeliocentricHohmann,
  computeLunarHohmann,
  computePlanetaryOrbitMetrics,
  computeSolarFluxRatio,
  computeTsiolkovskyDeltaV,
  EUROPA_ELEMENTS,
  G0_MS2,
  HohmannTransferSummary,
  MOON_ORBIT_ELEMENTS,
  MU_EARTH_KM3_S2,
  PlanetaryOrbitMetrics,
  R_EARTH_KM,
  SOLAR_SYSTEM_EPHEMERIS,
} from '../physics/orbitalMechanics';

export type SceneStage =
  | 'planet_select'
  | 'hangar'
  | 'launch'
  | 'journey'
  | 'orbit_insertion'
  | 'final_visual';

export type WorldId = 'moon' | 'earth' | 'mars' | 'asteroid' | 'jupiter' | 'colony';

export type CraftClassId = 'light' | 'standard' | 'heavy';
export type ShieldTierId = 'thin' | 'medium' | 'thick';

export type ManeuverType = 'retro_burn' | 'aerobraking' | 'gravity_assist';

export interface WorldSpec {
  id: WorldId;
  name: string;
  subtitle: string;
  category: string;
  difficulty: 'STANDARD' | 'MODERATE' | 'HIGH' | 'EXTREME';
  /** Gravity used for mission propulsion / TWR sizing (m/s^2; for Jupiter system, 1-bar Jovian well) */
  gravity: number;
  /** Actual solid surface gravity at landing zone (m/s^2; e.g., Europa = 1.315 m/s^2) */
  surfaceGravity: number;
  earthG: number;
  surfaceEarthG: number;
  distanceLabel: string;
  tripDuration: string;
  radioDelay: string;
  radiationHazard: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';
  requiredShield: ShieldTierId;
  /** Exact inverse-square solar irradiance ratio S = 1 / r_AU^2 */
  solarFluxRatio: number;
  hasAtmosphere: boolean;
  recommendedManeuver: ManeuverType;
  /** Real orbital / capture reference speed (km/s) */
  approachVelocityKms: number;
  /** Base Δv required for orbit capture maneuver (m/s) before maneuver multiplier */
  captureBaseDeltaVms: number;
  idealAngleDeg: number;
  angleToleranceDeg: number;
  accentColor: string;
  /** Semi-major axis in AU (heliocentric) or Earth-relative for Moon */
  smaAU: number;
  eccentricity: number;
  inclinationDeg: number;
  orbitalPeriodDays: number;
  muKm3s2: number;
  meanRadiusKm: number;
  orbitAltitudeKm: number;
  orbitRadius: number;
  orbitSpeed: number;
  planetRadius: number;
  hohmannSummary: HohmannTransferSummary;
  orbitMetrics: PlanetaryOrbitMetrics;
  description: string;
  novaGuidance: string;
  finalSummary: string;
}

export interface CraftClassSpec {
  id: CraftClassId;
  name: string;
  subtitle: string;
  dryMassKg: number;
  fuelCapacityKg: number;
  costM: number;
  thrustN: number;
  ispSec: number;
  powerGenW: number;
  powerDrawW: number;
  solarPanels: number; // 2, 4, or 6 wings
  description: string;
}

export interface ShieldTierSpec {
  id: ShieldTierId;
  name: string;
  massKg: number;
  costM: number;
  protectionRating: number;
  shellOpacity: number;
  description: string;
}

export type PowerSourceId = 'solar_array' | 'nuclear_rtg';

export interface PowerSourceSpec {
  id: PowerSourceId;
  name: string;
  massKg: number;
  costM: number;
  baseWatts: number;
  solarDependent: boolean;
  description: string;
}

export interface HangarConfig {
  craftClass: CraftClassId;
  shieldTier: ShieldTierId;
  powerSource: PowerSourceId;
}

export interface CraftStats {
  totalMassKg: number;
  dryMassKg: number;
  fuelMassKg: number;
  massLimitKg: number;
  remainingMassKg: number;
  totalCostM: number;
  budgetLimitM: number;
  remainingBudgetM: number;
  shieldMassKg: number;
  shieldCostM: number;
  netPowerW: number;
  thrustN: number;
  twrOnTarget: number;
  deltaV: number;
  readinessScore: number;
  advisories: { level: 'nominal' | 'caution' | 'critical'; text: string }[];
}

export interface OrbitOutcome {
  success: boolean;
  reason: 'stable' | 'crash' | 'escape' | 'no_fuel' | 'burnup';
  title: string;
  explanation: string;
  requiredDeltaV: number;
  remainingDeltaV: number;
}

export const NASA_BUDGET_LIMIT_M = 1000;
export const NASA_MASS_LIMIT_KG = 6500;

const earthLeoMetrics = computePlanetaryOrbitMetrics(
  MU_EARTH_KM3_S2,
  R_EARTH_KM,
  540,
  SOLAR_SYSTEM_EPHEMERIS.earth.surfaceGravityMs2
);

const moonOrbitMetrics = computePlanetaryOrbitMetrics(
  MOON_ORBIT_ELEMENTS.muKm3s2,
  MOON_ORBIT_ELEMENTS.meanRadiusKm,
  100,
  MOON_ORBIT_ELEMENTS.surfaceGravityMs2
);

const marsOrbitMetrics = computePlanetaryOrbitMetrics(
  SOLAR_SYSTEM_EPHEMERIS.mars.muKm3s2,
  SOLAR_SYSTEM_EPHEMERIS.mars.meanRadiusKm,
  400,
  SOLAR_SYSTEM_EPHEMERIS.mars.surfaceGravityMs2
);

const psycheOrbitMetrics = computePlanetaryOrbitMetrics(
  SOLAR_SYSTEM_EPHEMERIS.asteroid.muKm3s2,
  SOLAR_SYSTEM_EPHEMERIS.asteroid.meanRadiusKm,
  65,
  SOLAR_SYSTEM_EPHEMERIS.asteroid.surfaceGravityMs2
);

const europaOrbitMetrics = computePlanetaryOrbitMetrics(
  EUROPA_ELEMENTS.muKm3s2,
  EUROPA_ELEMENTS.meanRadiusKm,
  200,
  EUROPA_ELEMENTS.surfaceGravityMs2
);

const proximaBMetrics = computePlanetaryOrbitMetrics(
  5.1e5, // ~1.27 Earth masses -> mu = 5.1e5 km^3/s^2
  7160,
  450,
  10.8
);

const lunarHohmann = computeLunarHohmann();
const marsHohmann = computeHeliocentricHohmann(SOLAR_SYSTEM_EPHEMERIS.mars.smaAU);
const psycheHohmann = computeHeliocentricHohmann(SOLAR_SYSTEM_EPHEMERIS.asteroid.smaAU);
const jupiterHohmann = computeHeliocentricHohmann(SOLAR_SYSTEM_EPHEMERIS.jupiter.smaAU);

export const WORLDS: Record<WorldId, WorldSpec> = {
  moon: {
    id: 'moon',
    name: 'The Moon',
    subtitle: 'Shackleton Crater · Lunar South Pole',
    category: 'LUNAR SURFACE',
    difficulty: 'STANDARD',
    gravity: 1.624,
    surfaceGravity: 1.624,
    earthG: 0.166,
    surfaceEarthG: 0.166,
    distanceLabel: '384,400 km',
    tripDuration: `${lunarHohmann.transferDays.toFixed(1)} Days (Hohmann)`,
    radioDelay: '1.28 s',
    radiationHazard: 'LOW',
    requiredShield: 'thin',
    solarFluxRatio: Number(computeSolarFluxRatio(1.0).toFixed(3)),
    hasAtmosphere: false,
    recommendedManeuver: 'retro_burn',
    approachVelocityKms: moonOrbitMetrics.escapeVelocityKms, // 2.38 km/s lunar escape
    captureBaseDeltaVms: 840, // Real LOI capture Δv (km/s -> m/s)
    idealAngleDeg: 0,
    angleToleranceDeg: 8,
    accentColor: '#cbd5e1',
    smaAU: 1.0,
    eccentricity: MOON_ORBIT_ELEMENTS.eccentricity,
    inclinationDeg: MOON_ORBIT_ELEMENTS.inclinationDeg,
    orbitalPeriodDays: MOON_ORBIT_ELEMENTS.periodDays,
    muKm3s2: MOON_ORBIT_ELEMENTS.muKm3s2,
    meanRadiusKm: MOON_ORBIT_ELEMENTS.meanRadiusKm,
    orbitAltitudeKm: 100,
    orbitRadius: 15.2,
    orbitSpeed: 0.3,
    planetRadius: 0.56,
    hohmannSummary: lunarHohmann,
    orbitMetrics: moonOrbitMetrics,
    description:
      'Low lunar gravity (1.624 m/s²) and 100% solar irradiance (1,361 W/m²). Airless world requiring a ~840 m/s LOI retro-burn at periapsis.',
    novaGuidance:
      'Low radiation and 1.624 m/s² gravity: a Light or Standard craft with Thin shielding leaves generous budget and Δv margins.',
    finalSummary:
      'Orbit stabilized above the gray cratered lunar regolith with a crisp curved horizon.',
  },
  earth: {
    id: 'earth',
    name: 'Earth Orbit',
    subtitle: '540 km Sun-Synchronous Orbital Corridor',
    category: 'LOW EARTH ORBIT',
    difficulty: 'STANDARD',
    gravity: 9.807,
    surfaceGravity: 9.807,
    earthG: 1.0,
    surfaceEarthG: 1.0,
    distanceLabel: '540 km Altitude',
    tripDuration: '9 Minutes (Ascent)',
    radioDelay: '< 0.01 s',
    radiationHazard: 'LOW',
    requiredShield: 'thin',
    solarFluxRatio: Number(computeSolarFluxRatio(1.0).toFixed(3)),
    hasAtmosphere: true,
    recommendedManeuver: 'retro_burn',
    approachVelocityKms: earthLeoMetrics.orbitalVelocityKms, // 7.592 km/s at 540 km
    captureBaseDeltaVms: 480,
    idealAngleDeg: 0,
    angleToleranceDeg: 9,
    accentColor: '#38bdf8',
    smaAU: SOLAR_SYSTEM_EPHEMERIS.earth.smaAU,
    eccentricity: SOLAR_SYSTEM_EPHEMERIS.earth.eccentricity,
    inclinationDeg: SOLAR_SYSTEM_EPHEMERIS.earth.inclinationDeg,
    orbitalPeriodDays: SOLAR_SYSTEM_EPHEMERIS.earth.periodDays,
    muKm3s2: MU_EARTH_KM3_S2,
    meanRadiusKm: R_EARTH_KM,
    orbitAltitudeKm: 540,
    orbitRadius: 13.8,
    orbitSpeed: 0.22,
    planetRadius: 1.48,
    hohmannSummary: {
      transferSmaLabel: '6,641 km',
      eccentricity: 0.0268,
      transferDays: 0.03,
      departureDvKms: 7.59,
      captureDvKms: 0.16,
      totalDvKms: 7.75,
      vDepartureKms: 7.79,
      vArrivalKms: 7.59,
      phaseAngleDeg: 0,
    },
    orbitMetrics: earthLeoMetrics,
    description:
      'Full 9.807 m/s² Earth gravity demands high liftoff TWR. Orbital velocity at 540 km is 7.59 km/s with a 95.4-minute period.',
    novaGuidance:
      'Earth’s 9.807 m/s² gravity demands strong thrust-to-weight. Thin radiation shielding is sufficient below the Van Allen belts.',
    finalSummary:
      'Observatory locked into stable orbital flight with the blue curvature of Earth gleaming below.',
  },
  mars: {
    id: 'mars',
    name: 'Mars',
    subtitle: 'Jezero Crater Delta · 1.524 AU',
    category: 'TERRESTRIAL PLANET',
    difficulty: 'MODERATE',
    gravity: 3.721,
    surfaceGravity: 3.721,
    earthG: 0.379,
    surfaceEarthG: 0.379,
    distanceLabel: '227.9M km (1.524 AU)',
    tripDuration: `${marsHohmann.transferDays} Days (Hohmann)`,
    radioDelay: '12.6 min (avg)',
    radiationHazard: 'MODERATE',
    requiredShield: 'medium',
    solarFluxRatio: Number(computeSolarFluxRatio(SOLAR_SYSTEM_EPHEMERIS.mars.smaAU).toFixed(3)),
    hasAtmosphere: true,
    recommendedManeuver: 'aerobraking',
    approachVelocityKms: SOLAR_SYSTEM_EPHEMERIS.mars.meanRadiusKm ? 5.027 : 5.03, // Escape vel 5.03 km/s
    captureBaseDeltaVms: 2100, // MOI + orbit circularization (or ~880 m/s with aerobraking)
    idealAngleDeg: -2,
    angleToleranceDeg: 6.5,
    accentColor: '#f97316',
    smaAU: SOLAR_SYSTEM_EPHEMERIS.mars.smaAU,
    eccentricity: SOLAR_SYSTEM_EPHEMERIS.mars.eccentricity,
    inclinationDeg: SOLAR_SYSTEM_EPHEMERIS.mars.inclinationDeg,
    orbitalPeriodDays: SOLAR_SYSTEM_EPHEMERIS.mars.periodDays,
    muKm3s2: SOLAR_SYSTEM_EPHEMERIS.mars.muKm3s2,
    meanRadiusKm: SOLAR_SYSTEM_EPHEMERIS.mars.meanRadiusKm,
    orbitAltitudeKm: 400,
    orbitRadius: 18.8,
    orbitSpeed: 0.16,
    planetRadius: 1.05,
    hohmannSummary: marsHohmann,
    orbitMetrics: marsOrbitMetrics,
    description:
      '38% Earth gravity (3.721 m/s²), 43.1% solar flux (1/1.524²), and a thin CO₂ atmosphere enabling fuel-saving aerobraking capture.',
    novaGuidance:
      'Interplanetary Hohmann transit takes ~259 days—equip Medium shielding and use Mars’s upper atmosphere for aerobraking!',
    finalSummary:
      'Captured into Martian orbit overlooking rust-red dusty ridges and ancient delta valleys.',
  },
  asteroid: {
    id: 'asteroid',
    name: '16 Psyche (Main Belt)',
    subtitle: 'Metallic Planetesimal · 2.923 AU',
    category: 'ASTEROID BELT',
    difficulty: 'MODERATE',
    gravity: 0.144,
    surfaceGravity: 0.144,
    earthG: 0.015,
    surfaceEarthG: 0.015,
    distanceLabel: '437.3M km (2.923 AU)',
    tripDuration: `${psycheHohmann.transferDays} Days (~2.5 Yr)`,
    radioDelay: '24.3 min (avg)',
    radiationHazard: 'MODERATE',
    requiredShield: 'medium',
    solarFluxRatio: Number(computeSolarFluxRatio(SOLAR_SYSTEM_EPHEMERIS.asteroid.smaAU).toFixed(3)),
    hasAtmosphere: false,
    recommendedManeuver: 'retro_burn',
    approachVelocityKms: psycheOrbitMetrics.escapeVelocityKms, // 0.17 km/s escape; rendezvous ~1.15 km/s
    captureBaseDeltaVms: 1650,
    idealAngleDeg: 0,
    angleToleranceDeg: 7.5,
    accentColor: '#fb7185',
    smaAU: SOLAR_SYSTEM_EPHEMERIS.asteroid.smaAU,
    eccentricity: SOLAR_SYSTEM_EPHEMERIS.asteroid.eccentricity,
    inclinationDeg: SOLAR_SYSTEM_EPHEMERIS.asteroid.inclinationDeg,
    orbitalPeriodDays: SOLAR_SYSTEM_EPHEMERIS.asteroid.periodDays,
    muKm3s2: SOLAR_SYSTEM_EPHEMERIS.asteroid.muKm3s2,
    meanRadiusKm: SOLAR_SYSTEM_EPHEMERIS.asteroid.meanRadiusKm,
    orbitAltitudeKm: 65,
    orbitRadius: 24.5,
    orbitSpeed: 0.11,
    planetRadius: 0.68,
    hohmannSummary: psycheHohmann,
    orbitMetrics: psycheOrbitMetrics,
    description:
      'Microgravity (0.144 m/s²) at 2.923 AU (11.7% sunlight). Escape velocity is only 170 m/s—overshooting easily sends a craft into heliocentric drift.',
    novaGuidance:
      'No atmosphere for aerobraking here, and sunlight drops to 11.7% (1/2.923²). Bring Medium shielding and consider Nuclear RTG for Heavy buses.',
    finalSummary:
      'Station-keeping orbit established around the rugged dark-metallic planetesimal in the Main Belt.',
  },
  jupiter: {
    id: 'jupiter',
    name: 'Jupiter / Europa',
    subtitle: 'Jovian Radiation Belt & Europa Ice Moon · 5.204 AU',
    category: 'OUTER GAS GIANT',
    difficulty: 'EXTREME',
    gravity: 24.79, // Jovian gravity well for mission sizing
    surfaceGravity: EUROPA_ELEMENTS.surfaceGravityMs2, // 1.315 m/s^2 on Europa's ice shell
    earthG: 2.528,
    surfaceEarthG: 0.134,
    distanceLabel: '778.6M km (5.204 AU)',
    tripDuration: `${jupiterHohmann.transferDays} Days (~2.7 Yr Hohmann)`,
    radioDelay: '43.3 min (avg)',
    radiationHazard: 'EXTREME',
    requiredShield: 'thick',
    solarFluxRatio: Number(computeSolarFluxRatio(SOLAR_SYSTEM_EPHEMERIS.jupiter.smaAU).toFixed(3)),
    hasAtmosphere: false,
    recommendedManeuver: 'gravity_assist',
    approachVelocityKms: EUROPA_ELEMENTS.orbitalSpeedKms, // 13.743 km/s at Europa's 671,034 km orbit
    captureBaseDeltaVms: 3050, // High JOI + Europa capture Δv (reduced to ~1,980 m/s via Galilean gravity assist)
    idealAngleDeg: 3,
    angleToleranceDeg: 5.5,
    accentColor: '#f59e0b',
    smaAU: SOLAR_SYSTEM_EPHEMERIS.jupiter.smaAU,
    eccentricity: SOLAR_SYSTEM_EPHEMERIS.jupiter.eccentricity,
    inclinationDeg: SOLAR_SYSTEM_EPHEMERIS.jupiter.inclinationDeg,
    orbitalPeriodDays: SOLAR_SYSTEM_EPHEMERIS.jupiter.periodDays,
    muKm3s2: EUROPA_ELEMENTS.muKm3s2, // Europa orbital capture & de-orbit frame
    meanRadiusKm: EUROPA_ELEMENTS.meanRadiusKm,
    orbitAltitudeKm: 200,
    orbitRadius: 31.8,
    orbitSpeed: 0.075,
    planetRadius: 2.35,
    hohmannSummary: jupiterHohmann,
    orbitMetrics: europaOrbitMetrics,
    description:
      'Deep Jovian gravity well (24.79 m/s² 1-bar; Europa surface 1.315 m/s²), 3.7% sunlight (1/5.204²), and extreme radiation belts. Galilean gravity assist saves ~35% capture Δv.',
    novaGuidance:
      'Extreme radiation and 3.7% sunlight! Equip Heavy spacecraft, Thick radiation shielding (300 kg / $40M), Nuclear RTG, and use Gravity Assist.',
    finalSummary:
      'Protected behind Thick radiation armor on Europa’s 1.315 m/s² ice shell with giant banded Jupiter filling the sky.',
  },
  colony: {
    id: 'colony',
    name: 'Proxima b (New Eden)',
    subtitle: 'Alpha Centauri Interstellar Outpost · 4.2465 ly',
    category: 'EXOPLANET COLONY',
    difficulty: 'HIGH',
    gravity: 10.8,
    surfaceGravity: 10.8,
    earthG: 1.101,
    surfaceEarthG: 1.101,
    distanceLabel: '4.2465 Light Years',
    tripDuration: '18 Months (Relativistic Cruise)',
    radioDelay: '4.25 Years',
    radiationHazard: 'HIGH',
    requiredShield: 'thick',
    solarFluxRatio: 0.65, // Proxima b receives ~65% Earth irradiance from M5.5Ve red dwarf at 0.04856 AU
    hasAtmosphere: true,
    recommendedManeuver: 'aerobraking',
    approachVelocityKms: 9.4,
    captureBaseDeltaVms: 2850,
    idealAngleDeg: -1,
    angleToleranceDeg: 6.0,
    accentColor: '#14b8a6',
    smaAU: 0.04856, // Semi-major axis around Proxima Centauri
    eccentricity: 0.02,
    inclinationDeg: 1.5,
    orbitalPeriodDays: 11.186,
    muKm3s2: 5.1e5,
    meanRadiusKm: 7160,
    orbitAltitudeKm: 450,
    orbitRadius: 58.0,
    orbitSpeed: 0.04,
    planetRadius: 1.55,
    hohmannSummary: {
      transferSmaLabel: '2.123 ly',
      eccentricity: 0.9999,
      transferDays: 548,
      departureDvKms: 9.4,
      captureDvKms: 2.85,
      totalDvKms: 12.25,
      vDepartureKms: 42.1,
      vArrivalKms: 9.4,
      phaseAngleDeg: 0,
    },
    orbitMetrics: proximaBMetrics,
    description:
      'Rocky exoplanet orbiting Proxima Centauri (a = 0.0486 AU, T = 11.2 d) with 65% irradiance, frequent M-dwarf XUV flares, and 10.8 m/s² gravity.',
    novaGuidance:
      'Proxima Centauri emits strong stellar flares—Thick shielding is strongly advised, and atmospheric aerobraking cuts capture Δv by 55%.',
    finalSummary:
      'Stable survey orbit confirmed over the orange alien terrain and illuminated blue colony biodome.',
  },
};

export const WORLD_LIST: WorldSpec[] = [
  WORLDS.moon,
  WORLDS.earth,
  WORLDS.mars,
  WORLDS.asteroid,
  WORLDS.jupiter,
  WORLDS.colony,
];

export const CRAFT_CLASSES: CraftClassSpec[] = [
  {
    id: 'light',
    name: 'Light Scout (Mk-I)',
    subtitle: 'Compact carbon-composite bus',
    dryMassKg: 1180,
    fuelCapacityKg: 1950,
    costM: 320,
    thrustN: 36000,
    ispSec: 345,
    powerGenW: 1200,
    powerDrawW: 380,
    solarPanels: 2,
    description:
      'Low structural mass and cost (Isp 345 s). Ideal for Moon, LEO, and Asteroid missions; tight Δv for Jupiter.',
  },
  {
    id: 'standard',
    name: 'Standard Explorer (Titan-II)',
    subtitle: 'Balanced NASA deep-space bus',
    dryMassKg: 1750,
    fuelCapacityKg: 3100,
    costM: 540,
    thrustN: 76000,
    ispSec: 385,
    powerGenW: 1800,
    powerDrawW: 520,
    solarPanels: 4,
    description:
      'Proven gold-foil bus with twin 2-wing solar blankets and methalox propulsion (Isp 385 s). Balances Δv margin and cost.',
  },
  {
    id: 'heavy',
    name: 'Heavy Deep-Space (DeepForge)',
    subtitle: 'High-thrust cryogenic flagship',
    dryMassKg: 2200,
    fuelCapacityKg: 3600,
    costM: 780,
    thrustN: 185000,
    ispSec: 452,
    powerGenW: 2400,
    powerDrawW: 720,
    solarPanels: 6,
    description:
      'LH2/LOX cryogenic engine (Isp 452 s, 185 kN) built for Jupiter’s 24.79 m/s² gravity well and interstellar captures.',
  },
];

export const SHIELD_TIERS: ShieldTierSpec[] = [
  {
    id: 'thin',
    name: 'Thin Shielding',
    massKg: 40,
    costM: 5,
    protectionRating: 1,
    shellOpacity: 0.16,
    description: 'Lightweight multi-layer foil wrap (+40 kg, $5M). Sufficient for Moon & LEO.',
  },
  {
    id: 'medium',
    name: 'Medium Shielding',
    massKg: 120,
    costM: 15,
    protectionRating: 2,
    shellOpacity: 0.3,
    description: 'Boron-polyethylene composite shell (+120 kg, $15M). Built for Mars & Asteroid Belt.',
  },
  {
    id: 'thick',
    name: 'Thick Shielding',
    massKg: 300,
    costM: 40,
    protectionRating: 3,
    shellOpacity: 0.48,
    description: 'Heavy tungsten-hydrogen radiation vault (+300 kg, $40M). Required for Jupiter & Proxima b.',
  },
];

export const POWER_SOURCES: PowerSourceSpec[] = [
  {
    id: 'solar_array',
    name: 'Blue Photovoltaic Wings',
    massKg: 180,
    costM: 45,
    baseWatts: 2800,
    solarDependent: true,
    description: 'Follows 1/r² solar law: 100% at 1 AU, 43% at Mars, 11.7% at Psyche, 3.7% at Jupiter.',
  },
  {
    id: 'nuclear_rtg',
    name: 'Nuclear Stirling RTG',
    massKg: 360,
    costM: 140,
    baseWatts: 2100,
    solarDependent: false,
    description: 'Steady plutonium-238 radioisotope power anywhere in the outer solar system.',
  },
];

export const DEFAULT_HANGAR_CONFIG: HangarConfig = {
  craftClass: 'standard',
  shieldTier: 'medium',
  powerSource: 'solar_array',
};

export function computeCraftStats(config: HangarConfig, worldId: WorldId): CraftStats {
  const world = WORLDS[worldId];
  const craft = CRAFT_CLASSES.find((c) => c.id === config.craftClass) || CRAFT_CLASSES[1];
  const shield = SHIELD_TIERS.find((s) => s.id === config.shieldTier) || SHIELD_TIERS[1];
  const power = POWER_SOURCES.find((p) => p.id === config.powerSource) || POWER_SOURCES[0];

  const dryMassKg = craft.dryMassKg + shield.massKg + power.massKg;
  const fuelMassKg = craft.fuelCapacityKg;
  const totalMassKg = dryMassKg + fuelMassKg;
  const remainingMassKg = NASA_MASS_LIMIT_KG - totalMassKg;

  const totalCostM = craft.costM + shield.costM + power.costM;
  const remainingBudgetM = NASA_BUDGET_LIMIT_M - totalCostM;

  const effectiveGenW = power.solarDependent
    ? Math.round((craft.powerGenW * 0.4 + power.baseWatts) * world.solarFluxRatio)
    : Math.round(craft.powerGenW * 0.25 + power.baseWatts);
  const netPowerW = effectiveGenW - craft.powerDrawW;

  const weightN = totalMassKg * world.gravity;
  const twrOnTarget = weightN > 0 ? craft.thrustN / weightN : 0;

  // Exact Tsiolkovsky Rocket Equation: Δv = Isp * g0 * ln(m0 / mf)
  const deltaV = Math.round(computeTsiolkovskyDeltaV(craft.ispSec, totalMassKg, dryMassKg));

  const advisories: CraftStats['advisories'] = [];

  if (remainingMassKg < 0) {
    advisories.push({
      level: 'critical',
      text: `Over payload mass limit by ${Math.abs(remainingMassKg).toLocaleString()} kg! Choose a lighter craft or thinner shield.`,
    });
  }
  if (remainingBudgetM < 0) {
    advisories.push({
      level: 'critical',
      text: `Over NASA mission budget by $${Math.abs(remainingBudgetM)}M!`,
    });
  }
  if (twrOnTarget < 1.02) {
    advisories.push({
      level: 'critical',
      text: `TWR ${twrOnTarget.toFixed(2)}× is too low for ${world.name} (${world.gravity} m/s²). Upgrade to Heavy Deep-Space!`,
    });
  }
  if (netPowerW < 0) {
    advisories.push({
      level: 'critical',
      text: `Power deficit (${netPowerW} W) at ${(world.solarFluxRatio * 100).toFixed(1)}% sunlight (1/r² law). Switch to Nuclear Stirling RTG!`,
    });
  }

  const reqShieldRank =
    world.requiredShield === 'thick' ? 3 : world.requiredShield === 'medium' ? 2 : 1;
  if (shield.protectionRating < reqShieldRank) {
    advisories.push({
      level: 'caution',
      text: `${world.name} has ${world.radiationHazard} radiation — ${world.requiredShield.toUpperCase()} shielding is recommended.`,
    });
  }

  if (advisories.length === 0) {
    advisories.push({
      level: 'nominal',
      text: `Craft certified for ${world.name}: ${deltaV.toLocaleString()} m/s Δv (Tsiolkovsky) · TWR ${twrOnTarget.toFixed(
        2
      )}× · Power +${netPowerW} W.`,
    });
  }

  let score = 100;
  if (remainingMassKg < 0) score -= 25;
  if (remainingBudgetM < 0) score -= 20;
  if (twrOnTarget < 1.02) score -= 35;
  if (netPowerW < 0) score -= 25;
  if (shield.protectionRating < reqShieldRank) score -= 15;

  return {
    totalMassKg,
    dryMassKg,
    fuelMassKg,
    massLimitKg: NASA_MASS_LIMIT_KG,
    remainingMassKg,
    totalCostM,
    budgetLimitM: NASA_BUDGET_LIMIT_M,
    remainingBudgetM,
    shieldMassKg: shield.massKg,
    shieldCostM: shield.costM,
    netPowerW,
    thrustN: craft.thrustN,
    twrOnTarget,
    deltaV,
    readinessScore: Math.max(15, Math.min(100, score)),
    advisories,
  };
}

export function computeRequiredInsertionDeltaV(params: {
  world: WorldSpec;
  maneuver: ManeuverType;
  burnTimingAccuracy: number;
}): number {
  const { world, maneuver, burnTimingAccuracy } = params;
  const maneuverMultiplier =
    maneuver === 'aerobraking' ? 0.42 : maneuver === 'gravity_assist' ? 0.65 : 1.0;
  const timingPenalty = 1 + (1 - Math.max(0, Math.min(1, burnTimingAccuracy))) * 0.45;
  return Math.round(world.captureBaseDeltaVms * maneuverMultiplier * timingPenalty);
}

export function evaluateOrbitInsertion(params: {
  world: WorldSpec;
  stats: CraftStats;
  maneuver: ManeuverType;
  approachAngleDeg: number;
  burnTimingAccuracy: number; // 0..1 where 1 = dead center of periapsis window
}): OrbitOutcome {
  const { world, stats, maneuver, approachAngleDeg, burnTimingAccuracy } = params;
  const angleDelta = Math.abs(approachAngleDeg - world.idealAngleDeg);

  // Check invalid aerobraking on airless world
  if (maneuver === 'aerobraking' && !world.hasAtmosphere) {
    return {
      success: false,
      reason: 'escape',
      title: 'Aerobraking Failed — No Atmosphere',
      explanation: `${world.name} has virtually no atmosphere to slow your spacecraft. Without atmospheric drag, the craft skipped past on a hyperbolic escape trajectory! Use Retro-Burn or Gravity Assist.`,
      requiredDeltaV: 0,
      remainingDeltaV: stats.deltaV,
    };
  }

  // Check steep crash angle
  if (approachAngleDeg < world.idealAngleDeg - world.angleToleranceDeg) {
    return {
      success: false,
      reason: maneuver === 'aerobraking' ? 'burnup' : 'crash',
      title:
        maneuver === 'aerobraking'
          ? 'Atmospheric Entry Burn-Up'
          : 'Impact Trajectory — Too Steep',
      explanation: `Approach angle (${approachAngleDeg.toFixed(
        1
      )}°) dipped too steeply into ${world.name}’s gravity well. Steep angles cause destructive heating or surface impact.`,
      requiredDeltaV: 0,
      remainingDeltaV: Math.max(0, stats.deltaV - 950),
    };
  }

  // Check shallow escape angle
  if (approachAngleDeg > world.idealAngleDeg + world.angleToleranceDeg) {
    return {
      success: false,
      reason: 'escape',
      title: 'Orbit Missed — Approach Too Shallow',
      explanation: `Approach angle (+${approachAngleDeg.toFixed(
        1
      )}°) was too shallow, so ${world.name}’s gravity couldn’t bend your trajectory enough to capture into orbit.`,
      requiredDeltaV: 0,
      remainingDeltaV: Math.max(0, stats.deltaV - 700),
    };
  }

  // Check timing accuracy at Periapsis
  if (burnTimingAccuracy < 0.52) {
    return {
      success: false,
      reason: 'escape',
      title: 'Missed Periapsis Burn Window',
      explanation:
        'Per the Oberth Effect, orbital capture burns are most efficient right at periapsis (closest approach). Firing off-window wasted kinetic energy and missed capture.',
      requiredDeltaV: 0,
      remainingDeltaV: Math.max(0, stats.deltaV - 1100),
    };
  }

  const requiredDv = computeRequiredInsertionDeltaV({
    world,
    maneuver,
    burnTimingAccuracy,
  });

  if (stats.deltaV < requiredDv) {
    return {
      success: false,
      reason: 'no_fuel',
      title: 'Propellant Exhausted Before Capture',
      explanation: `This maneuver required ${requiredDv.toLocaleString()} m/s Δv, but your craft only carried ${stats.deltaV.toLocaleString()} m/s (Tsiolkovsky limit). Try ${
        world.hasAtmosphere ? 'Aerobraking to save fuel' : 'Gravity Assist or a Heavy LH2/LOX craft'
      }!`,
      requiredDeltaV: requiredDv,
      remainingDeltaV: 0,
    };
  }

  const remainingDeltaV = stats.deltaV - requiredDv;
  const maneuverLabel =
    maneuver === 'aerobraking'
      ? 'Aerobraking Pass'
      : maneuver === 'gravity_assist'
      ? 'Gravity Assist Capture'
      : 'Periapsis Retro-Burn';

  return {
    success: true,
    reason: 'stable',
    title: `Stable ${world.name} Orbit Achieved`,
    explanation: `${maneuverLabel} executed cleanly at ${angleDelta.toFixed(
      1
    )}° off ideal corridor using ${requiredDv.toLocaleString()} m/s Δv (v_orb = ${
      world.orbitMetrics.orbitalVelocityKms
    } km/s). ${remainingDeltaV.toLocaleString()} m/s reserve remains.`,
    requiredDeltaV: requiredDv,
    remainingDeltaV,
  };
}

export type JourneyWarpSpeed = 1 | 1000 | 2000 | 10000;

export type SurfacePhase =
  | 'descending'
  | 'landed'
  | 'ramp_deploy'
  | 'rover_exit'
  | 'rover_active';

export interface LandingSiteSpec {
  id: string;
  name: string;
  angleDeg: number; // 0..360 around equatorial orbit plane
  terrainType: string;
  risk: 'LOW' | 'MODERATE' | 'HIGH';
  scienceValue: string;
  description: string;
}

export const LANDING_SITES: Record<WorldId, LandingSiteSpec[]> = {
  moon: [
    {
      id: 'shackleton_rim',
      name: 'Shackleton Crater Rim',
      angleDeg: 35,
      terrainType: 'Sunlit Ridge · Water Ice Edge',
      risk: 'LOW',
      scienceValue: 'Polar Ice & Eternal Sunlight',
      description: 'Flat high-illumination ridge ideal for vertical landing and rover traverse.',
    },
    {
      id: 'mare_tranquillitatis',
      name: 'Mare Tranquillitatis',
      angleDeg: 150,
      terrainType: 'Smooth Basalt Plain',
      risk: 'LOW',
      scienceValue: 'Ancient Volcanic Regolith',
      description: 'Wide low-slope basalt floor with minimal boulder hazards.',
    },
    {
      id: 'tycho_central',
      name: 'Tycho Central Peak',
      angleDeg: 265,
      terrainType: 'Crater Uplift · Steep Terrace',
      risk: 'MODERATE',
      scienceValue: 'Deep Lunar Crustal Ejecta',
      description: 'Rugged highland ejecta requiring precise overhead de-orbit alignment.',
    },
  ],
  earth: [
    {
      id: 'atlantic_drone_pad',
      name: 'Atlantic Recovery Platform',
      angleDeg: 40,
      terrainType: 'Autonomous Ocean Landing Pad',
      risk: 'LOW',
      scienceValue: 'Orbital Re-Entry & Recovery',
      description: 'Stabilized offshore recovery deck for vertical retro-propulsive touchdown.',
    },
    {
      id: 'kennedy_coastal',
      name: 'Cape Canaveral Landing Zone 1',
      angleDeg: 165,
      terrainType: 'Concrete Coastal Pad',
      risk: 'LOW',
      scienceValue: 'Precision RTLS Touchdown',
      description: 'Primary coastal recovery apron with full telemetry tracking.',
    },
    {
      id: 'pacific_atoll',
      name: 'Equatorial Atoll Test Range',
      angleDeg: 280,
      terrainType: 'Coral Island Pad',
      risk: 'MODERATE',
      scienceValue: 'Cross-Range Aerocapture',
      description: 'Remote equatorial recovery strip testing high-energy de-orbit accuracy.',
    },
  ],
  mars: [
    {
      id: 'jezero_delta',
      name: 'Jezero Crater Delta',
      angleDeg: 45,
      terrainType: 'Ancient River Delta Basin',
      risk: 'LOW',
      scienceValue: 'Biosignature Clay Minerals',
      description: 'NASA Perseverance landing zone with flat sediment plains for rover science.',
    },
    {
      id: 'elysium_planitia',
      name: 'Elysium Planitia',
      angleDeg: 170,
      terrainType: 'Broad Volcanic Plain',
      risk: 'LOW',
      scienceValue: 'Seismic & Subsurface Ice',
      description: 'Extremely smooth equatorial plain offering maximum landing safety.',
    },
    {
      id: 'valles_rim',
      name: 'Valles Marineris Rim',
      angleDeg: 285,
      terrainType: 'Canyon Plateau Edge',
      risk: 'HIGH',
      scienceValue: 'Exposed Crustal Strata',
      description: 'High-value geological canyon terrace with steeper descent winds.',
    },
  ],
  asteroid: [
    {
      id: 'nightingale_crater',
      name: 'Nightingale Crater Floor',
      angleDeg: 30,
      terrainType: 'Fine Carbonaceous Regolith',
      risk: 'LOW',
      scienceValue: 'Pristine Solar Nebula Organics',
      description: 'Sheltered microgravity basin suited for soft thruster touchdown.',
    },
    {
      id: 'psyche_ridge',
      name: 'Psyche Nickel-Iron Ridge',
      angleDeg: 155,
      terrainType: 'Metallic Core Exposure',
      risk: 'MODERATE',
      scienceValue: 'Planetesimal Metallic Core',
      description: 'Dense iron-nickel outcrop ideal for magnetic rover anchoring.',
    },
    {
      id: 'equatorial_boulder',
      name: 'Equatorial Boulder Field',
      angleDeg: 270,
      terrainType: 'Fractured Rubble Pile',
      risk: 'HIGH',
      scienceValue: 'Impact Breccia Diversity',
      description: 'Uneven rubble surface demanding careful microgravity descent.',
    },
  ],
  jupiter: [
    {
      id: 'conamara_chaos',
      name: 'Conamara Chaos Ice Shelf',
      angleDeg: 50,
      terrainType: 'Refrozen Ocean Ice Raft',
      risk: 'LOW',
      scienceValue: 'Subsurface Brine Plumes',
      description: 'Relatively level cryogenic ice floe directly beneath giant Jupiter.',
    },
    {
      id: 'pwyll_ejecta',
      name: 'Pwyll Crater Ice Plain',
      angleDeg: 180,
      terrainType: 'Fresh Water-Ice Blanket',
      risk: 'MODERATE',
      scienceValue: 'Pure Subsurface Ice Sample',
      description: 'Bright fresh ice sheet exposed by recent impact excavation.',
    },
    {
      id: 'thrace_lineae',
      name: 'Thrace Macula Fracture',
      angleDeg: 295,
      terrainType: 'Tectonic Double-Ridge',
      risk: 'HIGH',
      scienceValue: 'Active Hydrated Salt Vent',
      description: 'Dark reddish tectonic fissure with extreme radiation & ridge relief.',
    },
  ],
  colony: [
    {
      id: 'new_eden_pad',
      name: 'New Eden Biodome Pad',
      angleDeg: 40,
      terrainType: 'Leveled Outpost Apron',
      risk: 'LOW',
      scienceValue: 'Colony Resupply & Rover Link',
      description: 'Cleared landing zone adjacent to the blue geodesic colony biodome.',
    },
    {
      id: 'terminator_valley',
      name: 'Twilight Terminator Valley',
      angleDeg: 165,
      terrainType: 'Basaltic Liquid-Water Belt',
      risk: 'LOW',
      scienceValue: 'Habitable Temperate Zone',
      description: 'Mild twilight zone between scorching dayside and frozen nightside.',
    },
    {
      id: 'flare_caldera',
      name: 'Proxima Volcanic Caldera',
      angleDeg: 280,
      terrainType: 'Tidal-Flexed Basalt Rim',
      risk: 'HIGH',
      scienceValue: 'Geothermal Exoplanet Core',
      description: 'Active basaltic highlands exposed to intense Proxima Centauri flares.',
    },
  ],
};
