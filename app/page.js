"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getPrompts } from "@/lib/prompts";
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
  const channelRef = useRef(null);
  const pendingTeacherRoom = useRef("");
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
      .eq("room_code", room)
      .eq("student_key", safeKey(name));
    if (error) throw error;
  }, []);

  const loadRoom = useCallback(async (room) => {
    const { data, error } = await getSupabase()
      .from("students")
      .select("display_name, answers, unique_count, entry_count, filled_count")
      .eq("room_code", room)
      .order("unique_count", { ascending: false });
    if (error) throw error;
    setStudents(data || []);
  }, []);

  const subscribeRoom = useCallback(async (room, onChange, filter) => {
    await unsubscribe();
    const channel = getSupabase()
      .channel(`room:${room}:${filter || "all"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "students", filter: filter || `room_code=eq.${room}` },
        onChange
      )
      .subscribe();
    channelRef.current = channel;
  }, [unsubscribe]);

  const joinRoom = useCallback(async () => {
    const room = roomInput.trim().toUpperCase();
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
    const room = (roomOverride || pendingTeacherRoom.current || roomInput).trim().toUpperCase();
    if (!room) return alert("Enter a room code first.");
    if (!isSupabaseConfigured()) return alert("Supabase is not configured yet.");
    setBusy(true);
    try {
      setRoomCode(room);
      setView("teacher");
      await loadRoom(room);
      await subscribeRoom(room, () => {
        loadRoom(room).catch(console.error);
      });
    } catch (err) {
      console.error(err);
      alert(err.message || "Could not open the dashboard.");
    } finally {
      setBusy(false);
    }
  }, [loadRoom, roomInput, subscribeRoom]);

  const requestTeacher = useCallback((roomOverride) => {
    const room = (roomOverride || roomInput).trim().toUpperCase();
    if (!room) return alert("Enter a room code first.");
    pendingTeacherRoom.current = room;
    if (typeof window !== "undefined" && sessionStorage.getItem(TEACHER_AUTH_KEY) === "1") {
      return openTeacher(room);
    }
    setPasswordInput("");
    setPasswordError("");
    setView("teacherLock");
  }, [openTeacher, roomInput]);

  function submitTeacherPassword(e) {
    e?.preventDefault?.();
    if (passwordInput !== TEACHER_PASSWORD) {
      setPasswordError("Incorrect password.");
      return;
    }
    sessionStorage.setItem(TEACHER_AUTH_KEY, "1");
    setPasswordError("");
    openTeacher(pendingTeacherRoom.current || roomInput);
  }

  useEffect(() => {
    const savedRoom = typeof window !== "undefined" ? localStorage.getItem("hb_room") || "" : "";
    const savedName = typeof window !== "undefined" ? localStorage.getItem("hb_student") || "" : "";
    const urlRoom = (searchParams.get("room") || "").toUpperCase();
    setRoomInput(urlRoom || savedRoom);
    setNameInput(savedName);
    if (searchParams.get("teacher") === "1" && (urlRoom || savedRoom)) {
      requestTeacher(urlRoom || savedRoom);
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

  function leaveRoom() {
    unsubscribe();
    setView("setup");
    setRoomInput(roomCode);
    setNameInput(studentName);
  }

  async function copyStudentLink() {
    const u = new URL(location.href);
    u.searchParams.set("room", roomCode);
    u.searchParams.delete("teacher");
    await navigator.clipboard.writeText(u.toString());
    alert("Student link copied.");
  }

  async function resetRoom() {
    if (!confirm(`Delete all live data in room ${roomCode}?`)) return;
    const { error } = await getSupabase().from("students").delete().eq("room_code", roomCode);
    if (error) return alert(error.message);
    setStudents([]);
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
    view === "teacher" ? `Teacher dashboard · Room: ${roomCode}` :
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
              <button className="secondary" onClick={() => requestTeacher()} disabled={busy}>Teacher dashboard</button>
            </div>
            <p className="notice">Students use the same room code. INT6066 and INT6136P use different bingo cards. Progress appears on the teacher dashboard in real time.</p>
          </section>
        )}

        {view === "teacherLock" && (
          <section className="panel">
            <h2>Teacher access</h2>
            <p className="notice">Enter the teacher password to open the live dashboard.</p>
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
                <button type="submit" disabled={busy}>Unlock dashboard</button>
                <button type="button" className="secondary" onClick={() => setView("setup")}>Back</button>
              </div>
            </form>
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
                <button className="secondary" onClick={leaveRoom}>Change room/name</button>
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
                  <div className="sub">Room: {roomCode}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="secondary" onClick={copyStudentLink}>Copy student link</button>
                  <button className="danger" onClick={resetRoom}>Reset room</button>
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
