/* JP Bestseller Dashboard - static Netlify Drop version */
const state = {
  queries: [
    "돈키호테 추천","돈키호테 쇼핑리스트","돈키호테 화장품 추천","일본 쇼핑 추천",
    "일본 드럭스토어 추천","일본 화장품 추천","일본 뷰티템 추천","일본 선크림 추천",
    "일본 파스 추천","일본 안약 추천","일본 캐릭터 굿즈 추천","일본 산리오 굿즈",
    "일본 치이카와 굿즈","일본 포켓몬 굿즈"
  ],
  videos: [],
  candidate: [],
  geminiDict: [],
  productRank: [],
  naverRaw: [],
  naverTop10: [],
  naverSummary: []
};

let charts = {};

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function saveKeys(){
  ["youtubeKey","geminiKey","naverClientId","naverClientSecret"].forEach(id=>{
    localStorage.setItem(id, $(id).value || "");
  });
  alert("저장했습니다.");
}
function loadKeys(){
  ["youtubeKey","geminiKey","naverClientId","naverClientSecret"].forEach(id=>{
    $(id).value = localStorage.getItem(id) || "";
  });
}

function setPage(page){
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  document.querySelector(`#page-${page}`).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active", b.dataset.page===page));
}

function renderQueries(){
  const select = $("deleteQuerySelect");
  select.innerHTML = state.queries.map(q=>`<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`).join("");
  $("queryList").innerHTML = toTable(state.queries.map(q=>({queries:q})), ["queries"]);
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}

