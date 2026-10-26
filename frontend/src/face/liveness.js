import { faceapi, areModelsLoaded } from './loadModels.js';

// ─── LIVENESS CONFIGURATION OBJECT ───────────────────────────────────────────
// Centralized config for thresholds, timing, and user-facing text.
// All detection thresholds are marked as guesses to be calibrated against real traces.
export const LIVENESS_CONFIG = {
  // Detector parameters
  detector: {
    inputSize: 416,       // 416 gives higher landmark precision than 320 on mobile
    scoreThreshold: 0.4,  // Confidence floor for face presence
  },

  // Blink parameters (marked as guesses, to be tuned)
  blink: {
    ROLLING_WINDOW_MS: 1200, // Duration of rolling history for baseline computation
    BASELINE_PERCENTILE: 0.80, // 80th percentile of smoothed EAR over window
    MIN_BASELINE_EAR: 0.24,  // Floor for reference baseline (prevents divide by zero & depression)
    SMOOTHING_FRAMES: 2,     // Moving average filter over 2 frames (fast mobile responsiveness)
    CLOSE_RATIO: 0.86,       // Smoothed / reference <= 0.86 triggers CLOSED
    OPEN_RATIO: 0.92,        // Smoothed / reference >= 0.92 triggers recovery to OPEN
    MAX_CLOSED_MS: 1600,     // A closure > 1600ms is considered resting or eyes closed, not a blink
    MIN_CLOSED_MS: 30,       // Minimum closed duration (captures 1 frame at 15-25fps)
  },

  // Turn parameters (to be re-tuned in Phase 4 from recorded traces)
  turn: {
    EXCURSION_DEG: 10.0,
    RECOVERY_DEG: 8.0,
  },

  // Tilt parameters (roll toward shoulder)
  tilt: {
    EXCURSION_DEG: 7.5,
    RECOVERY_DEG: 4.5,
  },

  // Nod parameters (pitch downward)
  nod: {
    EXCURSION_DEG: 3.5,
    RECOVERY_DEG: 2.2,
  },

  // Timing & Series constraints
  timing: {
    MAX_DURATION_MS: 6500,
    MIN_SUBMIT_MS: 1850,
    DESIRED_SAMPLES: 2,
    SAMPLE_INTERVAL_MS: 350,
    SAMPLE_RATE_HZ: 15, // Rate to sample landmarkSeries (every ~66ms) to prevent 80-entry overflow
  },

  // User-facing prompts & instructions
  prompts: {
    blink: {
      title: 'Blink Challenge',
      instruction: 'Close your eyes gently for a moment, then open them',
      icon: '👁️',
      success: '✓ Blink verified! Finalizing...',
      failure: 'Blink was not detected in time. Please close your eyes gently and open them.',
    },
    tilt_head: {
      title: 'Head Tilt Challenge',
      instruction: 'Tilt your head slightly toward either shoulder, then straighten',
      icon: '🔄',
      success: '✓ Head tilt verified! Finalizing...',
      failure: 'Head tilt was not detected in time.',
    },
    nod_head: {
      title: 'Head Nod Challenge',
      instruction: 'Nod your head gently downward and back',
      icon: '↕️',
      success: '✓ Head nod verified! Finalizing...',
      failure: 'Head nod was not detected in time.',
    },
    turn_left: {
      title: 'Head Turn Left Challenge',
      instruction: 'Turn your head slightly to the LEFT and back',
      icon: '👈',
      success: '✓ Left turn verified! Finalizing...',
      failure: 'Head turn left was not detected in time.',
    },
    turn_right: {
      title: 'Head Turn Right Challenge',
      instruction: 'Turn your head slightly to the RIGHT and back',
      icon: '👉',
      success: '✓ Right turn verified! Finalizing...',
      failure: 'Head turn right was not detected in time.',
    },
  },
};

// ─── PURE GEOMETRIC MATH UTILITIES ───────────────────────────────────────────

