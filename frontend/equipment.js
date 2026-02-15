/* executive/equipment.js (REWRITE)
   - Uses: get_equipment_overview.php
   - Safe JSON parse (กัน server ส่ง HTML error)
   - Render: summary cards + left filters + grouped tables (if placeholders exist)
*/

function $id(id) { return document.getElementById(id); }

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtDateTH(d) {
  if (!d) return "-";
  // รองรับ "YYYY-MM-DD" หรือ datetime
  const x = String(d).slice(0, 10);
  const [y, m, day] = x.split("-").map(v => parseInt(v, 10));
  if (!y || !m || !day) return x;
  // แสดง พ.ศ.
  return `${day} ${["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"][m-1]} ${y + 543}`;
}

function statusBadge(status) {
  const s = String(status || "").toUpperCase();
  if (s === "AVAILABLE") return `<span class="badge ok">ว่าง</span>`;
  if (s === "IN_USE") return `<span class="badge use">กำลังใช้งาน</span>`;
  if (s === "BROKEN") return `<span class="badge bad">ชำรุด</span>`;
  if (s === "MAINTENANCE") return `<span class="badge warn">ซ่อมบำรุง</span>`;
  return `<span class="badge">${esc(status || "-")}</span>`;
}

function usageText(it) {
  const uc = it.usage_count;
  const ul = it.usage_limit;
  if (typeof uc === "number" && typeof ul === "number" && ul > 0) {
    return `${uc.toLocaleString("th-TH")}/${ul.toLocaleString("th-TH")} ครั้ง`;
  }
  return "-";
}

// ---------- safe fetch JSON ----------
async function apiGetSafe(file, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = "/sports_rental_system/executive/api/" + file + (qs ? "?" + qs : "");
  const r = await fetch(url, { credentials: "include" });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("[equipment] invalid JSON:", text);
    return { success: false, error: "Invalid JSON", detail: text };
  }
}

// ---------- read UI filters ----------
function readFilters() {
  const search = ($id("search")?.value || "").trim();

  // categories: checkbox name="cat"
  const catChecked = Array.from(document.querySelectorAll('input[name="cat"]:checked'))
    .map(x => x.value)
    .filter(Boolean);

  // statuses: checkbox name="st"
  const stChecked = Array.from(document.querySelectorAll('input[name="st"]:checked'))
    .map(x => x.value)
    .filter(Boolean);

  const p = {};
  if (search) p.search = search;
  if (catChecked.length) p.categories = catChecked.join(",");
  if (stChecked.length) p.statuses = stChecked.join(",");

  return p;
}

// ---------- render left filters ----------
function renderCategoryList(categories) {
  const box = $id("categoryList");
  if (!box) return;

  if (!categories || !categories.length) {
    box.innerHTML = `<div class="muted">ไม่พบหมวดหมู่</div>`;
    return;
  }

  box.innerHTML = categories.map(c => {
    const id = c.category_id ?? "";
    const name = c.category_name ?? "-";
    const total = Number(c.total || 0);
    return `
      <label class="chkRow">
        <input type="checkbox" name="cat" value="${esc(id)}">
        <span class="chkName">${esc(name)}</span>
        <span class="chkCount">(${total.toLocaleString("th-TH")})</span>
      </label>
    `;
  }).join("");
}

function renderStatusList(summary) {
  const box = $id("statusList");
  if (!box) return;

  const total = Number(summary?.total || 0);
  const available = Number(summary?.available || 0);
  const inUse = Number(summary?.in_use || 0);
  const broken = Number(summary?.broken || 0);

  box.innerHTML = `
    <label class="chkRow">
      <input type="checkbox" name="st" value="AVAILABLE">
      <span class="chkName">ว่าง</span>
      <span class="chkCount">(${available.toLocaleString("th-TH")})</span>
    </label>
    <label class="chkRow">
      <input type="checkbox" name="st" value="IN_USE">
      <span class="chkName">กำลังใช้งาน</span>
      <span class="chkCount">(${inUse.toLocaleString("th-TH")})</span>
    </label>
    <label class="chkRow">
      <input type="checkbox" name="st" value="BROKEN">
      <span class="chkName">ชำรุด</span>
      <span class="chkCount">(${broken.toLocaleString("th-TH")})</span>
    </label>
    <div class="muted" style="margin-top:8px;">รวม: ${total.toLocaleString("th-TH")} ชิ้น</div>
  `;
}

