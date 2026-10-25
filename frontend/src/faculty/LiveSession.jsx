import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { apiRequest } from '../api/client.js';

export default function LiveSession() {
  const { id: sessionId } = useParams();
  const navigate = useNavigate();

  // Session & live data state
  const [sessionData, setSessionData] = useState(null); // LiveAttendanceResponse
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isEnded, setIsEnded] = useState(false);

  // QR rotating token state
  const [qrToken, setQrToken] = useState(null); // { session_id, window, mac, expires_in_ms }
  const [countdown, setCountdown] = useState(30);
  const [windowDuration, setWindowDuration] = useState(30);
  const [qrError, setQrError] = useState('');

  // UI view controls
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hideNames, setHideNames] = useState(false); // Projector privacy mode
  const [activeTab, setActiveTab] = useState('qr'); // 'qr' or 'list' (on mobile) or side-by-side
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [endingSession, setEndingSession] = useState(false);

  // Manual marking drawer / modal state
  const [showManualModal, setShowManualModal] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [overrideReason, setOverrideReason] = useState('medical');
  const [overrideNote, setOverrideNote] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [submittingOverride, setSubmittingOverride] = useState(false);
  const [overrideConfirmOpen, setOverrideConfirmOpen] = useState(false);
  const [overrideSummary, setOverrideSummary] = useState(null); // { marked_count, already_marked_count }
  const [overrideError, setOverrideError] = useState('');

  const qrPollTimeoutRef = useRef(null);
  const livePollIntervalRef = useRef(null);
  const countdownIntervalRef = useRef(null);

  // ── Initial load & live polling ──────────────────────────────────────────

  useEffect(() => {
    let isMounted = true;

    async function initSession() {
      setLoading(true);
      setError('');
      try {
        const liveData = await apiRequest(`/sessions/${sessionId}/live`);
        if (!isMounted) return;
        setSessionData(liveData);

        if (liveData.session_status === 'ended' || liveData.status === 'ended') {
          setIsEnded(true);
        } else {
          // Fetch initial QR token
          await fetchQR();
        }
      } catch (err) {
        if (!isMounted) return;
        setError(err.message || 'Unable to load live session. It may not exist or belong to another faculty.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    initSession();

    // Poll live attendance list every 2.5 seconds
    livePollIntervalRef.current = setInterval(async () => {
      try {
        const liveData = await apiRequest(`/sessions/${sessionId}/live`);
        if (!isMounted) return;
        setSessionData(liveData);
        if (liveData.session_status === 'ended' || liveData.status === 'ended') {
          setIsEnded(true);
          clearTimeout(qrPollTimeoutRef.current);
        }
      } catch {
        // Silently ignore transient polling errors
      }
    }, 2500);

    return () => {
      isMounted = false;
      clearInterval(livePollIntervalRef.current);
      clearTimeout(qrPollTimeoutRef.current);
      clearInterval(countdownIntervalRef.current);
    };
  }, [sessionId]);

  // ── Rotating QR Fetcher ──────────────────────────────────────────────────

  async function fetchQR() {
    clearTimeout(qrPollTimeoutRef.current);
    try {
      const tokenData = await apiRequest(`/sessions/${sessionId}/qr`);
      setQrToken(tokenData);
      setQrError('');

      const ttlSec = Math.max(1, Math.round((tokenData.expires_in_ms || 30000) / 1000));
      setWindowDuration(ttlSec);
      setCountdown(ttlSec);

      // Schedule next token refresh right before expiration
      const delay = Math.max(1000, (tokenData.expires_in_ms || 30000) - 400);
      qrPollTimeoutRef.current = setTimeout(() => {
        fetchQR();
      }, delay);
    } catch (err) {
      if (err.message && err.message.includes('session_ended')) {
        setIsEnded(true);
      } else {
        setQrError('Retrying QR rotation...');
        qrPollTimeoutRef.current = setTimeout(() => {
          fetchQR();
        }, 2000);
      }
    }
  }

  // ── Countdown Tick ───────────────────────────────────────────────────────

  useEffect(() => {
    if (isEnded) return;

    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => (prev > 1 ? prev - 1 : 1));
    }, 1000);

    return () => clearInterval(countdownIntervalRef.current);
  }, [isEnded]);

  // ── Fullscreen Toggle ────────────────────────────────────────────────────

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      setIsFullscreen(false);
    }
  }

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // ── End Session ──────────────────────────────────────────────────────────

  async function handleEndSession() {
    setEndingSession(true);
    try {
      await apiRequest(`/sessions/${sessionId}/end`, { method: 'POST' });
      setIsEnded(true);
      setShowEndConfirm(false);
      clearTimeout(qrPollTimeoutRef.current);
      // Refresh live data once
      const liveData = await apiRequest(`/sessions/${sessionId}/live`);
      setSessionData(liveData);
    } catch (err) {
      alert(err.message || 'Failed to end session');
    } finally {
      setEndingSession(false);
    }
  }

  // ── Manual Marking Handlers ──────────────────────────────────────────────

  const notMarkedStudents = sessionData?.not_marked || [];
  const filteredNotMarked = notMarkedStudents.filter((st) => {
    const q = searchTerm.toLowerCase();
    return st.name.toLowerCase().includes(q) || st.roll_no.toLowerCase().includes(q);
  });

  function toggleSelectAll() {
    if (selectedStudentIds.length === filteredNotMarked.length) {
      setSelectedStudentIds([]);
    } else {
      setSelectedStudentIds(filteredNotMarked.map((s) => s.student_id));
    }
  }

  function toggleStudentSelection(id) {
    setSelectedStudentIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  async function executeManualOverride() {
    if (selectedStudentIds.length === 0) return;
    if (overrideReason === 'other' && !overrideNote.trim()) {
      setOverrideError('A specific note is strictly required when selecting "Other".');
      return;
    }

    setSubmittingOverride(true);
    setOverrideError('');

    try {
      const payload = {
        student_ids: selectedStudentIds,
        reason: overrideReason,
        note: overrideNote.trim() || undefined,
      };

      const result = await apiRequest(`/sessions/${sessionId}/override`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setOverrideSummary({
        marked_count: result.marked_count ?? result.marked?.length ?? selectedStudentIds.length,
        already_marked_count: result.already_marked_count ?? result.already_marked?.length ?? 0,
      });

      // Clear selection and close confirmation
      setSelectedStudentIds([]);
      setOverrideNote('');
      setOverrideConfirmOpen(false);

      // Refresh live attendance
      const updatedLiveData = await apiRequest(`/sessions/${sessionId}/live`);
      setSessionData(updatedLiveData);
    } catch (err) {
      setOverrideError(err.message || 'Failed to apply manual override.');
    } finally {
      setSubmittingOverride(false);
    }
  }

  // Helper formatting for names under "Hide Names" privacy mode
  function formatStudentName(name, rollNo) {
    if (hideNames) {
      return `Student (${rollNo})`;
    }
    return name;
  }

  // ── Render States ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={spinnerStyle}></div>
            <h2 style={{ fontSize: '20px', fontWeight: 600, marginTop: '20px' }}>
              Connecting to Live Session...
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '6px' }}>
              Loading security payload and enrolled class roster
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, maxWidth: '600px', margin: '60px auto', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#f87171', marginBottom: '10px' }}>
            Live Session Unavailable
          </h2>
          <p style={{ color: '#cbd5e1', fontSize: '15px', lineHeight: '1.6', marginBottom: '24px' }}>
            {error}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
            <button
              onClick={() => navigate('/faculty')}
              style={{
                ...buttonStyle,
                background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
              }}
            >
              ← Back to Faculty Dashboard
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                ...buttonStyle,
                background: 'rgba(51, 65, 85, 0.8)',
              }}
            >
              🔄 Retry Connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  const markedCount = sessionData?.marked_count || 0;
  const totalInClass = sessionData?.total_in_class || 0;
  const percentage = totalInClass > 0 ? Math.round((markedCount / totalInClass) * 100) : 0;
  const markedList = sessionData?.marked || [];

  return (
    <div style={containerStyle}>
      {/* ── Top Header Navigation & Controls ── */}
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <Link
            to="/faculty"
            style={{
              color: '#94a3b8',
              textDecoration: 'none',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(30, 41, 59, 0.7)',
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid rgba(148, 163, 184, 0.2)',
            }}
          >
            ← Dashboard
          </Link>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0, color: '#ffffff' }}>
                {sessionData?.class_name || 'Class Attendance'}
              </h1>
              {isEnded ? (
                <span style={badgeEndedStyle}>SESSION ENDED</span>
              ) : (
                <span style={badgeLiveStyle}>
                  <span style={pulseDotStyle}></span>
                  LIVE SCANNING
                </span>
              )}
            </div>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '2px' }}>
              Session #{sessionId} • ZeroProxy Dynamic Token Window
            </div>
          </div>
        </div>

        {/* Quick Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Hide Names Toggle */}
          <button
            onClick={() => setHideNames(!hideNames)}
            title="Privacy view for projector display — masks student names to roll numbers"
            style={{
              ...buttonStyle,
              background: hideNames ? 'rgba(56, 189, 248, 0.2)' : 'rgba(30, 41, 59, 0.8)',
              border: hideNames ? '1px solid #38bdf8' : '1px solid rgba(148, 163, 184, 0.2)',
              color: hideNames ? '#38bdf8' : '#e2e8f0',
            }}
          >
            {hideNames ? '🔒 Names Hidden (Projector Mode)' : '👁️ Hide Names (Privacy)'}
          </button>

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            style={{
              ...buttonStyle,
              background: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid rgba(148, 163, 184, 0.2)',
            }}
          >
            {isFullscreen ? '⤓ Exit Fullscreen' : '⛶ Fullscreen'}
          </button>

          {/* Manual Attendance Drawer Trigger */}
          <button
            onClick={() => {
              setShowManualModal(true);
              setOverrideError('');
            }}
            style={{
              ...buttonStyle,
              background: 'linear-gradient(135deg, #d97706, #b45309)',
              border: '1px solid #f59e0b',
              fontWeight: 600,
            }}
          >
            ✋ Manual Marking ({notMarkedStudents.length} absent)
          </button>

          {/* End Session Button */}
          {!isEnded && (
            <button
              onClick={() => setShowEndConfirm(true)}
              style={{
                ...buttonStyle,
                background: 'linear-gradient(135deg, #dc2626, #991b1b)',
                border: '1px solid #ef4444',
                fontWeight: 600,
              }}
            >
              ⏹ End Session
            </button>
          )}
        </div>
      </header>

      {/* ── Prominent Headcount Banner ── */}
      <div style={statsBannerStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '36px', fontWeight: 800, color: '#38bdf8' }}>
            {markedCount}
          </span>
          <span style={{ fontSize: '18px', color: '#94a3b8' }}>/ {totalInClass} present</span>
          <span
            style={{
              marginLeft: '12px',
              fontSize: '14px',
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: '20px',
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#34d399',
              border: '1px solid rgba(16, 185, 129, 0.3)',
            }}
          >
            {percentage}% Turnout
          </span>
        </div>

        {/* Progress Bar */}
        <div style={progressBarContainerStyle}>
          <div
            style={{
              ...progressBarFillStyle,
              width: `${percentage}%`,
            }}
          />
        </div>
      </div>

      {/* ── Main Layout: Big Centered QR + Live Attendance List ── */}
      <div style={mainGridStyle}>
        {/* Left Column: Big QR Code Display */}
        <div style={qrSectionStyle}>
          {isEnded ? (
            <div style={endedCardStyle}>
              <div style={{ fontSize: '64px', marginBottom: '16px' }}>🏁</div>
              <h2 style={{ fontSize: '26px', fontWeight: 800, color: '#ffffff', marginBottom: '8px' }}>
                Attendance Session Finished
              </h2>
              <p style={{ color: '#94a3b8', fontSize: '15px', maxWidth: '420px', margin: '0 auto 24px' }}>
                QR rotation has stopped. All student QR submissions are locked. Late official duties
                or medical leaves can still be marked manually.
              </p>
              <div
                style={{
                  display: 'inline-flex',
                  gap: '24px',
                  background: 'rgba(15, 23, 42, 0.6)',
                  padding: '16px 28px',
                  borderRadius: '12px',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                }}
              >
                <div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase' }}>
                    Total Present
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 700, color: '#38bdf8' }}>
                    {markedCount}
                  </div>
                </div>
                <div style={{ borderLeft: '1px solid rgba(148, 163, 184, 0.2)', paddingLeft: '24px' }}>
                  <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase' }}>
                    Final Turnout
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 700, color: '#34d399' }}>
                    {percentage}%
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={qrContainerStyle}>
              {/* Countdown Gauge Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '100%',
                  maxWidth: '520px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '18px' }}>🔄</span>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
                    Dynamic QR Token
                  </span>
                </div>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    padding: '4px 12px',
                    borderRadius: '20px',
                    background: countdown <= 5 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(56, 189, 248, 0.15)',
                    color: countdown <= 5 ? '#f87171' : '#38bdf8',
                    border: countdown <= 5 ? '1px solid #ef4444' : '1px solid rgba(56, 189, 248, 0.3)',
                    transition: 'all 0.3s ease',
                  }}
                >
                  Rotating in {countdown}s
                </div>
              </div>

              {/* Window Progress Bar */}
              <div
                style={{
                  width: '100%',
                  maxWidth: '520px',
                  height: '4px',
                  background: 'rgba(51, 65, 85, 0.6)',
                  borderRadius: '2px',
                  marginBottom: '20px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${(countdown / (windowDuration || 30)) * 100}%`,
                    background: countdown <= 5 ? '#ef4444' : 'linear-gradient(90deg, #38bdf8, #818cf8)',
                    transition: 'width 1s linear',
                  }}
                />
              </div>

              {/* Big Centered QR Box */}
              <div style={bigQrWrapperStyle}>
                {qrToken ? (
                  <QRCodeSVG
                    value={JSON.stringify({
                      session_id: qrToken.session_id,
                      window: qrToken.window,
                      mac: qrToken.mac,
                    })}
                    size={Math.min(420, window.innerWidth - 80)}
                    level="H"
                    includeMargin={true}
                    style={{
                      borderRadius: '16px',
                      display: 'block',
                      margin: '0 auto',
                    }}
                  />
                ) : (
                  <div style={{ height: '360px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={spinnerStyle}></div>
                  </div>
                )}
              </div>

              {/* Instructions Subtext */}
              <div style={{ marginTop: '20px', textAlign: 'center', maxWidth: '480px' }}>
                <p style={{ fontSize: '14px', color: '#cbd5e1', margin: 0, fontWeight: 500 }}>
                  Scan with the ZeroProxy Student Web Scanner
                </p>
                <p style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>
                  HMAC protected with anti-proxy window validation. Rotates every 30 seconds.
                </p>
                {qrError && (
                  <p style={{ fontSize: '12px', color: '#f87171', marginTop: '4px' }}>
                    ⚠️ {qrError}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Live Attendance List */}
        <div style={listSectionStyle}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
            }}
          >
            <div>
              <h3 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: '#ffffff' }}>
                Present Students ({markedList.length})
              </h3>
              <p style={{ fontSize: '12px', color: '#94a3b8', margin: '2px 0 0' }}>
                Updated in real time • Newest entries first
              </p>
            </div>
          </div>

          {/* Roster Items */}
          <div style={rosterScrollContainerStyle}>
            {markedList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
                <div style={{ fontSize: '40px', marginBottom: '10px' }}>⏳</div>
                <div style={{ fontSize: '14px', fontWeight: 500 }}>Waiting for student scans...</div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>
                  Students scanning this QR will appear here instantly.
                </div>
              </div>
            ) : (
              markedList.map((st, index) => {
                const isOverride = st.source === 'override';
                const timeString = st.marked_at
                  ? new Date(st.marked_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })
                  : '';

                return (
                  <div
                    key={st.student_id || index}
                    style={{
                      ...rosterItemStyle,
                      borderLeft: isOverride ? '3px solid #f59e0b' : '3px solid #38bdf8',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '14px',
                          fontWeight: 600,
                          color: '#f8fafc',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatStudentName(st.name, st.roll_no)}
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#94a3b8',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          marginTop: '2px',
                        }}
                      >
                        <span>{st.roll_no}</span>
                        <span>•</span>
                        <span>{timeString}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '12px',
                          background: isOverride
                            ? 'rgba(245, 158, 11, 0.18)'
                            : 'rgba(56, 189, 248, 0.18)',
                          color: isOverride ? '#fbbf24' : '#67e8f9',
                          border: isOverride
                            ? '1px solid rgba(245, 158, 11, 0.3)'
                            : '1px solid rgba(56, 189, 248, 0.3)',
                          textTransform: 'uppercase',
                        }}
                      >
                        {isOverride ? 'Manual Override' : 'QR + Face Scan'}
                      </span>
                      {isOverride && st.reason && (
                        <span style={{ fontSize: '11px', color: '#f59e0b' }}>
                          Reason: {st.reason}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Modal: End Session Confirmation ── */}
      {showEndConfirm && (
        <div style={modalBackdropStyle}>
          <div style={modalBoxStyle}>
            <div style={{ fontSize: '38px', marginBottom: '12px' }}>⚠️</div>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#ffffff', marginBottom: '8px' }}>
              End Live Attendance Session?
            </h3>
            <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: '1.5', marginBottom: '20px' }}>
              This will lock the attendance window. Students will no longer be able to submit scans.
              Final present count will be preserved.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                disabled={endingSession}
                onClick={() => setShowEndConfirm(false)}
                style={{
                  ...buttonStyle,
                  background: 'rgba(51, 65, 85, 0.8)',
                }}
              >
                Cancel
              </button>
              <button
                disabled={endingSession}
                onClick={handleEndSession}
                style={{
                  ...buttonStyle,
                  background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
                  fontWeight: 600,
                }}
              >
                {endingSession ? 'Ending...' : 'Yes, End Session'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Manual Attendance Drawer / Marking ── */}
      {showManualModal && (
        <div style={modalBackdropStyle}>
          <div style={{ ...modalBoxStyle, maxWidth: '640px', width: '92%' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#ffffff', margin: 0 }}>
                  Manual Attendance Override
                </h3>
                <p style={{ fontSize: '13px', color: '#94a3b8', margin: '2px 0 0' }}>
                  Append-only record in audit log • No biometric photo required
                </p>
              </div>
              <button
                onClick={() => {
                  setShowManualModal(false);
                  setOverrideSummary(null);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '20px',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {/* Success Summary Banner */}
            {overrideSummary && (
              <div
                style={{
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  marginBottom: '16px',
                  color: '#34d399',
                  fontSize: '14px',
                }}
              >
                ✅ <strong>Success!</strong> Marked {overrideSummary.marked_count} student(s).
                {overrideSummary.already_marked_count > 0 && (
                  <span> ({overrideSummary.already_marked_count} were already marked)</span>
                )}
              </div>
            )}

            {/* Error Message */}
            {overrideError && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  marginBottom: '16px',
                  color: '#f87171',
                  fontSize: '14px',
                }}
              >
                ⚠️ {overrideError}
              </div>
            )}

            {/* Unmarked Students List & Search */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <input
                  type="text"
                  placeholder="Search absent students by roll no or name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'rgba(30, 41, 59, 0.8)',
                    border: '1px solid rgba(148, 163, 184, 0.25)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: '#ffffff',
                    fontSize: '13px',
                  }}
                />
                <button
                  onClick={toggleSelectAll}
                  style={{
                    ...buttonStyle,
                    background: 'rgba(51, 65, 85, 0.7)',
                    fontSize: '12px',
                    padding: '8px 12px',
                  }}
                >
                  {selectedStudentIds.length === filteredNotMarked.length && filteredNotMarked.length > 0
                    ? 'Deselect All'
                    : 'Select All'}
                </button>
              </div>

              {/* Student Checklist Container */}
              <div
                style={{
                  maxHeight: '180px',
                  overflowY: 'auto',
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  borderRadius: '10px',
                  padding: '6px',
                }}
              >
                {filteredNotMarked.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '13px' }}>
                    {notMarkedStudents.length === 0
                      ? '🎉 All students in this class are marked present!'
                      : 'No matching absent students found.'}
                  </div>
                ) : (
                  filteredNotMarked.map((st) => (
                    <label
                      key={st.student_id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        background: selectedStudentIds.includes(st.student_id)
                          ? 'rgba(56, 189, 248, 0.12)'
                          : 'transparent',
                        fontSize: '13px',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedStudentIds.includes(st.student_id)}
                        onChange={() => toggleStudentSelection(st.student_id)}
                        style={{ cursor: 'pointer', accentColor: '#38bdf8' }}
                      />
                      <span style={{ fontWeight: 600, color: '#f8fafc', minWidth: '90px' }}>
                        {st.roll_no}
                      </span>
                      <span style={{ color: '#cbd5e1' }}>{st.name}</span>
                    </label>
                  ))
                )}
              </div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '6px' }}>
                Selected: {selectedStudentIds.length} student(s) (Maximum 50 per batch)
              </div>
            </div>

            {/* Reason Selector */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginBottom: '6px' }}>
                Override Reason *
              </label>
              <select
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(30, 41, 59, 0.8)',
                  border: '1px solid rgba(148, 163, 184, 0.25)',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: '#ffffff',
                  fontSize: '14px',
                }}
              >
                <option value="medical">Medical / Sick Leave</option>
                <option value="sports">Sports / Official College Duty</option>
                <option value="hackathon">Hackathon / Tech Competition</option>
                <option value="no_biometric_consent">No Biometric Consent (DPDP Alternative)</option>
                <option value="other">Other Reason (Mandatory Note)</option>
              </select>
            </div>

            {/* Note Input */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginBottom: '6px' }}>
                Reason Note {overrideReason === 'other' ? '(Required *)' : '(Optional)'}
              </label>
              <textarea
                rows={2}
                placeholder={
                  overrideReason === 'other'
                    ? 'Please specify detailed justification (required for audit)...'
                    : 'Optional note or reference number...'
                }
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(30, 41, 59, 0.8)',
                  border: overrideReason === 'other' && !overrideNote.trim()
                    ? '1px solid #f87171'
                    : '1px solid rgba(148, 163, 184, 0.25)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  color: '#ffffff',
                  fontSize: '13px',
                  resize: 'none',
                }}
              />
            </div>

            {/* Submit Confirmation Step */}
            {!overrideConfirmOpen ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  onClick={() => setShowManualModal(false)}
                  style={{
                    ...buttonStyle,
                    background: 'rgba(51, 65, 85, 0.8)',
                  }}
                >
                  Cancel
                </button>
                <button
                  disabled={selectedStudentIds.length === 0}
                  onClick={() => {
                    if (overrideReason === 'other' && !overrideNote.trim()) {
                      setOverrideError('A note is required when reason is "Other".');
                      return;
                    }
                    setOverrideConfirmOpen(true);
                  }}
                  style={{
                    ...buttonStyle,
                    background:
                      selectedStudentIds.length === 0
                        ? 'rgba(51, 65, 85, 0.4)'
                        : 'linear-gradient(135deg, #d97706, #b45309)',
                    fontWeight: 600,
                  }}
                >
                  Mark Selected ({selectedStudentIds.length})
                </button>
              </div>
            ) : (
              <div
                style={{
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  borderRadius: '10px',
                  padding: '14px',
                }}
              >
                <div style={{ fontSize: '14px', color: '#fbbf24', fontWeight: 600, marginBottom: '6px' }}>
                  Confirm Manual Override
                </div>
                <div style={{ fontSize: '13px', color: '#cbd5e1', marginBottom: '14px' }}>
                  Mark attendance for <strong>{selectedStudentIds.length}</strong> student(s) as{' '}
                  <strong>{overrideReason}</strong>? This action appends to the immutable audit log and
                  cannot be undone.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    disabled={submittingOverride}
                    onClick={() => setOverrideConfirmOpen(false)}
                    style={{ ...buttonStyle, background: 'rgba(51, 65, 85, 0.8)' }}
                  >
                    Back
                  </button>
                  <button
                    disabled={submittingOverride}
                    onClick={executeManualOverride}
                    style={{
                      ...buttonStyle,
                      background: 'linear-gradient(135deg, #10b981, #059669)',
                      fontWeight: 600,
                    }}
                  >
                    {submittingOverride ? 'Marking...' : 'Yes, Confirm & Mark'}
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
  background: 'radial-gradient(circle at top right, #302060, transparent 40%), linear-gradient(135deg, #080d20, #11152e 60%, #090c1b)',
  fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  padding: '24px',
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
  padding: '16px 24px',
  backdropFilter: 'blur(14px)',
  marginBottom: '20px',
};

