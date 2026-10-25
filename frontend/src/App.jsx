
import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { stopAllGlobalCameras, isCameraAllowedPage } from './utils/cameraManager.js';

import Login from './auth/Login.jsx';
import Register from './auth/Register.jsx';
import FacultyDashboard from './faculty/FacultyDashboard.jsx';
import StudentDashboard from './student/StudentDashboard.jsx';
import StudentEnroll from './student/StudentEnroll.jsx';
import JoinRequests from './faculty/JoinRequests.jsx';
import CameraTest from './student/CameraTest.jsx';
import StudentAttendanceScanner from './student/StudentAttendanceScanner.jsx';
import LiveSession from './faculty/LiveSession.jsx';
import AdminDashboard from './admin/AdminDashboard.jsx';
import Profile from './student/Profile.jsx';

function GlobalCameraGuard() {
  const location = useLocation();

  useEffect(() => {
    // If navigating to any page where camera is not permitted, immediately kill all camera hardware
    if (!isCameraAllowedPage(location.pathname)) {
      stopAllGlobalCameras();
    }

    // Periodic safety check every 1s when on non-camera pages to kill any orphan tracks
    const timer = setInterval(() => {
      if (!isCameraAllowedPage(location.pathname)) {
        stopAllGlobalCameras();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [location.pathname]);

  useEffect(() => {
    const handleUnload = () => stopAllGlobalCameras();
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, []);

  return null;
}

function ProtectedFaculty() {
  const token = sessionStorage.getItem('token');
  const isLoggedIn = sessionStorage.getItem('isLoggedIn');
  const role = (sessionStorage.getItem('role') || '').toLowerCase();

  if (isLoggedIn !== 'true' || !token || (role !== 'faculty' && role !== 'admin')) {
    return <Navigate to="/login" replace />;
  }

  return <FacultyDashboard />;
}

function ProtectedStudent() {
  const token = sessionStorage.getItem('token');
  const isLoggedIn = sessionStorage.getItem('isLoggedIn');
  const role = (sessionStorage.getItem('role') || '').toLowerCase();

  if (isLoggedIn !== 'true' || !token || role !== 'student') {
    return <Navigate to="/login" replace />;
  }

  return <StudentDashboard />;
}

function ProtectedStudentScan() {
  const token = sessionStorage.getItem('token');
  const isLoggedIn = sessionStorage.getItem('isLoggedIn');
  const role = (sessionStorage.getItem('role') || '').toLowerCase();

  if (isLoggedIn !== 'true' || !token || role !== 'student') {
    return <Navigate to="/login" replace />;
  }

  return <StudentAttendanceScanner />;
}

function ProtectedStudentProfile() {
  const token = sessionStorage.getItem('token');
  const isLoggedIn = sessionStorage.getItem('isLoggedIn');
  const role = (sessionStorage.getItem('role') || '').toLowerCase();

  if (isLoggedIn !== 'true' || !token || role !== 'student') {
    return <Navigate to="/login" replace />;
  }

  return <Profile />;
}

function ProtectedStudentEnroll() {
  const token = sessionStorage.getItem('token');
  const isLoggedIn = sessionStorage.getItem('isLoggedIn');
  const role = (sessionStorage.getItem('role') || '').toLowerCase();

  if (isLoggedIn !== 'true' || !token || role !== 'student') {
    return <Navigate to="/login" replace />;
  }

  return <StudentEnroll />;
}

function ProtectedJoinRequests() {
  const token = sessionStorage.getItem('token');
  const isLoggedIn = sessionStorage.getItem('isLoggedIn');
  const role = (sessionStorage.getItem('role') || '').toLowerCase();

  if (isLoggedIn !== 'true' || !token || (role !== 'faculty' && role !== 'admin')) {
    return <Navigate to="/login" replace />;
  }

  return <JoinRequests />;
}

function ProtectedLiveSession() {
  const token = sessionStorage.getItem('token');
  const isLoggedIn = sessionStorage.getItem('isLoggedIn');
  const role = (sessionStorage.getItem('role') || '').toLowerCase();

  if (isLoggedIn !== 'true' || !token || (role !== 'faculty' && role !== 'admin')) {
    return <Navigate to="/login" replace />;
  }

  return <LiveSession />;
}

function ProtectedAdmin() {
  const token = sessionStorage.getItem('token');
  const isLoggedIn = sessionStorage.getItem('isLoggedIn');
  const role = (sessionStorage.getItem('role') || '').toLowerCase();

  if (isLoggedIn !== 'true' || !token || role !== 'admin') {
    return <Navigate to="/login" replace />;
  }

  return <AdminDashboard />;
}

function App() {
  return (
    <>
      <GlobalCameraGuard />
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/admin" element={<ProtectedAdmin />} />
        <Route path="/faculty" element={<ProtectedFaculty />} />
        <Route path="/faculty/sessions/:id" element={<ProtectedLiveSession />} />
        <Route path="/faculty/join-requests" element={<ProtectedJoinRequests />} />
        <Route path="/faculty/enroll" element={<Navigate to="/faculty" replace />} />
        <Route path="/student" element={<ProtectedStudent />} />
        <Route path="/student/profile" element={<ProtectedStudentProfile />} />
        <Route path="/student/enroll" element={<ProtectedStudentEnroll />} />
        <Route path="/student/scan" element={<ProtectedStudentScan />} />
        <Route path="/camera-test" element={<CameraTest />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}

export default App;
