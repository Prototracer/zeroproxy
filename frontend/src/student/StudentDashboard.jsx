
import React from "react";

function StudentDashboard() {
  const attendance = [
    { subject: "Data Structures", date: "09 Oct 2026", status: "Present" },
    { subject: "Computer Networks", date: "08 Oct 2026", status: "Present" },
    { subject: "Operating Systems", date: "07 Oct 2026", status: "Absent" },
    { subject: "Design and Analysis of Algorithms", date: "06 Oct 2026", status: "Present" },
  ];

  const cardStyle = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "16px",
    padding: "22px",
    backdropFilter: "blur(12px)",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "30px",
        boxSizing: "border-box",
        color: "#ffffff",
        fontFamily: "Arial, sans-serif",
        background:
          "radial-gradient(circle at top right, #302060, transparent 40%), linear-gradient(135deg, #080d20, #11152e 60%, #090c1b)",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "15px",
          marginBottom: "35px",
        }}
      >
        <div>
          <h1 style={{ margin: 0, color: "#67e8f9", fontSize: "28px" }}>
            ZeroProxy
          </h1>
          <p style={{ color: "#9ca3af", marginBottom: 0 }}>
            Smart Attendance System
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            sessionStorage.clear();
            window.location.href = "/login";
          }}
          style={{
            padding: "11px 20px",
            borderRadius: "10px",
            border: "1px solid #67e8f9",
            background: "transparent",
            color: "#67e8f9",
            cursor: "pointer",
          }}
        >
          Logout
        </button>
      </header>

      {/* Welcome */}
      <section style={{ marginBottom: "30px" }}>
        <p style={{ color: "#67e8f9", marginBottom: "8px" }}>
          STUDENT PORTAL
        </p>
        <h2 style={{ fontSize: "30px", margin: "0 0 10px" }}>
          Welcome, Student!
        </h2>
        <p style={{ color: "#a5acc5", margin: 0 }}>
          Track your attendance and stay updated with your classes.
        </p>
      </section>

      {/* Attendance Summary */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "20px",
          marginBottom: "35px",
        }}
      >
        <div style={cardStyle}>
          <p style={{ color: "#a5acc5", marginTop: 0 }}>Total Classes</p>
          <h2 style={{ fontSize: "32px", margin: "10px 0" }}>40</h2>
          <p style={{ color: "#67e8f9", marginBottom: 0 }}>
            Classes conducted
          </p>
        </div>

        <div style={cardStyle}>
          <p style={{ color: "#a5acc5", marginTop: 0 }}>Classes Attended</p>
          <h2 style={{ fontSize: "32px", margin: "10px 0", color: "#4ade80" }}>
            34
          </h2>
          <p style={{ color: "#a5acc5", marginBottom: 0 }}>
            Present sessions
          </p>
        </div>

        <div style={cardStyle}>
          <p style={{ color: "#a5acc5", marginTop: 0 }}>Classes Missed</p>
          <h2 style={{ fontSize: "32px", margin: "10px 0", color: "#fb7185" }}>
            6
          </h2>
          <p style={{ color: "#a5acc5", marginBottom: 0 }}>
            Absent sessions
          </p>
        </div>

        <div style={cardStyle}>
          <p style={{ color: "#a5acc5", marginTop: 0 }}>
            Attendance Percentage
          </p>
          <h2 style={{ fontSize: "32px", margin: "10px 0", color: "#67e8f9" }}>
            85%
          </h2>
          <div
            style={{
              height: "7px",
              background: "#303650",
              borderRadius: "10px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: "85%",
                height: "100%",
                background: "linear-gradient(90deg, #06b6d4, #818cf8)",
                borderRadius: "10px",
              }}
            />
          </div>
        </div>
      </section>

      {/* Recent Attendance */}
      <section style={cardStyle}>
        <h2 style={{ marginTop: 0, marginBottom: "8px" }}>
          Recent Attendance
        </h2>
        <p style={{ color: "#a5acc5", marginTop: 0, marginBottom: "25px" }}>
          Your latest class attendance records
        </p>

        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: "450px",
              textAlign: "left",
            }}
          >
            <thead>
              <tr style={{ color: "#67e8f9" }}>
                <th style={{ padding: "14px 10px" }}>Subject</th>
                <th style={{ padding: "14px 10px" }}>Date</th>
                <th style={{ padding: "14px 10px" }}>Status</th>
              </tr>
            </thead>

            <tbody>
              {attendance.map((item, index) => (
                <tr
                  key={index}
                  style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}
                >
                  <td style={{ padding: "16px 10px" }}>{item.subject}</td>
                  <td style={{ padding: "16px 10px", color: "#a5acc5" }}>
                    {item.date}
                  </td>
                  <td style={{ padding: "16px 10px" }}>
                    <span
                      style={{
                        color:
                          item.status === "Present" ? "#4ade80" : "#fb7185",
                        background:
                          item.status === "Present"
                            ? "rgba(74,222,128,0.1)"
                            : "rgba(251,113,133,0.1)",
                        padding: "6px 12px",
                        borderRadius: "20px",
                        fontSize: "13px",
                      }}
                    >
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p style={{ color: "#818ba8", fontSize: "12px", marginBottom: 0 }}>
          Demo data — real attendance will be connected to the backend later.
        </p>
      </section>
    </div>
  );
}

export default StudentDashboard;