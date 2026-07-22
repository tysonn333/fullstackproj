import { useCallback, useEffect, useMemo, useState } from 'react';
import { Edit3, MessageCircle, Plus, Trash2, X } from 'lucide-react';
import { api } from '../api/client.js';
import Message from '../components/Message.jsx';

const emptyForm = {
  staff_id: '',
  available_date: new Date().toISOString().slice(0, 10),
  period: 'FULL_DAY',
  start_time: '06:00',
  end_time: '22:00',
  note: '',
  coverage_gap: false,
};

const periodTimes = {
  AM: ['06:00', '12:00'],
  PM: ['12:00', '22:00'],
  FULL_DAY: ['06:00', '22:00'],
};

function daysForMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const count = new Date(year, monthNumber, 0).getDate();
  const firstDay = new Date(year, monthNumber - 1, 1).getDay();
  return {
    firstDay,
    days: Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`),
  };
}

export default function AvailabilityPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [staff, setStaff] = useState([]);
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const calendar = useMemo(() => daysForMonth(month), [month]);
  const byDate = useMemo(() => records.reduce((result, record) => {
    result[record.available_date] = [...(result[record.available_date] || []), record];
    return result;
  }, {}), [records]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [staffResult, availabilityResult] = await Promise.all([
        api('/staff'),
        api(`/availability?month=${month}`),
      ]);
      setStaff(staffResult.data);
      setRecords(availabilityResult.data);
      setForm((current) => ({ ...current, staff_id: current.staff_id || staffResult.data[0]?.id || '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = (date = `${month}-01`) => {
    setEditingId(null);
    setForm({ ...emptyForm, staff_id: staff[0]?.id || '', available_date: date });
    setFormOpen(true);
    setNotice('');
  };

  const openEdit = (record) => {
    setEditingId(record.id);
    setForm({
      staff_id: record.staff_id,
      available_date: record.available_date,
      period: record.period,
      start_time: record.start_time,
      end_time: record.end_time,
      note: record.note || '',
      coverage_gap: Boolean(record.coverage_gap),
    });
    setFormOpen(true);
    setNotice('');
  };

  const updateField = (name, value) => {
    setForm((current) => {
      const next = { ...current, [name]: value };
      if (name === 'period' && periodTimes[value]) {
        [next.start_time, next.end_time] = periodTimes[value];
      }
      return next;
    });
  };

  const save = async (event) => {
    event.preventDefault();
    setError('');
    try {
      await api(editingId ? `/availability/${editingId}` : '/availability', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(form),
      });
      setFormOpen(false);
      setNotice(editingId ? 'Availability updated' : 'Availability added');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (record) => {
    if (!window.confirm(`Remove availability for ${record.staff?.name} on ${record.available_date}?`)) return;
    setError('');
    try {
      await api(`/availability/${record.id}`, { method: 'DELETE' });
      setNotice('Availability removed');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const contact = async (record) => {
    setError('');
    try {
      const result = await api(`/availability/${record.id}/whatsapp`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      window.open(result.data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">UC-003</p>
          <h1>Part-timer availability</h1>
          <p>Record the dates and time periods that part-time staff can cover.</p>
        </div>
        <button className="primary-button inline" onClick={() => openCreate()}>
          <Plus size={17} /> Add availability
        </button>
      </header>

      <Message>{error}</Message>
      <Message type="success">{notice}</Message>

      <div className="toolbar">
        <label>
          Month
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <span>{records.length} record{records.length === 1 ? '' : 's'}</span>
      </div>

      {loading ? <div className="panel">Loading availability...</div> : (
        <div className="calendar panel">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div className="calendar-heading" key={day}>{day}</div>
          ))}
          {Array.from({ length: calendar.firstDay }, (_, index) => (
            <div className="calendar-cell muted" key={`blank-${index}`} />
          ))}
          {calendar.days.map((date) => (
            <div className="calendar-cell" key={date} onDoubleClick={() => openCreate(date)}>
              <div className="calendar-date">{Number(date.slice(-2))}</div>
              <div className="day-records">
                {(byDate[date] || []).map((record) => (
                  <article className={`availability-chip ${record.period.toLowerCase()}`} key={record.id}>
                    <strong>{record.staff?.name}</strong>
                    <span>{record.start_time} - {record.end_time}</span>
                    <div className="chip-actions">
                      <button onClick={() => contact(record)} title="Open WhatsApp"><MessageCircle size={14} /></button>
                      <button onClick={() => openEdit(record)} title="Edit"><Edit3 size={14} /></button>
                      <button onClick={() => remove(record)} title="Remove"><Trash2 size={14} /></button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <div className="modal-backdrop" onMouseDown={() => setFormOpen(false)}>
          <form className="modal" onSubmit={save} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? 'Edit availability' : 'Add availability'}</h2>
              <button type="button" className="icon-button" onClick={() => setFormOpen(false)}><X size={19} /></button>
            </div>
            <label>
              Part-timer
              <select value={form.staff_id} onChange={(event) => updateField('staff_id', event.target.value)} required>
                {staff.map((member) => <option value={member.id} key={member.id}>{member.name} - {member.role}</option>)}
              </select>
            </label>
            <label>
              Date
              <input type="date" value={form.available_date} onChange={(event) => updateField('available_date', event.target.value)} required />
            </label>
            <label>
              Period
              <select value={form.period} onChange={(event) => updateField('period', event.target.value)}>
                <option value="FULL_DAY">Full day</option>
                <option value="AM">AM</option>
                <option value="PM">PM</option>
                <option value="CUSTOM">Custom</option>
              </select>
            </label>
            <div className="field-row">
              <label>
                Start
                <input type="time" value={form.start_time} onChange={(event) => updateField('start_time', event.target.value)} required />
              </label>
              <label>
                End
                <input type="time" value={form.end_time} onChange={(event) => updateField('end_time', event.target.value)} required />
              </label>
            </div>
            <label>
              Note
              <textarea value={form.note} onChange={(event) => updateField('note', event.target.value)} rows="3" maxLength="300" />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.coverage_gap} onChange={(event) => updateField('coverage_gap', event.target.checked)} />
              Create a coverage gap for the uncovered period
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setFormOpen(false)}>Cancel</button>
              <button className="primary-button">Save</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
