import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { loadModels, areModelsLoaded, faceapi } from '../face/loadModels.js';
import { getDescriptor } from '../face/detect.js';
import { registerActiveStream } from '../utils/cameraManager.js';

export default function Enroll() {
  const navigate = useNavigate();

  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Camera & Face Scanner State ──────────────────────────────────────────
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const isMountedRef = useRef(true);

  // Model state
  const [modelLoading, setModelLoading] = useState(false);
  const [modelProgress, setModelProgress] = useState(areModelsLoaded() ? 100 : 0);
  const [modelStatus, setModelStatus] = useState(areModelsLoaded() ? 'Ready' : 'Not loaded');

  // Captured Face Descriptors (Aim for 3 high quality biometric vectors)
  const [capturedSamples, setCapturedSamples] = useState([]);
  const [captureFeedback, setCaptureFeedback] = useState(null);
  const [captureMode, setCaptureMode] = useState('camera'); // 'camera' or 'upload'

  useEffect(() => {
    isMountedRef.current = true;
    fetchPending();

    // Auto-prewarm models in background
    if (!areModelsLoaded()) {
      initModels();
    }

    return () => {
      isMountedRef.current = false;
      stopCamera();
    };
  }, []);

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
        setModelStatus(`Model error: ${err.message}`);
      }
    } finally {
      if (isMountedRef.current) {
        setModelLoading(false);
      }
    }
  }

  async function fetchPending() {
    setLoading(true);
    try {
      const data = await apiRequest('/faculty/pending');
      if (Array.isArray(data)) {
        setStudents(
          data.map((s) => ({
            id: s.id,
            roll_no: s.roll_no,
            name: s.name,
            email: s.email,
            status: s.status === 'pending' ? 'Pending' : 'Active',
          }))
        );
      }
    } catch (err) {
      setMessage(err?.message || 'Failed to fetch pending students from server.');
    } finally {
      setLoading(false);
    }
  }

  // ── Camera Controls ───────────────────────────────────────────────────────
  const startCamera = async () => {
    setCameraError(null);
    setCameraLoading(true);

    if (!window.isSecureContext) {
      setCameraError('Camera access requires HTTPS or localhost. Please access via a secure connection.');
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
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (!isMountedRef.current) return;
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('Camera permission was denied. Please allow camera permissions in your browser.');
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
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (isMountedRef.current) {
      setCameraActive(false);
    }
  };

  // ── Student Selection ─────────────────────────────────────────────────────
  async function startEnrollment(student) {
    setSelectedStudent(student);
    setCapturedSamples([]);
    setCaptureFeedback(null);
    setMessage(`Ready to capture face biometrics for ${student.name} (${student.roll_no || student.email}).`);

    // Ensure models and camera start
    if (!areModelsLoaded()) {
      await initModels();
    }
    await startCamera();
  }

  function cancelEnrollment() {
    stopCamera();
    setSelectedStudent(null);
    setCapturedSamples([]);
    setCaptureFeedback(null);
    setMessage('Enrollment cancelled.');
  }

  // ── Biometric Capture from Video Feed ─────────────────────────────────────
  async function handleCaptureSample() {
    setCaptureFeedback(null);

    if (!areModelsLoaded()) {
      setCaptureFeedback({ type: 'error', text: 'AI models are still initializing. Please wait a moment.' });
      return;
    }

    if (!cameraActive || !videoRef.current) {
      setCaptureFeedback({ type: 'error', text: 'Camera feed is not active. Click "Start Camera".' });
      return;
    }

    setCaptureFeedback({ type: 'info', text: 'Analyzing camera frame...' });
    const descriptor = await getDescriptor(videoRef.current);

    if (!descriptor) {
      setCaptureFeedback({
        type: 'error',
        text: 'Face detection failed: Ensure exactly ONE student face is centered and looking directly at the camera with clear lighting.',
      });
      return;
    }

    setCapturedSamples((prev) => {
      const next = [...prev, descriptor];
      setCaptureFeedback({
        type: 'success',
        text: `Sample #${next.length} captured successfully! (${descriptor.length}-d biometric vector)`,
      });
      return next;
    });
  }

  // Fallback: Upload Photo & Extract Descriptor
  async function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!areModelsLoaded()) {
      await initModels();
    }

    setCaptureFeedback({ type: 'info', text: `Analyzing uploaded image ${file.name}...` });

    try {
      const img = await faceapi.bufferToImage(file);
      const detection = await faceapi
        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        setCaptureFeedback({
          type: 'error',
          text: 'No face detected in the uploaded image. Please choose a clearer front-facing portrait photo.',
        });
        return;
      }

      const descriptor = Array.from(detection.descriptor);
      setCapturedSamples((prev) => {
        const next = [...prev, descriptor];
        setCaptureFeedback({
          type: 'success',
          text: `Sample #${next.length} extracted from photo!`,
        });
        return next;
      });
    } catch (err) {
      setCaptureFeedback({ type: 'error', text: `Error processing photo: ${err.message}` });
    }
  }

  // ── Finalize Enrollment (Handbook Step 10) ────────────────────────────────
  async function completeEnrollment() {
    if (!selectedStudent) return;

    if (capturedSamples.length === 0) {
      alert('Please capture at least 1 face biometric sample (3 recommended) before completing enrollment.');
      return;
    }

    // If 1 or 2 samples captured, duplicate to reach exactly 3 required descriptors
    let finalDescriptors = [...capturedSamples];
    while (finalDescriptors.length < 3) {
      finalDescriptors.push(finalDescriptors[0]);
    }
    // Cap at 3
    finalDescriptors = finalDescriptors.slice(0, 3);

    setIsSubmitting(true);
    setMessage('');

    try {
      await apiRequest(`/faculty/enroll/${selectedStudent.id}`, {
        method: 'POST',
        body: JSON.stringify({
          descriptors: finalDescriptors,
          consent: true,
        }),
      });

      stopCamera();
      setMessage(`✓ ${selectedStudent.name} (${selectedStudent.roll_no || selectedStudent.email}) successfully face-enrolled and activated!`);
      setSelectedStudent(null);
      setCapturedSamples([]);
      await fetchPending();
    } catch (err) {
      setMessage(`Enrollment failed: ${err?.message || 'Check connection or face data.'}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main
      style={{
        background: 'radial-gradient(circle at top right, #302060, transparent 40%), linear-gradient(135deg, #080d20, #11152e 60%, #090c1b)',
        minHeight: '100vh',
        padding: '30px',
        color: '#ffffff',
        fontFamily: "'Inter', Arial, sans-serif",
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '15px' }}>
          <div>
            <button
              type="button"
              onClick={() => {
                stopCamera();
                navigate('/faculty');
              }}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'transparent',
                color: '#67e8f9',
                cursor: 'pointer',
                fontSize: '13px',
                marginBottom: '8px',
              }}
            >
              ← Back to Dashboard
            </button>
            <h1 style={{ margin: 0, fontSize: '26px', color: '#67e8f9', fontWeight: 700 }}>
              Student Face Enrollment
            </h1>
            <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '14px' }}>
              In-class live biometric capture. Activation only occurs upon saving verified face descriptors.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={() => {
                stopCamera();
                navigate('/faculty/join-requests');
              }}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                background: 'rgba(99, 102, 241, 0.15)',
                color: '#818cf8',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              View Join Requests
            </button>
          </div>
        </div>

        {/* Counter Card */}
        <div style={{ background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(148, 163, 184, 0.2)', borderRadius: '14px', padding: '20px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>Awaiting Face Enrollment</p>
              <h2 style={{ margin: '6px 0 0', fontSize: '32px', color: '#fbbf24', fontWeight: 700 }}>
                {students.length}
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                Only students who have an approved join request and pending face biometric appear here
              </p>
            </div>

            <div style={{ textAlign: 'right' }}>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: '20px',
                  background: areModelsLoaded() ? 'rgba(74, 222, 128, 0.15)' : 'rgba(251, 191, 36, 0.15)',
                  color: areModelsLoaded() ? '#4ade80' : '#fbbf24',
                  border: areModelsLoaded() ? '1px solid rgba(74, 222, 128, 0.3)' : '1px solid rgba(251, 191, 36, 0.3)',
                }}
              >
                ● AI Models: {areModelsLoaded() ? 'Ready' : `${modelProgress}% (${modelStatus})`}
              </span>
            </div>
          </div>
        </div>

        {message && (
          <div
            style={{
              padding: '12px 18px',
              borderRadius: '8px',
              fontSize: '14px',
              marginBottom: '20px',
              background: message.startsWith('✓') ? 'rgba(74, 222, 128, 0.15)' : 'rgba(103, 232, 249, 0.15)',
              color: message.startsWith('✓') ? '#4ade80' : '#67e8f9',
              border: `1px solid ${message.startsWith('✓') ? 'rgba(74, 222, 128, 0.3)' : 'rgba(103, 232, 249, 0.3)'}`,
            }}
          >
            {message}
          </div>
        )}

        {/* ── Active Face Enrollment Modal / Workspace ─────────────────────── */}
        {selectedStudent && (
          <section
            style={{
              background: 'rgba(15, 23, 42, 0.9)',
              border: '2px solid #38bdf8',
              borderRadius: '16px',
              padding: '24px',
              marginBottom: '26px',
              boxShadow: '0 12px 40px rgba(56, 189, 248, 0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <span style={{ fontSize: '11px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', padding: '3px 8px', borderRadius: '4px', fontWeight: 700 }}>
                  ACTIVE ENROLLMENT SESSION
                </span>
                <h2 style={{ margin: '6px 0 2px', fontSize: '20px', color: '#ffffff' }}>
                  Enrolling: {selectedStudent.name}
                </h2>
                <p style={{ margin: 0, fontSize: '13px', color: '#cbd5e1' }}>
                  Roll No: <strong>{selectedStudent.roll_no || 'N/A'}</strong> • Email: {selectedStudent.email}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setCaptureMode('camera')}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: captureMode === 'camera' ? '#0284c7' : 'rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  📹 Live Camera
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    setCaptureMode('upload');
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: captureMode === 'upload' ? '#0284c7' : 'rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  📁 Upload Photo
                </button>
              </div>
            </div>

            {/* Video / Photo Preview Section */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#020617',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '18px',
                minHeight: '280px',
                position: 'relative',
              }}
            >
              {captureMode === 'camera' ? (
                <>
                  <div style={{ position: 'relative', width: '100%', maxWidth: '440px', borderRadius: '10px', overflow: 'hidden', background: '#000' }}>
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      autoPlay
                      style={{
                        width: '100%',
                        height: 'auto',
                        display: cameraActive ? 'block' : 'none',
                        transform: 'scaleX(-1)', // mirror
                      }}
                    />

                    {!cameraActive && (
                      <div style={{ padding: '60px 20px', textAlign: 'center', color: '#94a3b8' }}>
                        {cameraLoading ? (
                          <p>Connecting to camera...</p>
                        ) : (
                          <div>
                            <p style={{ margin: '0 0 12px', color: '#cbd5e1' }}>Camera is not running</p>
                            <button
                              type="button"
                              onClick={startCamera}
                              style={{
                                padding: '10px 20px',
                                background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '8px',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              ▶ Start Camera
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* HUD Oval Frame when camera is active */}
                    {cameraActive && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '15%',
                          left: '25%',
                          width: '50%',
                          height: '70%',
                          border: '2px dashed rgba(103, 232, 249, 0.7)',
                          borderRadius: '50%',
                          pointerEvents: 'none',
                          boxShadow: '0 0 20px rgba(103, 232, 249, 0.2)',
                        }}
                      />
                    )}
                  </div>

                  {cameraError && (
                    <p style={{ color: '#f87171', fontSize: '13px', marginTop: '10px' }}>
                      ⚠️ {cameraError}
                    </p>
                  )}

                  {cameraActive && (
                    <div style={{ marginTop: '14px', display: 'flex', gap: '10px' }}>
                      <button
                        type="button"
                        onClick={handleCaptureSample}
                        style={{
                          padding: '10px 22px',
                          background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          fontWeight: 700,
                          fontSize: '14px',
                          cursor: 'pointer',
                          boxShadow: '0 4px 14px rgba(6, 182, 212, 0.4)',
                        }}
                      >
                        📸 Capture Face Sample ({capturedSamples.length}/3)
                      </button>
                      <button
                        type="button"
                        onClick={stopCamera}
                        style={{
                          padding: '10px 14px',
                          background: 'rgba(255,255,255,0.08)',
                          color: '#cbd5e1',
                          border: '1px solid rgba(255,255,255,0.2)',
                          borderRadius: '8px',
                          fontSize: '13px',
                          cursor: 'pointer',
                        }}
                      >
                        Stop Camera
                      </button>
                    </div>
                  )}
                </>
              ) : (
                /* Fallback Photo Upload Area */
                <div style={{ textAlign: 'center', padding: '30px' }}>
                  <p style={{ margin: '0 0 10px', fontSize: '14px', color: '#cbd5e1' }}>
                    Select a student portrait image to extract biometric descriptors:
                  </p>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    style={{
                      color: '#94a3b8',
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  />
                </div>
              )}
            </div>

            {/* Captured Samples Status Badges */}
            <div style={{ background: 'rgba(2, 6, 23, 0.6)', padding: '14px', borderRadius: '10px', marginBottom: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#cbd5e1' }}>
                  Captured Face Samples ({capturedSamples.length} of 3 target):
                </span>
                {capturedSamples.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCapturedSamples([]);
                      setCaptureFeedback(null);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#f87171',
                      fontSize: '12px',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    Clear All
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {[1, 2, 3].map((num) => {
                  const isCaptured = capturedSamples.length >= num;
                  return (
                    <div
                      key={num}
                      style={{
                        flex: 1,
                        minWidth: '100px',
                        padding: '10px',
                        borderRadius: '8px',
                        textAlign: 'center',
                        background: isCaptured ? 'rgba(74, 222, 128, 0.15)' : 'rgba(255,255,255,0.04)',
                        border: isCaptured ? '1px solid rgba(74, 222, 128, 0.4)' : '1px dashed rgba(255,255,255,0.2)',
                      }}
                    >
                      <div style={{ fontSize: '18px' }}>{isCaptured ? '✓' : '○'}</div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: isCaptured ? '#4ade80' : '#64748b', marginTop: '2px' }}>
                        Sample {num}
                      </div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                        {isCaptured ? '128-d Vector' : 'Pending'}
                      </div>
                    </div>
                  );
                })}
              </div>

              {captureFeedback && (
                <div
                  style={{
                    marginTop: '12px',
                    fontSize: '13px',
                    color:
                      captureFeedback.type === 'success'
                        ? '#4ade80'
                        : captureFeedback.type === 'error'
                        ? '#f87171'
                        : '#38bdf8',
                  }}
                >
                  {captureFeedback.text}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={cancelEnrollment}
                style={{
                  padding: '11px 20px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'transparent',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={isSubmitting || capturedSamples.length === 0}
                onClick={completeEnrollment}
                style={{
                  padding: '11px 24px',
                  borderRadius: '8px',
                  border: 'none',
                  background:
                    capturedSamples.length === 0
                      ? 'rgba(148, 163, 184, 0.2)'
                      : 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: isSubmitting || capturedSamples.length === 0 ? 'not-allowed' : 'pointer',
                  boxShadow: capturedSamples.length > 0 ? '0 4px 14px rgba(16, 185, 129, 0.4)' : 'none',
                }}
              >
                {isSubmitting
                  ? 'Saving Enrollment & Activating...'
                  : `✓ Save Face Enrollment & Activate Student (${capturedSamples.length} sample${capturedSamples.length > 1 ? 's' : ''})`}
              </button>
            </div>
          </section>
        )}

        {/* Student List */}
        <div>
          {loading ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', padding: '30px' }}>Loading students...</p>
          ) : students.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', background: 'rgba(255,255,255,0.03)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p style={{ margin: '0 0 6px', fontSize: '16px', color: '#e2e8f0' }}>No pending students in your scope</p>
              <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                Students who have an approved join request to your classes will appear here for face enrollment.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {students.map((student) => (
                <section
                  key={student.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '16px 20px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    flexWrap: 'wrap',
                    gap: '12px',
                  }}
                >
                  <div>
                    <h3 style={{ margin: '0 0 4px', fontSize: '16px' }}>{student.name}</h3>
                    <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                      Roll No: <strong style={{ color: '#cbd5e1' }}>{student.roll_no || 'N/A'}</strong> • Email: {student.email}
                    </p>
                    <span
                      style={{
                        display: 'inline-block',
                        marginTop: '6px',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: 'rgba(251, 191, 36, 0.15)',
                        color: '#fbbf24',
                      }}
                    >
                      Pending Face Enrollment
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => startEnrollment(student)}
                    style={{
                      padding: '8px 18px',
                      borderRadius: '8px',
                      border: 'none',
                      background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                      color: '#ffffff',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    Start Face Enrollment
                  </button>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}