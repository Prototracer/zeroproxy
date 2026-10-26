import { describe, it, expect } from 'vitest';
import { BlinkStateMachine, LIVENESS_CONFIG } from './liveness.js';

describe('BlinkStateMachine Phase 2B Specifications', () => {
  const customConfig = {
    ...LIVENESS_CONFIG.blink,
    ROLLING_WINDOW_MS: 1200,
    SMOOTHING_FRAMES: 3,
    CLOSE_RATIO: 0.82,
    OPEN_RATIO: 0.90,
    MAX_CLOSED_MS: 1500,
    MIN_CLOSED_MS: 40,
  };

  function feedBaseline(sm, openEar = 0.30, frameCount = 30, dt = 33) {
    let t = 0;
    for (let i = 0; i < frameCount; i++) {
      sm.update(openEar, t);
      t += dt;
    }
    return t;
  }

  it('1. A 2-frame closure passes (quick natural blink at ~30 FPS)', () => {
    const sm = new BlinkStateMachine(customConfig);
    let t = feedBaseline(sm, 0.30, 30, 33); // ~1000ms baseline open

    // Frame 1 closed: 0.18
    t += 33;
    let res = sm.update(0.18, t);
    // Smoothed transition into closed
    t += 33;
    res = sm.update(0.18, t);
    expect(res.state).toBe('CLOSED');

    // Reopen frames (needs 3 frames to flush 3-frame buffer from 0.18 to 0.30)
    t += 33;
    sm.update(0.30, t);
    t += 33;
    sm.update(0.30, t);
    t += 33;
    res = sm.update(0.30, t);

    expect(res.state).toBe('OPEN');
    expect(sm.blinkCount).toBe(1);
  });

  it('2. A 6-frame closure passes (gentle blink holding closed for ~200ms)', () => {
    const sm = new BlinkStateMachine(customConfig);
    let t = feedBaseline(sm, 0.30, 30, 33);

    // Closed for 6 consecutive frames (~200ms)
    for (let i = 0; i < 6; i++) {
      t += 33;
      sm.update(0.19, t);
    }
    expect(sm.state).toBe('CLOSED');

    // Reopen for 3 frames
    for (let i = 0; i < 3; i++) {
      t += 33;
      sm.update(0.30, t);
    }

    expect(sm.state).toBe('OPEN');
    expect(sm.blinkCount).toBe(1);
  });

  it('3. Noise alone does not trigger a blink (random fluctuations ±0.02)', () => {
    const sm = new BlinkStateMachine(customConfig);
    let t = feedBaseline(sm, 0.30, 20, 33);

    // Apply high-frequency jitter around baseline (0.28 to 0.32)
    const noiseValues = [0.28, 0.31, 0.27, 0.29, 0.28, 0.32, 0.27, 0.30, 0.29];
    for (const val of noiseValues) {
      t += 33;
      const res = sm.update(val, t);
      expect(res.state).toBe('OPEN');
    }

    expect(sm.blinkCount).toBe(0);
  });

  it('4. A very slow drift does not trigger a blink (gradual squint)', () => {
    const sm = new BlinkStateMachine(customConfig);
    let t = 0;

    // Slowly reduce EAR over 2.5 seconds from 0.32 to 0.26 (0.001 per frame)
    let currentEar = 0.32;
    for (let i = 0; i < 75; i++) {
      currentEar -= 0.0008;
      t += 33;
      sm.update(currentEar, t);
    }

    // Because rolling 80th-percentile baseline tracks recent frames, ratio stays above CLOSE_RATIO
    expect(sm.blinkCount).toBe(0);
    expect(sm.state).toBe('OPEN');
  });

  it('5. Closure longer than MAX_CLOSED_MS does not count as a blink', () => {
    const sm = new BlinkStateMachine(customConfig);
    let t = feedBaseline(sm, 0.30, 30, 33);

    // Close eyes and hold for 1800ms (> MAX_CLOSED_MS of 1500ms)
    const holdFrames = Math.floor(1800 / 33);
    for (let i = 0; i < holdFrames; i++) {
      t += 33;
      sm.update(0.18, t);
    }

    // Now reopen
    for (let i = 0; i < 5; i++) {
      t += 33;
      sm.update(0.30, t);
    }

    // Timed out closure must NOT register as a natural blink!
    expect(sm.blinkCount).toBe(0);
    expect(sm.state).toBe('OPEN');
  });

  it('6. A closure during the first second does not poison later detection', () => {
    const sm = new BlinkStateMachine(customConfig);
    let t = 0;

    // User starts session with eyes closed for first 1600ms (> MAX_CLOSED_MS 1500ms)
    for (let i = 0; i < 50; i++) {
      t += 33;
      sm.update(0.17, t);
    }

    // User then opens eyes and establishes normal posture (t = 800 to 2200ms)
    for (let i = 0; i < 40; i++) {
      t += 33;
      sm.update(0.30, t);
    }

    // The baseline should reflect the open eyes (~0.30), not the initial closed frames
    const baseline = sm.getBaseline(t);
    expect(baseline).toBeGreaterThanOrEqual(0.28);

    // Now a valid natural blink occurs at t = 2300ms
    t += 33;
    sm.update(0.18, t);
    t += 33;
    sm.update(0.18, t);
    t += 33;
    sm.update(0.30, t);
    t += 33;
    sm.update(0.30, t);
    t += 33;
    sm.update(0.30, t);

    // Successfully registers later blink
    expect(sm.blinkCount).toBe(1);
    expect(sm.state).toBe('OPEN');
  });
});

describe('Head Tilt & Nod Utilities', () => {
  it('7. computeTiltDeg correctly calculates eye-line angle', async () => {
    const { computeTiltDeg } = await import('./liveness.js');
    
    // Level eyes
    const levelLandmarks = {
      getLeftEye: () => [{ x: 100, y: 150 }],
      getRightEye: () => [{}, {}, {}, { x: 200, y: 150 }],
    };
    expect(computeTiltDeg(levelLandmarks)).toBe(0);

    // Right eye 20px lower (tilt right)
    const tiltedLandmarks = {
      getLeftEye: () => [{ x: 100, y: 150 }],
      getRightEye: () => [{}, {}, {}, { x: 200, y: 170 }],
    };
    const tiltAngle = computeTiltDeg(tiltedLandmarks);
    expect(tiltAngle).toBeGreaterThan(10);
    expect(tiltAngle).toBeLessThan(15);
  });

  it('8. getChallengeInfo provides prompts for tilt_head and nod_head without smile', async () => {
    const { getChallengeInfo } = await import('./liveness.js');
    
    const tilt = getChallengeInfo('tilt_head');
    expect(tilt.title).toBe('Head Tilt Challenge');
    expect(tilt.icon).toBe('🔄');
    expect(tilt.instruction).toContain('shoulder');

    const nod = getChallengeInfo('nod_head');
    expect(nod.title).toBe('Head Nod Challenge');
    expect(nod.icon).toBe('↕️');
    expect(nod.instruction).toContain('downward');
  });
});

