import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client.js";
import { stopAllGlobalCameras } from "../utils/cameraManager.js";

function StudentDashboard() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [studentInfo, setStudentInfo] = useState({
    name: "Student",
    roll_no: "",
    status: "pending",
    has_face_enrollment: false,
  });
  const [metrics, setMetrics] = useState({
    totalClasses: 0,
    classesAttended: 0,
    classesMissed: 0,
    percentage: 100,
  });
  const [records, setRecords] = useState([]);
  const [statusMessage, setStatusMessage] = useState("Loading your attendance...");

  // Join course state
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [facultyEmail, setFacultyEmail] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [useEmailFallback, setUseEmailFallback] = useState(false);
  const [joinSubmitting, setJoinSubmitting] = useState(false);
  const [joinNotice, setJoinNotice] = useState(null); // { type: 'success' | 'error', text: '' }
  const [joinRequests, setJoinRequests] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [cancellingId, setCancellingId] = useState(null);

  async function loadJoinRequests() {
    try {
      const data = await apiRequest("/student/join-requests");
      if (Array.isArray(data)) {
        setJoinRequests(data);
      }
    } catch {
      // join requests endpoint might fail if token is not ready
    }
  }

  async function loadInstructors() {
    try {
      const data = await apiRequest("/student/instructors");
      if (Array.isArray(data)) {
        setInstructors(data);
      }
    } catch {
      // silently handle
    }
  }

  async function loadStudentData() {
    try {
      const data = await apiRequest("/attendance/student/me");
      if (data && data.student) {
        setStudentInfo(data.student);
        setMetrics({
          totalClasses: data.total_classes ?? 0,
          classesAttended: data.classes_attended ?? 0,
          classesMissed: data.classes_missed ?? 0,
          percentage: data.attendance_percentage ?? 100,
        });
        setRecords(Array.isArray(data.records) ? data.records : []);
        setStatusMessage("Live data synced from server.");
      }
    } catch {
      setStatusMessage("Connected to server.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Ensure any camera streams from previous scanning pages are thoroughly stopped
    stopAllGlobalCameras();

    loadStudentData();
    loadJoinRequests();
    loadInstructors();

    const pollInterval = setInterval(() => {
      loadJoinRequests();
    }, 10000);
    return () => clearInterval(pollInterval);
  }, []);

  async function handleSendJoinRequest(e) {
    e.preventDefault();
    setJoinNotice(null);

    // If using Course Join Code mode (default & recommended)
    if (!useEmailFallback) {
      const codeTrimmed = joinCodeInput.trim().toUpperCase();
      if (!codeTrimmed) {
        setJoinNotice({ type: "error", text: "Please enter the 6-character course join code provided by your instructor." });
        return;
      }

      setJoinSubmitting(true);
      try {
        const res = await apiRequest("/student/join-requests", {
          method: "POST",
          body: JSON.stringify({
            join_code: codeTrimmed,
          }),
        });

        const freshRequests = await apiRequest("/student/join-requests");
        if (Array.isArray(freshRequests)) {
          setJoinRequests(freshRequests);
        }

        setJoinNotice({
          type: "success",
          text: res?.message || `Join request sent for code ${codeTrimmed}! Awaiting instructor approval.`,
        });
        setJoinCodeInput("");
      } catch (err) {
        setJoinNotice({
          type: "error",
          text: err?.message || "Could not submit join request with this code. Check if the code is enabled or already used.",
        });
      } finally {
        setJoinSubmitting(false);
      }
      return;
    }

    // Fallback: via Faculty Email
    const emailTrimmed = facultyEmail.trim().toLowerCase();
    if (!emailTrimmed) {
      setJoinNotice({ type: "error", text: "Please enter the faculty member's email address." });
      return;
    }

    setJoinSubmitting(true);
    try {
      const res = await apiRequest("/student/join-requests", {
        method: "POST",
        body: JSON.stringify({
          faculty_email: emailTrimmed,
          course_code: courseCode.trim() || undefined,
        }),
      });

      // Reload join requests from backend immediately to verify persistence
      const freshRequests = await apiRequest("/student/join-requests");
      if (Array.isArray(freshRequests)) {
        setJoinRequests(freshRequests);
        const didSave = freshRequests.some(
          (r) => r.faculty_email?.toLowerCase() === emailTrimmed && r.status === "pending"
        );

        if (didSave) {
          setJoinNotice({
            type: "success",
            text: "Join request submitted successfully! It is now visible on the right panel and awaiting faculty approval.",
          });
          setFacultyEmail("");
          setCourseCode("");
        } else {
          setJoinNotice({
            type: "error",
            text: `Note: '${emailTrimmed}' is not recognized as a registered faculty member in your institution. No request was created. Please select an instructor from the list below.`,
          });
        }
      } else {
        setJoinNotice({
          type: "success",
          text: res?.message || "Join request submitted. Waiting for faculty approval.",
        });
        setFacultyEmail("");
        setCourseCode("");
      }
    } catch (err) {
      setJoinNotice({
        type: "error",
        text: err?.message || "Could not submit join request. Please try again.",
      });
    } finally {
      setJoinSubmitting(false);
    }
  }

  async function handleCancelRequest(id) {
    if (!window.confirm("Are you sure you want to cancel this pending join request?")) {
      return;
    }

    setCancellingId(id);
    try {
      await apiRequest(`/student/join-requests/${id}`, {
        method: "DELETE",
      });
      await loadJoinRequests();
    } catch (err) {
      alert(err?.message || "Failed to cancel join request.");
    } finally {
      setCancellingId(null);
    }
  }

  function handleScanClick() {
    if (!studentInfo.has_face_enrollment || studentInfo.status !== "active") {
      const confirmEnroll = window.confirm(
        "Scan Unavailable:\n\nYour account is pending face enrollment. Would you like to complete face enrollment now?"
      );
      if (confirmEnroll) {
        navigate("/student/enroll");
      }
      return;
    }
    navigate("/student/scan");
  }

  const cardStyle = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "16px",
    padding: "22px",
    backdropFilter: "blur(12px)",
  };

  const inputStyle = {
    padding: "12px 14px",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.06)",
    color: "#ffffff",
    fontSize: "14px",
    outline: "none",
    boxSizing: "border-box",
  };

  // Determine enrollment workflow guidance step
  let workflowStep = {
    title: "Action Required: Complete Face Enrollment",
    desc: "Enroll your face biometrics to activate your account and start marking verified attendance.",
    color: "#fbbf24",
    actionText: "Enroll Face Now →",
    action: () => navigate("/student/enroll"),
  };
  const hasApproved = joinRequests.some((r) => r.status === "approved");
  const hasPending = joinRequests.some((r) => r.status === "pending");

  if (studentInfo.status === "active" && studentInfo.has_face_enrollment) {
    if (hasApproved || metrics.totalClasses > 0) {
      workflowStep = {
        title: "Ready to Scan",
        desc: "Your face enrollment is complete and verified. Click 'Scan QR / Mark Attendance' during lectures.",
        color: "#4ade80",
        actionText: "Scan Attendance →",
        action: () => navigate("/student/scan"),
      };
    } else {
      workflowStep = {
        title: "Join a Course",
        desc: "Enter your faculty instructor's join code or email below to request admission to classes.",
        color: "#67e8f9",
      };
    }
  } else if (hasPending) {
    workflowStep = {
      title: "Step 2: Waiting for Faculty Approval",
      desc: "Your join request has been sent to your instructor. Make sure your face enrollment is complete while waiting.",
      color: "#818cf8",
      actionText: "Enroll Face Now →",
      action: () => navigate("/student/enroll"),
    };
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "30px",
        boxSizing: "border-box",
        color: "#ffffff",
        fontFamily: "'Inter', Arial, sans-serif",
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
          marginBottom: "30px",
        }}
      >
        <div>
          <h1 style={{ margin: 0, color: "#67e8f9", fontSize: "28px" }}>
            ZeroProxy
          </h1>
          <p style={{ color: "#9ca3af", marginBottom: 0, fontSize: "14px" }}>
            Smart Attendance System
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            type="button"
            onClick={() => navigate("/student/enroll")}
            style={{
              padding: "11px 20px",
              borderRadius: "10px",
              border: "1px solid rgba(38, 207, 255, 0.4)",
              background:
                studentInfo.has_face_enrollment && studentInfo.status === "active"
                  ? "rgba(38, 207, 255, 0.12)"
                  : "linear-gradient(135deg, #0284c7, #2563eb)",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: "14px",
              cursor: "pointer",
              boxShadow:
                studentInfo.has_face_enrollment && studentInfo.status === "active"
                  ? "none"
                  : "0 4px 14px rgba(37, 99, 255, 0.4)",
            }}
          >
            {studentInfo.has_face_enrollment && studentInfo.status === "active"
              ? "👤 Re-enroll Face"
              : "👤 Enroll Face"}
          </button>

          <button
            type="button"
            onClick={handleScanClick}
            style={{
              padding: "11px 22px",
              borderRadius: "10px",
              border: "none",
              background:
                studentInfo.has_face_enrollment && studentInfo.status === "active"
                  ? "linear-gradient(135deg, #06b6d4, #3b82f6)"
                  : "rgba(255,255,255,0.12)",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: "14px",
              cursor: "pointer",
              boxShadow:
                studentInfo.has_face_enrollment && studentInfo.status === "active"
                  ? "0 4px 14px rgba(6, 182, 212, 0.4)"
                  : "none",
            }}
          >
            📸 Scan QR / Mark Attendance
          </button>

          <button
            type="button"
            onClick={() => {
              sessionStorage.clear();
              navigate("/login", { replace: true });
            }}
            style={{
              padding: "11px 20px",
              borderRadius: "10px",
              border: "1px solid rgba(103, 232, 249, 0.4)",
              background: "transparent",
              color: "#67e8f9",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Logout
          </button>
        </div>
      </header>

      {/* Welcome & Status Bar */}
      <section
        style={{
          marginBottom: "25px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexWrap: "wrap",
          gap: "15px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
            <span
              style={{
                color: "#67e8f9",
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              STUDENT PORTAL
            </span>

            {studentInfo.has_face_enrollment && studentInfo.status === "active" ? (
              <span
                style={{
                  fontSize: "11px",
                  background: "rgba(74, 222, 128, 0.15)",
                  color: "#4ade80",
                  padding: "3px 8px",
                  borderRadius: "12px",
                  border: "1px solid rgba(74, 222, 128, 0.3)",
                }}
              >
                ● Active & Enrolled
              </span>
            ) : (
              <span
                style={{
                  fontSize: "11px",
                  background: "rgba(251, 191, 36, 0.15)",
                  color: "#fbbf24",
                  padding: "3px 8px",
                  borderRadius: "12px",
                  border: "1px solid rgba(251, 191, 36, 0.3)",
                }}
              >
                ▲ Face Enrollment Pending
              </span>
            )}
          </div>

          <h2 style={{ fontSize: "28px", margin: "0 0 6px", fontWeight: 700 }}>
            Welcome, {studentInfo.name || "Student"}!
          </h2>

          <p style={{ color: "#a5acc5", margin: 0, fontSize: "14px" }}>
            {studentInfo.roll_no ? `Roll No: ${studentInfo.roll_no} • ` : ""}
            Track your verified attendance and scan rotating lecture QR codes.
          </p>
        </div>

        <div style={{ fontSize: "13px", color: "#67e8f9", background: "rgba(103, 232, 249, 0.08)", padding: "8px 14px", borderRadius: "8px" }}>
          Backend Status: <strong>{statusMessage}</strong>
        </div>
      </section>

      {/* Guided Next-Step Banner */}
      <section
        style={{
          ...cardStyle,
          marginBottom: "25px",
          borderLeft: `5px solid ${workflowStep.color}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "15px",
        }}
      >
        <div>
          <span style={{ fontSize: "12px", fontWeight: 700, color: workflowStep.color, textTransform: "uppercase" }}>
            {workflowStep.title}
          </span>
          <p style={{ margin: "4px 0 0", fontSize: "14px", color: "#e2e8f0" }}>
            {workflowStep.desc}
          </p>
        </div>

        {workflowStep.actionText && (
          <button
            type="button"
            onClick={workflowStep.action}
            style={{
              padding: "10px 20px",
              borderRadius: "10px",
              border: "none",
              background: "linear-gradient(135deg, #0284c7, #2563eb)",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: "13px",
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(37, 99, 255, 0.4)",
            }}
          >
            {workflowStep.actionText}
          </button>
        )}
      </section>

      {/* Join Course Form & Pending Requests */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: "25px",
          marginBottom: "35px",
        }}
      >
        {/* Form: Join a Course */}
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <h3 style={{ margin: 0, fontSize: "18px", color: "#67e8f9" }}>
              ➕ Join a Course
            </h3>
            <button
              type="button"
              onClick={() => {
                setUseEmailFallback(!useEmailFallback);
                setJoinNotice(null);
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                fontSize: "12px",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {useEmailFallback ? "Use Course Code instead" : "Join via Faculty Email instead"}
            </button>
          </div>

          <p style={{ color: "#a5acc5", fontSize: "13px", margin: "0 0 18px" }}>
            {useEmailFallback
              ? "Ask an instructor to add you to their class roster by entering their email address."
              : "Enter the 6-character random Join Code provided by your course faculty to request admission."}
          </p>

          {joinNotice && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: "8px",
                fontSize: "13px",
                marginBottom: "16px",
                background:
                  joinNotice.type === "success"
                    ? "rgba(74, 222, 128, 0.15)"
                    : "rgba(251, 113, 133, 0.15)",
                color: joinNotice.type === "success" ? "#4ade80" : "#fb7185",
                border: `1px solid ${
                  joinNotice.type === "success"
                    ? "rgba(74, 222, 128, 0.3)"
                    : "rgba(251, 113, 133, 0.3)"
                }`,
              }}
            >
              {joinNotice.text}
            </div>
          )}

          {!useEmailFallback ? (
            /* Mode 1: Instant Course Join Code */
            <form onSubmit={handleSendJoinRequest}>
              <div style={{ marginBottom: "18px" }}>
                <label
                  htmlFor="join-code-input"
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#cbd5e1",
                    marginBottom: "8px",
                  }}
                >
                  Enter Course Join Code <span style={{ color: "#fb7185" }}>*</span>
                </label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <input
                    id="join-code-input"
                    type="text"
                    required
                    maxLength={10}
                    placeholder="e.g. 38KUDF"
                    value={joinCodeInput}
                    onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                    style={{
                      ...inputStyle,
                      flex: 1,
                      letterSpacing: "0.2em",
                      fontSize: "20px",
                      fontWeight: 700,
                      textAlign: "center",
                      textTransform: "uppercase",
                      background: "rgba(15, 23, 42, 0.8)",
                      border: "2px solid rgba(103, 232, 249, 0.4)",
                      padding: "12px 14px",
                    }}
                  />
                </div>
                <span style={{ display: "block", fontSize: "12px", color: "#94a3b8", marginTop: "6px" }}>
                  Ask your faculty instructor for this session's course join code.
                </span>
              </div>

              <button
                type="submit"
                disabled={joinSubmitting || !joinCodeInput.trim()}
                style={{
                  width: "100%",
                  padding: "13px",
                  borderRadius: "8px",
                  border: "none",
                  background: "linear-gradient(135deg, #06b6d4, #6366f1)",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: "14px",
                  cursor: joinSubmitting || !joinCodeInput.trim() ? "not-allowed" : "pointer",
                  opacity: joinSubmitting || !joinCodeInput.trim() ? 0.6 : 1,
                  boxShadow: "0 4px 14px rgba(6, 182, 212, 0.3)",
                }}
              >
                {joinSubmitting ? "Sending Request..." : "🚀 Send Admission Request via Code"}
              </button>
            </form>
          ) : (
            /* Mode 2: Via Faculty Email (Fallback) */
            <>
              {instructors.length > 0 && (
                <div style={{ marginBottom: "16px" }}>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#94a3b8",
                      marginBottom: "8px",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Available Instructors (Click to select):
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {instructors.map((inst) => {
                      const defaultCourse = inst.courses && inst.courses.length > 0 ? inst.courses[0] : null;
                      const isSelected = facultyEmail.toLowerCase() === inst.email.toLowerCase();

                      return (
                        <button
                          key={inst.id}
                          type="button"
                          onClick={() => {
                            setFacultyEmail(inst.email);
                            if (defaultCourse) {
                              setCourseCode(defaultCourse.code);
                            }
                          }}
                          style={{
                            padding: "7px 12px",
                            borderRadius: "20px",
                            border: isSelected
                              ? "1px solid #67e8f9"
                              : "1px solid rgba(255,255,255,0.15)",
                            background: isSelected
                              ? "rgba(103, 232, 249, 0.18)"
                              : "rgba(255,255,255,0.05)",
                            color: isSelected ? "#67e8f9" : "#e2e8f0",
                            fontSize: "12px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            transition: "all 0.2s ease",
                          }}
                        >
                          <span>👤 {inst.name}</span>
                          <span style={{ color: "#94a3b8", fontSize: "11px" }}>({inst.email})</span>
                          {defaultCourse && (
                            <span
                              style={{
                                background: "rgba(99, 102, 241, 0.25)",
                                color: "#a5b4fc",
                                padding: "2px 7px",
                                borderRadius: "10px",
                                fontSize: "11px",
                                fontWeight: 600,
                              }}
                            >
                              {defaultCourse.code}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <form onSubmit={handleSendJoinRequest}>
                <div style={{ marginBottom: "14px" }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: "13px",
                      color: "#cbd5e1",
                      marginBottom: "6px",
                    }}
                  >
                    Faculty Email Address <span style={{ color: "#fb7185" }}>*</span>
                  </label>
                  <input
                    type="email"
                    required
                    list="registered-faculty-list"
                    placeholder="faculty@example.com"
                    value={facultyEmail}
                    onChange={(e) => setFacultyEmail(e.target.value)}
                    style={{ ...inputStyle, width: "100%" }}
                  />
                  <datalist id="registered-faculty-list">
                    {instructors.map((inst) => (
                      <option key={inst.id} value={inst.email}>
                        {inst.name} ({inst.courses?.map((c) => c.code).join(", ") || "No courses"})
                      </option>
                    ))}
                  </datalist>
                </div>

                <div style={{ marginBottom: "18px" }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: "13px",
                      color: "#cbd5e1",
                      marginBottom: "6px",
                    }}
                  >
                    Course Code (Optional, e.g. CS101)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. CS101 or leave blank"
                    value={courseCode}
                    onChange={(e) => setCourseCode(e.target.value)}
                    style={{ ...inputStyle, width: "100%" }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={joinSubmitting}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "8px",
                    border: "none",
                    background: "linear-gradient(135deg, #06b6d4, #6366f1)",
                    color: "#ffffff",
                    fontWeight: 600,
                    fontSize: "14px",
                    cursor: joinSubmitting ? "not-allowed" : "pointer",
                    opacity: joinSubmitting ? 0.7 : 1,
                  }}
                >
                  {joinSubmitting ? "Sending Request..." : "Send Join Request"}
                </button>
              </form>
            </>
          )}
        </div>

        {/* List: My Join Requests */}
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <h3 style={{ margin: 0, fontSize: "18px", color: "#67e8f9" }}>
              📋 My Course Join Requests
            </h3>
            <span style={{ fontSize: "12px", color: "#a5acc5" }}>
              {joinRequests.length} total
            </span>
          </div>

          <div style={{ maxHeight: "290px", overflowY: "auto" }}>
            {joinRequests.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {joinRequests.map((req) => {
                  const statusColors = {
                    pending: { bg: "rgba(251, 191, 36, 0.15)", text: "#fbbf24" },
                    approved: { bg: "rgba(74, 222, 128, 0.15)", text: "#4ade80" },
                    rejected: { bg: "rgba(251, 113, 133, 0.15)", text: "#fb7185" },
                    cancelled: { bg: "rgba(148, 163, 184, 0.15)", text: "#94a3b8" },
                  };
                  const color = statusColors[req.status] || statusColors.pending;

                  return (
                    <div
                      key={req.id}
                      style={{
                        padding: "12px 14px",
                        borderRadius: "10px",
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "10px",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "14px" }}>
                          {req.faculty_name || req.faculty_email}
                        </div>
                        <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                          {req.faculty_email} {req.course_code ? `• Code: ${req.course_code}` : ""} {req.class_name ? `• ${req.class_name}` : ""}
                        </div>
                        <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                          Requested: {new Date(req.created_at).toLocaleDateString()}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "3px 8px",
                            borderRadius: "12px",
                            background: color.bg,
                            color: color.text,
                            textTransform: "capitalize",
                          }}
                        >
                          {req.status}
                        </span>

                        {req.status === "pending" && (
                          <button
                            type="button"
                            disabled={cancellingId === req.id}
                            onClick={() => handleCancelRequest(req.id)}
                            style={{
                              padding: "4px 8px",
                              fontSize: "11px",
                              borderRadius: "6px",
                              border: "1px solid rgba(251, 113, 133, 0.4)",
                              background: "rgba(251, 113, 133, 0.1)",
                              color: "#fb7185",
                              cursor: "pointer",
                            }}
                          >
                            {cancellingId === req.id ? "..." : "Cancel"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ color: "#9ca3af", fontSize: "13px", padding: "20px 0", textAlign: "center" }}>
                No join requests sent yet. Use the form on the left to request course admission.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Attendance Summary Cards */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "20px",
          marginBottom: "35px",
        }}
      >
        <div style={cardStyle}>
          <p style={{ color: "#a5acc5", marginTop: 0, fontSize: "13px" }}>Total Classes</p>
          <h2 style={{ fontSize: "34px", margin: "10px 0", fontWeight: 700 }}>
            {metrics.totalClasses}
          </h2>
          <p style={{ color: "#67e8f9", marginBottom: 0, fontSize: "13px" }}>
            Conducted sessions
          </p>
        </div>

        <div style={cardStyle}>
          <p style={{ color: "#a5acc5", marginTop: 0, fontSize: "13px" }}>Classes Attended</p>
          <h2 style={{ fontSize: "34px", margin: "10px 0", color: "#4ade80", fontWeight: 700 }}>
            {metrics.classesAttended}
          </h2>
          <p style={{ color: "#a5acc5", marginBottom: 0, fontSize: "13px" }}>
            Verified present
          </p>
        </div>

        <div style={cardStyle}>
          <p style={{ color: "#a5acc5", marginTop: 0, fontSize: "13px" }}>Classes Missed</p>
          <h2 style={{ fontSize: "34px", margin: "10px 0", color: "#fb7185", fontWeight: 700 }}>
            {metrics.classesMissed}
          </h2>
          <p style={{ color: "#a5acc5", marginBottom: 0, fontSize: "13px" }}>
            Absent / unverified
          </p>
        </div>

        <div style={cardStyle}>
          <p style={{ color: "#a5acc5", marginTop: 0, fontSize: "13px" }}>
            Attendance Percentage
          </p>
          <h2 style={{ fontSize: "34px", margin: "10px 0", color: "#67e8f9", fontWeight: 700 }}>
            {metrics.percentage}%
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
                width: `${Math.min(100, Math.max(0, metrics.percentage))}%`,
                height: "100%",
                background: "linear-gradient(90deg, #06b6d4, #818cf8)",
                borderRadius: "10px",
                transition: "width 0.4s ease",
              }}
            />
          </div>
        </div>
      </section>

      {/* Attendance History */}
      <section style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "20px" }}>
          <div>
            <h2 style={{ marginTop: 0, marginBottom: "6px", fontSize: "20px" }}>
              Attendance History
            </h2>
            <p style={{ color: "#a5acc5", margin: 0, fontSize: "13px" }}>
              Verified biometric and session attendance records from the server
            </p>
          </div>

          <span style={{ fontSize: "12px", color: "#a5acc5" }}>
            {records.length} record(s) logged
          </span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: "500px",
              textAlign: "left",
            }}
          >
            <thead>
              <tr style={{ color: "#67e8f9", fontSize: "13px" }}>
                <th style={{ padding: "12px 10px" }}>Subject</th>
                <th style={{ padding: "12px 10px" }}>Code</th>
                <th style={{ padding: "12px 10px" }}>Date & Time</th>
                <th style={{ padding: "12px 10px" }}>Verification Type</th>
                <th style={{ padding: "12px 10px" }}>Status</th>
              </tr>
            </thead>

            <tbody>
              {records.length > 0 ? (
                records.map((item) => (
                  <tr
                    key={item.id}
                    style={{ borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: "14px" }}
                  >
                    <td style={{ padding: "14px 10px", fontWeight: 500 }}>{item.subject}</td>
                    <td style={{ padding: "14px 10px", color: "#a5acc5" }}>{item.code}</td>
                    <td style={{ padding: "14px 10px", color: "#a5acc5" }}>
                      {item.date} {item.time ? `• ${item.time}` : ""}
                    </td>
                    <td style={{ padding: "14px 10px" }}>
                      <span
                        style={{
                          fontSize: "12px",
                          background: item.source === "override" ? "rgba(251, 191, 36, 0.15)" : "rgba(6, 182, 212, 0.15)",
                          color: item.source === "override" ? "#fbbf24" : "#67e8f9",
                          padding: "4px 8px",
                          borderRadius: "6px",
                        }}
                      >
                        {item.source === "override" ? "Faculty Override" : "Facial + QR Scan"}
                      </span>
                    </td>
                    <td style={{ padding: "14px 10px" }}>
                      <span
                        style={{
                          color: "#4ade80",
                          background: "rgba(74,222,128,0.12)",
                          padding: "5px 12px",
                          borderRadius: "20px",
                          fontSize: "12px",
                          fontWeight: 600,
                        }}
                      >
                        ● {item.status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={5}
                    style={{
                      padding: "30px 10px",
                      textAlign: "center",
                      color: "#9ca3af",
                      fontSize: "14px",
                    }}
                  >
                    {loading
                      ? "Fetching records..."
                      : "No attendance records recorded yet. Once enrolled in a class, click 'Scan QR / Mark Attendance' during class sessions."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default StudentDashboard;