import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBusInput,
  normalizeNoticeInput,
  normalizeRouteInput,
  normalizeSearchQuery,
  normalizeStopInput,
  normalizeTransportAdminInput,
  transportAdminRoleAllowed,
} from '../src/transport.js';

test('validates and normalizes bus data, schedules, and operating days', () => {
  const result = normalizeBusInput({
    name: ' Campus Shuttle ',
    number: ' MU-01 ',
    startingPoint: 'Uptown stop',
    destination: 'University',
    estimatedDurationMinutes: '50',
    operatingDays: ['Monday', 'Tuesday'],
    morningSchedule: '07:30',
    afternoonSchedule: '12:00',
    returnSchedule: '',
    capacity: '40',
    routeId: '',
    isActive: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.value.name, 'Campus Shuttle');
  assert.equal(result.value.number, 'MU-01');
  assert.equal(result.value.estimatedDurationMinutes, 50);
  assert.equal(result.value.capacity, 40);
  assert.equal(result.value.returnSchedule, null);
});

test('rejects invalid bus schedules, capacity, and days', () => {
  const base = {
    name: 'Bus',
    number: 'B1',
    startingPoint: 'Start',
    destination: 'Campus',
    estimatedDurationMinutes: 30,
    operatingDays: ['Monday'],
    morningSchedule: '25:65',
    isActive: true,
  };
  assert.match(normalizeBusInput(base).error, /HH:MM/u);
  assert.match(normalizeBusInput({ ...base, morningSchedule: '', capacity: 0 }).error, /capacity/u);
  assert.match(normalizeBusInput({ ...base, morningSchedule: '', operatingDays: ['Funday'] }).error, /operating days/u);
});

test('validates stop coordinates and optional OpenStreetMap metadata', () => {
  const valid = normalizeStopInput({
    name: 'Central stop',
    area: 'Sylhet',
    latitude: '24.9',
    longitude: '91.87',
    osmId: 'way/42',
  });
  assert.equal(valid.error, undefined);
  assert.equal(valid.value.latitude, 24.9);
  assert.equal(valid.value.osmId, 'way/42');
  assert.match(normalizeStopInput({ name: 'X', area: 'Y', latitude: 100, longitude: 0 }).error, /coordinates/u);
});

test('normalizes ordered routes and rejects duplicate stops or fake straight-line geometry', () => {
  const valid = normalizeRouteInput({
    name: 'Route North',
    startingPoint: 'North stop',
    destination: 'University',
    stops: [{ busStopId: 'a', arrivalTime: '07:00' }, { busStopId: 'b', departureTime: '08:00' }],
    geometry: [{ lat: 24.9, lng: 91.8 }, { lat: 24.91, lng: 91.82 }],
    geometrySource: 'MANUAL',
  });
  assert.equal(valid.error, undefined);
  assert.deepEqual(valid.value.stops.map((stop) => stop.sequence), [1, 2]);
  assert.equal(valid.value.geometrySource, 'MANUAL');
  assert.match(normalizeRouteInput({ ...valid.value, stops: [{ busStopId: 'a' }, { busStopId: 'a' }] }).error, /only once/u);
  assert.match(normalizeRouteInput({ ...valid.value, geometry: [{ lat: 91, lng: 0 }, { lat: 0, lng: 0 }] }).error, /geometry/u);
  assert.match(normalizeRouteInput({ ...valid.value, geometry: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }], geometrySource: 'UNKNOWN' }).error, /source/u);
});

test('limits transport administration to existing ADMIN and dedicated transport role', () => {
  assert.equal(transportAdminRoleAllowed('ADMIN'), true);
  assert.equal(transportAdminRoleAllowed('TRANSPORT_ADMIN'), true);
  assert.equal(transportAdminRoleAllowed('STUDENT'), false);
  assert.equal(transportAdminRoleAllowed('TEACHER'), false);
});

test('validates provisioned transport admin credentials and transport notices', () => {
  assert.equal(normalizeTransportAdminInput({
    name: 'Transit Admin', email: 'TRANSIT@UNIVERSITY.EDU', password: 'a-very-long-initial-password',
  }).value.email, 'transit@university.edu');
  assert.match(normalizeTransportAdminInput({ name: 'A', email: 'bad', password: 'short' }).error, /valid email/u);
  assert.deepEqual(normalizeNoticeInput({ title: 'Schedule update', body: 'The current timetable is published.' }).value, {
    title: 'Schedule update',
    body: 'The current timetable is published.',
  });
  assert.equal(normalizeSearchQuery('  Elmwood  '), 'Elmwood');
  assert.equal(normalizeSearchQuery('  '), null);
});