const statsBannerStyle = {
  background: 'rgba(15, 23, 42, 0.75)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '16px',
  padding: '18px 24px',
  backdropFilter: 'blur(14px)',
  marginBottom: '24px',
};

const progressBarContainerStyle = {
  width: '100%',
  height: '8px',
  background: 'rgba(51, 65, 85, 0.6)',
  borderRadius: '4px',
  marginTop: '12px',
  overflow: 'hidden',
};

const progressBarFillStyle = {
  height: '100%',
  background: 'linear-gradient(90deg, #38bdf8, #10b981)',
  borderRadius: '4px',
  transition: 'width 0.5s ease',
};

const mainGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)',
  gap: '24px',
  alignItems: 'start',
};

const qrSectionStyle = {
  background: 'rgba(15, 23, 42, 0.75)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '20px',
  padding: '30px 24px',
  backdropFilter: 'blur(14px)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
};

const listSectionStyle = {
  background: 'rgba(15, 23, 42, 0.75)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '20px',
  padding: '24px',
  backdropFilter: 'blur(14px)',
  height: 'calc(100vh - 280px)',
  minHeight: '520px',
  display: 'flex',
  flexDirection: 'column',
};

const qrContainerStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  width: '100%',
};

const bigQrWrapperStyle = {
  background: '#ffffff',
  padding: '20px',
  borderRadius: '20px',
  boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5), 0 0 40px rgba(56, 189, 248, 0.25)',
  display: 'inline-block',
};

