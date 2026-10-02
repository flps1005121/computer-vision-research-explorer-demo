(function attachDemoApi(global) {
  "use strict";

  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const numberParam = (params, key, fallback) => {
    const value = Number.parseInt(params.get(key) || "", 10);
    return Number.isFinite(value) ? value : fallback;
  };
  const addIndex = (index, key, value) => {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(value);
  };
  const compareText = (left, right) => String(left || "").localeCompare(String(right || ""), "en");

  class DemoGraphStore {
    constructor(data) {
      this.data = data;
      this.researchers = new Map(data.researchers.map((item) => [item.id, item]));
      this.papers = new Map(data.papers.map((item) => [item.id, item]));
      this.topics = new Map(data.topics.map((item) => [item.id, item]));
      this.venues = new Map(data.venues.map((item) => [item.id, item]));
      this.institutions = new Map(data.institutions.map((item) => [item.id, item]));
      this.paperAuthors = new Map();
      this.researcherPapers = new Map();
      this.paperTopics = new Map();
      this.topicPapers = new Map();
      this.outCites = new Map();
      this.inCites = new Map();
      this.paperEmbeddings = data._demo?.paperEmbeddings || {};
      this.buildIndexes();
    }

    buildIndexes() {
      for (const edge of this.data.authored) {
        addIndex(this.paperAuthors, edge.paperId, edge);
        addIndex(this.researcherPapers, edge.researcherId, edge);
      }
      for (const index of [this.paperAuthors, this.researcherPapers]) {
        for (const rows of index.values()) rows.sort((a, b) => (a.authorOrder || 999) - (b.authorOrder || 999));
      }
      for (const edge of this.data.hasTopic) {
        addIndex(this.paperTopics, edge.paperId, edge);
        addIndex(this.topicPapers, edge.topicId, edge);
      }
      for (const edge of this.data.cites) {
        addIndex(this.outCites, edge.sourcePaperId, edge.targetPaperId);
        addIndex(this.inCites, edge.targetPaperId, edge.sourcePaperId);
      }
    }

    rows(index, key) {
      return index.get(key) || [];
    }

    health() {
      const relationships =
        this.data.authored.length +
        this.data.hasTopic.length +
        this.data.cites.length +
        this.data.researchers.filter((item) => item.institutionId).length +
        this.data.papers.filter((item) => item.venueId).length;
      return {
        status: "ok",
        mode: "github-pages-demo",
        metadata: this.data.metadata || {},
        counts: {
          researchers: this.researchers.size,
          papers: this.papers.size,
          topics: this.topics.size,
          venues: this.venues.size,
          institutions: this.institutions.size,
          relationships,
        },
      };
    }

    researcherCard(id) {
      const item = this.researchers.get(id);
      const institution = this.institutions.get(item.institutionId) || {};
      return {
        id: item.id,
        name: item.name,
        label: "Researcher",
        title: item.title || "",
        institution: institution.name || "",
        paperCount: this.rows(this.researcherPapers, id).length,
      };
    }

    paperCard(id) {
      const paper = this.papers.get(id);
      const venue = this.venues.get(paper.venueId) || {};
      return {
        id: paper.id,
        name: paper.title,
        title: paper.title,
        label: "Paper",
        year: paper.year,
        venue: venue.name || "",
        citationCount: paper.citationCount ?? this.rows(this.inCites, id).length,
        sourceUrl: paper.sourceUrl || "",
        isOpenAccess: Boolean(paper.isOpenAccess),
      };
    }

    allResearchers() {
      return [...this.researchers.keys()].map((id) => this.researcherCard(id)).sort((a, b) => compareText(a.name, b.name));
    }

    allTopics() {
      return [...this.topics.values()].sort((a, b) => {
        const sourceOrder = Number(a.source !== "curated") - Number(b.source !== "curated");
        return sourceOrder || compareText(a.name, b.name);
      });
    }

    allPapers() {
      return [...this.papers.keys()].map((id) => this.paperCard(id)).sort((a, b) =>
        (b.year || 0) - (a.year || 0) || compareText(b.title, a.title));
    }

    bootstrap() {
      return { topics: this.allTopics(), researchers: this.allResearchers(), papers: this.allPapers() };
    }

    search(query) {
      const needle = String(query || "").trim().toLowerCase();
      if (!needle) return { query, researchers: [], papers: [], topics: [] };
      const matches = (value) => String(value || "").toLowerCase().includes(needle);
      const researchers = [...this.researchers.values()]
        .filter((item) => matches(item.name) || matches(item.title))
        .slice(0, 8)
        .map((item) => this.researcherCard(item.id));
      const papers = [...this.papers.values()]
        .filter((item) => matches(item.title) || matches(item.abstract))
        .slice(0, 8)
        .map((item) => this.paperCard(item.id));
      const topics = [...this.topics.values()]
        .filter((item) => matches(item.name) || matches(item.description))
        .slice(0, 8)
        .map((item) => ({ ...item, label: "Topic" }));
      return { query, researchers, papers, topics };
    }

    listPapers(params) {
      const query = (params.get("q") || "").trim().toLowerCase();
      const topicId = params.get("topic") || "";
      const yearFrom = numberParam(params, "yearFrom", 0);
      const yearTo = numberParam(params, "yearTo", 9999);
      const sort = params.get("sort") || "citations";
      const page = Math.max(1, numberParam(params, "page", 1));
      const limit = clamp(numberParam(params, "limit", 24), 1, 100);
      const topicPaperIds = topicId ? new Set(this.rows(this.topicPapers, topicId).map((row) => row.paperId)) : null;
      const items = [...this.papers.values()]
        .filter((paper) => {
          const year = Number(paper.year || 0);
          const haystack = `${paper.title || ""} ${paper.abstract || ""} ${paper.doi || ""}`.toLowerCase();
          return (!query || haystack.includes(query)) &&
            (!topicPaperIds || topicPaperIds.has(paper.id)) && year >= yearFrom && year <= yearTo;
        })
        .map((paper) => this.paperCard(paper.id));
      if (sort === "recent") items.sort((a, b) => (b.year || 0) - (a.year || 0) || compareText(b.title, a.title));
      else if (sort === "title") items.sort((a, b) => compareText(a.title, b.title));
      else items.sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0) || (b.year || 0) - (a.year || 0));
      const start = (page - 1) * limit;
      return { items: items.slice(start, start + limit), page, limit, total: items.length, pages: Math.max(1, Math.ceil(items.length / limit)) };
    }

    topicResearchers(topicId, limit = 20) {
      const topic = this.topics.get(topicId);
      if (!topic) return null;
      const scores = new Map();
      const papers = [];
      for (const edge of this.rows(this.topicPapers, topicId)) {
        const paper = this.papers.get(edge.paperId);
        if (!paper) continue;
        papers.push(this.paperCard(paper.id));
        for (const author of this.rows(this.paperAuthors, paper.id)) {
          const score = scores.get(author.researcherId) || { relatedPapers: 0, topicScore: 0, recentPapers: 0 };
          score.relatedPapers += 1;
          score.topicScore += Number(edge.score ?? 1);
          score.recentPapers += Number((paper.year || 0) >= 2024);
          scores.set(author.researcherId, score);
        }
      }
      const researchers = [...scores.entries()]
        .map(([id, score]) => ({ ...this.researcherCard(id), ...score }))
        .sort((a, b) => b.topicScore - a.topicScore || b.relatedPapers - a.relatedPapers || b.recentPapers - a.recentPapers)
        .slice(0, limit);
      papers.sort((a, b) => (b.year || 0) - (a.year || 0) || compareText(b.title, a.title));
      return { topic, researchers, papers: papers.slice(0, limit) };
    }

    researcherTopics(researcherId) {
      const counts = new Map();
      for (const authored of this.rows(this.researcherPapers, researcherId)) {
        for (const edge of this.rows(this.paperTopics, authored.paperId)) {
          const current = counts.get(edge.topicId) || { papers: 0, score: 0 };
          current.papers += 1;
          current.score += Number(edge.score ?? 1);
          counts.set(edge.topicId, current);
        }
      }
      return [...counts.entries()]
        .map(([id, value]) => ({ ...this.topics.get(id), ...value }))
        .sort((a, b) => b.papers - a.papers || b.score - a.score);
    }

    coauthors(researcherId) {
      const counts = new Map();
      for (const authored of this.rows(this.researcherPapers, researcherId)) {
        for (const author of this.rows(this.paperAuthors, authored.paperId)) {
          if (author.researcherId !== researcherId) counts.set(author.researcherId, (counts.get(author.researcherId) || 0) + 1);
        }
      }
      return [...counts.entries()]
        .map(([id, collaborations]) => ({ ...this.researcherCard(id), collaborations }))
        .sort((a, b) => b.collaborations - a.collaborations);
    }

    researcher(researcherId) {
      const researcher = this.researchers.get(researcherId);
      if (!researcher) return null;
      const papers = this.rows(this.researcherPapers, researcherId)
        .map((row) => this.paperCard(row.paperId))
        .sort((a, b) => this.rows(this.inCites, b.id).length - this.rows(this.inCites, a.id).length || (b.year || 0) - (a.year || 0));
      return {
        ...researcher,
        institution: this.institutions.get(researcher.institutionId) || null,
        topics: this.researcherTopics(researcherId),
        papers,
        coauthors: this.coauthors(researcherId),
      };
    }

    paper(paperId) {
      const paper = this.papers.get(paperId);
      if (!paper) return null;
      return {
        ...paper,
        venue: this.venues.get(paper.venueId) || null,
        authors: this.rows(this.paperAuthors, paperId).map((row) => this.researcherCard(row.researcherId)),
        topics: this.rows(this.paperTopics, paperId).map((row) => ({ ...this.topics.get(row.topicId), score: Number(row.score ?? 1) })),
        cites: this.rows(this.outCites, paperId).map((id) => this.paperCard(id)),
        citedBy: this.rows(this.inCites, paperId).map((id) => this.paperCard(id)),
      };
    }

    neighbors(nodeId) {
      const neighbors = [];
      if (this.researchers.has(nodeId)) {
        const researcher = this.researchers.get(nodeId);
        if (researcher.institutionId) neighbors.push([researcher.institutionId, "AFFILIATED_WITH"]);
        for (const edge of this.rows(this.researcherPapers, nodeId)) neighbors.push([edge.paperId, "AUTHORED"]);
      }
      if (this.papers.has(nodeId)) {
        const paper = this.papers.get(nodeId);
        for (const edge of this.rows(this.paperAuthors, nodeId)) neighbors.push([edge.researcherId, "AUTHORED"]);
        for (const edge of this.rows(this.paperTopics, nodeId)) neighbors.push([edge.topicId, "HAS_TOPIC"]);
        if (paper.venueId) neighbors.push([paper.venueId, "PUBLISHED_IN"]);
        for (const id of this.rows(this.outCites, nodeId)) neighbors.push([id, "CITES"]);
        for (const id of this.rows(this.inCites, nodeId)) neighbors.push([id, "CITED_BY"]);
      }
      if (this.topics.has(nodeId)) {
        for (const edge of this.rows(this.topicPapers, nodeId)) neighbors.push([edge.paperId, "HAS_TOPIC"]);
      }
      return neighbors;
    }

    node(nodeId) {
      if (this.researchers.has(nodeId)) return this.researcherCard(nodeId);
      if (this.papers.has(nodeId)) return this.paperCard(nodeId);
      if (this.topics.has(nodeId)) {
        const item = this.topics.get(nodeId);
        return { id: item.id, name: item.name, label: "Topic", description: item.description || "" };
      }
      if (this.venues.has(nodeId)) {
        const item = this.venues.get(nodeId);
        return { id: item.id, name: item.name, label: "Venue", type: item.type || "" };
      }
      const item = this.institutions.get(nodeId);
      return { id: item.id, name: item.name, label: "Institution", country: item.country || "" };
    }

    graphFrom(startId, depth = 2, limit = 80) {
      depth = clamp(depth, 1, 3);
      limit = clamp(limit, 10, 120);
      const seen = new Set([startId]);
      const queue = [[startId, 0]];
      const edges = [];
      while (queue.length && seen.size < limit) {
        const [nodeId, currentDepth] = queue.shift();
        if (currentDepth >= depth) continue;
        for (const [target, type] of this.neighbors(nodeId)) {
          edges.push({ source: nodeId, target, type });
          if (!seen.has(target) && seen.size < limit) {
            seen.add(target);
            queue.push([target, currentDepth + 1]);
          }
        }
      }
      const edgeKeys = new Set();
      const uniqueEdges = edges.filter((edge) => {
        const key = `${edge.source}\u0000${edge.target}\u0000${edge.type}`;
        if (edgeKeys.has(key)) return false;
        edgeKeys.add(key);
        return true;
      });
      return { nodes: [...seen].map((id) => this.node(id)), edges: uniqueEdges };
    }

    shortestPath(source, target) {
      if (!this.researchers.has(source) || !this.researchers.has(target)) return null;
      const queue = [source];
      const previous = new Map([[source, [null, null]]]);
      while (queue.length) {
        const nodeId = queue.shift();
        if (nodeId === target) break;
        for (const [neighbor, type] of this.neighbors(nodeId)) {
          if (!previous.has(neighbor)) {
            previous.set(neighbor, [nodeId, type]);
            queue.push(neighbor);
          }
        }
      }
      if (!previous.has(target)) return { nodes: [], edges: [], explanation: "目前資料快照找不到連接路徑。" };
      const pathIds = [];
      for (let cursor = target; cursor !== null; cursor = previous.get(cursor)[0]) pathIds.push(cursor);
      pathIds.reverse();
      const edges = pathIds.slice(1).map((id, index) => ({ source: pathIds[index], target: id, type: previous.get(id)[1] }));
      return { nodes: pathIds.map((id) => this.node(id)), edges, explanation: pathIds.map((id) => this.node(id).name).join(" -> ") };
    }

    recommendations(paperId, k = 5) {
      if (!this.papers.has(paperId)) return null;
      const baseTopics = new Set(this.rows(this.paperTopics, paperId).map((row) => row.topicId));
      const baseRefs = new Set(this.rows(this.outCites, paperId));
      const citationNeighbors = new Set([...this.rows(this.outCites, paperId), ...this.rows(this.inCites, paperId)]);
      const baseVector = this.paperEmbeddings[paperId] || [];
      const results = [];
      for (const otherId of this.papers.keys()) {
        if (otherId === paperId) continue;
        const otherTopics = new Set(this.rows(this.paperTopics, otherId).map((row) => row.topicId));
        const otherRefs = new Set(this.rows(this.outCites, otherId));
        const sharedTopics = [...baseTopics].filter((id) => otherTopics.has(id));
        const sharedRefs = [...baseRefs].filter((id) => otherRefs.has(id));
        const directCitation = citationNeighbors.has(otherId);
        const otherVector = this.paperEmbeddings[otherId] || [];
        const vectorScore = Math.max(0, baseVector.reduce((sum, value, index) => sum + value * (otherVector[index] || 0), 0));
        let graphScore = 0.30 * (sharedTopics.length / (sharedTopics.length + 2));
        graphScore += 0.10 * (sharedRefs.length / (sharedRefs.length + 1));
        graphScore += 0.05 * Number(directCitation);
        const score = 0.55 * vectorScore + graphScore;
        if (score <= 0) continue;
        const topicNames = sharedTopics.sort().map((id) => this.topics.get(id).name);
        const reasons = [`語意相似度 ${vectorScore.toFixed(2)}`];
        if (topicNames.length) reasons.push(`共享 ${topicNames.length} 個研究主題：${topicNames.join(", ")}`);
        if (sharedRefs.length) reasons.push(`共同引用 ${sharedRefs.length} 篇基礎研究`);
        if (directCitation) reasons.push("與目前論文存在直接引用關係");
        results.push({
          ...this.paperCard(otherId),
          score: Math.round(score * 10000) / 10000,
          vectorScore: Math.round(vectorScore * 10000) / 10000,
          graphScore: Math.round(graphScore * 10000) / 10000,
          sharedTopics: topicNames,
          sharedReferences: sharedRefs.length,
          directCitation: Number(directCitation),
          reasons,
        });
      }
      results.sort((a, b) => b.score - a.score || (b.year || 0) - (a.year || 0));
      return { paper: this.paperCard(paperId), strategy: "hybrid-vector-graph-static-demo", recommendations: results.slice(0, clamp(k, 1, 20)) };
    }

    analytics() {
      const years = new Map();
      const topics = new Map();
      let citations = 0;
      let openAccess = 0;
      for (const paper of this.papers.values()) {
        const year = Number(paper.year || 0);
        const citationCount = Number(paper.citationCount || 0);
        citations += citationCount;
        openAccess += Number(Boolean(paper.isOpenAccess));
        if (year) {
          const item = years.get(year) || { papers: 0, citations: 0 };
          item.papers += 1;
          item.citations += citationCount;
          years.set(year, item);
        }
        for (const edge of this.rows(this.paperTopics, paper.id)) {
          if (!topics.has(edge.topicId)) topics.set(edge.topicId, new Set());
          topics.get(edge.topicId).add(paper.id);
        }
      }
      return {
        summary: { papers: this.papers.size, citations, openAccess, averageCitations: Math.round((citations / Math.max(1, this.papers.size)) * 100) / 100 },
        years: [...years.entries()].sort((a, b) => a[0] - b[0]).map(([year, values]) => ({ year, ...values })),
        topics: [...topics.entries()]
          .sort((a, b) => b[1].size - a[1].size)
          .slice(0, 10)
          .map(([id, paperIds]) => ({ name: this.topics.get(id).name, papers: paperIds.size })),
      };
    }

    route(rawPath) {
      const url = new URL(rawPath, "https://demo.invalid");
      const path = decodeURIComponent(url.pathname);
      const params = url.searchParams;
      let match;
      let result;
      if (path === "/api/health") return this.health();
      if (path === "/api/bootstrap") return this.bootstrap();
      if (path === "/api/analytics/trends") return this.analytics();
      if (path === "/api/search") return this.search(params.get("q") || "");
      if (path === "/api/papers") return this.listPapers(params);
      if (path === "/api/researchers/path") return this.shortestPath(params.get("source") || "", params.get("target") || "");
      if ((match = path.match(/^\/api\/topics\/([^/]+)\/researchers$/))) result = this.topicResearchers(match[1], numberParam(params, "limit", 20));
      else if ((match = path.match(/^\/api\/researchers\/([^/]+)\/network$/))) result = this.graphFrom(match[1], numberParam(params, "depth", 2), numberParam(params, "limit", 80));
      else if ((match = path.match(/^\/api\/researchers\/([^/]+)$/))) result = this.researcher(match[1]);
      else if ((match = path.match(/^\/api\/papers\/([^/]+)\/network$/))) result = this.graphFrom(match[1], numberParam(params, "depth", 1), numberParam(params, "limit", 80));
      else if ((match = path.match(/^\/api\/papers\/([^/]+)\/recommendations$/))) result = this.recommendations(match[1], numberParam(params, "k", 5));
      else if ((match = path.match(/^\/api\/papers\/([^/]+)$/))) result = this.paper(match[1]);
      else throw new Error(`未知的 Demo 端點：${path}`);
      if (result === null) throw new Error("找不到指定資料");
      return result;
    }
  }

  let storePromise;
  async function getStore() {
    if (!storePromise) {
      storePromise = fetch("./demo-data.json", { cache: "no-cache" }).then(async (response) => {
        if (!response.ok) throw new Error(`無法載入 Demo 資料 (${response.status})`);
        return new DemoGraphStore(await response.json());
      });
    }
    return storePromise;
  }

  global.DemoGraphStore = DemoGraphStore;
  global.demoApi = async (path) => (await getStore()).route(path);
})(typeof window === "undefined" ? globalThis : window);
