const MD_URL = "./foods.md"; // repo 루트에 foods.md

let rawData = [];
let showNoLink = true;

// UI refs
const grid = document.getElementById("grid");
const count = document.getElementById("count");
const statusEl = document.getElementById("status");
const q = document.getElementById("q");
const gate = document.getElementById("gate");
const kind = document.getElementById("kind");
const sort = document.getElementById("sort");
const resetBtn = document.getElementById("resetBtn");
const reloadBtn = document.getElementById("reloadBtn");
const toggleNoLinkBtn = document.getElementById("toggleNoLinkBtn");

function normalize(s){ return (s||"").toString().trim(); }

function detectGate(sectionTitle){
  if (sectionTitle.includes("정문")) return "정문";
  if (sectionTitle.includes("남문")) return "남문";
  if (sectionTitle.includes("후문")) return "후문";
  if (sectionTitle.includes("술집")) return "술집";
  if (sectionTitle.includes("기타")) return "기타";
  return "기타";
}

function parseMarkdownTables(md) {
  const lines = md.split("\n");
  let curSection = "";
  let inTable = false;
  let headerSeen = false;

  /** @type {Array<{gate:string,name:string,kind:string,address:string,link:string}>} */
  const items = [];

  for (let i=0; i<lines.length; i++){
    const line = lines[i];

    const sec = line.match(/^##\s+(.+)$/);
    if (sec){
      curSection = sec[1];
      inTable = false;
      headerSeen = false;
      continue;
    }

    if (line.includes("| 상호명 |") && line.includes("| 종류 |") && line.includes("| 주소 |")){
      inTable = true;
      headerSeen = true;
      continue;
    }

    if (inTable && headerSeen && /^\|\s*-+/.test(line)) continue;

    if (inTable && line.trim().startsWith("|")) {
      const cols = line.split("|").map(s=>normalize(s));
      const name = cols[1] || "";
      const k = cols[2] || "";
      const address = cols[3] || "";
      let link = cols[4] || "";

      // 파일에 빈 줄( |  |  |  | )이 꽤 있어서 이름 없으면 스킵
      if (!name) continue;

      // [url](url) 형태면 url만 추출
      const m = link.match(/\((https?:\/\/[^)]+)\)/);
      if (m) link = m[1];

      items.push({
        gate: detectGate(curSection),
        name,
        kind: k,
        address,
        link
      });
    }
  }

  return items;
}

function uniq(arr){ return Array.from(new Set(arr)).sort((a,b)=>a.localeCompare(b,"ko")); }

function refreshKindOptions() {
  const kinds = uniq(rawData.map(d=>d.kind).filter(Boolean));
  const cur = kind.value;

  kind.innerHTML = "";
  const base = document.createElement("option");
  base.value = ""; base.textContent = "종류(전체)";
  kind.appendChild(base);

  for (const k of kinds){
    const o = document.createElement("option");
    o.value = k; o.textContent = k;
    kind.appendChild(o);
  }

  if (kinds.includes(cur)) kind.value = cur;
}

function getFiltered(){
  const qq = (q.value||"").trim().toLowerCase();
  const g = gate.value;
  const k = kind.value;

  let out = rawData.filter(d=>{
    if (!showNoLink && !d.link) return false;
    if (g && d.gate !== g) return false;
    if (k && d.kind !== k) return false;

    if (!qq) return true;
    const hay = `${d.name} ${d.kind} ${d.address} ${d.gate}`.toLowerCase();
    return hay.includes(qq);
  });

  if (sort.value === "gate") {
    const order = { "정문":1, "남문":2, "후문":3, "술집":4, "기타":5 };
    out.sort((a,b)=> (order[a.gate]||99)-(order[b.gate]||99) || a.name.localeCompare(b.name,"ko"));
  } else if (sort.value === "name") {
    out.sort((a,b)=> a.name.localeCompare(b.name,"ko"));
  } else if (sort.value === "kind") {
    out.sort((a,b)=> a.kind.localeCompare(b.kind,"ko") || a.name.localeCompare(b.name,"ko"));
  }

  return out;
}

function esc(s){
  return (s??"").toString()
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function render(){
  const items = getFiltered();
  count.textContent = `표시 ${items.length}개 / 전체 ${rawData.length}개`;

  grid.innerHTML = "";
  for (const d of items){
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="name">
        <div class="title">${esc(d.name)}</div>
        <div class="badge">${esc(d.gate)}</div>
      </div>
      <div class="meta">
        <span class="pill">${esc(d.kind || "종류 미상")}</span>
      </div>
      <div class="addr">${esc(d.address || "")}</div>
      <div class="actions">
        ${d.link ? `<button data-act="open" data-link="${esc(d.link)}">지도/링크</button>` : `<span class="muted">링크 없음</span>`}
      </div>
    `;
    grid.appendChild(card);
  }
}

grid.addEventListener("click", (e)=>{
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.act === "open") {
    window.open(btn.dataset.link, "_blank", "noopener,noreferrer");
  }
});

[q, gate, kind, sort].forEach(el => el.addEventListener("input", render));

resetBtn.addEventListener("click", ()=>{
  q.value = "";
  gate.value = "";
  kind.value = "";
  sort.value = "gate";
  render();
});

reloadBtn.addEventListener("click", ()=> loadMd(true));

toggleNoLinkBtn.addEventListener("click", ()=>{
  showNoLink = !showNoLink;
  toggleNoLinkBtn.textContent = showNoLink ? "링크 없는 항목 숨기기" : "링크 없는 항목 표시";
  render();
});

async function loadMd(bustCache=false){
  statusEl.textContent = "foods.md 불러오는 중…";
  try{
    const url = bustCache ? `${MD_URL}?t=${Date.now()}` : MD_URL;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const md = await res.text();
    rawData = parseMarkdownTables(md);

    refreshKindOptions();
    render();
    statusEl.textContent = `업데이트됨: ${new Date().toLocaleString("ko-KR")}`;
  } catch (e){
    statusEl.innerHTML = `<div class="err">foods.md를 못 불러왔어요. 파일명이 foods.md인지, 같은 폴더(루트)에 있는지 확인! (오류: ${esc(e.message)})</div>`;
  }
}

// init
loadMd();
