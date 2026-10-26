import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client.js';

export default function Profile() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  async function handlePasswordChange(e) {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword) {
      setPasswordError('Please enter your current password.');
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError('New password cannot be identical to current password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    setPasswordLoading(true);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      setPasswordSuccess('Password successfully updated!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      sessionStorage.removeItem('mustChangePassword');
    } catch (err) {
      setPasswordError(err?.message || 'Failed to update password. Please check your credentials.');
    } finally {
      setPasswordLoading(false);
    }
  }

  useEffect(() => {
    async function fetchProfile() {
      try {
        setLoading(true);
        const me = await apiRequest('/auth/me');
        let hasFace = false;
        try {
          const attendance = await apiRequest('/attendance/student/me');
          if (attendance?.student) {
            hasFace = Boolean(attendance.student.has_face_enrollment);
          }
        } catch {
          // Attendance summary might be absent if fresh account
        }

        setProfile({
          fullName: me.full_name || me.name || '',
          rollNo: me.roll_no || '',
          email: me.email || '',
          role: me.role || 'student',
          status: me.status || 'pending',
          hasFace,
        });
      } catch (err) {
        setError(err?.message || 'Failed to load profile details.');
      } finally {
        setLoading(false);
      }
    }

    fetchProfile();
  }, []);

  const cardStyle = {
    background: 'rgba(15, 23, 42, 0.85)',
    border: '1px solid rgba(113, 168, 255, 0.25)',
    borderRadius: '18px',
    padding: '30px',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
    backdropFilter: 'blur(20px)',
  };

  const labelStyle = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 700,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '8px',
  };

  const readOnlyFieldStyle = {
    width: '100%',
    padding: '14px 16px',
    background: 'rgba(2, 6, 23, 0.6)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '10px',
    color: '#f8fafc',
    fontSize: '15px',
    fontWeight: 500,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };

  const groupStyle = {
    marginBottom: '20px',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(ellipse at 15% 20%, rgba(0,112,255,.2), transparent 42%), radial-gradient(ellipse at 85% 80%, rgba(117,38,255,.2), transparent 42%), #070c1e',
        color: '#f1f5ff',
        fontFamily: "'Inter', Arial, sans-serif",
        padding: '36px 20px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <div style={{ width: '100%', maxWidth: '580px' }}>
        {/* Navigation back to student dashboard */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <button
            type="button"
            onClick={() => navigate('/student')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.05)',
              color: '#67e8f9',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            ← Back to Dashboard
          </button>

          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: '20px',
              background: 'rgba(99, 102, 241, 0.25)',
              color: '#a5b4fc',
              letterSpacing: '0.05em',
            }}
          >
            STUDENT PROFILE
          </span>
        </div>

        {loading ? (
          <div style={{ ...cardStyle, textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>⌛</div>
            <p style={{ color: '#94a3b8', margin: 0 }}>Loading student profile...</p>
          </div>
        ) : error ? (
          <div style={{ ...cardStyle, textAlign: 'center' }}>
            <div style={{ fontSize: '36px', marginBottom: '10px' }}>⚠️</div>
            <h3 style={{ color: '#fca5a5', margin: '0 0 10px' }}>Failed to Load Profile</h3>
            <p style={{ color: '#cbd5e1', fontSize: '14px', marginBottom: '20px' }}>{error}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 20px',
                background: '#0284c7',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <div style={cardStyle}>
            {/* Header info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '28px', borderBottom: '1px solid rgba(148, 163, 184, 0.15)', paddingBottom: '20px' }}>
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: '24px',
                  fontWeight: 800,
                  color: '#ffffff',
                }}
              >
                {profile?.fullName ? profile.fullName.charAt(0).toUpperCase() : 'S'}
              </div>
              <div>
                <h1 style={{ fontSize: '22px', margin: '0 0 4px', color: '#f8fafc' }}>
                  {profile?.fullName || 'Student'}
                </h1>
                <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                  Roll No: <span style={{ color: '#67e8f9', fontWeight: 600 }}>{profile?.rollNo}</span>
                </p>
              </div>
            </div>

            {/* Read-Only Notice */}
            <div
              style={{
                background: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: '10px',
                padding: '12px 14px',
                marginBottom: '24px',
                fontSize: '12px',
                color: '#bae6fd',
                lineHeight: 1.5,
              }}
            >
              🔒 <strong>Official Institutional Record:</strong> Name and roll number are read-only and verified against campus records. Corrections require faculty or administration authorization.
            </div>

            {/* Form Fields - Separate labelled read-only fields */}
            <div style={groupStyle}>
              <label style={labelStyle}>Full Name</label>
              <div style={readOnlyFieldStyle}>
                <span>{profile?.fullName}</span>
                <span style={{ fontSize: '11px', color: '#64748b' }}>READ-ONLY</span>
              </div>
            </div>

            <div style={groupStyle}>
              <label style={labelStyle}>Roll Number</label>
              <div style={readOnlyFieldStyle}>
                <span style={{ fontFamily: 'monospace', letterSpacing: '0.05em', color: '#38bdf8', fontWeight: 700 }}>
                  {profile?.rollNo}
                </span>
                <span style={{ fontSize: '11px', color: '#64748b' }}>READ-ONLY</span>
              </div>
            </div>

            <div style={groupStyle}>
              <label style={labelStyle}>Institute Email</label>
              <div style={readOnlyFieldStyle}>
                <span>{profile?.email}</span>
                <span style={{ fontSize: '11px', color: '#64748b' }}>VERIFIED</span>
              </div>
            </div>

            <div style={{ ...groupStyle, marginBottom: '10px' }}>
              <label style={labelStyle}>Enrolment & Biometric Status</label>
              <div style={readOnlyFieldStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: profile?.status === 'active' ? '#10b981' : '#f59e0b',
                    }}
                  />
                  <span style={{ textTransform: 'capitalize' }}>
                    {profile?.status}
                  </span>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                    ({profile?.hasFace ? 'Face Biometric Enrolled' : 'Face Biometric Pending'})
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '12px',
                    background: profile?.status === 'active' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                    color: profile?.status === 'active' ? '#4ade80' : '#fbbf24',
                  }}
                >
                  {profile?.status.toUpperCase()}
                </span>
              </div>
            </div>

            {/* Change Password Card */}
            <div style={{ marginTop: '28px', paddingTop: '24px', borderTop: '1px solid rgba(148, 163, 184, 0.2)' }}>
              <h3 style={{ fontSize: '17px', margin: '0 0 6px', color: '#67e8f9', fontWeight: 600 }}>
                🔐 Security & Password
              </h3>
              <p style={{ fontSize: '13px', color: '#94a3b8', margin: '0 0 18px', lineHeight: 1.5 }}>
                Update your account password below. Minimum 8 characters.
              </p>

              {passwordError && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    color: '#fca5a5',
                    fontSize: '13px',
                    marginBottom: '14px',
                  }}
                >
                  ⚠️ {passwordError}
                </div>
              )}

              {passwordSuccess && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: 'rgba(74, 222, 128, 0.15)',
                    border: '1px solid rgba(74, 222, 128, 0.35)',
                    color: '#4ade80',
                    fontSize: '13px',
                    marginBottom: '14px',
                  }}
                >
                  ✅ {passwordSuccess}
                </div>
              )}

              <form onSubmit={handlePasswordChange}>
                <div style={groupStyle}>
                  <label style={labelStyle}>Current Password</label>
                  <input
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter your current password"
                    style={{
                      ...readOnlyFieldStyle,
                      border: '1px solid rgba(113, 168, 255, 0.3)',
                      background: 'rgba(5, 14, 42, 0.65)',
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={groupStyle}>
                  <label style={labelStyle}>New Password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter at least 8 characters"
                    style={{
                      ...readOnlyFieldStyle,
                      border: '1px solid rgba(113, 168, 255, 0.3)',
                      background: 'rgba(5, 14, 42, 0.65)',
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={groupStyle}>
                  <label style={labelStyle}>Confirm New Password</label>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-type new password"
                    style={{
                      ...readOnlyFieldStyle,
                      border: '1px solid rgba(113, 168, 255, 0.3)',
                      background: 'rgba(5, 14, 42, 0.65)',
                      outline: 'none',
                    }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={passwordLoading}
                  style={{
                    padding: '12px 20px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                    color: '#ffffff',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: passwordLoading ? 'not-allowed' : 'pointer',
                    opacity: passwordLoading ? 0.7 : 1,
                  }}
                >
                  {passwordLoading ? 'Updating Password...' : 'Save New Password'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
