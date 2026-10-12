import React, { useState, useRef, useEffect } from 'react'

export default function CameraTest() {
  const [isActive, setIsActive] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      // Prevents leaked streams if the user leaves while permission is pending
      isMountedRef.current = false
      stopCamera()
    }
  }, [])

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    if (isMountedRef.current) {
      setIsActive(false)
    }
  }

  const startCamera = async () => {
    setError(null)
    setIsLoading(true)

    // Check for Secure Context (HTTPS or localhost)
    if (!window.isSecureContext) {
      setError('Camera access requires HTTPS or localhost. Please open this site over a secure HTTPS connection.')
      setIsLoading(false)
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera API is not supported by your browser.')
      setIsLoading(false)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user', // Selfie camera
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      })

      // If user unmounted page while the browser permission prompt was open, stop immediately
      if (!isMountedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        // React muted prop quirk fix: set DOM property directly before play()
        videoRef.current.muted = true
        await videoRef.current.play()
      }

      setIsActive(true)
    } catch (err) {
      // Release hardware stream immediately if acquired before failure (e.g. video.play() error)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }

      if (!isMountedRef.current) return
      console.error('Camera access error:', err)

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Camera permission was denied. Please allow camera access in your browser settings and retry.')
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setError('No camera was found on your device.')
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setError('Camera is in use by another application (e.g., Zoom, Teams) or a hardware error occurred.')
      } else {
        setError(`Unable to access camera: ${err.message}`)
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false)
      }
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-950 text-gray-100">
      <div className="w-full max-w-md bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-2xl backdrop-blur-md">
        <h2 className="text-xl font-bold text-center mb-1">Camera Test</h2>
        <p className="text-xs text-gray-400 text-center mb-6">Camera & permissions verification</p>

        {/* aspect-[4/3] matches 640x480 resolution; scale-x-[-1] mirrors preview for selfie feel */}
        <div className="relative aspect-[4/3] w-full bg-black/60 rounded-xl overflow-hidden border border-gray-800 flex items-center justify-center mb-6">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover scale-x-[-1] ${isActive ? 'block' : 'hidden'}`}
          />
          {!isActive && (
            <p className="text-sm text-gray-500">Camera is off</p>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-950/60 border border-red-800/80 rounded-lg text-xs text-red-300">
            {error}
          </div>
        )}

        <button
          onClick={isActive ? stopCamera : startCamera}
          disabled={isLoading}
          className="w-full py-3 rounded-xl font-semibold text-sm transition-all duration-200 bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 shadow-lg shadow-cyan-500/20 disabled:opacity-50"
        >
          {isLoading ? 'Starting Camera...' : isActive ? 'Stop Camera' : 'Start Camera'}
        </button>
      </div>
    </div>
  )
}
