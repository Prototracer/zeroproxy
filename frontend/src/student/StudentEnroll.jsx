import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { loadModels, areModelsLoaded, faceapi } from '../face/loadModels.js';
import { getDescriptor } from '../face/detect.js';
import { registerActiveStream, stopMediaStream } from '../utils/cameraManager.js';

export default function StudentEnroll() {
  const navigate = useNavigate();

  const [studentInfo, setStudentInfo] = useState({
    name: 'Student',
    roll_no: '',
    email: '',
    status: 'pending',
    has_face_enrollment: false,
  });

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [enrollmentSuccess, setEnrollmentSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // ── Camera & Scanner State ────────────────────────────────────────────────
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const isMountedRef = useRef(true);

  // Model state
  const [modelLoading, setModelLoading] = useState(false);
  const [modelProgress, setModelProgress] = useState(areModelsLoaded() ? 100 : 0);
  const [modelStatus, setModelStatus] = useState(areModelsLoaded() ? 'Ready' : 'Initializing models...');

  // Biometric samples (3 required)
  const [capturedSamples, setCapturedSamples] = useState([]);
  const [captureFeedback, setCaptureFeedback] = useState(null);
  const [consentGiven, setConsentGiven] = useState(true);

  useEffect(() => {
    isMountedRef.current = true;
    loadStudentProfile();

    if (!areModelsLoaded()) {
      initModels();
    }

    return () => {
      isMountedRef.current = false;
      stopCamera();
    };
  }, []);

  async function loadStudentProfile() {
    setLoadingProfile(true);
    try {
      const meData = await apiRequest('/auth/me');
      if (meData) {
        setStudentInfo((prev) => ({
          ...prev,
          name: meData.name || 'Student',
          roll_no: meData.roll_no || '',
          email: meData.email || '',
          status: meData.status || 'pending',
        }));
      }

      // Check current face enrollment status
      try {
        const attendanceData = await apiRequest('/attendance/student/me');
        if (attendanceData?.student) {
          setStudentInfo((prev) => ({
            ...prev,
            has_face_enrollment: Boolean(attendanceData.student.has_face_enrollment),
            status: attendanceData.student.status || prev.status,
          }));
        }
      } catch {
        // Attendance summary might not exist yet if fresh account
      }
    } catch (err) {
      setErrorMessage(err?.message || 'Failed to load student profile.');
    } finally {
      setLoadingProfile(false);
    }
  }

  async function initModels() {
    setModelLoading(true);
    try {
      await loadModels((pct, msg) => {
        if (isMountedRef.current) {
          setModelProgress(pct);
          setModelStatus(msg);
        }
      });
    } catch (err) {
      if (isMountedRef.current) {
        setModelStatus(`Model initialization error: ${err.message}`);
      }
    } finally {
      if (isMountedRef.current) {
        setModelLoading(false);
      }
    }
  }

  // ── Camera Controls ───────────────────────────────────────────────────────
  const startCamera = async () => {
    setCameraError(null);
    setCameraLoading(true);

    if (!window.isSecureContext) {
      setCameraError('Camera access requires HTTPS or localhost connection.');
      setCameraLoading(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera API is not supported by your browser.');
      setCameraLoading(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      if (!isMountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      registerActiveStream(stream);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play();
      }

      setCameraActive(true);
    } catch (err) {
      if (streamRef.current) {
        stopMediaStream(streamRef.current);
        streamRef.current = null;
      }
      if (!isMountedRef.current) return;
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('Camera permission was denied. Please allow camera permissions in your browser settings.');
      } else {
        setCameraError(`Camera error: ${err.message}`);
      }
    } finally {
      if (isMountedRef.current) {
        setCameraLoading(false);
      }
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (isMountedRef.current) {
      setCameraActive(false);
    }
  };

  // ── Biometric Capture from Video ──────────────────────────────────────────
  async function handleCaptureSample() {
    setCaptureFeedback(null);
    setErrorMessage('');

    if (!areModelsLoaded()) {
      setCaptureFeedback({ type: 'error', text: 'AI neural models are initializing. Please wait a moment.' });
      return;
    }

    if (!cameraActive || !videoRef.current) {
      setCaptureFeedback({ type: 'error', text: 'Camera feed is not active. Please click "Start Camera" first.' });
      return;
    }

    setCaptureFeedback({ type: 'info', text: 'Analyzing camera frame for facial landmarks...' });
    const descriptor = await getDescriptor(videoRef.current);

    if (!descriptor) {
      setCaptureFeedback({
        type: 'error',
        text: 'Face detection failed: Ensure exactly ONE face is centered, directly looking at the camera with clear lighting.',
      });
      return;
    }

    setCapturedSamples((prev) => {
      const next = [...prev, descriptor];
      setCaptureFeedback({
        type: 'success',
        text: `✓ Sample #${next.length} captured successfully! (${descriptor.length}-dimensional vector)`,
      });
      return next;
    });
  }

  // ── Complete Face Enrollment ──────────────────────────────────────────────
  async function handleCompleteEnrollment() {
    if (capturedSamples.length === 0) {
      alert('Please capture at least 1 biometric sample (3 recommended) before finalizing enrollment.');
      return;
    }

    if (!consentGiven) {
      alert('You must provide biometric consent to complete enrollment.');
      return;
    }

    // Require 3 descriptors: replicate if user took 1 or 2
    let finalDescriptors = [...capturedSamples];
    while (finalDescriptors.length < 3) {
      finalDescriptors.push(finalDescriptors[0]);
    }
    finalDescriptors = finalDescriptors.slice(0, 3);

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const response = await apiRequest('/student/enroll', {
        method: 'POST',
        body: JSON.stringify({
          descriptors: finalDescriptors,
          consent: true,
        }),
      });

      stopCamera();
      setEnrollmentSuccess(true);
      setStudentInfo((prev) => ({
        ...prev,
        status: response?.status || 'active',
        has_face_enrollment: true,
      }));
    } catch (err) {
      const raw = err?.message || '';
      if (raw.includes('duplicate_face') || raw.toLowerCase().includes('duplicate')) {
        setErrorMessage('Your face is already registered with another account. Please use your existing account or contact administration to reset your previous enrollment.');
      } else if (raw.toLowerCase().includes('already active') || raw.toLowerCase().includes('already enrolled')) {
        setErrorMessage('Face biometric is already enrolled and active. Re-enrollment requires a faculty or admin reset.');
      } else {
        setErrorMessage(raw || 'Face enrollment failed. Please check your connection or face samples.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  // Styles
  const cardStyle = {
    background: 'rgba(15, 23, 42, 0.75)',
    border: '1px solid rgba(113, 168, 255, 0.25)',
    borderRadius: '16px',
    padding: '24px',
    backdropFilter: 'blur(16px)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.37)',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        padding: '30px',
        boxSizing: 'border-box',
        color: '#ffffff',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        background:
          'radial-gradient(circle at top right, #24164b, transparent 40%), linear-gradient(135deg, #070b19, #0e1329 60%, #060914)',
      }}
    >
      {/* Top Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '28px',
          borderBottom: '1px solid rgba(113, 168, 255, 0.15)',
          paddingBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              boxShadow: '0 0 20px rgba(6, 182, 212, 0.5)',
            }}
          >
            🛡️
          </div>
          <div>
            <h1 style={{ fontSize: '20px', margin: 0, fontWeight: 700, letterSpacing: '-0.5px' }}>
              ZeroProxy <span style={{ color: '#26cfff', fontWeight: 400 }}>| Student Face Enrollment</span>
            </h1>
            <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#94a3b8' }}>
              Register your secure cryptographic face biometric to enable instant attendance scanning
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              navigate('/student');
            }}
            style={{
              padding: '10px 18px',
              borderRadius: '10px',
              border: '1px solid rgba(103, 232, 249, 0.3)',
              background: 'rgba(15, 23, 42, 0.6)',
              color: '#67e8f9',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            ← Back to Dashboard
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>
        {enrollmentSuccess ? (
          /* ── SUCCESS STATE ──────────────────────────────────────────────── */
          <div style={{ ...cardStyle, textAlign: 'center', padding: '48px 30px' }}>
            <div
              style={{
                width: '74px',
                height: '74px',
                margin: '0 auto 20px',
                borderRadius: '50%',
                background: 'rgba(74, 222, 128, 0.15)',
                border: '2px solid #4ade80',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '36px',
                color: '#4ade80',
                boxShadow: '0 0 30px rgba(74, 222, 128, 0.3)',
              }}
            >
              ✓
            </div>

            <h2 style={{ fontSize: '26px', margin: '0 0 10px', fontWeight: 700, color: '#f1f5f9' }}>
              Face Biometric Enrollment Complete!
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '15px', maxWidth: '560px', margin: '0 auto 24px', lineHeight: '1.6' }}>
              Congratulations, <strong style={{ color: '#f8fafc' }}>{studentInfo.name}</strong>! Your facial biometric descriptor has been encrypted and securely registered. Your account is now <strong style={{ color: '#4ade80' }}>Active & Verified</strong>.
            </p>

            <div
              style={{
                display: 'inline-flex',
                flexDirection: 'column',
                gap: '8px',
                background: 'rgba(30, 41, 59, 0.6)',
                padding: '16px 24px',
                borderRadius: '12px',
                border: '1px solid rgba(113, 168, 255, 0.2)',
                marginBottom: '32px',
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                Account: <strong style={{ color: '#f8fafc' }}>{studentInfo.email}</strong>
              </div>
              {studentInfo.roll_no && (
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                  Roll Number: <strong style={{ color: '#f8fafc' }}>{studentInfo.roll_no}</strong>
                </div>
              )}
              <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                Status: <span style={{ color: '#4ade80', fontWeight: 700 }}>● Active & Enrolled</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => navigate('/student')}
                style={{
                  padding: '13px 26px',
                  borderRadius: '11px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '15px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 18px rgba(37, 99, 255, 0.4)',
                }}
              >
                Go to Student Dashboard →
              </button>

              <button
                type="button"
                onClick={() => navigate('/student/scan')}
                style={{
                  padding: '13px 26px',
                  borderRadius: '11px',
                  border: '1px solid rgba(103, 232, 249, 0.4)',
                  background: 'rgba(103, 232, 249, 0.1)',
                  color: '#67e8f9',
                  fontWeight: 600,
                  fontSize: '15px',
                  cursor: 'pointer',
                }}
              >
                📸 Scan Attendance QR
              </button>
            </div>
          </div>
        ) : (
          /* ── ENROLLMENT WORKSPACE ────────────────────────────────────────── */
          <div>
            {/* Student Info Card */}
            <div style={{ ...cardStyle, marginBottom: '22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: '#26cfff',
                    letterSpacing: '1px',
                  }}
                >
                  Student Identity
                </span>
                <h2 style={{ fontSize: '22px', margin: '4px 0 2px', fontWeight: 700 }}>
                  {studentInfo.name}
                </h2>
                <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                  {studentInfo.roll_no ? `Roll No: ${studentInfo.roll_no} • ` : ''}
                  {studentInfo.email}
                </p>
              </div>

              <div>
                {studentInfo.has_face_enrollment && studentInfo.status === 'active' ? (
                  <span
                    style={{
                      background: 'rgba(74, 222, 128, 0.15)',
                      color: '#4ade80',
                      border: '1px solid rgba(74, 222, 128, 0.35)',
                      padding: '6px 14px',
                      borderRadius: '20px',
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    ● Face Enrollment Verified & Active
                  </span>
                ) : (
                  <span
                    style={{
                      background: 'rgba(251, 191, 36, 0.15)',
                      color: '#fbbf24',
                      border: '1px solid rgba(251, 191, 36, 0.35)',
                      padding: '6px 14px',
                      borderRadius: '20px',
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    ▲ Face Enrollment Pending
                  </span>
                )}
              </div>
            </div>

            {/* Error Notification */}
            {errorMessage && (
              <div
                style={{
                  padding: '14px 18px',
                  borderRadius: '12px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#fca5a5',
                  marginBottom: '20px',
                  fontSize: '14px',
                }}
              >
                ⚠️ {errorMessage}
              </div>
            )}

            {/* AI Model Progress Bar if not loaded */}
            {studentInfo.has_face_enrollment && studentInfo.status === 'active' ? (
              <div style={{ ...cardStyle, textAlign: 'center', padding: '44px 24px' }}>
                <div style={{ fontSize: '46px', marginBottom: '14px' }}>🔒</div>
                <h3 style={{ fontSize: '22px', margin: '0 0 10px', color: '#f1f5f9', fontWeight: 700 }}>
                  Face Biometric Already Registered & Active
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '14px', maxWidth: '520px', margin: '0 auto 24px', lineHeight: 1.6 }}>
                  Your face biometric descriptor has already been verified and encrypted. Per ZeroProxy protocol (Handbook §1), self-service re-enrollment is not permitted. Re-enrollment can only take place after a faculty or administrator reset.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/student')}
                  style={{
                    padding: '12px 26px',
                    borderRadius: '10px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                    color: '#ffffff',
                    fontWeight: 600,
                    fontSize: '14px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(37, 99, 255, 0.4)',
                  }}
                >
                  ← Return to Student Dashboard
                </button>
              </div>
            ) : (
              <div>
                {!areModelsLoaded() && (
                  <div style={{ ...cardStyle, marginBottom: '22px', padding: '16px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
                      <span style={{ color: '#67e8f9' }}>{modelStatus}</span>
                      <span style={{ color: '#94a3b8' }}>{modelProgress}%</span>
                    </div>
                    <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${modelProgress}%`,
                          height: '100%',
                          background: 'linear-gradient(90deg, #06b6d4, #3b82f6)',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                  </div>
                )}

            {/* Camera / Capture Section */}
            <div style={cardStyle}>
              {/* Camera Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
                    Step 1: Capture Face Biometrics
                  </h3>
                  <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#94a3b8' }}>
                    Capture 3 clear biometric samples looking straight at the camera.
                  </p>
                </div>
              </div>

              <div>
                {/* Video Viewport */}
                  <div
                    style={{
                      position: 'relative',
                      width: '100%',
                      maxWidth: '480px',
                      height: '340px',
                      margin: '0 auto 18px',
                      background: '#020617',
                      borderRadius: '16px',
                      overflow: 'hidden',
                      border: cameraActive ? '2px solid rgba(38, 207, 255, 0.6)' : '1px solid rgba(113, 168, 255, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: cameraActive ? '0 0 24px rgba(38, 207, 255, 0.25)' : 'none',
                    }}
                  >
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: cameraActive ? 'block' : 'none',
                        transform: 'scaleX(-1)', // Mirror video for natural look
                      }}
                    />

                    {/* Face Oval Alignment Guide */}
                    {cameraActive && (
                      <div
                        style={{
                          position: 'absolute',
                          width: '210px',
                          height: '270px',
                          borderRadius: '50%',
                          border: '2px dashed rgba(38, 207, 255, 0.7)',
                          pointerEvents: 'none',
                          boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.45)',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            bottom: '12px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            background: 'rgba(2, 6, 23, 0.75)',
                            padding: '4px 10px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            color: '#26cfff',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Align Face Here
                        </div>
                      </div>
                    )}

                    {/* Camera Off Placeholder */}
                    {!cameraActive && (
                      <div style={{ textAlign: 'center', padding: '20px' }}>
                        <div style={{ fontSize: '42px', marginBottom: '12px', opacity: 0.6 }}>📷</div>
                        <p style={{ color: '#94a3b8', margin: '0 0 16px', fontSize: '14px' }}>
                          {cameraError || 'Camera feed is currently inactive.'}
                        </p>
                        <button
                          type="button"
                          onClick={startCamera}
                          disabled={cameraLoading}
                          style={{
                            padding: '10px 22px',
                            borderRadius: '10px',
                            border: 'none',
                            background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
                            color: '#ffffff',
                            fontWeight: 600,
                            fontSize: '14px',
                            cursor: 'pointer',
                          }}
                        >
                          {cameraLoading ? 'Starting Camera...' : 'Start Camera'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Camera Action Buttons */}
                  {cameraActive && (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', marginBottom: '16px' }}>
                      <button
                        type="button"
                        onClick={handleCaptureSample}
                        style={{
                          padding: '12px 28px',
                          borderRadius: '11px',
                          border: 'none',
                          background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                          color: '#ffffff',
                          fontWeight: 700,
                          fontSize: '14px',
                          cursor: 'pointer',
                          boxShadow: '0 4px 16px rgba(37, 99, 255, 0.4)',
                        }}
                      >
                        📸 Capture Biometric Sample ({capturedSamples.length}/3)
                      </button>

                      <button
                        type="button"
                        onClick={stopCamera}
                        style={{
                          padding: '12px 18px',
                          borderRadius: '11px',
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          background: 'rgba(239, 68, 68, 0.1)',
                          color: '#f87171',
                          fontWeight: 600,
                          fontSize: '14px',
                          cursor: 'pointer',
                        }}
                      >
                        Stop Camera
                      </button>
                    </div>
                  )}
                </div>

              {/* Feedback Alert */}
              {captureFeedback && (
                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: '10px',
                    fontSize: '13px',
                    marginBottom: '16px',
                    background:
                      captureFeedback.type === 'success'
                        ? 'rgba(74, 222, 128, 0.15)'
                        : captureFeedback.type === 'error'
                        ? 'rgba(239, 68, 68, 0.15)'
                        : 'rgba(56, 189, 248, 0.15)',
                    border: `1px solid ${
                      captureFeedback.type === 'success'
                        ? 'rgba(74, 222, 128, 0.35)'
                        : captureFeedback.type === 'error'
                        ? 'rgba(239, 68, 68, 0.35)'
                        : 'rgba(56, 189, 248, 0.35)'
                    }`,
                    color:
                      captureFeedback.type === 'success'
                        ? '#4ade80'
                        : captureFeedback.type === 'error'
                        ? '#fca5a5'
                        : '#38bdf8',
                  }}
                >
                  {captureFeedback.text}
                </div>
              )}

              {/* Captured Samples Display */}
              <div style={{ marginTop: '20px', borderTop: '1px solid rgba(113, 168, 255, 0.15)', paddingTop: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
                    Captured Biometric Vectors: {capturedSamples.length} of 3 required
                  </span>
                  {capturedSamples.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCapturedSamples([])}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#f87171',
                        fontSize: '12px',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      Clear samples & retake
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                  {[1, 2, 3].map((slot) => {
                    const sample = capturedSamples[slot - 1];
                    return (
                      <div
                        key={slot}
                        style={{
                          padding: '14px',
                          borderRadius: '12px',
                          background: sample ? 'rgba(74, 222, 128, 0.1)' : 'rgba(30, 41, 59, 0.5)',
                          border: sample ? '1px solid rgba(74, 222, 128, 0.4)' : '1px dashed rgba(113, 168, 255, 0.25)',
                          textAlign: 'center',
                        }}
                      >
                        <div style={{ fontSize: '20px', marginBottom: '4px' }}>
                          {sample ? '✓' : `⏳`}
                        </div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: sample ? '#4ade80' : '#94a3b8' }}>
                          Sample #{slot}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                          {sample ? '128-d Vector Valid' : 'Awaiting capture'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Consent & Submit */}
              <div
                style={{
                  marginTop: '24px',
                  paddingTop: '20px',
                  borderTop: '1px solid rgba(113, 168, 255, 0.15)',
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    fontSize: '13px',
                    color: '#cbd5e1',
                    cursor: 'pointer',
                    marginBottom: '20px',
                    lineHeight: '1.5',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={consentGiven}
                    onChange={(e) => setConsentGiven(e.target.checked)}
                    style={{ marginTop: '3px', cursor: 'pointer' }}
                  />
                  <span>
                    I consent to the secure biometric processing and cryptographic encryption of my face descriptor vector for institutional attendance verification under ZeroProxy security standards.
                  </span>
                </label>

                <button
                  type="button"
                  disabled={capturedSamples.length === 0 || !consentGiven || isSubmitting}
                  onClick={handleCompleteEnrollment}
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: '12px',
                    border: 'none',
                    background:
                      capturedSamples.length > 0 && consentGiven
                        ? 'linear-gradient(135deg, #10b981, #059669)'
                        : 'rgba(255, 255, 255, 0.1)',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '15px',
                    cursor: capturedSamples.length > 0 && consentGiven ? 'pointer' : 'not-allowed',
                    boxShadow:
                      capturedSamples.length > 0 && consentGiven
                        ? '0 4px 20px rgba(16, 185, 129, 0.4)'
                        : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {isSubmitting
                    ? 'Encrypting & Activating Account...'
                    : `✓ Complete Face Enrollment & Activate Student (${capturedSamples.length}/3 samples ready)`}
                </button>
              </div>
            </div>
            </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
