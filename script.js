const MD_URL = "./foods.md"; // repo 루트에 foods.md

let rawData = [];

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

  /** @type {Array<{gate:string,name:string,kind:string,address:string,link:string,hours:string, schedule:any}>} */
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

    // 헤더 감지(영업시간 칼럼이 없어도 동작하게 "상호명/종류/주소"만으로 판단)
    if (line.includes("| 상호명 |") && line.includes("| 종류 |") && line.includes("| 주소 |")){
      inTable = true;
      headerSeen = true;
      continue;
    }

    if (inTable && headerSeen && /^\|\s*-+/.test(line)) continue;

    if (inTable && line.trim().startsWith("|")) {
      // | a | b | c | d | e | 형태를 안전하게 파싱
      const colsRaw = line.split("|").map(s => normalize(s));
      const cols = colsRaw.filter((_, idx) => !(idx === 0 || idx === colsRaw.length - 1)); // 양끝 빈칸 제거

      const name = cols[0] || "";
      const k = cols[1] || "";
      const address = cols[2] || "";
      let link = cols[3] || "";
      const hours = cols[4] || ""; // ✅ 새 칼럼

      if (!name) continue;

      const m = link.match(/\((https?:\/\/[^)]+)\)/);
      if (m) link = m[1];

      const schedule = parseHoursA(hours);

      items.push({
        gate: detectGate(curSection),
        name,
        kind: k,
        address,
        link,
        hours,
        schedule
      });
    }
  }

  return items;
}

const DAY_MAP = { "일":0, "월":1, "화":2, "수":3, "목":4, "금":5, "토":6 };

function toMin(hhmm){
  const [h,m] = hhmm.split(":").map(Number);
  return h*60 + m;
}

function expandDays(spec){
  spec = (spec || "").trim();

  if (!spec) return [];
  if (spec.includes("매일")) return [0,1,2,3,4,5,6];

  // "월-금", "토", "일" 지원
  // 공백 제거
  spec = spec.replace(/\s/g, "");

  // 예: "월-금"
  const range = spec.match(/^([일월화수목금토])\-([일월화수목금토])$/);
  if (range){
    const a = DAY_MAP[range[1]];
    const b = DAY_MAP[range[2]];
    if (a == null || b == null) return [];
    const out = [];
    // 요일은 순환 가능(일-화 같은 케이스까지 대응)
    let cur = a;
    while (true){
      out.push(cur);
      if (cur === b) break;
      cur = (cur + 1) % 7;
      if (out.length > 7) break;
    }
    return out;
  }

  // 단일 요일들: "월화수" 같은 케이스도 어느 정도 지원
  const singles = [];
  for (const ch of spec.split("")){
    if (DAY_MAP[ch] != null) singles.push(DAY_MAP[ch]);
  }
  return Array.from(new Set(singles));
}

/**
 * A안 파서
 * 예) "월-금 11:00-21:00; BT 15:00-16:30 / 토 11:00-20:00 / 일 휴무"
 * 반환: { byDay: {0..6: {off:boolean, open?:min, close?:min, breaks:[{s,e}]}} }
 */
function parseHoursA(hoursRaw){
  const hours = (hoursRaw || "").trim();
  const byDay = {};
  for (let d=0; d<7; d++) byDay[d] = { off: false, breaks: [] };

  if (!hours) return { byDay, raw: "" };

  const parts = hours.split("/").map(s => s.trim()).filter(Boolean);

  for (const part of parts){
    // part 예: "월-금 11:00-21:00; BT 15:00-16:30"
    //      예: "일 휴무"
    const off = /휴무/.test(part);

    // 요일 스펙은 맨 앞에서 찾기: "매일" 또는 "월-금" 또는 "토" 등
    const daySpecMatch = part.match(/^(매일|[일월화수목금토](?:\-[일월화수목금토])?|[일월화수목금토]{2,7})/);
    const daySpec = daySpecMatch ? daySpecMatch[1] : "매일";
    const days = expandDays(daySpec);

    // 영업시간(첫 번째 HH:MM-HH:MM)
    const mainMatch = part.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
    const openClose = mainMatch ? [toMin(mainMatch[1]), toMin(mainMatch[2])] : null;

    // 브레이크타임( BT HH:MM-HH:MM ) 여러 개도 허용
    const breakMatches = Array.from(part.matchAll(/BT\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/gi));
    const breaks = breakMatches.map(m => ({ s: toMin(m[1]), e: toMin(m[2]) }));

    for (const d of days){
      if (off){
        byDay[d] = { off: true, breaks: [] };
        continue;
      }
      const prev = byDay[d] || { off:false, breaks: [] };
      const next = { ...prev, off:false, breaks:[...prev.breaks] };

      if (openClose){
        next.open = openClose[0];
        next.close = openClose[1];
      }
      if (breaks.length){
        next.breaks = breaks;
      }
      byDay[d] = next;
    }
  }

  return { byDay, raw: hours };
}

function getOpenStatus(item){
  // item.schedule가 없거나 open/close가 없으면 표시 안 함
  const sch = item.schedule;
  const raw = (item.hours || "").trim();
  if (!raw || !sch || !sch.byDay) return { state:"unknown", label:"", raw };

  const now = new Date();
  const day = now.getDay(); // 0=일
  const rule = sch.byDay[day] || { off:false, breaks:[] };

  if (rule.off) return { state:"off", label:"휴무", raw };

  if (rule.open == null || rule.close == null) {
    return { state:"unknown", label:"시간 정보 없음", raw };
  }

  let nowMin = now.getHours()*60 + now.getMinutes();
  let openMin = rule.open;
  let closeMin = rule.close;

  // 자정 넘김 처리(예: 18:00-02:00)
  if (closeMin <= openMin) {
    closeMin += 1440;
    if (nowMin < openMin) nowMin += 1440;
  }

  // 브레이크 검사
  for (const b of (rule.breaks || [])){
    let s = b.s, e = b.e;
    if (e <= s) { e += 1440; if (nowMin < s) nowMin += 1440; }
    if (nowMin >= s && nowMin < e) {
      return { state:"break", label:"브레이크타임", raw };
    }
  }

  if (nowMin >= openMin && nowMin < closeMin) return { state:"open", label:"영업 중", raw };
  return { state:"closed", label:"영업 종료", raw };
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

    const st = getOpenStatus(d);

    const headerHTML = `
      <div class="name">
        <div class="title">${esc(d.name)}</div>
        <div class="right">
          <span class="status ${esc(st.state)}">${esc(st.label)}</span>
          <div class="badge">${esc(d.gate)}</div>
        </div>
      </div>
    `;

    const metaHTML = `
      <div class="meta">
        <span class="pill">${esc(d.kind || "종류 미상")}</span>
      </div>
    `;

    const addrHTML = `
      <div class="addr">${esc(d.address || "")}</div>
    `;

    const hoursHTML = st.raw
      ? `<div class="hours">${esc(st.raw)}</div>`
      : "";

    const actionHTML = `
      <div class="actions">
        ${
          d.link
            ? `<button data-act="open" data-link="${esc(d.link)}">지도/링크</button>`
            : `<span class="muted">링크 없음</span>`
        }
      </div>
    `;

    card.innerHTML =
      headerHTML +
      metaHTML +
      addrHTML +
      hoursHTML +
      actionHTML;

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
