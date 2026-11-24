// Seeds SAMPLE Metropolitan University bus routes that approach campus from different directions.
// Road paths come from the public OSRM router. Every row is marked as sample data so the
// transport office can edit or delete it in the portal's admin tools.
// Run: npm run seed:transport   (safe to re-run; it updates the same sample rows)
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const OSRM = (process.env.OSRM_ROUTING_URL || 'https://router.project-osrm.org').replace(/\/+$/u, '');
const SAMPLE_NOTE = 'Sample route for demonstration. Replace with the official MU transport timetable.';
const WEEKDAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];
const CAMPUS = { name: 'MU Main Campus', area: 'Molaitila, Sylhet–Tamabil Highway', lat: 24.929568, lng: 91.973491 };

// Stops are listed from the origin towards campus. Coordinates are from OpenStreetMap.
const ROUTES = [
  { number: 'MU-01', bus: 'Tilagor Express', name: 'Tilagor → Campus', morning: '07:40', afternoon: '12:40', ret: '16:50',
    stops: [{ name: 'Tilagor Point', area: 'Tilagor', lat: 24.896191, lng: 91.899531 }, { name: 'Khadimpara', area: 'Khadimpara', lat: 24.905583, lng: 91.923337 }] },
  { number: 'MU-02', bus: 'Zindabazar Line', name: 'Zindabazar → Campus', morning: '07:20', afternoon: '12:20', ret: '16:40',
    stops: [{ name: 'Chowhatta', area: 'Chowhatta', lat: 24.899174, lng: 91.865469 }, { name: 'Zindabazar', area: 'Zindabazar', lat: 24.894918, lng: 91.868182 }, { name: 'Naiorpul', area: 'Naiorpul', lat: 24.89477, lng: 91.878669 }, { name: 'Shibganj', area: 'Shibganj', lat: 24.895203, lng: 91.890728 }] },
  { number: 'MU-03', bus: 'Amberkhana Shuttle', name: 'Amberkhana → Campus', morning: '07:25', afternoon: '12:25', ret: '16:45',
    stops: [{ name: 'Amberkhana Point', area: 'Amberkhana', lat: 24.909727, lng: 91.868919 }, { name: 'Shahi Eidgah', area: 'Shahi Eidgah', lat: 24.905942, lng: 91.880619 }, { name: 'Kumarpara', area: 'Kumarpara', lat: 24.902231, lng: 91.879608 }] },
  { number: 'MU-04', bus: 'Upashahar Line', name: 'Upashahar → Campus', morning: '07:30', afternoon: '12:30', ret: '16:55',
    stops: [{ name: 'Shahjalal Upashahar', area: 'Upashahar', lat: 24.889194, lng: 91.88889 }, { name: 'Mirabazar', area: 'Mirabazar', lat: 24.894738, lng: 91.879358 }] },
  { number: 'MU-05', bus: 'Shahporan Link', name: 'Shahporan → Campus', morning: '07:50', afternoon: '12:50', ret: '17:00',
    stops: [{ name: 'Shahporan Mazar', area: 'Shahporan', lat: 24.906768, lng: 91.934664 }] },
  { number: 'MU-06', bus: 'Bateshwar Link', name: 'Bateshwar → Campus', morning: '08:00', afternoon: '13:00', ret: '17:05',
    stops: [{ name: 'Bateshwar Bazar', area: 'Bateshwar', lat: 24.936902, lng: 91.985052 }] },
];

const hhmm = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(Math.round(minutes) % 60).padStart(2, '0')}`;
const toMinutes = (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };

async function roadPath(points) {
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
  const response = await fetch(`${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson`, {
    headers: { 'User-Agent': 'smart-university-portal-seed' },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json();
  const route = data.routes?.[0];
  if (!response.ok || !route?.geometry?.coordinates?.length) throw new Error(`OSRM routing failed: ${data.message || response.status}`);
  return {
    geometry: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
    // Each leg ends at the next stop; city buses with stops and traffic run ~2.4x slower than OSRM's free-flow car estimate.
    legMinutes: route.legs.map((leg) => (leg.duration / 60) * 2.4),
  };
}

async function upsertStop({ name, area, lat, lng }) {
  const existing = await db.busStop.findFirst({ where: { name, area } });
  const data = { name, area, latitude: lat, longitude: lng, description: SAMPLE_NOTE };
  return existing ? db.busStop.update({ where: { id: existing.id }, data }) : db.busStop.create({ data });
}

async function seedRoute(def, campusStop) {
  const points = [...def.stops, CAMPUS];
  const { geometry, legMinutes } = await roadPath(points);
  const duration = Math.max(10, Math.round(legMinutes.reduce((sum, m) => sum + m, 0)));
  const stops = [...await Promise.all(def.stops.map(upsertStop)), campusStop];

  // Scheduled times for the morning trip, spaced by each road leg's travel time.
  let clock = toMinutes(def.morning);
  const times = stops.map((_, i) => { if (i > 0) clock += legMinutes[i - 1]; return hhmm(clock); });

  const routeData = { description: SAMPLE_NOTE, startingPoint: def.stops[0].name, destination: CAMPUS.name, geometry, geometrySource: 'OSRM' };
  const route = await db.transportRoute.upsert({ where: { name: def.name }, update: routeData, create: { name: def.name, ...routeData } });
  await db.routeStop.deleteMany({ where: { routeId: route.id } });
  await db.routeStop.createMany({
    data: stops.map((stop, i) => ({
      routeId: route.id, busStopId: stop.id, sequence: i + 1,
      arrivalTime: i === 0 ? null : times[i],
      departureTime: i === stops.length - 1 ? null : times[i],
    })),
  });

  const busData = {
    name: def.bus, routeId: route.id, startingPoint: def.stops[0].name, destination: CAMPUS.name,
    estimatedDurationMinutes: duration, operatingDays: WEEKDAYS,
    morningSchedule: def.morning, afternoonSchedule: def.afternoon, returnSchedule: def.ret,
    capacity: 40, isActive: true,
  };
  await db.bus.upsert({ where: { number: def.number }, update: busData, create: { number: def.number, ...busData } });
  console.log(`✓ ${def.number} ${def.name}: ${stops.length} stops, ${geometry.length} road points, ~${duration} min`);
}

async function main() {
  const campusStop = await upsertStop(CAMPUS);
  for (const def of ROUTES) {
    await seedRoute(def, campusStop);
    await new Promise((resolve) => setTimeout(resolve, 1100)); // be polite to the public OSRM server
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => db.$disconnect());
