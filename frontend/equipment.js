// executive/equipment.js (REWRITE - Status RADIO)
// ✅ สถานะอุปกรณ์เป็น Radio Button: ALL / Ready / Rented / Broken
// ✅ คลิกได้ทั้งแถว + จำค่าที่เลือกไว้ตอน re-render
// - Filters: branch / region / search / category(radio) / status(radio)

(function () {
  const API_BASE = "/sports_rental_system/executive/api/";
  const $id = (id) => document.getElementById(id);

  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const fmt = (n) => Number(n || 0).toLocaleString("th-TH");

  function fmtDateTH(d) {
    if (!d) return "-";
    const x = String(d).slice(0, 10);
    const [y, m, day] = x.split("-").map((v) => parseInt(v, 10));
    if (!y || !m || !day) return x;
    const months = [
      "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
      "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
    ];
    return `${day} ${months[m - 1]} ${y + 543}`;
  }

  function setText(id, v) {
    const el = $id(id);
    if (el) el.textContent = v ?? "-";
  }

  function showLoadingSidebar() {
    const cat = $id("catList");
    const st = $id("statusList");
    if (cat) cat.innerHTML = `<div style="color:#94a3b8;font-weight:900;">กำลังโหลด...</div>`;
    if (st) st.innerHTML = `<div style="color:#94a3b8;font-weight:900;">กำลังโหลด...</div>`;
  }

  function showLoadingMain() {
    const wrap = $id("groupsWrap");
    if (wrap) wrap.innerHTML = `<div style="color:#94a3b8;font-weight:900;">กำลังโหลด...</div>`;
  }

  function showError(message, detail) {
    const wrap = $id("groupsWrap");
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="color:#b91c1c;font-weight:900;">
        ${esc(message || "เกิดข้อผิดพลาด")}
        ${detail ? `<div style="margin-top:8px;color:#64748b;font-weight:800;white-space:pre-wrap;">${esc(detail)}</div>` : ""}
      </div>
    `;
  }

  async function apiGetJSON(file, params = {}) {
    if (window.ExecCommon && typeof ExecCommon.apiGet === "function") {
      try {
        const res = await ExecCommon.apiGet(file, params);
        if (res && typeof res === "object") return res;
      } catch (_) {}
    }

    const qs = new URLSearchParams(params || {}).toString();
    const url = API_BASE + file + (qs ? "?" + qs : "");
    const r = await fetch(url, { credentials: "include" });
    const text = await r.text();

    if (/^\s*</.test(text) || text.includes("<br") || text.includes("<b>")) {
      throw new Error(`API ส่ง HTML แทน JSON: ${file}`);
    }

    try { return JSON.parse(text); }
    catch { throw new Error(`JSON parse ไม่ได้: ${file}`); }
  }

  function statusPill(status) {
    const raw = String(status || "");
    const u = raw.trim().toUpperCase();

    const isAvail = u.includes("READY") || u.includes("AVAILABLE") || raw.includes("ว่าง") || raw.includes("พร้อม");
    const isUse = u.includes("RENT") || u.includes("BORROW") || u.includes("IN_USE") || u.includes("IN USE")
      || raw.includes("กำลัง") || raw.includes("ใช้งาน") || raw.includes("เช่า") || raw.includes("ยืม");
    const isBroken = u.includes("BROKEN") || u.includes("DAMAGE") || raw.includes("ชำรุด") || raw.includes("เสีย") || raw.includes("พัง") || raw.includes("เสียหาย");
    const isMaint = u.includes("MAINT") || u.includes("REPAIR") || raw.includes("ซ่อม");

    if (isAvail) return `<span class="pill ok">ว่าง</span>`;
    if (isUse) return `<span class="pill use">กำลังใช้งาน</span>`;
    if (isBroken) return `<span class="pill bad">ชำรุด</span>`;
    if (isMaint) return `<span class="pill maint">ซ่อมบำรุง</span>`;
    return `<span class="pill muted">${esc(raw || "-")}</span>`;
  }

  function readBranch() { return $id("branchSelect") ? ($id("branchSelect").value || "ALL") : "ALL"; }
  function readRegion() { return $id("regionSelect") ? ($id("regionSelect").value || "ALL") : "ALL"; }
  function readSearch() { return ($id("search")?.value || "").trim(); }

  function readCategory() {
    const wrap = $id("catList");
    const picked = wrap?.querySelector('input[name="cat"]:checked');
    return picked ? (picked.value || "ALL") : "ALL";
  }

  function readStatus() {
    const wrap = $id("statusList");
    const picked = wrap?.querySelector('input[name="st"]:checked');
    return picked ? (picked.value || "ALL") : "ALL";
  }

  function buildParams() {
    const params = { branch_id: readBranch(), region: readRegion() };

    const q = readSearch();
    if (q) params.search = q;

    const cat = readCategory();
    if (cat && cat !== "ALL") params.categories = cat;

    const st = readStatus();
    if (st && st !== "ALL") params.statuses = st;

    return params;
  }

  async function loadMeta() {
    const meta = await apiGetJSON("get_meta.php", {});
    if (!meta || !meta.success) return;

    const bs = $id("branchSelect");
    if (bs) {
      const keep = bs.value || "ALL";
      bs.innerHTML = `<option value="ALL">ทั้งหมด</option>` + (meta.branches || []).map((b) =>
        `<option value="${esc(b.branch_id)}">${esc(b.branch_id)} • ${esc(b.name)}</option>`
      ).join("");
      bs.value = keep;
    }

    const rs = $id("regionSelect");
    if (rs) {
      const keep = rs.value || "ALL";
      rs.innerHTML = `<option value="ALL">ทั้งหมด</option>` + (meta.regions || []).map((r) =>
        `<option value="${esc(r.region)}">${esc(r.region)}</option>`
      ).join("");
      rs.value = keep;
    }
  }

  function renderCategories(categories) {
    const wrap = $id("catList");
    if (!wrap) return;

    const totalAll = Array.isArray(categories) ? categories.reduce((s, c) => s + Number(c.total || 0), 0) : 0;

    const rows = [];
    rows.push(`
      <div class="chkRow">
        <label class="chkLeft">
          <input type="radio" name="cat" value="ALL" checked />
          <span>ทั้งหมด</span>
        </label>
        <span class="chkCount">(${fmt(totalAll)})</span>
      </div>
    `);

    if (Array.isArray(categories) && categories.length) {
      categories.forEach((c) => {
        const id = c.category_id ?? "";
        const name = c.category_name ?? id ?? "-";
        const total = Number(c.total || 0);
        rows.push(`
          <div class="chkRow">
            <label class="chkLeft">
              <input type="radio" name="cat" value="${esc(id)}" />
              <span>${esc(name)}</span>
            </label>
            <span class="chkCount">(${fmt(total)})</span>
          </div>
        `);
      });
    } else {
      rows.push(`<div class="muted" style="font-weight:900;">ไม่พบหมวดหมู่</div>`);
    }

    wrap.innerHTML = rows.join("");
    wrap.querySelectorAll('input[name="cat"]').forEach((el) => el.addEventListener("change", () => loadOverview()));
  }

  // ✅ สถานะเป็น RADIO + มี “ทั้งหมด”
  function renderStatuses(summary) {
    const wrap = $id("statusList");
    if (!wrap) return;

    const keep = readStatus() || "ALL";

    const s = summary || {};
    const total = Number(s.total || 0);
    const available = Number(s.available || 0);
    const inUse = Number(s.in_use || 0);
    const broken = Number(s.broken || 0);

    wrap.innerHTML = `
      <div class="chkRow" data-row="st">
        <label class="chkLeft">
          <input type="radio" name="st" value="ALL" ${keep === "ALL" ? "checked" : ""} />
          <span>ทั้งหมด</span>
        </label>
        <span class="chkCount">(${fmt(total)})</span>
      </div>

      <div class="chkRow" data-row="st">
        <label class="chkLeft">
          <input type="radio" name="st" value="Ready" ${keep === "Ready" ? "checked" : ""} />
          <span>ว่าง</span>
        </label>
        <span class="chkCount">(${fmt(available)})</span>
      </div>

      <div class="chkRow" data-row="st">
        <label class="chkLeft">
          <input type="radio" name="st" value="Rented" ${keep === "Rented" ? "checked" : ""} />
          <span>กำลังใช้งาน</span>
        </label>
        <span class="chkCount">(${fmt(inUse)})</span>
      </div>

      <div class="chkRow" data-row="st">
        <label class="chkLeft">
          <input type="radio" name="st" value="Broken" ${keep === "Broken" ? "checked" : ""} />
          <span>ชำรุด</span>
        </label>
        <span class="chkCount">(${fmt(broken)})</span>
      </div>

      <div class="muted" style="margin-top:8px;font-weight:900;">รวม: ${fmt(total)} ชิ้น</div>
    `;

    // ✅ คลิกทั้งแถวได้
    wrap.querySelectorAll(".chkRow[data-row='st']").forEach((row) => {
      row.addEventListener("click", (e) => {
        const rb = row.querySelector('input[name="st"]');
        if (!rb) return;
        if (e.target && e.target.tagName !== "INPUT") rb.checked = true;
        loadOverview();
      });
    });

    wrap.querySelectorAll('input[name="st"]').forEach((el) => el.addEventListener("change", () => loadOverview()));
  }

  function renderKPI(summary) {
    const s = summary || {};
    setText("kpiTotal", fmt(s.total || 0));
    setText("kpiAvailable", fmt(s.available || 0));
    setText("kpiInUse", fmt(s.in_use || 0));
    setText("kpiBroken", fmt(s.broken || 0));
  }

  function renderGroups(groups) {
    const wrap = $id("groupsWrap");
    if (!wrap) return;

    if (!Array.isArray(groups) || !groups.length) {
      wrap.innerHTML = `<div class="muted" style="font-weight:900;">ไม่พบข้อมูล</div>`;
      return;
    }

    wrap.innerHTML = groups.map((g) => {
      const title = g.category_name || "-";
      const total = Number(g.total || 0);

      const rows = (g.items || []).map((it) => `
        <tr>
          <td style="font-weight:900;">${esc(it.code || "-")}</td>
          <td>${esc(it.name || "-")}</td>
          <td class="tdC">${statusPill(it.status)}</td>
          <td class="tdC">${esc(fmtDateTH(it.received_date))}</td>
          <td class="tdC">${esc(fmtDateTH(it.expiry_date))}</td>
        </tr>
      `).join("");

      return `
        <div class="group">
          <div class="groupHead">
            <div>
              <div class="name">${esc(title)}</div>
              <div class="sub">${fmt(total)} รายการ</div>
            </div>
          </div>
          <div class="tableWrap">
            <table class="table">
              <thead>
                <tr>
                  <th style="width:120px;">รหัส</th>
                  <th>ชื่ออุปกรณ์</th>
                  <th style="width:150px;" class="tdC">สถานะ</th>
                  <th style="width:160px;" class="tdC">วันที่ซื้อ</th>
                  <th style="width:160px;" class="tdC">วันหมดอายุ</th>
                </tr>
              </thead>
              <tbody>
                ${rows || `<tr><td colspan="5" class="muted" style="font-weight:900;">ไม่มีรายการ</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join("");
  }

  let seq = 0;
  let booted = false;

  async function loadOverview() {
    const my = ++seq;
    showLoadingMain();

    const params = buildParams();

    try {
      const res = await apiGetJSON("get_equipment_overview.php", params);
      if (my !== seq) return;

      if (!res || !res.success) {
        showError("โหลดข้อมูลไม่สำเร็จ", JSON.stringify(res || {}, null, 2));
        return;
      }

      if (!booted) {
        renderCategories(res.categories);
        booted = true;
      }

      renderKPI(res.summary);
      renderStatuses(res.summary);
      renderGroups(res.groups);

    } catch (e) {
      if (my !== seq) return;

      try {
        const qs = new URLSearchParams(params).toString();
        const url = API_BASE + "get_equipment_overview.php" + (qs ? "?" + qs : "");
        const r = await fetch(url, { credentials: "include" });
        const t = await r.text();
        showError("API ผิดพลาด (ไม่ใช่ JSON หรือ Server Error)", `URL: ${url}\n\n--- response preview ---\n${t.slice(0, 300)}`);
      } catch {
        showError("โหลดข้อมูลไม่สำเร็จ", e?.message || String(e));
      }
    }
  }

  function bindUI() {
    $id("btnApply")?.addEventListener("click", () => loadOverview());
    $id("btnReset")?.addEventListener("click", () => location.reload());

    const search = $id("search");
    let typingTimer = null;

    if (search) {
      search.addEventListener("input", () => {
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => loadOverview(), 250);
      });
      search.addEventListener("keydown", (e) => {
        if (e.key === "Enter") loadOverview();
      });
    }

    $id("branchSelect")?.addEventListener("change", () => {
      booted = false;
      showLoadingSidebar();
      loadOverview();
    });

    $id("regionSelect")?.addEventListener("change", () => {
      booted = false;
      showLoadingSidebar();
      loadOverview();
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const ok = await (window.ExecCommon?.requireExecutive?.() ?? Promise.resolve(true));
    if (!ok) return;

    bindUI();

    try { await loadMeta(); }
    catch (e) { console.error("[equipment] meta error:", e); }

    showLoadingSidebar();
    await loadOverview();
  });

  window.__equipmentReload = loadOverview;
})();