// equipment-status.js (AUTO API BASE FIX + in_use support)

function $id(id) { return document.getElementById(id); }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function fmtNum(n) {
  const v = Number(n || 0);
  return v.toLocaleString("th-TH");
}
function setText(id, v) {
  const el = $id(id);
  if (el) el.textContent = v;
}

let API_BASE = null;

// ✅ ลองหา base ที่ถูกต้องอัตโนมัติ
async function detectApiBase() {
  const candidates = [
    "api/",                                  // ✅ กรณีอยู่ใน /executive/ แล้ว api อยู่ในโฟลเดอร์เดียวกัน
    "./api/",
    "../api/",
    "/sports_rental_system/executive/api/",  // ✅ ที่เคยใช้
    "/executive/api/",
    "/api/"
  ];

  for (const base of candidates) {
    try {
      const res = await fetch(base + "me.php", { credentials: "include" });
      // ถ้า 200 หรือ 401 แปลว่า path ถูก (ถึงจะยังไม่ login ก็ยังตอบ 401 ได้)
      if (res.status === 200 || res.status === 401) {
        API_BASE = base;
        console.log("[equipment-status] API_BASE =", API_BASE);
        return API_BASE;
      }
    } catch (_) {}
  }

  // fallback สุดท้าย
  API_BASE = "api/";
  console.warn("[equipment-status] Cannot detect API base, fallback to", API_BASE);
  return API_BASE;
}

async function apiGet(file, params) {
  if (!API_BASE) await detectApiBase();
  const qs = params ? new URLSearchParams(params).toString() : "";
  const url = API_BASE + file + (qs ? "?" + qs : "");
  const res = await fetch(url, { credentials: "include" });

  if (res.status === 401) return { __unauthorized: true };
  if (!res.ok) return { __error: true, status: res.status, url };
  try { return await res.json(); } catch { return { __error: true, status: "bad_json", url }; }
}

async function requireLogin() {
  const me = await apiGet("me.php");
  if (me && me.__unauthorized) {
    const back = encodeURIComponent(location.pathname.split("/").pop() || "equipment-status.html");
    location.href = "login.html?return=" + back;
    return false;
  }
  return true;
}

// ------- Filters -------
function getBranch() { return $id("branchSelect")?.value || "ALL"; }
function getSearch() { return ($id("qSearch")?.value || "").trim(); }
function getSelectedCategories() {
  const wrap = $id("categoryFilters");
  if (!wrap) return [];
  return Array.from(wrap.querySelectorAll("input[type=checkbox][data-cat]"))
    .filter(cb => cb.checked)
    .map(cb => cb.getAttribute("data-cat"))
    .filter(Boolean);
}
function buildParams() {
  const p = { branch_id: getBranch() };
  const s = getSearch();
  if (s) p.search = s;
  const cats = getSelectedCategories();
  if (cats.length) p.categories = cats.join(",");
  return p;
}

function renderBranches(meta) {
  const sel = $id("branchSelect");
  if (!sel) return;
  const keep = sel.value || "ALL";
  const bs = meta?.branches || [];
  sel.innerHTML = `<option value="ALL">ทั้งหมด</option>` + bs.map(b =>
    `<option value="${esc(b.branch_id)}">${esc(b.branch_id)} • ${esc(b.name)}</option>`
  ).join("");
  sel.value = (Array.from(sel.options).some(o => o.value === keep)) ? keep : "ALL";
}

function renderCategoryFilters(categories) {
  const wrap = $id("categoryFilters");
  if (!wrap) return;

  const keep = new Set(getSelectedCategories());
  const list = (categories || []).filter(Boolean);

  if (!list.length) {
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:800;">ไม่พบหมวดหมู่</div>`;
    return;
  }

  wrap.innerHTML = list.map(cat => {
    const checked = keep.size ? keep.has(cat) : true;
    return `
      <label style="display:flex;align-items:center;gap:10px;margin:8px 0;font-weight:900;color:#111827;">
        <input type="checkbox" data-cat="${esc(cat)}" ${checked ? "checked" : ""} />
        <span>${esc(cat)}</span>
      </label>
    `;
  }).join("");
}

// ------- Cards -------
function renderCards(cards) {
  setText("cTotal",  fmtNum(cards?.total ?? 0));
  setText("cReady",  fmtNum(cards?.ready ?? 0));
  // ✅ ถ้า API ไม่ส่ง in_use มา จะเป็น 0 ไม่ใช่ "-"
  setText("cInUse",  fmtNum(cards?.in_use ?? 0));
  setText("cWorn",   fmtNum(cards?.worn ?? 0));
  setText("cBroken", fmtNum(cards?.broken ?? 0));
  setText("cMaint",  fmtNum(cards?.maint ?? 0));
}

