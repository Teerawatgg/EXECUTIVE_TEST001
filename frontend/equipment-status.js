// equipment-status.js (RADIO category filter - BUGFIX)
// ✅ ใช้ selectedCategory เป็น state กันการเลือกหลุดตอน render ใหม่
// ✅ ส่ง categories=... ไป API ได้ถูกต้อง

function $id(id) { return document.getElementById(id); }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function fmtNum(n){ return Number(n || 0).toLocaleString("th-TH"); }
function setText(id, v){ const el=$id(id); if(el) el.textContent = v; }

const API_BASE = "/sports_rental_system/executive/api/";

// ✅ STATE: หมวดหมู่ที่เลือก
let selectedCategory = "ALL";

async function apiGet(file, params) {
  const qs = params ? new URLSearchParams(params).toString() : "";
  const url = API_BASE + file + (qs ? "?" + qs : "");
  const res = await fetch(url, { credentials: "include" });

  if (res.status === 401) return { __unauthorized: true };
  if (!res.ok) return { __error: true, status: res.status, url };
  try { return await res.json(); }
  catch { return { __error: true, status: "bad_json", url }; }
}

async function requireLogin() {
  const me = await apiGet("me.php");
  if (me && (me.__unauthorized || me.success === false)) {
    const back = encodeURIComponent(location.pathname.split("/").pop() || "equipment-status.html");
    location.href = "login.html?return=" + back;
    return false;
  }
  return true;
}

/* ---------- Filters ---------- */
function getBranch(){ return $id("branchSelect")?.value || "ALL"; }
function getSearch(){ return ($id("qSearch")?.value || "").trim(); }

function syncSelectedCategoryFromDOM() {
  const wrap = $id("categoryFilters");
  if (!wrap) return;
  const picked = wrap.querySelector('input[type="radio"][name="category"]:checked');
  if (!picked) { selectedCategory = "ALL"; return; }
  selectedCategory = (picked.value || "ALL").trim() || "ALL";
}

function buildParams() {
  const p = { branch_id: getBranch() };

  const s = getSearch();
  if (s) p.search = s;

  // ✅ ใช้ state เสมอ
  if (selectedCategory && selectedCategory !== "ALL") {
    p.categories = selectedCategory;
  }

  return p;
}

function renderBranches(meta) {
  const sel = $id("branchSelect");
  if (!sel) return;

  const keep = sel.value || "ALL";
  const bs = meta?.branches || [];

  sel.innerHTML =
    `<option value="ALL">ทั้งหมด</option>` +
    bs.map(b => `<option value="${esc(b.branch_id)}">${esc(b.branch_id)} • ${esc(b.name)}</option>`).join("");

  sel.value = (Array.from(sel.options).some(o => o.value === keep)) ? keep : "ALL";
}

/* ---------- Category Filters (RADIO) ---------- */
function renderCategoryFilters(categories) {
  const wrap = $id("categoryFilters");
  if (!wrap) return;

  const list = (categories || []).filter(Boolean);

  if (!list.length) {
    wrap.innerHTML = `<div class="muted-placeholder">ไม่พบหมวดหมู่</div>`;
    return;
  }

  // ถ้าหมวดที่เลือกไม่อยู่ใน list (เช่นเปลี่ยนสาขา) -> กลับ ALL
  if (selectedCategory !== "ALL" && !list.includes(selectedCategory)) {
    selectedCategory = "ALL";
  }

  wrap.innerHTML =
    `
      <label class="check-row" style="font-weight:900;">
        <input type="radio" name="category" value="ALL" ${selectedCategory === "ALL" ? "checked" : ""} />
        <span>ทั้งหมด</span>
      </label>
    ` +
    list.map(cat => `
      <label class="check-row" style="font-weight:900;">
        <input type="radio" name="category" value="${esc(cat)}" ${selectedCategory === cat ? "checked" : ""} />
        <span>${esc(cat)}</span>
      </label>
    `).join("");
}

/* ---------- Cards ---------- */
function renderCards(cards) {
  setText("cTotal",  fmtNum(cards?.total ?? 0));
  setText("cReady",  fmtNum(cards?.ready ?? 0));
  setText("cInUse",  fmtNum(cards?.in_use ?? 0));
  setText("cWorn",   fmtNum(cards?.worn ?? 0));
  setText("cBroken", fmtNum(cards?.broken ?? 0));
  setText("cMaint",  fmtNum(cards?.maint ?? 0));
}

