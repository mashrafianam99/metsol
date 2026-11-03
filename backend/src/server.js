import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { calculateResultSummary, SPECIAL_GRADES } from '../../shared/grading.js';
import { extractPdfLines, isPdfBuffer, normalizeStudentId, ResultPdfError } from './result-import/pdfParser.js';
import { parseResultLines } from './result-import/resultParser.js';
import { getAuthenticatedStudentResultFilter } from './result-import/studentResultMatcher.js';
import { generateAssistantResponse } from './ai.js';
import { AiDocumentError, extractAiDocument, MAX_AI_DOCUMENT_BYTES, MAX_AI_DOCUMENT_TEXT } from './aiDocuments.js';
import { createTransportRouter } from './transportRoutes.js';
import { encryptSecret, getConnectionStatusForUser, getGoogleClassroomAuthUrl, getGoogleOAuthClient, disconnectGoogleAccountForUser, syncGoogleClassroomAssignmentsForUser } from './googleClassroom.js';
import express from 'express'; import cors from 'cors'; import helmet from 'helmet'; import rateLimit from 'express-rate-limit'; import jwt from 'jsonwebtoken'; import multer from 'multer'; import { PrismaClient } from '@prisma/client'; import { createClient } from '@supabase/supabase-js';
const app=express(), db=new PrismaClient(); app.use(helmet()); app.use(cors({origin:process.env.FRONTEND_URL||'http://localhost:5173'})); app.use(express.json({limit:'2mb'})); app.use(rateLimit({windowMs:15*60*1000,limit:300}));
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
    if(existing.authId&&existing.authId!==authUser.id)return null;
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
    console.error('Auth error:',e?.message||e);return res.sendStatus(401);
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

const calculateGpa = (records) => {
  const gpa = calculateResultSummary(records).semesterGpa;
  return gpa > 0 || records.some((record) => !SPECIAL_GRADES.has(record.grade)) ? gpa : null;
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
    res.redirect(getGoogleClassroomAuthUrl(req.user.id, state));
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
app.post('/api/google/classroom/sync', auth, async (req, res) => {
  try {
    const assignments = await syncGoogleClassroomAssignmentsForUser(req.user.id);
    res.json({ connected: assignments.length > 0 || true, assignments });
  } catch (error) {
    console.error('Google Classroom sync error:', error);
    res.status(400).json({ error: error.message || 'Unable to sync Classroom assignments.' });
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
app.get('/api/dashboard',auth,async(req,res)=>{const [courses,notices,assignments,payments]=await Promise.all([db.courseEnrollment.count({where:{userId:req.user.id}}),db.notice.findMany({orderBy:{createdAt:'desc'},take:5}),db.assignment.findMany({take:5,orderBy:{dueAt:'asc'}}),db.payment.findMany({where:{studentId:req.user.id},orderBy:{createdAt:'desc'},take:5})]);res.json({courses,notices,assignments,payments})});
app.get('/api/courses',auth,async(_,res)=>res.json(await db.course.findMany({include:{enrollments:true}})));
app.post('/api/courses/:id/register',auth,roles('STUDENT'),async(req,res)=>{try{res.json(await db.courseEnrollment.create({data:{userId:req.user.id,courseId:req.params.id,semester:req.body.semester||'Fall 2026'}}))}catch{res.status(409).json({error:'Already registered or course not found'})}});
app.post('/api/notices',auth,roles('ADMIN','TEACHER'),async(req,res)=>res.status(201).json(await db.notice.create({data:{title:req.body.title,body:req.body.body,audience:req.body.audience||'ALL',authorId:req.user.id}})));
app.get('/api/assignments',auth,async(_,res)=>res.json(await db.assignment.findMany({include:{course:true},orderBy:{dueAt:'asc'}})));
app.post('/api/assignments',auth,roles('ADMIN','TEACHER'),async(req,res)=>res.status(201).json(await db.assignment.create({data:{title:req.body.title,description:req.body.description,courseId:req.body.courseId,teacherId:req.user.id,dueAt:req.body.dueAt?new Date(req.body.dueAt):null}})));
app.post('/api/payments/initiate', auth, roles('STUDENT'), async (req, res) => {
    try {
      const { invoiceId, provider } = req.body;
  
      // Validate invoice ID
      if (!invoiceId) {
        return res.status(400).json({
          error: 'Invoice ID is required'
        });
      }
  
      // Validate payment provider
      if (!['BKASH', 'NAGAD'].includes(provider)) {
        return res.status(400).json({
          error: 'Invalid payment provider'
        });
      }
  
      // Find invoice belonging to this student
      const invoice = await db.feeInvoice.findFirst({
        where: {
          id: invoiceId,
          studentId: req.user.id
        }
      });
  
      if (!invoice) {
        return res.status(404).json({
          error: 'Invoice not found'
        });
      }
  
      // Prevent paying an already-paid invoice
      if (invoice.status === 'PAID') {
        return res.status(400).json({
          error: 'This invoice is already paid'
        });
      }
  
      // Generate unique payment reference
      const reference = randomUUID();
  
      // Create pending payment attempt
      const payment = await db.paymentAttempt.create({
        data: {
          reference,
          invoiceId: invoice.id,
          provider,
          amount: invoice.amount,
          currency: invoice.currency,
          status: 'PENDING'
        }
      });
  
      return res.status(202).json({
        success: true,
        paymentId: payment.id,
        reference: payment.reference,
        amount: payment.amount.toString(),
        currency: payment.currency,
        provider: payment.provider,
        status: 'PENDING',
        message: 'Payment attempt created. Gateway integration is not configured yet.'
      });
  
    } catch (error) {
      console.error('Payment initiation error:', error);
  
      return res.status(500).json({
        error: 'Unable to initiate payment'
      });
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

  const semesterGroups = new Map();
  for (const record of records) {
    const key = `${record.semester ?? ''}|${record.academicYear ?? ''}`;
    const group = semesterGroups.get(key) ?? {
      semester: record.semester,
      academicYear: record.academicYear,
      records: [],
    };
    group.records.push(record);
    semesterGroups.set(key, group);
  }

  const semesterSummaries = [...semesterGroups.values()].map((group) => {
    const providedGpa = uniqueProvidedValue(group.records, 'gpa');
    const providedCgpa = uniqueProvidedValue(group.records, 'cgpa');
    return {
      semester: group.semester,
      academicYear: group.academicYear,
      gpa: providedGpa ?? (group.records.some((record) => record.gpa !== null) ? null : calculateGpa(group.records)),
      cgpa: providedCgpa,
    };
  });
  const providedGpa = uniqueProvidedValue(records, 'gpa');
  const providedCgpa = uniqueProvidedValue(records, 'cgpa');
  const summaryGpa = providedGpa ?? (
    records.some((record) => record.gpa !== null) || semesterGroups.size > 1
      ? null
      : calculateGpa(records)
  );
  const summaryCgpa = providedCgpa ?? (
    records.some((record) => record.cgpa !== null) ? null : calculateGpa(records)
  );
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
      gpa: summaryGpa,
      cgpa: summaryCgpa,
      gpaSource: summaryGpa === null ? null : providedGpa !== null ? 'university' : 'calculated',
      cgpaSource: summaryCgpa === null ? null : providedCgpa !== null ? 'university' : 'calculated',
      totalQualityPoints: resultSummary.totalQualityPoints,
      totalAttemptedCredits: resultSummary.attemptedCredits,
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
