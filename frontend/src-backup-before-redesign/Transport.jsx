import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { apiFetch } from "./api.js";
import "./transport.css";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const ADMIN = (role) => role === "ADMIN" || role === "TRANSPORT_ADMIN";
const emptyBus = {
  name: "", number: "", startingPoint: "", destination: "", estimatedDurationMinutes: 45,
  operatingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  morningSchedule: "", afternoonSchedule: "", returnSchedule: "", capacity: "", routeId: "", isActive: true,
};
const emptyStop = { name: "", area: "", latitude: "", longitude: "", landmark: "", description: "", osmId: "" };

async function request(path, options) {
  const response = await apiFetch(path, options);
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try { message = (await response.json()).error || message; } catch { /* The response may not be JSON. */ }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

function MapView({ routes, stops, selectedRouteId, onSelectRoute, drawMode, onAddPoint, draftGeometry = [] }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    const map = L.map(containerRef.current, { scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.setView([0, 0], 2);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layerRef.current;
    if (!map || !layers) return;
    layers.clearLayers();
    const matchingRoutes = selectedRouteId ? routes.filter((route) => route.id === selectedRouteId) : routes;
    const bounds = [];
    matchingRoutes.forEach((route) => {
      const points = Array.isArray(route.geometry) ? route.geometry : [];
      if (points.length > 1) {
        const latlngs = points.map(({ lat, lng }) => [Number(lat), Number(lng)]);
        L.polyline(latlngs, { color: "#168a73", weight: 5, opacity: 0.9 })
          .bindTooltip(route.name)
          .on("click", () => onSelectRoute?.(route.id))
          .addTo(layers);
        bounds.push(...latlngs);
      }
      (route.stops || []).forEach(({ busStop }) => {
        if (!busStop) return;
        const point = [Number(busStop.latitude), Number(busStop.longitude)];
        L.circleMarker(point, { radius: 7, color: "#0f766e", fillColor: "#fff", fillOpacity: 1, weight: 3 })
          .bindTooltip(`${busStop.name} · ${route.name}`)
          .addTo(layers);
        bounds.push(point);
      });
      if (draftGeometry.length) {
        const points = draftGeometry.map(({ lat, lng }) => [Number(lat), Number(lng)]);
        L.polyline(points, { color: "#b45309", weight: 4, dashArray: "8 8" }).addTo(layers);
        points.forEach((point) => L.circleMarker(point, { radius: 5, color: "#b45309", fillColor: "#fff", fillOpacity: 1 }).addTo(layers));
        bounds.push(...points);
      }
    });
    if (!matchingRoutes.length) {
      stops.forEach((stop) => {
        const point = [Number(stop.latitude), Number(stop.longitude)];
        L.circleMarker(point, { radius: 6, color: "#0f766e", fillColor: "#fff", fillOpacity: 1, weight: 3 })
          .bindTooltip(`${stop.name} · ${stop.area}`)
          .addTo(layers);
        bounds.push(point);
      });
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
  }, [routes, stops, selectedRouteId, onSelectRoute, draftGeometry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !drawMode || !onAddPoint) return undefined;
    map.getContainer().classList.add("transport-map-drawing");
    const addPoint = (event) => onAddPoint({ lat: Number(event.latlng.lat.toFixed(6)), lng: Number(event.latlng.lng.toFixed(6)) });
    map.on("click", addPoint);
    return () => {
      map.off("click", addPoint);
      map.getContainer().classList.remove("transport-map-drawing");
    };
  }, [drawMode, onAddPoint]);

  return <div ref={containerRef} className="transport-map" aria-label="Map showing university transport routes and stops" />;
}

export default function Transport({ user }) {
  const isAdmin = ADMIN(user?.role);
  const isSuperAdmin = user?.role === "ADMIN";
  const [data, setData] = useState({ buses: [], routes: [], stops: [], schedule: null });
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [adminPanel, setAdminPanel] = useState("Overview");
  const [dashboard, setDashboard] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [editStopId, setEditStopId] = useState("");
  const [stopForm, setStopForm] = useState(emptyStop);
  const [editBusId, setEditBusId] = useState("");
  const [busForm, setBusForm] = useState(emptyBus);
  const [editRouteId, setEditRouteId] = useState("");
  const [routeForm, setRouteForm] = useState({ name: "", startingPoint: "", destination: "", description: "", stopIds: [], times: {}, geometry: [], geometrySource: "" });
  const [drawMode, setDrawMode] = useState(false);
  const [geocodeQuery, setGeocodeQuery] = useState("");
  const [geocodeResults, setGeocodeResults] = useState([]);
  const [adminAccount, setAdminAccount] = useState({ name: "", email: "", password: "" });
  const [notice, setNotice] = useState({ title: "", body: "" });
  const [scheduleFile, setScheduleFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    setError("");
    try {
      const result = await request("/api/transport");
      setData(result);
      if (isAdmin) {
        const [stats, busList, routeList, stopList, scheduleList, adminList] = await Promise.all([
          request("/api/transport/admin/dashboard"),
          request("/api/admin/transport/buses"),
          request("/api/admin/transport/routes"),
          request("/api/admin/transport/stops"),
          request("/api/admin/transport/schedules"),
          isSuperAdmin ? request("/api/admin/transport/admins") : Promise.resolve([]),
        ]);
        setDashboard(stats);
        setSchedules(scheduleList);
        setAdmins(adminList);
        setData({ ...result, buses: busList, routes: routeList, stops: stopList });
      } else {
        setNotifications(await request("/api/notifications"));
      }
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, isSuperAdmin]);

  useEffect(() => { loadData(); }, [loadData]);

  const visibleRoutes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return data.routes;
    return data.routes.filter((route) =>
      [route.name, route.startingPoint, route.destination, ...(route.stops || []).map(({ busStop }) => `${busStop?.name || ""} ${busStop?.area || ""}`)]
        .join(" ").toLocaleLowerCase().includes(query));
  }, [data.routes, search]);

  async function runAction(action, message) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await action();
      if (message) setSuccess(message);
      await loadData();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  }

  async function openSchedule(path, fileName) {
    try {
      const response = await apiFetch(path);
      if (!response.ok) throw new Error("Unable to open the schedule PDF.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName || "transport-schedule.pdf";
      link.target = "_blank";
      link.rel = "noopener";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (openError) {
      setError(openError.message);
    }
  }

  async function markNotificationRead(notification) {
    try {
      const updated = await request(`/api/notifications/${notification.id}/read`, { method: "PATCH" });
      setNotifications((current) => current.map((item) => item.id === updated.id ? updated : item));
      if (updated.notice?.transportScheduleId) await openSchedule("/api/transport/schedule/current/pdf", "transport-schedule.pdf");
    } catch (readError) { setError(readError.message); }
  }

  function chooseStop(id) {
    setEditStopId(id);
    const stop = data.stops.find((item) => item.id === id);
    setStopForm(stop ? {
      name: stop.name, area: stop.area, latitude: stop.latitude, longitude: stop.longitude,
      landmark: stop.landmark || "", description: stop.description || "", osmId: stop.osmId || "",
    } : emptyStop);
  }

  function chooseBus(id) {
    setEditBusId(id);
    const bus = data.buses.find((item) => item.id === id);
    setBusForm(bus ? {
      ...emptyBus, ...bus,
      operatingDays: bus.operatingDays || [],
      capacity: bus.capacity ?? "",
      morningSchedule: bus.morningSchedule || "",
      afternoonSchedule: bus.afternoonSchedule || "",
      returnSchedule: bus.returnSchedule || "",
      routeId: bus.routeId || "",
    } : emptyBus);
  }

  function chooseRoute(id) {
    setEditRouteId(id);
    const route = data.routes.find((item) => item.id === id);
    setRouteForm(route ? {
      name: route.name, startingPoint: route.startingPoint, destination: route.destination,
      description: route.description || "",
      stopIds: (route.stops || []).map(({ busStopId }) => busStopId),
      times: Object.fromEntries((route.stops || []).map(({ busStopId, arrivalTime, departureTime }) => [busStopId, {
        arrivalTime: arrivalTime || "", departureTime: departureTime || "",
      }])),
      geometry: Array.isArray(route.geometry) ? route.geometry : [],
      geometrySource: route.geometrySource || "",
    } : { name: "", startingPoint: "", destination: "", description: "", stopIds: [], times: {}, geometry: [], geometrySource: "" });
  }

  async function searchPlaces(event) {
    event.preventDefault();
    setError("");
    try {
      setGeocodeResults(await request(`/api/transport/geocode?q=${encodeURIComponent(geocodeQuery)}`));
    } catch (searchError) { setError(searchError.message); }
  }

  return (
    <div className="transport-page">
      <header className="transport-heading">
        <div>
          <span className="transport-eyebrow">METROPOLITAN UNIVERSITY · TRANSPORT</span>
          <h1>{isAdmin ? "Transport management" : "University transport"}</h1>
          <p>{isAdmin ? "Manage official routes, stops, buses, schedules and student updates." : "Search official routes and stops, and view the current published schedule."}</p>
        </div>
        <button className="transport-button secondary" onClick={loadData} disabled={loading}>↻ Refresh data</button>
      </header>
      {error && <div className="transport-alert error" role="alert">{error}</div>}
      {success && <div className="transport-alert success" role="status">{success}</div>}
      {loading ? <div className="transport-empty">Loading official transport information…</div> : (
        <>
          {!isAdmin && (
            <section className="transport-notifications">
              <details>
                <summary>Notifications <span>{notifications.filter((item) => !item.readAt).length} unread</span></summary>
                <div className="transport-notification-list">
                  {notifications.length === 0 && <p>No transport notifications.</p>}
                  {notifications.map((item) => (
                    <button key={item.id} className={item.readAt ? "" : "unread"} onClick={() => markNotificationRead(item)}>
                      <strong>{item.notice.title}</strong><span>{item.notice.body}</span>
                      <small>{new Date(item.createdAt).toLocaleString()} · {item.readAt ? "Read" : "Mark read / open"}</small>
                    </button>
                  ))}
                </div>
              </details>
            </section>
          )}
          {isAdmin && (
            <nav className="transport-tabs" aria-label="Transport administration">
              {["Overview", "Buses", "Routes", "Stops", "Schedules", "Notices", ...(isSuperAdmin ? ["Administrators"] : [])].map((tab) =>
                <button key={tab} className={adminPanel === tab ? "active" : ""} onClick={() => setAdminPanel(tab)}>{tab}</button>)}
            </nav>
          )}
          {isAdmin && adminPanel === "Overview" && (
            <section className="transport-overview">
              <div className="transport-stat-grid">
                {Object.entries({
                  "Active buses": dashboard?.stats.activeBuses ?? 0,
                  "Total routes": dashboard?.stats.totalRoutes ?? 0,
                  "Official stops": dashboard?.stats.totalStops ?? 0,
                  "Published schedules": dashboard?.stats.publishedSchedules ?? 0,
                }).map(([label, value]) => <article key={label}><strong>{value}</strong><span>{label}</span></article>)}
              </div>
              <h2>Recent changes</h2>
              <div className="transport-list">
                {(dashboard?.activities || []).map((activity) =>
                  <article key={activity.id}><strong>{activity.summary}</strong><span>{activity.actor.name} · {new Date(activity.createdAt).toLocaleString()}</span></article>)}
                {!dashboard?.activities?.length && <p className="transport-empty">No activity recorded yet.</p>}
              </div>
            </section>
          )}
          {isAdmin && adminPanel === "Stops" && (
            <section className="transport-admin-grid">
              <form className="transport-form" onSubmit={(event) => {
                event.preventDefault();
                runAction(() => request(`/api/admin/transport/stops${editStopId ? `/${editStopId}` : ""}`, {
                  method: editStopId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...stopForm, latitude: Number(stopForm.latitude), longitude: Number(stopForm.longitude) }),
                }), editStopId ? "Stop updated." : "Stop created.");
              }}>
                <h2>{editStopId ? "Edit stop" : "Add a stop"}</h2>
                <label>Stop name<input required maxLength="120" value={stopForm.name} onChange={(event) => setStopForm({ ...stopForm, name: event.target.value })} /></label>
                <label>Area / city<input required maxLength="160" value={stopForm.area} onChange={(event) => setStopForm({ ...stopForm, area: event.target.value })} /></label>
                <div className="transport-fields two">
                  <label>Latitude<input required type="number" step="any" min="-90" max="90" value={stopForm.latitude} onChange={(event) => setStopForm({ ...stopForm, latitude: event.target.value })} /></label>
                  <label>Longitude<input required type="number" step="any" min="-180" max="180" value={stopForm.longitude} onChange={(event) => setStopForm({ ...stopForm, longitude: event.target.value })} /></label>
                </div>
                <div className="transport-inline-search">
                  <label>Search OpenStreetMap<input value={geocodeQuery} minLength="3" onChange={(event) => setGeocodeQuery(event.target.value)} placeholder="Search a real location" /></label>
                  <button type="button" className="transport-button secondary" onClick={searchPlaces}>Search</button>
                </div>
                {geocodeResults.map((item) => <button type="button" className="transport-search-result" key={item.osmId} onClick={() => setStopForm({ ...stopForm, name: stopForm.name || item.name, latitude: item.latitude, longitude: item.longitude, osmId: item.osmId })}>{item.displayName}</button>)}
                <label>Landmark<input maxLength="160" value={stopForm.landmark} onChange={(event) => setStopForm({ ...stopForm, landmark: event.target.value })} /></label>
                <label>Description<textarea maxLength="1000" value={stopForm.description} onChange={(event) => setStopForm({ ...stopForm, description: event.target.value })} /></label>
                <div className="transport-actions"><button className="transport-button" disabled={busy}>{busy ? "Saving…" : editStopId ? "Save stop" : "Create stop"}</button>{editStopId && <button type="button" className="transport-button secondary" onClick={() => chooseStop("")}>Cancel edit</button>}</div>
              </form>
              <div className="transport-list"><h2>Registered stops ({data.stops.length})</h2>
                {data.stops.map((stop) => <article key={stop.id}><strong>{stop.name}</strong><span>{stop.area} · {stop.latitude}, {stop.longitude}</span><div className="transport-actions"><button onClick={() => chooseStop(stop.id)}>Edit</button><button className="danger" onClick={() => runAction(() => request(`/api/admin/transport/stops/${stop.id}`, { method: "DELETE" }), "Stop deleted.")}>Delete</button></div></article>)}
              </div>
            </section>
          )}
          {isAdmin && adminPanel === "Buses" && (
            <section className="transport-admin-grid">
              <form className="transport-form" onSubmit={(event) => {
                event.preventDefault();
                runAction(() => request(`/api/admin/transport/buses${editBusId ? `/${editBusId}` : ""}`, { method: editBusId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...busForm, estimatedDurationMinutes: Number(busForm.estimatedDurationMinutes), capacity: busForm.capacity === "" ? null : Number(busForm.capacity), routeId: busForm.routeId || null }) }), editBusId ? "Bus updated." : "Bus added.");
              }}>
                <h2>{editBusId ? "Edit bus" : "Add a bus"}</h2>
                <label>Bus name<input required maxLength="100" value={busForm.name} onChange={(event) => setBusForm({ ...busForm, name: event.target.value })} /></label>
                <label>Official bus number<input required maxLength="40" value={busForm.number} onChange={(event) => setBusForm({ ...busForm, number: event.target.value })} /></label>
                <div className="transport-fields two"><label>Starting point<input required value={busForm.startingPoint} onChange={(event) => setBusForm({ ...busForm, startingPoint: event.target.value })} /></label><label>Destination<input required value={busForm.destination} onChange={(event) => setBusForm({ ...busForm, destination: event.target.value })} /></label></div>
                <label>Route<select value={busForm.routeId} onChange={(event) => setBusForm({ ...busForm, routeId: event.target.value })}><option value="">No route assigned</option>{data.routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
                <label>Duration (minutes)<input required type="number" min="1" max="1440" value={busForm.estimatedDurationMinutes} onChange={(event) => setBusForm({ ...busForm, estimatedDurationMinutes: event.target.value })} /></label>
                <div className="transport-fields three"><label>Morning<input type="time" value={busForm.morningSchedule} onChange={(event) => setBusForm({ ...busForm, morningSchedule: event.target.value })} /></label><label>Afternoon<input type="time" value={busForm.afternoonSchedule} onChange={(event) => setBusForm({ ...busForm, afternoonSchedule: event.target.value })} /></label><label>Return<input type="time" value={busForm.returnSchedule} onChange={(event) => setBusForm({ ...busForm, returnSchedule: event.target.value })} /></label></div>
                <label>Capacity (optional)<input type="number" min="1" max="1000" value={busForm.capacity} onChange={(event) => setBusForm({ ...busForm, capacity: event.target.value })} /></label>
                <fieldset><legend>Operating days</legend><div className="transport-checks">{DAYS.map((day) => <label key={day}><input type="checkbox" checked={busForm.operatingDays.includes(day)} onChange={(event) => setBusForm({ ...busForm, operatingDays: event.target.checked ? [...busForm.operatingDays, day] : busForm.operatingDays.filter((item) => item !== day) })} />{day.slice(0, 3)}</label>)}</div></fieldset>
                <label className="transport-toggle"><input type="checkbox" checked={busForm.isActive} onChange={(event) => setBusForm({ ...busForm, isActive: event.target.checked })} />Bus is currently active</label>
                <div className="transport-actions"><button className="transport-button" disabled={busy}>{editBusId ? "Save bus" : "Create bus"}</button>{editBusId && <button type="button" className="transport-button secondary" onClick={() => chooseBus("")}>Cancel edit</button>}</div>
              </form>
              <div className="transport-list"><h2>Registered buses ({data.buses.length})</h2>
                {data.buses.map((bus) => <article key={bus.id}><strong>{bus.number} · {bus.name}</strong><span>{bus.startingPoint} → {bus.destination} · {bus.isActive ? "Active" : "Inactive"}</span><div className="transport-actions"><button onClick={() => chooseBus(bus.id)}>Edit</button><button className="danger" onClick={() => runAction(() => request(`/api/admin/transport/buses/${bus.id}`, { method: "DELETE" }), "Bus removed.")}>Delete</button></div></article>)}
              </div>
            </section>
          )}
          {isAdmin && adminPanel === "Routes" && (
            <section className="transport-admin-grid route-admin-grid">
              <form className="transport-form" onSubmit={(event) => {
                event.preventDefault();
                const stops = routeForm.stopIds.map((busStopId) => ({ busStopId, ...(routeForm.times[busStopId] || {}) }));
                const geometry = routeForm.geometry.length > 1 ? routeForm.geometry : null;
                const body = { ...routeForm, stops, geometry, geometrySource: geometry ? routeForm.geometrySource || "MANUAL" : null };
                runAction(() => request(`/api/admin/transport/routes${editRouteId ? `/${editRouteId}` : ""}`, { method: editRouteId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), editRouteId ? "Route updated." : "Route created.");
                setDrawMode(false);
              }}>
                <h2>{editRouteId ? "Edit route" : "Create a route"}</h2>
                <label>Route name<input required maxLength="120" value={routeForm.name} onChange={(event) => setRouteForm({ ...routeForm, name: event.target.value })} /></label>
                <div className="transport-fields two"><label>Starting point<input required value={routeForm.startingPoint} onChange={(event) => setRouteForm({ ...routeForm, startingPoint: event.target.value })} /></label><label>Destination<input required value={routeForm.destination} onChange={(event) => setRouteForm({ ...routeForm, destination: event.target.value })} /></label></div>
                <label>Description<textarea maxLength="2000" value={routeForm.description} onChange={(event) => setRouteForm({ ...routeForm, description: event.target.value })} /></label>
                <fieldset><legend>Ordered route stops (select at least two)</legend><div className="transport-stop-picker">{data.stops.map((stop) => {
                  const checked = routeForm.stopIds.includes(stop.id);
                  const index = routeForm.stopIds.indexOf(stop.id);
                  return <div key={stop.id}><label><input type="checkbox" checked={checked} onChange={(event) => setRouteForm({ ...routeForm, stopIds: event.target.checked ? [...routeForm.stopIds, stop.id] : routeForm.stopIds.filter((id) => id !== stop.id) })} />{stop.name} · {stop.area}</label>{checked && <span>Stop {index + 1}<input aria-label={`Sequence for ${stop.name}`} type="number" min="1" max={routeForm.stopIds.length} value={index + 1} onChange={(event) => {
                    const next = [...routeForm.stopIds]; const [moved] = next.splice(index, 1); next.splice(Math.max(0, Math.min(next.length, Number(event.target.value) - 1)), 0, moved); setRouteForm({ ...routeForm, stopIds: next });
                  }} /></span>}</div>;
                })}</div></fieldset>
                <div className="transport-fields two">{routeForm.stopIds.map((stopId) => {
                  const stop = data.stops.find((item) => item.id === stopId);
                  const times = routeForm.times[stopId] || {};
                  return <fieldset key={stopId}><legend>{stop?.name || "Selected stop"}</legend><label>Arrival<input type="time" value={times.arrivalTime || ""} onChange={(event) => setRouteForm({ ...routeForm, times: { ...routeForm.times, [stopId]: { ...times, arrivalTime: event.target.value } } })} /></label><label>Departure<input type="time" value={times.departureTime || ""} onChange={(event) => setRouteForm({ ...routeForm, times: { ...routeForm.times, [stopId]: { ...times, departureTime: event.target.value } } })} /></label></fieldset>;
                })}</div>
                <p className="transport-hint">Road geometry is created from the selected stops using the configured router, or draw it on the map with real map points.</p>
                <div className="transport-actions"><button type="button" className={`transport-button ${drawMode ? "warning" : "secondary"}`} onClick={() => setDrawMode(!drawMode)}>{drawMode ? "Finish drawing" : "Draw route on map"}</button>{routeForm.geometry.length > 0 && <button type="button" className="transport-button secondary" onClick={() => setRouteForm({ ...routeForm, geometry: [], geometrySource: "" })}>Clear drawn points ({routeForm.geometry.length})</button>}</div>
                <button className="transport-button" disabled={busy || routeForm.stopIds.length < 2}>{editRouteId ? "Save route" : "Create route"}</button>
                {editRouteId && <button type="button" className="transport-button secondary" onClick={() => chooseRoute("")}>Cancel edit</button>}
              </form>
              <div className="transport-list"><h2>Routes ({data.routes.length})</h2>
                {data.routes.map((route) => <article key={route.id}><strong>{route.name}</strong><span>{route.startingPoint} → {route.destination} · {(route.stops || []).length} stops · {route.geometrySource ? `${route.geometrySource} geometry` : "No road geometry yet"}</span><div className="transport-actions"><button onClick={() => chooseRoute(route.id)}>Edit</button><button onClick={() => runAction(() => request(`/api/admin/transport/routes/${route.id}/generate`, { method: "POST" }), "Road route geometry generated.")}>Generate road geometry</button><button className="danger" onClick={() => runAction(() => request(`/api/admin/transport/routes/${route.id}`, { method: "DELETE" }), "Route deleted.")}>Delete</button></div></article>)}
              </div>
              <MapView routes={data.routes} stops={data.stops} selectedRouteId={editRouteId || selectedRouteId} drawMode={drawMode} draftGeometry={routeForm.geometry} onAddPoint={(point) => setRouteForm((current) => ({ ...current, geometry: [...current.geometry, point], geometrySource: "MANUAL" }))} />
            </section>
          )}
          {isAdmin && adminPanel === "Schedules" && (
            <section className="transport-admin-grid">
              <form className="transport-form" onSubmit={(event) => {
                event.preventDefault();
                if (!scheduleFile) { setError("Choose a PDF file to upload."); return; }
                const formData = new FormData(); formData.append("file", scheduleFile);
                runAction(() => request("/api/admin/transport/schedules", { method: "POST", body: formData }), "Schedule PDF uploaded as a draft.");
                setScheduleFile(null);
              }}>
                <h2>Publish an official schedule</h2>
                <p>Only PDF files (maximum 20 MB) are accepted. Publishing archives the current schedule and notifies students.</p>
                <label>Schedule PDF<input required type="file" accept="application/pdf,.pdf" onChange={(event) => setScheduleFile(event.target.files?.[0] || null)} /></label>
                <button className="transport-button" disabled={busy || !scheduleFile}>Upload draft PDF</button>
              </form>
              <div className="transport-list"><h2>Schedule history</h2>
                {schedules.map((item) => <article key={item.id}><strong>{item.fileName}</strong><span>{item.status} · {(item.fileSize / 1024 / 1024).toFixed(2)} MB · {new Date(item.createdAt).toLocaleDateString()}</span><div className="transport-actions"><button onClick={() => openSchedule(`/api/admin/transport/schedules/${item.id}/pdf`, item.fileName)}>View / download</button>{item.status === "DRAFT" && <button onClick={() => runAction(() => request(`/api/admin/transport/schedules/${item.id}/publish`, { method: "POST" }), "Schedule published; students have been notified.")}>Publish</button>}</div></article>)}
                {!schedules.length && <p className="transport-empty">No schedule PDFs have been uploaded.</p>}
              </div>
            </section>
          )}
          {isAdmin && adminPanel === "Notices" && (
            <form className="transport-form narrow" onSubmit={(event) => {
              event.preventDefault();
              runAction(() => request("/api/admin/transport/notices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(notice) }), "Transport notice published to students.");
              setNotice({ title: "", body: "" });
            }}>
              <h2>Publish a transport notice</h2><p>Notices are delivered to active student accounts as notifications.</p>
              <label>Title<input required maxLength="160" value={notice.title} onChange={(event) => setNotice({ ...notice, title: event.target.value })} /></label>
              <label>Message<textarea required maxLength="10000" rows="6" value={notice.body} onChange={(event) => setNotice({ ...notice, body: event.target.value })} /></label>
              <button className="transport-button" disabled={busy}>Publish notice</button>
            </form>
          )}
          {isAdmin && isSuperAdmin && adminPanel === "Administrators" && (
            <section className="transport-admin-grid">
              <form className="transport-form" onSubmit={(event) => {
                event.preventDefault();
                runAction(() => request("/api/admin/transport/admins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(adminAccount) }), "Transport administrator account created.");
                setAdminAccount({ name: "", email: "", password: "" });
              }}>
                <h2>Create a transport administrator</h2><p>Creates the account in Supabase Auth and assigns transport-only permissions.</p>
                <label>Full name<input required maxLength="100" value={adminAccount.name} onChange={(event) => setAdminAccount({ ...adminAccount, name: event.target.value })} /></label>
                <label>Email<input required type="email" value={adminAccount.email} onChange={(event) => setAdminAccount({ ...adminAccount, email: event.target.value })} /></label>
                <label>Initial password<input required type="password" minLength="12" value={adminAccount.password} onChange={(event) => setAdminAccount({ ...adminAccount, password: event.target.value })} /><small>At least 12 characters. Share securely and require a password reset through university policy.</small></label>
                <button className="transport-button" disabled={busy}>Create account</button>
              </form>
              <div className="transport-list"><h2>Transport administrators</h2>
                {admins.map((account) => <article key={account.id}><strong>{account.name}</strong><span>{account.email} · {account.isActive ? "Active" : "Inactive"}</span><button onClick={() => runAction(() => request(`/api/admin/transport/admins/${account.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !account.isActive }) }), `Account ${account.isActive ? "deactivated" : "activated"}.`)}>{account.isActive ? "Deactivate" : "Activate"}</button></article>)}
              </div>
            </section>
          )}
          {(!isAdmin || adminPanel === "Overview") && (
            <section className="transport-discovery">
              <div className="transport-discovery-heading">
                <div><h2>{isAdmin ? "Student route preview" : "Find your route"}</h2><p>Only university-entered route and stop information is shown. No live GPS data is available.</p></div>
                {!isAdmin && <label className="transport-search">Search routes or stops<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Route, stop or area" /></label>}
              </div>
              <div className="transport-map-wrap"><MapView routes={visibleRoutes} stops={data.stops} selectedRouteId={selectedRouteId} onSelectRoute={setSelectedRouteId} /></div>
              {!isAdmin && <div className="transport-route-grid">
                {visibleRoutes.map((route) => <article className={route.id === selectedRouteId ? "selected" : ""} key={route.id} onClick={() => setSelectedRouteId(route.id)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && setSelectedRouteId(route.id)}>
                  <h3>{route.name}</h3><span>{route.startingPoint} → {route.destination}</span>
                  <ol>{(route.stops || []).map(({ busStop, arrivalTime, departureTime }, index) => <li key={busStop.id}><strong>{index + 1}. {busStop.name}</strong><span>{busStop.area}{arrivalTime ? ` · Arrive ${arrivalTime}` : ""}{departureTime ? ` · Leave ${departureTime}` : ""}</span></li>)}</ol>
                  {!route.geometry?.length && <small className="transport-hint">Stop coordinates are shown; road geometry has not been added yet.</small>}
                  {(route.buses || []).map((bus) => <div className="transport-bus-line" key={bus.id}>{bus.number} · {bus.name}</div>)}
                </article>)}
                {!visibleRoutes.length && <p className="transport-empty">No official routes match. Contact the Transport Department if you need route information.</p>}
              </div>}
              <section className="transport-schedule-card">
                <div><span className="transport-eyebrow">OFFICIAL PDF</span><h2>Current transport schedule</h2><p>{data.schedule ? `${data.schedule.fileName} · Published ${new Date(data.schedule.publishedAt).toLocaleDateString()}` : "No current schedule has been published."}</p></div>
                {data.schedule && <button className="transport-button" onClick={() => openSchedule("/api/transport/schedule/current/pdf?download=1", data.schedule.fileName)}>Download schedule</button>}
              </section>
              {isAdmin && <div className="transport-list"><h2>Official buses</h2>{data.buses.map((bus) => <article key={bus.id}><strong>{bus.number} · {bus.name}</strong><span>{bus.startingPoint} → {bus.destination} · {bus.operatingDays.join(", ")} · {bus.estimatedDurationMinutes} min</span></article>)}</div>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
