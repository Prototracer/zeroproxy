
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { QRCodeSVG } from 'qrcode.react';

function FacultyDashboard() {
  const navigate = useNavigate();

  const [classes, setClasses] = useState([
    {
      id: 1,
      name: 'Design and Analysis of Algorithms',
      code: 'CS301',
      semester: 'Semester 3',
      session: 'No active session',
    },
    {
      id: 2,
      name: 'Computer Networks',
      code: 'CS302',
      semester: 'Semester 3',
      session: 'No active session',
    },
    {
      id: 3,
      name: 'Operating Systems',
      code: 'CS303',
      semester: 'Semester 3',
      session: 'No active session',
    },
  ]);

  const [classMessage, setClassMessage] = useState(
    'Showing sample classes.'
  );

  const [qrGenerated, setQrGenerated] = useState(false);
  const [selectedClass, setSelectedClass] = useState('');
  const [student, setStudent] = useState('');
  const [attendanceStatus, setAttendanceStatus] = useState('present');
  const [attendanceMessage, setAttendanceMessage] = useState('');

  // Add Course form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [courseName, setCourseName] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [courseSemester, setCourseSemester] = useState('Semester 3');
  const [courseMessage, setCourseMessage] = useState('');

  useEffect(() => {
    async function loadClasses() {
      try {
        const data = await apiRequest('/faculty/classes');

        if (Array.isArray(data)) {
          setClasses(data);
          setClassMessage('Classes loaded from the backend.');
        } else if (Array.isArray(data?.classes)) {
          setClasses(data.classes);
          setClassMessage('Classes loaded from the backend.');
        } else {
          setClassMessage(
            'Backend response format is not recognized. Showing sample classes.'
          );
        }
      } catch {
        setClassMessage(
          'Backend unavailable. Showing sample classes.'
        );
      }
    }

    loadClasses();
  }, []);

  const selectedClassDetails = classes.find(
    (item) => String(item.id) === selectedClass
  );

  function handleLogout() {
    sessionStorage.removeItem('isLoggedIn');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('role');
    navigate('/login', { replace: true });
  }

  function handleGenerateQR() {
    if (!selectedClassDetails) {
      alert('Please select a class first.');
      return;
    }

    setQrGenerated(true);
  }

  function handleAddCourse(event) {
    event.preventDefault();

    const name = courseName.trim();
    const code = courseCode.trim().toUpperCase();

    if (!name || !code || !courseSemester) {
      setCourseMessage('Please fill in all course details.');
      return;
    }

    const duplicate = classes.some(
      (item) =>
        String(item.code).toLowerCase() === code.toLowerCase()
    );

    if (duplicate) {
      setCourseMessage('A course with this code already exists.');
      return;
    }

    const newCourse = {
      id: `local-${Date.now()}`,
      name,
      code,
      semester: courseSemester,
      session: 'No active session',
    };

    setClasses((previousClasses) => [
      ...previousClasses,
      newCourse,
    ]);

    setCourseName('');
    setCourseCode('');
    setCourseSemester('Semester 3');
    setCourseMessage(`${name} added successfully.`);
    setShowAddForm(false);
  }

  function handleDeleteCourse(course) {
    const confirmed = window.confirm(
      `Are you sure you want to delete ${course.name}?`
    );

    if (!confirmed) {
      return;
    }

    setClasses((previousClasses) =>
      previousClasses.filter(
        (item) => String(item.id) !== String(course.id)
      )
    );

    if (String(selectedClass) === String(course.id)) {
      setSelectedClass('');
      setQrGenerated(false);
    }

    setCourseMessage(`${course.name} deleted from this demo.`);
  }

  function handleManualAttendance() {
    if (!student) {
      setAttendanceMessage('Please select a student.');
      return;
    }

    setAttendanceMessage(
      `Demo: ${student} marked ${attendanceStatus.toUpperCase()}. This change is not saved to the backend.`
    );
  }

  const cardStyle = {
    background: '#ffffff',
    padding: '20px',
    borderRadius: '12px',
    marginTop: '24px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  };

  const buttonStyle = {
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    padding: '12px 18px',
    borderRadius: '6px',
    cursor: 'pointer',
  };

  const selectStyle = {
    display: 'block',
    width: '100%',
    maxWidth: '400px',
    boxSizing: 'border-box',
    padding: '12px',
    marginTop: '8px',
    marginBottom: '16px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
  };

  const inputStyle = {
    ...selectStyle,
    maxWidth: '500px',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f5f7fb',
        fontFamily: 'Arial, sans-serif',
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h1>Faculty Dashboard</h1>
          <p>ZeroProxy Smart Attendance System</p>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => navigate('/faculty/enroll')}
            style={buttonStyle}
          >
            Student Enrolment
          </button>

          <button
            type="button"
            onClick={handleLogout}
            style={{
              ...buttonStyle,
              background: '#dc2626',
            }}
          >
            Logout
          </button>
        </div>
      </header>

      {/* Generate QR */}
      <section style={cardStyle}>
        <h2>Generate QR</h2>
        <p>Select a class to display its demo attendance QR.</p>

        <label htmlFor="classSelect">Select Class:</label>

        <select
          id="classSelect"
          value={selectedClass}
          onChange={(event) => {
            setSelectedClass(event.target.value);
            setQrGenerated(false);
          }}
          style={selectStyle}
        >
          <option value="">Choose a class</option>

          {classes.map((item) => (
            <option key={item.id} value={String(item.id)}>
              {item.name} ({item.code})
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={handleGenerateQR}
          style={buttonStyle}
        >
          Generate QR
        </button>

        {qrGenerated && selectedClassDetails && (
          <div
            style={{
              marginTop: '20px',
              padding: '20px',
              background: '#f8fafc',
              borderRadius: '12px',
              textAlign: 'center',
            }}
          >
            <h3>Attendance QR Display</h3>

            <div
              style={{
                width: '100%',
                maxWidth: '640px',
                aspectRatio: '16 / 9',
                margin: '16px auto',
                padding: '12px',
                boxSizing: 'border-box',
                background: '#ffffff',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '24px',
                flexWrap: 'wrap',
              }}
            >
              <QRCodeSVG
                value={`ZEROPROXY-DEMO-${selectedClassDetails.code}`}
                size={180}
                level="H"
              />

              <div>
                <h3>{selectedClassDetails.name}</h3>
                <p>Course Code: {selectedClassDetails.code}</p>
                <p>Sample QR — not valid for attendance</p>
                <p>Session status: Demo</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setQrGenerated(false)}
              style={{
                ...buttonStyle,
                background: '#6b7280',
              }}
            >
              Hide QR
            </button>
          </div>
        )}
      </section>

      {/* My Classes */}
      <section style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h2>My Classes</h2>
            <p>View, add, or delete your courses.</p>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowAddForm(!showAddForm);
              setCourseMessage('');
            }}
            style={buttonStyle}
          >
            {showAddForm ? 'Cancel' : '+ Add Course'}
          </button>
        </div>

        <p role="status">{classMessage}</p>

        {/* Add Course Form */}
        {showAddForm && (
          <form
            onSubmit={handleAddCourse}
            style={{
              marginTop: '20px',
              padding: '20px',
              background: '#f8fafc',
              border: '1px solid #d1d5db',
              borderRadius: '10px',
            }}
          >
            <h3>Add New Course</h3>

            <label htmlFor="courseName">Course Name:</label>
            <input
              id="courseName"
              type="text"
              value={courseName}
              onChange={(event) => setCourseName(event.target.value)}
              placeholder="e.g. Database Management Systems"
              required
              style={inputStyle}
            />

            <label htmlFor="courseCode">Course Code:</label>
            <input
              id="courseCode"
              type="text"
              value={courseCode}
              onChange={(event) => setCourseCode(event.target.value)}
              placeholder="e.g. CS304"
              required
              style={inputStyle}
            />

            <label htmlFor="courseSemester">Semester:</label>
            <select
              id="courseSemester"
              value={courseSemester}
              onChange={(event) =>
                setCourseSemester(event.target.value)
              }
              style={inputStyle}
            >
              {Array.from({ length: 8 }, (_, index) => (
                <option key={index + 1} value={`Semester ${index + 1}`}>
                  Semester {index + 1}
                </option>
              ))}
            </select>

            <button type="submit" style={buttonStyle}>
              Save Course
            </button>

            {courseMessage && (
              <p role="status" style={{ color: '#b91c1c' }}>
                {courseMessage}
              </p>
            )}
          </form>
        )}

        {!showAddForm && courseMessage && (
          <p role="status" style={{ color: '#166534' }}>
            {courseMessage}
          </p>
        )}

        {/* Course Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '16px',
            marginTop: '20px',
          }}
        >
          {classes.map((item) => (
            <div
              key={item.id}
              style={{
                background: '#ffffff',
                padding: '20px',
                borderRadius: '12px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}
            >
              <h3>{item.name}</h3>

              <p>
                <strong>Course Code:</strong> {item.code}
              </p>

              <p>{item.semester}</p>

              <p>
                <strong>Session:</strong>{' '}
                {item.session || 'No active session'}
              </p>

              <div
                style={{
                  display: 'flex',
                  gap: '10px',
                  flexWrap: 'wrap',
                  marginTop: '16px',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedClass(String(item.id));
                    setQrGenerated(false);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  style={buttonStyle}
                >
                  Select Class
                </button>

                <button
                  type="button"
                  onClick={() => handleDeleteCourse(item)}
                  style={{
                    ...buttonStyle,
                    background: '#dc2626',
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        {classes.length === 0 && (
          <p>No courses available. Click Add Course to create one.</p>
        )}
      </section>

      {/* Live Attendance */}
      <section style={cardStyle}>
        <h2>Live Attendance</h2>
        <p>Monitor student attendance during an active session.</p>

        <h3>Current Attendance</h3>
        <p style={{ fontSize: '28px', fontWeight: 'bold' }}>
          0 students
        </p>
        <p>No active attendance session.</p>

        <button
          type="button"
          onClick={() =>
            alert(
              'Live attendance will be connected to the backend later.'
            )
          }
          style={buttonStyle}
        >
          View Live Attendance
        </button>
      </section>

      {/* Manual Attendance Override */}
      <section style={cardStyle}>
        <h2>Manual Attendance Override</h2>
        <p>
          Select a student and attendance status. This is currently a demo.
        </p>

        <label htmlFor="student">Select Student:</label>

        <select
          id="student"
          value={student}
          onChange={(event) => {
            setStudent(event.target.value);
            setAttendanceMessage('');
          }}
          style={selectStyle}
        >
          <option value="">Select a student</option>
          <option value="Student 1 - CS301">Student 1 - CS301</option>
          <option value="Student 2 - CS301">Student 2 - CS301</option>
          <option value="Student 3 - CS301">Student 3 - CS301</option>
        </select>

        <label htmlFor="attendanceStatus">
          Attendance Status:
        </label>

        <select
          id="attendanceStatus"
          value={attendanceStatus}
          onChange={(event) => {
            setAttendanceStatus(event.target.value);
            setAttendanceMessage('');
          }}
          style={selectStyle}
        >
          <option value="present">Present</option>
          <option value="absent">Absent</option>
        </select>

        <button
          type="button"
          onClick={handleManualAttendance}
          style={buttonStyle}
        >
          Update Attendance
        </button>

        {attendanceMessage && (
          <p
            role="status"
            style={{
              marginTop: '16px',
              color: attendanceMessage.startsWith('Please')
                ? '#b91c1c'
                : '#166534',
              fontWeight: 'bold',
            }}
          >
            {attendanceMessage}
          </p>
        )}

        <p style={{ color: '#6b7280', fontSize: '13px' }}>
          Demo only: attendance changes are not saved to the backend.
        </p>
      </section>
    </div>
  );
}

export default FacultyDashboard;
