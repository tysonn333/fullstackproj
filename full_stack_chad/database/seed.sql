insert into public.staff_members (staff_code, name, phone, employment_type, role)
values
  ('PT001', 'Alicia Lim', '6591234567', 'part_time', 'Medic'),
  ('PT002', 'Marcus Tan', '6582345678', 'part_time', 'Driver'),
  ('PT003', 'Nur Aisyah', '6598761234', 'part_time', 'EMT')
on conflict (staff_code) do nothing;