// ------- Top5 -------
function renderTop5(items, mode) {
  const wrap = $id("top5List");
  if (!wrap) return;

  const title = $id("top5Title");
  if (title) {
    title.textContent = (mode === "usage")
      ? "อุปกรณ์ที่ถูกใช้งานมากสุด Top 5"
      : "อุปกรณ์ที่มีปัญหาบ่อย Top 5";
  }

  if (!items || !items.length) {
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:800;">ไม่มีข้อมูล</div>`;
    return;
  }

  wrap.innerHTML = items.slice(0, 5).map((it, idx) => `
    <div style="display:flex;justify-content:space-between;align-items:center;border:1px solid #eef0f4;border-radius:14px;padding:12px 14px;background:#fff;margin-bottom:10px;">
      <div style="display:flex;gap:12px;align-items:flex-start;">
        <div style="font-weight:900;color:#f97316;">#${idx + 1}</div>
        <div>
          <div style="font-weight:900;color:#111827;">${esc(it.name || it.equipment_name || "-")}</div>
          <div style="font-size:12px;color:#6b7280;font-weight:800;margin-top:2px;">${esc(it.category || "-")}</div>
        </div>
      </div>
      <div style="font-weight:900;color:#111827;">${fmtNum(it.issue_count || it.issues || 0)}</div>
    </div>
  `).join("");
}

// ------- Tables -------
function renderGroupedTables(groups) {
  const wrap = $id("groupTables");
  if (!wrap) return;

  if (!groups || !groups.length) {
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:800;">ไม่พบรายการอุปกรณ์</div>`;
    return;
  }

  wrap.innerHTML = groups.map(g => {
    const rows = g.items || [];
    return `
      <div style="border:1px solid #eef0f4;border-radius:16px;background:#fff;overflow:hidden;margin-bottom:14px;">
        <div style="padding:12px 14px;font-weight:900;background:#f9fafb;">
          ${esc(g.category || "ไม่ระบุหมวดหมู่")}
          <span style="color:#6b7280;font-weight:800;">(${fmtNum(rows.length)})</span>
        </div>
        <div style="overflow:auto;">
          <table style="width:100%;border-collapse:collapse;min-width:840px;">
            <thead>
              <tr style="text-align:left;background:#fff;">
                <th style="padding:10px 12px;border-bottom:1px solid #eef0f4;">รหัสอุปกรณ์</th>
                <th style="padding:10px 12px;border-bottom:1px solid #eef0f4;">ชื่ออุปกรณ์</th>
                <th style="padding:10px 12px;border-bottom:1px solid #eef0f4;">สาขา</th>
                <th style="padding:10px 12px;border-bottom:1px solid #eef0f4;">สถานะ</th>
                <th style="padding:10px 12px;border-bottom:1px solid #eef0f4;">ตำแหน่ง</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-weight:900;">${esc(r.instance_code || r.code || "-")}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;">${esc(r.equipment_name || r.name || "-")}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;">${esc(r.branch_id || "-")}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;">${esc(r.status || "-")}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;">${esc(r.current_location || r.location || "-")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join("");
}

// ------- Chart -------
let chartStack = null;
function destroyChart(ch){ try{ ch?.destroy?.(); }catch{} return null; }

function renderStackChart(rows) {
  const c = $id("chartStack");
  if (!c) return;
  if (!window.Chart) return;

  const labels = (rows || []).map(r => r.category);
  if (!labels.length) return;

  const ds = [
    { key: "ready",  label: "พร้อมใช้งาน" },
    { key: "in_use", label: "กำลังใช้งาน" },
    { key: "worn",   label: "เสื่อมสภาพ" },
    { key: "broken", label: "ชำรุด" },
    { key: "maint",  label: "กำลังซ่อมแซม" },
  ].map(x => ({
    label: x.label,
    data: (rows || []).map(r => Number(r[x.key] || 0)),
    borderWidth: 1,
    borderRadius: 6,
  }));

  chartStack = destroyChart(chartStack);
  chartStack = new Chart(c.getContext("2d"), {
    type: "bar",
    data: { labels, datasets: ds },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }
      },
      plugins: { legend: { position: "bottom" } }
    }
  });
}

// ------- Load -------
async function loadMeta() {
  const meta = await apiGet("get_meta.php");
  if (!meta || meta.__error || !meta.success) return;
  renderBranches(meta);
}

async function loadData() {
  const params = buildParams();
  const res = await apiGet("get_equipment_status_summary.php", params);

  if (res && res.__unauthorized) return; // requireLogin handle
  if (!res || res.__error || !res.success) {
    console.warn("API error:", res);
    renderCards({ total:0, ready:0, in_use:0, worn:0, broken:0, maint:0 });
    renderTop5([], "issue");
    renderGroupedTables([]);
    return;
  }

  // categories
  if (Array.isArray(res.categories)) renderCategoryFilters(res.categories);
  else if (Array.isArray(res.by_category)) renderCategoryFilters(res.by_category.map(x => x.category));

  renderCards(res.cards);
  renderStackChart(res.by_category || []);
  renderTop5(res.top5 || [], res.top5_mode || "issue");
  renderGroupedTables(res.groups || []);
}

let t = null;
function debounceLoad() {
  clearTimeout(t);
  t = setTimeout(loadData, 250);
}

function bindEvents() {
  $id("branchSelect")?.addEventListener("change", loadData);
  $id("qSearch")?.addEventListener("input", debounceLoad);
  $id("categoryFilters")?.addEventListener("change", loadData);
}

document.addEventListener("DOMContentLoaded", async () => {
  await detectApiBase();
  const ok = await requireLogin();
  if (!ok) return;
  await loadMeta();
  bindEvents();
  await loadData();
});