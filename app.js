const state = {
  topics: [],
  researchers: [],
  papers: [],
  libraryPage: 1,
  libraryPages: 1,
  selectedNode: null,
  graph: null,
  graphPositions: new Map(),
  graphTransform: { x: 0, y: 0, scale: 1 },
};

const staticDemoMode =
  window.location.hostname.endsWith(".github.io") ||
  window.location.protocol === "file:" ||
  new URLSearchParams(window.location.search).get("demo") === "1";

const $ = (selector) => document.querySelector(selector);

async function api(path) {
  if (staticDemoMode) {
    if (typeof window.demoApi !== "function") throw new Error("靜態 Demo 資料層未載入");
    return window.demoApi(path);
  }
  const response = await fetch(path);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "API error");
  return payload;
}

function activate(viewId) {
  document.querySelectorAll(".view").forEach((item) => item.classList.toggle("is-visible", item.id === viewId));
  document.querySelectorAll(".nav-button").forEach((item) => item.classList.toggle("is-active", item.dataset.view === viewId));
  if (viewId === "dashboardView") loadDashboard();
}

function optionList(items, valueKey = "id", labelKey = "name") {
  return items.map((item) => `<option value="${item[valueKey]}">${escapeHtml(item[labelKey])}</option>`).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function card(title, meta, body = "", actions = "") {
  return `<article class="card"><h4>${escapeHtml(title)}</h4>${meta ? `<p class="meta">${meta}</p>` : ""}${body}${actions}</article>`;
}

function tags(items) {
  return `<div class="tag-row">${items.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}</div>`;
}

async function init() {
  document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => activate(button.dataset.view)));
  $("#searchButton").addEventListener("click", runSearch);
  $("#searchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") runSearch();
  });
  $("#topicSelect").addEventListener("change", loadTopic);
  $("#researcherSelect").addEventListener("change", loadProfile);
  $("#graphLoad").addEventListener("click", loadGraph);
  $("#graphType").addEventListener("change", () => state.graph && drawGraph(state.graph, false));
  $("#graphZoomIn").addEventListener("click", () => zoomGraph(1.2));
  $("#graphZoomOut").addEventListener("click", () => zoomGraph(1 / 1.2));
  $("#graphReset").addEventListener("click", resetGraphView);
  $("#dashboardRefresh").addEventListener("click", loadDashboard);
  $("#pathButton").addEventListener("click", loadPath);
  $("#paperSelect").addEventListener("change", loadPaper);
  $("#libraryLoad").addEventListener("click", () => loadLibrary(1));
  $("#libraryQuery").addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadLibrary(1);
  });
  $("#libraryPrev").addEventListener("click", () => loadLibrary(state.libraryPage - 1));
  $("#libraryNext").addEventListener("click", () => loadLibrary(state.libraryPage + 1));

  const [health, bootstrap] = await Promise.all([api("/api/health"), api("/api/bootstrap")]);
  state.topics = bootstrap.topics;
  state.researchers = bootstrap.researchers;
  state.papers = bootstrap.papers;
  const source = health.metadata?.source ? ` · 來源 ${health.metadata.source}` : "";
  const fallback = health.mode === "json-fallback" ? ` · Neo4j 無法連線，目前使用 JSON 備援` : "";
  $("#healthPanel").textContent = health.mode === "github-pages-demo"
    ? `GitHub Pages Demo，收錄 ${health.counts.researchers} 位研究者、${health.counts.papers} 篇論文、${health.counts.relationships} 條關係${source} · OpenAlex 靜態快照。`
    : `API 正常 (${health.mode})，收錄 ${health.counts.researchers} 位研究者、${health.counts.papers} 篇論文、${health.counts.relationships} 條關係${source}${fallback}。`;
  $("#topicSelect").innerHTML = optionList(state.topics);
  $("#libraryTopic").innerHTML = `<option value="">全部主題</option>${optionList(state.topics)}`;
  $("#researcherSelect").innerHTML = optionList(state.researchers);
  $("#sourceResearcher").innerHTML = optionList(state.researchers);
  $("#targetResearcher").innerHTML = optionList(state.researchers);
  $("#targetResearcher").selectedIndex = Math.min(3, state.researchers.length - 1);
  $("#graphStart").innerHTML = optionList(state.researchers);

  await loadPaperChoices();
  await Promise.allSettled([runSearch(), loadLibrary(), loadTopic(), loadProfile(), loadGraph(), loadPath(), loadPaper(), loadDashboard()]);
}