function toTable(rows, cols, limit=200){
  if(!rows || rows.length===0) return `<div style="padding:16px;color:#6b7280">데이터 없음</div>`;
  const columns = cols || Object.keys(rows[0]);
  const head = columns.map(c=>`<th>${escapeHtml(c)}</th>`).join("");
  const body = rows.slice(0,limit).map(r=>`<tr>${columns.map(c=>`<td>${escapeHtml(r[c])}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function downloadCsv(filename, rows){
  if(!rows || rows.length===0){ alert("저장할 데이터가 없습니다."); return; }
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(",")].concat(rows.map(row=>cols.map(c=>csvCell(row[c])).join(","))).join("\n");
  const blob = new Blob(["\ufeff"+csv], {type:"text/csv;charset=utf-8;"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
function csvCell(v){
  if(Array.isArray(v)) v = v.join("|");
  v = String(v ?? "");
  return `"${v.replace(/"/g,'""')}"`;
}

function parseCsv(text){
  const rows=[]; let i=0, field="", row=[], inQuotes=false;
  while(i<text.length){
    const ch=text[i], next=text[i+1];
    if(ch==='"' && inQuotes && next==='"'){field+='"'; i+=2; continue;}
    if(ch==='"'){inQuotes=!inQuotes; i++; continue;}
    if(ch===',' && !inQuotes){row.push(field); field=""; i++; continue;}
    if((ch==='\n'||ch==='\r') && !inQuotes){
      if(ch==='\r' && next==='\n') i++;
      row.push(field); field="";
      if(row.some(x=>x!=="")) rows.push(row);
      row=[]; i++; continue;
    }
    field+=ch; i++;
  }
  row.push(field); if(row.some(x=>x!=="")) rows.push(row);
  const headers = rows.shift()?.map(h=>h.trim().replace(/^\ufeff/,"")) || [];
  return rows.map(r=>Object.fromEntries(headers.map((h,idx)=>[h,r[idx] ?? ""])));
}

async function readCsvFile(file){
  const text = await file.text();
  return parseCsv(text);
}

function renderStats(el, stats){
  $(el).innerHTML = stats.map(s=>`<div class="stat"><b>${escapeHtml(s.value)}</b><span>${escapeHtml(s.label)}</span></div>`).join("");
}

function cleanText(text){
  return String(text ?? "")
    .replace(/https?:\/\/\S+/g," ")
    .replace(/#/g," ")
    .replace(/[^가-힣a-zA-Z0-9\s]/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function extractCandidates(){
  const stopwords = new Set([
    "일본","추천","쇼핑","돈키호테","브이로그","여행","구매","리뷰","하울","가격","진짜",
    "좋은","좋아요","입니다","그리고","제품","사용","영상","오늘","이번","소개","제가",
    "저는","너무","정말","그냥","하면","해서","있는","없는","같아요","합니다","있습니다",
    "여러분","com","https","http","www","식품","간식","과자","라멘","카레","푸딩"
  ]);
  const minLen = Number($("minWordLen").value || 2);
  const topN = Number($("topKeywordN").value || 500);
  const counter = new Map();

  for(const v of state.videos){
    const allText = cleanText([v.title, v.description, v.tags, v.commentsText].join(" "));
    for(const w of allText.split(/\s+/)){
      if(!w || w.length < minLen || w.length > 30) continue;
      if(/^\d+$/.test(w)) continue;
      if(stopwords.has(w)) continue;
      counter.set(w, (counter.get(w)||0)+1);
    }
  }
  state.candidate = [...counter.entries()]
    .map(([keyword,count])=>({keyword,count}))
    .sort((a,b)=>b.count-a.count)
    .slice(0, topN);
}

async function youtubeSearch(query){
  const key = $("youtubeKey").value.trim();
  if(!key) throw new Error("YouTube API Key를 입력하세요.");
  const maxResults = Number($("videoCount").value);
  const order = $("ytOrder").value;
  const regionCode = $("regionCode").value;
  const relevanceLanguage = $("relevanceLanguage").value;
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({
    key, q: query, part:"id", type:"video", maxResults, order, regionCode, relevanceLanguage
  });
  const res = await fetch(url);
  const data = await res.json();
  if(!res.ok) throw new Error(data.error?.message || "YouTube search error");
  return (data.items||[]).map(x=>x.id.videoId).filter(Boolean);
}

async function youtubeVideoDetails(ids){
  const key = $("youtubeKey").value.trim();
  const out=[];
  for(let i=0;i<ids.length;i+=50){
    const batch = ids.slice(i,i+50);
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.search = new URLSearchParams({key, part:"snippet,statistics", id:batch.join(",")});
    const res = await fetch(url);
    const data = await res.json();
    if(!res.ok) throw new Error(data.error?.message || "YouTube videos error");
    for(const item of data.items||[]){
      const sn=item.snippet||{}, st=item.statistics||{};
      out.push({
        video_id:item.id,
        title:sn.title||"",
        description:sn.description||"",
        tags:(sn.tags||[]).join("|"),
        published_at:sn.publishedAt||"",
        channel_title:sn.channelTitle||"",
        view_count:Number(st.viewCount||0),
        like_count:Number(st.likeCount||0),
        comment_count:Number(st.commentCount||0),
        commentsText:""
      });
    }
  }
  return out;
}

async function youtubeComments(videoId, maxComments){
  if(!maxComments) return "";
  const key = $("youtubeKey").value.trim();
  const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  url.search = new URLSearchParams({
    key, part:"snippet", videoId, maxResults:String(Math.min(maxComments,100)), order:"relevance", textFormat:"plainText"
  });
  const res = await fetch(url);
  const data = await res.json();
  if(!res.ok) return "";
  return (data.items||[]).map(x=>x.snippet?.topLevelComment?.snippet?.textDisplay || "").join(" ");
}

async function runYoutube(){
  try{
    $("runYoutubeBtn").disabled=true; $("runYoutubeBtn").textContent="수집 중...";
    let ids=[];
    for(const q of state.queries){
      const got = await youtubeSearch(q);
      ids.push(...got);
      await sleep(80);
    }
    ids=[...new Set(ids)];
    state.videos = await youtubeVideoDetails(ids);
    if($("collectComments").checked){
      const maxC = Number($("commentCount").value);
      for(let i=0;i<state.videos.length;i++){
        state.videos[i].commentsText = await youtubeComments(state.videos[i].video_id, maxC);
        await sleep(80);
      }
    }
    extractCandidates();
    renderYoutube();
  }catch(e){ alert(e.message); }
  finally{ $("runYoutubeBtn").disabled=false; $("runYoutubeBtn").textContent="🚀 크롤링 업데이트"; }
}

function renderYoutube(){
  renderStats("ytStats", [
    {label:"검색어 수", value:state.queries.length},
    {label:"수집 영상 수", value:state.videos.length},
    {label:"후보 키워드 수", value:state.candidate.length},
    {label:"총 조회수", value:state.videos.reduce((s,v)=>s+Number(v.view_count||0),0).toLocaleString()}
  ]);
  $("videosTable").innerHTML = toTable(state.videos, ["video_id","title","channel_title","view_count","comment_count","published_at"], 100);
  $("candidateTable").innerHTML = toTable(state.candidate, ["keyword","count"], 200);
  drawBar("keywordChart", state.candidate.slice(0,20).reverse(), "keyword", "count", "상위 키워드");
}

function drawBar(id, rows, labelKey, valueKey, label){
  if(charts[id]) charts[id].destroy();
  const ctx=$(id);
  charts[id]=new Chart(ctx,{type:"bar",data:{labels:rows.map(r=>r[labelKey]),datasets:[{label,data:rows.map(r=>Number(r[valueKey]||0))}]},options:{indexAxis:"y",responsive:true,plugins:{legend:{display:false}}}});
}

function buildGeminiPrompt(keywordList, excludeCategories){
  return `
너는 일본 이커머스 MD이자 상품 데이터 분류 전문가야.

아래 키워드들은 유튜브 영상 제목/설명/댓글에서 추출된 키워드야.
이 중 한국 온라인몰에서 취급할 만한 일본 제품/브랜드/캐릭터 IP 후보만 골라서 분류해줘.

중요 조건:
- ${excludeCategories}는 제외해.
- 한국 온라인몰에서 판매 가능한 일본 화장품, 드럭스토어 상품, 캐릭터 굿즈, 생활용품, 문구/잡화 중심으로 분류해.
- 확실하지 않으면 제외해.
- category는 아래 중 하나만 사용해: 화장품, 드럭스토어, 캐릭터/굿즈, 생활용품, 문구/잡화, 패션잡화
- product_group은 예: 스킨케어, 색조, 베이스, 선케어, 클렌징, 아이케어, 파스, 진통제, 감기약, 캐릭터굿즈, 피규어, 문구, 생활잡화 등으로 적어.
- brand를 모르면 빈 문자열 ""로 둬.
- item_name은 구체 상품명/캐릭터명/품목명이면 채워.
- 브랜드명만 있으면 item_name은 빈 문자열 ""로 둬.
- aliases에는 원본 키워드를 반드시 포함해.
- JSON 배열만 출력해. 설명 문장은 절대 쓰지 마.

출력 예시:
[
 {"category":"화장품","brand":"캔메이크","product_group":"색조","item_name":"","aliases":["캔메이크"]},
 {"category":"캐릭터/굿즈","brand":"산리오","product_group":"캐릭터굿즈","item_name":"쿠로미","aliases":["쿠로미"]}
]

키워드 목록:
${JSON.stringify(keywordList, null, 2)}
`;
}

async function runGemini(){
  try{
    const key=$("geminiKey").value.trim();
    if(!key) throw new Error("Gemini API Key를 입력하세요.");
    if(!state.candidate.length) throw new Error("candidate_df가 없습니다. 유튜브 크롤링 또는 CSV 업로드를 먼저 해주세요.");
    const minCount=Number($("geminiMinCount").value||5);
    const maxKeywords=Number($("geminiMaxKeywords").value||300);
    const keywords=state.candidate.filter(x=>Number(x.count)>=minCount).slice(0,maxKeywords).map(x=>x.keyword);
    const prompt=buildGeminiPrompt(keywords, $("excludeCategories").value);
    $("runGeminiBtn").disabled=true; $("runGeminiBtn").textContent="Gemini 분류 중...";
    const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})});
    const data=await res.json();
    if(!res.ok) throw new Error(data.error?.message || "Gemini API error");
    let text=data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text=text.replace(/```json/g,"").replace(/```/g,"").trim();
    const match=text.match(/\[[\s\S]*\]/);
    state.geminiDict=JSON.parse(match ? match[0] : text);
    renderGemini();
  }catch(e){ alert(e.message); }
  finally{ $("runGeminiBtn").disabled=false; $("runGeminiBtn").textContent="✨ Gemini 딕셔너리 생성"; }
}

function aliasList(x){
  if(Array.isArray(x)) return x;
  if(typeof x==="string"){
    try{ const parsed=JSON.parse(x.replace(/'/g,'"')); if(Array.isArray(parsed)) return parsed; }catch(e){}
    return x.split("|").map(v=>v.trim()).filter(Boolean);
  }
  return [];
}

function buildProductRank(){
  if(!state.geminiDict.length) { alert("Gemini 딕셔너리가 없습니다."); return; }
  if(!state.videos.length) { alert("영상 원본 데이터가 없습니다. videos CSV를 업로드하거나 유튜브 크롤링을 먼저 해주세요."); return; }
  const mentionRows=[];
  for(const v of state.videos){
    const text=cleanText([v.title,v.description,v.tags,v.commentsText].join(" ")).toLowerCase();
    for(const item of state.geminiDict){
      let count=0, matched=[];
      for(const alias of aliasList(item.aliases)){
        const a=String(alias).toLowerCase().trim();
        if(!a) continue;
        const c=(text.match(new RegExp(escapeRegex(a), "g"))||[]).length;
        if(c>0){ count+=c; matched.push(alias); }
      }
      if(count>0){
        mentionRows.push({
          category:item.category||"", brand:item.brand||"", product_group:item.product_group||"", item_name:item.item_name||"",
          matched_aliases:[...new Set(matched)].join(", "), mention_count_in_video:count,
          video_id:v.video_id, title:v.title, view_count:Number(v.view_count||0), like_count:Number(v.like_count||0), comment_count:Number(v.comment_count||0),
          published_at:v.published_at, channel_title:v.channel_title
        });
      }
    }
  }
  const groups=new Map();
  for(const r of mentionRows){
    const key=[r.category,r.brand,r.product_group,r.item_name].join("||");
    if(!groups.has(key)) groups.set(key,{category:r.category,brand:r.brand,product_group:r.product_group,item_name:r.item_name,mention_count:0,videoIds:new Set(),total_view_count:0,total_like_count:0,total_comment_count:0,aliases:new Set()});
    const g=groups.get(key);
    g.mention_count+=r.mention_count_in_video;
    g.videoIds.add(r.video_id);
    g.total_view_count+=Number(r.view_count||0);
    g.total_like_count+=Number(r.like_count||0);
    g.total_comment_count+=Number(r.comment_count||0);
    r.matched_aliases.split(", ").forEach(a=>a&&g.aliases.add(a));
  }
  state.productRank=[...groups.values()].map(g=>({
    category:g.category,brand:g.brand,product_group:g.product_group,item_name:g.item_name,
    mention_count:g.mention_count,video_count:g.videoIds.size,total_view_count:g.total_view_count,
    avg_view_count:g.videoIds.size?Math.round(g.total_view_count/g.videoIds.size):0,
    total_like_count:g.total_like_count,total_comment_count:g.total_comment_count,
    matched_aliases:[...g.aliases].join(", ")
  }));
  const maxView=Math.max(...state.productRank.map(x=>x.total_view_count),1);
  const maxMention=Math.max(...state.productRank.map(x=>x.mention_count),1);
  const maxVideo=Math.max(...state.productRank.map(x=>x.video_count),1);
  state.productRank.forEach(x=>{
    x.view_score=x.total_view_count/maxView*100;
    x.mention_score=x.mention_count/maxMention*100;
    x.video_score=x.video_count/maxVideo*100;
    x.sns_score=x.mention_score*0.5+x.video_score*0.3+x.view_score*0.2;
  });
  state.productRank.sort((a,b)=>b.sns_score-a.sns_score);
  state.productRank.forEach((x,i)=>{x.sns_rank=i+1});
  renderGemini();
}
function escapeRegex(s){return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}

function renderGemini(){
  renderStats("geminiStats", [
    {label:"후보 키워드", value:state.candidate.length},
    {label:"Gemini 딕셔너리", value:state.geminiDict.length},
    {label:"상품 랭킹", value:state.productRank.length},
    {label:"랭킹 총 조회수", value:state.productRank.reduce((s,x)=>s+Number(x.total_view_count||0),0).toLocaleString()}
  ]);
  $("geminiTable").innerHTML=toTable(state.geminiDict, ["category","brand","product_group","item_name","aliases"], 300);
  $("rankTable").innerHTML=toTable(state.productRank, ["sns_rank","category","brand","product_group","item_name","mention_count","video_count","total_view_count","sns_score"], 300);
  drawBar("rankChart", state.productRank.slice(0,20).reverse(), "brand", "sns_score", "SNS Score");
}

function makeSearchKeyword(row){
  const category=String(row.category||"").trim(), brand=String(row.brand||"").trim(), group=String(row.product_group||"").trim(), item=String(row.item_name||"").trim();
  if(brand && item) return `${brand} ${item}`;
  if(item) return `일본 ${item}`;
  if(category==="캐릭터/굿즈" && brand) return `${brand} 굿즈`;
  if(brand && group) return `${brand} ${group}`;
  if(brand) return brand;
  if(group) return `일본 ${group}`;
  return "";
}

async function runNaver(){
  try{
    const clientId=$("naverClientId").value.trim(), secret=$("naverClientSecret").value.trim();
    if(!clientId || !secret) throw new Error("Naver Client ID/Secret을 입력하세요.");
    if(!state.productRank.length) throw new Error("product_rank 데이터가 없습니다.");
    const topN=Number($("naverTopN").value||100), display=Number($("naverDisplay").value||50), sort=$("naverSort").value, delay=Number($("naverDelay").value||300);
    const targets=state.productRank.slice().sort((a,b)=>(a.sns_rank||999)-(b.sns_rank||999)).slice(0,topN).map(r=>({...r, search_keyword:makeSearchKeyword(r)})).filter(r=>r.search_keyword);
    const seen=new Set(); const unique=targets.filter(r=>!seen.has(r.search_keyword)&&seen.add(r.search_keyword));
    state.naverRaw=[];
    $("runNaverBtn").disabled=true; $("runNaverBtn").textContent="네이버 조회 중...";
    for(const row of unique){
      const url=new URL("https://openapi.naver.com/v1/search/shop.json");
      url.search=new URLSearchParams({query:row.search_keyword, display:String(display), start:"1", sort, exclude:"used:rental"});
      const res=await fetch(url,{headers:{"X-Naver-Client-Id":clientId,"X-Naver-Client-Secret":secret}});
      if(!res.ok) throw new Error("네이버 API 호출 실패: 브라우저 CORS 차단 가능성이 큽니다. Colab 또는 Netlify Functions 프록시가 필요합니다.");
      const data=await res.json();
      for(const item of data.items||[]){
        state.naverRaw.push({
          search_keyword:row.search_keyword, product_name:stripHtml(item.title||""), lowest_price:Number(item.lprice||0),
          highest_price:Number(item.hprice||0), mall_name:item.mallName||"", brand_from_naver:item.brand||"", maker:item.maker||"",
          category1:item.category1||"", category2:item.category2||"", category3:item.category3||"", category4:item.category4||"",
          product_id:item.productId||"", link:item.link||"", collected_at:new Date().toISOString(),
          sns_rank:row.sns_rank, yt_category:row.category, yt_brand:row.brand, yt_product_group:row.product_group, yt_item_name:row.item_name,
          yt_mention_count:row.mention_count, yt_video_count:row.video_count, yt_total_view_count:row.total_view_count, yt_sns_score:row.sns_score
        });
      }
      await sleep(delay);
    }
    postProcessNaver();
  }catch(e){ alert(e.message); }
  finally{ $("runNaverBtn").disabled=false; $("runNaverBtn").textContent="🔎 네이버 쇼핑 조회"; }
}
function stripHtml(s){return String(s).replace(/<.*?>/g,"");}
function postProcessNaver(){
  const raw=state.naverRaw.filter(x=>Number(x.lowest_price)>0);
  const keySet=new Set(); state.naverRaw=raw.filter(x=>{const k=x.search_keyword+"||"+x.product_id; if(keySet.has(k)) return false; keySet.add(k); return true;});
  state.naverTop10=[];
  const byKw=groupBy(state.naverRaw,"search_keyword");
  Object.values(byKw).forEach(rows=>state.naverTop10.push(...rows.slice().sort((a,b)=>a.lowest_price-b.lowest_price).slice(0,10)));
  state.naverSummary=Object.entries(byKw).map(([kw,rows])=>{
    const prices=rows.map(r=>Number(r.lowest_price)).filter(Boolean).sort((a,b)=>a-b);
    const first=rows[0]||{};
    return {
      sns_rank:first.sns_rank, yt_category:first.yt_category, yt_brand:first.yt_brand, yt_product_group:first.yt_product_group, yt_item_name:first.yt_item_name,
      search_keyword:kw, naver_product_count:new Set(rows.map(r=>r.product_id)).size,
      min_price:prices[0]||0, avg_price:Math.round(prices.reduce((a,b)=>a+b,0)/(prices.length||1)), median_price:prices[Math.floor(prices.length/2)]||0,
      max_price:prices[prices.length-1]||0, mall_count:new Set(rows.map(r=>r.mall_name)).size,
      yt_mention_count:first.yt_mention_count, yt_video_count:first.yt_video_count, yt_total_view_count:first.yt_total_view_count, yt_sns_score:first.yt_sns_score
    };
  }).sort((a,b)=>(a.sns_rank||999)-(b.sns_rank||999));
  renderNaver();
}
function groupBy(rows,key){return rows.reduce((acc,r)=>{(acc[r[key]] ||= []).push(r); return acc;},{});}
function renderNaver(){
  renderStats("naverStats", [
    {label:"수집 상품 수", value:state.naverRaw.length},
    {label:"검색어 수", value:state.naverSummary.length},
    {label:"최저가 TOP10 행", value:state.naverTop10.length},
    {label:"평균 최저가", value:Math.round(state.naverSummary.reduce((s,x)=>s+Number(x.min_price||0),0)/(state.naverSummary.length||1)).toLocaleString()+"원"}
  ]);
  $("naverRawTable").innerHTML=toTable(state.naverRaw, ["search_keyword","product_name","lowest_price","mall_name","category1","category2"], 200);
  $("naverSummaryTable").innerHTML=toTable(state.naverSummary, ["sns_rank","search_keyword","naver_product_count","min_price","avg_price","mall_count"], 200);
  drawBar("naverChart", state.naverSummary.slice(0,20).reverse(), "search_keyword", "min_price", "최저가");
}

function bind(){
  document.querySelectorAll(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>setPage(btn.dataset.page)));
  $("saveKeysBtn").addEventListener("click",saveKeys);
  $("addQueryBtn").addEventListener("click",()=>{const v=$("newQueryInput").value.trim(); if(v&&!state.queries.includes(v)){state.queries.push(v); $("newQueryInput").value=""; renderQueries();}});
  $("deleteQueryBtn").addEventListener("click",()=>{const selected=[...$("deleteQuerySelect").selectedOptions].map(o=>o.value); state.queries=state.queries.filter(q=>!selected.includes(q)); renderQueries();});
  $("videoCount").addEventListener("input",()=>{$("videoCountLabel").textContent=$("videoCount").value});
  $("commentCount").addEventListener("input",()=>{$("commentCountLabel").textContent=$("commentCount").value});
  $("runYoutubeBtn").addEventListener("click",runYoutube);
  $("downloadVideosBtn").addEventListener("click",()=>downloadCsv("youtube_videos.csv", state.videos));
  $("downloadCandidateBtn").addEventListener("click",()=>downloadCsv("YT_candidate_df.csv", state.candidate));
  $("uploadVideosCsv").addEventListener("change",async e=>{state.videos=await readCsvFile(e.target.files[0]); extractCandidates(); renderYoutube();});
  $("uploadCandidateCsv").addEventListener("change",async e=>{state.candidate=(await readCsvFile(e.target.files[0])).map(r=>({...r,count:Number(r.count||0)})); renderYoutube(); renderGemini();});
  $("runGeminiBtn").addEventListener("click",runGemini);
  $("buildRankBtn").addEventListener("click",buildProductRank);
  $("downloadGeminiDictBtn").addEventListener("click",()=>downloadCsv("YT_gemini_classified_keywords.csv", state.geminiDict));
  $("downloadProductRankBtn").addEventListener("click",()=>downloadCsv("YT_product_rank_final_gemini.csv", state.productRank));
  $("uploadGeminiCsv").addEventListener("change",async e=>{state.geminiDict=await readCsvFile(e.target.files[0]); renderGemini();});
  $("uploadRankCsv").addEventListener("change",async e=>{state.productRank=(await readCsvFile(e.target.files[0])).map((r,i)=>({...r,sns_rank:Number(r.sns_rank||i+1),sns_score:Number(r.sns_score||0),total_view_count:Number(r.total_view_count||0),mention_count:Number(r.mention_count||0),video_count:Number(r.video_count||0)})); renderGemini(); renderNaver();});
  $("runNaverBtn").addEventListener("click",runNaver);
  $("downloadNaverRawBtn").addEventListener("click",()=>downloadCsv("naver_shopping_raw_from_yt_rank.csv", state.naverRaw));
  $("downloadNaverTop10Btn").addEventListener("click",()=>downloadCsv("naver_shopping_lowest_top10_from_yt_rank.csv", state.naverTop10));
  $("downloadNaverSummaryBtn").addEventListener("click",()=>downloadCsv("naver_shopping_summary_from_yt_rank.csv", state.naverSummary));
}
loadKeys(); bind(); renderQueries(); renderYoutube(); renderGemini(); renderNaver();
