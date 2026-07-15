import './lib/env';
import supabaseAdmin from './lib/supabase';

async function createAuthAccount(staff: { staff_id: number; full_name: string; email: string }) {
  const firstName = staff.full_name.split(' ')[0];
  const password = `${firstName}123`;

  const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email: staff.email,
    password,
    email_confirm: true,
    user_metadata: { staff_id: staff.staff_id },
  });

  if (authErr || !authUser.user) {
    console.error(`  ✗ ${staff.email}: ${authErr?.message}`);
    return null;
  }

  const profileId = authUser.user.id;

  const { error: profileErr } = await supabaseAdmin.from('profiles').insert({
    id: profileId,
    name: staff.full_name,
    role: 'staff',
  });

  if (profileErr) {
    console.error(`  ✗ ${staff.email}: profile error — ${profileErr.message}`);
    await supabaseAdmin.auth.admin.deleteUser(profileId);
    return null;
  }

  // Try to link staff record to profile (may fail if profile_id column doesn't exist)
  const { error: linkErr } = await supabaseAdmin
    .from('staff')
    .update({ profile_id: profileId, updated_at: new Date().toISOString() })
    .eq('staff_id', staff.staff_id);

  if (linkErr) {
    // Non-fatal — auth route falls back to email lookup
    console.log(`  ⚠ Could not link staff record (profile_id column may not exist, auth will use email fallback)`);
  }

  return { email: staff.email, password, profileId };
}

async function main() {
  console.log('Fetching staff without auth accounts...\n');

  let staffToProcess: { staff_id: number; full_name: string; email: string }[] = [];

  const { data: staffList, error } = await supabaseAdmin
    .from('staff')
    .select('staff_id, full_name, email, profile_id')
    .not('email', 'is', null);

  if (error) {
    // Try without profile_id column if it doesn't exist
    if (error.message.includes('column') && error.message.includes('does not exist')) {
      console.log('  profile_id column not found — proceeding without it (email fallback will be used)\n');
      const { data: fallbackList, error: fallbackErr } = await supabaseAdmin
        .from('staff')
        .select('staff_id, full_name, email')
        .not('email', 'is', null);

      if (fallbackErr) {
        console.error('Failed to fetch staff:', fallbackErr.message);
        process.exit(1);
      }

      // Filter out staff who already have profiles (matched by email)
      const { data: existingProfiles } = await supabaseAdmin
        .from('profiles')
        .select('name');

      const existingEmails = new Set(
        (existingProfiles ?? []).map((p) => p.name.toLowerCase())
      );

      for (const s of fallbackList ?? []) {
        if (existingEmails.has(s.full_name.toLowerCase())) {
          console.log(`  → ${s.email}: already has a profile`);
        } else {
          staffToProcess.push(s);
        }
      }
    } else {
      console.error('Failed to fetch staff:', error.message);
      process.exit(1);
    }
  } else {
    // Filter to only staff without profile_id
    for (const s of staffList ?? []) {
      if (!s.profile_id) {
        staffToProcess.push(s);
      }
    }
  }

  if (staffToProcess.length === 0) {
    console.log('All staff members already have auth accounts. Nothing to do.');
    process.exit(0);
  }

  console.log(`Found ${staffToProcess.length} staff member(s) without accounts:\n`);

  const results: { email: string; password: string }[] = [];

  for (const staff of staffToProcess) {
    if (!staff.email) continue;
    console.log(`Creating account for ${staff.full_name} (${staff.email})...`);
    const result = await createAuthAccount(staff);
    if (result) {
      results.push(result);
      console.log(`  ✓ Password: ${result.password}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Created: ${results.length}/${staffToProcess.length}`);
  console.log(`\nLogin credentials:`);
  for (const r of results) {
    console.log(`  ${r.email} / ${r.password}`);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
