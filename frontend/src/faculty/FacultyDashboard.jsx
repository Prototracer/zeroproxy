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

  // Class Students Roster & Removal/Restoration state
  const [rosterModalCourse, setRosterModalCourse] = useState(null);
  const [rosterTab, setRosterTab] = useState('active'); // 'active' | 'removed'
  const [rosterData, setRosterData] = useState({ active_students: [], removed_students: [] });
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState('');
  const [removeStudentTarget, setRemoveStudentTarget] = useState(null);
  const [removeReason, setRemoveReason] = useState('');
  const [removeSubmitting, setRemoveSubmitting] = useState(false);
  const [restoreSubmitting, setRestoreSubmitting] = useState(false);

  async function openRosterModal(course) {
    setRosterModalCourse(course);
    setRosterTab('active');
    setRosterLoading(true);
    setRosterError('');
    try {
      const data = await apiRequest(`/faculty/classes/${course.id}/students`);
      setRosterData(data || { active_students: [], removed_students: [] });
    } catch (err) {
      setRosterError(err.message || 'Failed to load class students.');
    } finally {
      setRosterLoading(false);
    }
  }

  async function handleRemoveStudent() {
    if (!removeStudentTarget || !rosterModalCourse) return;
    if (!removeReason.trim()) {
      alert('A reason is required to remove a student.');
      return;
    }
    setRemoveSubmitting(true);
    try {
      await apiRequest(`/faculty/classes/${rosterModalCourse.id}/students/${removeStudentTarget.student_id}/remove`, {
        method: 'POST',
        body: JSON.stringify({ reason: removeReason.trim() }),
      });
      setRemoveStudentTarget(null);
      setRemoveReason('');
      const fresh = await apiRequest(`/faculty/classes/${rosterModalCourse.id}/students`);
      setRosterData(fresh);
      loadClasses();
    } catch (err) {
      alert(err.message || 'Failed to remove student.');
    } finally {
      setRemoveSubmitting(false);
    }
  }

  async function handleRestoreStudent(student) {
    if (!rosterModalCourse) return;
    if (!window.confirm(`Restore ${student.full_name || student.name} (${student.roll_no}) to ${rosterModalCourse.name}?`)) {
      return;
    }
    setRestoreSubmitting(true);
    try {
      await apiRequest(`/faculty/classes/${rosterModalCourse.id}/students/${student.student_id}/restore`, {
        method: 'POST',
      });
      const fresh = await apiRequest(`/faculty/classes/${rosterModalCourse.id}/students`);
      setRosterData(fresh);
      loadClasses();
    } catch (err) {
      alert(err.message || 'Failed to restore student.');
    } finally {
      setRestoreSubmitting(false);
    }
  }

  // ── Sessions & Attendance Corrections state (Phase 3) ───────────────────
  const [sessionsModalCourse, setSessionsModalCourse] = useState(null);
  const [courseSessions, setCourseSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState('');

  const [selectedSessionAttendance, setSelectedSessionAttendance] = useState(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState('');
  const [attendanceSearch, setAttendanceSearch] = useState('');
  const [attendanceFilter, setAttendanceFilter] = useState('all');

  const [correctionTarget, setCorrectionTarget] = useState(null);
  const [correctionStatus, setCorrectionStatus] = useState('present');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionError, setCorrectionError] = useState('');
  const [correctionSuccess, setCorrectionSuccess] = useState('');

  async function openSessionsModal(course) {
    setSessionsModalCourse(course);
    setSelectedSessionAttendance(null);
    setSessionsLoading(true);
    setSessionsError('');
    try {
      const data = await apiRequest(`/faculty/classes/${course.id}/sessions`);
      setCourseSessions(data || []);
    } catch (err) {
      setSessionsError(err.message || 'Failed to load class sessions.');
    } finally {
      setSessionsLoading(false);
    }
  }

  async function openSessionAttendance(sessionId) {
    setAttendanceLoading(true);
    setAttendanceError('');
    setAttendanceSearch('');
    setAttendanceFilter('all');
    try {
      const data = await apiRequest(`/faculty/sessions/${sessionId}/attendance`);
      setSelectedSessionAttendance(data);
    } catch (err) {
      setAttendanceError(err.message || 'Failed to load session attendance.');
    } finally {
      setAttendanceLoading(false);
    }
  }

  function openCorrectionModal(student) {
    setCorrectionTarget(student);
    setCorrectionStatus(student.status === 'present' ? 'absent' : 'present');
    setCorrectionReason('');
    setCorrectionError('');
    setCorrectionSuccess('');
  }

  async function handleConfirmCorrection(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!correctionTarget || !selectedSessionAttendance) return;
    const cleanReason = correctionReason.trim();
    if (cleanReason.length < 3) {
      setCorrectionError('Reason must be at least 3 characters long.');
      return;
    }
    setCorrectionSubmitting(true);
    setCorrectionError('');
    try {
      await apiRequest(`/faculty/sessions/${selectedSessionAttendance.session_id}/corrections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: correctionTarget.student_id,
          status: correctionStatus,
          reason: cleanReason,
        }),
      });

      setCorrectionSuccess(`Attendance successfully corrected to ${correctionStatus.toUpperCase()}!`);

      const freshAttendance = await apiRequest(`/faculty/sessions/${selectedSessionAttendance.session_id}/attendance`);
      setSelectedSessionAttendance(freshAttendance);

      if (sessionsModalCourse) {
        const freshSessions = await apiRequest(`/faculty/classes/${sessionsModalCourse.id}/sessions`);
        setCourseSessions(freshSessions || []);
      }

      setTimeout(() => {
        setCorrectionTarget(null);
        setCorrectionSuccess('');
      }, 700);
    } catch (err) {
      setCorrectionError(err.message || 'Failed to save correction.');
    } finally {
      setCorrectionSubmitting(false);
    }
  }

  // ── Attendance Export state (Phase 4) ───────────────────────────────────
  const [exportModalCourse, setExportModalCourse] = useState(null);
  const [exportFormat, setExportFormat] = useState('xlsx');
  const [exportFromDate, setExportFromDate] = useState('');
  const [exportToDate, setExportToDate] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState('');

  async function handleDownloadExport(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!exportModalCourse) return;
    setExportLoading(true);
    setExportError('');
    try {
      const token = sessionStorage.getItem('token');
      const params = new URLSearchParams();
      if (exportFromDate) params.append('from', exportFromDate);
      if (exportToDate) params.append('to', exportToDate);
      params.append('format', exportFormat);

      const response = await fetch(`/api/faculty/classes/${exportModalCourse.id}/export?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        let errMsg = 'Failed to export attendance.';
        try {
          const errData = await response.json();
          errMsg = errData.detail || errMsg;
        } catch {}
        throw new Error(errMsg);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const contentDisp = response.headers.get('content-disposition');
      let filename = `${exportModalCourse.code}_attendance.${exportFormat}`;
      if (contentDisp && contentDisp.includes('filename=')) {
        const match = contentDisp.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = match[1];
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setExportModalCourse(null);
    } catch (err) {
      setExportError(err.message || 'Failed to download export file.');
    } finally {
      setExportLoading(false);
    }
  }



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

            {sessionStorage.getItem('role') === 'admin' && (
              <button
                type="button"
                onClick={() => navigate('/admin')}
                style={{
                  padding: '10px 18px',
                  background: 'linear-gradient(135deg, #a855f7, #6366f1)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(168, 85, 247, 0.35)',
                }}
              >
                ⚙️ Admin Console
              </button>
            )}

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
                        onClick={() => openRosterModal(c)}
                        style={{
                          padding: '6px 12px',
                          background: 'rgba(103, 232, 249, 0.15)',
                          border: '1px solid rgba(103, 232, 249, 0.35)',
                          color: '#67e8f9',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        👥 Students ({c.student_count ?? 0})
                      </button>

                      <button
                        type="button"
                        onClick={() => openSessionsModal(c)}
                        style={{
                          padding: '6px 12px',
                          background: 'rgba(168, 85, 247, 0.15)',
                          border: '1px solid rgba(168, 85, 247, 0.35)',
                          color: '#c084fc',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        🕒 Sessions & Corrections
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setExportModalCourse(c);
                          setExportFormat('xlsx');
                          setExportFromDate('');
                          setExportToDate('');
                          setExportError('');
                        }}
                        style={{
                          padding: '6px 12px',
                          background: 'rgba(16, 185, 129, 0.15)',
                          border: '1px solid rgba(16, 185, 129, 0.35)',
                          color: '#34d399',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        📊 Export
                      </button>

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

        {/* ── Modal: Class Students Roster ──────────────────────────────── */}
        {rosterModalCourse && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.75)',
              backdropFilter: 'blur(5px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
              padding: '20px',
            }}
          >
            <div
              style={{
                background: '#0f172a',
                border: '1px solid rgba(103, 232, 249, 0.3)',
                borderRadius: '16px',
                padding: '26px',
                maxWidth: '850px',
                width: '100%',
                maxHeight: '85vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.7)',
                color: '#ffffff',
              }}
            >
              {/* Modal Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '20px', color: '#67e8f9' }}>
                    👥 Students in {rosterModalCourse.name} ({rosterModalCourse.code})
                  </h3>
                  <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '13px' }}>
                    Manage active students or view and restore previously removed students
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setRosterModalCourse(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    fontSize: '20px',
                    cursor: 'pointer',
                    padding: '4px 8px',
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Roster Tabs */}
              <div style={{ display: 'flex', gap: '10px', marginBottom: '18px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '12px' }}>
                <button
                  type="button"
                  onClick={() => setRosterTab('active')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: rosterTab === 'active' ? 'linear-gradient(135deg, #0284c7, #2563eb)' : 'rgba(255, 255, 255, 0.05)',
                    color: rosterTab === 'active' ? '#ffffff' : '#94a3b8',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Active Students ({rosterData.active_students?.length || 0})
                </button>
                <button
                  type="button"
                  onClick={() => setRosterTab('removed')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: rosterTab === 'removed' ? 'linear-gradient(135deg, #e11d48, #be123c)' : 'rgba(255, 255, 255, 0.05)',
                    color: rosterTab === 'removed' ? '#ffffff' : '#94a3b8',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Removed Students ({rosterData.removed_students?.length || 0})
                </button>
              </div>

              {rosterError && (
                <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', marginBottom: '14px', fontSize: '13px' }}>
                  {rosterError}
                </div>
              )}

              {/* Tab Content */}
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {rosterLoading ? (
                  <p style={{ textAlign: 'center', color: '#94a3b8', padding: '30px' }}>Loading student roster...</p>
                ) : rosterTab === 'active' ? (
                  rosterData.active_students && rosterData.active_students.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ color: '#67e8f9', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <th style={{ padding: '10px' }}>Full Name</th>
                          <th style={{ padding: '10px' }}>Roll Number</th>
                          <th style={{ padding: '10px' }}>Email</th>
                          <th style={{ padding: '10px' }}>Enrolled Date</th>
                          <th style={{ padding: '10px', textAlign: 'right' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rosterData.active_students.map((st) => (
                          <tr key={st.enrollment_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <td style={{ padding: '12px 10px', fontWeight: 600 }}>{st.full_name || st.name}</td>
                            <td style={{ padding: '12px 10px', color: '#cbd5e1' }}>
                              <span style={{ background: 'rgba(6, 182, 212, 0.15)', color: '#67e8f9', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                                {st.roll_no}
                              </span>
                            </td>
                            <td style={{ padding: '12px 10px', color: '#94a3b8' }}>{st.email}</td>
                            <td style={{ padding: '12px 10px', color: '#94a3b8' }}>{new Date(st.enrolled_at).toLocaleDateString()}</td>
                            <td style={{ padding: '12px 10px', textAlign: 'right' }}>
                              <button
                                type="button"
                                onClick={() => {
                                  setRemoveStudentTarget(st);
                                  setRemoveReason('');
                                }}
                                style={{
                                  padding: '5px 12px',
                                  borderRadius: '6px',
                                  border: '1px solid rgba(239, 68, 68, 0.4)',
                                  background: 'rgba(239, 68, 68, 0.12)',
                                  color: '#f87171',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                ✕ Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ textAlign: 'center', color: '#94a3b8', padding: '40px 0' }}>
                      No active students are currently enrolled in this class.
                    </p>
                  )
                ) : (
                  rosterData.removed_students && rosterData.removed_students.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ color: '#fb7185', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <th style={{ padding: '10px' }}>Full Name</th>
                          <th style={{ padding: '10px' }}>Roll Number</th>
                          <th style={{ padding: '10px' }}>Removal Reason</th>
                          <th style={{ padding: '10px' }}>Removed Date</th>
                          <th style={{ padding: '10px', textAlign: 'right' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rosterData.removed_students.map((st) => (
                          <tr key={st.enrollment_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <td style={{ padding: '12px 10px', fontWeight: 600 }}>{st.full_name || st.name}</td>
                            <td style={{ padding: '12px 10px', color: '#cbd5e1' }}>{st.roll_no}</td>
                            <td style={{ padding: '12px 10px', color: '#fca5a5', maxWidth: '200px' }}>
                              {st.reason || (st.ended_by === 'student' ? 'Student left class' : 'Removed by faculty')}
                            </td>
                            <td style={{ padding: '12px 10px', color: '#94a3b8' }}>
                              {st.left_at ? new Date(st.left_at).toLocaleDateString() : 'N/A'}
                            </td>
                            <td style={{ padding: '12px 10px', textAlign: 'right' }}>
                              <button
                                type="button"
                                disabled={restoreSubmitting}
                                onClick={() => handleRestoreStudent(st)}
                                style={{
                                  padding: '5px 12px',
                                  borderRadius: '6px',
                                  border: '1px solid rgba(74, 222, 128, 0.4)',
                                  background: 'rgba(74, 222, 128, 0.12)',
                                  color: '#4ade80',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  cursor: restoreSubmitting ? 'not-allowed' : 'pointer',
                                }}
                              >
                                ⟲ Restore to Class
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ textAlign: 'center', color: '#94a3b8', padding: '40px 0' }}>
                      No students have been removed from this class.
                    </p>
                  )
                )}
              </div>

              {/* Modal Footer */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '18px', borderTop: '1px solid rgba(255, 255, 255, 0.1)', paddingTop: '14px' }}>
                <button
                  type="button"
                  onClick={() => setRosterModalCourse(null)}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    background: 'transparent',
                    color: '#cbd5e1',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Sub-Modal: Remove Student Confirmation & Reason ──────────────── */}
        {removeStudentTarget && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.8)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1100,
              padding: '20px',
            }}
          >
            <div
              style={{
                background: '#161b33',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: '16px',
                padding: '26px',
                maxWidth: '460px',
                width: '100%',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.7)',
                color: '#ffffff',
              }}
            >
              <h3 style={{ margin: '0 0 10px', color: '#f87171', fontSize: '18px' }}>
                ⚠️ Remove Student from Class
              </h3>
              <p style={{ color: '#e2e8f0', fontSize: '13px', lineHeight: '1.5', margin: '0 0 12px' }}>
                Remove <strong>{removeStudentTarget.full_name || removeStudentTarget.name}</strong> ({removeStudentTarget.roll_no}) from <strong>{rosterModalCourse?.name}</strong>?
              </p>
              <p style={{ color: '#fca5a5', fontSize: '12px', margin: '0 0 16px', background: 'rgba(239, 68, 68, 0.12)', padding: '8px 12px', borderRadius: '8px' }}>
                🔒 The removed student will <strong>not</strong> be able to rejoin this class using the join code.
              </p>

              <div style={{ marginBottom: '18px' }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#cbd5e1', marginBottom: '6px' }}>
                  Reason for Removal <span style={{ color: '#fb7185' }}>*</span>:
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="e.g. Dropped course, moved section, attendance debarment"
                  value={removeReason}
                  onChange={(e) => setRemoveReason(e.target.value)}
                  style={{
                    ...inputStyle,
                    width: '100%',
                    resize: 'none',
                    boxSizing: 'border-box',
                    marginBottom: 0,
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  disabled={removeSubmitting}
                  onClick={() => {
                    setRemoveStudentTarget(null);
                    setRemoveReason('');
                  }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    background: 'transparent',
                    color: '#cbd5e1',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={removeSubmitting || !removeReason.trim()}
                  onClick={handleRemoveStudent}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #e11d48, #be123c)',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: removeSubmitting || !removeReason.trim() ? 'not-allowed' : 'pointer',
                    opacity: removeSubmitting || !removeReason.trim() ? 0.6 : 1,
                  }}
                >
                  {removeSubmitting ? 'Removing...' : 'Confirm Removal'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal: Class Sessions & Attendance History (Phase 3) ──────── */}
        {sessionsModalCourse && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.75)',
              backdropFilter: 'blur(5px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
              padding: '20px',
            }}
          >
            <div
              style={{
                background: '#0f172a',
                border: '1px solid rgba(168, 85, 247, 0.35)',
                borderRadius: '16px',
                padding: '24px',
                maxWidth: '960px',
                width: '100%',
                maxHeight: '88vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.7)',
                color: '#ffffff',
              }}
            >
              {/* Modal Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>🕒</span>
                    <h3 style={{ margin: 0, fontSize: '19px', color: '#c084fc', fontWeight: 700 }}>
                      {selectedSessionAttendance
                        ? `Session #${selectedSessionAttendance.session_id} Attendance Roster`
                        : `Class Sessions — ${sessionsModalCourse.name} (${sessionsModalCourse.code})`}
                    </h3>
                  </div>
                  <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '13px' }}>
                    {selectedSessionAttendance
                      ? `Conducted on ${new Date(selectedSessionAttendance.started_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} • Unified effective attendance`
                      : 'View previous lecture sessions, check unified attendance turnout, and correct attendance.'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setExportModalCourse(sessionsModalCourse);
                      setExportFormat('xlsx');
                      setExportFromDate('');
                      setExportToDate('');
                      setExportError('');
                    }}
                    style={{
                      padding: '5px 12px',
                      background: 'rgba(16, 185, 129, 0.2)',
                      border: '1px solid rgba(16, 185, 129, 0.4)',
                      color: '#6ee7b7',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span>📊</span> Export Report
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSessionsModalCourse(null);
                      setSelectedSessionAttendance(null);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      fontSize: '20px',
                      cursor: 'pointer',
                      padding: '4px 8px',
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Sub-header / Back Navigation when inspecting a session */}
              {selectedSessionAttendance ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    <button
                      type="button"
                      onClick={() => setSelectedSessionAttendance(null)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid rgba(148, 163, 184, 0.3)',
                        background: 'rgba(30, 41, 59, 0.6)',
                        color: '#cbd5e1',
                        fontSize: '12px',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      ← Back to Sessions List
                    </button>

                    {/* Stat Badges */}
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600, background: 'rgba(16, 185, 129, 0.15)', color: '#6ee7b7', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                        ✓ Present: {selectedSessionAttendance.present_count}
                      </span>
                      <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600, background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                        ✗ Absent: {selectedSessionAttendance.absent_count}
                      </span>
                      <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600, background: 'rgba(103, 232, 249, 0.15)', color: '#67e8f9', border: '1px solid rgba(103, 232, 249, 0.3)' }}>
                        👥 Total: {selectedSessionAttendance.total_students}
                      </span>
                      <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700, background: 'rgba(168, 85, 247, 0.2)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.4)' }}>
                        Turnout: {selectedSessionAttendance.total_students > 0 ? Math.round((selectedSessionAttendance.present_count / selectedSessionAttendance.total_students) * 100) : 0}%
                      </span>
                    </div>
                  </div>

                  {/* Filter & Search Bar */}
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      placeholder="Search by student name or roll no..."
                      value={attendanceSearch}
                      onChange={(e) => setAttendanceSearch(e.target.value)}
                      style={{
                        flex: 1,
                        minWidth: '220px',
                        padding: '8px 12px',
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '1px solid rgba(148, 163, 184, 0.3)',
                        borderRadius: '6px',
                        color: '#f8fafc',
                        fontSize: '13px',
                        outline: 'none',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {['all', 'present', 'absent'].map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setAttendanceFilter(f)}
                          style={{
                            padding: '6px 12px',
                            fontSize: '12px',
                            fontWeight: 600,
                            borderRadius: '6px',
                            border: attendanceFilter === f ? '1px solid #c084fc' : '1px solid rgba(148, 163, 184, 0.2)',
                            background: attendanceFilter === f ? 'rgba(168, 85, 247, 0.25)' : 'rgba(30, 41, 59, 0.4)',
                            color: attendanceFilter === f ? '#f3e8ff' : '#94a3b8',
                            cursor: 'pointer',
                            textTransform: 'capitalize',
                          }}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Student Unified Attendance Table */}
                  <div style={{ flex: 1, overflowY: 'auto', border: '1px solid rgba(148, 163, 184, 0.15)', borderRadius: '8px', background: 'rgba(15, 23, 42, 0.4)' }}>
                    {attendanceLoading ? (
                      <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8' }}>Loading session roster...</div>
                    ) : (
                      (() => {
                        const filtered = (selectedSessionAttendance.students || []).filter((s) => {
                          const matchesFilter =
                            attendanceFilter === 'all' || s.status.toLowerCase() === attendanceFilter;
                          const q = attendanceSearch.toLowerCase().trim();
                          const matchesSearch =
                            !q ||
                            (s.name && s.name.toLowerCase().includes(q)) ||
                            (s.roll_no && s.roll_no.toLowerCase().includes(q));
                          return matchesFilter && matchesSearch;
                        });

                        if (filtered.length === 0) {
                          return (
                            <div style={{ padding: '36px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>
                              No students match the current filter.
                            </div>
                          );
                        }

                        return (
                          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.2)', background: 'rgba(30, 41, 59, 0.6)', color: '#94a3b8' }}>
                                <th style={{ padding: '10px 14px' }}>Roll No</th>
                                <th style={{ padding: '10px 14px' }}>Student Name</th>
                                <th style={{ padding: '10px 14px' }}>Effective Status</th>
                                <th style={{ padding: '10px 14px' }}>Source</th>
                                <th style={{ padding: '10px 14px' }}>Reason / Audit Note</th>
                                <th style={{ padding: '10px 14px', textAlign: 'right' }}>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filtered.map((st) => {
                                const isPresent = st.status === 'present';
                                return (
                                  <tr key={st.student_id} style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                                    <td style={{ padding: '10px 14px', fontWeight: 600, color: '#f8fafc' }}>
                                      {st.roll_no}
                                    </td>
                                    <td style={{ padding: '10px 14px', color: '#e2e8f0' }}>
                                      {st.full_name || st.name}
                                    </td>
                                    <td style={{ padding: '10px 14px' }}>
                                      <span
                                        style={{
                                          padding: '3px 8px',
                                          borderRadius: '6px',
                                          fontSize: '11px',
                                          fontWeight: 700,
                                          textTransform: 'uppercase',
                                          background: isPresent ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                          color: isPresent ? '#6ee7b7' : '#fca5a5',
                                          border: isPresent ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)',
                                        }}
                                      >
                                        {isPresent ? '✓ Present' : '✗ Absent'}
                                      </span>
                                    </td>
                                    <td style={{ padding: '10px 14px' }}>
                                      <span
                                        style={{
                                          fontSize: '11px',
                                          color: st.source === 'correction' ? '#c084fc' : st.source === 'override' ? '#f59e0b' : '#38bdf8',
                                        }}
                                      >
                                        {st.source === 'correction'
                                          ? '✏️ Correction'
                                          : st.source === 'override'
                                          ? '📋 Override'
                                          : st.source === 'scan'
                                          ? '📱 QR Scan'
                                          : '—'}
                                      </span>
                                    </td>
                                    <td style={{ padding: '10px 14px', color: '#94a3b8', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={st.reason || ''}>
                                      {st.reason || '—'}
                                    </td>
                                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                                      <button
                                        type="button"
                                        onClick={() => openCorrectionModal(st)}
                                        style={{
                                          padding: '4px 10px',
                                          fontSize: '11px',
                                          fontWeight: 600,
                                          borderRadius: '5px',
                                          border: '1px solid rgba(192, 132, 252, 0.4)',
                                          background: 'rgba(168, 85, 247, 0.15)',
                                          color: '#c084fc',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        ✏️ Correct
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        );
                      })()
                    )}
                  </div>
                </div>
              ) : (
                /* Session List View */
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {sessionsLoading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>Loading sessions...</div>
                  ) : sessionsError ? (
                    <div style={{ padding: '16px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '8px', color: '#fca5a5', fontSize: '13px' }}>
                      {sessionsError}
                    </div>
                  ) : courseSessions.length === 0 ? (
                    <div style={{ padding: '50px 20px', textAlign: 'center', color: '#64748b' }}>
                      <div style={{ fontSize: '36px', marginBottom: '10px' }}>⏳</div>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0' }}>No sessions found</div>
                      <div style={{ fontSize: '13px', marginTop: '4px' }}>
                        No attendance sessions have been conducted for this class yet. Start a session from the dashboard.
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {courseSessions.map((s) => {
                        const started = new Date(s.started_at);
                        const ended = s.ended_at ? new Date(s.ended_at) : null;
                        const turnoutPct = s.total_students > 0 ? Math.round((s.present_count / s.total_students) * 100) : 0;
                        const isActive = s.status === 'active';

                        return (
                          <div
                            key={s.id}
                            style={{
                              background: 'rgba(30, 41, 59, 0.5)',
                              border: isActive ? '1px solid rgba(74, 222, 128, 0.4)' : '1px solid rgba(148, 163, 184, 0.2)',
                              borderRadius: '10px',
                              padding: '16px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: '12px',
                            }}
                          >
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc' }}>
                                  Session #{s.id}
                                </span>
                                <span
                                  style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: '12px',
                                    background: isActive ? 'rgba(74, 222, 128, 0.2)' : 'rgba(148, 163, 184, 0.2)',
                                    color: isActive ? '#4ade80' : '#94a3b8',
                                    border: isActive ? '1px solid rgba(74, 222, 128, 0.4)' : '1px solid rgba(148, 163, 184, 0.3)',
                                  }}
                                >
                                  {isActive ? '● Live Active' : 'Finished'}
                                </span>
                              </div>
                              <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
                                {started.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })} at{' '}
                                {started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                {ended ? ` → ${ended.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '14px', fontWeight: 700, color: '#67e8f9' }}>
                                  {s.present_count} / {s.total_students} Present
                                </div>
                                <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                                  {turnoutPct}% turnout
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => openSessionAttendance(s.id)}
                                style={{
                                  padding: '8px 16px',
                                  background: 'linear-gradient(135deg, #a855f7, #7e22ce)',
                                  color: '#ffffff',
                                  border: 'none',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  boxShadow: '0 2px 8px rgba(168, 85, 247, 0.3)',
                                }}
                              >
                                👁️ View & Correct Attendance →
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Modal: Correct Attendance (Phase 3) ────────────────────────── */}
        {correctionTarget && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.8)',
              backdropFilter: 'blur(5px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1100,
              padding: '20px',
            }}
          >
            <div
              style={{
                background: '#0f172a',
                border: '1px solid rgba(192, 132, 252, 0.4)',
                borderRadius: '16px',
                padding: '24px',
                maxWidth: '520px',
                width: '100%',
                boxShadow: '0 25px 50px rgba(0, 0, 0, 0.8)',
                color: '#ffffff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <span style={{ fontSize: '24px' }}>✏️</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', color: '#c084fc', fontWeight: 700 }}>
                    Correct Attendance
                  </h3>
                  <p style={{ margin: '2px 0 0', color: '#94a3b8', fontSize: '13px' }}>
                    Student: <strong style={{ color: '#f8fafc' }}>{correctionTarget.full_name || correctionTarget.name}</strong> ({correctionTarget.roll_no})
                  </p>
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.5)',
                  padding: '12px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(148, 163, 184, 0.15)',
                  fontSize: '12px',
                  color: '#94a3b8',
                  marginBottom: '16px',
                }}
              >
                Current effective status: <strong style={{ color: correctionTarget.status === 'present' ? '#6ee7b7' : '#fca5a5' }}>{correctionTarget.status.toUpperCase()}</strong>
                {correctionTarget.reason && ` (Note: ${correctionTarget.reason})`}
              </div>

              {correctionError && (
                <div style={{ marginBottom: '14px', padding: '10px 14px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '6px', color: '#fca5a5', fontSize: '12px' }}>
                  {correctionError}
                </div>
              )}

              {correctionSuccess && (
                <div style={{ marginBottom: '14px', padding: '10px 14px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10b981', borderRadius: '6px', color: '#6ee7b7', fontSize: '12px' }}>
                  {correctionSuccess}
                </div>
              )}

              <form onSubmit={handleConfirmCorrection}>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginBottom: '8px' }}>
                    New Attendance Status:
                  </label>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      type="button"
                      onClick={() => setCorrectionStatus('present')}
                      style={{
                        flex: 1,
                        padding: '10px',
                        borderRadius: '8px',
                        border: correctionStatus === 'present' ? '2px solid #10b981' : '1px solid rgba(148, 163, 184, 0.3)',
                        background: correctionStatus === 'present' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(30, 41, 59, 0.5)',
                        color: correctionStatus === 'present' ? '#6ee7b7' : '#94a3b8',
                        fontWeight: 700,
                        fontSize: '13px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      ✓ Mark Present
                    </button>
                    <button
                      type="button"
                      onClick={() => setCorrectionStatus('absent')}
                      style={{
                        flex: 1,
                        padding: '10px',
                        borderRadius: '8px',
                        border: correctionStatus === 'absent' ? '2px solid #ef4444' : '1px solid rgba(148, 163, 184, 0.3)',
                        background: correctionStatus === 'absent' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(30, 41, 59, 0.5)',
                        color: correctionStatus === 'absent' ? '#fca5a5' : '#94a3b8',
                        fontWeight: 700,
                        fontSize: '13px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      ✗ Mark Absent
                    </button>
                  </div>
                </div>

                <div style={{ marginBottom: '18px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginBottom: '6px' }}>
                    Reason for Correction <span style={{ color: '#f87171' }}>*</span>
                  </label>
                  <textarea
                    rows={3}
                    placeholder="e.g. Valid medical leave approved, official hackathon duty certificate, or student left room early"
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(148, 163, 184, 0.3)',
                      borderRadius: '8px',
                      color: '#ffffff',
                      fontSize: '13px',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                    Minimum 3 characters required. Stored in append-only audit trail.
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    type="button"
                    disabled={correctionSubmitting}
                    onClick={() => {
                      setCorrectionTarget(null);
                      setCorrectionError('');
                      setCorrectionSuccess('');
                    }}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      background: 'transparent',
                      color: '#cbd5e1',
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={correctionSubmitting || correctionReason.trim().length < 3}
                    style={{
                      padding: '8px 18px',
                      borderRadius: '8px',
                      border: 'none',
                      background: 'linear-gradient(135deg, #a855f7, #7e22ce)',
                      color: '#ffffff',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: correctionSubmitting || correctionReason.trim().length < 3 ? 'not-allowed' : 'pointer',
                      opacity: correctionSubmitting || correctionReason.trim().length < 3 ? 0.6 : 1,
                      boxShadow: '0 2px 10px rgba(168, 85, 247, 0.4)',
                    }}
                  >
                    {correctionSubmitting ? 'Saving...' : 'Save Correction'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Modal: Export Attendance (Phase 4) ────────────────────────── */}
        {exportModalCourse && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.8)',
              backdropFilter: 'blur(5px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1200,
              padding: '20px',
            }}
          >
            <div
              style={{
                background: '#0f172a',
                border: '1px solid rgba(52, 211, 153, 0.4)',
                borderRadius: '16px',
                padding: '24px',
                maxWidth: '540px',
                width: '100%',
                boxShadow: '0 25px 50px rgba(0, 0, 0, 0.8)',
                color: '#ffffff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '24px' }}>📊</span>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '18px', color: '#6ee7b7', fontWeight: 700 }}>
                      Export Attendance Report
                    </h3>
                    <p style={{ margin: '2px 0 0', color: '#94a3b8', fontSize: '13px' }}>
                      {exportModalCourse.name} ({exportModalCourse.code})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setExportModalCourse(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    fontSize: '20px',
                    cursor: 'pointer',
                    padding: '2px 6px',
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Layout Info Box */}
              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.5)',
                  padding: '12px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(148, 163, 184, 0.15)',
                  fontSize: '12px',
                  color: '#94a3b8',
                  lineHeight: '1.5',
                  marginBottom: '16px',
                }}
              >
                <strong style={{ color: '#f8fafc' }}>Fixed Layout:</strong> Serial No, Roll No, Name, chronological session columns (1 for Present, 0 for Absent, formatted in Asia/Kolkata timezone), Total Present, Total Sessions, Attendance %. Formula injection safe.
              </div>

              {exportError && (
                <div style={{ marginBottom: '14px', padding: '10px 14px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '6px', color: '#fca5a5', fontSize: '12px' }}>
                  {exportError}
                </div>
              )}

              <form onSubmit={handleDownloadExport}>
                {/* Format selection */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginBottom: '8px' }}>
                    Choose Export Format:
                  </label>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      type="button"
                      onClick={() => setExportFormat('xlsx')}
                      style={{
                        flex: 1,
                        padding: '12px',
                        borderRadius: '8px',
                        border: exportFormat === 'xlsx' ? '2px solid #10b981' : '1px solid rgba(148, 163, 184, 0.3)',
                        background: exportFormat === 'xlsx' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(30, 41, 59, 0.4)',
                        color: exportFormat === 'xlsx' ? '#6ee7b7' : '#94a3b8',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ fontSize: '14px', fontWeight: 700 }}>Excel Spreadsheet (.xlsx)</div>
                      <div style={{ fontSize: '11px', marginTop: '2px', opacity: 0.85 }}>Styled headers & auto-fit columns (Recommended)</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setExportFormat('csv')}
                      style={{
                        flex: 1,
                        padding: '12px',
                        borderRadius: '8px',
                        border: exportFormat === 'csv' ? '2px solid #10b981' : '1px solid rgba(148, 163, 184, 0.3)',
                        background: exportFormat === 'csv' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(30, 41, 59, 0.4)',
                        color: exportFormat === 'csv' ? '#6ee7b7' : '#94a3b8',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ fontSize: '14px', fontWeight: 700 }}>CSV Format (.csv)</div>
                      <div style={{ fontSize: '11px', marginTop: '2px', opacity: 0.85 }}>Standard comma-separated text file</div>
                    </button>
                  </div>
                </div>

                {/* Optional Date Range */}
                <div style={{ marginBottom: '18px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginBottom: '8px' }}>
                    Date Filter (Optional):
                  </label>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>From Date</span>
                      <input
                        type="date"
                        value={exportFromDate}
                        onChange={(e) => setExportFromDate(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          background: 'rgba(15, 23, 42, 0.8)',
                          border: '1px solid rgba(148, 163, 184, 0.3)',
                          borderRadius: '6px',
                          color: '#ffffff',
                          fontSize: '13px',
                          boxSizing: 'border-box',
                          outline: 'none',
                        }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>To Date</span>
                      <input
                        type="date"
                        value={exportToDate}
                        onChange={(e) => setExportToDate(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          background: 'rgba(15, 23, 42, 0.8)',
                          border: '1px solid rgba(148, 163, 184, 0.3)',
                          borderRadius: '6px',
                          color: '#ffffff',
                          fontSize: '13px',
                          boxSizing: 'border-box',
                          outline: 'none',
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                    Leave dates blank to export all sessions ever conducted for this course.
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '10px', borderTop: '1px solid rgba(148, 163, 184, 0.15)' }}>
                  <button
                    type="button"
                    disabled={exportLoading}
                    onClick={() => setExportModalCourse(null)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      background: 'transparent',
                      color: '#cbd5e1',
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={exportLoading}
                    style={{
                      padding: '8px 20px',
                      borderRadius: '8px',
                      border: 'none',
                      background: 'linear-gradient(135deg, #10b981, #059669)',
                      color: '#ffffff',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: exportLoading ? 'not-allowed' : 'pointer',
                      opacity: exportLoading ? 0.7 : 1,
                      boxShadow: '0 2px 10px rgba(16, 185, 129, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    {exportLoading ? 'Exporting...' : `⬇️ Download .${exportFormat.toUpperCase()}`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default FacultyDashboard;
