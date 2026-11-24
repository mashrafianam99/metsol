// Run: node --test src/busEstimate.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { buildPath, estimateBus, planForRider, dhakaClock, toMinutes } from "./busEstimate.js";

// A straight west→east road of ~10 km ending at "campus".
const geometry = Array.from({ length: 11 }, (_, i) => ({ lat: 24.9, lng: 91.88 + i * 0.00992 }));
const path = buildPath(geometry);
const bus = {
  id: "b1", number: "MU-01", estimatedDurationMinutes: 20, operatingDays: ["Wednesday"],
  morningSchedule: "07:40", afternoonSchedule: "12:40", returnSchedule: "16:50",
};
const at = (time, day = "Wednesday") => ({ minutes: toMinutes(time), day });

test("path length is measured in metres", () => {
  assert.ok(path.total > 9500 && path.total < 10500, `total was ${path.total}`);
});

test("bus halfway through the morning trip sits halfway along the road, heading to campus", () => {
  const e = estimateBus(bus, path, at("07:50"));
  assert.equal(e.state, "moving");
  assert.equal(e.toCampus, true);
  assert.ok(Math.abs(e.position.lng - 91.9296) < 0.002, `lng was ${e.position.lng}`);
  assert.equal(e.arrivesCampusAt, toMinutes("08:00"));
});

test("return trip runs the road backwards, away from campus", () => {
  const e = estimateBus(bus, path, at("16:55"));
  assert.equal(e.state, "moving");
  assert.equal(e.toCampus, false);
  // A quarter into the return trip it is 3/4 of the way along the road, i.e. near campus (lng ~91.979).
  assert.ok(Math.abs(e.position.lng - (91.88 + 7.5 * 0.00992)) < 0.002, `lng was ${e.position.lng}`);
});

test("before departure the bus waits at its first stop with the departure time", () => {
  const e = estimateBus(bus, path, at("07:00"));
  assert.equal(e.state, "waiting");
  assert.equal(e.departsAt, toMinutes("07:40"));
  assert.deepEqual(e.position, geometry[0]);
});

test("buses do not run on days outside their operating days", () => {
  assert.equal(estimateBus(bus, path, at("07:50", "Friday")).state, "off-day");
});

test("rider at the road's 1/4 point: pickup time, distance to bus, and on-time check", () => {
  const rider = { lat: 24.9, lng: 91.88 + 2.5 * 0.00992 };
  const [plan] = planForRider([{ bus, path }], rider, at("07:41"), toMinutes("08:30"));
  assert.equal(plan.bus.id, "b1");
  assert.equal(plan.pickupAt, toMinutes("07:45")); // a quarter of a 20-minute trip after 07:40
  assert.equal(plan.arrivesCampusAt, toMinutes("08:00"));
  assert.equal(plan.onTime, true);
  assert.ok(plan.walkMeters < 50);
  assert.ok(plan.busMetersAway > 1500 && plan.busMetersAway < 2500, `bus was ${plan.busMetersAway} m away`);
});

test("a bus that already passed the rider offers its next inbound trip instead", () => {
  const rider = { lat: 24.9, lng: 91.88 + 2.5 * 0.00992 };
  const [plan] = planForRider([{ bus, path }], rider, at("07:55"), toMinutes("09:00"));
  assert.equal(plan.pickupAt, toMinutes("12:45"));
  assert.equal(plan.onTime, false);
});

test("riders far from every road get no plan", () => {
  assert.deepEqual(planForRider([{ bus, path }], { lat: 25.5, lng: 92.5 }, at("07:41"), 600), []);
});

test("dhakaClock reads Bangladesh time regardless of the device time zone", () => {
  const clock = dhakaClock(new Date("2026-11-25T02:30:00Z")); // 08:30 in Dhaka (UTC+6)
  assert.equal(clock.minutes, 8 * 60 + 30);
  assert.equal(clock.day, "Wednesday");
});
