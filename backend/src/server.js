import 'dotenv/config';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createMonthlyInvoices } from './monthlyInvoices.js';
import { basename } from 'node:path';
import { calculateResultSummary } from '../../shared/grading.js';
import { extractPdfLines, isPdfBuffer, normalizeStudentId, ResultPdfError } from './result-import/pdfParser.js';
import { parseResultLines } from './result-import/resultParser.js';
import { getAuthenticatedStudentResultFilter } from './result-import/studentResultMatcher.js';
import { buildCgpaSummary, compareTerms } from './result-import/cgpa.js';
import { generateAssistantResponse } from './ai.js';
import { AiDocumentError, extractAiDocument, MAX_AI_DOCUMENT_BYTES, MAX_AI_DOCUMENT_TEXT } from './aiDocuments.js';
import { createTransportRouter } from './transportRoutes.js';
import { createAdminRouter } from './adminRoutes.js';
import { createAttendanceRouter } from './attendanceRoutes.js';
import { createCourseRouter } from './courseRoutes.js';
import { applyCheckoutSession, buildCheckoutParams, getStripe, StripeConfigError } from './stripePayments.js';
import { encryptSecret, getConnectionStatusForUser, getGoogleClassroomAuthUrl, getGoogleOAuthClient, disconnectGoogleAccountForUser, getStudentCourseworkForUser, GoogleReconnectRequiredError } from './googleClassroom.js';
import express from 'express'; import cors from 'cors'; import helmet from 'helmet'; import rateLimit from 'express-rate-limit'; import jwt from 'jsonwebtoken'; import multer from 'multer'; import { PrismaClient } from '@prisma/client'; import { createClient } from '@supabase/supabase-js';
const app=express(), db=new PrismaClient(); app.set('trust proxy',1); app.use(helmet()); app.use(cors({origin:process.env.FRONTEND_URL||'http://localhost:5173'})); const STRIPE_WEBHOOK_PATH='/api/payments/stripe/webhook', jsonBody=express.json({limit:'2mb'});
// Stripe's webhook signature is checked against the raw body, so that one route must skip JSON parsing.
app.use((req,res,next)=>req.path===STRIPE_WEBHOOK_PATH?next():jsonBody(req,res,next)); app.use(rateLimit({windowMs:15*60*1000,limit:300}));
const supabaseUrl=process.env.SUPABASE_URL, supabaseAnonKey=process.env.SUPABASE_ANON_KEY;
if(!supabaseUrl||!supabaseAnonKey)throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set. See backend/.env.example.');
const supabase=createClient(supabaseUrl,supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const userSelect={id:true,name:true,email:true,role:true,studentId:true,department:true,batch:true,section:true,isActive:true};
const profileError=(status,message)=>Object.assign(new Error(message),{status});
// Maps a verified Supabase Auth user to a portal User row (roles and profile data live in our own table).
async function findOrCreatePortalUser(authUser){
  const email=authUser.email.toLowerCase();
  const byAuthId=await db.user.findUnique({where:{authId:authUser.id},select:userSelect});
  if(byAuthId)return byAuthId;
  const existing=await db.user.findFirst({where:{email:{equals:email,mode:'insensitive'}}});
  if(existing){
    // Link a pre-existing portal user (e.g. seeded admin) the first time its confirmed email signs in.
    if(existing.authId&&existing.authId!==authUser.id)
      throw profileError(409,'This email is already linked to a different sign-in account. Contact your administrator to re-link it.');
    return db.user.update({where:{id:existing.id},data:{authId:authUser.id},select:userSelect});
  }
  const metadata=authUser.user_metadata||{};
  const name=typeof metadata.name==='string'?metadata.name.trim():'';
  const studentId=typeof metadata.studentId==='string'?metadata.studentId.trim().toUpperCase():'';
  const department=typeof metadata.department==='string'?metadata.department.trim():'';
  const batch=typeof metadata.batch==='string'?metadata.batch.trim():'';
  const section=typeof metadata.section==='string'?metadata.section.trim():'';
  if(!name||name.length>100||!studentId||studentId.length>50||!department||department.length>100||!batch||batch.length>50||!section||section.length>50)
    throw profileError(400,'Complete all required student profile fields during sign-up, then confirm your email and sign in.');
  const existingStudent=await db.user.findFirst({where:{studentId:{equals:studentId,mode:'insensitive'}}});
  if(existingStudent)throw profileError(409,'This student ID is already linked to a portal account. Contact your administrator if this is your ID.');
  return db.user.create({data:{name,email,authId:authUser.id,role:'STUDENT',studentId,department,batch,section},select:userSelect});
}
const auth=async(req,res,next)=>{
  try{
    const token=(req.headers.authorization||'').replace(/^Bearer /,'');
    if(!token)return res.sendStatus(401);
    const {data,error}=await supabase.auth.getUser(token);
    const authUser=data?.user;
    // An unconfirmed email must never be linked to an existing portal account.
    if(error||!authUser?.email||!authUser.email_confirmed_at)return res.sendStatus(401);
    let user;
    try{user=await findOrCreatePortalUser(authUser)}
    catch(e){
      if(e?.code!=='P2002')throw e;
      user=await db.user.findUnique({where:{authId:authUser.id},select:userSelect}); // parallel first requests raced
      if(!user&&Array.isArray(e.meta?.target)&&e.meta.target.includes('studentId'))
        return res.status(409).json({error:'This student ID is already linked to a portal account. Contact your administrator if this is your ID.'});
    }
    if(!user)return res.sendStatus(401);
    if(!user.isActive)return res.status(403).json({error:'This account is currently inactive. Contact a university administrator.'});
    req.user=user; next();
  }catch(e){
    if(e?.status)return res.status(e.status).json({error:e.message});
    // A database/server failure is not an authentication failure: report it as such so the
    // client does not tell a confirmed user to "confirm your email".
    console.error('Auth error:',e?.message||e);
    return res.status(500).json({error:'The server could not load your portal profile. Please try again later or contact your administrator.'});
  }
};
const roles=(...r)=>(req,res,next)=>r.includes(req.user?.role)?next():res.status(403).json({error:'You are not authorized to perform this action.'});
const jwtSecret=process.env.JWT_SECRET;
if(!jwtSecret||jwtSecret.length<32||jwtSecret.startsWith('replace-this-'))throw new Error('JWT_SECRET must be set to a random string of at least 32 characters. See backend/.env.example.');
const frontendBaseUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
const resultUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } }).single('file');
const aiDocumentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AI_DOCUMENT_BYTES, files: 1 } }).single('file');
const handleAiDocumentUpload = (req, res, next) => aiDocumentUpload(req, res, (error) => {
  if (!error) return next();
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Documents must be 10 MB or smaller.' });
  }
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Upload one document at a time.' });
  }
  return next(error);
});
const handleResultUpload = (req, res, next) => resultUpload(req, res, (error) => {
  if (!error) return next();
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'The PDF must be 15 MB or smaller.' });
  }
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Upload one PDF file to continue.' });
  }
  return next(error);
});

