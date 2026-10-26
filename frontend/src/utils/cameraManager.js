/**
 * ZeroProxy Central Camera & Hardware Stream Manager
 * Ensures cameras only operate on designated camera pages and are forcefully
 * stopped/released when navigating away or visiting non-camera pages.
 */

const activeStreams = new Set();
const allowedPrefixes = ['/student/scan', '/student/enroll', '/camera-test', '/admin', '/dev'];

/**
 * Returns true only if the given pathname is an authorized camera page.
 */
export function isCameraAllowedPage(pathname) {
  if (!pathname) {
    if (typeof window !== 'undefined') {
      pathname = window.location.pathname;
    } else {
      return false;
    }
  }
  return allowedPrefixes.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Register a MediaStream to be tracked globally.
 */
export function registerActiveStream(stream) {
  if (!stream) return;
  activeStreams.add(stream);

  try {
    stream.getTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (!stream.active) {
          activeStreams.delete(stream);
        }
      });
    });
  } catch {
    // Ignore
  }
}

/**
 * Unregister a MediaStream.
 */
export function unregisterActiveStream(stream) {
  if (stream) {
    activeStreams.delete(stream);
  }
}

/**
 * Aggressively stop a single MediaStream.
 */
export function stopMediaStream(stream) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track) => {
      track.stop();
      track.enabled = false;
    });
  } catch (err) {
    console.warn('Error stopping media track:', err);
  }
  activeStreams.delete(stream);
}

/**
 * Forcefully stops and releases ALL camera hardware streams across the entire app.
 * Stops registered streams and any orphan video elements in the DOM.
 */
export function stopAllGlobalCameras() {
  // 1. Stop all registered MediaStream tracks
  activeStreams.forEach((stream) => {
    stopMediaStream(stream);
  });
  activeStreams.clear();

  // 2. Locate any <video> elements currently mounted or lingering in the DOM
  try {
    const videoElements = document.querySelectorAll('video');
    videoElements.forEach((vid) => {
      try {
        if (vid.srcObject && typeof vid.srcObject.getTracks === 'function') {
          vid.srcObject.getTracks().forEach((track) => {
            track.stop();
            track.enabled = false;
          });
          vid.srcObject = null;
        }
        vid.pause();
      } catch (err) {
        console.warn('Error stopping video element stream:', err);
      }
    });
  } catch (err) {
    console.warn('Error querying video elements:', err);
  }
}

// ── Global Interceptor ──────────────────────────────────────────────────────
// Intercept navigator.mediaDevices.getUserMedia once so EVERY stream created anywhere
// (including internal html5-qrcode scanner) is tracked and bound to camera safety rules.
if (typeof window !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

  navigator.mediaDevices.getUserMedia = async function (...args) {
    const currentPath = window.location.pathname;
    if (!isCameraAllowedPage(currentPath)) {
      console.warn(`Camera blocked: attempted getUserMedia on unauthorized route '${currentPath}'`);
      throw new Error(`Camera is disabled on ${currentPath}`);
    }

    const stream = await originalGetUserMedia(...args);
    registerActiveStream(stream);
    return stream;
  };
}
