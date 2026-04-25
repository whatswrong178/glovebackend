/**
 * test-supabase.mjs — Supabase 连通性快速验证脚本
 * 运行方式: node test-supabase.mjs
 * 无需安装任何依赖，使用 Node.js 内置 fetch（v18+）
 */

const SUPABASE_URL      = "https://futwxbtfgvpeipmddbdt.supabase.co";
const ANON_KEY          = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1dHd4YnRmZ3ZwZWlwbWRkYmR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NzE1NjAsImV4cCI6MjA5MjU0NzU2MH0.mkdDZh2goVpdBA6kpX2t70WhsVxS3DRdWb5ASkEhRsw";
const SERVICE_ROLE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1dHd4YnRmZ3ZwZWlwbWRkYmR0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njk3MTU2MCwiZXhwIjoyMDkyNTQ3NTYwfQ.g2-c-mahzlXqE06HLsSfByB5gdMIQCLdNuhHppYBfJ4";

const HEADERS_ANON = {
  "apikey":        ANON_KEY,
  "Authorization": `Bearer ${ANON_KEY}`,
  "Content-Type":  "application/json",
};

const HEADERS_SVC = {
  "apikey":        SERVICE_ROLE_KEY,
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type":  "application/json",
};

let pass = 0, fail = 0;

function ok(label, note = "") {
  pass++;
  console.log(`  ✅ ${label}${note ? "  →  " + note : ""}`);
}

function err(label, note = "") {
  fail++;
  console.error(`  ❌ ${label}${note ? "  →  " + note : ""}`);
}

// ── Helper ──────────────────────────────────────────────────────────────────
async function rest(path, headers = HEADERS_ANON, method = "GET", body = null) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}${path}`, opts);
  let data;
  try { data = await res.json(); } catch { data = await res.text(); }
  return { status: res.status, data };
}

// ── Tests ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n══════════════════════════════════════════════");
  console.log("  MediGlove ERP — Supabase Connection Test");
  console.log("  Project: futwxbtfgvpeipmddbdt");
  console.log("══════════════════════════════════════════════\n");

  // ── 1. REST API root ping ───────────────────────────────────────────────
  console.log("[1/6] REST API 根端点 ping...");
  try {
    const { status } = await rest("/rest/v1/");
    // 200 = tables exist | 404 = no tables yet | 401 = API live, auth required (correct security posture)
    if ([200, 404, 401].includes(status)) {
      ok("REST API 可达", `HTTP ${status}${status === 401 ? " (anon 鉴权拦截，安全配置正常)" : ""}`);
    } else {
      err("REST API 异常", `HTTP ${status}`);
    }
  } catch (e) {
    err("REST API 无法连接", e.message);
  }

  // ── 2. Auth endpoint ────────────────────────────────────────────────────
  console.log("\n[2/6] Auth 服务验证...");
  try {
    const { status, data } = await rest("/auth/v1/settings", HEADERS_ANON);
    if (status === 200 && data?.external) {
      ok("Auth 服务正常", "邮箱登录已启用");
    } else if (status === 200) {
      ok("Auth 服务正常", `HTTP ${status}`);
    } else {
      err("Auth 服务异常", `HTTP ${status}: ${JSON.stringify(data).slice(0, 80)}`);
    }
  } catch (e) {
    err("Auth 连接失败", e.message);
  }

  // ── 3. Service Role 权限验证（查 auth.users） ────────────────────────────
  console.log("\n[3/6] Service Role 权限验证...");
  try {
    const { status, data } = await rest("/auth/v1/admin/users?page=1&per_page=1", HEADERS_SVC);
    if (status === 200) {
      ok("Service Role 有效", `auth.users 可查（现有 ${data?.users?.length ?? 0} 用户）`);
    } else {
      err("Service Role 权限不足", `HTTP ${status}: ${JSON.stringify(data).slice(0, 80)}`);
    }
  } catch (e) {
    err("Service Role 验证失败", e.message);
  }

  // ── 4. 检查迁移表是否存在 (staff table) ─────────────────────────────────
  console.log("\n[4/6] 检查 staff 表是否已迁移...");
  try {
    const { status, data } = await rest("/rest/v1/staff?select=id&limit=1", HEADERS_SVC);
    if (status === 200) {
      ok("staff 表已存在", `迁移文件已应用，当前记录数: ${Array.isArray(data) ? data.length : "?"}`);
    } else if (status === 404 || (Array.isArray(data) && data[0]?.code === "42P01")) {
      err("staff 表不存在", "请先运行 SQL 迁移文件（见步骤 STEP-3）");
    } else {
      err("staff 表查询异常", `HTTP ${status}: ${JSON.stringify(data).slice(0, 100)}`);
    }
  } catch (e) {
    err("staff 表查询失败", e.message);
  }

  // ── 5. 检查 system_params 种子数据 ──────────────────────────────────────
  console.log("\n[5/6] 检查 system_params 种子数据...");
  try {
    const { status, data } = await rest(
      "/rest/v1/system_params?select=key,value&limit=5",
      HEADERS_SVC
    );
    if (status === 200 && Array.isArray(data) && data.length > 0) {
      ok("system_params 种子数据存在", `找到 ${data.length} 条参数，首条: ${data[0].key}`);
    } else if (status === 200 && Array.isArray(data) && data.length === 0) {
      err("system_params 为空", "迁移文件可能未应用，或 INSERT 未执行");
    } else {
      err("system_params 查询异常", `HTTP ${status}`);
    }
  } catch (e) {
    err("system_params 查询失败", e.message);
  }

  // ── 6. Resend API key 格式验证（本地，不发送邮件） ──────────────────────
  console.log("\n[6/6] Resend API Key 格式校验...");
  const resendKey = "re_2iiRP8aG_MX3QDVkq8ZsGcRj6stcVmZeD";
  if (/^re_[A-Za-z0-9_]{20,}$/.test(resendKey)) {
    ok("Resend API Key 格式正确", `re_...${resendKey.slice(-6)}`);
  } else {
    err("Resend API Key 格式异常", "应以 re_ 开头");
  }

  // ── 报告 ─────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════");
  console.log(`  结果: ${pass} 通过 | ${fail} 失败`);
  console.log("══════════════════════════════════════════════\n");

  if (fail > 0) {
    console.log("⚠️  有失败项，请查看上方提示并执行对应步骤。");
    process.exit(1);
  } else {
    console.log("🎉 全部通过！环境配置正常，可以开始开发。");
  }
}

main().catch((e) => {
  console.error("脚本执行错误:", e);
  process.exit(1);
});
