import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client.js';

function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

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
      const token = data?.token || data?.accessToken;
      const userRole = String(
        data?.user?.role || data?.role || response?.user?.role || ''
      ).toLowerCase();

      if (!token) {
        throw new Error(
          'Login response did not contain an authentication token.'
        );
      }

      if (!['student', 'faculty'].includes(userRole)) {
        throw new Error('Your account role was not recognized.');
      }

      sessionStorage.setItem('token', token);
      sessionStorage.setItem('isLoggedIn', 'true');
      sessionStorage.setItem('role', userRole);

      navigate(userRole === 'faculty' ? '/faculty' : '/student');
    } catch (error) {
      setMessage(error?.message || 'Login failed. Please try again.');
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
          maxWidth: '430px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '28px',
        }}
      >
        {/* App name and quotation */}
        <section
          style={{
            width: '100%',
            textAlign: 'center',
          }}
        >
          <Link
            to="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              marginBottom: '20px',
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
              margin: '0 0 12px',
            }}
          >
            SMART ATTENDANCE SYSTEM
          </p>

          <h1
            style={{
              fontSize: 'clamp(28px, 5vw, 38px)',
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

        {/* Glassmorphism login form */}
        <section
          className="glass-card"
          style={{
            width: '100%',
            maxWidth: '430px',
            padding: '34px 30px',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <h2 style={{ fontSize: '27px', margin: '0 0 9px' }}>
              Welcome to ZeroProxy
            </h2>

            <p style={{ fontSize: '13px', color: '#9eb3d9', margin: 0 }}>
              Sign in to your ZeroProxy account
            </p>
          </div>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '20px' }}>
              <label htmlFor="login-email" style={labelStyle}>
                Email Address
              </label>

              <input
                className="glass-hover"
                id="login-email"
                type="email"
                placeholder="you@example.com"
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

            <div style={{ marginBottom: '24px' }}>
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
                  onClick={() =>
                    setShowPassword((previous) => !previous)
                  }
                  aria-label={
                    showPassword ? 'Hide password' : 'Show password'
                  }
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
                  'linear-gradient(100deg, #13bdf5, #195ad1 48%, #013bdf)',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 750,
                boxShadow: '0 8px 26px rgba(66,111,255,.25)',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Signing in...' : 'Sign In →'}
            </button>
          </form>

          {message && (
            <p
              role="alert"
              style={{
                marginTop: '18px',
                padding: '12px',
                borderRadius: '10px',
                background: 'rgba(248,113,113,.1)',
                border: '1px solid rgba(248,113,113,.25)',
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
              marginTop: '25px',
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
              Create account
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}

export default Login;