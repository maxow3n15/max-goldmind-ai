// "Remember me" handling.
//
// Supabase persists the session in localStorage by default, which would keep a
// user signed in across browser sessions. GoldMind AI only allows that when the
// user explicitly ticked "Remember me". Otherwise the stored session is treated
// as tab-scoped: it is cleared when the tab closes and purged on the next
// visit, so the login screen is always shown again.
//
// Passwords are never stored — only the Supabase-issued session token, and only
// with explicit consent.

const FLAG = "goldmind.remember_me";
const TAB_FLAG = "goldmind.session_active"; // sessionStorage: survives reloads, not browser restarts

export function setRememberMe(remember: boolean) {
  try {
    if (remember) {
      localStorage.setItem(FLAG, "1");
      sessionStorage.removeItem(TAB_FLAG);
    } else {
      localStorage.removeItem(FLAG);
      sessionStorage.setItem(TAB_FLAG, "1");
    }
  } catch {
    /* storage unavailable */
  }
}

export function getRememberMe(): boolean {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

function hasActiveTabSession(): boolean {
  try {
    return sessionStorage.getItem(TAB_FLAG) === "1";
  } catch {
    return false;
  }
}

function supabaseAuthKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
  } catch {
    return [];
  }
}

function clearStoredSession() {
  for (const key of supabaseAuthKeys()) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Removes any persisted session that was NOT explicitly consented to.
 * Returns true when a session was purged (caller should treat user as signed out).
 * Safe to call on every app start / route guard.
 */
export function purgeUnconsentedSession(): boolean {
  if (typeof window === "undefined") return false;
  if (getRememberMe()) return false; // user opted in — keep the session
  if (hasActiveTabSession()) return false; // signed in during this browser session
  if (supabaseAuthKeys().length === 0) return false;
  clearStoredSession();
  return true;
}

/** Call once on app start (browser only). */
export function installSessionPersistence() {
  if (typeof window === "undefined") return;
  const handler = () => {
    if (getRememberMe()) return;
    clearStoredSession();
  };
  window.addEventListener("pagehide", handler);
}
