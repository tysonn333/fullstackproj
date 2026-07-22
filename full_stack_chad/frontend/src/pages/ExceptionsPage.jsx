import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Download, History, X } from 'lucide-react';
import { api, exportUrl } from '../api/client.js';
import Message from '../components/Message.jsx';

const actionNames = {
  resolve: 'Resolve',
  defer: 'Defer',
  dismiss: 'Dismiss',
  reject: 'Reject case',
  reopen: 'Reopen',
};

export default function ExceptionsPage() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState([]);
  const [filters, setFilters] = useState({ status: 'active', severity: 'all', type: 'all' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [audit, setAudit] = useState(null);

  const types = useMemo(() => [...new Set(items.map((item) => item.type))], [items]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams(filters).toString();
      const result = await api(`/exceptions?${query}`);
      setItems(result.data);
      setSelected([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSelected = (id) => {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };

  const openAction = (action, ids) => {
    setDialog({ action, ids, note: '', deferred_until: '' });
    setNotice('');
  };

  const submitAction = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const body = {
        action: dialog.action,
        note: dialog.note,
        ...(dialog.action === 'defer' ? { deferred_until: dialog.deferred_until } : {}),
      };
      if (dialog.ids.length > 1) {
        await api('/exceptions/bulk-action', {
          method: 'POST',
          body: JSON.stringify({ ...body, ids: dialog.ids }),
        });
      } else {
        await api(`/exceptions/${dialog.ids[0]}/action`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      }
      setDialog(null);
      setNotice(`${actionNames[body.action]} completed`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const showAudit = async (item) => {
    setError('');
    try {
      const result = await api(`/exceptions/${item.id}/audit`);
      setAudit({ item, entries: result.data });
    } catch (err) {
      setError(err.message);
    }
  };

  const notify = async (item) => {
    setError('');
    try {
      const result = await api(`/exceptions/${item.id}/notify`, { method: 'POST', body: '{}' });
      if (!('Notification' in window)) {
        setNotice(result.data.body);
        return;
      }
      let permission = Notification.permission;
      if (permission === 'default') permission = await Notification.requestPermission();
      if (permission === 'granted') {
        new Notification(result.data.title, { body: result.data.body, tag: result.data.tag });
        setNotice('Browser notification sent');
      } else {
        setNotice(result.data.body);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const downloadCsv = async () => {
    setError('');
    try {
      const token = localStorage.getItem('efar_token');
      const query = new URLSearchParams(filters).toString();
      const response = await fetch(exportUrl(`/exceptions/export.csv?${query}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('CSV export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'scheduling-exceptions.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">UC-008</p>
          <h1>Scheduling exceptions</h1>
          <p>Review flags that need an operations decision.</p>
        </div>
        <button className="secondary-button inline" onClick={downloadCsv}><Download size={17} /> Export CSV</button>
      </header>

      <Message>{error}</Message>
      <Message type="success">{notice}</Message>

      <div className="toolbar exception-toolbar">
        <label>
          Status
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="active">Active</option>
            <option value="deferred">Deferred</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>
          Severity
          <select value={filters.severity} onChange={(event) => setFilters({ ...filters, severity: event.target.value })}>
            <option value="all">All</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="informational">Informational</option>
          </select>
        </label>
        <label>
          Type
          <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
            <option value="all">All</option>
            {types.map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}
          </select>
        </label>
        <span>{items.length} result{items.length === 1 ? '' : 's'}</span>
      </div>

      {selected.length > 0 && (
        <div className="bulk-bar">
          <strong>{selected.length} selected</strong>
          <button onClick={() => openAction('resolve', selected)}>Resolve</button>
          <button onClick={() => openAction('defer', selected)}>Defer</button>
          <button onClick={() => openAction('dismiss', selected)}>Dismiss</button>
          <button onClick={() => setSelected([])}>Clear</button>
        </div>
      )}

      <div className="exception-list">
        {loading && <div className="panel">Loading exceptions...</div>}
        {!loading && items.length === 0 && <div className="panel empty-state">No matching exceptions.</div>}
        {items.map((item) => (
          <article className={`exception-card ${item.severity}`} key={item.id}>
            <div className="exception-select">
              <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggleSelected(item.id)} />
            </div>
            <div className="exception-main">
              <div className="exception-topline">
                <span className={`severity-badge ${item.severity}`}>{item.severity}</span>
                <span className="status-badge">{item.status}</span>
                <span>{item.type.replaceAll('_', ' ')}</span>
              </div>
              <h2>{item.summary}</h2>
              <p>{item.recommendation}</p>
              <div className="exception-meta">
                <span>{item.shift_date}</span>
                <span>{item.shift_start} - {item.shift_end}</span>
                {item.staff && <span>{item.staff.name}</span>}
              </div>
            </div>
            <div className="exception-actions">
              {['active', 'deferred'].includes(item.status) ? (
                <>
                  <button onClick={() => openAction('resolve', [item.id])}>Resolve</button>
                  <button onClick={() => openAction('defer', [item.id])}>Defer</button>
                  <button onClick={() => openAction('dismiss', [item.id])}>Dismiss</button>
                  {item.severity === 'critical' && <button onClick={() => openAction('reject', [item.id])}>Reject</button>}
                </>
              ) : <button onClick={() => openAction('reopen', [item.id])}>Reopen</button>}
              <button className="icon-text-button" onClick={() => showAudit(item)}><History size={16} /> Audit</button>
              <button className="icon-text-button" onClick={() => notify(item)}><Bell size={16} /> Notify</button>
            </div>
          </article>
        ))}
      </div>

      {dialog && (
        <div className="modal-backdrop" onMouseDown={() => setDialog(null)}>
          <form className="modal small" onSubmit={submitAction} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{actionNames[dialog.action]}</h2>
              <button type="button" className="icon-button" onClick={() => setDialog(null)}><X size={19} /></button>
            </div>
            {dialog.action === 'defer' && (
              <label>
                Review date
                <input type="date" value={dialog.deferred_until} onChange={(event) => setDialog({ ...dialog, deferred_until: event.target.value })} required />
              </label>
            )}
            <label>
              Note
              <textarea value={dialog.note} onChange={(event) => setDialog({ ...dialog, note: event.target.value })} rows="4" maxLength="500" required={['dismiss', 'reject'].includes(dialog.action)} />
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setDialog(null)}>Cancel</button>
              <button className="primary-button">Confirm</button>
            </div>
          </form>
        </div>
      )}

      {audit && (
        <div className="modal-backdrop" onMouseDown={() => setAudit(null)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Audit history</h2>
                <p>{audit.item.summary}</p>
              </div>
              <button className="icon-button" onClick={() => setAudit(null)}><X size={19} /></button>
            </div>
            <div className="audit-list">
              {audit.entries.length === 0 && <p>No audit entries recorded.</p>}
              {audit.entries.map((entry) => (
                <article key={entry.id}>
                  <strong>{entry.action.replaceAll('_', ' ')}</strong>
                  <span>{entry.previous_status} → {entry.new_status}</span>
                  <p>{entry.note || 'No note'}</p>
                  <small>{entry.actor_email} · {new Date(entry.created_at).toLocaleString()}</small>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
