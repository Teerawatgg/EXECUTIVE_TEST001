(() => {
  const basePath = "/" + (location.pathname.split("/")[1] || "");
  const API = `${basePath}/executive/api/`;

  let chartStack = null;
  const $ = (id) => document.getElementById(id);

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[m]));

  async function apiGet(file, params) {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    const url = API + file + qs;
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return null;
    try { return await res.json(); } catch { return null; }
  }

  function setText(id, v) { const el = $(id); if (el) el.textContent = v ?? "-"; }

  function getCheckedValues(containerId) {
    const wrap = $(containerId);
    if (!wrap) return [];
    return [...wrap.querySelectorAll("input[type=checkbox]:checked")].map((x) => x.value);
  }

  function renderChecklist(containerId, items, key, countKey) {
    const wrap = $(containerId);
    if (!wrap) return;

    wrap.innerHTML = (items || []).map((it) => {
      const v = it[key] ?? "";
      const c = it[countKey] ?? 0;
      const safeId = `${containerId}_${btoa(unescape(encodeURIComponent(v))).slice(0, 10)}`;
      return `
        <label class="chk">
          <input id="${safeId}" type="checkbox" value="${esc(v)}" checked />
          <span>${esc(v)}</span>
          <span class="pill">${esc(c)}</span>
        </label>
      `;
    }).join("");

    wrap.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => loadAll());
    });
  }

  function buildParams() {
    const search = ($("qSearch")?.value ?? "").trim();
    const branchId = $("branchSelect")?.value || "ALL";
    const statuses = getCheckedValues("statusFilters");
    const categories = getCheckedValues("categoryFilters");

    const p = {};
    if (search) p.search = search;
    if (branchId && branchId !== "ALL") p.branch_id = branchId;
    if (statuses.length) p.statuses = statuses.join(",");
    if (categories.length) p.categories = categories.join(",");
    return p;
  }

  function drawStack(chartPayload) {
    const canvas = $("chartStack");
    if (!canvas) return;

    if (chartStack) { chartStack.destroy(); chartStack = null; }

    if (!chartPayload || !chartPayload.labels?.length) return;

    const labels = chartPayload.labels;
    const statuses = chartPayload.statuses;
    const series = chartPayload.series;

    const datasets = (statuses || []).map((st) => ({
      label: st,
      data: series?.[st] || labels.map(() => 0),
      borderWidth: 0,
      borderRadius: 6,
    }));

    chartStack = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
        },
        plugins: { legend: { position: "bottom" } },
      },
    });
  }

  function statusBadge(s) {
    const t = String(s || "");
    if (t === "พร้อมใช้งาน") return `<span class="st ok">พร้อมใช้งาน</span>`;
    if (t === "เสื่อมสภาพ") return `<span class="st warn">เสื่อมสภาพ</span>`;
    if (t === "ชำรุด") return `<span class="st bad">ชำรุด</span>`;
    if (t === "กำลังซ่อมแซม") return `<span class="st fix">กำลังซ่อมแซม</span>`;
    return `<span class="st">${esc(t || "-")}</span>`;
  }

  function renderTop5(list) {
    const wrap = $("top5List");
    if (!wrap) return;
    if (!list || !list.length) { wrap.innerHTML = `<div class="empty">ยังไม่มีข้อมูล Top 5</div>`; return; }

    wrap.innerHTML = list.map((it, idx) => `
      <div class="topItem">
        <div class="topLeft">
          <div class="rank">#${idx + 1}</div>
          <div>
            <div class="topName">${esc(it.name)}</div>
            <div class="topSub">${esc(it.branch_name || "-")}</div>
          </div>
        </div>
        <div class="badgeRed">${esc(it.count)} ครั้ง</div>
      </div>
    `).join("");
  }

  function renderGroupTables(items) {
    const wrap = $("groupTables");
    if (!wrap) return;
    if (!items || !items.length) { wrap.innerHTML = `<div class="empty">ไม่พบรายการอุปกรณ์</div>`; return; }

    const groups = new Map();
    items.forEach((it) => {
      const c = it.category || "ไม่ระบุหมวดหมู่";
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(it);
    });

    let html = "";
    for (const [cat, rows] of groups.entries()) {
      html += `
        <div class="group">
          <div class="group-head">
            <div class="group-title">${esc(cat)}</div>
            <div class="group-sub">${rows.length} รายการ</div>
          </div>

          <div class="tableWrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th style="width:120px;">รหัส</th>
                  <th>ชื่ออุปกรณ์</th>
                  <th style="width:160px;">ตำแหน่ง</th>
                  <th style="width:160px;">สถานะ</th>
                  <th style="width:140px;">วันที่ซื้อ</th>
                  <th style="width:140px;">วันหมดอายุ</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((it) => `
                  <tr>
                    <td class="code">${esc(it.instance_code)}</td>
                    <td>${esc(it.name)}</td>
                    <td>${esc(it.location || "-")}</td>
                    <td>${statusBadge(it.status)}</td>
                    <td>${esc(it.received_date || "-")}</td>
                    <td><span class="expiry">${esc(it.expiry_date || "-")}</span></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }
    wrap.innerHTML = html;
  }

  async function loadMetaBranches() {
    const meta = await apiGet("get_meta.php");
    const sel = $("branchSelect");
    if (!sel || !meta?.success) return;

    sel.innerHTML = `<option value="ALL">ทั้งหมด</option>` + (meta.branches || []).map(b =>
      `<option value="${esc(b.branch_id)}">${esc(b.branch_id)} • ${esc(b.name)}</option>`
    ).join("");

    sel.addEventListener("change", () => {
      loadSummaryAndFilters(); // ✅ อัปเดตการ์ด/กราฟ/Top5 ตามสาขา
      loadAll();
    });
  }

  async function loadTopbarName() {
    const me = await apiGet("me.php");
    const data = me?.data || me?.user || me || {};
    const name = data.full_name || data.name || data.username || "โปรไฟล์";
    const el = $("topbarName");
    if (el) el.textContent = name;
  }

  async function loadSummaryAndFilters() {
    const params = buildParams();
    const summary = await apiGet("get_equipment_status_summary.php", params);
    if (!summary?.success) return;

    setText("cTotal", summary.cards?.total ?? "-");
    setText("cReady", summary.cards?.ready ?? "-");
    setText("cWorn", summary.cards?.worn ?? "-");
    setText("cBroken", summary.cards?.broken ?? "-");
    setText("cMaint", summary.cards?.maintenance ?? "-");

    renderChecklist("statusFilters", summary.status_counts || [], "status", "qty");
    renderChecklist("categoryFilters", summary.category_counts || [], "category", "qty");

    drawStack(summary.chart);
    renderTop5(summary.top5);
  }

  async function loadAll() {
    const params = buildParams();
    const data = await apiGet("get_equipment_instances.php", params);
    if (!data?.success) { renderGroupTables([]); return; }
    renderGroupTables(data.items || []);
  }

  let tSearch = null;
  function bindEvents() {
    $("qSearch")?.addEventListener("input", () => {
      clearTimeout(tSearch);
      tSearch = setTimeout(() => loadAll(), 250);
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    await loadTopbarName();
    await loadMetaBranches();     // ✅ โหลดสาขา (ทั้งหมด/ตามสาขา)
    await loadSummaryAndFilters();
    await loadAll();
  });
})();