// Administrator console API: overview, user accounts, notices, fee invoices and result imports.
// Transport management lives in transportRoutes.js; result PDF preview/import lives in server.js.
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createMonthlyInvoices } from './monthlyInvoices.js';

export const ROLES = ['STUDENT', 'TEACHER', 'ADMIN', 'TRANSPORT_ADMIN'];
export const NOTICE_AUDIENCES = ['ALL', 'STUDENT', 'TEACHER'];
export const NOTICE_CATEGORIES = ['GENERAL', 'ACADEMIC', 'EXAM', 'EVENT', 'URGENT', 'TRANSPORT'];
export const INVOICE_STATUSES = ['UNPAID', 'PAID', 'CANCELLED'];
const MAX_INVOICE_AMOUNT = 10_000_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const optional = (value, max) => {
  const v = text(value);
  return v ? v.slice(0, max) : null;
};
const fail = (status, message) => Object.assign(new Error(message), { status });

export function normalizeNewUser(body) {
  if (!body || typeof body !== 'object') return { error: 'Enter the account details.' };
  const name = text(body.name);
  const email = text(body.email).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const role = ROLES.includes(body.role) ? body.role : null;
  if (!name || name.length > 100) return { error: 'Enter a name (up to 100 characters).' };
  if (!EMAIL_RE.test(email) || email.length > 320) return { error: 'Enter a valid email address.' };
  if (password.length < 8 || password.length > 1024) return { error: 'The password needs at least 8 characters.' };
  if (!role) return { error: 'Choose a role.' };
  const studentId = optional(body.studentId, 50)?.toUpperCase() ?? null;
  if (role === 'STUDENT' && !studentId) return { error: 'Students need a student ID.' };
  return {
    value: {
      name, email, password, role, studentId,
      department: optional(body.department, 100),
      batch: optional(body.batch, 50),
      section: optional(body.section, 50),
      phone: optional(body.phone, 30),
    },
  };
}

export function normalizeUserUpdate(body) {
  if (!body || typeof body !== 'object') return { error: 'Nothing to update.' };
  const data = {};
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) return { error: 'Choose a valid role.' };
    data.role = body.role;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') return { error: 'Active must be true or false.' };
    data.isActive = body.isActive;
  }
  if (body.name !== undefined) {
    const name = text(body.name);
    if (!name || name.length > 100) return { error: 'Enter a name (up to 100 characters).' };
    data.name = name;
  }
  for (const [field, max] of [['department', 100], ['batch', 50], ['section', 50], ['phone', 30]]) {
    if (body[field] !== undefined) data[field] = optional(body[field], max);
  }
  if (body.studentId !== undefined) data.studentId = optional(body.studentId, 50)?.toUpperCase() ?? null;
  if (!Object.keys(data).length) return { error: 'Nothing to update.' };
  return { value: data };
}

export function normalizeNotice(body) {
  if (!body || typeof body !== 'object') return { error: 'Enter the notice details.' };
  const title = text(body.title);
  const message = text(body.body);
  if (!title || title.length > 160) return { error: 'Enter a title (up to 160 characters).' };
  if (!message || message.length > 10000) return { error: 'Enter a message (up to 10,000 characters).' };
  const audience = body.audience === undefined ? 'ALL' : body.audience;
  const category = body.category === undefined ? 'GENERAL' : body.category;
  if (!NOTICE_AUDIENCES.includes(audience)) return { error: 'Choose who should see this notice.' };
  if (!NOTICE_CATEGORIES.includes(category)) return { error: 'Choose a notice category.' };
  return { value: { title, body: message, audience, category }, notify: body.notify !== false };
}

export function normalizeInvoiceFields(body) {
  if (!body || typeof body !== 'object') return { error: 'Enter the invoice details.' };
  const feeType = text(body.feeType);
  const description = text(body.description);
  const amount = Number(body.amount);
  const dueDate = body.dueDate ? new Date(body.dueDate) : null;
  if (!feeType || feeType.length > 80) return { error: 'Fee type is required (up to 80 characters).' };
  if (description.length > 500) return { error: 'Description can be up to 500 characters.' };
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_INVOICE_AMOUNT || Math.round(amount * 100) / 100 !== amount)
    return { error: 'Enter an amount in taka above 0, with at most 2 decimals.' };
  if (dueDate && Number.isNaN(dueDate.getTime())) return { error: 'Due date is not valid.' };
  return { value: { feeType, description: description || null, amount: amount.toFixed(2), dueDate } };
}

