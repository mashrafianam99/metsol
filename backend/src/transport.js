const DAYS = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

const text = (value) => typeof value === 'string' ? value.trim() : '';

function optionalTime(value) {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' && TIME_PATTERN.test(value) ? value : undefined;
}

function normalizeCoordinates(value, maximum = 500) {
  if (!Array.isArray(value) || value.length > maximum) return undefined;
  const coordinates = [];
  for (const point of value) {
    const lat = Number(point?.lat);
    const lng = Number(point?.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return undefined;
    }
    coordinates.push({ lat, lng });
  }
  return coordinates;
}

export function normalizeBusInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Enter the bus details to continue.' };
  const name = text(body.name);
  const number = text(body.number);
  const startingPoint = text(body.startingPoint);
  const destination = text(body.destination);
  const duration = Number(body.estimatedDurationMinutes);
  const capacity = body.capacity === '' || body.capacity === null || body.capacity === undefined ? null : Number(body.capacity);
  const routeId = body.routeId === '' || body.routeId === null || body.routeId === undefined ? null : text(body.routeId);
  const operatingDays = body.operatingDays;

  if (!name || name.length > 100 || !number || number.length > 40 || !startingPoint || startingPoint.length > 160 || !destination || destination.length > 160) {
    return { error: 'Enter a bus name, unique number, starting point, and destination within the allowed lengths.' };
  }
  if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
    return { error: 'Estimated journey duration must be from 1 to 1440 minutes.' };
  }
  if (!Array.isArray(operatingDays) || operatingDays.length === 0 || operatingDays.some((day) => !DAYS.has(day)) || new Set(operatingDays).size !== operatingDays.length) {
    return { error: 'Choose one or more valid operating days.' };
  }
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000)) {
    return { error: 'Passenger capacity must be from 1 to 1000.' };
  }
  const morningSchedule = optionalTime(body.morningSchedule);
  const afternoonSchedule = optionalTime(body.afternoonSchedule);
  const returnSchedule = optionalTime(body.returnSchedule);
  if (morningSchedule === undefined || afternoonSchedule === undefined || returnSchedule === undefined) {
    return { error: 'Enter bus schedule times in 24-hour HH:MM format.' };
  }
  if (typeof body.isActive !== 'boolean') return { error: 'Choose whether the bus is active.' };

  return {
    value: {
      name, number, startingPoint, destination,
      estimatedDurationMinutes: duration,
      operatingDays,
      morningSchedule, afternoonSchedule, returnSchedule,
      capacity, routeId, isActive: body.isActive,
    },
  };
}

export function normalizeStopInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Enter the bus stop details to continue.' };
  const name = text(body.name);
  const area = text(body.area);
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const osmId = text(body.osmId);
  const description = text(body.description);
  const landmark = text(body.landmark);
  if (!name || name.length > 120 || !area || area.length > 160) return { error: 'Enter a stop name and area within the allowed lengths.' };
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { error: 'Enter valid latitude and longitude coordinates.' };
  }
  if (osmId.length > 100 || description.length > 1000 || landmark.length > 160) {
    return { error: 'Stop description, landmark, or map reference is too long.' };
  }
  return { value: { name, area, latitude, longitude, osmId: osmId || null, description: description || null, landmark: landmark || null } };
}

export function normalizeRouteInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Enter the route details to continue.' };
  const name = text(body.name);
  const startingPoint = text(body.startingPoint);
  const destination = text(body.destination);
  const description = text(body.description);
  if (!name || name.length > 120 || !startingPoint || startingPoint.length > 160 || !destination || destination.length > 160 || description.length > 2000) {
    return { error: 'Enter a route name, starting point, and destination within the allowed lengths.' };
  }
  if (!Array.isArray(body.stops) || body.stops.length < 2 || body.stops.length > 100) {
    return { error: 'A route must include between 2 and 100 ordered stops.' };
  }
  const seenStops = new Set();
  const stops = [];
  for (const [index, stop] of body.stops.entries()) {
    const busStopId = text(stop?.busStopId);
    const arrivalTime = optionalTime(stop?.arrivalTime);
    const departureTime = optionalTime(stop?.departureTime);
    if (!busStopId || seenStops.has(busStopId)) return { error: 'Select each existing stop only once in the route.' };
    if (arrivalTime === undefined || departureTime === undefined) return { error: 'Enter route stop times in 24-hour HH:MM format.' };
    seenStops.add(busStopId);
    stops.push({ busStopId, sequence: index + 1, arrivalTime, departureTime });
  }

  let geometry = null;
  let geometrySource = null;
  if (body.geometry !== undefined && body.geometry !== null) {
    geometry = normalizeCoordinates(body.geometry);
    if (!geometry || geometry.length < 2) return { error: 'Route geometry must contain at least 2 valid map points.' };
    if (!['MANUAL', 'OSRM'].includes(body.geometrySource)) return { error: 'Choose a supported route geometry source.' };
    geometrySource = body.geometrySource;
  }
  return {
    value: {
      name, startingPoint, destination,
      description: description || null,
      geometry, geometrySource, stops,
    },
  };
}

export function transportAdminRoleAllowed(role) {
  return role === 'ADMIN' || role === 'TRANSPORT_ADMIN';
}

export function normalizeTransportAdminInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Enter the account details to continue.' };
  const name = text(body.name);
  const email = text(body.email).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 320) {
    return { error: 'Enter a name and a valid email address.' };
  }
  if (password.length < 12 || password.length > 1024) return { error: 'Set an initial password with at least 12 characters.' };
  return { value: { name, email, password } };
}

export function normalizeNoticeInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Enter the notice details to continue.' };
  const title = text(body.title);
  const bodyText = text(body.body);
  if (!title || title.length > 160 || !bodyText || bodyText.length > 10000) {
    return { error: 'Enter a notice title and message within the allowed lengths.' };
  }
  return { value: { title, body: bodyText } };
}

export function normalizeSearchQuery(value) {
  const query = text(value);
  return query.length >= 3 && query.length <= 160 ? query : null;
}
