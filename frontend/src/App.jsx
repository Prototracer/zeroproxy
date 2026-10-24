
import { Routes, Route, Navigate } from 'react-router-dom';

import Login from './auth/Login.jsx';
import Register from './auth/Register.jsx';
import FacultyDashboard from './faculty/FacultyDashboard.jsx';
import StudentDashboard from './student/StudentDashboard.jsx';
import Enroll from './faculty/Enroll.jsx';
import JoinRequests from './faculty/JoinRequests.jsx';
import CameraTest from './student/CameraTest.jsx';

function ProtectedFaculty() {
  const token = sessionStorage.getItem('token');
  const isLoggedIn = sessionStorage.getItem('isLoggedIn');
  const role = (sessionStorage.getItem('role') || '').toLowerCase();

  if (isLoggedIn !== 'true' || !token || role !== 'faculty') {
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

function ProtectedEnroll() {
  const token = sessionStorage.getItem('token');
  const isLoggedIn = sessionStorage.getItem('isLoggedIn');
  const role = (sessionStorage.getItem('role') || '').toLowerCase();

  if (isLoggedIn !== 'true' || !token || role !== 'faculty') {
    return <Navigate to="/login" replace />;
  }

  return <Enroll />;
}

function ProtectedJoinRequests() {
  const token = sessionStorage.getItem('token');
  const isLoggedIn = sessionStorage.getItem('isLoggedIn');
  const role = (sessionStorage.getItem('role') || '').toLowerCase();

  if (isLoggedIn !== 'true' || !token || role !== 'faculty') {
    return <Navigate to="/login" replace />;
  }

  return <JoinRequests />;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/faculty" element={<ProtectedFaculty />} />
      <Route path="/faculty/join-requests" element={<ProtectedJoinRequests />} />
      <Route path="/faculty/enroll" element={<ProtectedEnroll />} />
      <Route path="/student" element={<ProtectedStudent />} />
      <Route path="/camera-test" element={<CameraTest />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
