// Regression gate for the Phase 0 exposure: a scheduler/API secret must never
// be written as a literal into a migration again.
//
// The two files in KNOWN_EXPOSED contained the pre-rotation autopilot secret.
// That value has since been rotated and is dead, and applied migration files
// are never edited in place, so they are recorded here rather than rewritten.
// Any *other* migration containing a secret-shaped literal fails this test.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "supabase", "migrations");

const KNOWN_EXPOSED = new Set([
  "20260803210536_4c91ee96-ae70-4fa2-8ded-7109d2aa7521.sql",
  "20260803210609_41a26c05-5067-42cc-a5e4-492a0f5bc48d.sql",
]);

/** Long hex/base64-ish runs and obvious key prefixes. */
const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "long hex literal", re: /['"][0-9a-f]{32,}['"]/i },
  { name: "jwt", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
  { name: "supabase secret key", re: /sb_secret_[A-Za-z0-9_-]{8,}/ },
  { name: "service role key", re: /service_role_key\s*[:=]\s*['"][^'"]{20,}['"]/i },
  { name: "inline cron secret header", re: /x-cron-secret"\s*:\s*"[^"]{8,}"/i },
];

describe("migration secret scanning", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));

  it("finds migration files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const label = KNOWN_EXPOSED.has(file) ? `${file} (known, rotated)` : file;
    it(`contains no secret-shaped literal: ${label}`, () => {
      const sql = readFileSync(join(DIR, file), "utf8");
      const hits = PATTERNS.filter((p) => p.re.test(sql)).map((p) => p.name);
      if (KNOWN_EXPOSED.has(file)) {
        // Documented historical exposure; asserted so the list stays accurate.
        expect(hits.length).toBeGreaterThan(0);
        return;
      }
      expect(hits).toEqual([]);
    });
  }

  it("the rotation migration does not embed the new secret", () => {
    const rotations = files
      .map((f) => readFileSync(join(DIR, f), "utf8"))
      .filter((sql) => sql.includes("autopilot_cron_secret"));
    expect(rotations.length).toBeGreaterThan(0);
    for (const sql of rotations) {
      expect(sql).toMatch(/gen_random_bytes/);
      expect(/['"][0-9a-f]{32,}['"]/i.test(sql)).toBe(false);
    }
  });
});