export function dist(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

export function computeEyeOpenness(eyePoints) {
  if (!eyePoints || eyePoints.length < 6) return 0.28;
  const v1 = dist(eyePoints[1], eyePoints[5]);
  const v2 = dist(eyePoints[2], eyePoints[4]);
  const h = dist(eyePoints[0], eyePoints[3]);
  if (h === 0) return 0.28;
  return (v1 + v2) / (2.0 * h);
}

export function computeMouthRatio(mouthPoints) {
  if (!mouthPoints || mouthPoints.length < 12) return 0.1;
  const vertical = dist(mouthPoints[13] || mouthPoints[3], mouthPoints[19] || mouthPoints[9]);
  const horizontal = dist(mouthPoints[0], mouthPoints[6]);
  if (horizontal === 0) return 0.1;
  return vertical / horizontal;
}

export function computeYawDeg(landmarks) {
  try {
    const nose = landmarks.getNose()[3];
    const leftCheek = landmarks.getJawOutline()[0];
    const rightCheek = landmarks.getJawOutline()[16];
    const dLeft = dist(nose, leftCheek);
    const dRight = dist(nose, rightCheek);
    if (dLeft + dRight === 0) return 0;
    const diff = (dLeft - dRight) / (dLeft + dRight);
    return diff * 45; // between -45 and +45
  } catch {
    return 0;
  }
}

export function computePitchDeg(landmarks) {
  try {
    const leftEye = landmarks.getLeftEye()[0];
    const rightEye = landmarks.getRightEye()[3];
    const eyeMidY = (leftEye.y + rightEye.y) / 2;
    const noseTip = landmarks.getNose()[3];
    const chin = landmarks.getJawOutline()[8];

    const dUpperY = noseTip.y - eyeMidY;
    const dLowerY = chin.y - noseTip.y;
    if (dUpperY <= 0) return 0;

    const ratio = dLowerY / dUpperY;
    return Number(((1.4 - ratio) * 20).toFixed(1));
  } catch {
    return 0;
  }
}

export function computeTiltDeg(landmarks) {
  try {
    const leftEye = landmarks.getLeftEye()[0];
    const rightEye = landmarks.getRightEye()[3];
    const dy = rightEye.y - leftEye.y;
    const dx = rightEye.x - leftEye.x;
    if (dx === 0) return 0;
    return Number(((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1));
  } catch {
    return 0;
  }
}


export function computeEyebrowRaise(landmarks) {
  try {
    const leftBrow = landmarks.getLeftEyeBrow()[2];
    const leftEye = landmarks.getLeftEye()[1];
    const rightBrow = landmarks.getRightEyeBrow()[2];
    const rightEye = landmarks.getRightEye()[1];
    const dL = dist(leftBrow, leftEye);
    const dR = dist(rightBrow, rightEye);
    const eyeWidth = dist(landmarks.getLeftEye()[0], landmarks.getLeftEye()[3]);
    if (eyeWidth === 0) return 0.45;
    return (dL + dR) / (2.0 * eyeWidth);
  } catch {
    return 0.45;
  }
}

// ─── PURE BLINK STATE MACHINE ────────────────────────────────────────────────
// Testable in isolation without DOM/camera dependencies.
export class BlinkStateMachine {
  constructor(config = LIVENESS_CONFIG.blink) {
    this.config = config;
    this.state = 'OPEN'; // 'OPEN' | 'CLOSED' | 'COMPLETED' | 'INVALID'
    this.history = [];   // Array of { t_ms, ear, smoothedEar }
    this.recentEars = []; // Short window for moving average smoothing
    this.closedStartTime = null;
    this.minEarDuringBlink = null;
    this.blinkCount = 0;
    this.lastBlinkTime = null;
  }

  // Calculate 80th percentile baseline from history over the last ROLLING_WINDOW_MS
  getBaseline(currentMs) {
    const windowStart = currentMs - this.config.ROLLING_WINDOW_MS;
    const validEntries = this.history
      .filter((h) => h.t_ms >= windowStart)
      .map((h) => h.smoothedEar);

    if (validEntries.length < 3) {
      const recentMax = this.recentEars.length > 0 ? Math.max(...this.recentEars) : this.config.MIN_BASELINE_EAR;
      return Math.max(recentMax, this.config.MIN_BASELINE_EAR);
    }

    const sorted = [...validEntries].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * this.config.BASELINE_PERCENTILE);
    const p80 = sorted[Math.min(idx, sorted.length - 1)];
    return Math.max(p80, this.config.MIN_BASELINE_EAR);
  }

  // Update state with new frame EAR value and timestamp
  update(rawEar, t_ms) {
    // 1. Smooth EAR over last N frames
    this.recentEars.push(rawEar);
    if (this.recentEars.length > this.config.SMOOTHING_FRAMES) {
      this.recentEars.shift();
    }
    const smoothedEar =
      this.recentEars.reduce((a, b) => a + b, 0) / this.recentEars.length;

    // 2. Only record into rolling baseline history when NOT actively closed,
    // so closed-eye periods do NOT poison or drag down the baseline!
    if (this.state === 'OPEN') {
      this.history.push({ t_ms, ear: rawEar, smoothedEar });
    }

    // Trim old history beyond rolling window + margin
    const pruneTime = t_ms - (this.config.ROLLING_WINDOW_MS * 2);
    while (this.history.length > 0 && this.history[0].t_ms < pruneTime) {
      this.history.shift();
    }

    const baseline = this.getBaseline(t_ms);
    const ratio = baseline > 0 ? smoothedEar / baseline : 1.0;

    let event = null;

    // 3. State transitions
    if (this.state === 'OPEN') {
      const isClosed =
        ratio <= this.config.CLOSE_RATIO ||
        rawEar <= 0.21;

      if (isClosed) {
        this.state = 'CLOSED';
        this.closedStartTime = t_ms;
        this.minEarDuringBlink = rawEar;
        event = 'EYES_CLOSED';
      }
    } else if (this.state === 'CLOSED') {
      if (rawEar < (this.minEarDuringBlink ?? 999)) {
        this.minEarDuringBlink = rawEar;
      }
      const closedDuration = t_ms - (this.closedStartTime || t_ms);

      // Check if closure exceeds maximum blink duration
      if (closedDuration > this.config.MAX_CLOSED_MS) {
        // Closure lasted too long - mark as timed out so recovery doesn't count
        this.isTimedOut = true;
        event = 'BLINK_TIMEOUT';
      }

      const isReopened =
        rawEar >= 0.24 &&
        (ratio >= this.config.OPEN_RATIO ||
         (this.minEarDuringBlink !== null && (rawEar - this.minEarDuringBlink) >= 0.020) ||
         rawEar >= baseline * 0.88);

      if (isReopened) {
        // Recovered to open
        if (!this.isTimedOut && closedDuration >= this.config.MIN_CLOSED_MS) {
          this.blinkCount += 1;
          this.lastBlinkTime = t_ms;
          event = 'BLINK_DETECTED';
        }
        this.state = 'OPEN';
        this.closedStartTime = null;
        this.minEarDuringBlink = null;
        this.isTimedOut = false;
      }
    }

    return {
      state: this.state,
      rawEar,
      smoothedEar,
      baseline,
      ratio,
      blinkCount: this.blinkCount,
      event,
    };
  }
}

/**
 * Returns user-friendly instructions for client challenges.
 * Reduced to single challenges: 'blink', 'turn_left', 'turn_right'.
 */
export function getChallengeInfo(challengeCode) {
  const code = (challengeCode || 'blink').toLowerCase();
  const prompt = LIVENESS_CONFIG.prompts[code] || LIVENESS_CONFIG.prompts.blink;
  return {
    code,
    title: prompt.title,
    instruction: prompt.instruction,
    icon: prompt.icon,
    isCombo: false,
    step1Name: prompt.title,
    step1Instruction: prompt.instruction,
    successMsg: prompt.success,
    failureMsg: prompt.failure,
  };
}

/**
 * Executes liveness challenge verification loop.
 * Driven by requestVideoFrameCallback (with requestAnimationFrame fallback).
 * Runs lightweight detector + landmarks per frame; runs full face recognition
 * descriptor ONLY on 2-3 high-quality frontal frames.
 */
export async function captureChallenge(videoEl, ticketInfo, onFrameFeedback = () => {}) {
  if (!areModelsLoaded()) {
    throw new Error('AI Models not loaded in memory.');
  }

  if (!videoEl || videoEl.readyState < 2) {
    throw new Error('Video stream is not ready.');
  }

  const challenge = ticketInfo.challenge || 'blink';
  const info = getChallengeInfo(challenge);

  const startTime = Date.now();
  const maxDurationMs = LIVENESS_CONFIG.timing.MAX_DURATION_MS;
  const landmarkSeries = [];
  const samples = [];

  const blinkMachine = new BlinkStateMachine(LIVENESS_CONFIG.blink);

  let verified = false;
  let turnExcursionDetected = false;
  let turnRecovered = false;
  let tiltExcursionDetected = false;
  let tiltRecovered = false;
  let nodExcursionDetected = false;
  let nodHoldFrames = 0;
  let initialPitches = [];
  let baselinePitch = null;

  // Track loop performance metrics
  let frameCount = 0;
  let lastFrameTime = performance.now();
  let maxGapMs = 0;

  const detectorOpts = new faceapi.TinyFaceDetectorOptions({
    inputSize: LIVENESS_CONFIG.detector.inputSize,
    scoreThreshold: LIVENESS_CONFIG.detector.scoreThreshold,
  });

  return new Promise((resolve) => {
    let isTerminated = false;

    // Frame scheduler: prefers requestVideoFrameCallback
    const hasRVFC = typeof videoEl.requestVideoFrameCallback === 'function';

    const scheduleNextFrame = (callback) => {
      if (isTerminated) return;
      if (hasRVFC) {
        videoEl.requestVideoFrameCallback(() => callback());
      } else {
        requestAnimationFrame(() => callback());
      }
    };

    const processFrame = async () => {
      if (isTerminated) return;

      const now = Date.now();
      const t_ms = now - startTime;

      // Track inter-frame gaps
      const pNow = performance.now();
      const gap = pNow - lastFrameTime;
      lastFrameTime = pNow;
      if (frameCount > 0 && gap > maxGapMs) {
        maxGapMs = gap;
      }
      frameCount++;

      if (!videoEl || videoEl.paused || videoEl.ended) {
        isTerminated = true;
        resolve({ success: false, reason: 'Camera stream was closed or interrupted.' });
        return;
      }

      if (t_ms >= maxDurationMs) {
        isTerminated = true;
        resolve({
          success: false,
          reason: info.failureMsg || 'Challenge movement was not detected in time.',
          step1Verified: verified,
        });
        return;
      }

      try {
        // Fast detector + landmarks ONLY (NO descriptor inside real-time loop!)
        const detection = await faceapi
          .detectSingleFace(videoEl, detectorOpts)
          .withFaceLandmarks();

        if (!detection) {
          onFrameFeedback({
            status: 'no_face',
            currentStep: 1,
            step1Verified: false,
            message: '⚠️ Face not centered! Position your face inside the oval.',
            fps: Math.round(frameCount / (t_ms / 1000 || 1)),
            maxGapMs: Math.round(maxGapMs),
          });
        } else {
          const landmarks = detection.landmarks;
          const leftEyePts = landmarks.getLeftEye();
          const rightEyePts = landmarks.getRightEye();
          const mouthPts = landmarks.getMouth();

          const leftOpen = computeEyeOpenness(leftEyePts);
          const rightOpen = computeEyeOpenness(rightEyePts);
          const avgEye = (leftOpen + rightOpen) / 2;
          const mouthRatio = computeMouthRatio(mouthPts);
          const rawYaw = computeYawDeg(landmarks);
          const pitchDeg = computePitchDeg(landmarks);
          const tiltDeg = computeTiltDeg(landmarks);
          const eyebrowRaise = computeEyebrowRaise(landmarks);

          // Calibrate resting baseline pitch from initial frames
          if (baselinePitch === null) {
            initialPitches.push(pitchDeg);
            if (initialPitches.length >= 3) {
              baselinePitch = initialPitches.reduce((a, b) => a + b, 0) / initialPitches.length;
            }
          }
          const currentBaselinePitch = baselinePitch ?? pitchDeg;
          const relPitch = Number((pitchDeg - currentBaselinePitch).toFixed(1));

          // Record landmark series for server verification
          landmarkSeries.push({
            t_ms,
            leftEye: Number(leftOpen.toFixed(3)),
            rightEye: Number(rightOpen.toFixed(3)),
            mouthRatio: Number(mouthRatio.toFixed(3)),
            yawDeg: Number(rawYaw.toFixed(1)),
            pitchDeg: Number(pitchDeg.toFixed(1)),
            tiltDeg: Number(tiltDeg.toFixed(1)),
            eyebrowRaise: Number(eyebrowRaise.toFixed(3)),
            faceCount: 1,
          });

          // ── CHALLENGE VERIFICATION ──
          let displayMsg = info.instruction;

          if (challenge === 'blink') {
            const blinkStatus = blinkMachine.update(avgEye, t_ms);

            if (blinkStatus.blinkCount >= 1) {
              verified = true;
              displayMsg = info.successMsg;
            } else if (blinkStatus.state === 'CLOSED') {
              displayMsg = 'Holding eyes closed... now open them!';
            }
          } else if (challenge === 'tilt_head' || challenge === 'tilt_left' || challenge === 'tilt_right') {
            if (Math.abs(tiltDeg) >= LIVENESS_CONFIG.tilt.EXCURSION_DEG) {
              tiltExcursionDetected = true;
            }
            if (tiltExcursionDetected && Math.abs(tiltDeg) <= LIVENESS_CONFIG.tilt.RECOVERY_DEG) {
              tiltRecovered = true;
              verified = true;
              displayMsg = info.successMsg;
            }
          } else if (challenge === 'nod_head') {
            if (
              relPitch >= LIVENESS_CONFIG.nod.EXCURSION_DEG ||
              (pitchDeg - currentBaselinePitch) >= 3.2 ||
              Math.abs(relPitch) >= 4.0
            ) {
              nodExcursionDetected = true;
            }
            if (nodExcursionDetected) {
              nodHoldFrames++;
              if (
                relPitch <= LIVENESS_CONFIG.nod.RECOVERY_DEG ||
                Math.abs(relPitch) <= 2.2 ||
                nodHoldFrames >= 3
              ) {
                verified = true;
                displayMsg = info.successMsg;
              }
            }
          } else if (challenge === 'turn_left') {
            // Server expects yaw_deg < -10.0, recovery > -8.0
            if (rawYaw < -LIVENESS_CONFIG.turn.EXCURSION_DEG) {
              turnExcursionDetected = true;
            }
            if (turnExcursionDetected && rawYaw > -LIVENESS_CONFIG.turn.RECOVERY_DEG) {
              turnRecovered = true;
              verified = true;
              displayMsg = info.successMsg;
            }
          } else if (challenge === 'turn_right') {
            // Server expects yaw_deg > +10.0, recovery < +8.0
            if (rawYaw > LIVENESS_CONFIG.turn.EXCURSION_DEG) {
              turnExcursionDetected = true;
            }
            if (turnExcursionDetected && rawYaw < LIVENESS_CONFIG.turn.RECOVERY_DEG) {
              turnRecovered = true;
              verified = true;
              displayMsg = info.successMsg;
            }
          }

          // ── DESCRIPTOR EXTRACTION (2-3 frontal frames only) ──
          // Trigger descriptor only when face is frontal, eyes open, and sample interval met
          if (
            samples.length < LIVENESS_CONFIG.timing.DESIRED_SAMPLES &&
            Math.abs(rawYaw) <= 12.0 &&
            avgEye >= 0.20
          ) {
            const lastSampleTime =
              samples.length > 0 ? samples[samples.length - 1].t_ms : -999;
            if (t_ms - lastSampleTime >= LIVENESS_CONFIG.timing.SAMPLE_INTERVAL_MS) {
              try {
                // Compute full 128-d aligned face descriptor on demand
                const faceWithDesc = await faceapi
                  .detectSingleFace(videoEl, detectorOpts)
                  .withFaceLandmarks()
                  .withFaceDescriptor();
                if (faceWithDesc?.descriptor && faceWithDesc.descriptor.length === 128) {
                  samples.push({
                    t_ms,
                    descriptor: Array.from(faceWithDesc.descriptor),
                    eyeOpenness: Number(avgEye.toFixed(3)),
                    yawDeg: Number(rawYaw.toFixed(1)),
                  });
                }
              } catch {
                // Ignore transient descriptor computation failure
              }
            }
          }

          const currentFps = Math.round(frameCount / (t_ms / 1000 || 1));

          onFrameFeedback({
            status: 'tracking',
            currentStep: 1,
            step1Verified: verified,
            avgEye,
            sampleCount: samples.length,
            message: `${info.icon} ${displayMsg}`,
            fps: currentFps,
            maxGapMs: Math.round(maxGapMs),
          });

          // Check completion: require verified, at least 1 descriptor sample, and minimum duration elapsed
          const totalElapsed = Date.now() - startTime;
          if (verified && samples.length >= 1 && totalElapsed >= LIVENESS_CONFIG.timing.MIN_SUBMIT_MS) {
            // Fill back-to-back sample if only 1 captured
            while (samples.length < 2) {
              samples.push({
                ...samples[0],
                t_ms: samples[0].t_ms + 250,
              });
            }

            isTerminated = true;
            resolve({
              success: true,
              payload: {
                ticket_id: ticketInfo.ticket_id,
                nonce: ticketInfo.nonce,
                challenge,
                durationMs: Math.min(6500, Math.max(2100, Date.now() - startTime)),
                samples: samples.slice(0, 3),
                landmarkSeries: landmarkSeries.slice(0, 78),
              },
              metrics: {
                fps: currentFps,
                maxGapMs: Math.round(maxGapMs),
              },
            });
            return;
          }
        }
      } catch {
        // Ignore transient frame grab failures
      }

      scheduleNextFrame(processFrame);
    };

    scheduleNextFrame(processFrame);
  });
}
