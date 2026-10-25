import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { apiRequest } from '../api/client.js';

function FacultyDashboard() {
  const navigate = useNavigate();

  // Courses state
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [classMessage, setClassMessage] = useState('Loading your courses from backend...');

  // Live Session & Rotating QR state
  const [activeSession, setActiveSession] = useState(null); // { id, course_id, status }
  const [qrPayload, setQrPayload] = useState(null); // { session_id, window, mac, expires_in_ms }
  const [qrCountdown, setQrCountdown] = useState(5);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [liveAttendance, setLiveAttendance] = useState({ present_count: 0, records: [] });
  const [errorMessage, setErrorMessage] = useState('');
  const [pendingJoinCount, setPendingJoinCount] = useState(0);

  // Course creation state
  const [showAddForm, setShowAddForm] = useState(false);
  const [courseName, setCourseName] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [courseSemester, setCourseSemester] = useState('Semester 3');
  const [courseMessage, setCourseMessage] = useState('');

  const qrPollTimerRef = useRef(null);
  const livePollTimerRef = useRef(null);

  // Load faculty's classes & join requests on mount
  useEffect(() => {
    loadClasses();
    loadPendingJoinRequests();

    const joinPollInterval = setInterval(() => {
      loadPendingJoinRequests();
    }, 10000);

    return () => {
      clearInterval(qrPollTimerRef.current);
      clearInterval(livePollTimerRef.current);
      clearInterval(joinPollInterval);
    };
  }, []);

  async function loadPendingJoinRequests() {
    try {
      const data = await apiRequest('/faculty/join-requests');
      if (Array.isArray(data)) {
        const count = data.filter((r) => r.status === 'pending').length;
        setPendingJoinCount(count);
      }
    } catch {
      // silently handle
    }
  }

  async function loadClasses() {
    try {
      const data = await apiRequest('/faculty/classes');
      if (Array.isArray(data)) {
        setClasses(data);
        setClassMessage(data.length > 0 ? '' : 'No courses found. Click "+ Add Course" to create your first class.');
        if (data.length > 0 && !selectedClassId) {
          setSelectedClassId(String(data[0].id));
        }

        // Auto-resume active session if any course has one running
        const runningCourse = data.find((c) => c.active_session_id != null);
        if (runningCourse && !activeSession) {
          resumeSession(runningCourse, runningCourse.active_session_id);
        }
      } else {
        setClassMessage('Could not parse classes from backend.');
      }
    } catch (err) {
      setClassMessage('Backend offline or unauthorized. Please check backend connection.');
    }
  }

  async function resumeSession(course, sessionId) {
    setSelectedClassId(String(course.id));
    setActiveSession({ id: sessionId, course_id: course.id, status: 'active' });
    await fetchRotatingQR(sessionId);
    startLiveAttendancePoller(sessionId);
  }

  // Selected class details helper
  const selectedClass = classes.find((c) => String(c.id) === String(selectedClassId));

  // ── Session & Dynamic QR Management ──────────────────────────────────────

  async function startLiveSession() {
    if (!selectedClass) {
      setErrorMessage('Please select a course to start a live session.');
      return;
    }

    setErrorMessage('');
    setSessionLoading(true);

    try {
      let session;
      if (selectedClass.active_session_id) {
        // Reuse existing active session for this course
        session = { id: selectedClass.active_session_id, course_id: selectedClass.id, status: 'active' };
      } else {
        // 1. Create active session in database
        session = await apiRequest('/sessions', {
          method: 'POST',
          body: JSON.stringify({ course_id: selectedClass.id }),
        });
      }

      setActiveSession(session);

      // 2. Fetch first rotating QR token
      await fetchRotatingQR(session.id);

      // 3. Start live attendance poller
      startLiveAttendancePoller(session.id);
      loadClasses();
      navigate(`/faculty/sessions/${session.id}`);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to start session on backend.');
    } finally {
      setSessionLoading(false);
    }
  }

  async function fetchRotatingQR(sessionId) {
    try {
      const tokenData = await apiRequest(`/sessions/${sessionId}/qr`);
      setQrPayload(tokenData);

      const ttlSeconds = Math.max(1, Math.round((tokenData.expires_in_ms || 30000) / 1000));
      setQrCountdown(ttlSeconds);

      // Schedule next QR refresh exactly before this window expires
      clearTimeout(qrPollTimerRef.current);
      const refreshDelay = Math.max(1500, (tokenData.expires_in_ms || 30000) - 300);

      qrPollTimerRef.current = setTimeout(() => {
        fetchRotatingQR(sessionId);
      }, refreshDelay);
    } catch (err) {
      if (err.message && err.message.includes('session_ended')) {
        endSessionLocal();
      } else {
        // Retry in 2 seconds on transient error
        clearTimeout(qrPollTimerRef.current);
        qrPollTimerRef.current = setTimeout(() => {
          fetchRotatingQR(sessionId);
        }, 2000);
      }
    }
  }

  // Tick countdown second by second for user visual feedback
  useEffect(() => {
    if (!activeSession || !qrPayload) return;

    const timer = setInterval(() => {
      setQrCountdown((prev) => (prev > 1 ? prev - 1 : 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [activeSession, qrPayload]);

  function startLiveAttendancePoller(sessionId) {
    clearInterval(livePollTimerRef.current);

    async function poll() {
      try {
        const live = await apiRequest(`/sessions/${sessionId}/live`);
        if (live) {
          setLiveAttendance(live);
        }
      } catch {
        // ignore occasional poll latency
      }
    }

    poll();
    livePollTimerRef.current = setInterval(poll, 3000);
  }

  async function endLiveSession() {
    if (!activeSession) return;

    const confirmEnd = window.confirm('Are you sure you want to end this attendance session? The QR code will be closed immediately.');
    if (!confirmEnd) return;

    try {
      await apiRequest(`/sessions/${activeSession.id}/end`, {
        method: 'POST',
      });
    } catch {
      // proceed with local cleanup
    }

    endSessionLocal();
    loadClasses();
  }

  function endSessionLocal() {
    clearInterval(qrPollTimerRef.current);
    clearInterval(livePollTimerRef.current);
    setActiveSession(null);
    setQrPayload(null);
  }

  // ── Course Creation ──────────────────────────────────────────────────────

  async function handleAddCourse(event) {
    event.preventDefault();
    const name = courseName.trim();
    const code = courseCode.trim().toUpperCase();

    if (!name || !code || !courseSemester) {
      setCourseMessage('Please fill in all course details.');
      return;
    }

    try {
      const created = await apiRequest('/faculty/classes', {
        method: 'POST',
        body: JSON.stringify({ name, code, semester: courseSemester }),
      });

      setClasses((prev) => [...prev, created]);
      setSelectedClassId(String(created.id));
      setCourseName('');
      setCourseCode('');
      setCourseMessage(`Course ${name} (${code}) created successfully.`);
      setShowAddForm(false);
    } catch (err) {
      setCourseMessage(err.message || 'Failed to add course.');
    }
  }

  // ── Join Code Management ────────────────────────────────────────────────
  const [codeActionLoading, setCodeActionLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  async function handleToggleJoinCode(courseId) {
    setCodeActionLoading(true);
    setErrorMessage('');
    try {
      const updated = await apiRequest(`/faculty/courses/${courseId}/toggle-join-code`, {
        method: 'POST',
      });
      setClasses((prev) =>
        prev.map((c) =>
          c.id === courseId
            ? { ...c, join_code: updated.join_code, join_code_enabled: updated.join_code_enabled }
            : c
        )
      );
    } catch (err) {
      setErrorMessage(err.message || 'Failed to toggle join code status.');
    } finally {
      setCodeActionLoading(false);
    }
  }

  async function handleRegenerateJoinCode(courseId) {
    if (!window.confirm('Generate a brand-new join code for this course? The old code will immediately stop working.')) {
      return;
    }
    setCodeActionLoading(true);
    setErrorMessage('');
    try {
      const updated = await apiRequest(`/faculty/courses/${courseId}/regenerate-join-code`, {
        method: 'POST',
      });
      setClasses((prev) =>
        prev.map((c) =>
          c.id === courseId
            ? { ...c, join_code: updated.join_code, join_code_enabled: updated.join_code_enabled }
            : c
        )
      );
    } catch (err) {
      setErrorMessage(err.message || 'Failed to regenerate join code.');
    } finally {
      setCodeActionLoading(false);
    }
  }

  function handleCopyCode(code) {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }

  function handleLogout() {
    endSessionLocal();
    sessionStorage.clear();
    navigate('/login', { replace: true });
  }

  // Common high-contrast dark card style
  const cardStyle = {
    background: 'rgba(15, 23, 42, 0.75)',
    border: '1px solid rgba(148, 163, 184, 0.18)',
    borderRadius: '18px',
    padding: '24px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
    backdropFilter: 'blur(14px)',
    marginBottom: '26px',
    color: '#ffffff',
  };

  const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    background: 'rgba(30, 41, 59, 0.8)',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '14px',
    boxSizing: 'border-box',
    marginTop: '6px',
    marginBottom: '14px',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(circle at top right, #302060, transparent 40%), linear-gradient(135deg, #080d20, #11152e 60%, #090c1b)',
        fontFamily: "'Inter', Arial, sans-serif",
        padding: '30px',
        color: '#ffffff',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        {/* Header */}
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px',
            marginBottom: '35px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                style={{
                  background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '12px',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  letterSpacing: '0.05em',
                }}
              >
                FACULTY PORTAL
              </span>
              <h1 style={{ margin: 0, fontSize: '28px', color: '#ffffff', fontWeight: 700 }}>
                Faculty Dashboard
              </h1>
            </div>
            <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '14px' }}>
              ZeroProxy • Smart Facial Verification & Rotating QR System
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => navigate('/faculty/join-requests')}
              style={{
                padding: '10px 18px',
                background:
                  pendingJoinCount > 0
                    ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                    : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
                boxShadow:
                  pendingJoinCount > 0
                    ? '0 4px 14px rgba(245, 158, 11, 0.45)'
                    : '0 4px 14px rgba(99, 102, 241, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>📩 Join Requests</span>
              {pendingJoinCount > 0 && (
                <span
                  style={{
                    background: '#ffffff',
                    color: '#b45309',
                    borderRadius: '12px',
                    padding: '1px 8px',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  {pendingJoinCount}
                </span>
              )}
            </button>



            <button
              type="button"
              onClick={handleLogout}
              style={{
                padding: '10px 18px',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Logout
            </button>
          </div>
        </header>

        {pendingJoinCount > 0 && (
          <div
            style={{
              padding: '14px 20px',
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(217, 119, 6, 0.15))',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              borderRadius: '12px',
              marginBottom: '22px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '24px' }}>🔔</span>
              <div>
                <strong style={{ color: '#fbbf24', fontSize: '15px' }}>
                  {pendingJoinCount} Student Course Join Request{pendingJoinCount > 1 ? 's' : ''} Pending!
                </strong>
                <p style={{ margin: '3px 0 0', color: '#e2e8f0', fontSize: '13px' }}>
                  Students have sent requests to join your classes. Review and assign them to an active course.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/faculty/join-requests')}
              style={{
                padding: '9px 18px',
                borderRadius: '8px',
                border: 'none',
                background: '#f59e0b',
                color: '#1e1b4b',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Review Requests ({pendingJoinCount}) →
            </button>
          </div>
        )}

        {errorMessage && (
          <div
            style={{
              padding: '12px 18px',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#fca5a5',
              borderRadius: '10px',
              marginBottom: '20px',
              fontSize: '14px',
            }}
          >
            ⚠️ {errorMessage}
          </div>
        )}

        {/* ── Section: Live Attendance & Dynamic QR ─────────────────────── */}
        <section style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '18px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#67e8f9' }}>
                Live Attendance & Dynamic QR
              </h2>
              <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '14px' }}>
                Start a live lecture session with rotating cryptographic QR tokens (Handbook §1 & §3)
              </p>
            </div>

            {activeSession && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span
                  style={{
                    background: 'rgba(74, 222, 128, 0.15)',
                    border: '1px solid rgba(74, 222, 128, 0.4)',
                    color: '#4ade80',
                    padding: '6px 14px',
                    borderRadius: '20px',
                    fontSize: '13px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ade80', animation: 'pulse 1.5s infinite' }} />
                  Session #{activeSession.id} Active
                </span>

                <button
                  type="button"
                  onClick={() => navigate(`/faculty/sessions/${activeSession.id}`)}
                  style={{
                    background: 'linear-gradient(135deg, #06b6d4, #2563eb)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 14px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 2px 8px rgba(6, 182, 212, 0.3)',
                  }}
                >
                  🖥️ Open Live Display Screen
                </button>
              </div>
            )}
          </div>

          {!activeSession ? (
            /* Session Start Configuration */
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', alignItems: 'flex-end', marginTop: '14px' }}>
                <div>
                  <label htmlFor="course-select" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
                    Select Course for Attendance Session:
                  </label>
                  <select
                    id="course-select"
                    value={selectedClassId}
                    onChange={(e) => setSelectedClassId(e.target.value)}
                    style={{
                      ...inputStyle,
                      marginTop: 0,
                      marginBottom: 0,
                      background: 'rgba(15, 23, 42, 0.9)',
                      cursor: 'pointer',
                    }}
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name} ({c.code}) — {c.semester}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  disabled={sessionLoading || classes.length === 0}
                  onClick={startLiveSession}
                  style={{
                    padding: '12px 24px',
                    background: 'linear-gradient(135deg, #06b6d4, #2563eb)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '14px',
                    cursor: sessionLoading ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 14px rgba(6, 182, 212, 0.35)',
                    opacity: classes.length === 0 ? 0.6 : 1,
                  }}
                >
                  {sessionLoading ? 'Starting Session...' : '🚀 Start Live Session & Show Dynamic QR'}
                </button>
              </div>

              {classes.length === 0 && (
                <p style={{ color: '#f59e0b', fontSize: '13px', marginTop: '12px' }}>
                  Please create a course below before starting an attendance session.
                </p>
              )}
            </div>
          ) : (
            /* Live Dynamic QR Display Screen */
            <div
              style={{
                marginTop: '16px',
                padding: '24px',
                background: 'rgba(2, 6, 23, 0.85)',
                border: '1px solid rgba(103, 232, 249, 0.3)',
                borderRadius: '16px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '20px',
                }}
              >
                {/* QR Code Container */}
                <div
                  style={{
                    background: '#ffffff',
                    padding: '16px',
                    borderRadius: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
                  }}
                >
                  {qrPayload ? (
                    <QRCodeSVG
                      value={JSON.stringify({
                        session_id: qrPayload.session_id,
                        window: qrPayload.window,
                        mac: qrPayload.mac,
                      })}
                      size={200}
                      level="H"
                    />
                  ) : (
                    <div style={{ width: '200px', height: '200px', display: 'grid', placeItems: 'center', color: '#334155' }}>
                      Generating rotating QR...
                    </div>
                  )}

                  <span style={{ fontSize: '11px', color: '#64748b', marginTop: '8px', fontWeight: 600 }}>
                    HMAC-SHA256 Signed • Rotates ~30s
                  </span>
                </div>

                {/* Session Live Details */}
                <div style={{ flex: 1, minWidth: '280px' }}>
                  <h3 style={{ margin: '0 0 6px', fontSize: '20px', color: '#ffffff' }}>
                    {selectedClass?.name}
                  </h3>
                  <p style={{ margin: '0 0 16px', color: '#94a3b8', fontSize: '14px' }}>
                    Course Code: <strong style={{ color: '#67e8f9' }}>{selectedClass?.code}</strong> • Session #{activeSession.id}
                  </p>

                  {/* Dynamic Timer Badge & Progress */}
                  <div
                    style={{
                      background: 'rgba(103, 232, 249, 0.08)',
                      border: '1px solid rgba(103, 232, 249, 0.25)',
                      padding: '12px 16px',
                      borderRadius: '10px',
                      marginBottom: '16px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#67e8f9' }}>
                        <span>🔄 Window <strong style={{ color: '#ffffff' }}>#{qrPayload?.window}</strong></span>
                        <span>•</span>
                        <span>Next Rotation in: <strong style={{ fontSize: '15px', color: '#38bdf8' }}>{qrCountdown}s</strong></span>
                      </div>

                      <button
                        type="button"
                        onClick={() => fetchRotatingQR(activeSession.id)}
                        style={{
                          padding: '4px 10px',
                          background: 'rgba(103, 232, 249, 0.15)',
                          color: '#67e8f9',
                          border: '1px solid rgba(103, 232, 249, 0.3)',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        ⚡ Force Rotate
                      </button>
                    </div>

                    {/* Animated Progress Bar */}
                    <div style={{ width: '100%', height: '4px', background: 'rgba(103, 232, 249, 0.15)', borderRadius: '2px', overflow: 'hidden', marginTop: '10px' }}>
                      <div
                        style={{
                          width: `${Math.min(100, Math.max(0, (qrCountdown / 5) * 100))}%`,
                          height: '100%',
                          background: 'linear-gradient(90deg, #06b6d4, #3b82f6)',
                          transition: 'width 1s linear',
                        }}
                      />
                    </div>

                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px', fontFamily: 'monospace' }}>
                      Token MAC: {qrPayload?.mac ? qrPayload.mac.substring(0, 16) + '...' : 'Generating...'}
                    </div>
                  </div>

                  {/* Live Headcount */}
                  <div style={{ background: 'rgba(30, 41, 59, 0.6)', padding: '14px 18px', borderRadius: '10px', marginBottom: '18px' }}>
                    <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Students Marked Present
                    </div>
                    <div style={{ fontSize: '32px', fontWeight: 800, color: '#4ade80', margin: '4px 0' }}>
                      {liveAttendance.present_count}
                    </div>
                    <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
                      Verified via Facial Liveness & Proximity
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={endLiveSession}
                    style={{
                      padding: '11px 20px',
                      background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 700,
                      fontSize: '14px',
                      cursor: 'pointer',
                      boxShadow: '0 4px 14px rgba(220, 38, 38, 0.35)',
                    }}
                  >
                    🛑 End Attendance Session
                  </button>
                </div>
              </div>

              {/* Real-time Records List */}
              {liveAttendance.records && liveAttendance.records.length > 0 && (
                <div style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px' }}>
                  <h4 style={{ margin: '0 0 10px', fontSize: '14px', color: '#cbd5e1' }}>
                    Recent Live Sign-Ins:
                  </h4>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {liveAttendance.records.map((r, i) => (
                      <span
                        key={i}
                        style={{
                          fontSize: '12px',
                          background: 'rgba(74, 222, 128, 0.1)',
                          border: '1px solid rgba(74, 222, 128, 0.3)',
                          color: '#4ade80',
                          padding: '4px 10px',
                          borderRadius: '6px',
                        }}
                      >
                        ✓ Student ID #{r.student_id} ({r.source})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Section: My Classes ───────────────────────────────────────── */}
        <section style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#ffffff' }}>
                My Classes
              </h2>
              <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '14px' }}>
                Manage your assigned courses and enrolled students
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowAddForm(!showAddForm)}
              style={{
                padding: '9px 18px',
                background: showAddForm ? 'rgba(148, 163, 184, 0.2)' : 'linear-gradient(135deg, #0284c7, #2563eb)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              {showAddForm ? 'Cancel' : '+ Add Course'}
            </button>
          </div>

          {classMessage && (
            <p style={{ color: '#94a3b8', fontSize: '14px', margin: '0 0 14px' }}>
              {classMessage}
            </p>
          )}

          {/* Add Course Form */}
          {showAddForm && (
            <form
              onSubmit={handleAddCourse}
              style={{
                background: 'rgba(2, 6, 23, 0.8)',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                borderRadius: '12px',
                padding: '20px',
                marginBottom: '20px',
              }}
            >
              <h3 style={{ margin: '0 0 14px', fontSize: '16px', color: '#67e8f9' }}>
                Create New Course
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                <div>
                  <label htmlFor="course-name-input" style={{ fontSize: '13px', color: '#cbd5e1' }}>Course Name:</label>
                  <input
                    id="course-name-input"
                    type="text"
                    value={courseName}
                    onChange={(e) => setCourseName(e.target.value)}
                    placeholder="e.g. Design and Analysis of Algorithms"
                    required
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label htmlFor="course-code-input" style={{ fontSize: '13px', color: '#cbd5e1' }}>Course Code:</label>
                  <input
                    id="course-code-input"
                    type="text"
                    value={courseCode}
                    onChange={(e) => setCourseCode(e.target.value)}
                    placeholder="e.g. CS301"
                    required
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label htmlFor="course-sem-select" style={{ fontSize: '13px', color: '#cbd5e1' }}>Semester:</label>
                  <select
                    id="course-sem-select"
                    value={courseSemester}
                    onChange={(e) => setCourseSemester(e.target.value)}
                    style={inputStyle}
                  >
                    {Array.from({ length: 8 }, (_, i) => (
                      <option key={i + 1} value={`Semester ${i + 1}`}>
                        Semester {i + 1}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '6px' }}>
                <button
                  type="submit"
                  style={{
                    padding: '10px 20px',
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Save Course
                </button>

                {courseMessage && (
                  <span style={{ fontSize: '13px', color: courseMessage.includes('successfully') ? '#4ade80' : '#f87171' }}>
                    {courseMessage}
                  </span>
                )}
              </div>
            </form>
          )}

          {/* Classes Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {classes.map((c) => {
              const isSelected = String(c.id) === String(selectedClassId);
              return (
                <div
                  key={c.id}
                  style={{
                    background: isSelected ? 'rgba(30, 58, 138, 0.4)' : 'rgba(30, 41, 59, 0.5)',
                    border: isSelected ? '1px solid #3b82f6' : '1px solid rgba(148, 163, 184, 0.15)',
                    borderRadius: '14px',
                    padding: '18px',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                    <div>
                      <span style={{ fontSize: '11px', background: 'rgba(103, 232, 249, 0.15)', color: '#67e8f9', padding: '3px 8px', borderRadius: '4px', fontWeight: 700 }}>
                        {c.code}
                      </span>
                      <h3 style={{ margin: '8px 0 4px', fontSize: '18px', color: '#ffffff', fontWeight: 600 }}>
                        {c.name}
                      </h3>
                      <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                        {c.semester}
                      </p>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '18px', fontWeight: 700, color: '#38bdf8' }}>
                        {c.student_count ?? 0}
                      </span>
                      <span style={{ display: 'block', fontSize: '11px', color: '#94a3b8' }}>
                        Enrolled
                      </span>
                    </div>
                  </div>

                  {/* Course Join Code Management */}
                  <div
                    style={{
                      marginTop: '14px',
                      padding: '12px 14px',
                      background: 'rgba(15, 23, 42, 0.75)',
                      borderRadius: '10px',
                      border: c.join_code_enabled ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Student Join Code
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '10px',
                          background: c.join_code_enabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: c.join_code_enabled ? '#34d399' : '#f87171',
                          border: c.join_code_enabled ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                        }}
                      >
                        {c.join_code_enabled ? '● Active (Open)' : '○ Disabled (Closed)'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <code
                          style={{
                            fontSize: '18px',
                            fontWeight: 800,
                            letterSpacing: '0.18em',
                            color: c.join_code_enabled ? '#67e8f9' : '#64748b',
                            background: 'rgba(0, 0, 0, 0.3)',
                            padding: '3px 8px',
                            borderRadius: '6px',
                          }}
                        >
                          {c.join_code || '------'}
                        </code>
                        <button
                          type="button"
                          onClick={() => handleCopyCode(c.join_code)}
                          title="Copy Code"
                          style={{
                            padding: '4px 8px',
                            fontSize: '11px',
                            borderRadius: '5px',
                            border: '1px solid rgba(255,255,255,0.2)',
                            background: 'rgba(255,255,255,0.06)',
                            color: copiedCode ? '#34d399' : '#cbd5e1',
                            cursor: 'pointer',
                          }}
                        >
                          {copiedCode ? '✓ Copied' : '📋 Copy'}
                        </button>
                      </div>

                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          disabled={codeActionLoading}
                          onClick={() => handleToggleJoinCode(c.id)}
                          style={{
                            padding: '4px 10px',
                            fontSize: '11px',
                            fontWeight: 600,
                            borderRadius: '6px',
                            border: 'none',
                            background: c.join_code_enabled ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                            color: c.join_code_enabled ? '#fca5a5' : '#86efac',
                            cursor: 'pointer',
                          }}
                        >
                          {c.join_code_enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          disabled={codeActionLoading}
                          onClick={() => handleRegenerateJoinCode(c.id)}
                          title="Generate a new randomized code"
                          style={{
                            padding: '4px 8px',
                            fontSize: '11px',
                            borderRadius: '6px',
                            border: '1px solid rgba(148, 163, 184, 0.3)',
                            background: 'transparent',
                            color: '#94a3b8',
                            cursor: 'pointer',
                          }}
                        >
                          🔄 New
                        </button>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '12px' }}>
                    <span style={{ fontSize: '12px', color: c.session?.includes('Active') ? '#4ade80' : '#94a3b8' }}>
                      ● {c.session || 'No active session'}
                    </span>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      {c.active_session_id && (
                        <button
                          type="button"
                          onClick={() => {
                            resumeSession(c, c.active_session_id);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          style={{
                            padding: '6px 12px',
                            background: 'linear-gradient(135deg, #10b981, #059669)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            boxShadow: '0 2px 8px rgba(16, 185, 129, 0.4)',
                          }}
                        >
                          ▶ Show Live QR
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedClassId(String(c.id));
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        style={{
                          padding: '6px 14px',
                          background: isSelected ? '#2563eb' : 'rgba(255,255,255,0.1)',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {isSelected ? '✓ Selected' : 'Select'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

export default FacultyDashboard;