async function loadDashboard() {
  const analytics = await api("/api/analytics/trends");
  const summary = analytics.summary;
  const oaRate = summary.papers ? Math.round((summary.openAccess / summary.papers) * 100) : 0;
  $("#dashboardMetrics").innerHTML = [
    [Number(summary.papers || 0).toLocaleString(), "收錄論文"],
    [Number(summary.citations || 0).toLocaleString(), "總引用"],
    [Number(summary.averageCitations || 0).toFixed(1), "平均引用"],
    [`${oaRate}%`, "Open Access"],
  ].map(([value, label]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join("");
  renderBars("#yearChart", analytics.years.slice(-12), "year", "papers", (item) => `${item.papers} 篇`);
  renderBars("#topicChart", analytics.topics, "name", "papers", (item) => `${item.papers} 篇`);
}

function renderBars(selector, items, labelKey, valueKey, formatValue) {
  const maximum = Math.max(1, ...items.map((item) => Number(item[valueKey]) || 0));
  $(selector).innerHTML = items.map((item) => `
    <div class="bar-row" title="${escapeHtml(item[labelKey])}: ${escapeHtml(formatValue(item))}">
      <span class="bar-label">${escapeHtml(item[labelKey])}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.max(1, (Number(item[valueKey]) / maximum) * 100)}%"></span></span>
      <strong>${escapeHtml(formatValue(item))}</strong>
    </div>`).join("") || `<div class="empty">尚無趨勢資料</div>`;
}

async function loadLibrary(page = 1) {
  const params = new URLSearchParams({
    q: $("#libraryQuery").value.trim(),
    topic: $("#libraryTopic").value,
    yearFrom: $("#libraryYearFrom").value || "0",
    yearTo: $("#libraryYearTo").value || "9999",
    sort: $("#librarySort").value,
    page: String(Math.max(1, page)),
    limit: "24",
  });
  const result = await api(`/api/papers?${params}`);
  state.libraryPage = result.page;
  state.libraryPages = result.pages;
  $("#librarySummary").textContent = `符合條件 ${result.total} 篇論文`;
  $("#libraryResults").innerHTML = result.items.length
    ? result.items.map(renderPaperCard).join("")
    : `<div class="empty">沒有符合條件的論文</div>`;
  $("#libraryPage").textContent = `第 ${result.page} / ${result.pages} 頁`;
  $("#libraryPrev").disabled = result.page <= 1;
  $("#libraryNext").disabled = result.page >= result.pages;
}

async function loadPaperChoices() {
  $("#paperSelect").innerHTML = state.papers
    .map((paper) => `<option value="${paper.id}">${paper.year || "n.d."} · ${escapeHtml(paper.title)}</option>`)
    .join("");
}

async function runSearch() {
  const query = encodeURIComponent($("#searchInput").value.trim());
  const result = await api(`/api/search?q=${query}`);
  const columns = [
    ["Researcher", result.researchers, renderResearcherCard],
    ["Paper", result.papers, renderPaperCard],
    ["Topic", result.topics, renderTopicCard],
  ];
  $("#searchResults").innerHTML = columns
    .map(([title, items, renderer]) => `<section><h3>${title}</h3><div class="stack">${items.length ? items.map(renderer).join("") : `<div class="empty">沒有符合結果</div>`}</div></section>`)
    .join("");
}

function renderResearcherCard(item) {
  const meta = `${escapeHtml(item.title || "Researcher")} · ${escapeHtml(item.institution || "")}`;
  return card(item.name, meta, `<p>${item.paperCount} 篇收錄論文</p>`, `<div class="tag-row"><button onclick="selectResearcher('${item.id}')">開啟 Profile</button><button onclick="selectGraph('${item.id}')">探索圖譜</button></div>`);
}

function renderPaperCard(item) {
  const meta = `${item.year || "n.d."} · ${escapeHtml(item.conference || "")}`;
  const sourceUrl = safeUrl(item.sourceUrl);
  const actions = `<div class="tag-row"><button onclick="selectPaper('${item.id}')">查看推薦</button>${sourceUrl ? `<a class="button-link secondary" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">OpenAlex</a>` : ""}</div>`;
  return card(item.title || item.name, meta, `<p>全球引用 ${item.citationCount ?? 0} 次${item.isOpenAccess ? " · Open Access" : ""}</p>`, actions);
}

function renderTopicCard(item) {
  return card(item.name, "Topic", `<p>${escapeHtml(item.description || "")}</p>`, `<div class="tag-row"><button onclick="selectTopic('${item.id}')">開啟 Topic</button></div>`);
}

async function loadTopic() {
  const id = $("#topicSelect").value;
  const result = await api(`/api/topics/${id}/researchers?limit=12`);
  $("#topicResearchers").innerHTML = result.researchers.map((item) => {
    const meta = `Topic score ${item.topicScore.toFixed(2)} · ${item.relatedPapers} 篇相關論文`;
    return card(item.name, meta, `<p>${escapeHtml(item.institution)}</p>`, `<button onclick="selectResearcher('${item.id}')">Profile</button>`);
  }).join("");
  $("#topicPapers").innerHTML = result.papers.map(renderPaperCard).join("");
}

async function loadProfile() {
  const id = $("#researcherSelect").value;
  const profile = await api(`/api/researchers/${id}`);
  const topicNames = profile.topics.map((topic) => `${topic.name} (${topic.papers})`);
  $("#profilePanel").innerHTML = `
    <div class="profile-grid">
      <section class="profile-main">
        <p class="eyebrow">${escapeHtml(profile.title || "Researcher")}</p>
        <h2>${escapeHtml(profile.name)}</h2>
        <p class="meta">${escapeHtml(profile.institution?.name || "")} · ${escapeHtml(profile.institution?.country || "")}</p>
        <div class="metric-row">
          <div class="metric"><strong>${profile.papers.length}</strong><span>論文</span></div>
          <div class="metric"><strong>${profile.topics.length}</strong><span>主題</span></div>
          <div class="metric"><strong>${profile.coauthors.length}</strong><span>合作者</span></div>
        </div>
        <h3>研究主題</h3>
        ${tags(topicNames)}
        <h3>代表論文</h3>
        <div class="stack">${profile.papers.map(renderPaperCard).join("")}</div>
      </section>
      <aside class="profile-side">
        <h3>主要合作者</h3>
        <div class="stack">${profile.coauthors.map((item) => card(item.name, `${item.collaborations} 次共同發表`, `<p>${escapeHtml(item.institution)}</p>`, `<button onclick="selectResearcher('${item.id}')">Profile</button>`)).join("")}</div>
      </aside>
    </div>`;
}

async function loadGraph() {
  const id = $("#graphStart").value;
  const depth = $("#graphDepth").value;
  const graph = await api(`/api/researchers/${id}/network?depth=${depth}&limit=90`);
  state.graph = graph;
  drawGraph(graph, true);
}

function graphLayout(graph, width, height) {
  const positions = new Map();
  const nodes = graph.nodes;
  nodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, nodes.length);
    const radius = 120 + (index % 5) * 24;
    positions.set(node.id, { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius });
  });
  for (let iteration = 0; iteration < 70; iteration += 1) {
    const forces = new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]));
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = positions.get(nodes[i].id);
        const b = positions.get(nodes[j].id);
        const dx = a.x - b.x || 0.01;
        const dy = a.y - b.y || 0.01;
        const distance2 = Math.max(100, dx * dx + dy * dy);
        const force = 1300 / distance2;
        forces.get(nodes[i].id).x += dx * force;
        forces.get(nodes[i].id).y += dy * force;
        forces.get(nodes[j].id).x -= dx * force;
        forces.get(nodes[j].id).y -= dy * force;
      }
    }
    graph.edges.forEach((edge) => {
      const a = positions.get(edge.source);
      const b = positions.get(edge.target);
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const force = (distance - 115) * 0.012;
      forces.get(edge.source).x += (dx / distance) * force;
      forces.get(edge.source).y += (dy / distance) * force;
      forces.get(edge.target).x -= (dx / distance) * force;
      forces.get(edge.target).y -= (dy / distance) * force;
    });
    nodes.forEach((node) => {
      const point = positions.get(node.id);
      const force = forces.get(node.id);
      point.x = Math.max(50, Math.min(width - 50, point.x + force.x * 0.45));
      point.y = Math.max(50, Math.min(height - 50, point.y + force.y * 0.45));
    });
  }
  return positions;
}

