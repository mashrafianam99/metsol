import { basename } from 'node:path';
import express from 'express';
import multer from 'multer';
import {
  normalizeBusInput,
  normalizeNoticeInput,
  normalizeRouteInput,
  normalizeSearchQuery,
  normalizeStopInput,
  normalizeTransportAdminInput,
  transportAdminRoleAllowed,
} from './transport.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const scheduleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
}).single('file');
const routeIncludes = {
  stops: { include: { busStop: true }, orderBy: { sequence: 'asc' } },
  buses: { where: { isActive: true }, select: { id: true, name: true, number: true } },
};

function isTransportAdmin(user) {
  return transportAdminRoleAllowed(user?.role);
}

function sanitizePdfName(name) {
  return basename(String(name || 'transport-schedule.pdf').replace(/[\\/]/gu, '/'))
    .replace(/[^\w.() -]/gu, '_')
    .slice(0, 180) || 'transport-schedule.pdf';
}

function sendPdf(res, schedule, download = false) {
  const fileName = sanitizePdfName(schedule.fileName);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', schedule.fileSize);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fileName}"`);
  res.send(Buffer.from(schedule.fileData));
}

async function writeActivity(tx, req, action, entityType, entityId, summary) {
  return tx.transportActivity.create({
    data: { actorId: req.user.id, action, entityType, entityId, summary },
  });
}

async function ensureRouteExists(db, routeId) {
  if (!routeId) return true;
  return Boolean(await db.transportRoute.findUnique({ where: { id: routeId }, select: { id: true } }));
}

async function ensureStopsExist(db, stops) {
  const ids = stops.map((stop) => stop.busStopId);
  const found = await db.busStop.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return found.length === ids.length;
}

function handleScheduleUpload(req, res, next) {
  scheduleUpload(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Schedule PDFs must be 20 MB or smaller.' });
    }
    if (error instanceof multer.MulterError) return res.status(400).json({ error: 'Upload one PDF file at a time.' });
    return next(error);
  });
}

