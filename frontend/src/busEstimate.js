// Timetable-based bus positions. There is no live GPS: a bus is placed along its road
// according to how far through its scheduled trip it should be right now.

const EARTH_RADIUS_M = 6_371_000;
const MAX_WALK_METERS = 1200; // farther than this from a route, the rider is not offered that bus

export const toMinutes = (time) => {
  if (!time) return null;
  const [h, m] = String(time).split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

export const formatTime = (minutes) => {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60) % 24;
  return `${((h + 11) % 12) + 1}:${String(total % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/** Current time in Bangladesh as { minutes since midnight, weekday name }. */
export function dhakaClock(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka", weekday: "long", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return { minutes: Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60, day: parts.weekday };
}

export function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Road geometry with cumulative distances, so positions can be looked up by metres travelled. */
export function buildPath(geometry) {
  const points = (geometry || []).map(({ lat, lng }) => ({ lat: Number(lat), lng: Number(lng) }));
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) cum.push(cum[i - 1] + distanceMeters(points[i - 1], points[i]));
  return { points, cum, total: cum[cum.length - 1] || 0 };
}

export function pointAt(path, meters) {
  const { points, cum, total } = path;
  const d = Math.min(Math.max(meters, 0), total);
  let i = 1;
  while (i < points.length - 1 && cum[i] < d) i += 1;
  const a = points[i - 1];
  const b = points[i] || a;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (d - cum[i - 1]) / seg;
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/** Compass bearing (degrees) of travel at a given distance, for rotating the bus icon. */
export function bearingAt(path, meters, forward = true) {
  const ahead = pointAt(path, meters + (forward ? 25 : -25));
  const here = pointAt(path, meters);
  return (Math.atan2(ahead.lng - here.lng, ahead.lat - here.lat) * 180) / Math.PI;
}

/** Closest point on the road to the rider: how far along it is, and how far the rider must walk. */
export function project(path, rider) {
  const { points, cum } = path;
  const mPerLat = 110_540;
  const mPerLng = 111_320 * Math.cos((rider.lat * Math.PI) / 180);
  let best = { along: 0, offset: Infinity };
  for (let i = 1; i < points.length; i += 1) {
    const ax = (points[i - 1].lng - rider.lng) * mPerLng;
    const ay = (points[i - 1].lat - rider.lat) * mPerLat;
    const bx = (points[i].lng - rider.lng) * mPerLng;
    const by = (points[i].lat - rider.lat) * mPerLat;
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const t = Math.min(1, Math.max(0, -(ax * (bx - ax) + ay * (by - ay)) / len2));
    const offset = Math.hypot(ax + (bx - ax) * t, ay + (by - ay) * t);
    if (offset < best.offset) best = { along: cum[i - 1] + (cum[i] - cum[i - 1]) * t, offset };
  }
  return best;
}

/** Scheduled trips for today: morning and afternoon go to campus, the return trip leaves it. */
export function tripsFor(bus) {
  const duration = Number(bus.estimatedDurationMinutes) || 0;
  return [
    { label: "Morning", start: toMinutes(bus.morningSchedule), toCampus: true },
    { label: "Afternoon", start: toMinutes(bus.afternoonSchedule), toCampus: true },
    { label: "Return", start: toMinutes(bus.returnSchedule), toCampus: false },
  ]
    .filter((trip) => trip.start !== null && duration > 0)
    .map((trip) => ({ ...trip, end: trip.start + duration }))
    .sort((a, b) => a.start - b.start);
}

const runsToday = (bus, clock) => !bus.operatingDays?.length || bus.operatingDays.includes(clock.day);
const metersAlong = (trip, path, now) => {
  const fraction = Math.min(1, Math.max(0, (now - trip.start) / (trip.end - trip.start)));
  return trip.toCampus ? fraction * path.total : (1 - fraction) * path.total;
};

/** Where the bus should be right now according to its timetable. */
export function estimateBus(bus, path, clock) {
  const start = path.points[0];
  const campus = path.points[path.points.length - 1];
  if (!runsToday(bus, clock)) return { state: "off-day", position: start, toCampus: true };

  const now = clock.minutes;
  const trips = tripsFor(bus);
  const running = trips.find((trip) => trip.start <= now && now < trip.end);
  if (running) {
    const along = metersAlong(running, path, now);
    return {
      state: "moving", trip: running, toCampus: running.toCampus, along,
      position: pointAt(path, along), bearing: bearingAt(path, along, running.toCampus),
      arrivesCampusAt: running.toCampus ? running.end : null,
    };
  }
  const next = trips.find((trip) => trip.start > now);
  if (next) return { state: "waiting", trip: next, toCampus: next.toCampus, departsAt: next.start, position: next.toCampus ? start : campus };
  const last = trips[trips.length - 1];
  return { state: "finished", toCampus: false, position: last && !last.toCampus ? start : campus };
}

/**
 * For a rider standing somewhere, list each bus that can pick them up on its way to campus:
 * when it reaches them, how far away it is now, and whether it reaches campus before class.
 */
export function planForRider(entries, rider, clock, classStartMinutes) {
  const now = clock.minutes;
  return entries
    .map(({ bus, path, route }) => {
      if (!runsToday(bus, clock) || path.total <= 0) return null;
      const { along, offset } = project(path, rider);
      if (offset > MAX_WALK_METERS) return null;
      const share = along / path.total;
      const trip = tripsFor(bus)
        .filter((t) => t.toCampus)
        .find((t) => t.start + (t.end - t.start) * share >= now);
      if (!trip) return null;
      const busAlong = trip.start <= now ? metersAlong(trip, path, now) : 0;
      return {
        bus, route, trip,
        pickupAt: Math.round(trip.start + (trip.end - trip.start) * share),
        arrivesCampusAt: Math.round(trip.end),
        onTime: classStartMinutes == null || trip.end <= classStartMinutes,
        walkMeters: Math.round(offset),
        busMetersAway: Math.max(0, Math.round(along - busAlong)),
        pickupPoint: pointAt(path, along),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.pickupAt - b.pickupAt || a.walkMeters - b.walkMeters);
}
