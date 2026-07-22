import 'dotenv/config';

const value = (name, fallback = '') => process.env[name] ?? fallback;

export const config = {
  port: Number(value('PORT', '4000')),
  frontendUrl: value('FRONTEND_URL', 'http://localhost:5173'),
  jwtSecret: value('JWT_SECRET', 'local-development-secret'),
  localAdminEmail: value('LOCAL_ADMIN_EMAIL', 'chad@efar.local'),
  localAdminPassword: value('LOCAL_ADMIN_PASSWORD', 'chad1234'),
  supabaseUrl: value('SUPABASE_URL'),
  supabaseAnonKey: value('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: value('SUPABASE_SERVICE_ROLE_KEY'),
};

config.supabaseConfigured = Boolean(
  config.supabaseUrl && config.supabaseAnonKey && config.supabaseServiceRoleKey,
);
