import { useEffect, useRef, useState } from 'react';
import * as faceapi from '@vladmandic/face-api';
import { loadModels, areModelsLoaded } from '../face/loadModels.js';
import { registerActiveStream, stopAllGlobalCameras } from '../utils/cameraManager.js';

export default function AdminLivenessLab() {
  // Video and stream references
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameIdRef = useRef(null);
  const isMountedRef = useRef(true);
  const isCameraRunningRef = useRef(false);

  // Model & camera status
  const [modelLoading, setModelLoading] = useState(true);
  const [modelMessage, setModelMessage] = useState('Initializing AI face models...');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');

  // Selected Challenge & Mode
  const [selectedChallenge, setSelectedChallenge] = useState('combo_turn_blink');
  const [customStep1, setCustomStep1] = useState('turn_any');
  const [customStep2, setCustomStep2] = useState('blink');
  const [isMirrored, setIsMirrored] = useState(true);

  // Live Tunable Thresholds
  const [closeFactor, setCloseFactor] = useState(0.82); // eyeOpenness < baseline * closeFactor (was 0.72)
  const [openFactor, setOpenFactor] = useState(0.90);  // eyeOpenness > baseline * openFactor
  const [turnThreshold, setTurnThreshold] = useState(15); // degrees
  const [nodThreshold, setNodThreshold] = useState(5.0); // degrees
  const [tiltThreshold, setTiltThreshold] = useState(8.0); // degrees (head tilt)
  const [scoreThreshold, setScoreThreshold] = useState(0.4);

  // Live Telemetry state (updated from animation loop)
  const [telemetry, setTelemetry] = useState({
    fps: 0,
    confidence: 0,
    faceSizePercent: 0,
    boxWidth: 0,
    boxHeight: 0,
    luminance: 120, // 0-255 brightness
    leftEar: 0.28,
    rightEar: 0.28,
    avgEar: 0.28,
    smoothedEar: 0.28,
    baselineEar: 0.28,
    rawYaw: 0,
    baselineYaw: 0,
    relYaw: 0,
    rawPitch: 0,
    baselinePitch: 0,
    relPitch: 0,
    rawTilt: 0,
    baselineTilt: 0,
    relTilt: 0,
    eyebrowRaise: 0.35,
    eyebrowBaseline: 0.35,
    faceState: 'no_face', // 'no_face' | 'calibrating' | 'tracking'
  });

  // Test Run State
  const [testState, setTestState] = useState({
    isRunning: false,
    currentStep: 1,
    step1Done: false,
    step2Done: false,
    result: null, // 'passed' | 'failed' | null
    reason: '',
    startTime: 0,
    elapsedMs: 0,
    feedback: 'Select a challenge and tap "Start Test Run"',
  });

  // Classmate Trials Logger
  const [testerName, setTesterName] = useState('Student 1');
  const [deviceType, setDeviceType] = useState('Laptop Webcam');
  const [lightingCondition, setLightingCondition] = useState('Normal Lighting');
  const [eyewear, setEyewear] = useState('No Glasses');
  const [notes, setNotes] = useState('');
  const [attemptsLog, setAttemptsLog] = useState([]);

  // Telemetry rolling buffer references
  const telemetryRef = useRef({
    fpsFrames: [],
    lastFrameTime: performance.now(),
    earHistory: [],
    baselineEars: [],
    baselineYaws: [],
    baselinePitches: [],
    baselineTilts: [],
    baselineEyebrows: [],
    isCalibrated: false,
    calibratedAt: 0,
    // Step 2 fresh blink tracking
    step1Done: false,
    step1DoneTime: 0,
    blinkCountAtStep1: 0,
    totalBlinks: 0,
    inBlink: false,
    minEarDuringBlink: 0.28,
    turnLeftDone: false,
    turnRightDone: false,
    turnAnyDone: false,
    nodDone: false,
    tiltLeftDone: false,
    tiltRightDone: false,
    tiltAnyDone: false,
    eyebrowDone: false,
    peakYaw: 0,
    peakPitch: 0,
    peakTilt: 0,
    minEarRecorded: 1.0,
  });

  // Always keep latest state/props available inside persistent animation frame loops
  const paramsRef = useRef({
    selectedChallenge,
    customStep1,
    customStep2,
    isMirrored,
    closeFactor,
    openFactor,
    turnThreshold,
    nodThreshold,
    tiltThreshold,
    scoreThreshold,
  });
  paramsRef.current = {
    selectedChallenge,
    customStep1,
    customStep2,
    isMirrored,
    closeFactor,
    openFactor,
    turnThreshold,
    nodThreshold,
    tiltThreshold,
    scoreThreshold,
  };

  // ── Load Face API Models ─────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;

    async function init() {
      try {
        if (!areModelsLoaded()) {
          await loadModels((pct, msg) => {
            if (isMountedRef.current) setModelMessage(`${msg} (${pct}%)`);
          });
        }
        if (isMountedRef.current) {
          setModelLoading(false);
          setModelMessage('AI models loaded successfully.');
          startCamera();
        }
      } catch (err) {
        if (isMountedRef.current) {
          setModelLoading(false);
          setCameraError(`Model loading error: ${err.message}`);
        }
      }
    }

    init();

    return () => {
      isMountedRef.current = false;
      stopCamera();
    };
  }, []);

  // ── Camera Initialization ────────────────────────────────────────────────
  async function startCamera() {
    stopCamera();
    setCameraError('');

    try {
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!isMountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

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
      }

      isCameraRunningRef.current = true;
      setCameraActive(true);
      startTelemetryLoop();
    } catch (err) {
      if (isMountedRef.current) {
        if (err.name !== 'AbortError') {
          setCameraError(`Camera access denied: ${err.message}. Please allow camera permissions.`);
        }
        setCameraActive(false);
      }
    }
  }

  function stopCamera() {
    isCameraRunningRef.current = false;
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
          track.enabled = false;
        });
      } catch {
        // Ignore
      }
      streamRef.current = null;
    }
    stopAllGlobalCameras();
    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch {
        // Ignore
      }
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setTelemetry((prev) => ({
      ...prev,
      fps: 0,
      faceState: 'no_face',
    }));
  }

  // ── Landmark Math Utilities ──────────────────────────────────────────────
  function dist(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  function computeEar(eyePts) {
    if (!eyePts || eyePts.length < 6) return 0.28;
    const v1 = dist(eyePts[1], eyePts[5]);
    const v2 = dist(eyePts[2], eyePts[4]);
    const h = dist(eyePts[0], eyePts[3]);
    if (h === 0) return 0.28;
    return (v1 + v2) / (2.0 * h);
  }

  function computeYaw(landmarks) {
    try {
      const nose = landmarks.getNose()[3];
      const leftCheek = landmarks.getJawOutline()[0];
      const rightCheek = landmarks.getJawOutline()[16];
      const dLeft = dist(nose, leftCheek);
      const dRight = dist(nose, rightCheek);
      if (dLeft + dRight === 0) return 0;
      const raw = ((dLeft - dRight) / (dLeft + dRight)) * 45;
      // Mirror compensation if camera preview is mirrored
      return isMirrored ? -raw : raw;
    } catch {
      return 0;
    }
  }

  function computePitch(landmarks) {
    try {
      const leftEye = landmarks.getLeftEye()[0];
      const rightEye = landmarks.getRightEye()[3];
      const eyeMidY = (leftEye.y + rightEye.y) / 2;
      const noseTip = landmarks.getNose()[3];
      const chin = landmarks.getJawOutline()[8];

      // Vertical distances in pixel plane
      const dUpperY = noseTip.y - eyeMidY;
      const dLowerY = chin.y - noseTip.y;
      if (dUpperY <= 0) return 0;

      // When head nods DOWN, nose tip moves downward toward chin,
      // so dLowerY shrinks while dUpperY expands (ratio drops significantly).
      const ratio = dLowerY / dUpperY;
      return Number(((1.4 - ratio) * 20).toFixed(1));
    } catch {
      return 0;
    }
  }

  function computeTilt(landmarks) {
    try {
      const leftEye = landmarks.getLeftEye()[0];
      const rightEye = landmarks.getRightEye()[3];
      const dy = rightEye.y - leftEye.y;
      const dx = rightEye.x - leftEye.x;
      if (dx === 0) return 0;
      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const mirrored = paramsRef.current?.isMirrored ?? isMirrored;
      return Number((mirrored ? -angleDeg : angleDeg).toFixed(1));
    } catch {
      return 0;
    }
  }

  function computeEyebrow(landmarks) {
    try {
      const leftBrow = landmarks.getLeftEyeBrow()[2];
      const leftEye = landmarks.getLeftEye()[1];
      const rightBrow = landmarks.getRightEyeBrow()[2];
      const rightEye = landmarks.getRightEye()[1];
      const eyeWidth = dist(landmarks.getLeftEye()[0], landmarks.getLeftEye()[3]);
      if (eyeWidth === 0) return 0.35;
      return (dist(leftBrow, leftEye) + dist(rightBrow, rightEye)) / (2.0 * eyeWidth);
    } catch {
      return 0.35;
    }
  }

  function sampleLuminance(video) {
    try {
      if (!canvasRef.current || !video || video.videoWidth === 0) return 120;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, 32, 24);
      const imgData = ctx.getImageData(0, 0, 32, 24).data;
      let total = 0;
      for (let i = 0; i < imgData.length; i += 4) {
        total += 0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2];
      }
      return Math.round(total / (imgData.length / 4));
    } catch {
      return 120;
    }
  }

  // ── Main Telemetry Loop ──────────────────────────────────────────────────
  function startTelemetryLoop() {
    async function frameLoop() {
      if (!isMountedRef.current || !isCameraRunningRef.current) {
        return;
      }
      if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) {
        animFrameIdRef.current = requestAnimationFrame(frameLoop);
        return;
      }

      const now = performance.now();
      const tState = telemetryRef.current;

      // 1. Calculate FPS
      tState.fpsFrames.push(now);
      while (tState.fpsFrames.length > 0 && tState.fpsFrames[0] < now - 1000) {
        tState.fpsFrames.shift();
      }
      const currentFps = tState.fpsFrames.length;

      // 2. Measure Luminance
      const lum = sampleLuminance(videoRef.current);

      try {
        const detectorOptions = new faceapi.TinyFaceDetectorOptions({
          inputSize: 416,
          scoreThreshold: scoreThreshold,
        });

        const detection = await faceapi
          .detectSingleFace(videoRef.current, detectorOptions)
          .withFaceLandmarks();

        if (!detection) {
          setTelemetry((prev) => ({
            ...prev,
            fps: currentFps,
            luminance: lum,
            faceState: 'no_face',
            confidence: 0,
          }));
        } else {
          const landmarks = detection.landmarks;
          const box = detection.detection.box;
          const vWidth = videoRef.current.videoWidth || 640;
          const vHeight = videoRef.current.videoHeight || 480;
          const faceAreaPercent = Math.round(((box.width * box.height) / (vWidth * vHeight)) * 100);

          const leftEar = computeEar(landmarks.getLeftEye());
          const rightEar = computeEar(landmarks.getRightEye());
          const avgEar = (leftEar + rightEar) / 2;

          // 3-frame rolling EAR smoothing
          tState.earHistory.push(avgEar);
          if (tState.earHistory.length > 3) tState.earHistory.shift();
          const smoothedEar = tState.earHistory.reduce((a, b) => a + b, 0) / tState.earHistory.length;

          const rawYaw = computeYaw(landmarks);
          const rawPitch = computePitch(landmarks);
          const rawTilt = computeTilt(landmarks);
          const eyebrowRaise = computeEyebrow(landmarks);

          // Calibrate baselines over initial stable frontal frames (yaw < 12°)
          if (!tState.isCalibrated && Math.abs(rawYaw) < 12) {
            tState.baselineEars.push(smoothedEar);
            tState.baselineYaws.push(rawYaw);
            tState.baselinePitches.push(rawPitch);
            tState.baselineTilts.push(rawTilt);
            tState.baselineEyebrows.push(eyebrowRaise);

            if (tState.baselineEars.length >= 10) {
              tState.isCalibrated = true;
              tState.calibratedAt = now;
            }
          }

          // Medians / Averages for Baselines
          const medianEar = tState.baselineEars.length > 0
            ? [...tState.baselineEars].sort((a, b) => a - b)[Math.floor(tState.baselineEars.length / 2)]
            : 0.28;
          const baselineYaw = tState.baselineYaws.length > 0
            ? tState.baselineYaws.reduce((a, b) => a + b, 0) / tState.baselineYaws.length
            : 0;
          const baselinePitch = tState.baselinePitches.length > 0
            ? tState.baselinePitches.reduce((a, b) => a + b, 0) / tState.baselinePitches.length
            : 0;
          const baselineTilt = tState.baselineTilts.length > 0
            ? tState.baselineTilts.reduce((a, b) => a + b, 0) / tState.baselineTilts.length
            : 0;
          const baselineEyebrow = tState.baselineEyebrows.length > 0
            ? tState.baselineEyebrows.reduce((a, b) => a + b, 0) / tState.baselineEyebrows.length
            : 0.35;

          const relYaw = Number((rawYaw - baselineYaw).toFixed(1));
          const relPitch = Number((rawPitch - baselinePitch).toFixed(1));
          const relTilt = Number((rawTilt - baselineTilt).toFixed(1));

          // Record extreme peaks
          if (Math.abs(relYaw) > Math.abs(tState.peakYaw)) tState.peakYaw = relYaw;
          if (Math.abs(relPitch) > Math.abs(tState.peakPitch)) tState.peakPitch = relPitch;
          if (Math.abs(relTilt) > Math.abs(tState.peakTilt)) tState.peakTilt = relTilt;
          if (smoothedEar < tState.minEarRecorded) tState.minEarRecorded = smoothedEar;

          // ── BLINK DETECTOR WITH HYSTERESIS & ADAPTIVE BASELINE ──
          const currentCloseFactor = paramsRef.current?.closeFactor ?? closeFactor;
          const currentOpenFactor = paramsRef.current?.openFactor ?? openFactor;
          const currentTurnThresh = paramsRef.current?.turnThreshold ?? turnThreshold;
          const currentNodThresh = paramsRef.current?.nodThreshold ?? nodThreshold;
          const currentTiltThresh = paramsRef.current?.tiltThreshold ?? tiltThreshold;

          const closeThresh = Math.min(0.24, medianEar * currentCloseFactor);
          const openThresh = Math.max(0.20, medianEar * currentOpenFactor);
          const isDipping =
            smoothedEar <= closeThresh ||
            (medianEar - smoothedEar) >= 0.015 ||
            leftEar < 0.20 ||
            rightEar < 0.20;

          if (!tState.inBlink && isDipping) {
            tState.inBlink = true;
            tState.minEarDuringBlink = smoothedEar;
          } else if (tState.inBlink) {
            if (smoothedEar < tState.minEarDuringBlink) {
              tState.minEarDuringBlink = smoothedEar;
            }
            const isReopened =
              smoothedEar >= openThresh ||
              (smoothedEar - tState.minEarDuringBlink) >= 0.014 ||
              (leftEar > 0.23 && rightEar > 0.23);

            if (isReopened) {
              tState.totalBlinks += 1;
              tState.inBlink = false;
            }
          }

          // ── HEAD TURN DETECTORS ──
          if (relYaw < -currentTurnThresh) tState.turnLeftDone = true;
          if (relYaw > currentTurnThresh) tState.turnRightDone = true;
          if (Math.abs(relYaw) >= currentTurnThresh) tState.turnAnyDone = true;

          // ── HEAD NOD DETECTOR ──
          // True nod down: pitch increases significantly above baseline
          if (relPitch >= currentNodThresh || Math.abs(relPitch) >= currentNodThresh) {
            tState.nodDone = true;
          }

          // ── HEAD TILT DETECTORS ──
          if (relTilt < -currentTiltThresh) tState.tiltLeftDone = true;
          if (relTilt > currentTiltThresh) tState.tiltRightDone = true;
          if (Math.abs(relTilt) >= currentTiltThresh) tState.tiltAnyDone = true;

          if (eyebrowRaise >= baselineEyebrow + 0.035) tState.eyebrowDone = true;

          setTelemetry({
            fps: currentFps,
            confidence: Math.round(detection.detection.score * 100),
            faceSizePercent: faceAreaPercent,
            boxWidth: Math.round(box.width),
            boxHeight: Math.round(box.height),
            luminance: lum,
            leftEar: Number(leftEar.toFixed(3)),
            rightEar: Number(rightEar.toFixed(3)),
            avgEar: Number(avgEar.toFixed(3)),
            smoothedEar: Number(smoothedEar.toFixed(3)),
            baselineEar: Number(medianEar.toFixed(3)),
            rawYaw: Number(rawYaw.toFixed(1)),
            baselineYaw: Number(baselineYaw.toFixed(1)),
            relYaw,
            rawPitch: Number(rawPitch.toFixed(1)),
            baselinePitch: Number(baselinePitch.toFixed(1)),
            relPitch,
            rawTilt: Number(rawTilt.toFixed(1)),
            baselineTilt: Number(baselineTilt.toFixed(1)),
            relTilt,
            eyebrowRaise: Number(eyebrowRaise.toFixed(3)),
            eyebrowBaseline: Number(baselineEyebrow.toFixed(3)),
            faceState: tState.isCalibrated ? 'tracking' : 'calibrating',
          });

          // Check Active Test Run Progress
          handleTestProgress(relYaw, relPitch, relTilt);
        }
      } catch {
        // ignore occasional frame processing glitch
      }

      animFrameIdRef.current = requestAnimationFrame(frameLoop);
    }

    animFrameIdRef.current = requestAnimationFrame(frameLoop);
  }

  // ── Liveness Test Runner ─────────────────────────────────────────────────
  function startTestRun() {
    const tState = telemetryRef.current;
    // Reset test trackers
    tState.step1Done = false;
    tState.step1DoneTime = 0;
    tState.blinkCountAtStep1 = tState.totalBlinks;
    tState.turnLeftDone = false;
    tState.turnRightDone = false;
    tState.turnAnyDone = false;
    tState.nodDone = false;
    tState.tiltLeftDone = false;
    tState.tiltRightDone = false;
    tState.tiltAnyDone = false;
    tState.eyebrowDone = false;
    tState.peakYaw = 0;
    tState.peakPitch = 0;
    tState.peakTilt = 0;
    tState.minEarRecorded = 1.0;

    setTestState({
      isRunning: true,
      currentStep: 1,
      step1Done: false,
      step2Done: false,
      result: null,
      reason: '',
      startTime: Date.now(),
      elapsedMs: 0,
      feedback: getChallengeInstruction(selectedChallenge, 1),
    });
  }

  function handleTestProgress(relYaw, relPitch, relTilt) {
    setTestState((prev) => {
      if (!prev.isRunning || prev.result !== null) return prev;

      const now = Date.now();
      const elapsed = now - prev.startTime;
      const tState = telemetryRef.current;

      // Timeout after 6.5 seconds
      if (elapsed > 6500) {
        logAttemptRecord('FAILED (Timeout)', elapsed);
        return {
          ...prev,
          isRunning: false,
          result: 'failed',
          reason: 'Timed out: Challenge gesture was not completed in 6.5s window.',
          elapsedMs: elapsed,
          feedback: '❌ Test Timed Out. Try again.',
        };
      }

      const activeChallenge = paramsRef.current?.selectedChallenge ?? selectedChallenge;
      const isCombo = activeChallenge.startsWith('combo_') || activeChallenge === 'double_blink' || activeChallenge === 'custom_combo';

      if (!isCombo) {
        // SINGLE CHALLENGE EVALUATION
        let passed = false;
        if (activeChallenge === 'blink') passed = tState.totalBlinks > tState.blinkCountAtStep1;
        else if (activeChallenge === 'turn_left') passed = tState.turnLeftDone;
        else if (activeChallenge === 'turn_right') passed = tState.turnRightDone;
        else if (activeChallenge === 'turn_any') passed = tState.turnAnyDone;
        else if (activeChallenge === 'nod_head') passed = tState.nodDone;
        else if (activeChallenge === 'tilt_head' || activeChallenge === 'tilt_any') passed = tState.tiltAnyDone;
        else if (activeChallenge === 'tilt_left') passed = tState.tiltLeftDone;
        else if (activeChallenge === 'tilt_right') passed = tState.tiltRightDone;
        else if (activeChallenge === 'raise_eyebrows') passed = tState.eyebrowDone;

        if (passed) {
          logAttemptRecord('PASSED', elapsed);
          return {
            ...prev,
            isRunning: false,
            step1Done: true,
            result: 'passed',
            reason: 'Challenge movement verified successfully!',
            elapsedMs: elapsed,
            feedback: '✅ Challenge PASSED!',
          };
        }
      } else {
        // COMBO CHALLENGE EVALUATION (STEP 1 THEN STEP 2)
        if (prev.currentStep === 1) {
          let step1Target = 'turn_any';
          if (activeChallenge === 'combo_turn_blink') step1Target = 'turn_any';
          else if (activeChallenge === 'combo_nod_blink') step1Target = 'nod_head';
          else if (activeChallenge === 'combo_tilt_blink') step1Target = 'tilt_head';
          else if (activeChallenge === 'double_blink') step1Target = 'blink';
          else if (activeChallenge === 'custom_combo') step1Target = paramsRef.current?.customStep1 ?? customStep1;

          let step1Passed = false;
          if (step1Target === 'turn_any') step1Passed = tState.turnAnyDone;
          else if (step1Target === 'turn_left') step1Passed = tState.turnLeftDone;
          else if (step1Target === 'turn_right') step1Passed = tState.turnRightDone;
          else if (step1Target === 'nod_head') step1Passed = tState.nodDone;
          else if (step1Target === 'tilt_head' || step1Target === 'tilt_any') step1Passed = tState.tiltAnyDone;
          else if (step1Target === 'raise_eyebrows') step1Passed = tState.eyebrowDone;
          else if (step1Target === 'blink') step1Passed = tState.totalBlinks > tState.blinkCountAtStep1;

          if (step1Passed) {
            tState.step1Done = true;
            tState.step1DoneTime = now;
            tState.blinkCountAtStep1 = tState.totalBlinks; // snapshot for fresh step 2 blink!
            return {
              ...prev,
              currentStep: 2,
              step1Done: true,
              elapsedMs: elapsed,
              feedback: getChallengeInstruction(activeChallenge, 2),
            };
          }
        } else if (prev.currentStep === 2) {
          // STEP 2: MUST OCCUR AFTER STEP 1 TRANSITION
          const sinceStep1 = now - tState.step1DoneTime;
          let step2Target = 'blink';
          if (activeChallenge === 'custom_combo') step2Target = paramsRef.current?.customStep2 ?? customStep2;

          let step2Passed = false;
          if (step2Target === 'blink') {
            step2Passed = sinceStep1 > 250 && tState.totalBlinks > tState.blinkCountAtStep1;
          } else if (step2Target === 'turn_any') {
            step2Passed = sinceStep1 > 250 && tState.turnAnyDone;
          } else if (step2Target === 'tilt_head' || step2Target === 'tilt_any') {
            step2Passed = sinceStep1 > 250 && tState.tiltAnyDone;
          } else if (step2Target === 'nod_head') {
            step2Passed = sinceStep1 > 250 && tState.nodDone;
          }

          if (step2Passed) {
            logAttemptRecord('PASSED', elapsed);
            return {
              ...prev,
              isRunning: false,
              step2Done: true,
              result: 'passed',
              reason: 'Both combo steps verified successfully in sequence!',
              elapsedMs: elapsed,
              feedback: '✅ Combo Challenge PASSED!',
            };
          }
        }
      }

      return {
        ...prev,
        elapsedMs: elapsed,
      };
    });
  }

  function getChallengeInstruction(challengeKey, step) {
    if (step === 1) {
      switch (challengeKey) {
        case 'blink': return '👁️ Step 1 of 1: Look at camera and BLINK once naturally';
        case 'double_blink': return '👀 Step 1 of 2: BLINK first time';
        case 'turn_left': return '👈 Step 1 of 1: Turn head to the LEFT (~20°) and return';
        case 'turn_right': return '👉 Step 1 of 1: Turn head to the RIGHT (~20°) and return';
        case 'turn_any': return '↔️ Step 1 of 1: Turn head to EITHER side (~20°) and return';
        case 'nod_head': return '↕️ Step 1 of 1: NOD head gently downward and return';
        case 'tilt_head':
        case 'tilt_any': return '🔄 Step 1 of 1: TILT your head slightly to the shoulder (~10°) and return';
        case 'tilt_left': return '↖️ Step 1 of 1: TILT head to the LEFT shoulder and return';
        case 'tilt_right': return '↗️ Step 1 of 1: TILT head to the RIGHT shoulder and return';
        case 'raise_eyebrows': return '😯 Step 1 of 1: RAISE eyebrows upward';
        case 'combo_turn_blink': return '↔️ Step 1 of 2: Turn head slightly to EITHER side and return';
        case 'combo_nod_blink': return '↕️ Step 1 of 2: NOD head gently downward and return';
        case 'combo_tilt_blink': return '🔄 Step 1 of 2: TILT head slightly to the shoulder and return';
        case 'custom_combo': return `✨ Step 1 of 2: Perform ${customStep1}`;
        default: return 'Perform requested gesture';
      }
    } else {
      switch (challengeKey) {
        case 'double_blink': return '👀 Step 2 of 2: BLINK once more';
        case 'combo_turn_blink':
        case 'combo_nod_blink':
        case 'combo_tilt_blink': return '👁️ Step 2 of 2: Now BLINK once naturally';
        case 'custom_combo': return `✨ Step 2 of 2: Perform ${customStep2}`;
        default: return 'Complete step 2';
      }
    }
  }

  // ── Classmate Attempt Logging ─────────────────────────────────────────────
  function logAttemptRecord(outcome, durationMs) {
    const tState = telemetryRef.current;
    const record = {
      id: Date.now(),
      attemptNum: attemptsLog.length + 1,
      tester: testerName || 'Anonymous',
      device: deviceType,
      lighting: lightingCondition,
      eyewear: eyewear,
      notes: notes || '—',
      challenge: selectedChallenge === 'custom_combo' ? `custom (${customStep1}+${customStep2})` : selectedChallenge,
      outcome,
      durationMs,
      avgFps: telemetry.fps,
      baselineEar: telemetry.baselineEar,
      minEarDip: Number(tState.minEarRecorded.toFixed(3)),
      peakYaw: tState.peakYaw,
      peakPitch: tState.peakPitch,
      timestamp: new Date().toLocaleTimeString(),
    };

    setAttemptsLog((prev) => [record, ...prev]);
  }

  function exportCsv() {
    if (attemptsLog.length === 0) {
      alert('No logged attempts to export. Run a few tests first!');
      return;
    }

    const headers = [
      'Attempt',
      'Tester',
      'Device',
      'Lighting',
      'Eyewear',
      'Challenge',
      'Outcome',
      'Duration (ms)',
      'FPS',
      'Baseline EAR',
      'Min EAR Dip',
      'Peak Yaw (deg)',
      'Peak Pitch (deg)',
      'Timestamp',
      'Notes',
    ];

    const rows = attemptsLog.map((r) => [
      r.attemptNum,
      `"${r.tester}"`,
      `"${r.device}"`,
      `"${r.lighting}"`,
      `"${r.eyewear}"`,
      `"${r.challenge}"`,
      r.outcome,
      r.durationMs,
      r.avgFps,
      r.baselineEar,
      r.minEarDip,
      r.peakYaw,
      r.peakPitch,
      r.timestamp,
      `"${r.notes}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `zeroproxy_liveness_trials_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ── UI Styles ────────────────────────────────────────────────────────────
  const cardStyle = {
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '16px',
    padding: '22px',
    backdropFilter: 'blur(12px)',
  };

  const metricTileStyle = {
    background: 'rgba(15, 23, 42, 0.7)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '12px',
    padding: '14px',
  };

  const selectStyle = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.18)',
    background: 'rgba(15, 23, 42, 0.9)',
    color: '#ffffff',
    fontSize: '13px',
    outline: 'none',
  };

  const ringColor =
    telemetry.faceState === 'no_face'
      ? '#fb7185' // Red
      : testState.result === 'passed'
      ? '#4ade80' // Green
      : testState.step1Done
      ? '#38bdf8' // Cyan
      : telemetry.luminance < 45
      ? '#fbbf24' // Yellow
      : '#67e8f9';

  return (
    <div style={{ color: '#ffffff' }}>
      {/* Hidden canvas for real-time luminance measurement */}
      <canvas ref={canvasRef} width="32" height="24" style={{ display: 'none' }} />

      {/* Lab Header */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '15px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <span
              style={{
                background: 'rgba(6, 182, 212, 0.2)',
                color: '#67e8f9',
                padding: '4px 10px',
                borderRadius: '8px',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              ADMIN TELEMETRY LAB
            </span>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              Real-time Biometrics &amp; Liveness Diagnostic Rig
            </span>
          </div>
          <h2 style={{ fontSize: '26px', margin: '0 0 6px', fontWeight: 700 }}>
            🔬 Liveness Detection Diagnostics &amp; Benchmarking
          </h2>
          <p style={{ color: '#a5acc5', margin: 0, fontSize: '14px', maxWidth: '850px' }}>
            Test individual and combo liveness challenges, view live eye aspect ratio (EAR), head turn yaw angles,
            framing ratios, and record 10-attempt classmate trials across varied lighting, devices, and glasses.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            onClick={cameraActive ? stopCamera : startCamera}
            style={{
              padding: '10px 18px',
              borderRadius: '10px',
              border: cameraActive ? '1px solid rgba(251, 113, 133, 0.4)' : 'none',
              background: cameraActive ? 'rgba(251, 113, 133, 0.15)' : 'linear-gradient(135deg, #0284c7, #2563eb)',
              color: cameraActive ? '#fb7185' : '#ffffff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {cameraActive ? '⏹ Stop Camera' : '▶ Start Camera'}
          </button>
        </div>
      </div>

      {cameraError && (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: '10px',
            background: 'rgba(251, 113, 133, 0.15)',
            border: '1px solid rgba(251, 113, 133, 0.4)',
            color: '#fb7185',
            marginBottom: '20px',
            fontSize: '14px',
          }}
        >
          ⚠️ {cameraError}
        </div>
      )}

      {/* Main Lab Grid: Live Viewport (Left) + Real-Time Telemetry HUD (Right) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 480px) 1fr', gap: '24px', marginBottom: '28px' }}>
        {/* Left Column: Live Video Feed & Visual Guidance Overlay */}
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#67e8f9' }}>
              🎥 Camera Viewport ({telemetry.fps} FPS)
            </span>
            <label style={{ fontSize: '12px', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isMirrored}
                onChange={(e) => setIsMirrored(e.target.checked)}
              />
              Mirror Preview
            </label>
          </div>

          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '340px',
              background: '#090d1a',
              borderRadius: '12px',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: `2px solid ${ringColor}`,
              boxShadow: `0 0 20px ${ringColor}33`,
              transition: 'border-color 0.3s ease',
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: isMirrored ? 'scaleX(-1)' : 'none',
              }}
            />

            {/* Oval Face Guide */}
            <div
              style={{
                position: 'absolute',
                width: '190px',
                height: '250px',
                borderRadius: '50%',
                border: `3px dashed ${ringColor}`,
                pointerEvents: 'none',
                boxShadow: `inset 0 0 15px ${ringColor}22`,
                transition: 'border-color 0.2s ease',
              }}
            />

            {/* Luminance Warning Banner */}
            {telemetry.luminance < 45 && (
              <div
                style={{
                  position: 'absolute',
                  top: '12px',
                  background: 'rgba(251, 191, 36, 0.9)',
                  color: '#0f172a',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                }}
              >
                💡 Dim Room ({telemetry.luminance}) — Move towards light
              </div>
            )}

            {/* Live Head Turn Bar Overlay */}
            <div
              style={{
                position: 'absolute',
                bottom: '12px',
                width: '80%',
                background: 'rgba(15, 23, 42, 0.85)',
                padding: '6px 12px',
                borderRadius: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '11px',
                color: '#cbd5e1',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <span>← L ({turnThreshold}°)</span>
              <div style={{ flex: 1, height: '6px', background: '#334155', borderRadius: '4px', position: 'relative' }}>
                {/* Center marker */}
                <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '2px', background: '#94a3b8' }} />
                {/* Current angle cursor */}
                <div
                  style={{
                    position: 'absolute',
                    top: '-3px',
                    left: `${Math.min(95, Math.max(5, 50 + (telemetry.relYaw / 35) * 50))}%`,
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: Math.abs(telemetry.relYaw) >= turnThreshold ? '#4ade80' : '#38bdf8',
                    transform: 'translateX(-50%)',
                    transition: 'left 0.05s linear',
                  }}
                />
              </div>
              <span>R ({turnThreshold}°) →</span>
            </div>
          </div>

          {/* Test Status Banner */}
          <div
            style={{
              padding: '14px',
              borderRadius: '10px',
              background:
                testState.result === 'passed'
                  ? 'rgba(74, 222, 128, 0.15)'
                  : testState.result === 'failed'
                  ? 'rgba(251, 113, 133, 0.15)'
                  : testState.isRunning
                  ? 'rgba(56, 189, 248, 0.15)'
                  : 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${
                testState.result === 'passed'
                  ? 'rgba(74, 222, 128, 0.4)'
                  : testState.result === 'failed'
                  ? 'rgba(251, 113, 133, 0.4)'
                  : testState.isRunning
                  ? 'rgba(56, 189, 248, 0.4)'
                  : 'rgba(255, 255, 255, 0.1)'
              }`,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '14px', fontWeight: 700, color: testState.result === 'passed' ? '#4ade80' : testState.result === 'failed' ? '#fb7185' : '#67e8f9' }}>
              {testState.feedback}
            </div>
            {testState.isRunning && (
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                Window: {(testState.elapsedMs / 1000).toFixed(1)}s / 6.5s
              </div>
            )}
          </div>

          {/* Test Action Button */}
          <button
            type="button"
            disabled={!cameraActive}
            onClick={testState.isRunning ? () => setTestState((p) => ({ ...p, isRunning: false, result: 'failed', feedback: 'Cancelled' })) : startTestRun}
            style={{
              width: '100%',
              padding: '13px',
              borderRadius: '10px',
              border: 'none',
              background: testState.isRunning
                ? 'linear-gradient(135deg, #e11d48, #be123c)'
                : 'linear-gradient(135deg, #06b6d4, #6366f1)',
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 700,
              cursor: cameraActive ? 'pointer' : 'not-allowed',
              boxShadow: '0 4px 14px rgba(6, 182, 212, 0.3)',
            }}
          >
            {testState.isRunning ? '⏹ Abort Current Test' : '🚀 Start Liveness Test Run'}
          </button>
        </div>

        {/* Right Column: Real-Time Telemetry HUD & Configurator */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Diagnostic Metrics HUD Grid */}
          <div style={cardStyle}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: '#67e8f9', display: 'flex', alignItems: 'center', gap: '8px' }}>
              📊 Real-Time Biometric Telemetry
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              {/* Eye Openness (EAR) */}
              <div style={metricTileStyle}>
                <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase' }}>Eye Openness (EAR)</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: telemetry.smoothedEar < telemetry.baselineEar * closeFactor ? '#fbbf24' : '#4ade80', margin: '4px 0' }}>
                  {telemetry.smoothedEar.toFixed(3)}
                </div>
                <div style={{ fontSize: '11px', color: '#cbd5e1' }}>
                  L: {telemetry.leftEar} | R: {telemetry.rightEar}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  Base: {telemetry.baselineEar} | Close: &lt;{(telemetry.baselineEar * closeFactor).toFixed(3)}
                </div>
              </div>

              {/* Head Turn (Yaw) */}
              <div style={metricTileStyle}>
                <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase' }}>Head Turn (Yaw)</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: Math.abs(telemetry.relYaw) >= turnThreshold ? '#4ade80' : '#38bdf8', margin: '4px 0' }}>
                  {telemetry.relYaw > 0 ? `+${telemetry.relYaw}°` : `${telemetry.relYaw}°`}
                </div>
                <div style={{ fontSize: '11px', color: '#cbd5e1' }}>
                  Direction: {Math.abs(telemetry.relYaw) < 6 ? 'Frontal' : telemetry.relYaw < 0 ? '← Left' : 'Right →'}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  Base: {telemetry.baselineYaw}° | Target: ±{turnThreshold}°
                </div>
              </div>

              {/* Head Nod (Pitch) */}
              <div style={metricTileStyle}>
                <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase' }}>Head Nod (Pitch)</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: telemetry.relPitch >= nodThreshold ? '#4ade80' : '#cbd5e1', margin: '4px 0' }}>
                  {telemetry.relPitch > 0 ? `+${telemetry.relPitch}°` : `${telemetry.relPitch}°`}
                </div>
                <div style={{ fontSize: '11px', color: '#cbd5e1' }}>
                  Motion: {Math.abs(telemetry.relPitch) < 3 ? 'Neutral' : telemetry.relPitch > 0 ? 'Down (Nod)' : 'Up'}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  Target: &ge;+{nodThreshold}°
                </div>
              </div>

              {/* Head Tilt (Roll) */}
              <div style={metricTileStyle}>
                <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase' }}>Head Tilt (Angle)</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: Math.abs(telemetry.relTilt) >= tiltThreshold ? '#4ade80' : '#38bdf8', margin: '4px 0' }}>
                  {telemetry.relTilt > 0 ? `+${telemetry.relTilt}°` : `${telemetry.relTilt}°`}
                </div>
                <div style={{ fontSize: '11px', color: '#cbd5e1' }}>
                  Tilt: {Math.abs(telemetry.relTilt) < 4 ? 'Level' : telemetry.relTilt < 0 ? '↖ Left' : 'Right ↗'}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  Target: &plusmn;{tiltThreshold}°
                </div>
              </div>

              {/* Frame Rate & Confidence */}
              <div style={metricTileStyle}>
                <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase' }}>Tracking Quality</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: telemetry.confidence > 70 ? '#4ade80' : '#fbbf24', margin: '4px 0' }}>
                  {telemetry.confidence}%
                </div>
                <div style={{ fontSize: '11px', color: '#cbd5e1' }}>
                  FPS: {telemetry.fps} | Light: {telemetry.luminance}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  Face: {telemetry.faceSizePercent}% of viewport ({telemetry.boxWidth}x{telemetry.boxHeight}px)
                </div>
              </div>
            </div>
          </div>

          {/* Challenge Selector & Live Parameter Tuners */}
          <div style={cardStyle}>
            <h3 style={{ margin: '0 0 14px', fontSize: '16px', color: '#67e8f9' }}>
              ⚙️ Challenge Configurator &amp; Threshold Tuning
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px' }}>
                  Challenge to Test:
                </label>
                <select
                  value={selectedChallenge}
                  onChange={(e) => setSelectedChallenge(e.target.value)}
                  style={selectStyle}
                >
                  <optgroup label="Combo Challenges (Multi-Step)">
                    <option value="combo_turn_blink">↔️👁️ Combo: Turn Head + Blink</option>
                    <option value="combo_tilt_blink">🔄👁️ Combo: Tilt Head + Blink</option>
                    <option value="combo_nod_blink">↕️👁️ Combo: Head Nod + Blink</option>
                    <option value="double_blink">👀 Combo: Double Blink</option>
                    <option value="custom_combo">🛠 Custom 2-Step Combo Builder</option>
                  </optgroup>
                  <optgroup label="Single Challenges">
                    <option value="blink">👁️ Natural Blink Once</option>
                    <option value="tilt_head">🔄 Tilt Head to Shoulder</option>
                    <option value="tilt_left">↖️ Tilt Head Left</option>
                    <option value="tilt_right">↗️ Tilt Head Right</option>
                    <option value="turn_any">↔️ Turn Head to Either Side</option>
                    <option value="turn_left">👈 Turn Head Left</option>
                    <option value="turn_right">👉 Turn Head Right</option>
                    <option value="nod_head">↕️ Head Nod Downward</option>
                    <option value="raise_eyebrows">😯 Raise Eyebrows</option>
                  </optgroup>
                </select>
              </div>

              {selectedChallenge === 'custom_combo' ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px' }}>Step 1:</label>
                    <select value={customStep1} onChange={(e) => setCustomStep1(e.target.value)} style={selectStyle}>
                      <option value="turn_any">Turn Head (Either)</option>
                      <option value="turn_left">Turn Left</option>
                      <option value="turn_right">Turn Right</option>
                      <option value="tilt_head">Tilt Head</option>
                      <option value="nod_head">Head Nod</option>
                      <option value="blink">Blink</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px' }}>Step 2:</label>
                    <select value={customStep2} onChange={(e) => setCustomStep2(e.target.value)} style={selectStyle}>
                      <option value="blink">Blink</option>
                      <option value="turn_any">Turn Head</option>
                      <option value="tilt_head">Tilt Head</option>
                      <option value="nod_head">Head Nod</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px' }}>
                    Challenge Type:
                  </label>
                  <div style={{ fontSize: '13px', color: '#94a3b8', padding: '10px 0' }}>
                    {selectedChallenge.includes('combo') || selectedChallenge === 'double_blink'
                      ? '⚡ 2-Step Sequenced Protocol'
                      : '⚡ 1-Step Single Gesture Protocol'}
                  </div>
                </div>
              )}
            </div>

            {/* Threshold Sliders */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#cbd5e1', marginBottom: '4px' }}>
                  <span>Blink Close Factor:</span>
                  <strong style={{ color: '#67e8f9' }}>{closeFactor * 100}% of base</strong>
                </div>
                <input
                  type="range"
                  min="0.60"
                  max="0.82"
                  step="0.02"
                  value={closeFactor}
                  onChange={(e) => setCloseFactor(parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#cbd5e1', marginBottom: '4px' }}>
                  <span>Head Turn Target:</span>
                  <strong style={{ color: '#67e8f9' }}>±{turnThreshold}° yaw</strong>
                </div>
                <input
                  type="range"
                  min="12"
                  max="30"
                  step="1"
                  value={turnThreshold}
                  onChange={(e) => setTurnThreshold(parseInt(e.target.value, 10))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Classmate Trials Recorder (10-Attempt Benchmark Session) */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', color: '#67e8f9' }}>
              📋 Classmate 10-Attempt Trial Logging
            </h3>
            <p style={{ color: '#a5acc5', margin: '4px 0 0', fontSize: '13px' }}>
              Record empirical results across classmates (with/without glasses, bright/dim rooms, mobile/laptop) to validate thresholds.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={exportCsv}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: '1px solid rgba(103, 232, 249, 0.4)',
                background: 'rgba(103, 232, 249, 0.1)',
                color: '#67e8f9',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              📥 Export Trials (CSV)
            </button>
            <button
              type="button"
              onClick={() => setAttemptsLog([])}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: 'transparent',
                color: '#94a3b8',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Clear Log
            </button>
          </div>
        </div>

        {/* Trial Metadata Configurator */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '18px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Tester Name:</label>
            <input
              type="text"
              value={testerName}
              onChange={(e) => setTesterName(e.target.value)}
              placeholder="e.g. Rahul / Student A"
              style={{ ...selectStyle, padding: '8px 12px' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Device Tested:</label>
            <select value={deviceType} onChange={(e) => setDeviceType(e.target.value)} style={{ ...selectStyle, padding: '8px 12px' }}>
              <option value="Laptop Webcam">Laptop Webcam</option>
              <option value="Android Phone (Chrome)">Android Phone (Chrome)</option>
              <option value="iPhone (Safari)">iPhone (Safari)</option>
              <option value="External USB Cam">External USB Cam</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Environment:</label>
            <select value={lightingCondition} onChange={(e) => setLightingCondition(e.target.value)} style={{ ...selectStyle, padding: '8px 12px' }}>
              <option value="Normal / Well-Lit">Normal / Well-Lit</option>
              <option value="Dim / Dorm Room">Dim / Dorm Room</option>
              <option value="Backlit Window">Backlit Window</option>
              <option value="Bright Outdoor">Bright Outdoor</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Eyewear:</label>
            <select value={eyewear} onChange={(e) => setEyewear(e.target.value)} style={{ ...selectStyle, padding: '8px 12px' }}>
              <option value="No Glasses">No Glasses</option>
              <option value="Clear Prescription Glasses">Clear Prescription Glasses</option>
              <option value="Heavy Frames">Heavy Frames</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Trial Notes:</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Sitting close, fast blink"
              style={{ ...selectStyle, padding: '8px 12px' }}
            />
          </div>
        </div>

        {/* Attempts Log Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px' }}>
            <thead>
              <tr style={{ color: '#67e8f9', fontSize: '12px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <th style={{ padding: '10px 8px' }}>#</th>
                <th style={{ padding: '10px 8px' }}>Tester</th>
                <th style={{ padding: '10px 8px' }}>Device &amp; Condition</th>
                <th style={{ padding: '10px 8px' }}>Challenge</th>
                <th style={{ padding: '10px 8px' }}>Outcome</th>
                <th style={{ padding: '10px 8px' }}>Duration</th>
                <th style={{ padding: '10px 8px' }}>EAR Base / Dip</th>
                <th style={{ padding: '10px 8px' }}>Peak Yaw / Pitch</th>
                <th style={{ padding: '10px 8px' }}>FPS</th>
                <th style={{ padding: '10px 8px' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {attemptsLog.length > 0 ? (
                attemptsLog.map((log) => (
                  <tr key={log.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', fontSize: '13px' }}>
                    <td style={{ padding: '10px 8px', color: '#94a3b8' }}>#{log.attemptNum}</td>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{log.tester}</td>
                    <td style={{ padding: '10px 8px', color: '#cbd5e1' }}>
                      {log.device} • {log.lighting} ({log.eyewear})
                    </td>
                    <td style={{ padding: '10px 8px', color: '#67e8f9' }}>{log.challenge}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: '12px',
                          background: log.outcome === 'PASSED' ? 'rgba(74, 222, 128, 0.18)' : 'rgba(251, 113, 133, 0.18)',
                          color: log.outcome === 'PASSED' ? '#4ade80' : '#fb7185',
                        }}
                      >
                        {log.outcome}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px', color: '#cbd5e1' }}>{(log.durationMs / 1000).toFixed(2)}s</td>
                    <td style={{ padding: '10px 8px', color: '#cbd5e1' }}>
                      {log.baselineEar} → {log.minEarDip}
                    </td>
                    <td style={{ padding: '10px 8px', color: '#cbd5e1' }}>
                      {log.peakYaw}° / {log.peakPitch}°
                    </td>
                    <td style={{ padding: '10px 8px', color: '#94a3b8' }}>{log.avgFps}</td>
                    <td style={{ padding: '10px 8px', color: '#64748b', fontSize: '11px' }}>{log.timestamp}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                    No trial attempts recorded yet. Configure metadata above, click &quot;Start Liveness Test Run&quot;, and each attempt will be recorded here automatically.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
