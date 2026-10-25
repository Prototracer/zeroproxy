
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client.js';

function Register() {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('student');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  async function handleRegister(event) {
    event.preventDefault();
    setMessage('');
    setSuccess(false);

    if (!name.trim() || !email.trim() || !password || !confirmPassword) {
      setMessage('Please fill in all fields.');
      return;
    }

    if (password.length < 8) {
      setMessage('Password must contain at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setMessage('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      await apiRequest('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          role,
        }),
      });

      // Auto-login to seamlessly transition to Face Enrollment
      try {
        const loginRes = await apiRequest('/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: email.trim(),
            password,
          }),
        });

        const token = loginRes?.token || loginRes?.accessToken || loginRes?.access_token;
        if (token) {
          sessionStorage.setItem('token', token);
          sessionStorage.setItem('isLoggedIn', 'true');
          sessionStorage.setItem('role', 'student');

          setSuccess(true);
          setMessage('Registration successful! Redirecting to Face Enrollment to complete your profile...');
          setTimeout(() => {
            navigate('/student/enroll');
          }, 1000);
          return;
        }
      } catch {
        // Fallback to manual login navigation if auto-login fails
      }

      setSuccess(true);
      setMessage('Registration successful! You can now log in to complete your face enrollment.');
      setName('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setRole('student');
      setShowPassword(false);
      setShowConfirmPassword(false);
      setTimeout(() => {
        navigate('/login');
      }, 1500);
    } catch (error) {
      setMessage(error?.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '13px 14px',
    background: 'rgba(5, 14, 42, 0.65)',
    border: '1px solid rgba(113, 168, 255, 0.3)',
    borderRadius: '11px',
    color: '#f1f5ff',
    fontSize: '14px',
    boxSizing: 'border-box',
  };

  const labelStyle = {
    display: 'block',
    color: '#dbe7ff',
    fontSize: '13px',
    fontWeight: 500,
    marginBottom: '7px',
  };

  const fieldStyle = { marginBottom: '16px' };

  const roleCardStyle = (selected) => ({
    position: 'relative',
    flex: 1,
    minWidth: 0,
    padding: '15px 10px',
    borderRadius: '12px',
    border: selected
      ? '1px solid #26cfff'
      : '1px solid rgba(113,168,255,.25)',
    background: selected
      ? 'linear-gradient(135deg, rgba(0,190,255,.17), rgba(86,75,255,.13))'
      : 'rgba(8,22,57,.5)',
    color: '#f1f5ff',
    textAlign: 'center',
    cursor: 'pointer',
    boxShadow: selected ? '0 0 22px rgba(0,190,255,.1)' : 'none',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
  });

  const buttonStyle = {
    width: '100%',
    padding: '14px',
    border: 'none',
    borderRadius: '11px',
    background: 'linear-gradient(100deg, #13bdf5, #397dff 48%, #a04bff)',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 750,
    boxShadow: '0 8px 26px rgba(66,111,255,.25)',
    cursor: loading ? 'not-allowed' : 'pointer',
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 18px',
        boxSizing: 'border-box',
        fontFamily: "'Inter', Arial, sans-serif",
        color: '#f1f5ff',
        background: `
          radial-gradient(ellipse at 15% 20%, rgba(0,112,255,.24), transparent 42%),
          radial-gradient(ellipse at 85% 80%, rgba(117,38,255,.23), transparent 42%),
          #050b20
        `,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '950px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 310px), 1fr))',
          alignItems: 'center',
          gap: '48px',
        }}
      >
        <section>
          <Link
            to="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              color: '#fff',
              textDecoration: 'none',
              marginBottom: '35px',
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
                fontWeight: 800,
                fontSize: '27px',
              }}
            >
              Z
            </span>
            <span style={{ fontSize: '23px', fontWeight: 750 }}>ZeroProxy</span>
          </Link>

          <p style={{ color: '#8be4ff', fontSize: '11px', letterSpacing: '1px' }}>
            SMART ATTENDANCE SYSTEM
          </p>

          <h1
            style={{
              fontSize: 'clamp(35px, 5vw, 53px)',
              lineHeight: 1.12,
              margin: '15px 0',
              background: 'linear-gradient(100deg, #fff, #80ddff 52%, #ae8bff)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            Join the
            <br />
            smarter campus.
          </h1>

          <p style={{ color: '#a9badb', lineHeight: 1.8, fontSize: '14px' }}>
            Be Present to Learn, Not Just to Attend
          </p>


         
        </section>

        <section
          style={{
            width: '100%',
            maxWidth: '430px',
            justifySelf: 'center',
            padding: '30px',
            boxSizing: 'border-box',
            borderRadius: '22px',
            border: '1px solid rgba(123,173,255,.32)',
            background: 'linear-gradient(145deg, rgba(29,55,112,.72), rgba(11,20,54,.86))',
            boxShadow: '0 25px 80px rgba(0,0,0,.35)',
            backdropFilter: 'blur(24px)',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: '27px' }}>
            <h2 style={{ fontSize: '25px', margin: '0 0 9px' }}>
              Create your account
            </h2>
          </div>

          <form onSubmit={handleRegister}>
            <div style={fieldStyle}>
              <label htmlFor="register-name" style={labelStyle}>Full Name</label>
              <input
                className="glass-hover"
                id="register-name"
                type="text"
                placeholder="Enter your full name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setMessage('');
                  setSuccess(false);
                }}
                autoComplete="name"
                maxLength={100}
                required
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <label htmlFor="register-email" style={labelStyle}>Email Address</label>
              <input
                className="glass-hover"
                id="register-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setMessage('');
                  setSuccess(false);
                }}
                autoComplete="email"
                required
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <label htmlFor="register-password" style={labelStyle}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="glass-hover"
                  id="register-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setMessage('');
                    setSuccess(false);
                  }}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  style={{ ...inputStyle, paddingRight: '65px' }}
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

            <div style={fieldStyle}>
              <label htmlFor="register-confirm-password" style={labelStyle}>
                Confirm Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  className="glass-hover"
                  id="register-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    setMessage('');
                    setSuccess(false);
                  }}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  style={{ ...inputStyle, paddingRight: '65px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((previous) => !previous)}
                  aria-label={
                    showConfirmPassword
                      ? 'Hide confirm password'
                      : 'Show confirm password'
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
                  {showConfirmPassword ? 'HIDE' : 'SHOW'}
                </button>
              </div>
            </div>

            <fieldset style={{ border: 'none', padding: 0, margin: '4px 0 22px' }}>
              <legend style={{ ...labelStyle, marginBottom: '10px' }}>
                Register As
              </legend>

              <div style={{ display: 'flex', gap: '12px' }}>
                {[
                  { value: 'student', title: 'Student', icon: '♧' },
                  { value: 'faculty', title: 'Faculty', icon: '♙' },
                ].map((item) => (
                  <label
                    key={item.value}
                    className="role-card"
                    style={roleCardStyle(role === item.value)}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={item.value}
                      checked={role === item.value}
                      onChange={(event) => {
                        setRole(event.target.value);
                        setMessage('');
                        setSuccess(false);
                      }}
                      style={{
                        position: 'absolute',
                        opacity: 0,
                        width: '1px',
                        height: '1px',
                      }}
                    />
                    <span style={{ display: 'block', fontSize: '25px', color: '#6de2ff', marginBottom: '8px' }}>
                      {item.icon}
                    </span>
                    <span style={{ display: 'block', fontSize: '13px', fontWeight: 650 }}>
                      {item.title}
                    </span>
                    {role === item.value && (
                      <span style={{ display: 'block', marginTop: '6px', fontSize: '10px', color: '#6de2ff' }}>
                        SELECTED
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>

            <button
              className="glass-login-button"
              type="submit"
              disabled={loading || success}
              style={{
                ...buttonStyle,
                opacity: loading || success ? 0.7 : 1,
              }}
            >
              {loading
                ? 'Creating account...'
                : success
                  ? 'Account Created'
                  : 'Create Account →'}
            </button>
          </form>

          {message && (
            <div
              role={success ? 'status' : 'alert'}
              aria-live="polite"
              style={{
                marginTop: '18px',
                padding: '12px',
                borderRadius: '10px',
                background: success ? 'rgba(16,185,129,.1)' : 'rgba(248,113,113,.1)',
                border: success
                  ? '1px solid rgba(52,211,153,.3)'
                  : '1px solid rgba(248,113,113,.25)',
                color: success ? '#6ee7b7' : '#fca5a5',
                fontSize: '12px',
                textAlign: 'center',
                lineHeight: 1.6,
                overflowWrap: 'anywhere',
              }}
            >
              {message}
            </div>
          )}

          {success && (
            <button
              className="glass-login-button"
              type="button"
              onClick={() => navigate('/login')}
              style={{
                ...buttonStyle,
                marginTop: '12px',
                border: '1px solid rgba(52,211,153,.4)',
                background: 'rgba(16,185,129,.12)',
                color: '#6ee7b7',
              }}
            >
              Continue to Login →
            </button>
          )}

          <p style={{ textAlign: 'center', margin: '24px 0 0', fontSize: '13px', color: '#9eb3d9' }}>
            Already have an account?{' '}
            <Link to="/login" style={{ fontWeight: 700, textDecoration: 'none' }}>
              Login
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}

export default Register;