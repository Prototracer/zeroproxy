
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const demoStudents = [
  {
    id: 1,
    name: 'Student One',
    email: 'student1@example.com',
    status: 'Pending',
  },
  {
    id: 2,
    name: 'Student Two',
    email: 'student2@example.com',
    status: 'Pending',
  },
  {
    id: 3,
    name: 'Student Three',
    email: 'student3@example.com',
    status: 'Pending',
  },
];

export default function Enroll() {
  const navigate = useNavigate();

  const [students, setStudents] = useState(demoStudents);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [message, setMessage] = useState('');

  function startEnrollment(student) {
    setSelectedStudent(student);
    setMessage(
      `Selected ${student.name}. Face capture is not connected yet.`
    );
  }

  function completeDemoEnrollment() {
    if (!selectedStudent) return;

    setStudents((currentStudents) =>
      currentStudents.map((student) =>
        student.id === selectedStudent.id
          ? { ...student, status: 'Enrolled' }
          : student
      )
    );

    setMessage(
      `${selectedStudent.name} marked as enrolled in demo mode.`
    );

    setSelectedStudent(null);
  }

  function cancelEnrollment() {
    setSelectedStudent(null);
    setMessage('Enrolment selection cancelled.');
  }

  const pendingCount = students.filter(
    (student) => student.status === 'Pending'
  ).length;

  const enrolledCount = students.filter(
    (student) => student.status === 'Enrolled'
  ).length;

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">
              Student Enrolment
            </h1>

            <p className="mt-2 text-slate-300">
              Select a pending student to begin face enrolment.
            </p>
          </div>

          <button
            type="button"
            onClick={() => navigate('/faculty')}
            className="rounded-lg border border-slate-600 px-4 py-2
                       hover:bg-slate-800"
          >
            Back to Dashboard
          </button>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">
              Pending Students
            </p>
            <p className="mt-2 text-3xl font-bold text-amber-400">
              {pendingCount}
            </p>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">
              Enrolled Students (Demo)
            </p>
            <p className="mt-2 text-3xl font-bold text-green-400">
              {enrolledCount}
            </p>
          </div>
        </div>

        {message && (
          <div
            role="status"
            className="mb-5 rounded-lg border border-blue-500
                       bg-blue-950 p-4 text-blue-200"
          >
            {message}
          </div>
        )}

        {selectedStudent && (
          <section className="mb-6 rounded-xl border border-blue-500
                              bg-slate-900 p-5">
            <h2 className="text-xl font-semibold">
              Enrolment Selection
            </h2>

            <p className="mt-2 text-slate-300">
              Student: {selectedStudent.name}
            </p>

            <p className="text-slate-400">
              {selectedStudent.email}
            </p>

            <div className="mt-4 rounded-lg border border-dashed
                            border-slate-600 p-5 text-center">
              <p className="font-medium">
                Face Capture Area
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Camera and face capture will be connected when
                the FE2 integration is ready.
              </p>
            </div>

            <p className="mt-4 text-sm text-amber-300">
              Demo only: completing this step does not capture
              or verify a face.
            </p>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={completeDemoEnrollment}
                className="rounded-lg bg-green-600 px-4 py-2
                           font-medium hover:bg-green-500"
              >
                Mark Enrolled (Demo)
              </button>

              <button
                type="button"
                onClick={cancelEnrollment}
                className="rounded-lg border border-slate-600 px-4 py-2
                           hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </section>
        )}

        <div className="space-y-4">
          {students.map((student) => (
            <section
              key={student.id}
              className="flex flex-col gap-4 rounded-xl
                         border border-slate-700 bg-slate-900
                         p-5 sm:flex-row sm:items-center
                         sm:justify-between"
            >
              <div>
                <h2 className="text-lg font-semibold">
                  {student.name}
                </h2>

                <p className="text-sm text-slate-400">
                  {student.email}
                </p>

                <span
                  className={`mt-2 inline-block rounded-full px-3 py-1
                    text-sm ${
                      student.status === 'Pending'
                        ? 'bg-amber-950 text-amber-300'
                        : 'bg-green-950 text-green-300'
                    }`}
                >
                  {student.status}
                </span>
              </div>

              <button
                type="button"
                disabled={student.status !== 'Pending'}
                onClick={() => startEnrollment(student)}
                className="rounded-lg bg-blue-600 px-5 py-3
                           font-medium hover:bg-blue-500
                           disabled:cursor-not-allowed
                           disabled:opacity-50"
              >
                {student.status === 'Pending'
                  ? 'Start Enrolment'
                  : 'Enrolled'}
              </button>
            </section>
          ))}
        </div>

        <p className="mt-6 text-sm text-slate-400">
          Demo data only. Student records are not saved to the
          backend, and face capture is not connected yet.
        </p>
      </div>
    </main>
  );
}