function graphLabelLines(value, maxLength = 20) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [""];
  for (const word of words) {
    const candidate = `${lines.at(-1)} ${word}`.trim();
    if (candidate.length <= 10 || lines.length === 1 && !lines[0]) lines[lines.length - 1] = candidate;
    else if (lines.length < 2) lines.push(word);
    else break;
  }
  const consumed = lines.join(" ").length;
  if (String(value).trim().length > consumed || lines.join(" ").length > maxLength) {
    lines[lines.length - 1] = `${lines.at(-1).slice(0, 8)}...`;
  }
  return lines.slice(0, 2);
}

function drawGraph(graph, recompute = false) {
  const canvas = $("#graphCanvas");
  canvas.innerHTML = "";
  const width = Math.max(760, canvas.clientWidth || 900);
  const height = 620;
  if (recompute || state.graphPositions.size === 0) state.graphPositions = graphLayout(graph, width, height);
  const type = $("#graphType").value;
  const nodes = graph.nodes.filter((node) => type === "All" || node.label === type);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "graph-svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMin meet");
  const viewport = document.createElementNS(svg.namespaceURI, "g");
  viewport.setAttribute("class", "graph-viewport");
  svg.appendChild(viewport);
  canvas.appendChild(svg);

  const render = () => {
    viewport.innerHTML = "";
    const transform = state.graphTransform;
    viewport.setAttribute("transform", `translate(${transform.x} ${transform.y}) scale(${transform.scale})`);
    edges.forEach((edge) => {
      const a = state.graphPositions.get(edge.source);
      const b = state.graphPositions.get(edge.target);
      if (!a || !b) return;
      const line = document.createElementNS(svg.namespaceURI, "line");
      line.setAttribute("class", "graph-link");
      line.setAttribute("x1", a.x); line.setAttribute("y1", a.y); line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
      viewport.appendChild(line);
    });
    nodes.forEach((node) => {
      const point = state.graphPositions.get(node.id);
      if (!point) return;
      const group = document.createElementNS(svg.namespaceURI, "g");
      group.setAttribute("class", "graph-svg-node");
      group.setAttribute("data-label", node.label);
      group.setAttribute("transform", `translate(${point.x} ${point.y})`);
      const circle = document.createElementNS(svg.namespaceURI, "circle");
      circle.setAttribute("r", node.label === "Paper" ? 30 : 25);
      const label = document.createElementNS(svg.namespaceURI, "text");
      const lines = graphLabelLines(node.name);
      label.setAttribute("y", lines.length === 1 ? "3" : "-4");
      lines.forEach((line, index) => {
        const tspan = document.createElementNS(svg.namespaceURI, "tspan");
        tspan.setAttribute("x", "0");
        tspan.setAttribute("dy", index === 0 ? "0" : "10");
        tspan.textContent = line;
        label.appendChild(tspan);
      });
      const title = document.createElementNS(svg.namespaceURI, "title");
      title.textContent = node.name || node.id;
      group.append(circle, label, title);
      group.addEventListener("click", () => showNode(node));
      group.addEventListener("pointerdown", (event) => startNodeDrag(event, node.id, svg, render));
      viewport.appendChild(group);
    });
  };
  setupGraphPanZoom(svg, render);
  render();
  if (nodes[0]) showNode(nodes[0]);
}

