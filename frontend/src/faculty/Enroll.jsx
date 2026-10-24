import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client.js';

export default function Enroll() {
  const navigate = useNavigate();

  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchPending();
  }, []);

  async function fetchPending() {
    setLoading(true);
    try {
      const data = await apiRequest('/faculty/pending');
      if (Array.isArray(data)) {
        setStudents(
          data.map((s) => ({
            id: s.id,
            roll_no: s.roll_no,
            name: s.name,
            email: s.email,
            status: s.status === 'pending' ? 'Pending' : 'Active',
          }))
        );
      }
    } catch (err) {
      setMessage(err?.message || 'Failed to fetch pending students from server.');
    } finally {
      setLoading(false);
    }
  }

  function startEnrollment(student) {
    setSelectedStudent(student);
    setMessage(`Selected ${student.name} (${student.roll_no || student.email}) for face capture.`);
  }

  async function completeEnrollment() {
    if (!selectedStudent) return;

    setIsSubmitting(true);
    setMessage('');

    try {
      // Create mock or extracted 3 descriptors (128 floats each) for in-class capture hook
      const simulatedDescriptors = [
        Array(128).fill(0.05),
        Array(128).fill(0.05),
        Array(128).fill(0.05),
      ];

      await apiRequest(`/faculty/enroll/${selectedStudent.id}`, {
        method: 'POST',
        body: JSON.stringify({
          descriptors: simulatedDescriptors,
          consent: true,
        }),
      });

      setMessage(`✓ ${selectedStudent.name} (${selectedStudent.roll_no}) successfully enrolled and activated!`);
      setSelectedStudent(null);
      await fetchPending();
    } catch (err) {
      setMessage(`Enrollment failed: ${err?.message || 'Check connection or face data.'}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  function cancelEnrollment() {
    setSelectedStudent(null);
    setMessage('Enrollment selection cancelled.');
  }

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white" style={{ background: '#0a0e1e', minHeight: '100vh', padding: '30px', color: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }}>
      <div className="mx-auto max-w-4xl" style={{ maxWidth: '850px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '15px' }}>
          <div>
            <button
              type="button"
              onClick={() => navigate('/faculty')}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'transparent',
                color: '#67e8f9',
                cursor: 'pointer',
                fontSize: '13px',
                marginBottom: '8px',
              }}
            >
              ← Back to Dashboard
            </button>
            <h1 style={{ margin: 0, fontSize: '26px', color: '#67e8f9', fontWeight: 700 }}>
              Student Face Enrollment
            </h1>
            <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '14px' }}>
              Scoped list of students with approved join requests awaiting face enrollment
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={() => navigate('/faculty/join-requests')}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                background: 'rgba(99, 102, 241, 0.15)',
                color: '#818cf8',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              View Join Requests
            </button>
          </div>
        </div>

        {/* Counter Card */}
        <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', padding: '20px', marginBottom: '24px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>Pending Face Enrollment</p>
          <h2 style={{ margin: '8px 0 0', fontSize: '32px', color: '#fbbf24', fontWeight: 700 }}>
            {students.length}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
            Only students who have an approved join request appear here
          </p>
        </div>

        {message && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              fontSize: '14px',
              marginBottom: '20px',
              background: message.startsWith('✓') ? 'rgba(74, 222, 128, 0.15)' : 'rgba(103, 232, 249, 0.15)',
              color: message.startsWith('✓') ? '#4ade80' : '#67e8f9',
              border: `1px solid ${message.startsWith('✓') ? 'rgba(74, 222, 128, 0.3)' : 'rgba(103, 232, 249, 0.3)'}`,
            }}
          >
            {message}
          </div>
        )}

        {selectedStudent && (
          <section
            style={{
              background: 'rgba(30, 41, 59, 0.7)',
              border: '1px solid #38bdf8',
              borderRadius: '14px',
              padding: '22px',
              marginBottom: '24px',
            }}
          >
            <h2 style={{ margin: '0 0 10px', fontSize: '18px', color: '#38bdf8' }}>
              Face Capture for {selectedStudent.name}
            </h2>

            <p style={{ margin: '0 0 4px', fontSize: '14px', color: '#cbd5e1' }}>
              Roll Number: <strong>{selectedStudent.roll_no || 'N/A'}</strong> • Email: {selectedStudent.email}
            </p>

            <div
              style={{
                marginTop: '16px',
                padding: '24px',
                borderRadius: '10px',
                border: '2px dashed #475569',
                textAlign: 'center',
                background: 'rgba(15, 23, 42, 0.6)',
              }}
            >
              <p style={{ fontWeight: 600, margin: '0 0 6px', color: '#e2e8f0' }}>Face Capture Area</p>
              <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
                Ready for descriptor capture from <code>getDescriptor(videoEl)</code>.
              </p>
            </div>

            <div style={{ marginTop: '18px', display: 'flex', gap: '12px' }}>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={completeEnrollment}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  opacity: isSubmitting ? 0.7 : 1,
                }}
              >
                {isSubmitting ? 'Saving Enrollment...' : 'Complete Face Enrollment & Activate'}
              </button>

              <button
                type="button"
                onClick={cancelEnrollment}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'transparent',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Cancel
              </button>
            </div>
          </section>
        )}

        {/* Student List */}
        <div>
          {loading ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', padding: '30px' }}>Loading students...</p>
          ) : students.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', background: 'rgba(255,255,255,0.03)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p style={{ margin: '0 0 6px', fontSize: '16px', color: '#e2e8f0' }}>No pending students in your scope</p>
              <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                Students who have an approved join request to your classes will appear here for face enrollment.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {students.map((student) => (
                <section
                  key={student.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '16px 20px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    flexWrap: 'wrap',
                    gap: '12px',
                  }}
                >
                  <div>
                    <h3 style={{ margin: '0 0 4px', fontSize: '16px' }}>{student.name}</h3>
                    <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                      Roll No: <strong style={{ color: '#cbd5e1' }}>{student.roll_no || 'N/A'}</strong> • Email: {student.email}
                    </p>
                    <span
                      style={{
                        display: 'inline-block',
                        marginTop: '6px',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: 'rgba(251, 191, 36, 0.15)',
                        color: '#fbbf24',
                      }}
                    >
                      Pending Face Enrollment
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => startEnrollment(student)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: 'none',
                      background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                      color: '#ffffff',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    Start Face Enrollment
                  </button>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}