// ---------- render KPI cards ----------
function setText(id, v) {
  const el = $id(id);
  if (el) el.textContent = v ?? "-";
}

function renderKPI(summary) {
  if (!summary) return;
  setText("kpiTotal", Number(summary.total || 0).toLocaleString("th-TH"));
  setText("kpiAvailable", Number(summary.available || 0).toLocaleString("th-TH"));
  setText("kpiInUse", Number(summary.in_use || 0).toLocaleString("th-TH"));
  setText("kpiBroken", Number(summary.broken || 0).toLocaleString("th-TH"));
}

// ---------- render groups (tables) ----------
function renderGroups(groups) {
  const wrap = $id("groupsWrap");
  if (!wrap) return;

  if (!groups || !groups.length) {
    wrap.innerHTML = `<div class="muted" style="font-weight:800;">ไม่พบข้อมูล</div>`;
    return;
  }

  wrap.innerHTML = groups.map(g => {
    const title = g.category_name || "-";
    const total = Number(g.total || 0);

    const rows = (g.items || []).map(it => `
      <tr>
        <td class="code">${esc(it.code || "-")}</td>
        <td>${esc(it.name || "-")}</td>
        <td>${statusBadge(it.status)}</td>
        <td class="right">${esc(usageText(it))}</td>
        <td class="center">${esc(fmtDateTH(it.received_date))}</td>
        <td class="center">${esc(fmtDateTH(it.expiry_date))}</td>
      </tr>
    `).join("");

    return `
      <div class="groupCard">
        <div class="groupHead">
          <div>
            <div class="groupTitle">${esc(title)}</div>
            <div class="muted">${total.toLocaleString("th-TH")} รายการ</div>
          </div>
        </div>

        <div class="tableWrap">
          <table class="table">
            <thead>
              <tr>
                <th style="width:110px;">รหัส</th>
                <th>ชื่ออุปกรณ์</th>
                <th style="width:140px;">สถานะ</th>
                <th style="width:140px;" class="right">การใช้งาน</th>
                <th style="width:160px;" class="center">วันที่ซื้อ</th>
                <th style="width:160px;" class="center">วันหมดอายุ</th>
              </tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="6" class="muted">ไม่มีรายการ</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    `;
  }).join("");
}

// ---------- fallback for old table page ----------
function renderOldTableFallbackError(msg) {
  const tb = $id("tbody");
  if (!tb) return;
  tb.innerHTML = `<tr><td colspan="5" style="color:#b91c1c;font-weight:800;">${esc(msg || "โหลดข้อมูลไม่สำเร็จ")}</td></tr>`;
}

// ---------- main load ----------
async function loadOverview() {
  const params = readFilters();

  const res = await apiGetSafe("get_equipment_overview.php", params);
  console.log("[equipment] API response:", res);

  if (!res || !res.success) {
    const err = res?.message || res?.error || "โหลดข้อมูลไม่สำเร็จ";
    // show message area if exists
    const msg = $id("loadError");
    if (msg) msg.textContent = err;

    renderOldTableFallbackError(err);
    return;
  }

  // overview mode
  renderKPI(res.summary);
  renderCategoryList(res.categories);
  renderStatusList(res.summary);
  renderGroups(res.groups);

  // clear error if any
  const msg = $id("loadError");
  if (msg) msg.textContent = "";
}

function bindUI() {
  $id("btnApply")?.addEventListener("click", loadOverview);
  $id("btnReset")?.addEventListener("click", () => location.reload());

  $id("search")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadOverview();
  });

  // print (ถ้ามี id)
  $id("btnPrint")?.addEventListener("click", () => window.print());

  // auto apply when toggle checkboxes
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (!t) return;
    if (t.matches('input[name="cat"], input[name="st"]')) {
      loadOverview();
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  // ถ้าโปรเจคคุณใช้ ExecCommon.requireExecutive()
  if (window.ExecCommon?.requireExecutive) {
    const ok = await ExecCommon.requireExecutive();
    if (!ok) return;
  }

  bindUI();
  loadOverview();
});