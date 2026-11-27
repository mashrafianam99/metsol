// Creates (or repairs) a portal administrator that can sign in immediately, without email confirmation.
// Usage: npm run create-admin -- <email> <password> ["Display Name"]
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL in backend/.env.
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const [emailArg, password, nameArg] = process.argv.slice(2);
const email = String(emailArg || '').trim().toLowerCase();
const name = String(nameArg || 'System Administrator').trim();

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || !password || password.length < 8) {
  console.error('Usage: npm run create-admin -- <email> <password (8+ characters)> ["Display Name"]');
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env.');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const db = new PrismaClient();

async function findAuthUserByEmail(target) {
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === target);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  let authUser = await findAuthUserByEmail(email);
  if (authUser) {
    // Existing sign-in: reset the password and mark the email confirmed.
    const { data, error } = await supabase.auth.admin.updateUserById(authUser.id, {
      password, email_confirm: true, user_metadata: { ...authUser.user_metadata, name },
    });
    if (error) throw error;
    authUser = data.user;
    console.log(`Updated existing Supabase sign-in for ${email}.`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name },
    });
    if (error) throw error;
    authUser = data.user;
    console.log(`Created Supabase sign-in for ${email} (email already confirmed).`);
  }

  const existing = await db.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  const portalUser = existing
    ? await db.user.update({ where: { id: existing.id }, data: { authId: authUser.id, role: 'ADMIN', isActive: true, name } })
    : await db.user.create({ data: { email, name, authId: authUser.id, role: 'ADMIN', isActive: true } });
  console.log(`Portal user ${portalUser.email} is ADMIN (id ${portalUser.id}).`);
}

main()
  .catch((error) => {
    console.error('Could not create the administrator:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
