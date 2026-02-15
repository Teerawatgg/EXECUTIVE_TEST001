type Summary = { total:number; available:number; in_use:number; damaged:number; };
type CatRow = { category:string; qty:number; };

type Item = {
  code:string;
  name:string;
  status_key:string;
  status_label:string;
  status_badge:"ok"|"use"|"bad"|"muted";
  usage_count:number|null;
  usage_limit:number|null;
  received_date:string|null;
  expiry_date:string|null;
};

type Group = { category:string; count:number; items: Item[]; };

type Res = {
  success:boolean;
  summary: Summary;
  categories: CatRow[];
  groups: Group[];
};

function $id(id:string){ return document.getElementById(id); }

function fmtNum(n:any){ return Number(n || 0).toLocaleString("th-TH"); }
function fmtDateTH(d:any){ return d ? String(d) : "-"; }

function getSelectedCategories(): string[] {
  const wrap = $id("catList");
  if (!wrap) return [];
  const arr: string[] = [];
  wrap.querySelectorAll<HTMLInputElement>("input[type='checkbox'][data-cat]").forEach(ch => {
    if (ch.checked) arr.push(ch.dataset.cat || "");
  });
  return arr.filter(Boolean);
}

function getSelectedStatus(): string {
  const wrap = $id("statusList");
  if (!wrap) return "ALL";
  const el = wrap.querySelector<HTMLInputElement>("input[name='status']:checked");
  return el ? el.value : "ALL";
}

function getParams(): Record<string,string> {
  const search = ($id("search") as HTMLInputElement | null)?.value.trim() || "";
  const categories = getSelectedCategories().join(",");
  const status = getSelectedStatus();

  const p: Record<string,string> = {};
  if (search) p.search = search;
  if (categories) p.categories = categories;
  if (status) p.status = status;
  return p;
}

function setText(id:string, v:any){
  const el = $id(id);
  if (el) el.textContent = (v ?? "-");
}

function statusPillClass(badge:string){
  if (badge === "ok") return "pill ok";
  if (badge === "use") return "pill use";
  if (badge === "bad") return "pill bad";
  return "pill muted";
}

function renderStatusList(summary: Summary){
  const wrap = $id("statusList");
  if (!wrap) return;

  wrap.innerHTML = `
    <div class="checkRow">
      <label><input type="radio" name="status" value="ALL" checked> ทั้งหมด</label>
      <span class="badgeCount">${fmtNum(summary.total)}</span>
    </div>
    <div class="checkRow">
      <label><input type="radio" name="status" value="available"> ว่าง</label>
      <span class="badgeCount">${fmtNum(summary.available)}</span>
    </div>
    <div class="checkRow">
      <label><input type="radio" name="status" value="in_use"> กำลังใช้งาน</label>
      <span class="badgeCount">${fmtNum(summary.in_use)}</span>
    </div>
    <div class="checkRow">
      <label><input type="radio" name="status" value="damaged"> ชำรุด</label>
      <span class="badgeCount">${fmtNum(summary.damaged)}</span>
    </div>
  `;
}

function renderCategoryList(categories: CatRow[]){
  const wrap = $id("catList");
  if (!wrap) return;

  if (!categories?.length){
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:800;">ไม่มีข้อมูลหมวดหมู่ (ถ้า DB ไม่มีคอลัมน์ category)</div>`;
    return;
  }

  wrap.innerHTML = categories.map(c => `
    <div class="checkRow">
      <label>
        <input type="checkbox" data-cat="${String(c.category).replace(/"/g,'&quot;')}" checked>
        ${c.category}
      </label>
      <span class="badgeCount">${fmtNum(c.qty)}</span>
    </div>
  `).join("");
}

function renderGroups(groups: Group[]){
  const wrap = $id("groups");
  if (!wrap) return;

  if (!groups?.length){
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:800;">ไม่พบข้อมูล</div>`;
    return;
  }

  wrap.innerHTML = groups.map(g => {
    const rows = (g.items || []).map(it => {
      let usageText = "-";
      if (it.usage_count != null && it.usage_limit != null) usageText = `${fmtNum(it.usage_count)}/${fmtNum(it.usage_limit)} ครั้ง`;
      else if (it.usage_count != null) usageText = `${fmtNum(it.usage_count)} ครั้ง`;

      return `
        <tr>
          <td>${it.code || "-"}</td>
          <td>${it.name || "-"}</td>
          <td><span class="${statusPillClass(it.status_badge)}">${it.status_label || "-"}</span></td>
          <td class="tdR">${usageText}</td>
          <td>${fmtDateTH(it.received_date)}</td>
          <td class="tdR">${fmtDateTH(it.expiry_date)}</td>
        </tr>
      `;
    }).join("");

    return `
      <div class="group">
        <div class="groupHead">
          <div class="name">${g.category || "อื่นๆ"}</div>
          <div class="sub">${fmtNum(g.count || 0)} รายการ</div>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>รหัส</th>
              <th>ชื่ออุปกรณ์</th>
              <th>สถานะ</th>
              <th class="tdR">การใช้งาน</th>
              <th>วันที่รับ</th>
              <th class="tdR">วันหมดอายุ</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="6" style="color:#6b7280;">ไม่พบข้อมูล</td></tr>`}</tbody>
        </table>
      </div>
    `;
  }).join("");
}

async function load(initial:boolean){
  const res: Res = await (window as any).ExecCommon.apiGet("get_equipment_overview.php", getParams());
  if (!res || !res.success){
    const wrap = $id("groups");
    if (wrap) wrap.innerHTML = `<div style="color:#b91c1c;font-weight:900;">โหลดไม่สำเร็จ</div>`;
    return;
  }

  setText("sumTotal", fmtNum(res.summary?.total || 0));
  setText("sumAvailable", fmtNum(res.summary?.available || 0));
  setText("sumInUse", fmtNum(res.summary?.in_use || 0));
  setText("sumDamaged", fmtNum(res.summary?.damaged || 0));

  renderStatusList(res.summary);
  if (initial) renderCategoryList(res.categories);

  renderGroups(res.groups);

  $id("statusList")?.querySelectorAll("input[name='status']").forEach(el => {
    el.addEventListener("change", () => load(false));
  });
  $id("catList")?.querySelectorAll("input[type='checkbox'][data-cat]").forEach(el => {
    el.addEventListener("change", () => load(false));
  });
}

function bindUI(){
  $id("btnApply")?.addEventListener("click", () => load(false));
  $id("btnReset")?.addEventListener("click", () => location.reload());
  $id("search")?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") load(false);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const ok = await (window as any).ExecCommon.requireExecutive();
  if (!ok) return;
  bindUI();
  load(true);
});