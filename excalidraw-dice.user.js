// ==UserScript==
// @name         Excalidraw Dice
// @namespace    https://excalidraw.com/
// @version      0.4.8
// @description  Add a collapsible dice roller panel to Excalidraw and write roll logs into the canvas.
// @author       Codex
// @match        https://excalidraw.com/*
// @match        https://app.excalidraw.com/*
// @match        https://*.excalidraw.com/*
// @run-at       document-idle
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  "use strict";

  console.info("[excalidraw-dice] userscript boot", location.href);

  const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const STORAGE_KEY = "excalidraw-dice:v1";
  const API_SCAN_TIMEOUT_MS = 10000;
  const API_SCAN_INTERVAL_MS = 250;
  const LOG_CUSTOM_DATA_KEY = "excalidrawDiceLog";
  const LOG_TITLE = "历史记录";
  const DEFAULT_EXPRESSION = "";
  const DEFAULT_LAST_EXPRESSION = "d20";
  const MAX_LOG_LINES = 20;
  const MAX_HISTORY_ITEMS = 20;
  const DICE_TYPES = ["d20", "d12", "d10", "d8", "d6", "d4", "d100"];
  const VISUAL_DICE_TYPES = ["d100", "d4", "d6", "d8", "d10", "d12", "d20"];
  const DICE_LIBRARY_URLS = [
    "https://unpkg.com/mathjs@11.8.2/lib/browser/math.js",
    "https://cdn.jsdelivr.net/npm/random-js@2.1.0/dist/random-js.umd.min.js",
    "https://cdn.jsdelivr.net/npm/@dice-roller/rpg-dice-roller@5.5.1/lib/umd/bundle.min.js",
  ];

  const state = {
    expanded: false,
    expression: DEFAULT_EXPRESSION,
    reason: "",
    lastExpression: DEFAULT_LAST_EXPRESSION,
    lastReason: "",
    lastResult: "",
    history: [],
    dicePool: {
      d20: 1,
      d12: 0,
      d10: 0,
      d8: 0,
      d6: 0,
      d4: 0,
      d100: 0,
    },
    modifier: 0,
  };

  let cachedApi = null;
  let scanStartedAt = 0;
  let scanTimer = null;
  let root = null;
  let statusNode = null;
  let collapsedSummaryNode = null;
  let collapsedResultNode = null;
  let expressionInput = null;
  let reasonInput = null;
  let panelNode = null;
  let historyNode = null;
  let toggleButton = null;
  let dicePoolRows = new Map();
  let diceLibraryReady = false;

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const parsedPool = parsed.dicePool && typeof parsed.dicePool === "object" ? parsed.dicePool : {};
      Object.assign(state, {
        expanded: Boolean(parsed.expanded),
        expression: String(parsed.expression || DEFAULT_EXPRESSION),
        reason: String(parsed.reason || ""),
        lastExpression: String(parsed.lastExpression || parsed.expression || DEFAULT_LAST_EXPRESSION),
        lastReason: String(parsed.lastReason || parsed.reason || ""),
        lastResult: String(parsed.lastResult || ""),
        history: Array.isArray(parsed.history) ? parsed.history.slice(-MAX_HISTORY_ITEMS) : [],
        modifier: Number.isFinite(Number(parsed.modifier)) ? Number(parsed.modifier) : 0,
      });
      for (const die of DICE_TYPES) {
        const count = Number(parsedPool[die]);
        state.dicePool[die] = Number.isInteger(count) && count > 0 ? count : 0;
      }
      if (!parsed.dicePool) {
        state.expression = DEFAULT_EXPRESSION;
        resetDicePool();
      }
    } catch {
      // Ignore corrupt local state and fall back to defaults.
    }
  }

  function saveState() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        expanded: state.expanded,
        expression: state.expression,
        reason: state.reason,
        lastExpression: state.lastExpression,
        lastReason: state.lastReason,
        lastResult: state.lastResult,
        history: state.history,
        dicePool: state.dicePool,
        modifier: state.modifier,
      }),
    );
  }

  function isExcalidrawApi(value) {
    return (
      value &&
      typeof value === "object" &&
      typeof value.updateScene === "function" &&
      typeof value.getSceneElements === "function" &&
      value.isDestroyed !== true
    );
  }

  function findExcalidrawApi() {
    if (isExcalidrawApi(cachedApi)) {
      return cachedApi;
    }

    const seen = new WeakSet();
    const stack = [];

    for (const el of document.querySelectorAll("*")) {
      for (const key of Object.getOwnPropertyNames(el)) {
        if (
          key.startsWith("__reactFiber$") ||
          key.startsWith("__reactContainer$") ||
          key.startsWith("_reactFiber$") ||
          key.startsWith("_reactContainer$")
        ) {
          stack.push(el[key]);
          if (el[key] && el[key].current) {
            stack.push(el[key].current);
          }
        }
      }
    }

    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object" || seen.has(node)) {
        continue;
      }
      seen.add(node);

      if (isExcalidrawApi(node)) {
        cachedApi = node;
        return cachedApi;
      }
      if (isExcalidrawApi(node.api)) {
        cachedApi = node.api;
        return cachedApi;
      }
      if (isExcalidrawApi(node.stateNode)) {
        cachedApi = node.stateNode;
        return cachedApi;
      }
      if (isExcalidrawApi(node.stateNode && node.stateNode.api)) {
        cachedApi = node.stateNode.api;
        return cachedApi;
      }
      if (isExcalidrawApi(node.memoizedProps && node.memoizedProps.excalidrawAPI)) {
        cachedApi = node.memoizedProps.excalidrawAPI;
        return cachedApi;
      }

      if (node.current) stack.push(node.current);
      if (node.child) stack.push(node.child);
      if (node.sibling) stack.push(node.sibling);
      if (node.return) stack.push(node.return);
      if (node.alternate) stack.push(node.alternate);
    }

    cachedApi = null;
    return null;
  }

  function ensureApi() {
    const api = findExcalidrawApi();
    if (!api) {
      throw new Error("Excalidraw API is not ready");
    }
    return api;
  }

  function startApiScan() {
    scanStartedAt = Date.now();
    scanTimer = window.setInterval(() => {
      const api = findExcalidrawApi();
      if (api) {
        setStatus("Ready");
        window.clearInterval(scanTimer);
        scanTimer = null;
        return;
      }
      if (Date.now() - scanStartedAt > API_SCAN_TIMEOUT_MS) {
        setStatus("API not found");
        window.clearInterval(scanTimer);
        scanTimer = null;
      }
    }, API_SCAN_INTERVAL_MS);
  }

  function loadScriptIntoPage(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${url}`));
      document.head.appendChild(script);
    });
  }

  async function loadDiceLibraries() {
    if (pageWindow.rpgDiceRoller && pageWindow.rpgDiceRoller.DiceRoll) {
      diceLibraryReady = true;
      return;
    }

    setStatus("Loading dice library...");
    for (const url of DICE_LIBRARY_URLS) {
      await loadScriptIntoPage(url);
    }

    if (!pageWindow.rpgDiceRoller || !pageWindow.rpgDiceRoller.DiceRoll) {
      throw new Error("Dice roller library loaded but is unavailable");
    }

    diceLibraryReady = true;
    console.info("[excalidraw-dice] dice library loaded");
  }

  function rollNotation(notation) {
    const roller = pageWindow.rpgDiceRoller;
    if (!diceLibraryReady || !roller || !roller.DiceRoll) {
      throw new Error("Dice roller library is not loaded");
    }

    const roll = new roller.DiceRoll(notation);
    const total = Number(roll.total);
    if (!Number.isFinite(total)) {
      throw new Error("Dice expression did not produce a numeric total");
    }

    return {
      total,
      output: String(roll.output || roll.toString()),
    };
  }

  function getPlayerName(api) {
    try {
      const collab = JSON.parse(localStorage.getItem("excalidraw-collab") || "{}");
      const collabUsername = typeof collab.username === "string" ? collab.username.trim() : "";
      if (collabUsername) {
        return collabUsername;
      }
    } catch {
      // Fall back to app state below.
    }

    const appState = typeof api.getAppState === "function" ? api.getAppState() : {};
    const username = appState && typeof appState.username === "string" ? appState.username.trim() : "";
    return username || "Anonymous";
  }

  function makeId() {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  function makeNonce() {
    return Math.floor(Math.random() * 2 ** 31);
  }

  function createTextElement(text) {
    const fontSize = 20;
    const lineHeight = 1.25;
    const lineCount = text.split("\n").length;

    return {
      id: makeId(),
      type: "text",
      x: 80,
      y: 80,
      width: 420,
      height: Math.max(80, Math.ceil(lineCount * fontSize * lineHeight)),
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: makeNonce(),
      version: 1,
      versionNonce: makeNonce(),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      text,
      fontSize,
      fontFamily: 1,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      originalText: text,
      lineHeight,
      autoResize: true,
      customData: {
        [LOG_CUSTOM_DATA_KEY]: true,
      },
    };
  }

  function updateTextElement(existing, text) {
    const fontSize = existing.fontSize || 20;
    const lineHeight = existing.lineHeight || 1.25;
    const lineCount = text.split("\n").length;

    return {
      ...existing,
      text,
      originalText: text,
      height: Math.max(existing.height || 0, Math.ceil(lineCount * fontSize * lineHeight)),
      version: (existing.version || 1) + 1,
      versionNonce: makeNonce(),
      isDeleted: false,
      updated: Date.now(),
      customData: {
        ...(existing.customData || {}),
        [LOG_CUSTOM_DATA_KEY]: true,
      },
    };
  }

  function appendLogLine(api, line) {
    const elements = api.getSceneElements();
    const existing = elements.find(
      (element) =>
        element &&
        element.isDeleted !== true &&
        element.type === "text" &&
        element.customData &&
        element.customData[LOG_CUSTOM_DATA_KEY] === true,
    );

    const text = trimLogText(existing ? `${existing.text}\n${line}` : `${LOG_TITLE}\n${line}`);
    const logElement = existing ? updateTextElement(existing, text) : createTextElement(text);
    const nextElements = existing
      ? elements.map((element) => (element.id === existing.id ? logElement : element))
      : [...elements, logElement];

    api.updateScene({
      elements: nextElements,
      captureUpdate: "IMMEDIATELY",
    });
  }

  function trimLogText(text) {
    const lines = String(text).split("\n");
    const title = lines[0] || LOG_TITLE;
    const entries = lines.slice(1);
    if (entries.length <= MAX_LOG_LINES) {
      return [title, ...entries].join("\n");
    }
    return [title, ...entries.slice(-MAX_LOG_LINES)].join("\n");
  }

  function formatRollLine(playerName, expression, reason, total) {
    const reasonText = reason ? ` ${reason}` : " 投掷";
    return `${playerName}${reasonText} ${expression} => ${total}`;
  }

  function formatHistoryTime(timestamp) {
    try {
      return new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function addHistoryEntry(entry) {
    state.history = [...state.history, entry].slice(-MAX_HISTORY_ITEMS);
  }

  function resetDicePool() {
    for (const die of DICE_TYPES) {
      state.dicePool[die] = 0;
    }
    state.modifier = 0;
  }

  function buildExpressionFromPool() {
    const terms = [];
    for (const die of DICE_TYPES) {
      const count = state.dicePool[die] || 0;
      if (count === 1) {
        terms.push(die);
      } else if (count > 1) {
        terms.push(`${count}${die}`);
      }
    }

    let expression = terms.join("+");
    if (state.modifier > 0) {
      expression += `${expression ? "+" : ""}${state.modifier}`;
    } else if (state.modifier < 0) {
      expression += `${state.modifier}`;
    }
    return expression;
  }

  function applyPoolToExpression() {
    state.expression = buildExpressionFromPool();
    saveState();
    renderState();
  }

  function syncPoolFromExpression(expression) {
    const cleanExpression = String(expression || "").replace(/\s+/g, "");
    if (!cleanExpression) {
      resetDicePool();
      return true;
    }

    const normalized = cleanExpression.replace(/-/g, "+-");
    const rawTerms = normalized.split("+").filter(Boolean);
    const nextPool = Object.fromEntries(DICE_TYPES.map((die) => [die, 0]));
    let nextModifier = 0;

    for (const term of rawTerms) {
      const diceMatch = term.match(/^(\d*)d(4|6|8|10|12|20|100)$/i);
      if (diceMatch) {
        const die = `d${diceMatch[2]}`;
        const count = diceMatch[1] ? Number(diceMatch[1]) : 1;
        if (!Number.isInteger(count) || count < 1) {
          return false;
        }
        nextPool[die] += count;
        continue;
      }

      if (/^-?\d+$/.test(term)) {
        nextModifier += Number(term);
        continue;
      }

      return false;
    }

    for (const die of DICE_TYPES) {
      state.dicePool[die] = nextPool[die];
    }
    state.modifier = nextModifier;
    return true;
  }

  function changeDieCount(die, delta) {
    state.dicePool[die] = Math.max(0, (state.dicePool[die] || 0) + delta);
    applyPoolToExpression();
  }

  function changeModifier(delta) {
    state.modifier += delta;
    applyPoolToExpression();
  }

  function performRoll(expression, reason) {
    const cleanExpression = expression.trim();
    const cleanReason = reason.trim();
    if (!cleanExpression) {
      throw new Error("Please enter a dice expression");
    }

    const api = ensureApi();
    const roll = rollNotation(cleanExpression);
    const playerName = getPlayerName(api);
    const line = formatRollLine(playerName, cleanExpression, cleanReason, roll.total);
    const timestamp = Date.now();

    appendLogLine(api, line);
    addHistoryEntry({
      playerName,
      expression: cleanExpression,
      reason: cleanReason,
      total: roll.total,
      timestamp,
    });

    state.expression = cleanExpression;
    state.reason = cleanReason;
    state.lastExpression = cleanExpression;
    state.lastReason = cleanReason;
    state.lastResult = String(roll.total);
    saveState();
    renderState();
    scrollHistoryToBottom();
    setStatus(roll.output);
  }

  function setStatus(message) {
    if (statusNode) {
      statusNode.textContent = message;
    }
  }

  function getCurrentSummary() {
    const expression = state.expression || state.lastExpression || DEFAULT_LAST_EXPRESSION;
    return expression;
  }

  function isShowingLastRoll() {
    return (
      Boolean(state.lastResult) &&
      (state.expression || DEFAULT_LAST_EXPRESSION) === state.lastExpression &&
      state.reason === state.lastReason
    );
  }

  function renderState() {
    if (!root) return;

    root.classList.toggle("excalidraw-dice-expanded", state.expanded);
    root.classList.toggle("excalidraw-dice-collapsed", !state.expanded);

    if (panelNode) {
      panelNode.hidden = !state.expanded;
      panelNode.style.display = state.expanded ? "grid" : "none";
    }
    if (toggleButton) {
      toggleButton.textContent = state.expanded ? "▴" : "▸";
      toggleButton.title = state.expanded ? "Collapse dice panel" : "Expand dice panel";
      toggleButton.setAttribute("aria-expanded", String(state.expanded));
    }
    if (expressionInput && expressionInput.value !== state.expression) {
      expressionInput.value = state.expression;
    }
    if (reasonInput && reasonInput.value !== state.reason) {
      reasonInput.value = state.reason;
    }
    if (collapsedSummaryNode) {
      collapsedSummaryNode.textContent = getCurrentSummary();
    }
    if (collapsedResultNode) {
      collapsedResultNode.textContent = isShowingLastRoll() ? `= ${state.lastResult}` : "";
    }
    renderHistory();
    for (const [key, row] of dicePoolRows) {
      const count = key === "modifier" ? state.modifier : state.dicePool[key] || 0;
      row.count.textContent = count ? String(count) : "";
      row.minus.disabled = key === "modifier" ? false : count <= 0;
    }
  }

  function onRollClick(expression, reason) {
    try {
      setStatus("Rolling...");
      performRoll(expression, reason);
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error));
    }
  }

  function renderHistory() {
    if (!historyNode) return;

    historyNode.textContent = "";
    if (!state.history.length) {
      const empty = document.createElement("div");
      empty.className = "excalidraw-dice-history-empty";
      empty.textContent = "No rolls yet";
      historyNode.append(empty);
      return;
    }

    for (const item of state.history) {
      const row = document.createElement("div");
      row.className = "excalidraw-dice-history-item";

      const head = document.createElement("div");
      head.className = "excalidraw-dice-history-head";
      head.textContent = `${formatHistoryTime(item.timestamp)} ${item.playerName || "Anonymous"}`;

      const main = document.createElement("div");
      main.className = "excalidraw-dice-history-main";
      main.textContent = `${item.expression} => ${item.total}`;

      row.append(head, main);

      if (item.reason) {
        const reason = document.createElement("div");
        reason.className = "excalidraw-dice-history-reason";
        reason.textContent = item.reason;
        row.append(reason);
      }
      historyNode.append(row);
    }
  }

  function scrollHistoryToBottom() {
    if (!historyNode) return;
    requestAnimationFrame(() => {
      historyNode.scrollTop = historyNode.scrollHeight;
    });
  }

  function createButton(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function createDicePoolRow(key, label, onAdd, onRemove) {
    const row = document.createElement("div");
    row.className = "excalidraw-dice-row";

    const minus = createButton("-", "excalidraw-dice-minus", onRemove);
    minus.title = `Remove ${label}`;

    const die = createButton(label, "excalidraw-dice-die", onAdd);
    die.title = `Add ${label}`;

    const count = document.createElement("span");
    count.className = "excalidraw-dice-count";

    die.append(count);
    row.append(minus, die);
    dicePoolRows.set(key, { minus, count });
    return row;
  }

  function injectStyles() {
    if (document.getElementById("excalidraw-dice-styles")) return;

    const style = document.createElement("style");
    style.id = "excalidraw-dice-styles";
    style.textContent = `
      .excalidraw-dice-root {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 100000;
        width: 300px;
        max-height: min(420px, calc(100vh - 32px));
        color: #111827;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px;
        line-height: 1.3;
        user-select: none;
      }

      .excalidraw-dice-card {
        display: flex;
        flex-direction: column;
        max-height: inherit;
        border: 1px solid rgba(17, 24, 39, 0.16);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 12px 36px rgba(17, 24, 39, 0.18);
        overflow: hidden;
        backdrop-filter: blur(10px);
      }

      .excalidraw-dice-header {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 38px;
        padding: 6px;
        border-top: 1px solid rgba(17, 24, 39, 0.12);
      }

      .excalidraw-dice-toggle,
      .excalidraw-dice-roll,
      .excalidraw-dice-die,
      .excalidraw-dice-minus {
        border: 1px solid rgba(17, 24, 39, 0.18);
        border-radius: 4px;
        background: #ffffff;
        color: #111827;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
      }

      .excalidraw-dice-toggle {
        flex: 0 0 28px;
        height: 28px;
        padding: 0;
        font-size: 18px;
        line-height: 1;
      }

      .excalidraw-dice-roll {
        flex: 0 0 auto;
        min-width: 52px;
        height: 30px;
        background: #111827;
        color: #ffffff;
      }

      .excalidraw-dice-die {
        position: relative;
        height: 27px;
        min-width: 44px;
        padding: 0 7px;
        font-size: 14px;
        text-align: center;
      }

      .excalidraw-dice-minus {
        width: 24px;
        height: 27px;
        padding: 0;
        font-size: 16px;
      }

      .excalidraw-dice-minus:disabled {
        opacity: 0.32;
        cursor: default;
      }

      .excalidraw-dice-toggle:hover,
      .excalidraw-dice-roll:hover,
      .excalidraw-dice-die:hover,
      .excalidraw-dice-minus:not(:disabled):hover {
        filter: brightness(0.96);
      }

      .excalidraw-dice-summary {
        flex: 1 1 auto;
        min-width: 0;
      }

      .excalidraw-dice-summary-main {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 700;
      }

      .excalidraw-dice-summary-result {
        margin-top: 2px;
        color: #4b5563;
        font-size: 12px;
      }

      .excalidraw-dice-header .excalidraw-dice-status {
        margin-top: 1px;
      }

      .excalidraw-dice-panel {
        flex: 0 1 auto;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 8px;
        min-height: 0;
        overflow: hidden;
        padding: 8px;
      }

      .excalidraw-dice-reason-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 6px;
        align-items: center;
        border-top: 1px solid rgba(17, 24, 39, 0.1);
        padding: 6px 6px 6px;
      }

      .excalidraw-dice-modifier {
        display: grid;
        grid-template-columns: 24px 46px;
        column-gap: 4px;
        align-items: center;
      }

      .excalidraw-dice-label {
        display: grid;
        gap: 4px;
        color: #374151;
        font-size: 12px;
        font-weight: 700;
      }

      .excalidraw-dice-input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid rgba(17, 24, 39, 0.18);
        border-radius: 4px;
        padding: 7px;
        background: #ffffff;
        color: #111827;
        font: inherit;
        user-select: text;
      }

      .excalidraw-dice-pool {
        display: grid;
        gap: 2px;
        align-content: start;
      }

      .excalidraw-dice-row {
        display: grid;
        grid-template-columns: 24px 46px;
        column-gap: 4px;
        align-items: center;
      }

      .excalidraw-dice-count {
        position: absolute;
        top: -6px;
        left: -6px;
        display: none;
        min-width: 16px;
        height: 16px;
        box-sizing: border-box;
        border: 1px solid rgba(17, 24, 39, 0.18);
        border-radius: 999px;
        background: #111827;
        color: #ffffff;
        font-size: 10px;
        line-height: 14px;
        text-align: center;
        font-variant-numeric: tabular-nums;
        pointer-events: none;
      }

      .excalidraw-dice-count:not(:empty) {
        display: inline-block;
      }

      .excalidraw-dice-controls {
        display: grid;
        grid-template-rows: minmax(0, auto) auto;
        align-content: stretch;
        gap: 7px;
        min-height: 100%;
        min-width: 0;
      }

      .excalidraw-dice-history {
        box-sizing: border-box;
        display: grid;
        align-content: start;
        gap: 4px;
        min-height: 0;
        max-height: 156px;
        border-radius: 4px;
        background: rgba(17, 24, 39, 0.03);
        padding: 4px;
        overflow-x: hidden;
        overflow-y: auto;
      }

      .excalidraw-dice-history-item {
        min-width: 0;
        border-radius: 4px;
        background: rgba(17, 24, 39, 0.06);
        padding: 5px 6px;
      }

      .excalidraw-dice-history-head {
        color: #6b7280;
        font-size: 11px;
        overflow-wrap: anywhere;
        white-space: normal;
      }

      .excalidraw-dice-history-main {
        color: #111827;
        font-size: 12px;
        font-weight: 700;
        min-width: 0;
        overflow-wrap: anywhere;
        white-space: normal;
      }

      .excalidraw-dice-history-reason,
      .excalidraw-dice-history-empty {
        color: #6b7280;
        font-size: 11px;
        overflow-wrap: anywhere;
        white-space: normal;
      }

      .excalidraw-dice-status {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        color: #4b5563;
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      html.dark .excalidraw-dice-root,
      .theme--dark .excalidraw-dice-root {
        color: #f9fafb;
      }

      html.dark .excalidraw-dice-card,
      .theme--dark .excalidraw-dice-card {
        border-color: rgba(249, 250, 251, 0.14);
        background: rgba(31, 41, 55, 0.96);
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.32);
      }

      html.dark .excalidraw-dice-header,
      .theme--dark .excalidraw-dice-header {
        border-top-color: rgba(249, 250, 251, 0.12);
      }

      html.dark .excalidraw-dice-reason-row,
      .theme--dark .excalidraw-dice-reason-row {
        border-top-color: rgba(249, 250, 251, 0.12);
      }

      html.dark .excalidraw-dice-toggle,
      html.dark .excalidraw-dice-die,
      html.dark .excalidraw-dice-minus,
      .theme--dark .excalidraw-dice-toggle,
      .theme--dark .excalidraw-dice-die,
      .theme--dark .excalidraw-dice-minus {
        border-color: rgba(249, 250, 251, 0.16);
        background: #111827;
        color: #f9fafb;
      }

      html.dark .excalidraw-dice-roll,
      .theme--dark .excalidraw-dice-roll {
        background: #f9fafb;
        color: #111827;
      }

      html.dark .excalidraw-dice-input,
      .theme--dark .excalidraw-dice-input {
        border-color: rgba(249, 250, 251, 0.16);
        background: #111827;
        color: #f9fafb;
      }

      html.dark .excalidraw-dice-history-item,
      .theme--dark .excalidraw-dice-history-item {
        background: rgba(249, 250, 251, 0.08);
      }

      html.dark .excalidraw-dice-history,
      .theme--dark .excalidraw-dice-history {
        background: rgba(249, 250, 251, 0.04);
      }

      html.dark .excalidraw-dice-history-main,
      .theme--dark .excalidraw-dice-history-main {
        color: #f9fafb;
      }

      html.dark .excalidraw-dice-count,
      .theme--dark .excalidraw-dice-count {
        border-color: rgba(249, 250, 251, 0.22);
        background: #f9fafb;
        color: #111827;
      }

      html.dark .excalidraw-dice-label,
      html.dark .excalidraw-dice-summary-result,
      html.dark .excalidraw-dice-status,
      html.dark .excalidraw-dice-history-head,
      html.dark .excalidraw-dice-history-reason,
      html.dark .excalidraw-dice-history-empty,
      .theme--dark .excalidraw-dice-label,
      .theme--dark .excalidraw-dice-summary-result,
      .theme--dark .excalidraw-dice-status,
      .theme--dark .excalidraw-dice-history-head,
      .theme--dark .excalidraw-dice-history-reason,
      .theme--dark .excalidraw-dice-history-empty {
        color: #d1d5db;
      }

      @media (max-width: 520px) {
        .excalidraw-dice-root {
          right: 8px;
          bottom: 8px;
          width: min(300px, calc(100vw - 16px));
        }
      }
    `;
    document.head.appendChild(style);
  }

  function buildUi() {
    if (document.getElementById("excalidraw-dice-root")) return;

    injectStyles();

    root = document.createElement("div");
    root.id = "excalidraw-dice-root";
    root.className = "excalidraw-dice-root";
    for (const eventName of ["pointerdown", "mousedown", "click", "dblclick", "wheel", "keydown", "keyup"]) {
      root.addEventListener(eventName, (event) => event.stopPropagation());
    }

    const card = document.createElement("div");
    card.className = "excalidraw-dice-card";

    const header = document.createElement("div");
    header.className = "excalidraw-dice-header";

    toggleButton = createButton("▸", "excalidraw-dice-toggle", () => {
      state.expanded = !state.expanded;
      saveState();
      renderState();
    });
    toggleButton.setAttribute("aria-label", "Expand dice panel");

    const summary = document.createElement("div");
    summary.className = "excalidraw-dice-summary";

    collapsedSummaryNode = document.createElement("div");
    collapsedSummaryNode.className = "excalidraw-dice-summary-main";

    collapsedResultNode = document.createElement("div");
    collapsedResultNode.className = "excalidraw-dice-summary-result";

    statusNode = document.createElement("div");
    statusNode.className = "excalidraw-dice-status";
    statusNode.textContent = "Finding Excalidraw...";

    summary.append(collapsedSummaryNode, collapsedResultNode);

    const headerRoll = createButton("Roll", "excalidraw-dice-roll", () => {
      onRollClick(state.expression || state.lastExpression || DEFAULT_LAST_EXPRESSION, state.reason);
    });

    header.append(toggleButton, summary, headerRoll);

    panelNode = document.createElement("div");
    panelNode.className = "excalidraw-dice-panel";

    const pool = document.createElement("div");
    pool.className = "excalidraw-dice-pool";
    dicePoolRows = new Map();
    for (const die of VISUAL_DICE_TYPES) {
      pool.append(
        createDicePoolRow(
          die,
          die,
          () => changeDieCount(die, 1),
          () => changeDieCount(die, -1),
        ),
      );
    }

    const controls = document.createElement("div");
    controls.className = "excalidraw-dice-controls";

    historyNode = document.createElement("div");
    historyNode.className = "excalidraw-dice-history";

    expressionInput = document.createElement("input");
    expressionInput.className = "excalidraw-dice-input";
    expressionInput.type = "text";
    expressionInput.spellcheck = false;
    expressionInput.placeholder = "d20+3";
    expressionInput.addEventListener("input", () => {
      state.expression = expressionInput.value;
      if (!syncPoolFromExpression(state.expression)) {
        resetDicePool();
      }
      saveState();
      renderState();
    });
    expressionInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onRollClick(state.expression, state.reason);
      }
    });

    reasonInput = document.createElement("input");
    reasonInput.className = "excalidraw-dice-input";
    reasonInput.type = "text";
    reasonInput.placeholder = "Reason for Roll";
    reasonInput.addEventListener("input", () => {
      state.reason = reasonInput.value;
      saveState();
    });
    reasonInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onRollClick(state.expression, state.reason);
      }
    });

    const reasonRow = document.createElement("div");
    reasonRow.className = "excalidraw-dice-reason-row";
    const modifierRow = createDicePoolRow("modifier", "+1", () => changeModifier(1), () => changeModifier(-1));
    modifierRow.classList.add("excalidraw-dice-modifier");
    reasonRow.append(reasonInput, modifierRow);

    controls.append(historyNode, expressionInput);
    panelNode.append(pool, controls);
    card.append(panelNode, reasonRow, header);
    root.append(card);
    document.body.append(root);
    console.info("[excalidraw-dice] UI mounted");

    renderState();
  }

  async function boot() {
    loadState();
    buildUi();
    startApiScan();

    try {
      await loadDiceLibraries();
      if (isExcalidrawApi(cachedApi)) {
        setStatus("Ready");
      }
    } catch (error) {
      console.error("[excalidraw-dice] dice library failed", error);
      setStatus(error && error.message ? error.message : String(error));
    }
  }

  boot();
})();
