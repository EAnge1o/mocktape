/* mocktape dashboard — vanilla JS, no build step, talks to the live feed and the admin API. */

const $ = (id) => document.getElementById(id);

const state = {
  requests: [],
  ws: null,
  reconnectTimer: null,
  selected: null,
};

const adminBase = "/__mocktape__";

// ---------------------------------------------------------------- websocket

function connect() {
  const ws = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/live`,
  );
  state.ws = ws;

  ws.onopen = () => {
    $("conn").classList.remove("off");
    $("conn").textContent = "● live";
  };
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "snapshot") {
      state.requests = message.recent;
      renderStats(message.stats);
      renderSidebar(message);
      renderRequests();
    } else if (message.type === "request") {
      state.requests.push(message.request);
      if (state.requests.length > 300) state.requests.shift();
      appendRequest(message.request);
      refreshStats();
    }
  };
  ws.onclose = () => {
    $("conn").classList.add("off");
    $("conn").textContent = "● offline";
    state.reconnectTimer = setTimeout(connect, 1500);
  };
}

// ---------------------------------------------------------------- rendering

function renderStats(stats) {
  $("stat-total").textContent = stats.total;
  $("stat-miss").textContent = stats.miss;
  $("stat-avg").textContent = `${stats.avgLatencyMs}ms`;
  $("stat-p95").textContent = `${stats.p95LatencyMs}ms`;
  $("stat-uptime").textContent = formatUptime(stats.uptimeMs);
  $("mode").textContent = document.body.dataset.mode ?? $("mode").textContent;
}

async function refreshStats() {
  try {
    const stats = await fetchJson(`${adminBase}/stats`);
    renderStats(stats);
  } catch {
    /* server restarting */
  }
}

function renderSidebar({ resources, routes, scenarios }) {
  $("resources").innerHTML = resources.length
    ? resources
        .map((r) => `<li><span>${esc(r.name)}</span><span class="count">${r.count}</span></li>`)
        .join("")
    : `<li class="hint">no resources</li>`;

  const scenarioRoutes = routes.filter((r) => r.scenarioStates.length > 0);
  $("scenarios-hint").hidden = scenarioRoutes.length > 0;
  $("scenarios").innerHTML = scenarioRoutes
    .map(
      (route) => `
      <div class="scenario" data-route="${esc(route.name)}">
        <label>${esc(route.name)}</label>
        <select>
          ${route.scenarioStates
            .map(
              (s) =>
                `<option value="${esc(s)}" ${
                  (scenarios[route.name] ?? "default") === s ? "selected" : ""
                }>${esc(s)}</option>`,
            )
            .join("")}
        </select>
      </div>`,
    )
    .join("");
  for (const select of document.querySelectorAll(".scenario select")) {
    select.onchange = () => {
      const route = select.closest(".scenario").dataset.route;
      fetchJson(`${adminBase}/scenarios/${encodeURIComponent(route)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: select.value }),
      }).catch((error) => alert(error.message));
    };
  }

  $("routes").innerHTML = routes.length
    ? routes
        .map(
          (route) =>
            `<li><span class="route-path"><span class="route-method">${esc(route.methods.join("|"))}</span>${esc(
              route.path,
            )}</span></li>`,
        )
        .join("")
    : `<li class="hint">no routes</li>`;
}

function renderRequests() {
  const tbody = $("requests");
  tbody.innerHTML = state.requests.map((r) => rowHtml(r)).join("");
  $("empty").hidden = state.requests.length > 0;
  tbody.scrollTop = tbody.scrollHeight;
  wireRows();
}

function appendRequest(request) {
  $("empty").hidden = true;
  const tbody = $("requests");
  const stick = tbody.scrollHeight - tbody.scrollTop - tbody.clientHeight < 60;
  tbody.insertAdjacentHTML("beforeend", rowHtml(request));
  if (tbody.children.length > 300) tbody.children[0].remove();
  if (stick) tbody.scrollTop = tbody.scrollHeight;
  wireRows();
}

function rowHtml(request) {
  return `
    <tr data-id="${request.id}" class="${request.source === "miss" ? "miss" : ""}">
      <td class="time">${formatTime(request.time)}</td>
      <td class="method ${esc(request.method)}">${esc(request.method)}</td>
      <td class="path" title="${esc(request.path)}">${esc(request.path)}</td>
      <td class="status ${statusClass(request.status)}">${request.status ?? "—"}</td>
      <td>${request.durationMs}ms</td>
      <td><span class="src ${esc(request.source)}">${esc(request.source)}</span></td>
      <td class="origin" title="${esc(request.origin ?? "")}">${esc(request.origin ?? "")}</td>
    </tr>`;
}

function wireRows() {
  for (const row of document.querySelectorAll("#requests tr")) {
    row.onclick = () => {
      const request = state.requests.find((r) => r.id === row.dataset.id);
      if (request) openDrawer(request);
    };
  }
}

// ---------------------------------------------------------------- drawer

function openDrawer(request) {
  state.selected = request;
  $("drawer").hidden = false;
  $("drawer-title").innerHTML = `${esc(request.method)} ${esc(request.path)} → ${
    request.status ?? "—"
  } <span class="src ${esc(request.source)}">${esc(request.source)}</span>`;

  const html = [];
  if (request.source === "miss" && request.miss?.closest) {
    const c = request.miss.closest;
    const pct = Math.round(c.score * 100);
    html.push(`
      <div class="miss-box">
        <div class="title">No mock matched</div>
        closest match: <b>${esc(c.method)} ${esc(c.path)}</b> — ${pct}% similar
        <div class="bar"><div style="width:${pct}%"></div></div>
        ${breakdownHtml(c.breakdown)}
      </div>`);
  }

  html.push("<h4>Request headers</h4>");
  html.push(kvHtml(request.requestHeaders));
  if (request.requestBody !== undefined) {
    html.push("<h4>Request body</h4>");
    html.push(`<pre class="block">${esc(formatBody(request.requestBody))}</pre>`);
  }
  html.push("<h4>Response headers</h4>");
  html.push(kvHtml(request.responseHeaders));
  if (request.responseBody !== undefined) {
    html.push("<h4>Response body</h4>");
    html.push(`<pre class="block">${esc(formatBody(request.responseBody))}</pre>`);
  }
  $("drawer-body").innerHTML = html.join("");
}

function breakdownHtml(breakdown) {
  if (!breakdown) return "";
  return ["method", "path", "query", "body"]
    .map(
      (key) =>
        `<div class="kv"><div><span class="k">${key}</span><span class="v">${Math.round(
          (breakdown[key] ?? 0) * 100,
        )}%</span></div></div>`,
    )
    .join("");
}

function kvHtml(headers) {
  if (!headers || Object.keys(headers).length === 0) return "<pre class='block'>(none)</pre>";
  return `<div class="kv">${Object.entries(headers)
    .map(
      ([k, v]) =>
        `<div><span class="k">${esc(k)}</span><span class="v">${esc(String(v))}</span></div>`,
    )
    .join("")}</div>`;
}

function formatBody(body) {
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

// ---------------------------------------------------------------- misc

function statusClass(status) {
  if (status === undefined || status === null) return "none";
  return `s${Math.floor(status / 100)}`;
}

function formatTime(timestamp) {
  return new Date(timestamp).toTimeString().slice(0, 8);
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

$("drawer-close").onclick = () => {
  $("drawer").hidden = true;
  state.selected = null;
};
$("reset").onclick = () =>
  fetchJson(`${adminBase}/reset`, { method: "POST" }).catch((error) => alert(error.message));

connect();