/* ---------- Top5 ---------- */
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
    wrap.className = "topList";
    wrap.innerHTML = `<div class="muted">ไม่มีข้อมูล</div>`;
    return;
  }

  wrap.className = "topList";
  wrap.innerHTML = items.slice(0, 5).map((it, idx) => `
    <div class="topItem">
      <div class="topLeft">
        <div class="rank">#${idx + 1}</div>
        <div style="min-width:0;">
          <div class="topName">${esc(it.name || it.equipment_name || "-")}</div>
          <div class="topSub">${esc(it.category || "-")}</div>
        </div>
      </div>
      <div class="badgeRed">${fmtNum(it.issue_count || it.issues || 0)}</div>
    </div>
  `).join("");
}

/* ---------- Tables ---------- */
function renderGroupedTables(groups) {
  const wrap = $id("groupTables");
  if (!wrap) return;

  if (!groups || !groups.length) {
    wrap.innerHTML = `<div class="muted">ไม่พบรายการอุปกรณ์</div>`;
    return;
  }

  wrap.innerHTML = groups.map(g => {
    const rows = g.items || [];
    return `
      <div class="es-group-card">
        <div class="es-group-head">
          ${esc(g.category || "ไม่ระบุหมวดหมู่")}
          <span class="es-group-count">(${fmtNum(rows.length)})</span>
        </div>

        <div class="es-table-wrap">
          <table class="es-table">
            <thead>
              <tr>
                <th>รหัสอุปกรณ์</th>
                <th>ชื่ออุปกรณ์</th>
                <th>สาขา</th>
                <th>สถานะ</th>
                <th>ตำแหน่ง</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td class="es-td-strong">${esc(r.instance_code || r.code || "-")}</td>
                  <td>${esc(r.equipment_name || r.name || "-")}</td>
                  <td>${esc(r.branch_id || "-")}</td>
                  <td>${esc(r.status || "-")}</td>
                  <td>${esc(r.current_location || r.location || "-")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join("");
}

/* ---------- Chart ---------- */
let chartStack = null;
function destroyChart(ch){ try{ ch?.destroy?.(); }catch{} return null; }

function renderStackChart(rows) {
  const c = $id("chartStack");
  if (!c || !window.Chart) return;

  const labels = (rows || []).map(r => r.category);
  if (!labels.length) return;

  const ds = [
    { key:"ready",  label:"พร้อมใช้งาน" },
    { key:"in_use", label:"กำลังใช้งาน" },
    { key:"worn",   label:"เสื่อมสภาพ" },
    { key:"broken", label:"ชำรุด" },
    { key:"maint",  label:"กำลังซ่อมแซม" }
  ].map(x => ({
    label: x.label,
    data: (rows || []).map(r => Number(r[x.key] || 0)),
    borderWidth: 1,
    borderRadius: 6
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

/* ---------- Load ---------- */
async function loadMeta() {
  const meta = await apiGet("get_meta.php");
  if (!meta || meta.__error || !meta.success) return;
  renderBranches(meta);
}

async function loadData() {
  const params = buildParams();
  const res = await apiGet("get_equipment_status_summary.php", params);

  if (res && res.__unauthorized) return;

  if (!res || res.__error || !res.success) {
    console.warn("API error:", res);
    renderCards({ total:0, ready:0, in_use:0, worn:0, broken:0, maint:0 });
    renderTop5([], "issue");
    renderGroupedTables([]);
    return;
  }

  const cats = Array.isArray(res.categories)
    ? res.categories
    : (Array.isArray(res.by_category) ? res.by_category.map(x => x.category) : []);

  // ✅ render filter ตาม state (ไม่ทำให้ state หลุด)
  renderCategoryFilters(cats);

  renderCards(res.cards);
  renderStackChart(res.by_category || []);
  renderTop5(res.top5 || [], res.top5_mode || "issue");
  renderGroupedTables(res.groups || []);
}

let t = null;
function debounceLoad(){
  clearTimeout(t);
  t = setTimeout(loadData, 250);
}

function bindEvents() {
  $id("branchSelect")?.addEventListener("change", () => {
    // เปลี่ยนสาขาแล้วกลับ ALL กันหมวดไม่ตรงสาขา
    selectedCategory = "ALL";
    loadData();
  });

  $id("qSearch")?.addEventListener("input", debounceLoad);

  // ✅ radio change: อัปเดต state แล้วโหลด
  $id("categoryFilters")?.addEventListener("change", () => {
    syncSelectedCategoryFromDOM();
    loadData();
  });
}

// Boot
document.addEventListener("DOMContentLoaded", async () => {
  const ok = await requireLogin();
  if (!ok) return;

  await loadMeta();
  bindEvents();
  await loadData();
});