// users.js (FINAL) - robust canvas picking + fixed chart rendering

function $id(id) { return document.getElementById(id); }
function fmtNum(n){ return Number(n||0).toLocaleString("th-TH"); }

const API_FILE = "get_users_dashboard.php";

let chartFaculty = null;
let chartStudyYear = null;
let chartPeak = null;

let mode = "peak"; // peak | daily

function showErr(msg){
  let box = $id("usersError");
  if (!box) return; // ถ้าไม่มี กล่อง error ก็ไม่บังคับ
  box.style.display = msg ? "block" : "none";
  box.textContent = msg || "";
}

function getRange(){
  const el = document.querySelector('input[name="range"]:checked');
  return el ? el.value : "all";
}

function getCheckedValues(containerId){
  const box = $id(containerId);
  if (!box) return [];
  return Array.from(box.querySelectorAll('input[type="checkbox"]:checked')).map(x=>x.value);
}

function getParams(){
  const p = {};
  const ay = $id("academicYear")?.value || "ALL";
  const range = getRange();

  p.range = range;
  if (ay && ay !== "ALL") p.academic_year = ay;

  if (range === "custom") {
    const from = $id("fromDate")?.value || "";
    const to   = $id("toDate")?.value || "";
    if (from) p.from = from;
    if (to) p.to = to;
  }

  const fac = getCheckedValues("facultyList");
  const sy  = getCheckedValues("studyYearList");
  if (fac.length) p.faculties = fac.join(",");
  if (sy.length)  p.study_years = sy.join(",");

  return p;
}

function pickCanvasId(candidates){
  for (const id of candidates) {
    if ($id(id)) return id;
  }
  return null;
}

function destroyChart(ch){
  try { if (ch) ch.destroy(); } catch(_){}
  return null;
}

function drawBar(canvasId, labels, data){
  const c = $id(canvasId);
  if (!c) return null;
  if (!window.Chart) {
    console.error("Chart.js not loaded");
    return null;
  }

  return new Chart(c.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "จำนวน",
        data,
        borderRadius: 8,
        barThickness: 28,
        maxBarThickness: 44,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display:false }, ticks: { maxRotation: 0 } },
        y: { beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  });
}

function renderMeta(meta){
  // ปีการศึกษา
  const sel = $id("academicYear");
  if (sel && Array.isArray(meta?.academic_years)) {
    const years = meta.academic_years;
    sel.innerHTML =
      `<option value="ALL">ทั้งหมด</option>` +
      years.map(y => `<option value="${y}">${y}</option>`).join("");
    if (years.length) sel.value = String(years[0]);
  }

  // คณะ: meta.faculties = [{id,name}]
  const facBox = $id("facultyList");
  if (facBox && Array.isArray(meta?.faculties)) {
    facBox.innerHTML = meta.faculties.map(f => `
      <label style="display:flex;gap:8px;align-items:center;">
        <input type="checkbox" value="${f.id}" checked>
        <span>${f.name}</span>
      </label>
    `).join("");
  }

  // ชั้นปี
  const syBox = $id("studyYearList");
  if (syBox && Array.isArray(meta?.study_years)) {
    syBox.innerHTML = meta.study_years.map(y => `
      <label style="display:flex;gap:8px;align-items:center;">
        <input type="checkbox" value="${y}" checked>
        <span>ปี ${y}</span>
      </label>
    `).join("");
  }
}

function setKPI(kpi){
  $id("kpiTotalUsage") && ($id("kpiTotalUsage").textContent = fmtNum(kpi.total_usage));
  $id("kpiTopFacultyName") && ($id("kpiTopFacultyName").textContent = kpi?.top_faculty?.name || "-");
  $id("kpiTopFacultyCount") && ($id("kpiTopFacultyCount").textContent = fmtNum(kpi?.top_faculty?.count || 0));

  const rate = Number(kpi.usage_rate || 0);
  $id("kpiUsageRate") && ($id("kpiUsageRate").textContent = rate.toFixed(1));
  $id("kpiUsageBar") && ($id("kpiUsageBar").style.width = Math.max(0, Math.min(100, rate)) + "%");
}

