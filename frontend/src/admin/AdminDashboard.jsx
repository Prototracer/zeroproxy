import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import AdminLivenessLab from './AdminLivenessLab.jsx';

export default function AdminDashboard() {
  const navigate = useNavigate();

  // Navigation tab
  const [activeTab, setActiveTab] = useState('users'); // 'users' | 'create-faculty' | 'reports' | 'audit' | 'liveness-lab'

  // Users Directory state
  const [users, setUsers] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  // Modals state
  const [actionModal, setActionModal] = useState(null); // { type: 'status'|'password'|'reset-face'|'purge', user }
  const [newStatus, setNewStatus] = useState('active');
  const [tempPassword, setTempPassword] = useState('');
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');
  const [modalSuccess, setModalSuccess] = useState('');

  // Create Faculty state
  const [facultyName, setFacultyName] = useState('');
  const [facultyEmail, setFacultyEmail] = useState('');
  const [facultyRoll, setFacultyRoll] = useState('');
  const [facultyPassword, setFacultyPassword] = useState('');
  const [createFacultyLoading, setCreateFacultyLoading] = useState(false);
  const [createFacultySuccess, setCreateFacultySuccess] = useState('');
  const [createFacultyError, setCreateFacultyError] = useState('');

  // Override Reports state
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState('');

  // Audit Logs state
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('');

  // Load data based on active tab
  useEffect(() => {
    if (activeTab === 'users') {
      loadUsers();
    } else if (activeTab === 'reports') {
      loadReports();
    } else if (activeTab === 'audit') {
      loadAuditLogs();
    }
  }, [activeTab, roleFilter, statusFilter, searchTerm, page]);

  // ── Users Directory Handlers ─────────────────────────────────────────────

  async function loadUsers() {
    setUsersLoading(true);
    setUsersError('');
    try {
      const params = new URLSearchParams();
      if (roleFilter) params.set('role', roleFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (searchTerm.trim()) params.set('search', searchTerm.trim());
      params.set('page', String(page));
      params.set('limit', String(limit));

      const data = await apiRequest(`/admin/users?${params.toString()}`);
      setUsers(data?.users || []);
      setTotalUsers(data?.total || 0);
    } catch (err) {
      setUsersError(err.message || 'Failed to fetch user directory.');
    } finally {
      setUsersLoading(false);
    }
  }

  // ── Action Modal Handlers ────────────────────────────────────────────────

  async function handleStatusChange() {
    if (!actionModal?.user) return;
    setModalLoading(true);
    setModalError('');
    try {
      await apiRequest(`/admin/users/${actionModal.user.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus }),
      });
      setModalSuccess(`Successfully updated status for ${actionModal.user.name}`);
      setTimeout(() => {
        setActionModal(null);
        setModalSuccess('');
        loadUsers();
      }, 1000);
    } catch (err) {
      setModalError(err.message || 'Failed to update user status.');
    } finally {
      setModalLoading(false);
    }
  }

  async function handlePasswordReset() {
    if (!actionModal?.user) return;
    setModalLoading(true);
    setModalError('');
    try {
      const res = await apiRequest(`/admin/users/${actionModal.user.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({
          temporary_password: tempPassword.trim() || undefined,
        }),
      });
      setModalSuccess(
        `Temporary password set to: ${res.temporary_password}. User must change password on next login.`
      );
      loadUsers();
    } catch (err) {
      setModalError(err.message || 'Failed to reset password.');
    } finally {
      setModalLoading(false);
    }
  }

  async function handleResetFace() {
    if (!actionModal?.user) return;
    setModalLoading(true);
    setModalError('');
    try {
      await apiRequest(`/admin/users/${actionModal.user.id}/reset-face`, {
        method: 'POST',
      });
      setModalSuccess(`Face enrollment reset for ${actionModal.user.name}. Student can now re-enroll.`);
      setTimeout(() => {
        setActionModal(null);
        setModalSuccess('');
        loadUsers();
      }, 1200);
    } catch (err) {
      setModalError(err.message || 'Failed to reset face enrollment.');
    } finally {
      setModalLoading(false);
    }
  }

  async function handlePurgeBiometrics() {
    if (!actionModal?.user) return;
    setModalLoading(true);
    setModalError('');
    try {
      await apiRequest(`/admin/users/${actionModal.user.id}/purge-biometrics`, {
        method: 'POST',
      });
      setModalSuccess(
        `Biometrics permanently purged for ${actionModal.user.name} in compliance with DPDP.`
      );
      setTimeout(() => {
        setActionModal(null);
        setModalSuccess('');
        loadUsers();
      }, 1200);
    } catch (err) {
      setModalError(err.message || 'Failed to purge biometric data.');
    } finally {
      setModalLoading(false);
    }
  }

  async function handleDeleteUser() {
    if (!actionModal?.user) return;
    setModalLoading(true);
    setModalError('');
    try {
      const res = await apiRequest(`/admin/users/${actionModal.user.id}`, {
        method: 'DELETE',
      });
      setModalSuccess(res?.message || `User ${actionModal.user.name} permanently deleted.`);
      setTimeout(() => {
        setActionModal(null);
        setModalSuccess('');
        loadUsers();
      }, 1200);
    } catch (err) {
      setModalError(err.message || 'Failed to delete user.');
    } finally {
      setModalLoading(false);
    }
  }

  // ── Create Faculty Handler ───────────────────────────────────────────────

  async function handleCreateFaculty(e) {
    e.preventDefault();
    setCreateFacultyLoading(true);
    setCreateFacultyError('');
    setCreateFacultySuccess('');

    try {
      const res = await apiRequest('/admin/faculty', {
        method: 'POST',
        body: JSON.stringify({
          name: facultyName.trim(),
          email: facultyEmail.trim(),
          roll_no: facultyRoll.trim(),
          password: facultyPassword,
        }),
      });

      setCreateFacultySuccess(
        `Faculty account created for ${res.name} (${res.email}). Temporary password flag set.`
      );
      setFacultyName('');
      setFacultyEmail('');
      setFacultyRoll('');
      setFacultyPassword('');
    } catch (err) {
      setCreateFacultyError(err.message || 'Failed to create faculty account.');
    } finally {
      setCreateFacultyLoading(false);
    }
  }

  // ── Override Reports Handler ─────────────────────────────────────────────

  async function loadReports() {
    setReportsLoading(true);
    setReportsError('');
    try {
      const data = await apiRequest('/reports/overrides');
      setReports(Array.isArray(data) ? data : []);
    } catch (err) {
      setReportsError(err.message || 'Failed to load override reports.');
    } finally {
      setReportsLoading(false);
    }
  }

  // ── Audit Logs Handler ───────────────────────────────────────────────────

  async function loadAuditLogs() {
    setAuditLoading(true);
    setAuditError('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (auditActionFilter) params.set('action', auditActionFilter);

      const data = await apiRequest(`/admin/audit?${params.toString()}`);
      setAuditLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      setAuditError(err.message || 'Failed to load audit logs.');
    } finally {
      setAuditLoading(false);
    }
  }

  function handleLogout() {
    sessionStorage.clear();
    navigate('/login', { replace: true });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function generateRandomPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
    let res = '';
    for (let i = 0; i < 12; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return res;
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={containerStyle}>
      {/* ── Top Header ── */}
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <span
            style={{
              background: 'linear-gradient(135deg, #a855f7, #6366f1)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '14px',
              padding: '6px 14px',
              borderRadius: '10px',
              letterSpacing: '0.06em',
            }}
          >
            ADMIN CONSOLE
          </span>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0, color: '#ffffff' }}>
              ZeroProxy Administration & Compliance
            </h1>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '2px' }}>
              Tenant Isolation • DPDP Biometric Controls • Append-Only Audit Integrity
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => navigate('/faculty')}
            style={{ ...buttonStyle, background: 'rgba(30, 41, 59, 0.8)' }}
          >
            Faculty View
          </button>
          <button
            onClick={handleLogout}
            style={{ ...buttonStyle, background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', color: '#f87171' }}
          >
            Logout
          </button>
        </div>
      </header>

      {/* ── Main Tab Navigation Bar ── */}
      <div style={tabNavStyle}>
        <button
          onClick={() => setActiveTab('users')}
          style={{
            ...tabButtonStyle,
            background: activeTab === 'users' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
            color: activeTab === 'users' ? '#818cf8' : '#94a3b8',
            borderBottom: activeTab === 'users' ? '2px solid #818cf8' : '2px solid transparent',
          }}
        >
          👥 User Directory ({totalUsers})
        </button>

        <button
          onClick={() => setActiveTab('create-faculty')}
          style={{
            ...tabButtonStyle,
            background: activeTab === 'create-faculty' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
            color: activeTab === 'create-faculty' ? '#818cf8' : '#94a3b8',
            borderBottom: activeTab === 'create-faculty' ? '2px solid #818cf8' : '2px solid transparent',
          }}
        >
          ➕ Create Faculty
        </button>

        <button
          onClick={() => setActiveTab('reports')}
          style={{
            ...tabButtonStyle,
            background: activeTab === 'reports' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
            color: activeTab === 'reports' ? '#818cf8' : '#94a3b8',
            borderBottom: activeTab === 'reports' ? '2px solid #818cf8' : '2px solid transparent',
          }}
        >
          📊 Override Analytics
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          style={{
            ...tabButtonStyle,
            background: activeTab === 'audit' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
            color: activeTab === 'audit' ? '#818cf8' : '#94a3b8',
            borderBottom: activeTab === 'audit' ? '2px solid #818cf8' : '2px solid transparent',
          }}
        >
          📜 Audit & DPDP Ledger
        </button>

        <button
          onClick={() => setActiveTab('liveness-lab')}
          style={{
            ...tabButtonStyle,
            background: activeTab === 'liveness-lab' ? 'rgba(6, 182, 212, 0.25)' : 'transparent',
            color: activeTab === 'liveness-lab' ? '#67e8f9' : '#94a3b8',
            borderBottom: activeTab === 'liveness-lab' ? '2px solid #67e8f9' : '2px solid transparent',
          }}
        >
          🔬 Liveness Lab & Diagnostics
        </button>
      </div>

      {/* ── TAB 1: USERS DIRECTORY ── */}
      {activeTab === 'users' && (
        <section style={cardStyle}>
          {/* Filters Bar */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '20px' }}>
            {/* Search Input */}
            <input
              type="text"
              placeholder="Search by name, roll no, or email..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              style={{
                flex: '1 1 260px',
                background: 'rgba(30, 41, 59, 0.8)',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                borderRadius: '8px',
                padding: '10px 14px',
                color: '#ffffff',
                fontSize: '14px',
              }}
            />

            {/* Role Filter */}
            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
              style={selectStyle}
            >
              <option value="">All Roles</option>
              <option value="student">Students</option>
              <option value="faculty">Faculty</option>
              <option value="admin">Admins</option>
            </select>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              style={selectStyle}
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="suspended">Suspended</option>
            </select>

            <button
              onClick={loadUsers}
              style={{ ...buttonStyle, background: 'rgba(51, 65, 85, 0.8)' }}
            >
              🔄 Refresh
            </button>
          </div>

          {usersError && (
            <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '8px', color: '#f87171', marginBottom: '16px' }}>
              ⚠️ {usersError}
            </div>
          )}

          {/* Users Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={tableHeaderRowStyle}>
                  <th style={thStyle}>User</th>
                  <th style={thStyle}>Roll / ID</th>
                  <th style={thStyle}>Role</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Biometrics</th>
                  <th style={thStyle}>Security</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {usersLoading ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                      Loading directory...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                      No matching users found in tenant.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} style={trStyle}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600, color: '#ffffff' }}>{u.name}</div>
                        <div style={{ fontSize: '12px', color: '#94a3b8' }}>{u.email}</div>
                      </td>
                      <td style={tdStyle}>
                        <code style={codeStyle}>{u.roll_no}</code>
                      </td>
                      <td style={tdStyle}>
                        <span style={getRoleBadgeStyle(u.role)}>{u.role.toUpperCase()}</span>
                      </td>
                      <td style={tdStyle}>
                        <span style={getStatusBadgeStyle(u.status)}>{u.status.toUpperCase()}</span>
                      </td>
                      <td style={tdStyle}>
                        {u.role === 'student' ? (
                          u.has_face_vector ? (
                            <span style={pillEmeraldStyle}>✓ Enrolled</span>
                          ) : (
                            <span style={pillSlateStyle}>No Vector</span>
                          )
                        ) : (
                          <span style={{ color: '#64748b', fontSize: '12px' }}>N/A (Role)</span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        {u.must_change_password ? (
                          <span style={pillAmberStyle}>🔑 Temp Password</span>
                        ) : (
                          <span style={{ fontSize: '12px', color: '#94a3b8' }}>Standard</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {/* Status toggle */}
                          <button
                            onClick={() => {
                              setActionModal({ type: 'status', user: u });
                              setNewStatus(u.status === 'active' ? 'suspended' : 'active');
                              setModalError('');
                              setModalSuccess('');
                            }}
                            style={{ ...smallBtnStyle, background: 'rgba(51, 65, 85, 0.7)' }}
                            title="Update user status (active / suspended)"
                          >
                            Status
                          </button>

                          {/* Reset Password */}
                          <button
                            onClick={() => {
                              setActionModal({ type: 'password', user: u });
                              setTempPassword(generateRandomPassword());
                              setModalError('');
                              setModalSuccess('');
                            }}
                            style={{ ...smallBtnStyle, background: 'rgba(99, 102, 241, 0.25)', color: '#818cf8', border: '1px solid rgba(99, 102, 241, 0.4)' }}
                            title="Reset password and issue temporary credentials"
                          >
                            🔑 Pass
                          </button>

                          {/* Reset Face Biometrics (student only) */}
                          {u.role === 'student' && (
                            <button
                              onClick={() => {
                                setActionModal({ type: 'reset-face', user: u });
                                setModalError('');
                                setModalSuccess('');
                              }}
                              style={{ ...smallBtnStyle, background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.4)' }}
                              title="Reset face biometric enrollment to allow re-enrollment"
                            >
                              👤 Reset Face
                            </button>
                          )}

                          {/* Purge Biometrics DPDP (student only) */}
                          {u.role === 'student' && u.has_face_vector && (
                            <button
                              onClick={() => {
                                setActionModal({ type: 'purge', user: u });
                                setModalError('');
                                setModalSuccess('');
                              }}
                              style={{ ...smallBtnStyle, background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.4)' }}
                              title="Permanently purge biometric descriptors (DPDP compliance)"
                            >
                              🗑️ DPDP Purge
                            </button>
                          )}

                          {/* Permanently Delete User */}
                          <button
                            onClick={() => {
                              setActionModal({ type: 'delete', user: u });
                              setModalError('');
                              setModalSuccess('');
                            }}
                            style={{ ...smallBtnStyle, background: 'rgba(239, 68, 68, 0.3)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.5)' }}
                            title="Permanently delete user from institutional records"
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '18px', paddingTop: '14px', borderTop: '1px solid rgba(148, 163, 184, 0.15)' }}>
            <div style={{ fontSize: '13px', color: '#94a3b8' }}>
              Showing {users.length} of {totalUsers} users (Page {page})
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{ ...smallBtnStyle, opacity: page <= 1 ? 0.4 : 1 }}
              >
                Previous
              </button>
              <button
                disabled={users.length < limit || page * limit >= totalUsers}
                onClick={() => setPage((p) => p + 1)}
                style={{ ...smallBtnStyle, opacity: users.length < limit || page * limit >= totalUsers ? 0.4 : 1 }}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── TAB 2: CREATE FACULTY ── */}
      {activeTab === 'create-faculty' && (
        <section style={{ ...cardStyle, maxWidth: '640px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#ffffff', marginBottom: '6px' }}>
            Create New Faculty Account
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '20px' }}>
            Directly register an authorized professor or teaching staff member. Faculty will be issued
            a temporary password and prompted to set their own password on first login.
          </p>

          {createFacultySuccess && (
            <div style={{ padding: '12px 16px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10b981', borderRadius: '8px', color: '#34d399', marginBottom: '16px', fontSize: '14px' }}>
              ✅ {createFacultySuccess}
            </div>
          )}

          {createFacultyError && (
            <div style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '8px', color: '#f87171', marginBottom: '16px', fontSize: '14px' }}>
              ⚠️ {createFacultyError}
            </div>
          )}

          <form onSubmit={handleCreateFaculty}>
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Faculty Full Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Dr. Ada Lovelace"
                value={facultyName}
                onChange={(e) => setFacultyName(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Faculty Institutional Email *</label>
              <input
                type="email"
                required
                placeholder="faculty@university.edu"
                value={facultyEmail}
                onChange={(e) => setFacultyEmail(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Faculty Employee / Roll ID *</label>
              <input
                type="text"
                required
                placeholder="e.g. FAC008"
                value={facultyRoll}
                onChange={(e) => setFacultyRoll(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: '22px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={labelStyle}>Initial Temporary Password *</label>
                <button
                  type="button"
                  onClick={() => setFacultyPassword(generateRandomPassword())}
                  style={{ background: 'transparent', border: 'none', color: '#818cf8', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  🎲 Auto-Generate
                </button>
              </div>
              <input
                type="text"
                required
                minLength={8}
                placeholder="Minimum 8 characters"
                value={facultyPassword}
                onChange={(e) => setFacultyPassword(e.target.value)}
                style={inputStyle}
              />
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                The account will have <code>must_change_password=True</code> strictly enforced.
              </span>
            </div>

            <button
              type="submit"
              disabled={createFacultyLoading}
              style={{
                ...buttonStyle,
                width: '100%',
                padding: '12px',
                background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                fontWeight: 600,
                fontSize: '14px',
                justifyContent: 'center',
              }}
            >
              {createFacultyLoading ? 'Registering Faculty...' : 'Create Faculty Member'}
            </button>
          </form>
        </section>
      )}

      {/* ── TAB 3: OVERRIDE REPORTS ── */}
      {activeTab === 'reports' && (
        <section style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#ffffff', margin: 0 }}>
                Faculty Override Volume Analytics
              </h2>
              <p style={{ color: '#94a3b8', fontSize: '13px', margin: '2px 0 0' }}>
                Auditing manual attendance overrides across faculty (Handbook §7 & §8)
              </p>
            </div>
            <button onClick={loadReports} style={{ ...buttonStyle, background: 'rgba(51, 65, 85, 0.8)' }}>
              🔄 Refresh
            </button>
          </div>

          {reportsError && (
            <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '8px', color: '#f87171', marginBottom: '16px' }}>
              ⚠️ {reportsError}
            </div>
          )}

          {reportsLoading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Loading reports...</div>
          ) : reports.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '50px 20px', color: '#64748b' }}>
              <div style={{ fontSize: '40px', marginBottom: '8px' }}>📊</div>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>Zero Overrides Logged</div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>
                All attendances in this tenant have been verified via standard QR + facial scans.
              </div>
            </div>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr style={tableHeaderRowStyle}>
                  <th style={thStyle}>Faculty Member</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Override Count</th>
                  <th style={thStyle}>Audit Status</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((row) => (
                  <tr key={row.faculty_id} style={trStyle}>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600, color: '#ffffff' }}>{row.faculty_name}</span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ color: '#94a3b8' }}>{row.faculty_email}</span>
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          fontSize: '15px',
                          fontWeight: 700,
                          color: row.override_count > 10 ? '#f59e0b' : '#38bdf8',
                        }}
                      >
                        {row.override_count}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={pillAmberStyle}>Manual Overrides Logged</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ── TAB 4: AUDIT & DPDP LEDGER ── */}
      {activeTab === 'audit' && (
        <section style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#ffffff', margin: 0 }}>
                Append-Only Audit & DPDP Trail
              </h2>
              <p style={{ color: '#94a3b8', fontSize: '13px', margin: '2px 0 0' }}>
                Immutable logs of account creations, status transitions, biometrics resets, and overrides
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <select
                value={auditActionFilter}
                onChange={(e) => setAuditActionFilter(e.target.value)}
                style={selectStyle}
              >
                <option value="">All Actions</option>
                <option value="attendance_override">attendance_override</option>
                <option value="faculty_created">faculty_created</option>
                <option value="user_status_changed">user_status_changed</option>
                <option value="password_reset_by_admin">password_reset_by_admin</option>
                <option value="face_enrollment_reset">face_enrollment_reset</option>
                <option value="biometrics_purged_dpdp">biometrics_purged_dpdp</option>
              </select>
              <button onClick={loadAuditLogs} style={{ ...buttonStyle, background: 'rgba(51, 65, 85, 0.8)' }}>
                🔄 Refresh
              </button>
            </div>
          </div>

          {auditError && (
            <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '8px', color: '#f87171', marginBottom: '16px' }}>
              ⚠️ {auditError}
            </div>
          )}

          {auditLoading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Loading ledger...</div>
          ) : auditLogs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
              No audit records found matching criteria.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={tableHeaderRowStyle}>
                    <th style={thStyle}>Timestamp</th>
                    <th style={thStyle}>Actor</th>
                    <th style={thStyle}>Action</th>
                    <th style={thStyle}>Target</th>
                    <th style={thStyle}>Metadata</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} style={trStyle}>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontSize: '12px', color: '#94a3b8' }}>
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '13px' }}>
                          {log.actor_name || `User #${log.actor_id}`}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{log.actor_email}</div>
                      </td>
                      <td style={tdStyle}>
                        <span style={getActionBadgeStyle(log.action)}>{log.action}</span>
                      </td>
                      <td style={tdStyle}>
                        <code style={codeStyle}>{log.target || 'N/A'}</code>
                      </td>
                      <td style={{ ...tdStyle, maxWidth: '280px' }}>
                        {log.meta ? (
                          <pre
                            style={{
                              margin: 0,
                              fontSize: '11px',
                              background: 'rgba(15, 23, 42, 0.8)',
                              padding: '6px 8px',
                              borderRadius: '6px',
                              color: '#cbd5e1',
                              overflowX: 'auto',
                            }}
                          >
                            {JSON.stringify(log.meta, null, 1)}
                          </pre>
                        ) : (
                          <span style={{ color: '#64748b', fontSize: '12px' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── TAB 5: LIVENESS LAB & TELEMETRY ── */}
      {activeTab === 'liveness-lab' && (
        <AdminLivenessLab />
      )}

      {/* ── MODAL: USER ACTIONS (Status, Password, Face Reset, DPDP Purge) ── */}
      {actionModal && (
        <div style={modalBackdropStyle}>
          <div style={modalBoxStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '17px', fontWeight: 700, color: '#ffffff', margin: 0 }}>
                {actionModal.type === 'status' && 'Update User Account Status'}
                {actionModal.type === 'password' && 'Admin Password Reset'}
                {actionModal.type === 'reset-face' && 'Reset Student Face Enrollment'}
                {actionModal.type === 'purge' && 'DPDP Biometrics Purge (Permanent)'}
              </h3>
              <button
                onClick={() => setActionModal(null)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: '13px', color: '#cbd5e1', marginBottom: '16px' }}>
              Target: <strong>{actionModal.user.name}</strong> ({actionModal.user.roll_no} • {actionModal.user.email})
            </div>

            {modalSuccess && (
              <div style={{ padding: '10px 14px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10b981', borderRadius: '8px', color: '#34d399', marginBottom: '14px', fontSize: '13px' }}>
                ✅ {modalSuccess}
              </div>
            )}

            {modalError && (
              <div style={{ padding: '10px 14px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '8px', color: '#f87171', marginBottom: '14px', fontSize: '13px' }}>
                ⚠️ {modalError}
              </div>
            )}

            {/* ACTION: Status Update */}
            {actionModal.type === 'status' && (
              <div>
                <label style={labelStyle}>Select New Status:</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  style={{ ...selectStyle, width: '100%', marginBottom: '18px' }}
                >
                  <option value="active">Active (Access Allowed)</option>
                  <option value="suspended">Suspended (Revokes All Tokens & Locks Login)</option>
                  <option value="pending">Pending (Awaiting Approval / Re-enrollment)</option>
                </select>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button onClick={() => setActionModal(null)} style={{ ...buttonStyle, background: 'rgba(51, 65, 85, 0.8)' }}>
                    Cancel
                  </button>
                  <button
                    disabled={modalLoading}
                    onClick={handleStatusChange}
                    style={{ ...buttonStyle, background: 'linear-gradient(135deg, #6366f1, #4f46e5)', fontWeight: 600 }}
                  >
                    {modalLoading ? 'Updating...' : 'Save Status'}
                  </button>
                </div>
              </div>
            )}

            {/* ACTION: Password Reset */}
            {actionModal.type === 'password' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={labelStyle}>Temporary Password:</label>
                  <button
                    type="button"
                    onClick={() => setTempPassword(generateRandomPassword())}
                    style={{ background: 'transparent', border: 'none', color: '#818cf8', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    🎲 Regenerate
                  </button>
                </div>
                <input
                  type="text"
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                  style={{ ...inputStyle, marginBottom: '14px' }}
                />
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 18px' }}>
                  Setting a temporary password will revoke all currently active sessions and force
                  the user to change their password on the next login attempt.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button onClick={() => setActionModal(null)} style={{ ...buttonStyle, background: 'rgba(51, 65, 85, 0.8)' }}>
                    Cancel
                  </button>
                  <button
                    disabled={modalLoading}
                    onClick={handlePasswordReset}
                    style={{ ...buttonStyle, background: 'linear-gradient(135deg, #6366f1, #4f46e5)', fontWeight: 600 }}
                  >
                    {modalLoading ? 'Resetting...' : 'Set Temporary Password'}
                  </button>
                </div>
              </div>
            )}

            {/* ACTION: Reset Face */}
            {actionModal.type === 'reset-face' && (
              <div>
                <p style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: '1.5', marginBottom: '18px' }}>
                  This will deactivate all existing face vectors for <strong>{actionModal.user.name}</strong> and
                  reset their account status to <code>pending</code>. The student will be prompted to re-enroll
                  their face via the student portal.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button onClick={() => setActionModal(null)} style={{ ...buttonStyle, background: 'rgba(51, 65, 85, 0.8)' }}>
                    Cancel
                  </button>
                  <button
                    disabled={modalLoading}
                    onClick={handleResetFace}
                    style={{ ...buttonStyle, background: 'linear-gradient(135deg, #d97706, #b45309)', fontWeight: 600 }}
                  >
                    {modalLoading ? 'Resetting...' : 'Yes, Reset Face Data'}
                  </button>
                </div>
              </div>
            )}

            {/* ACTION: DPDP Purge */}
            {actionModal.type === 'purge' && (
              <div>
                <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '8px', color: '#f87171', fontSize: '13px', marginBottom: '16px' }}>
                  ⚠️ <strong>Irreversible DPDP Compliance Action:</strong> This will permanently erase or
                  deactivate all facial biometric descriptors associated with this student in the database.
                </div>
                <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: '1.5', marginBottom: '20px' }}>
                  Under the Digital Personal Data Protection Act, this student's biometric consent has been
                  withdrawn or a deletion request was received.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button onClick={() => setActionModal(null)} style={{ ...buttonStyle, background: 'rgba(51, 65, 85, 0.8)' }}>
                    Cancel
                  </button>
                  <button
                    disabled={modalLoading}
                    onClick={handlePurgeBiometrics}
                    style={{ ...buttonStyle, background: 'linear-gradient(135deg, #dc2626, #991b1b)', fontWeight: 600 }}
                  >
                    {modalLoading ? 'Purging...' : 'Permanently Purge Biometrics'}
                  </button>
                </div>
              </div>
            )}

            {/* ACTION: Permanently Delete User */}
            {actionModal.type === 'delete' && (
              <div>
                <div style={{ padding: '14px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '10px', color: '#f87171', fontSize: '13px', marginBottom: '16px' }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '6px' }}>
                    ⚠️ Permanent Deletion Warning
                  </div>
                  <div style={{ lineHeight: '1.5', color: '#fca5a5' }}>
                    Are you sure you want to permanently delete <strong>{actionModal.user.name}</strong> ({actionModal.user.email})?
                  </div>
                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#fecaca', lineHeight: '1.4' }}>
                    This action will irreversibly remove the user account, along with all associated class enrollments, attendance history, facial biometric vectors, and authentication sessions.
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button onClick={() => setActionModal(null)} style={{ ...buttonStyle, background: 'rgba(51, 65, 85, 0.8)' }}>
                    Cancel
                  </button>
                  <button
                    disabled={modalLoading}
                    onClick={handleDeleteUser}
                    style={{ ...buttonStyle, background: 'linear-gradient(135deg, #dc2626, #991b1b)', fontWeight: 600 }}
                  >
                    {modalLoading ? 'Deleting...' : '🗑️ Permanently Delete User'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const containerStyle = {
  minHeight: '100vh',
  background: 'radial-gradient(circle at top right, #2e1065, transparent 45%), linear-gradient(135deg, #090d1a, #0f172a 60%, #080c18)',
  fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  padding: '28px',
  color: '#ffffff',
  boxSizing: 'border-box',
};

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '16px',
  background: 'rgba(15, 23, 42, 0.75)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '16px',
  padding: '18px 24px',
  backdropFilter: 'blur(14px)',
  marginBottom: '20px',
};

const tabNavStyle = {
  display: 'flex',
  gap: '8px',
  borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
  marginBottom: '24px',
  overflowX: 'auto',
};

const tabButtonStyle = {
  border: 'none',
  padding: '12px 18px',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  borderRadius: '8px 8px 0 0',
  whiteSpace: 'nowrap',
};

const cardStyle = {
  background: 'rgba(15, 23, 42, 0.75)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '18px',
  padding: '24px',
  backdropFilter: 'blur(14px)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  textAlign: 'left',
};

const tableHeaderRowStyle = {
  borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
};

const thStyle = {
  padding: '12px 14px',
  fontSize: '12px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#94a3b8',
};

const trStyle = {
  borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
  transition: 'background 0.2s ease',
};

const tdStyle = {
  padding: '14px',
  fontSize: '13px',
  verticalAlign: 'middle',
};

const buttonStyle = {
  border: 'none',
  borderRadius: '8px',
  padding: '8px 14px',
  color: '#ffffff',
  fontSize: '13px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
};

const smallBtnStyle = {
  border: 'none',
  borderRadius: '6px',
  padding: '6px 10px',
  color: '#ffffff',
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  background: 'rgba(51, 65, 85, 0.8)',
};

const inputStyle = {
  width: '100%',
  background: 'rgba(30, 41, 59, 0.8)',
  border: '1px solid rgba(148, 163, 184, 0.25)',
  borderRadius: '8px',
  padding: '10px 14px',
  color: '#ffffff',
  fontSize: '14px',
  boxSizing: 'border-box',
};

const selectStyle = {
  background: 'rgba(30, 41, 59, 0.8)',
  border: '1px solid rgba(148, 163, 184, 0.25)',
  borderRadius: '8px',
  padding: '9px 12px',
  color: '#ffffff',
  fontSize: '13px',
  cursor: 'pointer',
};

const labelStyle = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  color: '#cbd5e1',
  marginBottom: '6px',
};

const codeStyle = {
  background: 'rgba(30, 41, 59, 0.8)',
  padding: '3px 6px',
  borderRadius: '4px',
  fontSize: '12px',
  color: '#38bdf8',
};

const pillEmeraldStyle = {
  fontSize: '11px',
  fontWeight: 700,
  padding: '3px 8px',
  borderRadius: '12px',
  background: 'rgba(16, 185, 129, 0.15)',
  color: '#34d399',
  border: '1px solid rgba(16, 185, 129, 0.3)',
};

const pillAmberStyle = {
  fontSize: '11px',
  fontWeight: 700,
  padding: '3px 8px',
  borderRadius: '12px',
  background: 'rgba(245, 158, 11, 0.15)',
  color: '#fbbf24',
  border: '1px solid rgba(245, 158, 11, 0.3)',
};

const pillSlateStyle = {
  fontSize: '11px',
  fontWeight: 600,
  padding: '3px 8px',
  borderRadius: '12px',
  background: 'rgba(148, 163, 184, 0.15)',
  color: '#94a3b8',
};

function getRoleBadgeStyle(role) {
  if (role === 'admin') {
    return {
      fontSize: '11px',
      fontWeight: 700,
      padding: '3px 8px',
      borderRadius: '12px',
      background: 'rgba(168, 85, 247, 0.18)',
      color: '#c084fc',
      border: '1px solid rgba(168, 85, 247, 0.3)',
    };
  }
  if (role === 'faculty') {
    return {
      fontSize: '11px',
      fontWeight: 700,
      padding: '3px 8px',
      borderRadius: '12px',
      background: 'rgba(56, 189, 248, 0.18)',
      color: '#38bdf8',
      border: '1px solid rgba(56, 189, 248, 0.3)',
    };
  }
  return {
    fontSize: '11px',
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: '12px',
    background: 'rgba(99, 102, 241, 0.18)',
    color: '#818cf8',
    border: '1px solid rgba(99, 102, 241, 0.3)',
  };
}

function getStatusBadgeStyle(status) {
  if (status === 'active') {
    return pillEmeraldStyle;
  }
  if (status === 'pending') {
    return pillAmberStyle;
  }
  return {
    fontSize: '11px',
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: '12px',
    background: 'rgba(239, 68, 68, 0.15)',
    color: '#f87171',
    border: '1px solid rgba(239, 68, 68, 0.3)',
  };
}

function getActionBadgeStyle(action) {
  let color = '#38bdf8';
  let bg = 'rgba(56, 189, 248, 0.15)';
  if (action.includes('purge') || action.includes('suspend')) {
    color = '#f87171';
    bg = 'rgba(239, 68, 68, 0.15)';
  } else if (action.includes('reset') || action.includes('override')) {
    color = '#fbbf24';
    bg = 'rgba(245, 158, 11, 0.15)';
  } else if (action.includes('created')) {
    color = '#34d399';
    bg = 'rgba(16, 185, 129, 0.15)';
  }

  return {
    fontSize: '11px',
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: '6px',
    background: bg,
    color: color,
  };
}

const modalBackdropStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0, 0, 0, 0.75)',
  backdropFilter: 'blur(6px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
  padding: '20px',
};

const modalBoxStyle = {
  background: '#0f172a',
  border: '1px solid rgba(148, 163, 184, 0.25)',
  borderRadius: '18px',
  padding: '26px',
  maxWidth: '480px',
  width: '100%',
  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
  color: '#ffffff',
};
