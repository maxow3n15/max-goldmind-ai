// "Remember me" handling.
//
// Supabase persists the session in localStorage by default, which keeps the
// user signed in across browser sessions. When the user does NOT tick
// "Remember me" we downgrade that to a per-tab session: the stored session is
// cleared when the tab closes, so the next visit requires signing in again.
// Passwords are never stored — only the Supabase-issued session token.

const FLAG = "goldmind.remember_me";

export function setRememberMe(remember: boolean) {
  try {
    if (remember) localStorage.setItem(FLAG, "1");
    else localStorage.removeItem(FLAG);
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

function supabaseAuthKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
  } catch {
    return [];
  }
}

/** Call once on app start (browser only). */
export function installSessionPersistence() {
  if (typeof window === "undefined") return;
  const handler = () => {
    if (getRememberMe()) return;
    for (const key of supabaseAuthKeys()) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
  };
  window.addEventListener("pagehide", handler);
}