function renderTop(items){
  const wrap = $id("topEquipmentList");
  if (!wrap) return;

  items = Array.isArray(items) ? items : [];
  if (!items.length) {
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:800;">ไม่พบข้อมูล</div>`;
    return;
  }

  const max = Math.max(...items.map(x=>Number(x.count||0)), 1);

  wrap.innerHTML = items.slice(0,5).map((it,i)=>{
    const w = ((Number(it.count||0)*100)/max).toFixed(1);
    return `
      <div style="margin:10px 0;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="font-weight:900;">#${i+1} ${it.name || "-"}</div>
          <div style="font-weight:900;">${fmtNum(it.count)} ครั้ง</div>
        </div>
        <div style="height:7px;border-radius:999px;background:#eef2f7;overflow:hidden;margin-top:6px;">
          <div style="height:100%;width:${w}%;background:#f97316;border-radius:999px;"></div>
        </div>
      </div>
    `;
  }).join("");
}

function setMode(next){
  mode = next;
  $id("btnDaily")?.classList.toggle("active", mode==="daily");
  $id("btnPeak")?.classList.toggle("active", mode==="peak");
}

async function load(first){
  try{
    showErr("");

    const res = await ExecCommon.apiGet(API_FILE, getParams());
    console.log("dashboard res:", res);

    if (!res || !res.success) {
      showErr("API error: " + (res?.error || "โหลดข้อมูลไม่สำเร็จ"));
      return;
    }

    if (first) renderMeta(res.meta || {});
    setKPI(res.kpi || {});
    renderTop(res.top_equipment || []);

    // ✅ รองรับหลาย id (กัน HTML ไม่ตรง)
    const facCanvas = pickCanvasId(["chartFaculty","chartByFaculty","chart_faculty"]);
    const syCanvas  = pickCanvasId(["chartStudyYear","chartByStudyYear","chart_study_year"]);
    const pkCanvas  = pickCanvasId(["chartPeak","chartPeakTime","chart_peak","chartDailyUsage","chart_daily"]);

    // Faculty chart
    if (facCanvas) {
      const rows = Array.isArray(res.by_faculty) ? res.by_faculty : [];
      chartFaculty = destroyChart(chartFaculty);
      chartFaculty = drawBar(facCanvas, rows.map(r=>r.faculty), rows.map(r=>Number(r.count||0)));
    }

    // StudyYear chart
    if (syCanvas) {
      const rows = Array.isArray(res.by_study_year) ? res.by_study_year : [];
      chartStudyYear = destroyChart(chartStudyYear);
      chartStudyYear = drawBar(syCanvas, rows.map(r=>"ปี "+r.study_year), rows.map(r=>Number(r.count||0)));
    }

    // Peak/Daily chart (canvas เดียว)
    if (pkCanvas) {
      chartPeak = destroyChart(chartPeak);

      if (mode === "daily") {
        const labels = res.daily_usage?.labels || [];
        const data   = res.daily_usage?.counts || [];
        chartPeak = drawBar(pkCanvas, labels, data.map(x=>Number(x||0)));
      } else {
        const rows = Array.isArray(res.peak_time) ? res.peak_time : [];
        chartPeak = drawBar(pkCanvas, rows.map(r=>r.label), rows.map(r=>Number(r.count||0)));
      }
    }
  } catch(e){
    console.error(e);
    showErr("JS error: " + e.message);
  }
}

function bindUI(){
  $id("btnApply")?.addEventListener("click", ()=>load(false));
  $id("btnReset")?.addEventListener("click", ()=>location.reload());
  $id("academicYear")?.addEventListener("change", ()=>load(false));

  $id("facultyList")?.addEventListener("change", ()=>load(false));
  $id("studyYearList")?.addEventListener("change", ()=>load(false));

  document.querySelectorAll('input[name="range"]').forEach(r=>{
    r.addEventListener("change", ()=>load(false));
  });

  $id("btnDaily")?.addEventListener("click", ()=>{ setMode("daily"); load(false); });
  $id("btnPeak")?.addEventListener("click", ()=>{ setMode("peak"); load(false); });
}

document.addEventListener("DOMContentLoaded", async ()=>{
  const ok = await ExecCommon.requireExecutive();
  if (!ok) return;

  bindUI();
  setMode("peak");
  await load(true);
});