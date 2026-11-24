import React, { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildPath, dhakaClock, estimateBus, formatTime, planForRider, toMinutes } from "./busEstimate.js";

const CAMPUS = { lat: 24.929568, lng: 91.973491, name: "Metropolitan University" };
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const ROUTE_COLORS = ["#2f6fdb", "#e0583a", "#1d9a6c", "#9b51e0", "#d99a00", "#0e9bb5", "#c2417a", "#5b6b7f"];
const TICK_MS = 1000;

const km = (meters) => (meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters / 10) * 10} m`);
const inMinutes = (target, now) => {
  const diff = Math.round(target - now);
  return diff <= 0 ? "now" : diff < 60 ? `in ${diff} min` : `in ${Math.floor(diff / 60)} h ${diff % 60} min`;
};

function statusText(estimate, bus, now) {
  if (estimate.state === "moving") {
    return estimate.toCampus ? `On the way to campus · arrives ${formatTime(estimate.arrivesCampusAt)}` : `Leaving campus for ${bus.startingPoint}`;
  }
  if (estimate.state === "waiting") return `${estimate.toCampus ? `At ${bus.startingPoint}` : "At campus"} · departs ${formatTime(estimate.departsAt)} (${inMinutes(estimate.departsAt, now)})`;
  if (estimate.state === "off-day") return "Not running today";
  return "Finished for today";
}

function busElement(number, color) {
  const el = document.createElement("div");
  el.className = "bus-marker";
  el.style.setProperty("--route", color);
  el.innerHTML = `<span class="bus-marker-arrow"></span><span class="bus-marker-body">${number.replace(/^MU-/u, "")}</span>`;
  return el;
}

function pinElement(className, label) {
  const el = document.createElement("div");
  el.className = className;
  el.innerHTML = `<span>${label}</span>`;
  return el;
}

export default function LiveBusMap({ routes, buses, stops }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const riderMarkerRef = useRef(null);
  const [clock, setClock] = useState(() => dhakaClock());
  const [rider, setRider] = useState(null);
  const [classStart, setClassStart] = useState("09:00");
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [mapFailed, setMapFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const entries = useMemo(() => {
    const colorByRoute = new Map(routes.map((route, i) => [route.id, ROUTE_COLORS[i % ROUTE_COLORS.length]]));
    return buses
      .map((bus) => {
        const route = routes.find((item) => item.id === bus.routeId);
        if (!route || !Array.isArray(route.geometry) || route.geometry.length < 2) return null;
        return { bus, route, path: buildPath(route.geometry), color: colorByRoute.get(route.id) };
      })
      .filter(Boolean);
  }, [routes, buses]);

  const estimates = useMemo(
    () => entries.map((entry) => ({ ...entry, estimate: estimateBus(entry.bus, entry.path, clock) })),
    [entries, clock],
  );
  const plans = useMemo(
    () => (rider ? planForRider(entries, rider, clock, toMinutes(classStart)) : []),
    [entries, rider, clock, classStart],
  );
  const pickPoints = useMemo(
    () => stops.filter((stop) => Math.abs(stop.latitude - CAMPUS.lat) + Math.abs(stop.longitude - CAMPUS.lng) > 0.002),
    [stops],
  );

  useEffect(() => {
    const timer = setInterval(() => setClock(dhakaClock()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Create the 3D map once, centred on campus.
  useEffect(() => {
    let map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current, style: MAP_STYLE,
        center: [CAMPUS.lng, CAMPUS.lat], zoom: 12.6, pitch: 58, bearing: -28,
        maxPitch: 75, cooperativeGestures: true, attributionControl: { compact: true },
      });
    } catch {
      setMapFailed(true); // WebGL unavailable: the list below still works.
      return undefined;
    }
    map.once("load", () => setMapReady(true));
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.on("click", (event) => setRider({ lat: event.lngLat.lat, lng: event.lngLat.lng, label: "Pinned location" }));
    new maplibregl.Marker({ element: pinElement("campus-marker", "MU Campus"), anchor: "bottom" })
      .setLngLat([CAMPUS.lng, CAMPUS.lat]).addTo(map);
    mapRef.current = map;
    const markers = markersRef.current;
    return () => { markers.clear(); map.remove(); mapRef.current = null; };
  }, []);

  // Draw coloured roads and stops whenever route data changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const draw = () => {
      const lines = {
        type: "FeatureCollection",
        features: entries.map(({ route, color }) => ({
          type: "Feature", properties: { color, name: route.name },
          geometry: { type: "LineString", coordinates: route.geometry.map(({ lat, lng }) => [Number(lng), Number(lat)]) },
        })),
      };
      const points = {
        type: "FeatureCollection",
        features: pickPoints.map((stop) => ({ type: "Feature", properties: { name: stop.name }, geometry: { type: "Point", coordinates: [stop.longitude, stop.latitude] } })),
      };
      if (map.getSource("bus-routes")) {
        map.getSource("bus-routes").setData(lines);
        map.getSource("bus-stops").setData(points);
        return;
      }
      map.addSource("bus-routes", { type: "geojson", data: lines });
      map.addSource("bus-stops", { type: "geojson", data: points });
      map.addLayer({ id: "bus-routes-casing", type: "line", source: "bus-routes", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 } });
      map.addLayer({ id: "bus-routes-line", type: "line", source: "bus-routes", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5 } });
      map.addLayer({ id: "bus-stops-dot", type: "circle", source: "bus-stops", paint: { "circle-radius": 5.5, "circle-color": "#ffffff", "circle-stroke-color": "#1f2937", "circle-stroke-width": 2 } });
      map.addLayer({ id: "bus-stops-label", type: "symbol", source: "bus-stops", layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.2], "text-anchor": "top", "text-font": ["Noto Sans Regular"] }, paint: { "text-color": "#1f2937", "text-halo-color": "#ffffff", "text-halo-width": 1.6 } });
      // First draw: frame every route plus campus, so buses from all directions are in view.
      const bounds = new maplibregl.LngLatBounds([CAMPUS.lng, CAMPUS.lat], [CAMPUS.lng, CAMPUS.lat]);
      lines.features.forEach((feature) => feature.geometry.coordinates.forEach((coord) => bounds.extend(coord)));
      map.fitBounds(bounds, { padding: { top: 60, bottom: 60, left: 40, right: 60 }, pitch: 55, bearing: -18, duration: 1600 });
    };
    if (map.isStyleLoaded()) draw(); else map.once("load", draw);
    return () => map.off("load", draw);
  }, [entries, pickPoints]);

  // Move bus markers to their timetable positions every tick.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    estimates.forEach(({ bus, color, estimate }) => {
      let marker = markers.get(bus.id);
      if (!marker) {
        marker = new maplibregl.Marker({ element: busElement(bus.number, color), rotationAlignment: "map" })
          .setLngLat([estimate.position.lng, estimate.position.lat])
          .setPopup(new maplibregl.Popup({ offset: 18, closeButton: false }).setText(`${bus.number} · ${bus.name}`))
          .addTo(map);
        markers.set(bus.id, marker);
      }
      marker.setLngLat([estimate.position.lng, estimate.position.lat]);
      const el = marker.getElement();
      el.classList.toggle("moving", estimate.state === "moving");
      el.classList.toggle("idle", estimate.state !== "moving");
      el.style.setProperty("--heading", `${estimate.bearing ?? 0}deg`);
    });
  }, [estimates]);

  // Show the rider and frame them together with campus.
  useEffect(() => {
    const map = mapRef.current;
    riderMarkerRef.current?.remove();
    riderMarkerRef.current = null;
    if (!map || !rider) return;
    riderMarkerRef.current = new maplibregl.Marker({ element: pinElement("rider-marker", "You") }).setLngLat([rider.lng, rider.lat]).addTo(map);
    const bounds = new maplibregl.LngLatBounds([rider.lng, rider.lat], [rider.lng, rider.lat]).extend([CAMPUS.lng, CAMPUS.lat]);
    map.fitBounds(bounds, { padding: 80, pitch: 55, bearing: -28, maxZoom: 15, duration: 1400 });
  }, [rider]);

  function locateMe() {
    if (!navigator.geolocation) { setGeoError("Your browser can't share location. Pick your area instead."); return; }
    setLocating(true);
    setGeoError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setRider({ lat: coords.latitude, lng: coords.longitude, label: "Your location" }); setLocating(false); },
      () => { setGeoError("Location permission was denied. Pick your area or tap the map instead."); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function focusBus(entry) {
    const position = estimates.find((item) => item.bus.id === entry.bus.id)?.estimate.position;
    if (position) mapRef.current?.flyTo({ center: [position.lng, position.lat], zoom: 15.5, pitch: 60, duration: 1200 });
  }

  const best = plans.find((plan) => plan.onTime);
  const now = clock.minutes;

  return (
    <div className="live-bus">
      <div className="live-bus-map">
        {mapFailed
          ? <div className="live-bus-fallback">The 3D map needs WebGL, which this browser has turned off. Bus times below still work.</div>
          : <div ref={containerRef} className="live-bus-canvas" aria-label="3D map of bus routes into Metropolitan University" />}
        {!mapFailed && !mapReady && <div className="live-bus-loading" role="status"><span />Loading the 3D map…</div>}
        <span className="live-bus-badge" title="Buses have no GPS trackers yet; positions follow the official timetable.">● Estimated from timetable · not live GPS</span>
      </div>

      <aside className="live-bus-panel">
        <div className="live-bus-where">
          <h3>Where are you?</h3>
          <div className="live-bus-actions">
            <button type="button" className="transport-button" onClick={locateMe} disabled={locating}>{locating ? "Locating…" : "Use my location"}</button>
            <label className="live-bus-class">Class starts<input type="time" value={classStart} onChange={(event) => setClassStart(event.target.value)} /></label>
          </div>
          <div className="live-bus-chips" role="group" aria-label="Pick your area">
            {pickPoints.map((stop) => (
              <button type="button" key={stop.id} className={rider?.label === stop.name ? "active" : ""}
                onClick={() => setRider({ lat: stop.latitude, lng: stop.longitude, label: stop.name })}>{stop.name}</button>
            ))}
          </div>
          <p className="live-bus-hint">{rider ? `Showing buses for ${rider.label}.` : "Or tap anywhere on the map."}</p>
          {geoError && <p className="live-bus-error" role="alert">{geoError}</p>}
        </div>

        {rider ? (
          <ol className="live-bus-list" aria-live="polite">
            {plans.map((plan) => (
              <li key={plan.bus.id}>
                <button type="button" onClick={() => focusBus(plan)} style={{ "--route": entries.find((e) => e.bus.id === plan.bus.id)?.color }}>
                  <span className="live-bus-num">{plan.bus.number}</span>
                  <span className="live-bus-info">
                    <strong>Reaches you {formatTime(plan.pickupAt)} <em>({inMinutes(plan.pickupAt, now)})</em></strong>
                    <small>{plan.trip.start <= now ? `Bus is ${km(plan.busMetersAway)} away on ${plan.route.name}` : `Leaves ${plan.bus.startingPoint} at ${formatTime(plan.trip.start)}`}{plan.walkMeters > 60 ? ` · walk ${km(plan.walkMeters)} to the road` : ""}</small>
                    <small>Arrives campus {formatTime(plan.arrivesCampusAt)}</small>
                  </span>
                  <span className={`live-bus-tag ${plan.onTime ? "ok" : "late"}`}>{plan === best ? "Best pick" : plan.onTime ? "On time" : "Late"}</span>
                </button>
              </li>
            ))}
            {!plans.length && <li className="live-bus-empty">No bus passes within 1.2 km of {rider.label} for the rest of today.</li>}
          </ol>
        ) : (
          <ol className="live-bus-list">
            {estimates.map((entry) => (
              <li key={entry.bus.id}>
                <button type="button" onClick={() => focusBus(entry)} style={{ "--route": entry.color }}>
                  <span className="live-bus-num">{entry.bus.number}</span>
                  <span className="live-bus-info"><strong>{entry.route.name}</strong><small>{statusText(entry.estimate, entry.bus, now)}</small></span>
                  {entry.estimate.state === "moving" && <span className="live-bus-tag ok">Moving</span>}
                </button>
              </li>
            ))}
            {!estimates.length && <li className="live-bus-empty">No routes with road paths have been published yet.</li>}
          </ol>
        )}
      </aside>
    </div>
  );
}
