import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client.js';

function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  // Role toggle: 'student' or 'faculty'
  const [activeTab, setActiveTab] = useState('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check URL param ?role=faculty or ?role=student
    const params = new URLSearchParams(location.search);
    const roleParam = params.get('role');
    if (roleParam === 'faculty' || roleParam === 'student') {
      setActiveTab(roleParam);
    }
  }, [location.search]);

  async function handleLogin(event) {
    event.preventDefault();
    setMessage('');

    if (!email.trim() || !password) {
      setMessage('Please enter your email and password.');
      return;
    }

    setLoading(true);

    try {
      const response = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      const data = response?.data || response;
      const token = data?.token || data?.accessToken || data?.access_token;
      let userRole = String(
        data?.user?.role || data?.role || response?.user?.role || ''
      ).toLowerCase();

      if (!userRole && token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          userRole = String(payload?.role || '').toLowerCase();
        } catch {
          // ignore decode error
        }
      }

      if (!token) {
        throw new Error(
          'Login response did not contain an authentication token.'
        );
      }

      if (!['student', 'faculty', 'admin'].includes(userRole)) {
        throw new Error('Your account role was not recognized.');
      }

      // Enforce strict portal access: prevent cross-portal logins
      if (activeTab === 'faculty' && userRole === 'student') {
        throw new Error(
          'Access Denied: This is a Student account. Please switch to the "Student Portal" tab to log in.'
        );
      }

      if (activeTab === 'student' && (userRole === 'faculty' || userRole === 'admin')) {
        throw new Error(
          'Access Denied: This is a Faculty/Admin account. Please switch to the "Faculty Portal" tab to log in.'
        );
      }

      sessionStorage.setItem('token', token);
      sessionStorage.setItem('isLoggedIn', 'true');
      sessionStorage.setItem('role', userRole);

      // Route accordingly
      setTimeout(() => {
        if (userRole === 'faculty' || userRole === 'admin') {
          navigate('/faculty');
        } else {
          navigate('/student');
        }
      }, 350);
    } catch (error) {
      setMessage(error?.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '14px',
    boxSizing: 'border-box',
    borderRadius: '11px',
    border: '1px solid rgba(113, 168, 255, 0.3)',
    background: 'rgba(5, 14, 42, 0.65)',
    color: '#f1f5ff',
    fontSize: '14px',
  };

  const labelStyle = {
    display: 'block',
    marginBottom: '8px',
    color: '#dbe7ff',
    fontSize: '13px',
    fontWeight: 500,
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '30px 18px',
        boxSizing: 'border-box',
        fontFamily: "'Inter', Arial, sans-serif",
        color: '#f1f5ff',
        background: `
          radial-gradient(ellipse at 12% 15%, rgba(0,112,255,.24), transparent 42%),
          radial-gradient(ellipse at 88% 85%, rgba(117,38,255,.23), transparent 42%),
          #050b20
        `,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '24px',
        }}
      >
        {/* App branding */}
        <section style={{ width: '100%', textAlign: 'center' }}>
          <Link
            to="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              marginBottom: '16px',
              color: '#fff',
              textDecoration: 'none',
            }}
          >
            <span
              style={{
                width: '42px',
                height: '42px',
                display: 'grid',
                placeItems: 'center',
                borderRadius: '13px',
                background: 'linear-gradient(135deg, #16caff, #7654ff)',
                fontSize: '27px',
                fontWeight: 800,
              }}
            >
              Z
            </span>

            <span style={{ fontSize: '25px', fontWeight: 750 }}>
              ZeroProxy
            </span>
          </Link>

          <p
            style={{
              color: '#8be4ff',
              fontSize: '11px',
              letterSpacing: '1.5px',
              margin: '0 0 10px',
            }}
          >
            SMART ATTENDANCE SYSTEM
          </p>

          <h1
            style={{
              fontSize: 'clamp(26px, 5vw, 36px)',
              lineHeight: 1.2,
              margin: 0,
              background: 'linear-gradient(100deg, #fff, #80ddff 55%, #ae8bff)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            Attend Today, Achieve Tomorrow
          </h1>
        </section>

        {/* Login Container */}
        <section
          className="glass-card"
          style={{
            width: '100%',
            maxWidth: '440px',
            padding: '30px 28px',
            boxSizing: 'border-box',
            background: 'rgba(9, 18, 45, 0.75)',
            border: '1px solid rgba(113, 168, 255, 0.25)',
            borderRadius: '20px',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
          }}
        >
          {/* Two-Type Login Toggle */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
              background: 'rgba(3, 9, 28, 0.6)',
              padding: '5px',
              borderRadius: '14px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              marginBottom: '26px',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setActiveTab('student');
                setMessage('');
              }}
              style={{
                padding: '11px',
                borderRadius: '10px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 650,
                fontSize: '13px',
                transition: 'all 0.2s ease',
                background:
                  activeTab === 'student'
                    ? 'linear-gradient(135deg, #0284c7, #2563eb)'
                    : 'transparent',
                color: activeTab === 'student' ? '#ffffff' : '#94a3b8',
                boxShadow:
                  activeTab === 'student'
                    ? '0 4px 12px rgba(37, 99, 235, 0.35)'
                    : 'none',
              }}
            >
              🎓 Student Portal
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('faculty');
                setMessage('');
              }}
              style={{
                padding: '11px',
                borderRadius: '10px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 650,
                fontSize: '13px',
                transition: 'all 0.2s ease',
                background:
                  activeTab === 'faculty'
                    ? 'linear-gradient(135deg, #7c3aed, #4f46e5)'
                    : 'transparent',
                color: activeTab === 'faculty' ? '#ffffff' : '#94a3b8',
                boxShadow:
                  activeTab === 'faculty'
                    ? '0 4px 12px rgba(124, 58, 237, 0.35)'
                    : 'none',
              }}
            >
              👨‍🏫 Faculty Portal
            </button>
          </div>

          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '24px', margin: '0 0 6px', fontWeight: 700 }}>
              {activeTab === 'faculty' ? 'Faculty Sign In' : 'Student Sign In'}
            </h2>

            <p style={{ fontSize: '13px', color: '#9eb3d9', margin: 0 }}>
              {activeTab === 'faculty'
                ? 'Sign in to create sessions, display rotating QR, & manage attendance'
                : 'Sign in to track verified attendance & scan lecture QR codes'}
            </p>
          </div>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '18px' }}>
              <label htmlFor="login-email" style={labelStyle}>
                {activeTab === 'faculty' ? 'Faculty Email Address' : 'Student Email Address'}
              </label>

              <input
                className="glass-hover"
                id="login-email"
                type="email"
                placeholder={activeTab === 'faculty' ? 'faculty@university.edu' : 'student@university.edu'}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setMessage('');
                }}
                autoComplete="email"
                required
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: '22px' }}>
              <label htmlFor="login-password" style={labelStyle}>
                Password
              </label>

              <div style={{ position: 'relative' }}>
                <input
                  className="glass-hover"
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setMessage('');
                  }}
                  autoComplete="current-password"
                  required
                  style={{
                    ...inputStyle,
                    paddingRight: '65px',
                  }}
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((previous) => !previous)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    border: 'none',
                    background: 'transparent',
                    color: '#9db7e8',
                    fontSize: '11px',
                    cursor: 'pointer',
                    padding: '6px',
                  }}
                >
                  {showPassword ? 'HIDE' : 'SHOW'}
                </button>
              </div>
            </div>

            <button
              className="glass-login-button"
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '14px',
                border: 'none',
                borderRadius: '11px',
                background:
                  activeTab === 'faculty'
                    ? 'linear-gradient(100deg, #9333ea, #6366f1)'
                    : 'linear-gradient(100deg, #13bdf5, #195ad1 48%, #013bdf)',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 700,
                boxShadow:
                  activeTab === 'faculty'
                    ? '0 8px 24px rgba(147, 51, 234, 0.35)'
                    : '0 8px 24px rgba(66, 111, 255, 0.3)',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading
                ? 'Authenticating...'
                : activeTab === 'faculty'
                ? 'Sign In to Faculty Portal →'
                : 'Sign In to Student Portal →'}
            </button>
          </form>

          {message && (
            <p
              role="alert"
              style={{
                marginTop: '16px',
                padding: '12px',
                borderRadius: '10px',
                background: 'rgba(248,113,113,.12)',
                border: '1px solid rgba(248,113,113,.3)',
                color: '#fca5a5',
                fontSize: '12px',
                lineHeight: 1.6,
                overflowWrap: 'anywhere',
              }}
            >
              {message}
            </p>
          )}

          <p
            style={{
              textAlign: 'center',
              fontSize: '13px',
              color: '#9eb3d9',
              marginTop: '22px',
              marginBottom: 0,
            }}
          >
            Don't have an account?{' '}
            <Link
              to="/register"
              style={{
                color: '#80ddff',
                fontWeight: 700,
                textDecoration: 'none',
              }}
            >
              Register here
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}

export default Login;