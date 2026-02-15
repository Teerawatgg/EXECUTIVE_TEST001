// executive/equipment.js (UPDATED)
// - Add filters: branchSelect + regionSelect
// - Categories: change to RADIO (เลือกได้ทีละ 1 หมวด) + มี "ทั้งหมด"
// - Statuses: checkbox (เลือกได้หลายสถานะ)

(function () {
  const API = (file, params = {}) => ExecCommon.apiGet(file, params);
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
    const months = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
    return `${day} ${months[m - 1]} ${y + 543}`;
  }

  function statusPill(status) {
    const s = String(status || "").toUpperCase();
    if (s === "AVAILABLE") return `<span class="pill ok">ว่าง</span>`;
    if (s === "IN_USE") return `<span class="pill use">กำลังใช้งาน</span>`;
    if (s === "BROKEN") return `<span class="pill bad">ชำรุด</span>`;
    if (s === "MAINTENANCE") return `<span class="pill maint">ซ่อมบำรุง</span>`;
    return `<span class="pill muted">${esc(status || "-")}</span>`;
  }

  function usageText(it) {
    const uc = it?.usage_count;
    const ul = it?.usage_limit;
    if (typeof uc === "number" && typeof ul === "number" && ul > 0) {
      return `${fmt(uc)}/${fmt(ul)} ครั้ง`;
    }
    return "-";
  }

  function setText(id, v) {
    const el = $id(id);
    if (el) el.textContent = (v ?? "-");
  }

  // ---- state ----
  let booted = false;
  let categoriesCache = [];
  let summaryCache = null;

  // ---- read filters ----
  function readBranch() {
    return $id("branchSelect") ? ($id("branchSelect").value || "ALL") : "ALL";
  }
  function readRegion() {
    return $id("regionSelect") ? ($id("regionSelect").value || "ALL") : "ALL";
  }

  // ✅ RADIO: cat (value = ALL หรือ category_id เดียว)
  function readSelectedCategoryId() {
    const wrap = $id("catList");
    if (!wrap) return "ALL";
    const picked = wrap.querySelector('input[name="cat"]:checked');
    return picked ? (picked.value || "ALL") : "ALL";
  }

  function readSelectedStatuses() {
    const wrap = $id("statusList");
    if (!wrap) return [];
    return Array.from(wrap.querySelectorAll('input[name="st"]:checked'))
      .map((x) => x.value)
      .filter(Boolean);
  }

  function readSearch() {
    return ($id("search")?.value || "").trim();
  }

  // ---- meta (branch/region options) ----
  async function loadMeta() {
    // ใช้ get_meta.php เดิมของระบบ executive
    const meta = await API("get_meta.php", {});
    console.log("[equipment] meta:", meta);

    if (!meta || !meta.success) return;

    const bs = $id("branchSelect");
    if (bs) {
      const keep = bs.value || "ALL";
      bs.innerHTML =
        `<option value="ALL">ทั้งหมด</option>` +
        (meta.branches || []).map(b =>
          `<option value="${esc(b.branch_id)}">${esc(b.branch_id)} • ${esc(b.name)}</option>`
        ).join("");
      bs.value = keep;
    }

    const rs = $id("regionSelect");
    if (rs) {
      const keep = rs.value || "ALL";
      rs.innerHTML =
        `<option value="ALL">ทั้งหมด</option>` +
        (meta.regions || []).map(r =>
          `<option value="${esc(r.region)}">${esc(r.region)}</option>`
        ).join("");
      rs.value = keep;
    }
  }

  // ---- render categories RADIO (once) ----
  function renderCategoriesOnce(categories) {
    const wrap = $id("catList");
    if (!wrap) return;

    const rows = [];

    // ✅ "ทั้งหมด" radio
    rows.push(`
      <div class="chkRow">
        <label class="chkLeft">
          <input type="radio" name="cat" value="ALL" checked />
          <span>ทั้งหมด</span>
        </label>
        <span class="chkCount">(${fmt(categories?.reduce((s,c)=>s+Number(c.total||0),0) || 0)})</span>
      </div>
    `);

    if (Array.isArray(categories) && categories.length) {
      categories.forEach((c) => {
        const id = c.category_id ?? "";
        const name = c.category_name ?? "-";
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

    // ✅ เปลี่ยน radio -> โหลดใหม่
    wrap.querySelectorAll('input[name="cat"]').forEach((ch) => {
      ch.addEventListener("change", () => loadFiltered());
    });
  }

  // ---- render statuses (totals from cache) ----
  function renderStatusesTotals(summary) {
    const wrap = $id("statusList");
    if (!wrap) return;

    const s = summary || {};
    const total = Number(s.total || 0);
    const available = Number(s.available || 0);
    const inUse = Number(s.in_use || 0);
    const broken = Number(s.broken || 0);
    const maintenance = Number(s.maintenance || 0);

    wrap.innerHTML = `
      <div class="chkRow">
        <label class="chkLeft">
          <input type="checkbox" name="st" value="AVAILABLE" />
          <span>ว่าง</span>
        </label>
        <span class="chkCount">(${fmt(available)})</span>
      </div>

      <div class="chkRow">
        <label class="chkLeft">
          <input type="checkbox" name="st" value="IN_USE" />
          <span>กำลังใช้งาน</span>
        </label>
        <span class="chkCount">(${fmt(inUse)})</span>
      </div>

      <div class="chkRow">
        <label class="chkLeft">
          <input type="checkbox" name="st" value="BROKEN" />
          <span>ชำรุด</span>
        </label>
        <span class="chkCount">(${fmt(broken)})</span>
      </div>

      ${maintenance > 0 ? `
        <div class="chkRow">
          <label class="chkLeft">
            <input type="checkbox" name="st" value="MAINTENANCE" />
            <span>ซ่อมบำรุง</span>
          </label>
          <span class="chkCount">(${fmt(maintenance)})</span>
        </div>
      ` : ""}

      <div class="muted" style="margin-top:8px;font-weight:900;">รวม: ${fmt(total)} ชิ้น</div>
    `;

    wrap.querySelectorAll('input[name="st"]').forEach((ch) => {
      ch.addEventListener("change", () => loadFiltered());
    });
  }

  // ---- KPI ----
  function renderKPI(summary) {
    const s = summary || {};
    setText("kpiTotal", fmt(s.total || 0));
    setText("kpiAvailable", fmt(s.available || 0));
    setText("kpiInUse", fmt(s.in_use || 0));
    setText("kpiBroken", fmt(s.broken || 0));
  }

  // ---- groups ----
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
          <td class="tdR">${esc(usageText(it))}</td>
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
                  <th style="width:140px;" class="tdR">การใช้งาน</th>
                  <th style="width:160px;" class="tdC">วันที่ซื้อ</th>
                  <th style="width:160px;" class="tdC">วันหมดอายุ</th>
                </tr>
              </thead>
              <tbody>
                ${rows || `<tr><td colspan="6" class="muted" style="font-weight:900;">ไม่มีรายการ</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join("");
  }

  async function fetchOverview(params) {
    const res = await API("get_equipment_overview.php", params);
    console.log("[equipment] overview:", params, res);
    if (!res || !res.success) throw new Error(res?.message || res?.error || "โหลดข้อมูลไม่สำเร็จ");
    return res;
  }

  // ---- initial ----
  async function loadInitial() {
    const baseParams = {
      branch_id: readBranch(),
      region: readRegion(),
    };

    const res = await fetchOverview(baseParams);

    categoriesCache = Array.isArray(res.categories) ? res.categories : [];
    summaryCache = res.summary || null;

    if (!booted) {
      renderCategoriesOnce(categoriesCache);  // ✅ radio
      renderStatusesTotals(summaryCache);
      booted = true;
    }

    renderKPI(res.summary);
    renderGroups(res.groups);
  }

  // ---- filtered ----
  async function loadFiltered() {
    const params = {
      branch_id: readBranch(),
      region: readRegion(),
    };

    const q = readSearch();
    if (q) params.search = q;

    // ✅ category radio
    const cat = readSelectedCategoryId();
    if (cat && cat !== "ALL") params.categories = cat; // ส่งตัวเดียว

    // statuses checkbox
    const sts = readSelectedStatuses();
    if (sts.length) params.statuses = sts.join(",");

    try {
      const res = await fetchOverview(params);

      // คง counts sidebar เป็น totals ของสาขา/ภูมิภาคที่เลือก “ล่าสุด”
      // (ถ้าคุณอยากให้ totals เปลี่ยนตาม filter ก็เปลี่ยนเป็น res.summary ได้)
      renderStatusesTotals(res.summary);
      renderKPI(res.summary);
      renderGroups(res.groups);
    } catch (e) {
      console.error(e);
      const wrap = $id("groupsWrap");
      if (wrap) wrap.innerHTML = `<div style="color:#b91c1c;font-weight:900;">${esc(e.message || "โหลดข้อมูลไม่สำเร็จ")}</div>`;
    }
  }

  // ---- bind ----
  let typingTimer = null;

  function bindUI() {
    $id("btnApply")?.addEventListener("click", () => loadFiltered());
    $id("btnReset")?.addEventListener("click", () => location.reload());

    const search = $id("search");
    if (search) {
      search.addEventListener("input", () => {
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => loadFiltered(), 250);
      });
      search.addEventListener("keydown", (e) => {
        if (e.key === "Enter") loadFiltered();
      });
    }

    // ✅ branch/region change -> reload
    $id("branchSelect")?.addEventListener("change", () => loadInitial());
    $id("regionSelect")?.addEventListener("change", () => loadInitial());
  }

  // ---- boot ----
  document.addEventListener("DOMContentLoaded", async () => {
    const ok = await ExecCommon.requireExecutive();
    if (!ok) return;

    bindUI();
    await loadMeta();

    try {
      await loadInitial();
    } catch (e) {
      console.error(e);
      const wrap = $id("groupsWrap");
      if (wrap) wrap.innerHTML = `<div style="color:#b91c1c;font-weight:900;">${esc(e.message || "โหลดข้อมูลไม่สำเร็จ")}</div>`;
    }
  });

  // debug
  window.__equipmentReload = loadFiltered;
})();