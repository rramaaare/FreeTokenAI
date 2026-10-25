// ponytail: rakit paket upload cPanel Node.js App dari hasil `next build` (output: standalone).
// Hasil: deploy/cpanel.zip berisi server.js, .next, node_modules minimal, public, drizzle, scripts.
// Pakai: npm run build && node scripts/build-cpanel.mjs
import { cpSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SA = ".next/standalone";
if (!existsSync(`${SA}/server.js`)) {
  console.error("Belum ada .next/standalone/server.js — jalankan `npm run build` dulu.");
  process.exit(1);
}

// standalone tidak menyalin aset statis, public, dan file migrasi.
cpSync(".next/static", `${SA}/.next/static`, { recursive: true });
if (existsSync("public")) cpSync("public", `${SA}/public`, { recursive: true });
cpSync("drizzle", `${SA}/drizzle`, { recursive: true });
mkdirSync(`${SA}/scripts`, { recursive: true });
for (const f of ["db-migrate.mjs", "db-seed.mjs", "create-admin.mjs", "gen-encryption-key.mjs"]) cpSync(`scripts/${f}`, `${SA}/scripts/${f}`);
// .env lokal jangan ikut terupload — env diisi di form cPanel.
for (const f of [".env", ".env.local"]) rmSync(`${SA}/${f}`, { force: true });

mkdirSync("deploy", { recursive: true });
rmSync("deploy/cpanel.zip", { force: true });
execFileSync("tar", ["-a", "-c", "-f", "../../deploy/cpanel.zip", "."], { cwd: SA, stdio: "inherit" });
console.log("OK: deploy/cpanel.zip");