const parseResultUpload = async (req) => {
  if (!req.file) throw new ResultPdfError('Choose a PDF file to upload.', 'FILE_REQUIRED');
  if (!isPdfBuffer(req.file.buffer)) throw new ResultPdfError('The uploaded file is not a valid PDF.');
  const parsed = parseResultLines(await extractPdfLines(req.file.buffer));
  return {
    ...parsed,
    fileHash: createHash('sha256').update(req.file.buffer).digest('hex'),
    fileName: basename(req.file.originalname).replace(/[^\w.() -]/gu, '_').slice(0, 180) || 'university-results.pdf',
  };
};

const uniqueProvidedValue = (records, field) => {
  const values = [...new Set(records.map((record) => record[field]).filter((value) => value !== null && value !== undefined))];
  return values.length === 1 ? values[0] : null;
};

const resultPdfErrorResponse = (res, error) => {
  if (error instanceof ResultPdfError) {
    const status = error.code === 'FILE_REQUIRED' ? 400 : 422;
    return res.status(status).json({ error: error.message, code: error.code });
  }
  console.error('University result PDF processing failed:', error);
  return res.status(500).json({ error: 'Unable to process this result PDF.' });
};

app.get('/api/health',(_,res)=>res.json({ok:true,service:'Smart University Portal API'}));
app.get('/api/google/classroom/connect', auth, async (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
      return res.status(500).json({ error: 'Google Classroom integration is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI to backend/.env.' });
    }
    const state = jwt.sign({ sub: req.user.id, purpose: 'google-classroom', iat: Math.floor(Date.now()/1000) }, jwtSecret, { expiresIn: '10m' });
    // Returned as JSON: the browser must call this with its bearer token, so it cannot follow a redirect here.
    res.json({ url: getGoogleClassroomAuthUrl(req.user.email, state) });
  } catch (error) {
    console.error('Google Classroom connect error:', error);
    return res.status(500).json({ error: 'Unable to start the Google Classroom connection flow.' });
  }
});
app.get('/api/google/classroom/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;
  if (oauthError) {
    return res.redirect(`${frontendBaseUrl}?googleClassroom=denied`);
  }
  if (!code || !state) {
    return res.status(400).json({ error: 'Missing Google OAuth callback data.' });
  }
  try {
    const payload = jwt.verify(String(state), jwtSecret);
    if (payload?.purpose !== 'google-classroom') {
      return res.status(400).json({ error: 'Invalid Google OAuth state.' });
    }
    const oauth2Client = getGoogleOAuthClient();
    const { tokens } = await oauth2Client.getToken(String(code));
    if (!tokens.access_token) {
      throw new Error('Google did not return an access token.');
    }
    oauth2Client.setCredentials(tokens);
    const googleUserInfo = await oauth2Client.request({ url: 'https://www.googleapis.com/oauth2/v3/userinfo' });
    const profile = googleUserInfo.data || {};
    await db.googleAccountConnection.upsert({
      where: { userId: payload.sub },
      update: {
        googleUserId: profile.sub || payload.sub,
        email: profile.email || '',
        accessTokenEncrypted: encryptSecret(tokens.access_token),
        refreshTokenEncrypted: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : undefined,
        tokenType: tokens.token_type || 'Bearer',
        scope: tokens.scope || '',
        expiryDate: tokens.expiry_date ? new Date(Number(tokens.expiry_date)) : null,
      },
      create: {
        userId: payload.sub,
        googleUserId: profile.sub || payload.sub,
        email: profile.email || '',
        accessTokenEncrypted: encryptSecret(tokens.access_token),
        refreshTokenEncrypted: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : undefined,
        tokenType: tokens.token_type || 'Bearer',
        scope: tokens.scope || '',
        expiryDate: tokens.expiry_date ? new Date(Number(tokens.expiry_date)) : null,
      },
    });
    return res.redirect(`${frontendBaseUrl}?googleClassroom=connected`);
  } catch (error) {
    console.error('Google Classroom callback error:', error);
    return res.redirect(`${frontendBaseUrl}?googleClassroom=error`);
  }
});
app.get('/api/google/classroom/status', auth, async (req, res) => {
  try {
    const connection = await getConnectionStatusForUser(req.user.id);
    res.json(connection);
  } catch (error) {
    console.error('Google Classroom status error:', error);
    res.status(500).json({ error: 'Unable to read the Google Classroom connection status.' });
  }
});
// Live, read-only list of the student's own Classroom coursework; submitting happens in Classroom via each item's link.
app.get('/api/google/classroom/coursework', auth, async (req, res) => {
  try {
    const coursework = await getStudentCourseworkForUser(req.user.id);
    if (!coursework) {
      return res.status(404).json({ error: 'Connect Google Classroom to see your coursework.', code: 'NOT_CONNECTED' });
    }
    res.json({ fetchedAt: new Date().toISOString(), coursework });
  } catch (error) {
    if (error instanceof GoogleReconnectRequiredError) {
      return res.status(409).json({ error: error.message, code: 'RECONNECT_REQUIRED' });
    }
    console.error('Google Classroom coursework error:', error?.message || error);
    res.status(502).json({ error: 'Google Classroom is unavailable right now. Try again in a moment.' });
  }
});
app.post('/api/google/classroom/disconnect', auth, async (req, res) => {
  try {
    const disconnected = await disconnectGoogleAccountForUser(req.user.id);
    if (!disconnected) {
      return res.status(404).json({ error: 'No Google Classroom account is connected for this user.' });
    }
    res.json({ connected: false, message: 'Google Classroom disconnected successfully.' });
  } catch (error) {
    console.error('Google Classroom disconnect error:', error);
    res.status(500).json({ error: 'Unable to disconnect the Google Classroom account.' });
  }
});
app.delete('/api/google/classroom/disconnect', auth, async (req, res) => {
  try {
    const disconnected = await disconnectGoogleAccountForUser(req.user.id);
    if (!disconnected) {
      return res.status(404).json({ error: 'No Google Classroom account is connected for this user.' });
    }
    res.json({ connected: false, message: 'Google Classroom disconnected successfully.' });
  } catch (error) {
    console.error('Google Classroom disconnect error:', error);
    res.status(500).json({ error: 'Unable to disconnect the Google Classroom account.' });
  }
});
app.get('/api/me',auth,(req,res)=>res.json(req.user));
app.use('/api',createTransportRouter({
  db,
  auth,
  roles,
  supabaseUrl,
  serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY,
  createClient,
}));
const supabaseAdmin=process.env.SUPABASE_SERVICE_ROLE_KEY?createClient(supabaseUrl,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}):null;
app.use('/api',createAdminRouter({db,auth,roles,supabaseAdmin}));
app.use('/api',createAttendanceRouter({db,auth,roles}));
app.use('/api',createCourseRouter({db,auth,roles}));
app.get('/api/dashboard',auth,async(req,res)=>{const [courses,notices,assignments,payments]=await Promise.all([db.courseEnrollment.count({where:{userId:req.user.id}}),db.notice.findMany({orderBy:{createdAt:'desc'},take:5}),db.assignment.findMany({take:5,orderBy:{dueAt:'asc'}}),db.payment.findMany({where:{studentId:req.user.id},orderBy:{createdAt:'desc'},take:5})]);res.json({courses,notices,assignments,payments})});
app.get('/api/courses',auth,async(_,res)=>res.json(await db.course.findMany({include:{enrollments:true}})));
app.post('/api/courses/:id/register',auth,roles('STUDENT'),async(req,res)=>{try{res.json(await db.courseEnrollment.create({data:{userId:req.user.id,courseId:req.params.id,semester:req.body.semester||'Fall 2026'}}))}catch{res.status(409).json({error:'Already registered or course not found'})}});
app.post('/api/notices',auth,roles('ADMIN','TEACHER'),async(req,res)=>res.status(201).json(await db.notice.create({data:{title:req.body.title,body:req.body.body,audience:req.body.audience||'ALL',authorId:req.user.id}})));
app.get('/api/assignments',auth,async(_,res)=>res.json(await db.assignment.findMany({include:{course:true},orderBy:{dueAt:'asc'}})));
app.post('/api/assignments',auth,roles('ADMIN','TEACHER'),async(req,res)=>res.status(201).json(await db.assignment.create({data:{title:req.body.title,description:req.body.description,courseId:req.body.courseId,teacherId:req.user.id,dueAt:req.body.dueAt?new Date(req.body.dueAt):null}})));
// ---------- Fee invoices and Stripe Checkout ----------
const MAX_INVOICE_AMOUNT = 10_000_000;
const INVOICE_INCLUDE = { payments: { orderBy: { createdAt: 'desc' }, select: { id: true, reference: true, provider: true, amount: true, currency: true, status: true, verifiedAt: true, createdAt: true } } };
const INVOICE_STUDENT = { student: { select: { id: true, name: true, email: true, studentId: true } } };
const sendStripeError = (res, error, message) => {
  if (error instanceof StripeConfigError) return res.status(503).json({ error: error.message });
  console.error(message, error);
  return res.status(502).json({ error: message });
};