const audienceUserFilter = (audience) => ({
  isActive: true,
  role: audience === 'ALL' ? { in: ['STUDENT', 'TEACHER'] } : audience,
});

const userSelect = {
  id: true, name: true, email: true, role: true, studentId: true, department: true, batch: true,
  section: true, phone: true, isActive: true, createdAt: true, authId: true,
};
const invoiceInclude = {
  student: { select: { id: true, name: true, email: true, studentId: true, department: true, batch: true } },
  payments: { orderBy: { createdAt: 'desc' }, select: { id: true, provider: true, amount: true, status: true, verifiedAt: true, createdAt: true } },
};

export function createAdminRouter({ db, auth, roles, supabaseAdmin }) {
  const router = express.Router();
  const admin = [auth, roles('ADMIN')];
  const wrap = (handler) => async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error?.status) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  };

  // ---------- Overview ----------
  router.get('/admin/overview', ...admin, wrap(async (_req, res) => {
    const now = new Date();
    const [
      roleCounts, inactiveUsers, newStudents30d,
      invoiceGroups, overdue, collected30d,
      noticeCount, latestImport, importCount,
      activeBuses, routeCount, stopCount, schedule,
      recentInvoices, recentNotices, recentUsers, transportActivity,
    ] = await Promise.all([
      db.user.groupBy({ by: ['role'], _count: { _all: true } }),
      db.user.count({ where: { isActive: false } }),
      db.user.count({ where: { role: 'STUDENT', createdAt: { gte: new Date(now - 30 * 864e5) } } }),
      db.feeInvoice.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amount: true } }),
      db.feeInvoice.aggregate({ where: { status: 'UNPAID', dueDate: { lt: now } }, _count: { _all: true }, _sum: { amount: true } }),
      db.paymentAttempt.aggregate({ where: { status: 'SUCCESS', verifiedAt: { gte: new Date(now - 30 * 864e5) } }, _sum: { amount: true } }),
      db.notice.count(),
      db.resultImport.findFirst({ orderBy: { uploadedAt: 'desc' }, select: { fileName: true, uploadedAt: true, studentCount: true, recordCount: true } }),
      db.resultImport.count(),
      db.bus.count({ where: { isActive: true } }),
      db.transportRoute.count(),
      db.busStop.count(),
      db.transportSchedule.findFirst({ where: { status: 'PUBLISHED' }, select: { fileName: true, publishedAt: true } }),
      db.feeInvoice.findMany({ include: invoiceInclude, orderBy: { createdAt: 'desc' }, take: 6 }),
      db.notice.findMany({ select: { id: true, title: true, category: true, audience: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 }),
      db.user.findMany({ select: { id: true, name: true, email: true, role: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 }),
      db.transportActivity.findMany({ include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 5 }),
    ]);
    const users = Object.fromEntries(ROLES.map((role) => [role, 0]));
    for (const row of roleCounts) users[row.role] = row._count._all;
    const invoices = Object.fromEntries(INVOICE_STATUSES.map((status) => [status, { count: 0, amount: 0 }]));
    for (const row of invoiceGroups) invoices[row.status] = { count: row._count._all, amount: Number(row._sum.amount || 0) };
    res.json({
      users: { ...users, inactive: inactiveUsers, newStudents30d },
      invoices: {
        ...invoices,
        overdue: { count: overdue._count._all, amount: Number(overdue._sum.amount || 0) },
        collected30d: Number(collected30d._sum.amount || 0),
      },
      notices: noticeCount,
      results: { imports: importCount, latest: latestImport },
      transport: { activeBuses, routes: routeCount, stops: stopCount, schedule },
      recent: { invoices: recentInvoices, notices: recentNotices, users: recentUsers, transport: transportActivity },
      services: {
        userProvisioning: Boolean(supabaseAdmin),
        stripe: Boolean(process.env.STRIPE_SECRET_KEY),
        ai: Boolean(process.env.GROQ_API_KEY),
        googleClassroom: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        roadRouting: Boolean(process.env.OSRM_ROUTING_URL),
      },
    });
  }));

  // ---------- Users ----------
  router.get('/admin/accounts', ...admin, wrap(async (req, res) => {
    const q = text(req.query.q);
    const where = {};
    if (ROLES.includes(req.query.role)) where.role = req.query.role;
    if (req.query.status === 'active') where.isActive = true;
    if (req.query.status === 'inactive') where.isActive = false;
    if (q) where.OR = ['name', 'email', 'studentId', 'department'].map((field) => ({ [field]: { contains: q, mode: 'insensitive' } }));
    const accounts = await db.user.findMany({ where, select: userSelect, orderBy: [{ role: 'asc' }, { name: 'asc' }], take: 1000 });
    res.json(accounts.map(({ authId, ...account }) => ({ ...account, hasSignIn: Boolean(authId) })));
  }));

  router.post('/admin/accounts', ...admin, wrap(async (req, res) => {
    const parsed = normalizeNewUser(req.body);
    if (parsed.error) throw fail(400, parsed.error);
    if (!supabaseAdmin) throw fail(503, 'Creating accounts needs SUPABASE_SERVICE_ROLE_KEY on the backend.');
    const { password, ...profile } = parsed.value;
    const clash = await db.user.findFirst({
      where: { OR: [{ email: { equals: profile.email, mode: 'insensitive' } }, ...(profile.studentId ? [{ studentId: { equals: profile.studentId, mode: 'insensitive' } }] : [])] },
      select: { email: true },
    });
    if (clash) throw fail(409, clash.email.toLowerCase() === profile.email ? 'An account with that email already exists.' : 'That student ID is already in use.');
    // email_confirm: true means the person can sign in straight away, with no verification email.
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: profile.email, password, email_confirm: true, user_metadata: { name: profile.name },
    });
    if (error || !data?.user) {
      const exists = /already|registered|exists/iu.test(error?.message || '');
      throw fail(exists ? 409 : 502, exists ? 'That email already has a sign-in in Supabase Auth.' : 'Supabase Auth could not create the sign-in.');
    }
    try {
      const account = await db.user.create({ data: { ...profile, authId: data.user.id, isActive: true }, select: userSelect });
      const { authId, ...rest } = account;
      res.status(201).json({ ...rest, hasSignIn: true });
    } catch (dbError) {
      await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch(() => {});
      if (dbError?.code === 'P2002') throw fail(409, 'An account with that email or student ID already exists.');
      throw dbError;
    }
  }));

  router.patch('/admin/accounts/:id', ...admin, wrap(async (req, res) => {
    const parsed = normalizeUserUpdate(req.body);
    if (parsed.error) throw fail(400, parsed.error);
    if (req.params.id === req.user.id && (parsed.value.isActive === false || (parsed.value.role && parsed.value.role !== 'ADMIN')))
      throw fail(400, 'You cannot deactivate or demote your own administrator account.');
    try {
      const { authId, ...account } = await db.user.update({ where: { id: req.params.id }, data: parsed.value, select: userSelect });
      res.json({ ...account, hasSignIn: Boolean(authId) });
    } catch (error) {
      if (error?.code === 'P2025') throw fail(404, 'Account not found.');
      if (error?.code === 'P2002') throw fail(409, 'That student ID is already in use.');
      throw error;
    }
  }));

  router.post('/admin/accounts/:id/password', ...admin, wrap(async (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length < 8 || password.length > 1024) throw fail(400, 'The password needs at least 8 characters.');
    if (!supabaseAdmin) throw fail(503, 'Resetting passwords needs SUPABASE_SERVICE_ROLE_KEY on the backend.');
    const account = await db.user.findUnique({ where: { id: req.params.id }, select: { authId: true } });
    if (!account) throw fail(404, 'Account not found.');
    if (!account.authId) throw fail(409, 'This account has not signed in yet, so it has no password to reset.');
    const { error } = await supabaseAdmin.auth.admin.updateUserById(account.authId, { password, email_confirm: true });
    if (error) throw fail(502, 'Supabase Auth could not update the password.');
    res.json({ ok: true });
  }));

  // ---------- Notices ----------
  router.get('/admin/notices', ...admin, wrap(async (_req, res) => {
    const notices = await db.notice.findMany({
      include: { author: { select: { name: true } }, _count: { select: { notifications: true } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    res.json(notices);
  }));

  router.post('/admin/notices', ...admin, wrap(async (req, res) => {
    const parsed = normalizeNotice(req.body);
    if (parsed.error) throw fail(400, parsed.error);
    const result = await db.$transaction(async (tx) => {
      const notice = await tx.notice.create({ data: { ...parsed.value, authorId: req.user.id } });
      let notified = 0;
      if (parsed.notify) {
        const recipients = await tx.user.findMany({ where: audienceUserFilter(parsed.value.audience), select: { id: true } });
        if (recipients.length) {
          ({ count: notified } = await tx.notification.createMany({ data: recipients.map(({ id }) => ({ userId: id, noticeId: notice.id })), skipDuplicates: true }));
        }
      }
      return { ...notice, notified };
    });
    res.status(201).json(result);
  }));

  router.patch('/admin/notices/:id', ...admin, wrap(async (req, res) => {
    const parsed = normalizeNotice(req.body);
    if (parsed.error) throw fail(400, parsed.error);
    try {
      res.json(await db.notice.update({ where: { id: req.params.id }, data: parsed.value }));
    } catch (error) {
      if (error?.code === 'P2025') throw fail(404, 'Notice not found.');
      throw error;
    }
  }));

  router.delete('/admin/notices/:id', ...admin, wrap(async (req, res) => {
    const { count } = await db.notice.deleteMany({ where: { id: req.params.id } });
    if (!count) throw fail(404, 'Notice not found.');
    res.sendStatus(204);
  }));

  // ---------- Fee invoices ----------
  router.get('/admin/invoices', ...admin, wrap(async (req, res) => {
    const q = text(req.query.q);
    const where = {};
    if (INVOICE_STATUSES.includes(req.query.status)) where.status = req.query.status;
    if (req.query.status === 'OVERDUE') Object.assign(where, { status: 'UNPAID', dueDate: { lt: new Date() } });
    if (q) {
      where.OR = [
        { invoiceNumber: { contains: q, mode: 'insensitive' } },
        { feeType: { contains: q, mode: 'insensitive' } },
        { student: { is: { OR: ['name', 'email', 'studentId'].map((field) => ({ [field]: { contains: q, mode: 'insensitive' } })) } } },
      ];
    }
    res.json(await db.feeInvoice.findMany({ where, include: invoiceInclude, orderBy: { createdAt: 'desc' }, take: 500 }));
  }));

  router.post('/admin/invoices', ...admin, wrap(async (req, res) => {
    const parsed = normalizeInvoiceFields(req.body);
    if (parsed.error) throw fail(400, parsed.error);
    const studentId = typeof req.body.studentId === 'string' ? req.body.studentId : '';
    const student = studentId && await db.user.findFirst({ where: { id: studentId, role: 'STUDENT' }, select: { id: true } });
    if (!student) throw fail(404, 'Choose a student.');
    const invoice = await db.feeInvoice.create({
      data: { ...parsed.value, invoiceNumber: `INV-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`, studentId, currency: 'BDT', status: 'UNPAID' },
      include: invoiceInclude,
    });
    res.status(201).json(invoice);
  }));

  // Bill a group of students at once: everyone active, one batch or one department.
  router.post('/admin/invoices/bulk', ...admin, wrap(async (req, res) => {
    const parsed = normalizeInvoiceFields(req.body);
    if (parsed.error) throw fail(400, parsed.error);
    const where = { role: 'STUDENT', isActive: true };
    const target = req.body.target || 'ALL';
    if (target === 'BATCH') {
      const batch = text(req.body.batch);
      if (!batch) throw fail(400, 'Choose a batch.');
      where.batch = { equals: batch, mode: 'insensitive' };
    } else if (target === 'DEPARTMENT') {
      const department = text(req.body.department);
      if (!department) throw fail(400, 'Choose a department.');
      where.department = { equals: department, mode: 'insensitive' };
    } else if (target !== 'ALL') throw fail(400, 'Choose who to bill.');
    const students = await db.user.findMany({ where, select: { id: true } });
    if (!students.length) throw fail(404, 'No active students match that selection.');
    const year = new Date().getFullYear();
    const { count } = await db.feeInvoice.createMany({
      data: students.map(({ id }) => ({
        ...parsed.value, studentId: id, currency: 'BDT', status: 'UNPAID',
        invoiceNumber: `INV-${year}-${randomUUID().slice(0, 8).toUpperCase()}`,
      })),
    });
    res.status(201).json({ created: count, students: students.length });
  }));

  router.post('/admin/invoices/monthly-run', ...admin, wrap(async (_req, res) => {
    res.json(await createMonthlyInvoices(db));
  }));

  // Manual status changes: record a cash/bank payment, cancel an invoice, or reopen it.
  router.patch('/admin/invoices/:id', ...admin, wrap(async (req, res) => {
    const status = req.body?.status;
    if (!INVOICE_STATUSES.includes(status)) throw fail(400, 'Choose Unpaid, Paid or Cancelled.');
    const invoice = await db.feeInvoice.findUnique({ where: { id: req.params.id }, include: { payments: { where: { status: 'SUCCESS' }, select: { id: true, provider: true } } } });
    if (!invoice) throw fail(404, 'Invoice not found.');
    if (invoice.status === status) return res.json(await db.feeInvoice.findUnique({ where: { id: invoice.id }, include: invoiceInclude }));
    const paidOnline = invoice.payments.some((payment) => payment.provider !== 'MANUAL');
    if (status !== 'PAID' && paidOnline) throw fail(409, 'This invoice was paid online through Stripe and cannot be reopened or cancelled here.');
    const updated = await db.$transaction(async (tx) => {
      if (status === 'PAID') {
        await tx.paymentAttempt.create({
          data: { reference: randomUUID(), invoiceId: invoice.id, provider: 'MANUAL', amount: invoice.amount, currency: invoice.currency, status: 'SUCCESS', verifiedAt: new Date() },
        });
      } else {
        await tx.paymentAttempt.updateMany({ where: { invoiceId: invoice.id, provider: 'MANUAL', status: 'SUCCESS' }, data: { status: 'FAILED' } });
      }
      return tx.feeInvoice.update({ where: { id: invoice.id }, data: { status }, include: invoiceInclude });
    });
    res.json(updated);
  }));

  router.delete('/admin/invoices/:id', ...admin, wrap(async (req, res) => {
    const invoice = await db.feeInvoice.findUnique({ where: { id: req.params.id }, include: { payments: { where: { status: 'SUCCESS' }, select: { id: true } } } });
    if (!invoice) throw fail(404, 'Invoice not found.');
    if (invoice.payments.length) throw fail(409, 'This invoice has a recorded payment. Cancel it instead of deleting it.');
    await db.$transaction([
      db.paymentAttempt.deleteMany({ where: { invoiceId: invoice.id } }),
      db.feeInvoice.delete({ where: { id: invoice.id } }),
    ]);
    res.sendStatus(204);
  }));

  // ---------- Official result imports ----------
  router.get('/admin/results/imports', ...admin, wrap(async (_req, res) => {
    res.json(await db.resultImport.findMany({
      include: { uploadedBy: { select: { name: true, email: true } } },
      orderBy: { uploadedAt: 'desc' },
      take: 100,
    }));
  }));

  router.delete('/admin/results/imports/:id', ...admin, wrap(async (req, res) => {
    const { count } = await db.resultImport.deleteMany({ where: { id: req.params.id } });
    if (!count) throw fail(404, 'Result import not found.');
    res.sendStatus(204);
  }));

  return router;
}
