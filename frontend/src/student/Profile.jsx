import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client.js';

export default function Profile() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
          </div>
        )}
      </div>
    </div>
  );
}
