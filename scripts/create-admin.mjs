// ponytail: buat/rehash satu super_admin produksi tanpa data demo db:seed.
// Pakai: node scripts/create-admin.mjs <email> <password> [nama]
// Butuh DATABASE_URL + ADMIN_PASSWORD_PEPPER yang SAMA dengan runtime.
import { readFileSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
import postgres from "postgres";

function loadEnv() {
  for (const f of [".env", ".env.local"]) {
    try {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && !(m[1] in process.env)) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
          process.env[m[1]] = v;
        }
      }
    } catch {
      // abaikan
    }
  }
}

loadEnv();
const [email, password, name = "Super Admin"] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error("Pakai: node scripts/create-admin.mjs <email> <password min 8 karakter> [nama]");
  process.exit(1);
}
const PEPPER = process.env.ADMIN_PASSWORD_PEPPER;
if (!process.env.DATABASE_URL || !PEPPER) {
  console.error("DATABASE_URL dan ADMIN_PASSWORD_PEPPER wajib di-set.");
  process.exit(1);
}

// ponytail: SALINAN adminHash di db-seed.mjs — format harus sama dengan lib admin-auth.
const salt = randomBytes(16);
const key = scryptSync(password + PEPPER, salt, 64, { N: 16384, r: 8, p: 1 });
const hash = `scrypt$1$${salt.toString("hex")}$${key.toString("hex")}`;

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql`
    INSERT INTO users (email, name, role, cafe_id, admin_password_hash)
    VALUES (${email}, ${name}, 'super_admin', NULL, ${hash})
    ON CONFLICT (email) DO UPDATE SET role = 'super_admin', cafe_id = NULL, admin_password_hash = EXCLUDED.admin_password_hash`;
  console.log(`OK: super_admin ${email}`);
} finally {
  await sql.end();
}
