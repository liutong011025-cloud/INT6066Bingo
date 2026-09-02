"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { COURSES, getCourseMeta, getPrompts, normalizeRoom } from "@/lib/prompts";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

const TEACHER_PASSWORD = "123321";
const TEACHER_AUTH_KEY = "hb_teacher_ok";
const safeKey = (s) => s.trim().replace(/[.#$[\]/]/g, "_");
const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");

function statsFromAnswers(answers) {
  const all = Object.values(answers).flat().map((x) => String(x).trim()).filter(Boolean);
  const unique = new Set(all.map(norm));
  const filled = Object.values(answers).filter((a) => (a || []).some((v) => String(v).trim())).length;
  return { all, unique: unique.size, entries: all.length, filled };
}

function namedCount(vals) {
  return (vals || []).filter((v) => String(v).trim()).length;
}

function cardLook(idx, count) {
  const hue = (idx * 47 + 12) % 360;
  const lightness = Math.max(32, 90 - count * 11);
  const saturation = Math.min(78, 48 + count * 7);
  const borderLight = Math.max(22, lightness - 16);
  return {
    background: `hsl(${hue} ${saturation}% ${lightness}%)`,
    borderColor: `hsl(${hue} ${Math.min(85, saturation + 8)}% ${borderLight}%)`,
    dark: lightness < 78,
    darker: lightness < 52
  };
}

function BingoApp() {
  const searchParams = useSearchParams();
  const [view, setView] = useState("setup");
  const [roomInput, setRoomInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [studentName, setStudentName] = useState("");
  const [answers, setAnswers] = useState({});
  const [students, setStudents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [courseStats, setCourseStats] = useState({});
  const channelRef = useRef(null);
  const studentRef = useRef({ roomCode: "", studentName: "" });
  const answersRef = useRef({});

  useEffect(() => {
    studentRef.current = { roomCode, studentName };
  }, [roomCode, studentName]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const mine = useMemo(() => statsFromAnswers(answers), [answers]);
  const prompts = useMemo(() => getPrompts(roomCode || roomInput), [roomCode, roomInput]);

  const unsubscribe = useCallback(async () => {
    const supabase = isSupabaseConfigured() ? getSupabase() : null;
    if (channelRef.current && supabase) {
      await supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  const persist = useCallback(async (nextAnswers) => {
    const { roomCode: room, studentName: name } = studentRef.current;
    if (!room || !name) return;
    const s = statsFromAnswers(nextAnswers);
    const { error } = await getSupabase()
      .from("students")
      .update({
        display_name: name,
        answers: nextAnswers,
        unique_count: s.unique,
        entry_count: s.entries,
        filled_count: s.filled,
        last_active: new Date().toISOString()
      })
      .eq("room_code", normalizeRoom(room))
      .eq("student_key", safeKey(name));
    if (error) throw error;
  }, []);

  const loadRoom = useCallback(async (room) => {
    const want = normalizeRoom(room);
    const { data, error } = await getSupabase()
      .from("students")
      .select("display_name, answers, unique_count, entry_count, filled_count, room_code")
      .order("unique_count", { ascending: false });
    if (error) throw error;
    setStudents((data || []).filter((row) => normalizeRoom(row.room_code) === want));
  }, []);

  const subscribeRoom = useCallback(async (room, onChange, filter) => {
    await unsubscribe();
    const query = { event: "*", schema: "public", table: "students" };
    if (filter) query.filter = filter;
    const channel = getSupabase()
      .channel(`room:${room}:${filter || "all"}`)
      .on("postgres_changes", query, onChange)
      .subscribe();
    channelRef.current = channel;
  }, [unsubscribe]);

  const loadCourses = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("students")
      .select("room_code, unique_count, entry_count");
    if (error) throw error;
    const next = {};
    for (const row of data || []) {
      const code = normalizeRoom(row.room_code);
      if (!code) continue;
      if (!next[code]) next[code] = { students: 0, entries: 0, uniqueSum: 0 };
      next[code].students += 1;
      next[code].entries += +row.entry_count || 0;
      next[code].uniqueSum += +row.unique_count || 0;
    }
    setCourseStats(next);
  }, []);

  const showCoursePicker = useCallback(async () => {
    if (!isSupabaseConfigured()) return alert("Supabase is not configured yet.");
    setBusy(true);
    try {
      setView("teacherCourses");
      await loadCourses();
      await subscribeRoom("all-courses", () => {
        loadCourses().catch(console.error);
      });
    } catch (err) {
      console.error(err);
      alert(err.message || "Could not load courses.");
    } finally {
      setBusy(false);
    }
  }, [loadCourses, subscribeRoom]);

  const joinRoom = useCallback(async () => {
    const room = normalizeRoom(roomInput);
    const name = nameInput.trim();
    if (!room || !name) return alert("Enter room code and your name.");
    if (!isSupabaseConfigured()) return alert("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    setBusy(true);
    try {
      localStorage.setItem("hb_room", room);
      localStorage.setItem("hb_student", name);
      const { data, error } = await getSupabase()
        .from("students")
        .upsert(
          {
            room_code: room,
            student_key: safeKey(name),
            display_name: name,
            last_active: new Date().toISOString()
          },
          { onConflict: "room_code,student_key" }
        )
        .select("id, answers")
        .single();
      if (error) throw error;
      setRoomCode(room);
      setStudentName(name);
      setAnswers(data?.answers || {});
      setView("student");
      await subscribeRoom(room, (payload) => {
        const row = payload.new;
        if (row?.answers) setAnswers(row.answers);
      }, data?.id ? `id=eq.${data.id}` : `room_code=eq.${room}`);
    } catch (err) {
      console.error(err);
      alert(err.message || "Could not join the room.");
    } finally {
      setBusy(false);
    }
  }, [nameInput, roomInput, subscribeRoom]);

  const openTeacher = useCallback(async (roomOverride) => {
    const room = normalizeRoom(roomOverride);
    if (!room) return alert("Choose a course first.");
    if (!isSupabaseConfigured()) return alert("Supabase is not configured yet.");
    setBusy(true);
    try {
      setRoomCode(room);
      setView("teacher");
      await loadRoom(room);
      await subscribeRoom(room, (payload) => {
        const row = payload.new || payload.old;
        if (!row || normalizeRoom(row.room_code) === room) {
          loadRoom(room).catch(console.error);
        }
      });
    } catch (err) {
      console.error(err);
      alert(err.message || "Could not open the dashboard.");
    } finally {
      setBusy(false);
    }
  }, [loadRoom, subscribeRoom]);

  const requestTeacher = useCallback(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(TEACHER_AUTH_KEY) === "1") {
      return showCoursePicker();
    }
    setPasswordInput("");
    setPasswordError("");
    setView("teacherLock");
  }, [showCoursePicker]);

  function submitTeacherPassword(e) {
    e?.preventDefault?.();
    if (passwordInput !== TEACHER_PASSWORD) {
      setPasswordError("Incorrect password.");
      return;
    }
    sessionStorage.setItem(TEACHER_AUTH_KEY, "1");
    setPasswordError("");
    showCoursePicker();
  }

  useEffect(() => {
    const savedRoom = typeof window !== "undefined" ? normalizeRoom(localStorage.getItem("hb_room") || "") : "";
    const savedName = typeof window !== "undefined" ? localStorage.getItem("hb_student") || "" : "";
    const urlRoom = normalizeRoom(searchParams.get("room") || "");
    setRoomInput(urlRoom || savedRoom);
    setNameInput(savedName);
    if (searchParams.get("teacher") === "1") {
      requestTeacher();
    }
    return () => { unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addName(idx) {
    const cur = [...(answers[idx] || [""])];
    cur.push("");
    setAnswers({ ...answers, [idx]: cur });
  }

  async function removeName(idx, i) {
    const cur = [...(answers[idx] || [""])];
    cur.splice(i, 1);
    const next = { ...answers, [idx]: cur.length ? cur : [""] };
    setAnswers(next);
    try { await persist(next); }
    catch (err) { console.error(err); alert(err.message || "Could not save."); }
  }

  function goBack() {
    if (view === "teacher") {
      showCoursePicker();
      return;
    }
    unsubscribe();
    setView("setup");
    if (view === "student") {
      setRoomInput(roomCode);
      setNameInput(studentName);
    }
  }

  async function copyStudentLink() {
    const u = new URL(location.href);
    u.searchParams.set("room", roomCode);
    u.searchParams.delete("teacher");
    await navigator.clipboard.writeText(u.toString());
    alert("Student link copied.");
  }

  async function deleteClass(code) {
    const room = normalizeRoom(code);
    if (!room) return;
    const meta = getCourseMeta(room);
    const count = courseStats[room]?.students || (normalizeRoom(roomCode) === room ? students.length : 0);
    const first = confirm(
      `Delete class ${meta.title}?\n\nThis will permanently remove ${count} student record(s) and all bingo answers.\nThis cannot be undone.`
    );
    if (!first) return;
    const second = confirm(`Please confirm again: delete ${meta.title} now?`);
    if (!second) return;
    setBusy(true);
    try {
      const { data, error: readErr } = await getSupabase()
        .from("students")
        .select("id, room_code");
      if (readErr) throw readErr;
      const ids = (data || [])
        .filter((row) => normalizeRoom(row.room_code) === room)
        .map((row) => row.id);
      if (ids.length) {
        const { error } = await getSupabase().from("students").delete().in("id", ids);
        if (error) throw error;
      }
      if (normalizeRoom(roomCode) === room) setStudents([]);
      await loadCourses();
      if (view === "teacher" && normalizeRoom(roomCode) === room) await showCoursePicker();
    } catch (err) {
      console.error(err);
      alert(err.message || "Could not delete the class.");
    } finally {
      setBusy(false);
    }
  }

  const ranked = useMemo(() => {
    return [...students]
      .map((s) => ({
        name: s.display_name || "Anonymous",
        unique: +s.unique_count || 0,
        entries: +s.entry_count || 0,
        filled: +s.filled_count || 0,
        answers: s.answers || {}
      }))
      .sort((a, b) => b.unique - a.unique || b.entries - a.entries);
  }, [students]);

  const courseList = useMemo(() => {
    const known = COURSES.map((c) => ({
      ...c,
      students: courseStats[c.code]?.students || 0,
      entries: courseStats[c.code]?.entries || 0,
      uniqueSum: courseStats[c.code]?.uniqueSum || 0
    }));
    const extras = Object.keys(courseStats)
      .filter((code) => !COURSES.some((c) => c.code === normalizeRoom(code)))
      .sort()
      .map((code) => ({
        ...getCourseMeta(code),
        ...courseStats[code]
      }));
    return [...known, ...extras];
  }, [courseStats]);

  const classConnections = ranked.reduce((x, s) => x + s.entries, 0);
  const classAvg = ranked.length
    ? (ranked.reduce((x, s) => x + s.unique, 0) / ranked.length).toFixed(1)
    : "0";
  const promptCounts = prompts
    .map((p, idx) => ({
      p,
      c: ranked.reduce((sum, s) => sum + ((s.answers[idx] || []).filter((v) => String(v).trim()).length), 0)
    }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 10);

  const headerLabel =
    view === "teacher" ? `Teacher dashboard · ${getCourseMeta(roomCode).title}` :
    view === "teacherCourses" ? "All courses" :
    view === "teacherLock" ? "Teacher access" :
    view === "student" ? `Room: ${roomCode}` :
    "Realtime classroom edition";

  return (
    <>
      <header>
        <div className="wrap top">
          <div>
            <h1>Human Bingo Live</h1>
            <div className="sub">{headerLabel}</div>
          </div>
          <div className="pills">
            {view !== "setup" && (
              <button className="secondary" onClick={goBack} disabled={busy}>Back</button>
            )}
            <div className="pill">Unique people: <b>{mine.unique}</b></div>
            <div className="pill">My entries: <b>{mine.entries}</b></div>
          </div>
        </div>
      </header>

      <main className="wrap">
        {view === "setup" && (
          <section className="panel">
            <h2>Join the room</h2>
            <div className="setup-grid">
              <div>
                <div className="sub">Room code</div>
                <input value={roomInput} onChange={(e) => setRoomInput(e.target.value)} placeholder="e.g. INT6066 or INT6136P" />
              </div>
              <div>
                <div className="sub">Your name</div>
                <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="e.g. Amy" />
              </div>
            </div>
            <div className="actions">
              <button onClick={joinRoom} disabled={busy}>Start Bingo</button>
              <button className="secondary" onClick={requestTeacher} disabled={busy}>Teacher dashboard</button>
            </div>
            <p className="notice">Students use the same room code. INT6066 and INT6136P use different bingo cards. Progress appears on the teacher dashboard in real time.</p>
          </section>
        )}

        {view === "teacherLock" && (
          <section className="panel">
            <h2>Teacher access</h2>
            <p className="notice">Enter the teacher password to see all courses.</p>
            <form onSubmit={submitTeacherPassword}>
              <div className="sub">Password</div>
              <input
                type="password"
                autoFocus
                value={passwordInput}
                onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(""); }}
                placeholder="Teacher password"
              />
              {passwordError ? <p className="notice warn" style={{ marginTop: 8 }}>{passwordError}</p> : null}
              <div className="actions">
                <button type="submit" disabled={busy}>Continue</button>
                <button type="button" className="secondary" onClick={goBack}>Back</button>
              </div>
            </form>
          </section>
        )}

        {view === "teacherCourses" && (
          <section className="panel">
            <div className="top">
              <div>
                <h2 style={{ margin: 0 }}>Choose a course</h2>
                <div className="sub">Select a class to open its live dashboard.</div>
              </div>
              <button className="secondary" onClick={goBack}>Back</button>
            </div>
            <div className="course-grid">
              {courseList.map((course) => (
                <div className="course-card" key={course.code}>
                  <b>{course.title}</b>
                  <div className="notice" style={{ margin: 0 }}>{course.blurb}</div>
                  <div className="course-meta">
                    <span>{course.students || 0} students</span>
                    <span>{course.entries || 0} entries</span>
                  </div>
                  <div className="course-card-actions">
                    <button onClick={() => openTeacher(course.code)} disabled={busy}>Open dashboard</button>
                    <button className="danger" onClick={() => deleteClass(course.code)} disabled={busy}>Delete class</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {view === "student" && (
          <section>
            <div className="panel">
              <div className="top">
                <div>
                  <b>Hi, {studentName} 👋</b>
                  <div className="sub">Walk around, talk, and add names.</div>
                </div>
                <button className="secondary" onClick={goBack}>Back</button>
              </div>
              <div className="progress" style={{ marginTop: 12 }}>
                <div className="bar" style={{ width: `${(mine.filled / prompts.length) * 100}%` }} />
              </div>
              <div className="sub" style={{ marginTop: 6 }}>{mine.filled} / {prompts.length} prompts completed</div>
            </div>
            <div className="grid">
              {prompts.map((prompt, idx) => {
                const vals = answers[idx]?.length ? answers[idx] : [""];
                const count = namedCount(vals);
                const look = cardLook(idx, count);
                const tone = look.darker ? " is-darker" : look.dark ? " is-dark" : "";
                return (
                  <div className={`card${tone}`} key={idx} style={{ background: look.background, borderColor: look.borderColor }}>
                    <div className="q">{prompt}</div>
                    <div className="names">
                      {vals.map((v, i) => (
                        <div className="row" key={`${idx}-${i}`}>
                          <input
                            placeholder="Classmate name"
                            value={v}
                            onChange={(e) => {
                              const next = { ...answersRef.current, [idx]: [...(answersRef.current[idx] || [""])] };
                              next[idx][i] = e.target.value;
                              setAnswers(next);
                            }}
                            onBlur={() => persist(answersRef.current).catch((err) => {
                              console.error(err);
                              alert(err.message || "Could not save.");
                            })}
                          />
                          <button className="secondary mini" onClick={() => (i === vals.length - 1 ? addName(idx) : removeName(idx, i))}>
                            {i === vals.length - 1 ? "＋" : "×"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {view === "teacher" && (
          <section>
            <div className="panel">
              <div className="top">
                <div>
                  <h2 style={{ margin: 0 }}>Live Dashboard</h2>
                  <div className="sub">{getCourseMeta(roomCode).title}</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="secondary" onClick={goBack} disabled={busy}>Back</button>
                  <button className="secondary" onClick={copyStudentLink}>Copy student link</button>
                  <button className="danger" onClick={() => deleteClass(roomCode)} disabled={busy}>Delete class</button>
                </div>
              </div>
            </div>
            <div className="statsline">
              <div className="stat"><b>{ranked.length}</b><span>students joined</span></div>
              <div className="stat"><b>{classConnections}</b><span>name entries made</span></div>
              <div className="stat"><b>{classAvg}</b><span>avg. unique people</span></div>
            </div>
            <div className="panel">
              <h3>Leaderboard</h3>
              <table className="table">
                <thead>
                  <tr><th>Rank</th><th>Student</th><th>Unique people</th><th>Entries</th><th>Prompts</th></tr>
                </thead>
                <tbody>
                  {ranked.map((s, i) => (
                    <tr key={`${s.name}-${i}`}>
                      <td>{i + 1}</td>
                      <td>{s.name}</td>
                      <td><b>{s.unique}</b></td>
                      <td>{s.entries}</td>
                      <td>{s.filled}/{prompts.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel">
              <h3>Most common Bingo items</h3>
              <table className="table">
                <thead>
                  <tr><th>Prompt</th><th>Matches</th></tr>
                </thead>
                <tbody>
                  {promptCounts.map((x) => (
                    <tr key={x.p}>
                      <td>{x.p}</td>
                      <td><b>{x.c}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
      <footer />
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="wrap"><section className="panel">Loading…</section></main>}>
      <BingoApp />
    </Suspense>
  );
}