// Called by the Vercel schedule in backend/vercel.json on the 1st of each month (Dhaka time),
// which sends "Authorization: Bearer $CRON_SECRET". Reruns are harmless: one invoice per student per month.
app.post('/api/cron/monthly-invoices', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) return res.sendStatus(401);
  try {
    const result = await createMonthlyInvoices(db);
    console.log('Monthly invoices:', result);
    res.json(result);
  } catch (error) {
    console.error('Monthly invoice run failed:', error);
    res.status(500).json({ error: 'Monthly invoice run failed.' });
  }
});

app.get('/api/invoices', auth, async (req, res) => {
  const isAdmin = req.user.role === 'ADMIN';
  res.json(await db.feeInvoice.findMany({
    where: isAdmin ? {} : { studentId: req.user.id },
    include: isAdmin ? { ...INVOICE_INCLUDE, ...INVOICE_STUDENT } : INVOICE_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: 200,
  }));
});

app.post('/api/invoices', auth, roles('ADMIN'), async (req, res) => {
  const { studentId, feeType, description, amount, dueDate } = req.body || {};
  const fee = String(feeType ?? '').trim();
  const details = String(description ?? '').trim();
  const value = Number(amount);
  const due = dueDate ? new Date(dueDate) : null;
  if (typeof studentId !== 'string' || !studentId) return res.status(400).json({ error: 'Choose a student.' });
  if (!fee || fee.length > 80) return res.status(400).json({ error: 'Fee type is required (up to 80 characters).' });
  if (details.length > 500) return res.status(400).json({ error: 'Description can be up to 500 characters.' });
  if (!Number.isFinite(value) || value <= 0 || value > MAX_INVOICE_AMOUNT || Math.round(value * 100) / 100 !== value)
    return res.status(400).json({ error: 'Enter an amount in taka above 0, with at most 2 decimals.' });
  if (due && Number.isNaN(due.getTime())) return res.status(400).json({ error: 'Due date is not valid.' });
  const student = await db.user.findFirst({ where: { id: studentId, role: 'STUDENT' }, select: { id: true } });
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  const invoice = await db.feeInvoice.create({
    data: {
      invoiceNumber: `INV-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
      studentId, feeType: fee, description: details || null, amount: value.toFixed(2), currency: 'BDT', dueDate: due, status: 'UNPAID',
    },
    include: { ...INVOICE_INCLUDE, ...INVOICE_STUDENT },
  });
  res.status(201).json(invoice);
});

app.post('/api/payments/checkout', auth, roles('STUDENT'), async (req, res) => {
  try {
    const stripe = getStripe();
    const invoiceId = req.body?.invoiceId;
    if (typeof invoiceId !== 'string' || !invoiceId) return res.status(400).json({ error: 'Invoice ID is required.' });
    const invoice = await db.feeInvoice.findFirst({ where: { id: invoiceId, studentId: req.user.id } });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
    if (invoice.status === 'PAID') return res.status(400).json({ error: 'This invoice is already paid.' });

    // Reuse a still-open session, so a double click can't create two payable sessions for one invoice.
    const open = await db.paymentAttempt.findFirst({ where: { invoiceId, provider: 'STRIPE', status: 'PENDING', providerPaymentId: { not: null } }, orderBy: { createdAt: 'desc' } });
    if (open) {
      const existing = await stripe.checkout.sessions.retrieve(open.providerPaymentId);
      if (existing.status === 'open' && existing.url) return res.json({ url: existing.url });
      if ((await applyCheckoutSession(db, existing)).status === 'SUCCESS') return res.status(400).json({ error: 'This invoice is already paid.' });
    }

    const attempt = await db.paymentAttempt.create({ data: { reference: randomUUID(), invoiceId, provider: 'STRIPE', amount: invoice.amount, currency: invoice.currency, status: 'PENDING' } });
    try {
      const session = await stripe.checkout.sessions.create(buildCheckoutParams({ invoice, attempt, frontendBaseUrl, customerEmail: req.user.email }));
      await db.paymentAttempt.update({ where: { id: attempt.id }, data: { providerPaymentId: session.id } });
      return res.json({ url: session.url });
    } catch (error) {
      await db.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED' } });
      throw error;
    }
  } catch (error) {
    return sendStripeError(res, error, 'Unable to start the Stripe payment.');
  }
});

// Backup for the webhook: when the student returns from Checkout, ask Stripe directly for the session's state.
app.post('/api/payments/stripe/confirm', auth, async (req, res) => {
  try {
    const sessionId = req.body?.sessionId;
    if (typeof sessionId !== 'string' || !/^cs_(test|live)_[A-Za-z0-9]+$/u.test(sessionId)) return res.status(400).json({ error: 'Invalid Stripe session.' });
    const attempt = await db.paymentAttempt.findUnique({ where: { providerPaymentId: sessionId }, include: { invoice: { select: { studentId: true } } } });
    if (!attempt || attempt.invoice.studentId !== req.user.id) return res.status(404).json({ error: 'Payment not found.' });
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    res.json({ status: (await applyCheckoutSession(db, session)).status });
  } catch (error) {
    return sendStripeError(res, error, 'Unable to check the Stripe payment.');
  }
});

app.post(STRIPE_WEBHOOK_PATH, express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Stripe webhook secret is not configured.' });
  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch (error) {
    if (error instanceof StripeConfigError) return res.status(503).json({ error: error.message });
    return res.status(400).json({ error: 'Invalid Stripe signature.' });
  }
  try {
    const session = event.data.object;
    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired'].includes(event.type)) await applyCheckoutSession(db, session);
    else if (event.type === 'checkout.session.async_payment_failed') await applyCheckoutSession(db, session, { failed: true });
    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    res.status(500).json({ error: 'Webhook handling failed.' }); // Stripe retries on 5xx
  }
});
app.get('/api/payments',auth,async(req,res)=>res.json(await db.payment.findMany({where:req.user.role==='STUDENT'?{studentId:req.user.id}:{},orderBy:{createdAt:'desc'}})));
app.post('/api/ai/chat',auth,async(req,res)=>{
  const messages=req.body?.messages;
  if(!Array.isArray(messages)||messages.length===0||messages.length>20)
    return res.status(400).json({error:'Send between 1 and 20 chat messages.'});
  const normalizedMessages=[];
  for(const message of messages) {
    const role=message?.role;
    const content=typeof message?.content==='string'?message.content.trim():'';
    if(!['user','assistant'].includes(role)||!content||content.length>5000)
      return res.status(400).json({error:'Each message must have a user or assistant role and contain 1 to 5000 characters.'});
    normalizedMessages.push({role,content});
  }
  if(normalizedMessages[normalizedMessages.length-1].role!=='user')
    return res.status(400).json({error:'The latest chat message must be from the user.'});
  if(req.body?.documentText!==undefined&&typeof req.body.documentText!=='string')
    return res.status(400).json({error:'Document context must be text.'});
  const documentText=req.body?.documentText||'';
  if(documentText.length>MAX_AI_DOCUMENT_TEXT)
    return res.status(400).json({error:'The document context is too large. Upload the document again.'});
  if(!process.env.GROQ_API_KEY)return res.json({mode:'demo',answer:'Demo EduAI: I can help explain concepts, summarize notes and create practice questions. Add GROQ_API_KEY to backend/.env to enable live AI responses.'});
  try {
    const answer=await generateAssistantResponse(normalizedMessages,{userName:req.user.name,documentText});
    return res.json({mode:'live',answer});
  } catch(error) {
    console.error('Groq AI request failed:',error);
    return res.status(502).json({error:'AI service unavailable. Check the Groq API configuration and try again.'});
  }
});
app.post('/api/ai/document',auth,handleAiDocumentUpload,async(req,res)=>{
  try {
    const document=await extractAiDocument(req.file);
    const fileName=String(req.file.originalname||'document')
      .split(/[\\/]/u).at(-1)
      .replace(/[^\w.() -]/gu,'_')
      .slice(0,180);
    return res.json({fileName,text:document.text,truncated:document.truncated});
  } catch(error) {
    if(error instanceof AiDocumentError)
      return res.status(error.status).json({error:error.message,code:error.code});
    console.error('AI document extraction failed:',error);
    return res.status(500).json({error:'Unable to read this document.'});
  }
});
app.post('/api/pdf/upload',auth,multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024},fileFilter:(_,f,cb)=>cb(null,f.mimetype==='application/pdf')}).single('file'),(req,res)=>{if(!req.file)return res.status(400).json({error:'Upload a PDF (maximum 10 MB)'});res.status(202).json({message:'PDF received. Connect a PDF text-extraction/OCR worker to enable document Q&A and summaries.',filename:req.file.originalname,size:req.file.size,mode:'processing-required'})});
app.get('/api/transport',auth,async(_,res)=>{if(!process.env.TRANSPORT_PROVIDER_URL)return res.json({mode:'demo',message:'Sample locations only — connect a GPS provider for live tracking.',buses:[{id:'BUS-01',name:'Campus Shuttle 01',latitude:24.8949,longitude:91.8687,status:'DEMO'},{id:'BUS-02',name:'Campus Shuttle 02',latitude:24.9001,longitude:91.875,status:'DEMO'}]});try{const r=await fetch(process.env.TRANSPORT_PROVIDER_URL,{headers:{Authorization:`Bearer ${process.env.TRANSPORT_API_KEY}`}});res.json({mode:'live',buses:await r.json()})}catch{res.status(502).json({error:'Transport provider unavailable'})}});
app.post('/api/admin/results/import/preview', auth, roles('ADMIN'), handleResultUpload, async (req, res) => {
  try {
    const parsed = await parseResultUpload(req);
    const existing = await db.resultImport.findUnique({ where: { fileHash: parsed.fileHash }, select: { id: true, uploadedAt: true } });
    return res.json({
      fileName: parsed.fileName,
      studentCount: parsed.studentCount,
      recordCount: parsed.records.length,
      duplicate: Boolean(existing),
      alreadyImportedAt: existing?.uploadedAt ?? null,
      message: existing ? 'This exact PDF has already been imported.' : 'PDF parsed successfully. Review the detected counts before importing.',
    });
  } catch (error) {
    return resultPdfErrorResponse(res, error);
  }
});

app.post('/api/admin/results/import', auth, roles('ADMIN'), handleResultUpload, async (req, res) => {
  try {
    const parsed = await parseResultUpload(req);
    const existing = await db.resultImport.findUnique({ where: { fileHash: parsed.fileHash }, select: { id: true } });
    if (existing) return res.status(409).json({ error: 'This exact PDF has already been imported.', code: 'DUPLICATE_IMPORT' });

    const imported = await db.$transaction(async (transaction) => {
      const resultImport = await transaction.resultImport.create({
        data: {
          fileName: parsed.fileName,
          fileHash: parsed.fileHash,
          uploadedById: req.user.id,
          recordCount: parsed.records.length,
          studentCount: parsed.studentCount,
        },
      });

      for (let start = 0; start < parsed.records.length; start += 500) {
        const batch = parsed.records.slice(start, start + 500).map((record) => ({
          ...record,
          resultImportId: resultImport.id,
        }));
        await transaction.universityResult.createMany({ data: batch });
      }
      return resultImport;
    });

    return res.status(201).json({
      id: imported.id,
      fileName: imported.fileName,
      studentCount: imported.studentCount,
      recordCount: imported.recordCount,
      uploadedAt: imported.uploadedAt,
      message: 'University results imported successfully.',
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: 'This exact PDF has already been imported.', code: 'DUPLICATE_IMPORT' });
    }
    return resultPdfErrorResponse(res, error);
  }
});

app.get('/api/results/official', auth, roles('STUDENT'), async (req, res) => {
  if (!normalizeStudentId(req.user.studentId)) {
    return res.status(400).json({ error: 'A Student ID is not configured for this account.' });
  }

  const latestImport = await db.resultImport.findFirst({
    where: { status: 'IMPORTED' },
    orderBy: { uploadedAt: 'desc' },
    select: { id: true, fileName: true, uploadedAt: true },
  });
  if (!latestImport) {
    return res.json({
      found: false,
      message: 'Your result was not found in the currently uploaded university result document.',
    });
  }

  const records = await db.universityResult.findMany({
    where: {
      ...getAuthenticatedStudentResultFilter(latestImport.id, req.user.studentId),
    },
    orderBy: [{ semester: 'asc' }, { academicYear: 'asc' }, { courseCode: 'asc' }, { courseTitle: 'asc' }],
  });
  if (!records.length) {
    return res.json({
      found: false,
      message: 'Your result was not found in the currently uploaded university result document.',
    });
  }

  records.sort(compareTerms); // stable: keeps course order within a term
  // CGPA is the headline figure: the university's own CGPA when the PDF has one, otherwise
  // calculated cumulatively over every term in chronological order.
  const { semesters: semesterSummaries, cgpa: summaryCgpa, cgpaSource } = buildCgpaSummary(records);
  const latestTerm = semesterSummaries.at(-1);
  const summaryGpa = latestTerm?.gpa ?? null;
  const providedLatestGpa = latestTerm ? uniqueProvidedValue(records.filter((record) => (record.semester ?? null) === latestTerm.semester && (record.academicYear ?? null) === latestTerm.academicYear), 'gpa') : null;
  const resultSummary = calculateResultSummary(records);

  return res.json({
    found: true,
    student: {
      studentId: records[0].studentId,
      name: records.find((record) => record.studentName)?.studentName ?? req.user.name,
    },
    records: records.map((record) => ({
      courseCode: record.courseCode,
      courseTitle: record.courseTitle,
      credits: record.credits,
      marks: record.marks,
      grade: record.grade,
      gradePoint: record.gradePoint,
      semester: record.semester,
      academicYear: record.academicYear,
    })),
    semesters: semesterSummaries,
    summary: {
      cgpa: summaryCgpa,
      cgpaSource,
      // gpa is the latest term's GPA, kept as a secondary figure.
      gpa: summaryGpa,
      gpaSource: summaryGpa === null ? null : providedLatestGpa !== null ? 'university' : 'calculated',
      semesterCount: semesterSummaries.length,
      totalQualityPoints: resultSummary.totalQualityPoints,
      totalAttemptedCredits: resultSummary.attemptedCredits,
      totalEarnedCredits: resultSummary.earnedCredits,
      totalCgpaCredits: resultSummary.gpaCredits,
    },
    source: {
      label: 'Imported from university-provided result PDF',
      fileName: latestImport.fileName,
      uploadedAt: latestImport.uploadedAt,
    },
  });
});

app.get('/api/results',auth,async(req,res)=>res.json(await db.result.findMany({where:{studentId:req.user.id}})));
app.get('/api/teachers',auth,async(_,res)=>res.json(await db.user.findMany({where:{role:'TEACHER'},select:{id:true,name:true,department:true,email:true}})));
app.get('/api/resources',auth,async(_,res)=>res.json(await db.resource.findMany()));
app.get('/api/questions',auth,async(_,res)=>res.json(await db.question.findMany({take:100})));
app.get('/api/admin/users',auth,roles('ADMIN'),async(_,res)=>res.json(await db.user.findMany({select:{id:true,name:true,email:true,role:true,department:true,studentId:true,batch:true,section:true}})));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Internal server error'})});
const port=process.env.PORT||4000;
// Vercel runs the exported app itself; only listen when running locally or on a plain Node host.
if(!process.env.VERCEL)app.listen(port,()=>console.log(`Portal API running on http://localhost:${port}`));
export default app;
