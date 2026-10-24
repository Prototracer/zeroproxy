import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client.js';

export default function JoinRequests() {
  const navigate = useNavigate();

  const [requests, setRequests] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionNotice, setActionNotice] = useState(null); // { type: 'success' | 'error', text: '' }
  const [selectedClassMap, setSelectedClassMap] = useState({}); // req.id -> class_id
  const [actionLoadingId, setActionLoadingId] = useState(null);

  // Multi-selection state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [bulkClassId, setBulkClassId] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [reqData, classData] = await Promise.all([
        apiRequest('/faculty/join-requests'),
        apiRequest('/faculty/classes'),
      ]);

      const reqList = Array.isArray(reqData) ? reqData : [];
      const classList = Array.isArray(classData) ? classData : [];

      setRequests(reqList);
      setClasses(classList);

      // Default select the requested class if set, otherwise first class
      if (classList.length > 0) {
        const defaultMap = {};
        reqList.forEach((r) => {
          defaultMap[r.id] = r.class_id || classList[0].id;
        });
        setSelectedClassMap(defaultMap);
        if (!bulkClassId) {
          setBulkClassId(classList[0].id);
        }
      }
      setSelectedIds(new Set());
    } catch (err) {
      setError(err?.message || 'Failed to load join requests from server.');
    } finally {
      setLoading(false);
    }
  }

  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const allPendingSelected =
    pendingRequests.length > 0 && pendingRequests.every((r) => selectedIds.has(r.id));

  function handleToggleSelectAll() {
    if (allPendingSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingRequests.map((r) => r.id)));
    }
  }

  function handleToggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleApprove(requestId) {
    const classId = selectedClassMap[requestId] || (classes.length > 0 ? classes[0].id : null);
    if (!classId) {
      alert('Please select a course to approve this student into.');
      return;
    }

    setActionLoadingId(requestId);
    setActionNotice(null);

    try {
      const res = await apiRequest(`/faculty/join-requests/${requestId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ class_id: Number(classId) }),
      });

      setActionNotice({
        type: 'success',
        text: res?.message || 'Join request approved. Student has been added to class enrollment.',
      });
      await loadData();
    } catch (err) {
      setActionNotice({
        type: 'error',
        text: err?.message || 'Failed to approve join request.',
      });
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleApproveSelected() {
    if (selectedIds.size === 0) return;
    if (classes.length === 0) {
      alert('Please create at least one course before approving students.');
      return;
    }

    const targetIds = Array.from(selectedIds);
    setBatchLoading(true);
    setActionNotice(null);

    let successCount = 0;
    let failCount = 0;

    for (const reqId of targetIds) {
      try {
        const classId =
          selectedClassMap[reqId] || bulkClassId || classes[0].id;
        await apiRequest(`/faculty/join-requests/${reqId}/approve`, {
          method: 'POST',
          body: JSON.stringify({ class_id: Number(classId) }),
        });
        successCount++;
      } catch {
        failCount++;
      }
    }

    setBatchLoading(false);
    setActionNotice({
      type: failCount === 0 ? 'success' : 'error',
      text: `Approved ${successCount} student(s) successfully.${
        failCount > 0 ? ` (${failCount} failed)` : ''
      }`,
    });
    await loadData();
  }

  async function handleReject(requestId) {
    const reason = window.prompt('Optional rejection reason (leave blank for none):');
    if (reason === null) return; // user cancelled prompt

    setActionLoadingId(requestId);
    setActionNotice(null);

    try {
      const res = await apiRequest(`/faculty/join-requests/${requestId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });

      setActionNotice({
        type: 'success',
        text: res?.message || 'Join request rejected.',
      });
      await loadData();
    } catch (err) {
      setActionNotice({
        type: 'error',
        text: err?.message || 'Failed to reject join request.',
      });
    } finally {
      setActionLoadingId(null);
    }
  }

  const cardStyle = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '16px',
    padding: '24px',
    backdropFilter: 'blur(12px)',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        padding: '30px',
        boxSizing: 'border-box',
        color: '#ffffff',
        fontFamily: "'Inter', Arial, sans-serif",
        background:
          'radial-gradient(circle at top right, #3b1d60, transparent 40%), linear-gradient(135deg, #090d1f, #121833 60%, #0a0d1d)',
      }}
    >
      {/* Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '15px',
          marginBottom: '30px',
        }}
      >
        <div>
          <button
            type="button"
            onClick={() => navigate('/faculty')}
            style={{
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent',
              color: '#67e8f9',
              cursor: 'pointer',
              fontSize: '13px',
              marginBottom: '10px',
            }}
          >
            ← Back to Dashboard
          </button>
          <h1 style={{ margin: 0, color: '#67e8f9', fontSize: '26px' }}>
            Course Join Requests
          </h1>
          <p style={{ color: '#9ca3af', margin: '4px 0 0', fontSize: '14px' }}>
            Review, approve, or reject students requesting admission to your classes
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            onClick={() => navigate('/faculty/enroll')}
            style={{
              padding: '10px 18px',
              borderRadius: '10px',
              border: 'none',
              background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Face Enrollment →
          </button>
        </div>
      </header>

      {/* Notifications */}
      {actionNotice && (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: '10px',
            fontSize: '14px',
            marginBottom: '20px',
            background:
              actionNotice.type === 'success'
                ? 'rgba(74, 222, 128, 0.15)'
                : 'rgba(251, 113, 133, 0.15)',
            color: actionNotice.type === 'success' ? '#4ade80' : '#fb7185',
            border: `1px solid ${
              actionNotice.type === 'success'
                ? 'rgba(74, 222, 128, 0.3)'
                : 'rgba(251, 113, 133, 0.3)'
            }`,
          }}
        >
          {actionNotice.text}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: '10px',
            fontSize: '14px',
            marginBottom: '20px',
            background: 'rgba(251, 113, 133, 0.15)',
            color: '#fb7185',
            border: '1px solid rgba(251, 113, 133, 0.3)',
          }}
        >
          {error}
        </div>
      )}

      {/* Main Table */}
      <section style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: '20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#67e8f9' }}>
              Pending Requests ({pendingRequests.length})
            </h2>

            {/* Bulk Action Controls */}
            {pendingRequests.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid rgba(103, 232, 249, 0.4)',
                    background: allPendingSelected ? '#06b6d4' : 'rgba(6, 182, 212, 0.12)',
                    color: allPendingSelected ? '#ffffff' : '#67e8f9',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {allPendingSelected ? '✓ Deselect All' : 'Select All'}
                </button>

                {selectedIds.size > 0 && (
                  <button
                    type="button"
                    disabled={batchLoading}
                    onClick={handleApproveSelected}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      background: 'linear-gradient(135deg, #10b981, #059669)',
                      color: '#ffffff',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: batchLoading ? 'not-allowed' : 'pointer',
                      boxShadow: '0 2px 10px rgba(16, 185, 129, 0.35)',
                    }}
                  >
                    {batchLoading ? 'Approving...' : `Approve Selected (${selectedIds.size})`}
                  </button>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={loadData}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent',
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            🔄 Refresh
          </button>
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', color: '#9ca3af', padding: '30px' }}>
            Loading requests...
          </p>
        ) : requests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9ca3af' }}>
            <p style={{ fontSize: '16px', margin: '0 0 8px', color: '#e2e8f0' }}>
              No join requests found
            </p>
            <p style={{ fontSize: '13px', margin: 0 }}>
              When students type your faculty email address to join, their requests will appear here.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ color: '#67e8f9', fontSize: '13px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ padding: '12px 10px', width: '38px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={allPendingSelected}
                      onChange={handleToggleSelectAll}
                      disabled={pendingRequests.length === 0}
                      title="Select / Deselect all pending"
                      style={{ cursor: 'pointer', transform: 'scale(1.15)', accentColor: '#06b6d4' }}
                    />
                  </th>
                  <th style={{ padding: '12px 10px' }}>Student Name</th>
                  <th style={{ padding: '12px 10px' }}>Roll / ID</th>
                  <th style={{ padding: '12px 10px' }}>Email</th>
                  <th style={{ padding: '12px 10px' }}>Requested At</th>
                  <th style={{ padding: '12px 10px' }}>Status</th>
                  <th style={{ padding: '12px 10px', minWidth: '220px' }}>Assign Class & Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => {
                  const isPending = req.status === 'pending';
                  const isSelected = selectedIds.has(req.id);
                  const statusColors = {
                    pending: { bg: 'rgba(251, 191, 36, 0.15)', text: '#fbbf24' },
                    approved: { bg: 'rgba(74, 222, 128, 0.15)', text: '#4ade80' },
                    rejected: { bg: 'rgba(251, 113, 133, 0.15)', text: '#fb7185' },
                  };
                  const color = statusColors[req.status] || statusColors.pending;

                  return (
                    <tr
                      key={req.id}
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        background: isSelected ? 'rgba(6, 182, 212, 0.08)' : 'transparent',
                        fontSize: '14px',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <td style={{ padding: '14px 10px', textAlign: 'center' }}>
                        {isPending ? (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleRow(req.id)}
                            style={{ cursor: 'pointer', transform: 'scale(1.15)', accentColor: '#06b6d4' }}
                          />
                        ) : (
                          <span style={{ color: '#475569' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '14px 10px', fontWeight: 600 }}>
                        {req.student_name}
                      </td>
                      <td style={{ padding: '14px 10px', color: '#a5acc5' }}>
                        {req.student_roll_no}
                      </td>
                      <td style={{ padding: '14px 10px', color: '#cbd5e1' }}>
                        {req.student_email}
                      </td>
                      <td style={{ padding: '14px 10px', color: '#94a3b8', fontSize: '13px' }}>
                        {new Date(req.created_at).toLocaleString()}
                      </td>
                      <td style={{ padding: '14px 10px' }}>
                        <span
                          style={{
                            fontSize: '12px',
                            fontWeight: 600,
                            padding: '4px 10px',
                            borderRadius: '12px',
                            background: color.bg,
                            color: color.text,
                            textTransform: 'capitalize',
                          }}
                        >
                          {req.status}
                        </span>
                      </td>
                      <td style={{ padding: '14px 10px' }}>
                        {isPending ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <select
                              value={selectedClassMap[req.id] || (classes[0]?.id ?? '')}
                              onChange={(e) =>
                                setSelectedClassMap((prev) => ({
                                  ...prev,
                                  [req.id]: e.target.value,
                                }))
                              }
                              style={{
                                padding: '6px 10px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255,255,255,0.2)',
                                background: '#1e293b',
                                color: '#ffffff',
                                fontSize: '13px',
                                outline: 'none',
                              }}
                            >
                              {classes.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.code} - {c.name}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              disabled={actionLoadingId === req.id || classes.length === 0}
                              onClick={() => handleApprove(req.id)}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '6px',
                                border: 'none',
                                background: '#10b981',
                                color: '#ffffff',
                                fontWeight: 600,
                                fontSize: '12px',
                                cursor: 'pointer',
                              }}
                            >
                              {actionLoadingId === req.id ? '...' : 'Approve'}
                            </button>

                            <button
                              type="button"
                              disabled={actionLoadingId === req.id}
                              onClick={() => handleReject(req.id)}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '6px',
                                border: '1px solid rgba(239,68,68,0.5)',
                                background: 'rgba(239,68,68,0.15)',
                                color: '#f87171',
                                fontWeight: 600,
                                fontSize: '12px',
                                cursor: 'pointer',
                              }}
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontSize: '12px', color: '#64748b' }}>
                            Decided {req.decided_at ? new Date(req.decided_at).toLocaleDateString() : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
