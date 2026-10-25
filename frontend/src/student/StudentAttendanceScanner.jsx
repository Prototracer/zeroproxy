import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { apiRequest } from '../api/client.js';
import { loadModels, areModelsLoaded } from '../face/loadModels.js';
import { captureChallenge, getChallengeInfo } from '../face/liveness.js';
import { registerActiveStream, stopAllGlobalCameras } from '../utils/cameraManager.js';

export default function StudentAttendanceScanner() {
  const navigate = useNavigate();

  // Workflow steps: 'qr_scan' -> 'qr_validated' -> 'face_verify' -> 'success' | 'already_marked' | 'not_enrolled' | 'session_ended' | 'no_face' | 'error'
  const [step, setStep] = useState('qr_scan');
  const [statusMessage, setStatusMessage] = useState('Position your camera over the lecture QR code.');
  const [errorMessage, setErrorMessage] = useState('');
  const [redirectCountdown, setRedirectCountdown] = useState(0);

  // Scanned QR & Ticket state
  const [ticketInfo, setTicketInfo] = useState(null); // { ticket_id, nonce, challenge, session_id }
  const [isProcessing, setIsProcessing] = useState(false);

  // Model & Camera state
  const [modelsReady, setModelsReady] = useState(areModelsLoaded());
  const [modelProgress, setModelProgress] = useState(areModelsLoaded() ? 100 : 0);

  // Face Verification Video Stream
  const faceVideoRef = useRef(null);
  const faceStreamRef = useRef(null);
  const [faceCameraActive, setFaceCameraActive] = useState(false);
  const [challengeFeedback, setChallengeFeedback] = useState('');
  const [markedResult, setMarkedResult] = useState(null);

  // Sequential Multi-Stage Verification State
  const [activeChallengeStep, setActiveChallengeStep] = useState(1);
  const [step1Done, setStep1Done] = useState(false);
  const [step2Done, setStep2Done] = useState(false);
  const [challengeRetryState, setChallengeRetryState] = useState({
    hasFailed: false,
    needsRescan: false,
    reason: '',
  });

  // Html5Qrcode instance & race-condition lock
  const html5QrCodeRef = useRef(null);
  const isScanningLockedRef = useRef(false);
  const qrRegionId = 'zeroproxy-qr-reader';
  const isMountedRef = useRef(true);

  // Ref tracking if the QR scanner is actively running or transitioning
  const isQrRunningRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;

    // Pre-load face-api models in background while student is scanning QR
    if (!areModelsLoaded()) {
      loadModels((pct) => {
        if (isMountedRef.current) {
          setModelProgress(pct);
          if (pct >= 100) setModelsReady(true);
        }
      }).catch((err) => {
        console.warn('Face models pre-warm error:', err);
      });
    }

    // Delay scanner startup slightly to allow DOM layout to stabilize and prevent StrictMode race
    const timer = setTimeout(() => {
      if (isMountedRef.current && step === 'qr_scan') {
        startQrScanner();
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      isMountedRef.current = false;
      stopAllCameras();
    };
  }, []);

  // Automatic redirect timer when user encounters terminal error (e.g. not enrolled or session ended)
  useEffect(() => {
    if (step === 'not_enrolled' || step === 'session_ended') {
      setRedirectCountdown(6);
      const timer = setInterval(() => {
        setRedirectCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            handleLeave();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [step]);

  // Comprehensive camera hardware release helper
  function stopAllCameras() {
    // 1. Stop face camera stream
    if (faceStreamRef.current) {
      try {
        faceStreamRef.current.getTracks().forEach((track) => {
          track.stop();
          track.enabled = false;
        });
      } catch {
        // ignore
      }
      faceStreamRef.current = null;
    }
    if (faceVideoRef.current) {
      try {
        faceVideoRef.current.pause();
        faceVideoRef.current.srcObject = null;
      } catch {
        // ignore
      }
    }
    setFaceCameraActive(false);

    // 2. Stop QR code scanner
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          html5QrCodeRef.current
            .stop()
            .catch(() => {})
            .finally(() => {
              try {
                html5QrCodeRef.current?.clear();
              } catch {}
            });
        } else {
          html5QrCodeRef.current.clear();
        }
      } catch {
        // ignore
      }
      html5QrCodeRef.current = null;
    }

    const container = document.getElementById(qrRegionId);
    if (container) {
      container.innerHTML = '';
    }

    // 3. Central global camera teardown
    stopAllGlobalCameras();
  }

  // ── Step 1: QR Scanning with html5-qrcode ─────────────────────────────────
  async function startQrScanner() {
    if (isQrRunningRef.current) return;
    isQrRunningRef.current = true;
    isScanningLockedRef.current = false;
    setErrorMessage('');
    setIsProcessing(false);

    try {
      // 1. Thoroughly clean any previous scanner instance
      if (html5QrCodeRef.current) {
        try {
          if (html5QrCodeRef.current.isScanning) {
            await html5QrCodeRef.current.stop();
          }
          html5QrCodeRef.current.clear();
        } catch {
          // ignore
        }
        html5QrCodeRef.current = null;
      }

      // 2. Prevent duplicate video elements by wiping container innerHTML
      const container = document.getElementById(qrRegionId);
      if (container) {
        container.innerHTML = '';
      }

      if (!isMountedRef.current) {
        isQrRunningRef.current = false;
        return;
      }

      const qrScanner = new Html5Qrcode(qrRegionId);
      html5QrCodeRef.current = qrScanner;

      await qrScanner.start(
        { facingMode: 'environment' }, // Back camera for scanning lecture QR
        {
          fps: 10,
          qrbox: { width: 260, height: 260 },
          aspectRatio: 1.0,
        },
        async (decodedText) => {
          // Synchronous guard against multiple frame triggers (prevents loops & flickering)
          if (isScanningLockedRef.current) return;
          isScanningLockedRef.current = true;

          try {
            if (html5QrCodeRef.current?.isScanning) {
              html5QrCodeRef.current.pause(true);
            }
          } catch {
            // ignore
          }

          await handleQrDecoded(decodedText);
        },
        () => {
          // Ignore scanning search frames
        }
      );

      // Once scanner starts, purge any duplicate secondary video elements if injected
      if (container) {
        const videos = container.querySelectorAll('video');
        if (videos.length > 1) {
          for (let i = 1; i < videos.length; i++) {
            try {
              if (videos[i].srcObject && typeof videos[i].srcObject.getTracks === 'function') {
                videos[i].srcObject.getTracks().forEach((t) => t.stop());
              }
              videos[i].remove();
            } catch {}
          }
        }
      }
    } catch (err) {
      isQrRunningRef.current = false;
      if (!isMountedRef.current) return;
      setErrorMessage(`Camera access error: ${err?.message || 'Could not access device camera for QR scanning.'}`);
    }
  }

  async function stopQrScanner() {
    isQrRunningRef.current = false;
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        html5QrCodeRef.current.clear();
      } catch {
        // ignore
      }
      html5QrCodeRef.current = null;
    }

    const container = document.getElementById(qrRegionId);
    if (container) {
      const vids = container.querySelectorAll('video');
      vids.forEach((v) => {
        try {
          if (v.srcObject && typeof v.srcObject.getTracks === 'function') {
            v.srcObject.getTracks().forEach((t) => t.stop());
          }
          v.pause();
          v.remove();
        } catch {}
      });
      container.innerHTML = '';
    }
  }

  // ── Step 2: Validate QR token on Backend (/attendance/scan) ────────────────
  async function handleQrDecoded(rawText) {
    setIsProcessing(true);

    try {
      let payload;
      try {
        payload = JSON.parse(rawText);
      } catch {
        throw new Error('Scanned code is not a valid ZeroProxy lecture QR code.');
      }

      if (!payload.session_id || payload.window === undefined || !payload.mac) {
        throw new Error('Invalid QR format: missing session, window, or HMAC signature.');
      }

      setStatusMessage('Validating rotating lecture token with backend...');

      // Stop QR camera immediately after capturing valid payload
      await stopQrScanner();

      // Submit to backend POST /attendance/scan
      const scanRes = await apiRequest('/attendance/scan', {
        method: 'POST',
        body: JSON.stringify({
          session_id: Number(payload.session_id),
          window: Number(payload.window),
          mac: String(payload.mac),
        }),
      });

      setTicketInfo(scanRes);
      setStep('qr_validated');
      setStatusMessage('✓ QR Token Verified! Next: Complete instant face liveness verification.');
    } catch (err) {
      const errDetail = String(err?.message || '');

      // 1. Check for Already Marked Attendance
      if (errDetail.includes('already_marked') || errDetail.toLowerCase().includes('already marked')) {
        await stopQrScanner();
        stopAllGlobalCameras();
        setStep('already_marked');
        setIsProcessing(false);
        return;
      }

      // 2. Check for Not Enrolled in Course / Class Not Joined
      if (
        errDetail.toLowerCase().includes('not enrolled') ||
        errDetail.toLowerCase().includes('not joined') ||
        errDetail.toLowerCase().includes('course')
      ) {
        await stopQrScanner();
        stopAllGlobalCameras();
        setStep('not_enrolled');
        setErrorMessage(
          'You have not joined this class yet. Please join the course from your student dashboard and wait for instructor approval before marking attendance.'
        );
        setIsProcessing(false);
        return;
      }

      // 3. Check for Session Ended / Inactive
      if (
        errDetail.toLowerCase().includes('session_ended') ||
        errDetail.toLowerCase().includes('session ended')
      ) {
        await stopQrScanner();
        stopAllGlobalCameras();
        setStep('session_ended');
        setErrorMessage('This lecture attendance session has ended or is no longer active.');
        setIsProcessing(false);
        return;
      }

      // 4. Check for No Active Face Biometrics
      if (errDetail.toLowerCase().includes('face enrollment')) {
        await stopQrScanner();
        stopAllGlobalCameras();
        setStep('no_face');
        setErrorMessage('Face biometric enrollment is required before marking attendance.');
        setIsProcessing(false);
        return;
      }

      // 5. Temporary QR validation error (expired rotating window / invalid MAC)
      setErrorMessage(err?.message || 'Failed to validate QR code. It may have expired. Please scan again.');
      setIsProcessing(false);

      // Re-enable scanning after 2.5s delay if still on scan step
      setTimeout(() => {
        if (isMountedRef.current && step === 'qr_scan') {
          isScanningLockedRef.current = false;
          startQrScanner();
        }
      }, 2500);
    }
  }

  // ── Step 3: Transition to Face Scanning ────────────────────────────────────
  async function proceedToFaceVerification() {
    setStep('face_verify');
    setErrorMessage('');
    setChallengeRetryState({ hasFailed: false, needsRescan: false, reason: '' });
    setActiveChallengeStep(1);
    setStep1Done(false);
    setStep2Done(false);
    setStatusMessage('Preparing facial scanner...');

    // Ensure models are loaded
    if (!areModelsLoaded()) {
      setStatusMessage('Loading AI face models...');
      await loadModels();
      setModelsReady(true);
    }

    // Start Front-Facing Camera
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user', // Front camera for student face verification
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      registerActiveStream(stream);
      faceStreamRef.current = stream;

      if (faceVideoRef.current) {
        faceVideoRef.current.srcObject = stream;
        faceVideoRef.current.muted = true;
        await faceVideoRef.current.play();
      }

      setFaceCameraActive(true);
      setStatusMessage('Look directly at the front camera and follow the prompt...');

      // Auto-initiate liveness challenge capture after brief 1s warmup
      setTimeout(() => {
        if (isMountedRef.current) {
          executeLivenessChallenge();
        }
      }, 1000);
    } catch (err) {
      setErrorMessage(`Front camera error: ${err.message}. Please allow camera access to verify your face.`);
    }
  }

  function stopFaceCamera() {
    if (faceStreamRef.current) {
      faceStreamRef.current.getTracks().forEach((t) => t.stop());
      faceStreamRef.current = null;
    }
    if (faceVideoRef.current) {
      faceVideoRef.current.srcObject = null;
    }
    setFaceCameraActive(false);
  }

  // ── Step 4: Run Liveness Challenge & Submit Attendance ────────────────────
  async function executeLivenessChallenge() {
    if (!faceVideoRef.current || !ticketInfo) return;
    setIsProcessing(true);
    setChallengeRetryState({ hasFailed: false, needsRescan: false, reason: '' });
    setActiveChallengeStep(1);
    setStep1Done(false);
    setStep2Done(false);

    const info = getChallengeInfo(ticketInfo.challenge);
    setChallengeFeedback(
      info.isCombo
        ? `${info.icon} ${info.step1Instruction}`
        : `${info.icon} ${info.instruction}`
    );

    try {
      const result = await captureChallenge(
        faceVideoRef.current,
        ticketInfo,
        (feedback) => {
          if (!isMountedRef.current) return;
          setChallengeFeedback(feedback.message);
          if (feedback.currentStep) setActiveChallengeStep(feedback.currentStep);
          if (feedback.step1Verified !== undefined) setStep1Done(feedback.step1Verified);
          if (feedback.step2Verified !== undefined) setStep2Done(feedback.step2Verified);
        }
      );

      if (!isMountedRef.current) return;

      if (!result.success) {
        // Challenge not completed or detected in time locally:
        // The ticket has NOT been submitted to the server yet, so the ticket remains 100% fresh!
        setChallengeRetryState({
          hasFailed: true,
          needsRescan: false,
          reason: result.reason || 'Challenge movement was not detected. Please try again.',
        });
        setChallengeFeedback('Challenge incomplete. Tap "Try Challenge Again" to re-attempt.');
        setIsProcessing(false);
        return;
      }

      setChallengeFeedback('✓ Challenge complete! Submitting verification to server...');

      // Submit to POST /attendance/submit
      const submitRes = await apiRequest('/attendance/submit', {
        method: 'POST',
        body: JSON.stringify(result.payload),
      });

      if (!isMountedRef.current) return;

      stopAllCameras();
      setMarkedResult(submitRes);
      setStep('success');
      setStatusMessage('✓ Attendance marked successfully!');
    } catch (err) {
      if (!isMountedRef.current) return;

      const errText = err?.message || 'Biometric verification failed.';

      // Check if already marked
      if (errText.includes('already_marked') || errText.toLowerCase().includes('already marked')) {
        stopAllCameras();
        setStep('already_marked');
        return;
      }

      // Check if fatal terminal error (over limit or session closed or not enrolled)
      if (
        errText.includes('too_many_attempts') ||
        errText.includes('session_ended') ||
        errText.includes('Account is pending') ||
        errText.toLowerCase().includes('not enrolled') ||
        errText.toLowerCase().includes('course')
      ) {
        stopAllCameras();
        if (errText.toLowerCase().includes('not enrolled') || errText.toLowerCase().includes('course')) {
          setStep('not_enrolled');
          setErrorMessage(
            'You have not joined this class yet. Please join the course from your student dashboard before marking attendance.'
          );
        } else {
          setStep('error');
          setErrorMessage(errText);
        }
      } else {
        // Server rejected the submission. Since the ticket was consumed by the server,
        // the student must re-scan the QR code to get a fresh ticket.
        setChallengeRetryState({
          hasFailed: true,
          needsRescan: true,
          reason: `Verification attempt failed: ${errText}. Please re-scan the lecture QR code for a fresh ticket.`,
        });
        setChallengeFeedback('Server verification was not satisfied. Please scan again.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsProcessing(false);
      }
    }
  }

  function retryFaceChallenge() {
    setChallengeRetryState({ hasFailed: false, needsRescan: false, reason: '' });
    setActiveChallengeStep(1);
    setStep1Done(false);
    setStep2Done(false);
    executeLivenessChallenge();
  }

  function handleLeave() {
    stopAllCameras();
    navigate('/student');
  }

  function handleRetryFromScratch() {
    stopFaceCamera();
    stopQrScanner();
    stopAllGlobalCameras();
    setStep('qr_scan');
    setTicketInfo(null);
    setErrorMessage('');
    setMarkedResult(null);
    setChallengeRetryState({ hasFailed: false, needsRescan: false, reason: '' });
    setTimeout(() => {
      startQrScanner();
    }, 400);
  }

  const challengeInfo = ticketInfo ? getChallengeInfo(ticketInfo.challenge) : null;

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(circle at top right, #302060, transparent 40%), linear-gradient(135deg, #080d20, #11152e 60%, #090c1b)',
        color: '#ffffff',
        fontFamily: "'Inter', Arial, sans-serif",
        padding: '24px 16px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <div style={{ width: '100%', maxWidth: '480px' }}>
        {/* Navigation / Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <button
            type="button"
            onClick={handleLeave}
            style={{
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent',
              color: '#67e8f9',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            ← Back to Dashboard
          </button>

          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: '6px',
              background: 'rgba(99, 102, 241, 0.25)',
              color: '#a5b4fc',
              letterSpacing: '0.05em',
            }}
          >
            ZERO-PROXY VERIFICATION
          </span>
        </div>

        {/* Progress Step Indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(15, 23, 42, 0.8)',
            border: '1px solid rgba(148, 163, 184, 0.2)',
            borderRadius: '12px',
            padding: '12px 18px',
            marginBottom: '20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background: step === 'qr_scan' ? '#06b6d4' : '#10b981',
                color: '#ffffff',
                display: 'grid',
                placeItems: 'center',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              {step === 'qr_scan' ? '1' : '✓'}
            </span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: step === 'qr_scan' ? '#67e8f9' : '#cbd5e1' }}>
              Scan QR
            </span>
          </div>

          <span style={{ color: '#64748b' }}>➔</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background:
                  step === 'face_verify'
                    ? '#06b6d4'
                    : step === 'success' || step === 'already_marked'
                    ? '#10b981'
                    : 'rgba(255,255,255,0.1)',
                color: '#ffffff',
                display: 'grid',
                placeItems: 'center',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              {step === 'success' || step === 'already_marked' ? '✓' : '2'}
            </span>
            <span
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color:
                  step === 'face_verify'
                    ? '#67e8f9'
                    : step === 'already_marked' || step === 'success'
                    ? '#4ade80'
                    : '#94a3b8',
              }}
            >
              {step === 'already_marked' ? 'Already Verified' : 'Face Verification'}
            </span>
          </div>
        </div>

        {/* ── CARD 1: QR SCANNER STEP ── */}
        {step === 'qr_scan' && (
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid rgba(103, 232, 249, 0.3)',
              borderRadius: '16px',
              padding: '22px',
              textAlign: 'center',
              boxShadow: '0 12px 36px rgba(0,0,0,0.4)',
            }}
          >
            <h2 style={{ margin: '0 0 6px', fontSize: '20px', color: '#67e8f9' }}>
              Scan Classroom QR Code
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#cbd5e1' }}>
              Point your camera at the rotating QR code on your instructor's screen.
            </p>

            {errorMessage && (
              <div
                style={{
                  marginBottom: '14px',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  background: 'rgba(239, 68, 68, 0.2)',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  color: '#fca5a5',
                  fontSize: '13px',
                  fontWeight: 600,
                  textAlign: 'center',
                }}
              >
                ⚠️ {errorMessage}
              </div>
            )}

            <div
              id={qrRegionId}
              style={{
                width: '100%',
                maxWidth: '360px',
                margin: '0 auto 16px',
                borderRadius: '12px',
                overflow: 'hidden',
                background: '#000000',
                minHeight: '260px',
              }}
            />

            <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
              {statusMessage}
            </p>
          </div>
        )}

        {/* ── CARD 2: QR VALIDATED STEP ── */}
        {step === 'qr_validated' && ticketInfo && challengeInfo && (
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.9)',
              border: '2px solid #10b981',
              borderRadius: '16px',
              padding: '24px',
              textAlign: 'center',
              boxShadow: '0 12px 36px rgba(16, 185, 129, 0.25)',
            }}
          >
            <div style={{ fontSize: '44px', marginBottom: '10px' }}>✓</div>
            <h2 style={{ margin: '0 0 8px', fontSize: '20px', color: '#34d399' }}>
              QR Code Verified!
            </h2>
            <p style={{ margin: '0 0 18px', fontSize: '14px', color: '#e2e8f0' }}>
              Session #{ticketInfo.session_id} token confirmed by server. A single-use verification ticket has been issued.
            </p>

            <div
              style={{
                background: 'rgba(2, 6, 23, 0.7)',
                padding: '14px',
                borderRadius: '10px',
                marginBottom: '20px',
                textAlign: 'left',
                fontSize: '13px',
                color: '#cbd5e1',
              }}
            >
              <div>• Ticket ID: <code style={{ color: '#67e8f9' }}>{ticketInfo.ticket_id?.slice(0, 14)}...</code></div>
              <div style={{ marginTop: '6px' }}>
                • Required Challenge: <strong style={{ color: '#fbbf24' }}>{challengeInfo.title}</strong>
              </div>
              <div style={{ marginTop: '4px', color: '#67e8f9', fontWeight: 600 }}>
                • Action: {challengeInfo.instruction}
              </div>
              <div style={{ marginTop: '6px', fontSize: '12px', color: '#94a3b8' }}>• Window: Active session</div>
            </div>

            <button
              type="button"
              onClick={proceedToFaceVerification}
              style={{
                width: '100%',
                padding: '13px',
                background: 'linear-gradient(135deg, #06b6d4, #2563eb)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '10px',
                fontWeight: 700,
                fontSize: '15px',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(6, 182, 212, 0.4)',
              }}
            >
              Start {challengeInfo.title} →
            </button>
          </div>
        )}

        {/* ── CARD 3: FACE VERIFICATION & LIVENESS STEP ── */}
        {step === 'face_verify' && (
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.9)',
              border: '2px solid #38bdf8',
              borderRadius: '16px',
              padding: '22px',
              textAlign: 'center',
              boxShadow: '0 12px 36px rgba(56, 189, 248, 0.25)',
            }}
          >
            <h2 style={{ margin: '0 0 6px', fontSize: '20px', color: '#67e8f9' }}>
              {challengeInfo ? challengeInfo.title : 'Facial Biometric Verification'}
            </h2>

            {/* Sequential Progress Indicators for Combo Challenges */}
            {challengeInfo?.isCombo && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  margin: '10px 0 14px',
                }}
              >
                {/* Step 1 Badge */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    background: step1Done
                      ? 'rgba(16, 185, 129, 0.25)'
                      : activeChallengeStep === 1
                      ? 'rgba(6, 182, 212, 0.25)'
                      : 'rgba(255,255,255,0.06)',
                    border: step1Done
                      ? '1px solid #10b981'
                      : activeChallengeStep === 1
                      ? '1px solid #06b6d4'
                      : '1px solid rgba(255,255,255,0.15)',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: step1Done ? '#4ade80' : activeChallengeStep === 1 ? '#67e8f9' : '#94a3b8',
                  }}
                >
                  <span>{step1Done ? '✓' : '1'}</span>
                  <span>{challengeInfo.step1Name || 'Step 1'}</span>
                </div>

                <span style={{ color: '#64748b', fontSize: '12px' }}>➔</span>

                {/* Step 2 Badge */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    background: step2Done
                      ? 'rgba(16, 185, 129, 0.25)'
                      : activeChallengeStep === 2
                      ? 'rgba(6, 182, 212, 0.25)'
                      : 'rgba(255,255,255,0.06)',
                    border: step2Done
                      ? '1px solid #10b981'
                      : activeChallengeStep === 2
                      ? '1px solid #06b6d4'
                      : '1px solid rgba(255,255,255,0.15)',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: step2Done ? '#4ade80' : activeChallengeStep === 2 ? '#67e8f9' : '#94a3b8',
                  }}
                >
                  <span>{step2Done ? '✓' : '2'}</span>
                  <span>{challengeInfo.step2Name || 'Step 2'}</span>
                </div>
              </div>
            )}

            <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#cbd5e1', fontWeight: 600 }}>
              {challengeInfo ? challengeInfo.instruction : 'Hold phone at eye level.'}
            </p>

            {/* Video preview with oval guide */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                maxWidth: '360px',
                margin: '0 auto 16px',
                borderRadius: '14px',
                overflow: 'hidden',
                background: '#000000',
              }}
            >
              <video
                ref={faceVideoRef}
                playsInline
                muted
                autoPlay
                style={{
                  width: '100%',
                  height: 'auto',
                  display: faceCameraActive ? 'block' : 'none',
                  transform: 'scaleX(-1)', // mirror effect
                }}
              />

              {faceCameraActive && (
                <div
                  style={{
                    position: 'absolute',
                    top: '12%',
                    left: '20%',
                    width: '60%',
                    height: '76%',
                    border: step2Done || (!challengeInfo?.isCombo && step1Done)
                      ? '2px solid rgba(74, 222, 128, 0.9)'
                      : '2px dashed rgba(103, 232, 249, 0.8)',
                    borderRadius: '50%',
                    pointerEvents: 'none',
                    boxShadow: step2Done || (!challengeInfo?.isCombo && step1Done)
                      ? '0 0 25px rgba(74, 222, 128, 0.4)'
                      : '0 0 20px rgba(103, 232, 249, 0.3)',
                    transition: 'all 0.3s ease',
                  }}
                />
              )}
            </div>

            {/* Real-time Challenge Feedback */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '10px',
                background: 'rgba(2, 6, 23, 0.8)',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                fontSize: '13px',
                color: '#67e8f9',
                fontWeight: 600,
              }}
            >
              {challengeFeedback || statusMessage}
            </div>

            {/* IN-PLACE RETRY OR RESCAN PROMPT */}
            {challengeRetryState.hasFailed && (
              <div
                style={{
                  marginTop: '14px',
                  padding: '14px',
                  borderRadius: '12px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '13px', color: '#fca5a5', marginBottom: '8px', fontWeight: 600 }}>
                  ⚠️ {challengeRetryState.reason}
                </div>

                {challengeRetryState.needsRescan ? (
                  <button
                    type="button"
                    onClick={handleRetryFromScratch}
                    style={{
                      padding: '10px 22px',
                      background: 'linear-gradient(135deg, #06b6d4, #2563eb)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 700,
                      fontSize: '13px',
                      cursor: 'pointer',
                      boxShadow: '0 4px 14px rgba(6, 182, 212, 0.35)',
                    }}
                  >
                    📸 Re-Scan Lecture QR Code
                  </button>
                ) : (
                  <>
                    <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#e2e8f0' }}>
                      No worries! Keep your face inside the oval and let's try again.
                    </p>
                    <button
                      type="button"
                      onClick={retryFaceChallenge}
                      disabled={isProcessing}
                      style={{
                        padding: '10px 22px',
                        background: 'linear-gradient(135deg, #06b6d4, #2563eb)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: 700,
                        fontSize: '13px',
                        cursor: isProcessing ? 'not-allowed' : 'pointer',
                        boxShadow: '0 4px 14px rgba(6, 182, 212, 0.35)',
                      }}
                    >
                      🔄 Try Challenge Again
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── CARD 4: SUCCESS STEP ── */}
        {step === 'success' && (
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.9)',
              border: '2px solid #10b981',
              borderRadius: '16px',
              padding: '28px 20px',
              textAlign: 'center',
              boxShadow: '0 12px 40px rgba(16, 185, 129, 0.3)',
            }}
          >
            <div style={{ fontSize: '50px', marginBottom: '10px' }}>🎉</div>
            <h2 style={{ margin: '0 0 8px', fontSize: '22px', color: '#4ade80' }}>
              Attendance Marked!
            </h2>
            <p style={{ margin: '0 0 20px', fontSize: '14px', color: '#e2e8f0' }}>
              Your attendance for Session #{markedResult?.session_id || ticketInfo?.session_id} has been recorded in the attendance log.
            </p>

            <button
              type="button"
              onClick={handleLeave}
              style={{
                width: '100%',
                padding: '12px',
                background: 'linear-gradient(135deg, #10b981, #059669)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Back to Dashboard
            </button>
          </div>
        )}

                {/* ── CARD 4B: ALREADY MARKED STEP ── */}
        {step === 'already_marked' && (
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.95)',
              border: '2px solid #06b6d4',
              borderRadius: '16px',
              padding: '32px 24px',
              textAlign: 'center',
              boxShadow: '0 12px 40px rgba(6, 182, 212, 0.25)',
            }}
          >
            <div style={{ fontSize: '52px', marginBottom: '12px' }}>📋</div>
            <h2 style={{ margin: '0 0 8px', fontSize: '22px', color: '#67e8f9' }}>
              Attendance Already Marked
            </h2>
            <div
              style={{
                display: 'inline-block',
                margin: '6px 0 16px',
                padding: '4px 14px',
                borderRadius: '20px',
                background: 'rgba(16, 185, 129, 0.2)',
                border: '1px solid rgba(16, 185, 129, 0.5)',
                color: '#4ade80',
                fontSize: '13px',
                fontWeight: 700,
              }}
            >
              ✓ Status: Present (Verified)
            </div>
            <p style={{ margin: '0 0 24px', fontSize: '14px', color: '#cbd5e1', lineHeight: 1.5 }}>
              Your attendance for this lecture session has already been recorded in the attendance register. You do not need to scan again.
            </p>

            <button
              type="button"
              onClick={handleLeave}
              style={{
                width: '100%',
                padding: '12px',
                background: 'linear-gradient(135deg, #06b6d4, #0284c7)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '14px',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(6, 182, 212, 0.35)',
              }}
            >
              Back to Dashboard
            </button>
          </div>
        )}

        {/* ── CARD 4C: NOT ENROLLED / CLASS NOT JOINED STEP ── */}
        {step === 'not_enrolled' && (
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.95)',
              border: '2px solid #ef4444',
              borderRadius: '16px',
              padding: '32px 24px',
              textAlign: 'center',
              boxShadow: '0 12px 40px rgba(239, 68, 68, 0.25)',
            }}
          >
            <div style={{ fontSize: '52px', marginBottom: '12px' }}>🚫</div>
            <h2 style={{ margin: '0 0 8px', fontSize: '22px', color: '#fca5a5' }}>
              Not Enrolled in This Class
            </h2>
            <div
              style={{
                display: 'inline-block',
                margin: '6px 0 16px',
                padding: '4px 14px',
                borderRadius: '20px',
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid rgba(239, 68, 68, 0.5)',
                color: '#f87171',
                fontSize: '13px',
                fontWeight: 700,
              }}
            >
              Class Enrollment Required
            </div>
            <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#cbd5e1', lineHeight: 1.5 }}>
              {errorMessage || 'You have not joined this course yet. Please submit a join request or enter the course join code from your student dashboard and wait for instructor approval.'}
            </p>
            {redirectCountdown > 0 && (
              <p style={{ margin: '0 0 20px', fontSize: '12px', color: '#94a3b8' }}>
                Returning to dashboard in {redirectCountdown} second{redirectCountdown === 1 ? '' : 's'}...
              </p>
            )}

            <button
              type="button"
              onClick={handleLeave}
              style={{
                width: '100%',
                padding: '12px',
                background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '14px',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(239, 68, 68, 0.35)',
              }}
            >
              ← Back to Dashboard
            </button>
          </div>
        )}

        {/* ── CARD 4D: SESSION ENDED STEP ── */}
        {step === 'session_ended' && (
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.95)',
              border: '2px solid #f59e0b',
              borderRadius: '16px',
              padding: '32px 24px',
              textAlign: 'center',
              boxShadow: '0 12px 40px rgba(245, 158, 11, 0.25)',
            }}
          >
            <div style={{ fontSize: '52px', marginBottom: '12px' }}>⌛</div>
            <h2 style={{ margin: '0 0 8px', fontSize: '22px', color: '#fbbf24' }}>
              Session Ended
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#cbd5e1', lineHeight: 1.5 }}>
              {errorMessage || 'This lecture attendance session has ended or is no longer active.'}
            </p>
            {redirectCountdown > 0 && (
              <p style={{ margin: '0 0 20px', fontSize: '12px', color: '#94a3b8' }}>
                Returning to dashboard in {redirectCountdown} second{redirectCountdown === 1 ? '' : 's'}...
              </p>
            )}
            <button
              type="button"
              onClick={handleLeave}
              style={{
                width: '100%',
                padding: '12px',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              ← Back to Dashboard
            </button>
          </div>
        )}

        {/* ── CARD 4E: NO FACE ENROLLMENT STEP ── */}
        {step === 'no_face' && (
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.95)',
              border: '2px solid #3b82f6',
              borderRadius: '16px',
              padding: '32px 24px',
              textAlign: 'center',
              boxShadow: '0 12px 40px rgba(59, 130, 246, 0.25)',
            }}
          >
            <div style={{ fontSize: '52px', marginBottom: '12px' }}>👤</div>
            <h2 style={{ margin: '0 0 8px', fontSize: '22px', color: '#93c5fd' }}>
              Biometric Enrollment Required
            </h2>
            <p style={{ margin: '0 0 24px', fontSize: '14px', color: '#cbd5e1', lineHeight: 1.5 }}>
              You have not enrolled your face biometric profile yet. Complete face enrollment first to activate your account.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                type="button"
                onClick={() => {
                  stopAllCameras();
                  navigate('/student/enroll');
                }}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: 'linear-gradient(135deg, #06b6d4, #2563eb)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                Go to Face Enrollment →
              </button>
              <button
                type="button"
                onClick={handleLeave}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'transparent',
                  color: '#94a3b8',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                ← Back to Dashboard
              </button>
            </div>
          </div>
        )}

        {/* ── CARD 5: FATAL ERROR STEP ── */}
        {step === 'error' && (
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.9)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '16px',
              padding: '24px',
              textAlign: 'center',
              boxShadow: '0 12px 36px rgba(239, 68, 68, 0.2)',
            }}
          >
            <div style={{ fontSize: '40px', marginBottom: '10px' }}>⚠️</div>
            <h2 style={{ margin: '0 0 8px', fontSize: '18px', color: '#fca5a5' }}>
              Verification Error
            </h2>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#cbd5e1' }}>{errorMessage}</p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={handleRetryFromScratch}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  background: 'linear-gradient(135deg, #06b6d4, #2563eb)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                📸 Scan Again
              </button>
              <button
                type="button"
                onClick={handleLeave}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  background: 'transparent',
                  color: '#cbd5e1',
                  border: '1px solid rgba(255,255,255,0.25)',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                ← Back to Dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
