equipment-status.tstype MetaRes = {
  success:boolean;
  branches:{branch_id:string; name:string}[];
  equipment_statuses:{status:string}[];
};

type SumRes = { success:boolean; items:{status:string; qty:number}[] };
type ListRes = { success:boolean; items:{
  instance_code:string; equipment_id:string; equipment_name:string;
  branch_id:string; status:string; current_location:string;
}[] };

function fillSelect(sel: HTMLSelectElement, items:{value:string,label:string}[], keepAll=true) {
  const keep = sel.value;
  sel.innerHTML = keepAll ? `<option value="ALL">ทั้งหมด</option>` : "";
  items.forEach(it => sel.insertAdjacentHTML("beforeend", `<option value="${it.value}">${it.label}</option>`));
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
}

function getParams() {
  const branch_id = (document.getElementById("branchSelect") as HTMLSelectElement).value || "ALL";
  const status = (document.getElementById("statusSelect") as HTMLSelectElement).value || "ALL";
  const search = (document.getElementById("search") as HTMLInputElement).value.trim();

  const p: Record<string,string> = { branch_id, status };
  if (search) p.search = search;
  return p;
}

function renderSummary(rows: {status:string; qty:number}[]) {
  const tb = document.getElementById("sumTbody")!;
  if (!rows.length) { tb.innerHTML = `<tr><td colspan="2" style="color:#6b7280;">ไม่พบข้อมูล</td></tr>`; return; }
  tb.innerHTML = rows.map(r => `
    <tr>
      <td>${r.status || "-"}</td>
      <td style="text-align:right;">${(window as any).ExecCommon.num(r.qty || 0)}</td>
    </tr>
  `).join("");
}

function renderList(rows: ListRes["items"]) {
  const tb = document.getElementById("listTbody")!;
  if (!rows.length) { tb.innerHTML = `<tr><td colspan="6" style="color:#6b7280;">ไม่พบข้อมูล</td></tr>`; return; }
  tb.innerHTML = rows.map(r => `
    <tr>
      <td>${r.instance_code}</td>
      <td>${r.equipment_id}</td>
      <td>${r.equipment_name}</td>
      <td>${r.branch_id}</td>
      <td>${r.status}</td>
      <td>${r.current_location || "-"}</td>
    </tr>
  `).join("");
}

async function loadMeta() {
  const meta: MetaRes = await (window as any).ExecCommon.apiGet("get_meta.php");
  if (!meta.success) return;

  fillSelect(
    document.getElementById("branchSelect") as HTMLSelectElement,
    meta.branches.map(b => ({ value:b.branch_id, label:`${b.branch_id} • ${b.name}` })),
    true
  );

  fillSelect(
    document.getElementById("statusSelect") as HTMLSelectElement,
    meta.equipment_statuses.map(s => ({ value:s.status, label:s.status })),
    true
  );
}

async function loadAll() {
  const p = getParams();

  const sum: SumRes = await (window as any).ExecCommon.apiGet("get_equipment_status_summary.php", { branch_id: p.branch_id });
  if (sum.success) renderSummary(sum.items);

  const list: ListRes = await (window as any).ExecCommon.apiGet("get_equipment_instances.php", p);
  if (list.success) renderList(list.items);
}

function bind() {
  document.getElementById("btnApply")!.addEventListener("click", loadAll);
  document.getElementById("btnReset")!.addEventListener("click", () => location.reload());
  document.getElementById("search")!.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") loadAll(); });

  document.getElementById("btnPrint")!.addEventListener("click", (e) => { e.preventDefault(); window.print(); });
  document.getElementById("btnLogout")!.addEventListener("click", (e) => { e.preventDefault(); window.location.href="/sports_rental_system/executive/frontend/index.html"; });
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadMeta();
  bind();
  loadAll();
});