"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
  signOut,
  firebaseAuth,
  googleProvider,
  type User,
} from "@/lib/authClient";
import {
  SECTIONS,
  FILE_CATEGORIES,
  isFieldVisible,
  isCategoryRequired,
  missingRequiredFields,
  type Answers,
  type Field,
  type UploadedFile,
} from "@/lib/formSchema";

// ===== בורר תאריך: 3 תפריטים (שנה → חודש → יום). נוח לתאריך לידה, פורמט DD/MM/YYYY. =====
const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
/** תומך גם ב-DD/MM/YYYY (חדש) וגם ב-YYYY-MM-DD (ערכים ישנים). */
function parseDMY(v: string): { d: string; m: string; y: string } {
  if (!v) return { d: "", m: "", y: "" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split("-"); return { d: String(+d), m: String(+m), y }; }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) { const [d, m, y] = v.split("/"); return { d: String(+d), m: String(+m), y }; }
  return { d: "", m: "", y: "" };
}
function DateSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const init = parseDMY(value);
  const [d, setD] = useState(init.d);
  const [m, setM] = useState(init.m);
  const [y, setY] = useState(init.y);
  // סנכרון מערך חיצוני מלא (טעינת טיוטה) — לא מאפס בחירה חלקית שלנו
  useEffect(() => {
    const p = parseDMY(value);
    if (p.d && p.m && p.y) { setD(p.d); setM(p.m); setY(p.y); }
  }, [value]);
  const emit = (nd: string, nm: string, ny: string) => {
    onChange(nd && nm && ny ? `${nd.padStart(2, "0")}/${nm.padStart(2, "0")}/${ny}` : "");
  };
  const nowY = new Date().getFullYear();
  const years: number[] = [];
  for (let yy = nowY - 15; yy >= 1930; yy--) years.push(yy);
  const days: number[] = [];
  for (let i = 1; i <= 31; i++) days.push(i);
  const stt = { flex: 1, minWidth: 0 };
  return (
    <div style={{ display: "flex", gap: 8, direction: "rtl" }}>
      <select style={stt} value={y} onChange={(e) => { setY(e.target.value); emit(d, m, e.target.value); }}>
        <option value="">שנה</option>
        {years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
      </select>
      <select style={stt} value={m} onChange={(e) => { setM(e.target.value); emit(d, e.target.value, y); }}>
        <option value="">חודש</option>
        {HE_MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}
      </select>
      <select style={stt} value={d} onChange={(e) => { setD(e.target.value); emit(e.target.value, m, y); }}>
        <option value="">יום</option>
        {days.map((dd) => <option key={dd} value={dd}>{dd}</option>)}
      </select>
    </div>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

const FILES_STEP = SECTIONS.length; // אינדקס שלב המסמכים
const TOTAL_STEPS = SECTIONS.length + 1;

function fmtSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);

  const [answers, setAnswers] = useState<Answers>({});
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [missingList, setMissingList] = useState<string[]>([]);

  const answersRef = useRef(answers);
  answersRef.current = answers;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  // --- auth ---
  useEffect(() => {
    // קליטת תוצאת ההפניה (redirect) אחרי חזרה מגוגל — מציף שגיאות אם היו
    getRedirectResult(firebaseAuth()).catch((e: unknown) => {
      const code = (e as { code?: string }).code || (e as { message?: string }).message || "";
      if (code) setErrorMsg(`ההתחברות נכשלה — ${code}`);
    });
    return onAuthStateChanged(firebaseAuth(), (u) => {
      setUser(u);
      setAuthReady(true);
    });
  }, []);

  const token = useCallback(async () => {
    const u = firebaseAuth().currentUser;
    if (!u) throw new Error("not signed in");
    return u.getIdToken();
  }, []);

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const t = await token();
      const res = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}`, ...(init?.headers || {}) },
      });
      return res;
    },
    [token]
  );

  // --- טעינת טיוטה ---
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/draft");
        const data = await res.json();
        if (cancelled) return;
        // כל מי שמתחבר מגיע לשאלון (כמו לפני הפורטל). הפורטל נשאר נגיש ישירות ב-/portal בלבד.
        setAnswers(data.answers || {});
        setFiles(data.files || []);
        if (data.status === "submitted") setSubmitted(true);
      } catch {
        /* טיוטה תיווצר בשמירה הראשונה */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, api]);

  // --- שמירה ---
  const saveDraft = useCallback(async () => {
    if (!firebaseAuth().currentUser) return;
    setSaveState("saving");
    try {
      const res = await api("/api/draft", { method: "PUT", body: JSON.stringify({ answers: answersRef.current }) });
      setSaveState(res.ok ? "saved" : "error");
      if (res.ok) dirty.current = false;
    } catch {
      setSaveState("error");
    }
  }, [api]);

  const setAnswer = (key: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    dirty.current = true;
    setSaveState("idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveDraft, 1500);
  };

  // שמירה לפני יציאה מהדף
  useEffect(() => {
    const onLeave = () => {
      if (dirty.current && firebaseAuth().currentUser) {
        const payload = JSON.stringify({ answers: answersRef.current });
        // sendBeacon לא תומך ב-headers — שמירה רגילה עם keepalive
        firebaseAuth()
          .currentUser!.getIdToken()
          .then((t) =>
            fetch("/api/draft", {
              method: "PUT",
              keepalive: true,
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
              body: payload,
            })
          )
          .catch(() => {});
      }
    };
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, []);

  // --- התחברות ---
  const login = async () => {
    setLoginBusy(true);
    setErrorMsg(null);
    try {
      const auth = firebaseAuth();
      await setPersistence(auth, browserLocalPersistence);
      await signInWithPopup(auth, googleProvider);
    } catch (e: unknown) {
      const code = (e as { code?: string }).code || "";
      const msg = (e as { message?: string }).message || "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        // המשתמש סגר את החלון — לא שגיאה
      } else if (code === "auth/popup-blocked") {
        // הדפדפן חסם פופ-אפ — נופלים חזרה להפניה מלאה
        await signInWithRedirect(firebaseAuth(), googleProvider);
      } else {
        setErrorMsg(`ההתחברות נכשלה — ${code || msg}`);
      }
    } finally {
      setLoginBusy(false);
    }
  };

  // --- העלאת קבצים ---
  const uploadFiles = async (category: string, list: FileList) => {
    setErrorMsg(null);
    for (const file of Array.from(list)) {
      const progressKey = `${category}:${file.name}`;
      setUploading((p) => ({ ...p, [progressKey]: 0 }));
      try {
        const signRes = await api("/api/files", {
          method: "POST",
          body: JSON.stringify({
            action: "sign",
            category,
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
          }),
        });
        if (!signRes.ok) {
          const d = await signRes.json().catch(() => ({}));
          throw new Error(d.error || "שגיאה בהכנת ההעלאה");
        }
        const { uploadUrl, storagePath } = await signRes.json();

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl);
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable) {
              setUploading((p) => ({ ...p, [progressKey]: Math.round((ev.loaded / ev.total) * 100) }));
            }
          };
          xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`)));
          xhr.onerror = () => reject(new Error("network"));
          xhr.send(file);
        });

        const doneRes = await api("/api/files", {
          method: "POST",
          body: JSON.stringify({
            action: "complete",
            category,
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
            storagePath,
          }),
        });
        const done = await doneRes.json();
        if (done.file) setFiles((prev) => [...prev, done.file]);
      } catch (e: unknown) {
        setErrorMsg(`ההעלאה של "${file.name}" נכשלה — ${(e as Error).message}`);
      } finally {
        setUploading((p) => {
          const { [progressKey]: _drop, ...rest } = p;
          return rest;
        });
      }
    }
  };

  const removeFile = async (f: UploadedFile) => {
    setFiles((prev) => prev.filter((x) => x.storagePath !== f.storagePath));
    await api("/api/files", { method: "POST", body: JSON.stringify({ action: "delete", storagePath: f.storagePath }) }).catch(
      () => {}
    );
  };

  // --- שליחה ---
  const submit = async () => {
    setErrorMsg(null);
    setMissingList([]);
    const missing = missingRequiredFields(answers);
    const missingFiles = FILE_CATEGORIES.filter(
      (cat) => isCategoryRequired(cat, answers) && !files.some((f) => f.category === cat.key)
    );
    if (missing.length || missingFiles.length) {
      setMissingList([
        ...missing.map((m) => `${m.label} (${m.section})`),
        ...missingFiles.map((c) => `מסמך: ${c.label}`),
      ]);
      return;
    }
    setSubmitBusy(true);
    try {
      await saveDraft();
      const res = await api("/api/submit", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        if (data.missing || data.missingFiles) {
          setMissingList([
            ...(data.missing || []).map((m: { section: string; label: string }) => `${m.label} (${m.section})`),
            ...(data.missingFiles || []).map((l: string) => `מסמך: ${l}`),
          ]);
        } else {
          setErrorMsg(data.error || "שגיאה בשליחה");
        }
        return;
      }
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setErrorMsg("שגיאה בשליחה, נסו שוב");
    } finally {
      setSubmitBusy(false);
    }
  };

  // --- רינדור שדה ---
  const renderField = (field: Field) => {
    const value = answers[field.key] || "";
    const label = (
      <label htmlFor={field.key}>
        {field.label} {field.required && <span className="req">*</span>}
      </label>
    );
    const full = field.type === "textarea" || field.type === "radio" || field.type === "yesno";

    return (
      <div className={`pcf-field${full ? " full" : ""}`} key={field.key}>
        {label}
        {field.type === "textarea" ? (
          <textarea id={field.key} value={value} placeholder={field.placeholder} onChange={(e) => setAnswer(field.key, e.target.value)} />
        ) : field.type === "select" ? (
          <select id={field.key} value={value} onChange={(e) => setAnswer(field.key, e.target.value)}>
            <option value="">בחרו…</option>
            {field.options!.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : field.type === "radio" || field.type === "yesno" ? (
          <div className="pcf-pills" role="radiogroup" aria-label={field.label}>
            {(field.type === "yesno" ? ["כן", "לא"] : field.options!).map((o) => (
              <button
                key={o}
                type="button"
                className={`pcf-pill${value === o ? " active" : ""}`}
                onClick={() => setAnswer(field.key, o)}
              >
                {o}
              </button>
            ))}
          </div>
        ) : field.type === "date" ? (
          <DateSelect value={value} onChange={(v) => setAnswer(field.key, v)} />
        ) : (
          <input
            id={field.key}
            type={field.type === "number" ? "number" : field.type === "tel" ? "tel" : "text"}
            inputMode={field.type === "number" ? "numeric" : undefined}
            value={value}
            placeholder={field.placeholder}
            onChange={(e) => setAnswer(field.key, e.target.value)}
          />
        )}
      </div>
    );
  };

  // ===== מסכים =====

  if (!authReady) {
    return (
      <main className="pcf-wrap">
        <div className="pcf-hero">
          <div className="pcf-spin" style={{ margin: "60px auto" }} />
        </div>
      </main>
    );
  }

  // --- מסך התחברות ---
  if (!user) {
    return (
      <main className="pcf-wrap">
        <header className="pcf-hero">
          <span className="pcf-badge">פאוור קאפל • דין ומיק</span>
          <h1>
            <u>שאלון פיננסי</u> — נעים להכיר 👋
          </h1>
          <p className="sub">כמה פרטים שיעזרו לנו להבין את התמונה הפיננסית שלכם ולבנות עבורכם את המסלול הנכון.</p>
        </header>
        <div className="pcf-card pcf-login">
          <div className="points">
            <div className="point">
              <span className="ic">✦</span>
              <span>השאלון לוקח כ-10 דקות — אפשר לעצור באמצע ולחזור, הכל נשמר אוטומטית.</span>
            </div>
            <div className="point">
              <span className="ic">✦</span>
              <span>המסמכים מועברים ישירות לצוות שלנו בצורה מאובטחת.</span>
            </div>
            <div className="point">
              <span className="ic">✦</span>
              <span>מתחברים עם חשבון Google — ככה נשמור עליכם את ההתקדמות.</span>
            </div>
          </div>
          <button className="pcf-btn white" onClick={login} disabled={loginBusy}>
            {loginBusy ? (
              <span className="pcf-spin" style={{ borderTopColor: "#1a1a1a", borderColor: "rgba(0,0,0,.2)" }} />
            ) : (
              <svg width="20" height="20" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C40.9 35.5 44 30.2 44 24c0-1.3-.1-2.6-.4-3.9z" />
              </svg>
            )}
            התחברות עם Google
          </button>
          {errorMsg && <div className="pcf-err">{errorMsg}</div>}
        </div>
        <div className="pcf-foot">דין ומיק • פאוור קאפל © 2026</div>
      </main>
    );
  }

  // --- מסך הצלחה ---
  if (submitted) {
    return (
      <main className="pcf-wrap">
        <header className="pcf-hero">
          <span className="pcf-badge">פאוור קאפל • דין ומיק</span>
        </header>
        <div className="pcf-card pcf-success">
          <div className="check">✓</div>
          <h2>השאלון נשלח בהצלחה!</h2>
          <p>תודה {answers.fullName || user.displayName} — קיבלנו את כל הפרטים והמסמכים. הצוות שלנו יעבור עליהם ויחזור אליכם בהקדם.</p>
          <div style={{ marginTop: 22 }}>
            <button
              className="pcf-btn ghost"
              onClick={() => {
                setSubmitted(false);
                setStep(0);
              }}
            >
              צריך לעדכן משהו? חזרה לשאלון
            </button>
            <a className="pcf-btn" style={{ marginRight: 10 }} href="/portal">← חזרה למסע שלי</a>
          </div>
        </div>
        <div className="pcf-foot">דין ומיק • פאוור קאפל © 2026</div>
      </main>
    );
  }

  if (!loaded) {
    return (
      <main className="pcf-wrap">
        <div className="pcf-hero">
          <div className="pcf-spin" style={{ margin: "60px auto" }} />
        </div>
      </main>
    );
  }

  const isFilesStep = step === FILES_STEP;
  const section = isFilesStep ? null : SECTIONS[step];

  return (
    <main className="pcf-wrap">
      <header className="pcf-hero">
        <span className="pcf-badge">פאוור קאפל • דין ומיק</span>
        <h1>
          <u>שאלון פיננסי</u>
        </h1>
        <p className="sub">כל הפרטים נשמרים אוטומטית — אפשר לצאת ולחזור מתי שנוח.</p>
        <a href="/portal" className="pcf-link-btn" style={{ display: "inline-block", marginTop: 8 }}>← חזרה למסע שלי</a>
      </header>

      <div className="pcf-topbar">
        <div className="pcf-user">
          {user.photoURL && <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />}
          <span>{user.displayName || user.email}</span>
          <button className="pcf-link-btn" onClick={() => signOut(firebaseAuth())}>
            התנתקות
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className={`pcf-save-state${saveState === "saved" ? " saved" : ""}`}>
            {saveState === "saving" && (
              <>
                <span className="pcf-spin" style={{ width: 12, height: 12, borderWidth: 2 }} /> שומר…
              </>
            )}
            {saveState === "saved" && "✓ נשמר"}
            {saveState === "error" && "שגיאה בשמירה"}
          </span>
          <button className="pcf-btn ghost" style={{ padding: "8px 16px", fontSize: 14 }} onClick={saveDraft}>
            💾 שמירה
          </button>
        </div>
      </div>

      <div className="pcf-progress">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <span key={i} className={i <= step ? "done" : ""} />
        ))}
      </div>
      <div className="pcf-step-label">
        שלב {step + 1} מתוך {TOTAL_STEPS}
      </div>

      <div className="pcf-card">
        {section && (
          <>
            <h2>
              <span>{section.icon}</span> {section.title}
            </h2>
            <p className="lead">שדות עם <span style={{ color: "var(--accent)" }}>*</span> הם חובה.</p>
            <div className="pcf-form">{section.fields.filter((f) => isFieldVisible(f, answers)).map(renderField)}</div>
          </>
        )}

        {isFilesStep && (
          <>
            <h2>
              <span>📎</span> מסמכים
            </h2>
            <p className="lead">העלו את המסמכים הבאים. אפשר לצרף כמה קבצים לכל סעיף (PDF או תמונה).</p>
            <div className="pcf-files">
              {FILE_CATEGORIES.map((cat) => {
                const required = isCategoryRequired(cat, answers);
                const catFiles = files.filter((f) => f.category === cat.key);
                const inProgress = Object.entries(uploading).filter(([k]) => k.startsWith(`${cat.key}:`));
                return (
                  <div className="pcf-file-cat" key={cat.key}>
                    <div className="pcf-file-cat-head">
                      <strong>
                        {cat.label} {required && <span style={{ color: "var(--accent)" }}>*</span>}
                        {cat.hint && <span className="hint">{cat.hint}</span>}
                      </strong>
                      <label className="pcf-upload-btn">
                        ⬆ העלאת קבצים
                        <input
                          type="file"
                          multiple={cat.multiple}
                          accept=".pdf,.png,.jpg,.jpeg,.webp,.heic"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            if (e.target.files?.length) uploadFiles(cat.key, e.target.files);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                    {(catFiles.length > 0 || inProgress.length > 0) && (
                      <ul className="pcf-file-list">
                        {catFiles.map((f) => (
                          <li className="pcf-file-item" key={f.storagePath}>
                            <span className="name">📄 {f.name}</span>
                            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span className="size">{fmtSize(f.size)}</span>
                              <button title="מחיקה" onClick={() => removeFile(f)}>
                                ✕
                              </button>
                            </span>
                          </li>
                        ))}
                        {inProgress.map(([key, pct]) => (
                          <li className="pcf-file-item" key={key} style={{ display: "block" }}>
                            <span className="name">⏳ {key.split(":").slice(1).join(":")}</span>
                            <div className="pcf-upload-progress">
                              <div style={{ width: `${pct}%` }} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {(errorMsg || missingList.length > 0) && (
          <div className="pcf-err">
            {errorMsg}
            {missingList.length > 0 && (
              <>
                כדי לשלוח את השאלון צריך להשלים:
                <ul>
                  {missingList.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="pcf-nav">
          {step > 0 ? (
            <button className="pcf-btn ghost" onClick={() => setStep((s) => s - 1)}>
              → הקודם
            </button>
          ) : (
            <span />
          )}
          {!isFilesStep ? (
            <button
              className="pcf-btn"
              onClick={() => {
                saveDraft();
                setStep((s) => s + 1);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              הבא ←
            </button>
          ) : (
            <button className="pcf-btn" onClick={submit} disabled={submitBusy || Object.keys(uploading).length > 0}>
              {submitBusy ? (
                <>
                  <span className="pcf-spin" /> שולח… זה לוקח כמה שניות
                </>
              ) : (
                "שליחת השאלון 🚀"
              )}
            </button>
          )}
        </div>
      </div>

      <div className="pcf-foot">דין ומיק • פאוור קאפל © 2026</div>
    </main>
  );
}
