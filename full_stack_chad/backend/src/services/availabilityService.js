import { z } from 'zod';

const availabilitySchema = z.object({
  staff_id: z.string().min(1),
  available_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period: z.enum(['AM', 'PM', 'FULL_DAY', 'CUSTOM']),
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  note: z.string().max(300).default(''),
  coverage_gap: z.boolean().default(false),
});

export class AvailabilityService {
  constructor(repository) {
    this.repository = repository;
  }

  async list(filters) {
    return this.repository.listAvailability(filters);
  }

  async create(input) {
    const data = this.validate(input);
    await this.checkStaff(data.staff_id);
    await this.checkOverlap(data);
    const item = await this.repository.createAvailability(data);
    await this.createGapIfNeeded(item);
    return item;
  }

  async update(id, input) {
    const current = await this.repository.getAvailability(id);
    if (!current) return null;

    const data = this.validate({ ...current, ...input });
    await this.checkStaff(data.staff_id);
    await this.checkOverlap({ ...data, excludeId: id });
    const item = await this.repository.updateAvailability(id, data);
    await this.createGapIfNeeded(item);
    return item;
  }

  async remove(id) {
    return this.repository.deleteAvailability(id);
  }

  async whatsappLink(id, customMessage) {
    const item = await this.repository.getAvailability(id);
    if (!item) return null;

    const phone = item.staff?.phone?.replace(/\D/g, '');
    if (!phone) {
      const error = new Error('The selected staff member has no contact number');
      error.status = 422;
      throw error;
    }

    const message = customMessage?.trim()
      || `Hi ${item.staff.name}, are you still available on ${item.available_date} from ${item.start_time} to ${item.end_time}?`;

    return {
      staff: item.staff,
      message,
      url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
    };
  }

  validate(input) {
    const data = availabilitySchema.parse(input);
    if (data.start_time >= data.end_time) {
      const error = new Error('End time must be later than start time');
      error.status = 422;
      throw error;
    }
    return data;
  }

  async checkStaff(staffId) {
    const staff = await this.repository.getStaff(staffId);
    if (!staff || !staff.active || staff.employment_type !== 'part_time') {
      const error = new Error('Part-timer record was not found');
      error.status = 404;
      throw error;
    }
  }

  async checkOverlap(data) {
    const overlap = await this.repository.findAvailabilityOverlap({
      staffId: data.staff_id,
      availableDate: data.available_date,
      startTime: data.start_time,
      endTime: data.end_time,
      excludeId: data.excludeId,
    });
    if (overlap) {
      const error = new Error('This availability overlaps an existing record');
      error.status = 409;
      throw error;
    }
  }

  async createGapIfNeeded(item) {
    if (!item?.coverage_gap || item.period === 'FULL_DAY') return;

    const missingStart = item.period === 'PM' ? '06:00' : item.end_time;
    const missingEnd = item.period === 'PM' ? item.start_time : '22:00';
    const existing = await this.repository.listExceptions({ status: 'all', type: 'HALF_DAY_GAP' });
    const duplicate = existing.some((entry) =>
      entry.shift_date === item.available_date
      && entry.staff_id === item.staff_id
      && entry.shift_start === missingStart
      && entry.shift_end === missingEnd,
    );

    if (!duplicate) {
      await this.repository.createException({
        type: 'HALF_DAY_GAP',
        severity: 'warning',
        shift_date: item.available_date,
        shift_start: missingStart,
        shift_end: missingEnd,
        staff_id: item.staff_id,
        summary: `${item.staff.name} only covers part of the day`,
        recommendation: 'Contact another available part-timer for the uncovered period',
      });
    }
  }
}
