import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://hxufmtkugypwsjvuaxhu.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh4dWZtdGt1Z3lwd3NqdnVheGh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzYwNjI4NCwiZXhwIjoyMDk5MTgyMjg0fQ.wkvSfdyP83abmxBgaTCnojJRz1g7Yi5pv2T4-8jZy5w';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log('Step 1: Fetching all staff members...');
  const { data: staffList, error: staffErr } = await supabase
    .from('staff')
    .select('staff_id, full_name, email, profile_id')
    .not('email', 'is', null);

  if (staffErr) {
    console.error('Failed to fetch staff:', staffErr.message);
    process.exit(1);
  }
  console.log(`  Found ${staffList.length} staff members with emails`);

  const hasProfileIdCol = 'profile_id' in (staffList[0] || {});

  console.log('\nStep 2: Fetching all profiles...');
  const { data: allProfiles, error: profilesErr } = await supabase
    .from('profiles')
    .select('id, name, role');
  if (profilesErr) {
    console.error('Failed to fetch profiles:', profilesErr.message);
    process.exit(1);
  }
  console.log(`  Found ${allProfiles.length} existing profiles`);

  const profileByEmail = new Map();
  for (const p of allProfiles) {
    profileByEmail.set(p.name.toLowerCase(), p);
  }

  console.log('\nStep 3: Fetching auth users...');
  const { data: authData, error: authErr } = await supabase.auth.admin.listUsers();
  if (authErr) {
    console.error('Failed to list auth users:', authErr.message);
    process.exit(1);
  }

  const emailToAuth = new Map();
  for (const u of authData.users) {
    if (u.email) emailToAuth.set(u.email.toLowerCase(), u);
  }
  console.log(`  Found ${authData.users.length} auth users`);

  let created = 0;
  let linked = 0;

  for (const staff of staffList) {
    if (!staff.email) continue;
    const emailLower = staff.email.toLowerCase();

    // Check if profile exists by name match (profiles.name = staff.full_name)
    const existingProfile = profileByEmail.get(staff.full_name.toLowerCase());

    if (existingProfile) {
      // Update role to staff if needed
      if (existingProfile.role !== 'staff') {
        console.log(`  → ${staff.email}: updating role '${existingProfile.role}' → 'staff'`);
        await supabase.from('profiles').update({ role: 'staff' }).eq('id', existingProfile.id);
      } else {
        console.log(`  ✓ ${staff.email}: profile exists (${existingProfile.id.slice(0,8)}…)`);
      }

      // Link staff record
      if (hasProfileIdCol && !staff.profile_id) {
        await supabase.from('staff').update({ profile_id: existingProfile.id, updated_at: new Date().toISOString() }).eq('staff_id', staff.staff_id);
        console.log(`  → ${staff.email}: linked staff → profile`);
        linked++;
      }
      continue;
    }

    // No profile found by name — try by email match to auth user
    const authUser = emailToAuth.get(emailLower);
    if (!authUser) {
      console.log(`  ✗ ${staff.email}: no auth user found`);
      continue;
    }

    // Check if profile exists by auth user ID
    const { data: profileById } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('id', authUser.id)
      .maybeSingle();

    if (profileById) {
      if (profileById.role !== 'staff') {
        await supabase.from('profiles').update({ role: 'staff' }).eq('id', authUser.id);
        console.log(`  → ${staff.email}: updated role to 'staff'`);
      } else {
        console.log(`  ✓ ${staff.email}: profile exists by auth id`);
      }

      if (hasProfileIdCol && !staff.profile_id) {
        await supabase.from('staff').update({ profile_id: authUser.id, updated_at: new Date().toISOString() }).eq('staff_id', staff.staff_id);
        linked++;
      }
      continue;
    }

    // Create profile
    try {
      const { error: insertErr } = await supabase.from('profiles').insert({
        id: authUser.id,
        name: staff.full_name,
        role: 'staff',
      });

      if (insertErr) {
        console.error(`  ✗ ${staff.email}: insert failed — ${insertErr.message}`);
        continue;
      }

      if (hasProfileIdCol) {
        await supabase.from('staff').update({ profile_id: authUser.id, updated_at: new Date().toISOString() }).eq('staff_id', staff.staff_id);
      }

      console.log(`  ✓ ${staff.email}: profile CREATED`);
      created++;
    } catch (err) {
      console.error(`  ✗ ${staff.email}: error — ${err.message}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Profiles created: ${created}`);
  console.log(`Staff records linked: ${linked}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