function setupGraphPanZoom(svg, render) {
  let pan = null;
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomGraph(event.deltaY < 0 ? 1.1 : 1 / 1.1, render);
  }, { passive: false });
  svg.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".graph-svg-node")) return;
    pan = { x: event.clientX, y: event.clientY, tx: state.graphTransform.x, ty: state.graphTransform.y };
    svg.setPointerCapture(event.pointerId);
    $("#graphCanvas").classList.add("is-panning");
  });
  svg.addEventListener("pointermove", (event) => {
    if (!pan) return;
    state.graphTransform.x = pan.tx + event.clientX - pan.x;
    state.graphTransform.y = pan.ty + event.clientY - pan.y;
    render();
  });
  const stop = () => { pan = null; $("#graphCanvas").classList.remove("is-panning"); };
  svg.addEventListener("pointerup", stop);
  svg.addEventListener("pointercancel", stop);
}

function startNodeDrag(event, nodeId, svg, render) {
  event.stopPropagation();
  const start = { x: event.clientX, y: event.clientY, point: { ...state.graphPositions.get(nodeId) } };
  const move = (moveEvent) => {
    const scale = state.graphTransform.scale;
    state.graphPositions.set(nodeId, { x: start.point.x + (moveEvent.clientX - start.x) / scale, y: start.point.y + (moveEvent.clientY - start.y) / scale });
    render();
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}

function zoomGraph(factor, renderCallback) {
  state.graphTransform.scale = Math.max(0.35, Math.min(2.5, state.graphTransform.scale * factor));
  if (renderCallback) renderCallback();
  else if (state.graph) drawGraph(state.graph, false);
}

function resetGraphView() {
  state.graphTransform = { x: 0, y: 0, scale: 1 };
  if (state.graph) drawGraph(state.graph, false);
}

function showNode(node) {
  state.selectedNode = node;
  $("#nodeDetails").innerHTML = `
    <p class="eyebrow">${escapeHtml(node.label)}</p>
    <h3>${escapeHtml(node.name)}</h3>
    <p class="meta">ID: ${escapeHtml(node.id)}</p>
    ${node.description ? `<p>${escapeHtml(node.description)}</p>` : ""}
    ${node.institution ? `<p>${escapeHtml(node.institution)}</p>` : ""}
    ${node.year ? `<p>${node.year} · ${escapeHtml(node.conference || "")}</p>` : ""}
    <div class="tag-row">${node.label === "Researcher" ? `<button onclick="selectResearcher('${node.id}')">Profile</button>` : ""}${node.label === "Paper" ? `<button onclick="selectPaper('${node.id}')">Paper</button>` : ""}</div>`;
}

async function loadPath() {
  const source = $("#sourceResearcher").value;
  const target = $("#targetResearcher").value;
  const path = await api(`/api/researchers/path?source=${source}&target=${target}`);
  $("#pathPanel").innerHTML = `
    <p class="meta">${escapeHtml(path.explanation)}</p>
    <div class="path-list">
      ${path.nodes.map((node, index) => `<span class="path-chip">${escapeHtml(node.name)}<small> ${escapeHtml(node.label)}</small></span>${index < path.edges.length ? `<span class="arrow">${escapeHtml(path.edges[index].type)} -></span>` : ""}`).join("")}
    </div>`;
}

async function loadPaper() {
  const id = $("#paperSelect").value;
  const [paper, recs] = await Promise.all([api(`/api/papers/${id}`), api(`/api/papers/${id}/recommendations?k=5`)]);
  const sourceUrl = safeUrl(paper.sourceUrl);
  const landingPageUrl = safeUrl(paper.landingPageUrl);
  const pdfUrl = safeUrl(paper.pdfUrl);
  $("#paperPanel").innerHTML = `
    <p class="eyebrow">${escapeHtml(paper.conference?.type || "Paper")}</p>
    <h2>${escapeHtml(paper.title)}</h2>
    <p class="meta">${paper.year || "n.d."} · ${escapeHtml(paper.conference?.name || "")} · ${escapeHtml(paper.doi || "")}</p>
    <p>${escapeHtml(paper.abstract || "")}</p>
    <h3>作者</h3>
    ${tags(paper.authors.map((item) => item.name))}
    <h3>主題</h3>
    ${tags(paper.topics.map((topic) => `${topic.name} ${topic.score.toFixed(2)}`))}
    <div class="tag-row">
      ${sourceUrl ? `<a class="button-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">OpenAlex</a>` : ""}
      ${landingPageUrl ? `<a class="button-link secondary" href="${escapeHtml(landingPageUrl)}" target="_blank" rel="noreferrer">出版頁面</a>` : ""}
      ${pdfUrl ? `<a class="button-link secondary" href="${escapeHtml(pdfUrl)}" target="_blank" rel="noreferrer">PDF</a>` : ""}
    </div>
    <h3>引用資訊</h3>
    <p class="meta">全球引用 ${paper.citationCount ?? 0} 次 · 資料集內引用 ${paper.cites.length} 篇 · 資料集內被引用 ${paper.citedBy.length} 篇</p>`;
  $("#recommendations").innerHTML = recs.recommendations.map((item) => {
    const breakdown = `混合 ${Number(item.score || 0).toFixed(3)} · 語意 ${Number(item.vectorScore || 0).toFixed(3)} · 圖譜 ${Number(item.graphScore || 0).toFixed(3)}`;
    return card(item.title, `${breakdown} · ${item.year}`, `<p>${item.reasons.map(escapeHtml).join("<br>")}</p>`, `<button onclick="selectPaper('${item.id}')">查看</button>`);
  }).join("");
}

window.selectResearcher = async (id) => {
  $("#researcherSelect").value = id;
  $("#graphStart").value = id;
  activate("profileView");
  await loadProfile();
};

window.selectGraph = async (id) => {
  $("#graphStart").value = id;
  activate("graphView");
  await loadGraph();
};

window.selectTopic = async (id) => {
  $("#topicSelect").value = id;
  activate("topicView");
  await loadTopic();
};

window.selectPaper = async (id) => {
  const select = $("#paperSelect");
  if (![...select.options].some((option) => option.value === id)) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    select.appendChild(option);
  }
  select.value = id;
  activate("paperView");
  await loadPaper();
};

init().catch((error) => {
  $("#healthPanel").textContent = `啟動失敗：${error.message}`;
  console.error(error);
});
