import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../backend/src/app.js';
import { LocalRepository } from '../../backend/src/repositories/localRepository.js';
import { createSeedData } from '../../backend/src/config/seedData.js';

const config = {
  frontendUrl: 'http://localhost:5173',
  jwtSecret: 'test-secret',
  localAdminEmail: 'chad@efar.local',
  localAdminPassword: 'chad1234',
  supabaseConfigured: false,
};

let app;
let token;

beforeEach(async () => {
  const repository = new LocalRepository({
    initialData: createSeedData(config.localAdminEmail, config.localAdminPassword),
    email: config.localAdminEmail,
    password: config.localAdminPassword,
  });
  await repository.init();
  app = createApp({ repository, config });

  const login = await request(app).post('/api/auth/login').send({
    email: config.localAdminEmail,
    password: config.localAdminPassword,
  });
  token = login.body.token;
});

describe('scheduling API', () => {
  it('blocks protected routes without a session', async () => {
    const response = await request(app).get('/api/staff');
    expect(response.status).toBe(401);
  });

  it('returns part-time staff for an authenticated admin', async () => {
    const response = await request(app)
      .get('/api/staff')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(3);
  });

  it('creates and reads availability through the API', async () => {
    const created = await request(app)
      .post('/api/availability')
      .set('Authorization', `Bearer ${token}`)
      .send({
        staff_id: 'staff-pt-001',
        available_date: '2031-03-10',
        period: 'FULL_DAY',
        start_time: '06:00',
        end_time: '22:00',
        note: '',
        coverage_gap: false,
      });

    expect(created.status).toBe(201);

    const list = await request(app)
      .get('/api/availability?month=2031-03')
      .set('Authorization', `Bearer ${token}`);

    expect(list.body.data.some((item) => item.id === created.body.data.id)).toBe(true);
  });

  it('exports exceptions as CSV', async () => {
    const response = await request(app)
      .get('/api/exceptions/export.csv?status=all')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('Severity');
    expect(response.text).toContain('HALF_DAY_GAP');
  });
});
