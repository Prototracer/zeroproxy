import React, { useState, useEffect, useRef } from 'react';
import { faceapi, loadModels, areModelsLoaded } from '../face/loadModels.js';
import {
  computeEyeOpenness,
  computeYawDeg,
  computePitchDeg,
} from '../face/liveness.js';
import { registerActiveStream, stopAllGlobalCameras } from '../utils/cameraManager.js';

export default function LivenessLabPage() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // States
  const [modelLoading, setModelLoading] = useState(true);
  const [cameraActive, setCameraActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Detector options
  const [inputSize, setInputSize] = useState(416); // 416 or 512
  const [scoreThreshold] = useState(0.4);
  const [mirrored, setMirrored] = useState(true);

  // Camera resolution info
  const [camRes, setCamRes] = useState({ width: 0, height: 0, frameRate: 0 });

  // Live Metrics
  const [metrics, setMetrics] = useState({
    fps: 0,
    faceCount: 0,
    score: 0,
    leftEye: 0,
    rightEye: 0,
    avgEye: 0,
    baselineEye: 0,
    eyeRatio: 1,
    rawYaw: 0,
    mirroredYaw: 0,
    pitch: 0,
    maxGapMs: 0,
    faceBox: null,
  });

  // Recording State (10-second JSON export)
  const [isRecording, setIsRecording] = useState(false);
  const [recordCountdown, setRecordCountdown] = useState(10);
  const recordingDataRef = useRef([]);

  // Closed-eye test state
  const [testPhase, setTestPhase] = useState('idle');
  const [testTimer, setTestTimer] = useState(0);
  const [testResults, setTestResults] = useState(null);
  const openSamplesRef = useRef([]);
  const closedSamplesRef = useRef([]);

  // Loop control refs
  const loopActiveRef = useRef(false);
  const baselineBufferRef = useRef([]);
  const fpsWindowRef = useRef([]);

  // 1. Load models on mount
  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        setModelLoading(true);
        if (!areModelsLoaded()) {
          await loadModels();
        }
        if (mounted) setModelLoading(false);
      } catch (err) {
        console.error('Failed to load faceapi models in lab:', err);
        if (mounted) setErrorMsg('Failed to load models: ' + err.message);
      }
    }
    init();
    return () => {
      mounted = false;
      stopCamera();
    };
  }, []);

  // 2. Start / Stop Camera
  const startCamera = async () => {
    setErrorMsg('');
    try {
      stopAllGlobalCameras();
      const constraints = {
        audio: false,
        video: {
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          facingMode: 'user',
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      registerActiveStream(stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (playErr) {
          if (playErr.name !== 'AbortError') {
            throw playErr;
          }
        }

        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        setCamRes({
          width: settings.width || videoRef.current.videoWidth,
          height: settings.height || videoRef.current.videoHeight,
          frameRate: Math.round(settings.frameRate || 0),
        });
      }

      setCameraActive(true);
      loopActiveRef.current = true;
      requestAnimationFrame(detectionLoop);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Camera access failed:', err);
        setErrorMsg('Camera access denied or unavailable: ' + err.message);
      }
    }
  };

  const stopCamera = () => {
    loopActiveRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  // 3. Real-time Detection Loop
  const detectionLoop = async () => {
    if (!loopActiveRef.current || !videoRef.current) return;

    const tStart = performance.now();

    try {
      if (videoRef.current.readyState >= 2 && !videoRef.current.paused) {
        const detectorOpts = new faceapi.TinyFaceDetectorOptions({
          inputSize,
          scoreThreshold,
        });

        // Detect all faces for single-face violation check
        const detections = await faceapi
          .detectAllFaces(videoRef.current, detectorOpts)
          .withFaceLandmarks();

        const count = detections.length;
        let score = 0;
        let leftEar = 0;
        let rightEar = 0;
        let avgEar = 0;
        let rawYaw = 0;
        let mirrYaw = 0;
        let pitch = 0;
        let box = null;

        if (count > 0) {
          const primary = detections[0];
          score = primary.detection.score;
          box = primary.detection.box;

          const landmarks = primary.landmarks;
          leftEar = computeEyeOpenness(landmarks.getLeftEye());
          rightEar = computeEyeOpenness(landmarks.getRightEye());
          avgEar = (leftEar + rightEar) / 2;

          rawYaw = computeYawDeg(landmarks);
          mirrYaw = -rawYaw;
          pitch = computePitchDeg(landmarks);

          baselineBufferRef.current.push(avgEar);
          if (baselineBufferRef.current.length > 60) baselineBufferRef.current.shift();
        }

        let baseline = 0.28;
        if (baselineBufferRef.current.length > 5) {
          const sorted = [...baselineBufferRef.current].sort((a, b) => a - b);
          baseline = sorted[Math.floor(sorted.length * 0.8)];
        }

        const eyeRatio = baseline > 0 ? avgEar / baseline : 1;

        const tEnd = performance.now();
        const frameDuration = tEnd - tStart;
        fpsWindowRef.current.push(frameDuration);
        if (fpsWindowRef.current.length > 20) fpsWindowRef.current.shift();
        const avgFrameMs =
          fpsWindowRef.current.reduce((a, b) => a + b, 0) / fpsWindowRef.current.length;
        const liveFps = avgFrameMs > 0 ? Math.round(1000 / avgFrameMs) : 0;

        // Gap tracking
        if (!fpsWindowRef.current.lastTs) fpsWindowRef.current.lastTs = tStart;
        const gap = tStart - fpsWindowRef.current.lastTs;
        fpsWindowRef.current.lastTs = tStart;
        if (!fpsWindowRef.current.maxGap || gap > fpsWindowRef.current.maxGap) {
          if (gap < 2000) fpsWindowRef.current.maxGap = gap;
        }

        setMetrics({
          fps: liveFps,
          faceCount: count,
          score: parseFloat(score.toFixed(3)),
          leftEye: parseFloat(leftEar.toFixed(3)),
          rightEye: parseFloat(rightEar.toFixed(3)),
          avgEye: parseFloat(avgEar.toFixed(3)),
          baselineEye: parseFloat(baseline.toFixed(3)),
          eyeRatio: parseFloat(eyeRatio.toFixed(3)),
          rawYaw: parseFloat(rawYaw.toFixed(1)),
          mirroredYaw: parseFloat(mirrYaw.toFixed(1)),
          pitch: parseFloat(pitch.toFixed(1)),
          maxGapMs: Math.round(fpsWindowRef.current.maxGap || 0),
          faceBox: box,
        });

        if (isRecording) {
          recordingDataRef.current.push({
            t_ms: Math.round(performance.now()),
            fps: liveFps,
            faceCount: count,
            score: parseFloat(score.toFixed(3)),
            leftEar: parseFloat(leftEar.toFixed(4)),
            rightEar: parseFloat(rightEar.toFixed(4)),
            avgEar: parseFloat(avgEar.toFixed(4)),
            rawYaw: parseFloat(rawYaw.toFixed(2)),
            mirroredYaw: parseFloat(mirrYaw.toFixed(2)),
            pitch: parseFloat(pitch.toFixed(2)),
            gapMs: Math.round(gap),
          });
        }

        if (testPhase === 'open_phase' && count === 1) {
          openSamplesRef.current.push(avgEar);
        } else if (testPhase === 'closed_phase' && count === 1) {
          closedSamplesRef.current.push(avgEar);
        }
      }
    } catch (e) {
      // Ignore transient grab error
    }

    if (loopActiveRef.current) {
      if (videoRef.current && typeof videoRef.current.requestVideoFrameCallback === 'function') {
        videoRef.current.requestVideoFrameCallback(detectionLoop);
      } else {
        requestAnimationFrame(detectionLoop);
      }
    }
  };

  // 4. Start 10-Second Recording
  const startRecording = () => {
    if (!cameraActive || isRecording) return;
    recordingDataRef.current = [];
    setIsRecording(true);
    setRecordCountdown(10);

    const timer = setInterval(() => {
      setRecordCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          finishRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const finishRecording = () => {
    setIsRecording(false);
    const data = {
      timestamp: new Date().toISOString(),
      machineInfo: {
        userAgent: navigator.userAgent,
        detectorInputSize: inputSize,
        scoreThreshold,
        cameraResolution: camRes,
      },
      frameCount: recordingDataRef.current.length,
      durationSeconds: 10,
      framesPerSecond: parseFloat((recordingDataRef.current.length / 10).toFixed(1)),
      samples: recordingDataRef.current,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `liveness_metrics_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 5. Closed-Eye Test Sequence
  const startClosedEyeTest = () => {
    if (!cameraActive) return;
    setTestResults(null);
    openSamplesRef.current = [];
    closedSamplesRef.current = [];

    setTestPhase('open_phase');
    setTestTimer(3);

    let count = 3;
    const openInterval = setInterval(() => {
      count -= 1;
      setTestTimer(count);
      if (count <= 0) {
        clearInterval(openInterval);
        setTestPhase('closed_phase');
        setTestTimer(3);

        let closedCount = 3;
        const closedInterval = setInterval(() => {
          closedCount -= 1;
          setTestTimer(closedCount);
          if (closedCount <= 0) {
            clearInterval(closedInterval);
            finishClosedEyeTest();
          }
        }, 1000);
      }
    }, 1000);
  };

  const getStats = (arr) => {
    if (!arr || arr.length === 0) return { min: 0, max: 0, median: 0, mean: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
      min: parseFloat(min.toFixed(4)),
      max: parseFloat(max.toFixed(4)),
      median: parseFloat(median.toFixed(4)),
      mean: parseFloat(mean.toFixed(4)),
    };
  };

  const finishClosedEyeTest = () => {
    setTestPhase('done');
    const openStats = getStats(openSamplesRef.current);
    const closedStats = getStats(closedSamplesRef.current);
    const separationRatio =
      openStats.median > 0
        ? parseFloat((closedStats.median / openStats.median).toFixed(4))
        : 1;
    const separationPct = parseFloat(((1 - separationRatio) * 100).toFixed(1));

    setTestResults({
      openCount: openSamplesRef.current.length,
      closedCount: closedSamplesRef.current.length,
      openStats,
      closedStats,
      separationRatio,
      separationPct,
    });
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0f1d', color: '#f8fafc', padding: '24px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: '0.75rem', background: '#3b82f6', color: '#fff', padding: '3px 8px', borderRadius: 4, fontWeight: 700, letterSpacing: '0.05em' }}>DEV ONLY</span>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: '6px 0 2px 0' }}>Liveness Laboratory & Metric Inspector</h1>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: 0 }}>
            Phase 1 Diagnostic Tool: Real FPS, Signed Yaw sign verification, Eye Separation test & metric telemetry export.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {!cameraActive ? (
            <button
              onClick={startCamera}
              disabled={modelLoading}
              style={{ background: '#10b981', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 8, fontWeight: 600, cursor: modelLoading ? 'not-allowed' : 'pointer' }}
            >
              {modelLoading ? 'Loading AI Models...' : '▶ Start Camera'}
            </button>
          ) : (
            <button
              onClick={stopCamera}
              style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}
            >
              ⏹ Stop Camera
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div style={{ maxWidth: 1200, margin: '0 auto 16px', background: '#450a0a', border: '1px solid #dc2626', color: '#fca5a5', padding: '12px', borderRadius: 8 }}>
          {errorMsg}
        </div>
      )}

      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) 380px', gap: 20 }}>
        <div style={{ background: '#131b2e', borderRadius: 12, border: '1px solid #1e293b', padding: 16 }}>
          <div style={{ position: 'relative', width: '100%', height: 420, background: '#000', borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <video
              ref={videoRef}
              playsInline
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                transform: mirrored ? 'scaleX(-1)' : 'none',
              }}
            />
            {!cameraActive && (
              <div style={{ position: 'absolute', color: '#64748b', textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: '1.1rem' }}>Camera is idle</p>
                <p style={{ fontSize: '0.85rem' }}>Click "Start Camera" to begin telemetry</p>
              </div>
            )}

            {testPhase === 'open_phase' && (
              <div style={{ position: 'absolute', top: 20, background: 'rgba(16, 185, 129, 0.9)', color: '#fff', padding: '10px 24px', borderRadius: 30, fontSize: '1.2rem', fontWeight: 800, boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
                👀 KEEP EYES OPEN & LOOK AT CAMERA ({testTimer}s)
              </div>
            )}
            {testPhase === 'closed_phase' && (
              <div style={{ position: 'absolute', top: 20, background: 'rgba(239, 68, 68, 0.9)', color: '#fff', padding: '10px 24px', borderRadius: 30, fontSize: '1.2rem', fontWeight: 800, boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
                🙈 HOLD EYES CLOSED GENTLY ({testTimer}s)
              </div>
            )}

            {cameraActive && (
              <div style={{ position: 'absolute', bottom: 10, left: 10, right: 10, display: 'flex', justifyContent: 'space-between', background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)', padding: '6px 12px', borderRadius: 6, fontSize: '0.75rem', fontFamily: 'monospace' }}>
                <span>FPS: <strong style={{ color: metrics.fps >= 20 ? '#10b981' : '#f59e0b' }}>{metrics.fps}</strong></span>
                <span>Max Gap: <strong style={{ color: metrics.maxGapMs <= 60 ? '#10b981' : '#f59e0b' }}>{metrics.maxGapMs}ms</strong></span>
                <span>Faces: <strong style={{ color: metrics.faceCount === 1 ? '#10b981' : '#ef4444' }}>{metrics.faceCount}</strong></span>
                <span>Conf: <strong>{metrics.score}</strong></span>
                <span>Input: <strong>{inputSize}x{inputSize}</strong></span>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginTop: 14 }}>
            <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              Input Size:
              <select
                value={inputSize}
                onChange={(e) => setInputSize(Number(e.target.value))}
                style={{ width: '100%', marginTop: 4, background: '#1e293b', color: '#fff', border: '1px solid #334155', padding: '6px', borderRadius: 6 }}
              >
                <option value={320}>320 x 320 (Fastest)</option>
                <option value={416}>416 x 416 (Standard)</option>
                <option value={512}>512 x 512 (High Acc)</option>
              </select>
            </label>

            <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              Preview Mirroring:
              <button
                onClick={() => setMirrored((m) => !m)}
                style={{ width: '100%', marginTop: 4, background: mirrored ? '#3b82f6' : '#475569', color: '#fff', border: 'none', padding: '7px', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}
              >
                {mirrored ? 'Mirrored (CSS -1)' : 'Unmirrored (1)'}
              </button>
            </label>

            <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              10s Telemetry Export:
              <button
                onClick={startRecording}
                disabled={!cameraActive || isRecording}
                style={{ width: '100%', marginTop: 4, background: isRecording ? '#dc2626' : '#6366f1', color: '#fff', border: 'none', padding: '7px', borderRadius: 6, fontWeight: 600, cursor: !cameraActive || isRecording ? 'not-allowed' : 'pointer' }}
              >
                {isRecording ? `Recording... (${recordCountdown}s)` : '📥 Record 10s JSON'}
              </button>
            </label>
          </div>

          <div style={{ marginTop: 12, padding: '8px 12px', background: '#0f172a', borderRadius: 6, fontSize: '0.75rem', color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
            <span>Hardware Res: <strong>{camRes.width}x{camRes.height} @ {camRes.frameRate}fps</strong></span>
            <span>Target: <strong>facingMode: "user", &ge; 640x480</strong></span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Card 1: Eye Metrics (EAR) */}
          <div style={{ background: '#131b2e', borderRadius: 12, border: '1px solid #1e293b', padding: 14 }}>
            <h3 style={{ fontSize: '0.95rem', margin: '0 0 10px 0', color: '#38bdf8', fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
              <span>👁️ Eye Openness (EAR)</span>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Avg: {metrics.avgEye}</span>
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8, fontSize: '0.8rem' }}>
              <div style={{ background: '#0f172a', padding: 8, borderRadius: 6 }}>
                <span style={{ color: '#94a3b8' }}>Left EAR:</span> <strong>{metrics.leftEye}</strong>
              </div>
              <div style={{ background: '#0f172a', padding: 8, borderRadius: 6 }}>
                <span style={{ color: '#94a3b8' }}>Right EAR:</span> <strong>{metrics.rightEye}</strong>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: '0.8rem' }}>
              <div style={{ background: '#0f172a', padding: 8, borderRadius: 6 }}>
                <span style={{ color: '#94a3b8' }}>Baseline EAR:</span> <strong>{metrics.baselineEye}</strong>
              </div>
              <div style={{ background: '#0f172a', padding: 8, borderRadius: 6 }}>
                <span style={{ color: '#94a3b8' }}>Ratio (Cur/Base):</span>{' '}
                <strong style={{ color: metrics.eyeRatio < 0.88 ? '#ef4444' : '#10b981' }}>
                  {metrics.eyeRatio}
                </strong>
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ height: 10, background: '#1e293b', borderRadius: 5, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, Math.max(0, (metrics.avgEye / 0.4) * 100))}%`,
                    background: metrics.eyeRatio < 0.88 ? '#ef4444' : '#10b981',
                    transition: 'width 0.05s ease',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#64748b', marginTop: 3 }}>
                <span>0.0 (Closed)</span>
                <span>Server Dip: &le; 0.23</span>
                <span>0.40 (Wide)</span>
              </div>
            </div>
          </div>

          {/* Card 2: Head Turn & Sign Inspector */}
          <div style={{ background: '#131b2e', borderRadius: 12, border: '1px solid #1e293b', padding: 14 }}>
            <h3 style={{ fontSize: '0.95rem', margin: '0 0 10px 0', color: '#f59e0b', fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
              <span>🧭 Head Yaw & Turn Sign</span>
              <span style={{ fontSize: '0.75rem', background: '#1e293b', padding: '2px 6px', borderRadius: 4 }}>
                Pitch: {metrics.pitch}°
              </span>
            </h3>

            <div style={{ background: '#0f172a', padding: 10, borderRadius: 6, marginBottom: 8, fontSize: '0.8rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#94a3b8' }}>Raw Geometric Yaw:</span>
                <strong style={{ color: metrics.rawYaw < 0 ? '#38bdf8' : '#f43f5e' }}>
                  {metrics.rawYaw > 0 ? `+${metrics.rawYaw}` : metrics.rawYaw}°
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8' }}>Mirrored Yaw (-Raw):</span>
                <strong style={{ color: metrics.mirroredYaw < 0 ? '#38bdf8' : '#f43f5e' }}>
                  {metrics.mirroredYaw > 0 ? `+${metrics.mirroredYaw}` : metrics.mirroredYaw}°
                </strong>
              </div>
            </div>

            <div style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.4, background: '#1e293b', padding: 8, borderRadius: 6 }}>
              <div><strong>Server Rule Contract:</strong></div>
              <div>• <code>turn_left</code> expects <strong>yaw &lt; -10.0°</strong>, recovery &gt; -8.0°</div>
              <div>• <code>turn_right</code> expects <strong>yaw &gt; +10.0°</strong>, recovery &lt; +8.0°</div>
              <div style={{ marginTop: 4, color: '#fcd34d' }}>
                Current User Action:{' '}
                {metrics.rawYaw < -10
                  ? '👈 Left Excursion (Negative)'
                  : metrics.rawYaw > 10
                  ? '👉 Right Excursion (Positive)'
                  : 'Center / Neutral'}
              </div>
            </div>
          </div>

          {/* Card 3: 3s Open / 3s Closed Eye Separation Test */}
          <div style={{ background: '#131b2e', borderRadius: 12, border: '1px solid #1e293b', padding: 14 }}>
            <h3 style={{ fontSize: '0.95rem', margin: '0 0 8px 0', color: '#a855f7', fontWeight: 700 }}>
              🧪 Closed-Eye Calibration Test
            </h3>
            <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0 0 10px 0' }}>
              Measures open vs closed EAR separation on your face and lighting conditions.
            </p>

            <button
              onClick={startClosedEyeTest}
              disabled={!cameraActive || testPhase === 'open_phase' || testPhase === 'closed_phase'}
              style={{
                width: '100%',
                background: testPhase === 'idle' || testPhase === 'done' ? '#8b5cf6' : '#475569',
                color: '#fff',
                border: 'none',
                padding: '8px 12px',
                borderRadius: 6,
                fontWeight: 600,
                cursor: !cameraActive || testPhase.includes('phase') ? 'not-allowed' : 'pointer',
              }}
            >
              {testPhase.includes('phase') ? `Test Running... (${testTimer}s)` : '▶ Run Closed-Eye Test (6s)'}
            </button>

            {testResults && (
              <div style={{ marginTop: 10, background: '#0f172a', borderRadius: 6, padding: 10, fontSize: '0.78rem' }}>
                <div style={{ fontWeight: 700, color: '#c084fc', marginBottom: 6 }}>Test Results:</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                  <div>Open Med: <strong>{testResults.openStats.median}</strong></div>
                  <div>Closed Med: <strong>{testResults.closedStats.median}</strong></div>
                  <div>Open Min/Max: <strong>{testResults.openStats.min} / {testResults.openStats.max}</strong></div>
                  <div>Closed Min/Max: <strong>{testResults.closedStats.min} / {testResults.closedStats.max}</strong></div>
                </div>
                <div style={{ borderTop: '1px solid #1e293b', paddingTop: 6, marginTop: 4 }}>
                  <div>Separation Ratio (Closed/Open): <strong style={{ color: testResults.separationRatio < 0.85 ? '#10b981' : '#f59e0b' }}>{testResults.separationRatio}</strong></div>
                  <div>Relative EAR Drop: <strong style={{ color: testResults.separationPct >= 15 ? '#10b981' : '#ef4444' }}>{testResults.separationPct}%</strong></div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 4 }}>
                    {testResults.separationPct >= 12
                      ? '✓ Adequate separation for relative dip detection!'
                      : '⚠️ Sub-12% separation. Per-person adaptive baseline or model tuning required.'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