const rosterScrollContainerStyle = {
  flex: 1,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  paddingRight: '6px',
};

const rosterItemStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  background: 'rgba(30, 41, 59, 0.6)',
  border: '1px solid rgba(148, 163, 184, 0.15)',
  borderRadius: '12px',
  padding: '12px 16px',
  transition: 'background 0.2s ease',
};

const endedCardStyle = {
  textAlign: 'center',
  padding: '60px 20px',
};

const buttonStyle = {
  border: 'none',
  borderRadius: '8px',
  padding: '9px 16px',
  color: '#ffffff',
  fontSize: '13px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  transition: 'opacity 0.2s ease',
};

const badgeLiveStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.05em',
  padding: '4px 10px',
  borderRadius: '20px',
  background: 'rgba(16, 185, 129, 0.15)',
  color: '#34d399',
  border: '1px solid rgba(16, 185, 129, 0.3)',
};

const badgeEndedStyle = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.05em',
  padding: '4px 10px',
  borderRadius: '20px',
  background: 'rgba(239, 68, 68, 0.15)',
  color: '#f87171',
  border: '1px solid rgba(239, 68, 68, 0.3)',
};

const pulseDotStyle = {
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  background: '#10b981',
  boxShadow: '0 0 10px #10b981',
  display: 'inline-block',
};

const cardStyle = {
  maxWidth: '800px',
  margin: '40px auto',
  background: 'rgba(15, 23, 42, 0.75)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '18px',
  padding: '24px',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
};

const spinnerStyle = {
  width: '36px',
  height: '36px',
  border: '3px solid rgba(56, 189, 248, 0.2)',
  borderTopColor: '#38bdf8',
  borderRadius: '50%',
  animation: 'spin 1s linear infinite',
  margin: '0 auto',
};

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
  padding: '28px',
  maxWidth: '460px',
  width: '100%',
  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
  color: '#ffffff',
};
