import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import { fetchStudentCoursework } from './classroomCoursework.js';

const db = new PrismaClient();

// Read-only student scopes: the portal lists coursework, and students submit inside Google Classroom itself.
export const GOOGLE_CLASSROOM_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.topics.readonly',
];

function getEncryptionKey() {
  const key = process.env.GOOGLE_OAUTH_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error('GOOGLE_OAUTH_ENCRYPTION_KEY must be set to a secure 32+ character secret.');
  }
  const normalized = Buffer.alloc(32, key.slice(0, 32), 'utf8');
  return normalized;
}

export function encryptSecret(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const payload = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${payload.toString('hex')}:${tag.toString('hex')}`;
}

export function decryptSecret(value) {
  if (!value) {
    return '';
  }
  const [ivHex, payloadHex, tagHex] = String(value).split(':');
  if (!ivHex || !payloadHex || !tagHex) {
    throw new Error('Google token payload is invalid or corrupted.');
  }
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(payloadHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth configuration is incomplete. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in backend/.env.');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// loginHint is the portal email, so Google preselects the matching account when the student has several.
export function getGoogleClassroomAuthUrl(loginHint, state) {
  const oauth2Client = getGoogleOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: true,
    state,
    scope: GOOGLE_CLASSROOM_SCOPES,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
}

// Raised when the stored Google grant no longer works and the student must connect again.
export class GoogleReconnectRequiredError extends Error {
  constructor(message = 'Your Google Classroom access has expired or was revoked. Connect Google Classroom again.') {
    super(message);
    this.name = 'GoogleReconnectRequiredError';
  }
}

export async function getAuthorizedGoogleClassroomClient(userId) {
  const connection = await db.googleAccountConnection.findUnique({
    where: { userId },
  });

  if (!connection) {
    return null;
  }

  const oauth2Client = getGoogleOAuthClient();
  oauth2Client.setCredentials({
    access_token: decryptSecret(connection.accessTokenEncrypted),
    refresh_token: connection.refreshTokenEncrypted ? decryptSecret(connection.refreshTokenEncrypted) : undefined,
    expiry_date: connection.expiryDate ? connection.expiryDate.getTime() : undefined,
    token_type: connection.tokenType || 'Bearer',
    scope: connection.scope || GOOGLE_CLASSROOM_SCOPES.join(' '),
  });

  // Persist access tokens that the client refreshes, so each request does not refresh again.
  oauth2Client.on('tokens', (tokens) => {
    if (!tokens.access_token) return;
    db.googleAccountConnection.update({
      where: { userId },
      data: {
        accessTokenEncrypted: encryptSecret(tokens.access_token),
        ...(tokens.refresh_token ? { refreshTokenEncrypted: encryptSecret(tokens.refresh_token) } : {}),
        expiryDate: tokens.expiry_date ? new Date(Number(tokens.expiry_date)) : null,
      },
    }).catch((error) => console.error('Unable to save refreshed Google token:', error?.message || error));
  });

  return { oauth2Client, connection };
}

// Revoked/expired grants and missing scopes are fixed by connecting again; other errors (e.g. API disabled) are not.
function isReconnectError(error) {
  const status = error?.response?.status ?? error?.code;
  const reason = error?.response?.data?.error;
  const message = String(error?.message || '');
  return reason === 'invalid_grant'
    || status === 401
    || (status === 403 && /scope|insufficient/iu.test(message));
}

// Live, read-only list of the signed-in student's own Classroom coursework. Returns null when not connected.
export async function getStudentCourseworkForUser(userId) {
  const authorized = await getAuthorizedGoogleClassroomClient(userId);
  if (!authorized) {
    return null;
  }

  const classroom = google.classroom({ version: 'v1', auth: authorized.oauth2Client });
  try {
    return await fetchStudentCoursework(classroom);
  } catch (error) {
    if (isReconnectError(error)) {
      throw new GoogleReconnectRequiredError();
    }
    throw error;
  }
}

export async function disconnectGoogleAccountForUser(userId) {
  const existing = await db.googleAccountConnection.findUnique({ where: { userId } });
  if (!existing) {
    return false;
  }

  await db.googleAccountConnection.delete({ where: { userId } });
  return true;
}

export async function getConnectionStatusForUser(userId) {
  const connection = await db.googleAccountConnection.findUnique({
    where: { userId },
    select: {
      googleUserId: true,
      email: true,
      scope: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return connection ? {
    connected: true,
    googleUserId: connection.googleUserId,
    email: connection.email,
    scope: connection.scope ? connection.scope.split(' ') : [],
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  } : { connected: false };
}
