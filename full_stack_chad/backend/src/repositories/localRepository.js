import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSeedData } from '../config/seedData.js';
import { nowIso } from '../utils/date.js';

export class LocalRepository {
  constructor({ filePath, email, password, initialData = null }) {
    this.filePath = filePath;
    this.email = email;
    this.password = password;
    this.initialData = initialData;
    this.data = null;
  }

  async init() {
    if (this.initialData) {
      this.data = structuredClone(this.initialData);
      return;
    }

    try {
      this.data = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch {
      this.data = createSeedData(this.email, this.password);
      await this.save();
    }
  }

  async save() {
    if (this.initialData) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2));
  }

  async findUserByEmail(email) {
    return this.data.users.find((user) => user.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async listStaff() {
    return this.data.staff.filter((member) => member.active && member.employment_type === 'part_time');
  }

  async getStaff(id) {
    return this.data.staff.find((member) => member.id === id) ?? null;
  }

  async listAvailability({ start, end, staffId }) {
    return this.data.availability
      .filter((item) => !item.deleted_at)
      .filter((item) => item.available_date >= start && item.available_date <= end)
      .filter((item) => !staffId || item.staff_id === staffId)
      .map((item) => ({ ...item, staff: this.data.staff.find((staff) => staff.id === item.staff_id) ?? null }))
      .sort((a, b) => a.available_date.localeCompare(b.available_date));
  }

  async getAvailability(id) {
    const item = this.data.availability.find((entry) => entry.id === id && !entry.deleted_at);
    if (!item) return null;
    return { ...item, staff: await this.getStaff(item.staff_id) };
  }

  async createAvailability(input) {
    const item = {
      id: randomUUID(),
      ...input,
      deleted_at: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.data.availability.push(item);
    await this.save();
    return this.getAvailability(item.id);
  }

  async updateAvailability(id, changes) {
    const index = this.data.availability.findIndex((item) => item.id === id && !item.deleted_at);
    if (index < 0) return null;
    this.data.availability[index] = {
      ...this.data.availability[index],
      ...changes,
      updated_at: nowIso(),
    };
    await this.save();
    return this.getAvailability(id);
  }

  async deleteAvailability(id) {
    const index = this.data.availability.findIndex((item) => item.id === id && !item.deleted_at);
    if (index < 0) return false;
    this.data.availability[index].deleted_at = nowIso();
    this.data.availability[index].updated_at = nowIso();
    await this.save();
    return true;
  }

  async findAvailabilityOverlap({ staffId, availableDate, startTime, endTime, excludeId }) {
    return this.data.availability.find((item) =>
      !item.deleted_at
      && item.staff_id === staffId
      && item.available_date === availableDate
      && item.id !== excludeId
      && startTime < item.end_time
      && endTime > item.start_time,
    ) ?? null;
  }

  async listExceptions(filters = {}) {
    return this.data.exceptions
      .filter((item) => !filters.status || filters.status === 'all' || item.status === filters.status)
      .filter((item) => !filters.severity || filters.severity === 'all' || item.severity === filters.severity)
      .filter((item) => !filters.type || filters.type === 'all' || item.type === filters.type)
      .filter((item) => !filters.from || item.shift_date >= filters.from)
      .filter((item) => !filters.to || item.shift_date <= filters.to)
      .map((item) => ({ ...item, staff: item.staff_id ? this.data.staff.find((staff) => staff.id === item.staff_id) ?? null : null }))
      .sort((a, b) => {
        const priorities = { critical: 0, warning: 1, informational: 2 };
        return priorities[a.severity] - priorities[b.severity]
          || `${a.shift_date}T${a.shift_start}`.localeCompare(`${b.shift_date}T${b.shift_start}`);
      });
  }

  async getException(id) {
    const item = this.data.exceptions.find((entry) => entry.id === id);
    if (!item) return null;
    return { ...item, staff: item.staff_id ? await this.getStaff(item.staff_id) : null };
  }

  async createException(input) {
    const item = {
      id: randomUUID(),
      ...input,
      status: input.status ?? 'active',
      resolution_note: null,
      deferred_until: null,
      resolved_by: null,
      resolved_at: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.data.exceptions.push(item);
    await this.save();
    return this.getException(item.id);
  }

  async updateException(id, changes) {
    const index = this.data.exceptions.findIndex((item) => item.id === id);
    if (index < 0) return null;
    this.data.exceptions[index] = {
      ...this.data.exceptions[index],
      ...changes,
      updated_at: nowIso(),
    };
    await this.save();
    return this.getException(id);
  }

  async createAudit(input) {
    const item = { id: randomUUID(), ...input, created_at: nowIso() };
    this.data.audit.push(item);
    await this.save();
    return item;
  }

  async listAudit(exceptionId) {
    return this.data.audit
      .filter((item) => item.exception_id === exceptionId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}