function createSupabaseAdminClient(supabaseUrl, serviceRoleKey, createClient) {
  if (!serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function createTransportRouter({ db, auth, roles, supabaseUrl, serviceRoleKey, createClient }) {
  const router = express.Router();
  const supabaseAdmin = createSupabaseAdminClient(supabaseUrl, serviceRoleKey, createClient);

  router.get('/transport', auth, async (req, res) => {
    const adminView = isTransportAdmin(req.user);
    const [buses, routes, stops, schedule] = await Promise.all([
      db.bus.findMany({
        where: adminView ? {} : { isActive: true },
        include: { route: { include: routeIncludes } },
        orderBy: [{ number: 'asc' }],
      }),
      db.transportRoute.findMany({
        include: routeIncludes,
        orderBy: { name: 'asc' },
      }),
      db.busStop.findMany({
        where: adminView ? {} : { routes: { some: { route: { buses: { some: { isActive: true } } } } } },
        orderBy: [{ area: 'asc' }, { name: 'asc' }],
      }),
      db.transportSchedule.findFirst({
        where: { status: 'PUBLISHED' },
        select: { id: true, fileName: true, fileSize: true, publishedAt: true },
      }),
    ]);
    return res.json({ buses, routes, stops, schedule });
  });

  router.get('/transport/admin/dashboard', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (_req, res) => {
    const [totalBuses, activeBuses, totalRoutes, totalStops, publishedSchedules, recentSchedules, activities] = await Promise.all([
      db.bus.count(),
      db.bus.count({ where: { isActive: true } }),
      db.transportRoute.count(),
      db.busStop.count(),
      db.transportSchedule.count({ where: { status: 'PUBLISHED' } }),
      db.transportSchedule.findMany({
        where: { status: { in: ['DRAFT', 'PUBLISHED'] } },
        select: { id: true, fileName: true, fileSize: true, status: true, createdAt: true, publishedAt: true },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      db.transportActivity.findMany({
        include: { actor: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    return res.json({
      stats: {
        totalBuses,
        activeBuses,
        inactiveBuses: totalBuses - activeBuses,
        totalRoutes,
        totalStops,
        publishedSchedules,
      },
      recentSchedules,
      activities,
    });
  });

  router.get('/transport/geocode', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (req, res) => {
    const query = normalizeSearchQuery(req.query.q);
    if (!query) return res.status(400).json({ error: 'Enter a location search with at least 3 characters.' });
    const baseUrl = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
    try {
      const url = new URL(baseUrl);
      url.searchParams.set('q', `${query}, Sylhet, Bangladesh`);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '5');
      const response = await fetch(url, {
        headers: { 'User-Agent': process.env.NOMINATIM_USER_AGENT || 'MetsolUniversityTransport/1.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return res.status(502).json({ error: 'OpenStreetMap search is temporarily unavailable.' });
      const results = await response.json();
      return res.json(results.map((result) => ({
        osmId: `${result.osm_type}/${result.osm_id}`,
        name: result.name || result.display_name?.split(',')[0] || 'Map location',
        displayName: result.display_name,
        latitude: Number(result.lat),
        longitude: Number(result.lon),
      })).filter((result) => Number.isFinite(result.latitude) && Number.isFinite(result.longitude)));
    } catch (error) {
      console.error('Transport geocoding failed:', error);
      return res.status(502).json({ error: 'Unable to search OpenStreetMap right now. Enter coordinates or select a location on the map.' });
    }
  });

  router.get('/transport/routes/:id', auth, async (req, res) => {
    const route = await db.transportRoute.findFirst({
      where: isTransportAdmin(req.user)
        ? { id: req.params.id }
        : { id: req.params.id, buses: { some: { isActive: true } } },
      include: { ...routeIncludes, buses: { where: { isActive: true } } },
    });
    if (!route) return res.status(404).json({ error: 'Route not found.' });
    return res.json(route);
  });

  router.get('/transport/schedule/current', auth, async (_req, res) => {
    const schedule = await db.transportSchedule.findFirst({
      where: { status: 'PUBLISHED' },
      select: { id: true, fileName: true, fileSize: true, publishedAt: true },
    });
    if (!schedule) return res.json({ schedule: null });
    return res.json({ schedule });
  });

  router.get('/transport/schedule/current/pdf', auth, async (req, res) => {
    const schedule = await db.transportSchedule.findFirst({ where: { status: 'PUBLISHED' } });
    if (!schedule) return res.status(404).json({ error: 'There is no current published transport schedule.' });
    return sendPdf(res, schedule, req.query.download === '1');
  });

  router.get('/notifications', auth, async (req, res) => {
    const notifications = await db.notification.findMany({
      where: { userId: req.user.id },
      include: { notice: { select: { id: true, title: true, body: true, category: true, createdAt: true, transportScheduleId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return res.json(notifications);
  });

  router.patch('/notifications/:id/read', auth, async (req, res) => {
    const result = await db.notification.updateMany({
      where: { id: req.params.id, userId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    const notification = await db.notification.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { notice: { select: { id: true, title: true, body: true, category: true, transportScheduleId: true } } },
    });
    if (!notification) return res.status(404).json({ error: 'Notification not found.' });
    return res.json({ ...notification, newlyRead: result.count > 0 });
  });

  router.post('/admin/transport/admins', auth, roles('ADMIN'), async (req, res) => {
    const parsed = normalizeTransportAdminInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Transport administrator provisioning requires SUPABASE_SERVICE_ROLE_KEY on the backend.' });
    }
    const existing = await db.user.findFirst({
      where: { email: { equals: parsed.value.email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: parsed.value.email,
      password: parsed.value.password,
      email_confirm: true,
      user_metadata: { name: parsed.value.name },
    });
    if (error || !data?.user) {
      console.error('Supabase transport administrator provisioning failed:', error?.message);
      return res.status(502).json({ error: 'Unable to provision the transport administrator in Supabase Auth.' });
    }
    try {
      const created = await db.$transaction(async (tx) => {
        const account = await tx.user.create({
          data: {
            name: parsed.value.name,
            email: parsed.value.email,
            authId: data.user.id,
            role: 'TRANSPORT_ADMIN',
            isActive: true,
          },
          select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
        });
        await writeActivity(tx, req, 'CREATE', 'TRANSPORT_ADMIN', account.id, `Created transport administrator ${account.email}.`);
        return account;
      });
      return res.status(201).json(created);
    } catch (error) {
      await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch((cleanupError) => {
        console.error('Unable to roll back unlinked Supabase transport account:', cleanupError.message);
      });
      if (error?.code === 'P2002') return res.status(409).json({ error: 'An account with that email already exists.' });
      throw error;
    }
  });

  router.get('/admin/transport/admins', auth, roles('ADMIN'), async (_req, res) => {
    return res.json(await db.user.findMany({
      where: { role: 'TRANSPORT_ADMIN' },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }));
  });

  router.patch('/admin/transport/admins/:id/status', auth, roles('ADMIN'), async (req, res) => {
    if (typeof req.body?.isActive !== 'boolean') return res.status(400).json({ error: 'Choose whether the account is active.' });
    const result = await db.$transaction(async (tx) => {
      const account = await tx.user.findFirst({ where: { id: req.params.id, role: 'TRANSPORT_ADMIN' } });
      if (!account) return null;
      const updated = await tx.user.update({
        where: { id: account.id },
        data: { isActive: req.body.isActive },
        select: { id: true, name: true, email: true, role: true, isActive: true },
      });
      await writeActivity(tx, req, req.body.isActive ? 'ACTIVATE' : 'DEACTIVATE', 'TRANSPORT_ADMIN', updated.id,
        `${req.body.isActive ? 'Activated' : 'Deactivated'} transport administrator ${updated.email}.`);
      return updated;
    });
    if (!result) return res.status(404).json({ error: 'Transport administrator not found.' });
    return res.json(result);
  });

  router.post('/admin/transport/buses', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (req, res) => {
    const parsed = normalizeBusInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (!await ensureRouteExists(db, parsed.value.routeId)) return res.status(404).json({ error: 'The selected route was not found.' });
    try {
      const bus = await db.$transaction(async (tx) => {
        const created = await tx.bus.create({ data: parsed.value, include: { route: true } });
        await writeActivity(tx, req, 'CREATE', 'BUS', created.id, `Added bus ${created.number} (${created.name}).`);
        return created;
      });
      return res.status(201).json(bus);
    } catch (error) {
      if (error?.code === 'P2002') return res.status(409).json({ error: 'A bus with that number already exists.' });
      throw error;
    }
  });

  router.patch('/admin/transport/buses/:id', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (req, res) => {
    const parsed = normalizeBusInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (!await ensureRouteExists(db, parsed.value.routeId)) return res.status(404).json({ error: 'The selected route was not found.' });
    try {
      const bus = await db.$transaction(async (tx) => {
        const updated = await tx.bus.update({ where: { id: req.params.id }, data: parsed.value, include: { route: true } });
        await writeActivity(tx, req, 'UPDATE', 'BUS', updated.id, `Updated bus ${updated.number} (${updated.name}).`);
        return updated;
      });
      return res.json(bus);
    } catch (error) {
      if (error?.code === 'P2025') return res.status(404).json({ error: 'Bus not found.' });
      if (error?.code === 'P2002') return res.status(409).json({ error: 'A bus with that number already exists.' });
      throw error;
    }
  });

  router.delete('/admin/transport/buses/:id', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (req, res) => {
    try {
      await db.$transaction(async (tx) => {
        const bus = await tx.bus.findUnique({ where: { id: req.params.id } });
        if (!bus) return;
        await tx.bus.delete({ where: { id: bus.id } });
        await writeActivity(tx, req, 'DELETE', 'BUS', bus.id, `Removed bus ${bus.number} (${bus.name}).`);
      });
      return res.sendStatus(204);
    } catch (error) {
      if (error?.code === 'P2025') return res.status(404).json({ error: 'Bus not found.' });
      throw error;
    }
  });

  router.post('/admin/transport/stops', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (req, res) => {
    const parsed = normalizeStopInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const stop = await db.$transaction(async (tx) => {
      const created = await tx.busStop.create({ data: parsed.value });
      await writeActivity(tx, req, 'CREATE', 'STOP', created.id, `Added bus stop ${created.name} in ${created.area}.`);
      return created;
    });
    return res.status(201).json(stop);
  });

  router.patch('/admin/transport/stops/:id', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (req, res) => {
    const parsed = normalizeStopInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    try {
      const stop = await db.$transaction(async (tx) => {
        const updated = await tx.busStop.update({ where: { id: req.params.id }, data: parsed.value });
        await writeActivity(tx, req, 'UPDATE', 'STOP', updated.id, `Updated bus stop ${updated.name}.`);
        return updated;
      });
      return res.json(stop);
    } catch (error) {
      if (error?.code === 'P2025') return res.status(404).json({ error: 'Bus stop not found.' });
      throw error;
    }
  });

  router.delete('/admin/transport/stops/:id', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (req, res) => {
    try {
      await db.$transaction(async (tx) => {
        const stop = await tx.busStop.findUnique({ where: { id: req.params.id } });
        if (!stop) return;
        await tx.busStop.delete({ where: { id: stop.id } });
        await writeActivity(tx, req, 'DELETE', 'STOP', stop.id, `Removed bus stop ${stop.name}.`);
      });
      return res.sendStatus(204);
    } catch (error) {
      if (error?.code === 'P2025') return res.status(404).json({ error: 'Bus stop not found.' });
      if (error?.code === 'P2003') return res.status(409).json({ error: 'Remove this stop from all routes before deleting it.' });
      throw error;
    }
  });

  router.post('/admin/transport/routes', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (req, res) => {
    const parsed = normalizeRouteInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (!await ensureStopsExist(db, parsed.value.stops)) return res.status(400).json({ error: 'One or more selected stops no longer exist.' });
    try {
      const route = await db.$transaction(async (tx) => {
        const created = await tx.transportRoute.create({
          data: {
            name: parsed.value.name,
            description: parsed.value.description,
            startingPoint: parsed.value.startingPoint,
            destination: parsed.value.destination,
            geometry: parsed.value.geometry,
            geometrySource: parsed.value.geometrySource,
            stops: { create: parsed.value.stops },
          },
          include: routeIncludes,
        });
        await writeActivity(tx, req, 'CREATE', 'ROUTE', created.id, `Created route ${created.name} with ${created.stops.length} stops.`);
        return created;
      });
      return res.status(201).json(route);
    } catch (error) {
      if (error?.code === 'P2002') return res.status(409).json({ error: 'A route with that name or stop order already exists.' });
      throw error;
    }
  });

  router.patch('/admin/transport/routes/:id', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (req, res) => {
    const parsed = normalizeRouteInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (!await ensureStopsExist(db, parsed.value.stops)) return res.status(400).json({ error: 'One or more selected stops no longer exist.' });
    try {
      const route = await db.$transaction(async (tx) => {
        await tx.transportRoute.findUniqueOrThrow({ where: { id: req.params.id }, select: { id: true } });
        await tx.routeStop.deleteMany({ where: { routeId: req.params.id } });
        const updated = await tx.transportRoute.update({
          where: { id: req.params.id },
          data: {
            name: parsed.value.name,
            description: parsed.value.description,
            startingPoint: parsed.value.startingPoint,
            destination: parsed.value.destination,
            geometry: parsed.value.geometry,
            geometrySource: parsed.value.geometrySource,
            stops: { create: parsed.value.stops },
          },
          include: routeIncludes,
        });
        await writeActivity(tx, req, 'UPDATE', 'ROUTE', updated.id, `Updated route ${updated.name} and its stop order.`);
        return updated;
      });
      return res.json(route);
    } catch (error) {
      if (error?.code === 'P2025') return res.status(404).json({ error: 'Route not found.' });
      if (error?.code === 'P2002') return res.status(409).json({ error: 'A route with that name or stop order already exists.' });
      throw error;
    }
  });

  router.delete('/admin/transport/routes/:id', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (req, res) => {
    try {
      await db.$transaction(async (tx) => {
        const route = await tx.transportRoute.findUnique({ where: { id: req.params.id }, include: { buses: { select: { id: true } } } });
        if (!route) return;
        if (route.buses.length) {
          const error = new Error('Reassign or remove the buses on this route before deleting it.');
          error.status = 409;
          throw error;
        }
        await tx.transportRoute.delete({ where: { id: route.id } });
        await writeActivity(tx, req, 'DELETE', 'ROUTE', route.id, `Removed route ${route.name}.`);
      });
      return res.sendStatus(204);
    } catch (error) {
      if (error?.status) return res.status(error.status).json({ error: error.message });
      if (error?.code === 'P2025') return res.status(404).json({ error: 'Route not found.' });
      throw error;
    }
  });

  router.post('/admin/transport/routes/:id/generate', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (req, res) => {
    const route = await db.transportRoute.findUnique({
      where: { id: req.params.id },
      include: { stops: { include: { busStop: true }, orderBy: { sequence: 'asc' } } },
    });
    if (!route) return res.status(404).json({ error: 'Route not found.' });
    if (route.stops.length < 2) return res.status(400).json({ error: 'Add at least two stops before generating road geometry.' });
    const routingBase = (process.env.OSRM_ROUTING_URL || '').replace(/\/+$/u, '');
    if (!routingBase) {
      return res.status(503).json({ error: 'Road routing is not configured. Draw the route manually on the map or configure OSRM_ROUTING_URL.' });
    }
    const coordinates = route.stops.map(({ busStop }) => `${busStop.longitude},${busStop.latitude}`).join(';');
    try {
      const response = await fetch(`${routingBase}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`, {
        signal: AbortSignal.timeout(12000),
      });
      const result = await response.json();
      const points = result.routes?.[0]?.geometry?.coordinates;
      if (!response.ok || result.code !== 'Ok' || !Array.isArray(points) || points.length < 2) {
        return res.status(502).json({ error: 'The routing service could not find a road route. Add route points manually on the map.' });
      }
      const geometry = points.map(([lng, lat]) => ({ lat, lng }));
      const updated = await db.$transaction(async (tx) => {
        const saved = await tx.transportRoute.update({
          where: { id: route.id },
          data: { geometry, geometrySource: 'OSRM' },
          include: routeIncludes,
        });
        await writeActivity(tx, req, 'GENERATE_GEOMETRY', 'ROUTE', route.id, `Generated road-based geometry for route ${route.name}.`);
        return saved;
      });
      return res.json(updated);
    } catch (error) {
      console.error('Transport road routing failed:', error);
      return res.status(502).json({ error: 'Road routing is unavailable. Draw and save route geometry manually on the map.' });
    }
  });

  router.post('/admin/transport/schedules', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), handleScheduleUpload, async (req, res) => {
    if (!req.file || !req.file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      return res.status(400).json({ error: 'Upload a valid PDF schedule.' });
    }
    const fileName = sanitizePdfName(req.file.originalname);
    const schedule = await db.$transaction(async (tx) => {
      const created = await tx.transportSchedule.create({
        data: {
          fileName,
          fileSize: req.file.size,
          fileData: req.file.buffer,
          status: 'DRAFT',
          uploadedById: req.user.id,
        },
        select: { id: true, fileName: true, fileSize: true, status: true, createdAt: true },
      });
      await writeActivity(tx, req, 'UPLOAD', 'SCHEDULE', created.id, `Uploaded draft schedule ${created.fileName}.`);
      return created;
    });
    return res.status(201).json(schedule);
  });

  router.get('/admin/transport/schedules', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (_req, res) => {
    return res.json(await db.transportSchedule.findMany({
      select: {
        id: true, fileName: true, fileSize: true, status: true, createdAt: true, publishedAt: true,
        uploadedBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }));
  });

  router.get('/admin/transport/schedules/:id/pdf', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (req, res) => {
    const schedule = await db.transportSchedule.findUnique({ where: { id: req.params.id } });
    if (!schedule) return res.status(404).json({ error: 'Schedule PDF not found.' });
    return sendPdf(res, schedule, req.query.download === '1');
  });

  router.post('/admin/transport/schedules/:id/publish', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (req, res) => {
    try {
      const publication = await db.$transaction(async (tx) => {
        const draft = await tx.transportSchedule.findFirst({ where: { id: req.params.id, status: 'DRAFT' } });
        if (!draft) return null;
        await tx.transportSchedule.updateMany({ where: { status: 'PUBLISHED' }, data: { status: 'ARCHIVED' } });
        const published = await tx.transportSchedule.update({
          where: { id: draft.id },
          data: { status: 'PUBLISHED', publishedAt: new Date() },
          select: { id: true, fileName: true, fileSize: true, status: true, publishedAt: true },
        });
        const notice = await tx.notice.create({
          data: {
            title: 'Transport schedule updated',
            body: `The current transport schedule (${published.fileName}) is available in Bus Tracking. Published ${published.publishedAt.toLocaleDateString()}.`,
            audience: 'ALL',
            category: 'TRANSPORT',
            transportScheduleId: published.id,
            authorId: req.user.id,
          },
        });
        const students = await tx.user.findMany({ where: { role: 'STUDENT', isActive: true }, select: { id: true } });
        if (students.length) {
          await tx.notification.createMany({
            data: students.map(({ id }) => ({ userId: id, noticeId: notice.id })),
            skipDuplicates: true,
          });
        }
        await writeActivity(tx, req, 'PUBLISH', 'SCHEDULE', published.id, `Published ${published.fileName}; archived the previous schedule.`);
        return { schedule: published, notice, notificationsCreated: students.length };
      });
      if (!publication) return res.status(409).json({ error: 'Only a draft schedule can be published.' });
      return res.json(publication);
    } catch (error) {
      if (error?.code === 'P2002') return res.status(409).json({ error: 'Another schedule was published at the same time. Refresh and try again.' });
      throw error;
    }
  });

  router.post('/admin/transport/notices', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (req, res) => {
    const parsed = normalizeNoticeInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const result = await db.$transaction(async (tx) => {
      const notice = await tx.notice.create({
        data: { ...parsed.value, audience: 'ALL', category: 'TRANSPORT', authorId: req.user.id },
      });
      const students = await tx.user.findMany({ where: { role: 'STUDENT', isActive: true }, select: { id: true } });
      if (students.length) {
        await tx.notification.createMany({
          data: students.map(({ id }) => ({ userId: id, noticeId: notice.id })),
          skipDuplicates: true,
        });
      }
      await writeActivity(tx, req, 'PUBLISH', 'NOTICE', notice.id, `Published transport notice ${notice.title}.`);
      return notice;
    });
    return res.status(201).json(result);
  });

  router.get('/notices', auth, async (req, res) => {
    const notices = await db.notice.findMany({
      where: { audience: { in: ['ALL', req.user.role] } },
      include: {
        author: { select: { name: true } },
        transportSchedule: { select: { id: true, fileName: true, publishedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return res.json(notices);
  });

  router.get('/admin/transport/stops', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (_req, res) => {
    return res.json(await db.busStop.findMany({
      include: { routes: { include: { route: { select: { id: true, name: true } } }, orderBy: { sequence: 'asc' } },
      orderBy: [{ area: 'asc' }, { name: 'asc' }],
    }));
  });

  router.get('/admin/transport/routes', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (_req, res) => {
    return res.json(await db.transportRoute.findMany({ include: routeIncludes, orderBy: { name: 'asc' } }));
  });

  router.get('/admin/transport/buses', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), async (_req, res) => {
    return res.json(await db.bus.findMany({ include: { route: true }, orderBy: { number: 'asc' } }));
  });

  router.get('/admin/transport/health', auth, roles('ADMIN', 'TRANSPORT_ADMIN'), (_req, res) => {
    return res.json({
      map: 'OpenStreetMap',
      geocoding: true,
      roadRouting: Boolean(process.env.OSRM_ROUTING_URL),
      supabaseAdminProvisioning: Boolean(supabaseAdmin),
      operatingDays: DAYS,
    });
  });

  return router;
}
