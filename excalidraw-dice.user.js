// ==UserScript==
// @name         Excalidraw TRPG ToolKit
// @name:zh-CN   Excalidraw TRPG工具
// @namespace    https://github.com/YellowSubm/excalidraw-trpg
// @version      0.6.5
// @description  Add a collapsible TRPG dice panel to Excalidraw and write roll logs into the canvas.
// @description:zh-CN 为 Excalidraw 添加可折叠的 TRPG 骰子面板，并把投掷记录写入画布。
// @author       YellowSubm
// @license      Apache-2.0
// @match        https://excalidraw.com/*
// @match        https://app.excalidraw.com/*
// @match        https://*.excalidraw.com/*
// @require      https://cdn.jsdelivr.net/npm/mathjs@11.8.2/lib/browser/math.js
// @require      https://cdn.jsdelivr.net/npm/random-js@2.1.0/dist/random-js.umd.min.js
// @require      https://cdn.jsdelivr.net/npm/@dice-roller/rpg-dice-roller@5.5.1/lib/umd/bundle.min.js
// @supportURL   https://github.com/YellowSubm/excalidraw-trpg/issues
// @run-at       document-idle
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  "use strict";

  console.info("[excalidraw-dice] userscript boot", location.href);

  const pageWindow =
    typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
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

  function createDicePool(overrides = {}) {
    const pool = {};
    for (const die of DICE_TYPES) {
      const count = Number(overrides[die]);
      pool[die] = Number.isInteger(count) && count > 0 ? count : 0;
    }
    return pool;
  }

  function createDefaultState() {
    return {
      expanded: false,
      expression: DEFAULT_EXPRESSION,
      reason: "",
      lastExpression: DEFAULT_LAST_EXPRESSION,
      lastReason: "",
      lastResult: "",
      history: [],
      dicePool: createDicePool({ d20: 1 }),
      modifier: 0,
    };
  }

  const PanelStorage = (() => {
    function normalize(parsed) {
      const nextState = createDefaultState();
      const parsedPool =
        parsed.dicePool && typeof parsed.dicePool === "object"
          ? parsed.dicePool
          : null;

      Object.assign(nextState, {
        expanded: Boolean(parsed.expanded),
        expression: String(parsed.expression || DEFAULT_EXPRESSION),
        reason: String(parsed.reason || ""),
        lastExpression: String(
          parsed.lastExpression || parsed.expression || DEFAULT_LAST_EXPRESSION,
        ),
        lastReason: String(parsed.lastReason || parsed.reason || ""),
        lastResult: String(parsed.lastResult || ""),
        history: Array.isArray(parsed.history)
          ? parsed.history.slice(-MAX_HISTORY_ITEMS)
          : [],
        dicePool: parsedPool ? createDicePool(parsedPool) : createDicePool(),
        modifier: Number.isFinite(Number(parsed.modifier))
          ? Number(parsed.modifier)
          : 0,
      });

      if (!parsedPool) {
        nextState.expression = DEFAULT_EXPRESSION;
        nextState.modifier = 0;
      }

      return nextState;
    }

    function load() {
      try {
        return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
      } catch {
        return createDefaultState();
      }
    }

    function save(panelState) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          expanded: panelState.expanded,
          expression: panelState.expression,
          reason: panelState.reason,
          lastExpression: panelState.lastExpression,
          lastReason: panelState.lastReason,
          lastResult: panelState.lastResult,
          history: panelState.history,
          dicePool: panelState.dicePool,
          modifier: panelState.modifier,
        }),
      );
    }

    return {
      load,
      save,
    };
  })();

  const state = PanelStorage.load();

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

  const ExcalidrawRuntime = (() => {
    let cachedApi = null;
    let scanStartedAt = 0;
    let scanTimer = null;
    let diceLibraryReady = false;

    function isApi(value) {
      return (
        value &&
        typeof value === "object" &&
        typeof value.updateScene === "function" &&
        typeof value.getSceneElements === "function" &&
        value.isDestroyed !== true
      );
    }

    function findApi() {
      if (isApi(cachedApi)) {
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

        if (isApi(node)) {
          cachedApi = node;
          return cachedApi;
        }
        if (isApi(node.api)) {
          cachedApi = node.api;
          return cachedApi;
        }
        if (isApi(node.stateNode)) {
          cachedApi = node.stateNode;
          return cachedApi;
        }
        if (isApi(node.stateNode && node.stateNode.api)) {
          cachedApi = node.stateNode.api;
          return cachedApi;
        }
        if (isApi(node.memoizedProps && node.memoizedProps.excalidrawAPI)) {
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
      const api = findApi();
      if (!api) {
        throw new Error("Excalidraw API is not ready");
      }
      return api;
    }

    function startScan(onStatus) {
      scanStartedAt = Date.now();
      scanTimer = window.setInterval(() => {
        const api = findApi();
        if (api) {
          onStatus("Ready");
          window.clearInterval(scanTimer);
          scanTimer = null;
          return;
        }
        if (Date.now() - scanStartedAt > API_SCAN_TIMEOUT_MS) {
          onStatus("API not found");
          window.clearInterval(scanTimer);
          scanTimer = null;
        }
      }, API_SCAN_INTERVAL_MS);
    }

    function getDiceRoller() {
      const candidates = [
        typeof rpgDiceRoller !== "undefined" ? rpgDiceRoller : null,
        typeof globalThis !== "undefined" ? globalThis.rpgDiceRoller : null,
        typeof window !== "undefined" ? window.rpgDiceRoller : null,
        pageWindow.rpgDiceRoller,
      ];
      return candidates.find((candidate) => candidate && candidate.DiceRoll);
    }

    async function loadDiceLibraries(onStatus) {
      onStatus("Checking dice library...");
      const roller = getDiceRoller();
      if (roller) {
        diceLibraryReady = true;
        console.info("[excalidraw-dice] @require dice library ready");
        return;
      }

      throw new Error("@require dice library is unavailable");
    }

    function rollNotation(notation) {
      const roller = getDiceRoller();
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

    return {
      ensureApi,
      hasApi: () => isApi(cachedApi),
      loadDiceLibraries,
      rollNotation,
      startScan,
    };
  })();

  function getPlayerName(api) {
    try {
      const collab = JSON.parse(
        localStorage.getItem("excalidraw-collab") || "{}",
      );
      const collabUsername =
        typeof collab.username === "string" ? collab.username.trim() : "";
      if (collabUsername) {
        return collabUsername;
      }
    } catch {
      // Fall back to app state below.
    }

    const appState =
      typeof api.getAppState === "function" ? api.getAppState() : {};
    const username =
      appState && typeof appState.username === "string"
        ? appState.username.trim()
        : "";
    return username || "Anonymous";
  }

  function makeId() {
    return (
      Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
    );
  }

  function makeNonce() {
    return Math.floor(Math.random() * 2 ** 31);
  }

  const CanvasLog = (() => {
    function isLiveLogElement(element) {
      return (
        element &&
        element.isDeleted !== true &&
        element.type === "text" &&
        element.customData &&
        element.customData[LOG_CUSTOM_DATA_KEY] === true
      );
    }

    function findElement(elements) {
      return elements
        .filter(isLiveLogElement)
        .sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
    }

    function fitTextHeight(element, text) {
      const fontSize = element.fontSize || 20;
      const lineHeight = element.lineHeight || 1.25;
      const lineCount = text.split("\n").length;
      return Math.max(
        element.height || 0,
        Math.ceil(lineCount * fontSize * lineHeight),
      );
    }

    function createElement(text) {
      const fontSize = 20;
      const lineHeight = 1.25;

      return {
        id: makeId(),
        type: "text",
        x: 80,
        y: 80,
        width: 420,
        height: fitTextHeight({ height: 80, fontSize, lineHeight }, text),
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

    function updateElement(existing, text) {
      return {
        ...existing,
        text,
        originalText: text,
        height: fitTextHeight(existing, text),
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

    function trimText(text) {
      const lines = String(text).split("\n");
      const title = lines[0] || LOG_TITLE;
      const entries = lines.slice(1);
      const keptEntries =
        entries.length > MAX_LOG_LINES
          ? entries.slice(-MAX_LOG_LINES)
          : entries;
      return [title, ...keptEntries].join("\n");
    }

    function appendLine(api, line) {
      const elements = api.getSceneElements();
      const existing = findElement(elements);
      const text = trimText(
        existing ? `${existing.text}\n${line}` : `${LOG_TITLE}\n${line}`,
      );
      const logElement = existing
        ? updateElement(existing, text)
        : createElement(text);
      const nextElements = existing
        ? elements.map((element) =>
            element.id === existing.id ? logElement : element,
          )
        : [...elements, logElement];

      api.updateScene({
        elements: nextElements,
        captureUpdate: "IMMEDIATELY",
      });
    }

    return {
      appendLine,
    };
  })();

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

  function commitState(options = {}) {
    PanelStorage.save(state);
    renderState();
    if (options.scrollHistory) {
      scrollHistoryToBottom();
    }
  }

  const DiceExpression = (() => {
    function emptyPool() {
      return createDicePool();
    }

    function buildFromPool(pool, modifier) {
      const terms = [];
      for (const die of DICE_TYPES) {
        const count = pool[die] || 0;
        if (count === 1) {
          terms.push(die);
        } else if (count > 1) {
          terms.push(`${count}${die}`);
        }
      }

      let expression = terms.join("+");
      if (modifier > 0) {
        expression += `${expression ? "+" : ""}${modifier}`;
      } else if (modifier < 0) {
        expression += `${modifier}`;
      }
      return expression;
    }

    function parseSimplePool(expression) {
      const cleanExpression = String(expression || "").replace(/\s+/g, "");
      const nextPool = emptyPool();
      let nextModifier = 0;

      if (!cleanExpression) {
        return { ok: true, pool: nextPool, modifier: nextModifier };
      }

      const normalized = cleanExpression.replace(/-/g, "+-");
      const rawTerms = normalized.split("+").filter(Boolean);

      for (const term of rawTerms) {
        const diceMatch = term.match(/^(\d*)d(4|6|8|10|12|20|100)$/i);
        if (diceMatch) {
          const die = `d${diceMatch[2]}`;
          const count = diceMatch[1] ? Number(diceMatch[1]) : 1;
          if (!Number.isInteger(count) || count < 1) {
            return { ok: false };
          }
          nextPool[die] += count;
          continue;
        }

        if (/^-?\d+$/.test(term)) {
          nextModifier += Number(term);
          continue;
        }

        return { ok: false };
      }

      return { ok: true, pool: nextPool, modifier: nextModifier };
    }

    return {
      buildFromPool,
      emptyPool,
      parseSimplePool,
    };
  })();

  function resetDicePool() {
    state.dicePool = DiceExpression.emptyPool();
    state.modifier = 0;
  }

  function applyPoolToExpression() {
    state.expression = DiceExpression.buildFromPool(
      state.dicePool,
      state.modifier,
    );
    commitState();
  }

  function syncPoolFromExpression(expression) {
    const parsed = DiceExpression.parseSimplePool(expression);
    if (!parsed.ok) {
      return false;
    }
    state.dicePool = parsed.pool;
    state.modifier = parsed.modifier;
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

  function toggleExpanded() {
    state.expanded = !state.expanded;
    commitState();
  }

  function setExpressionFromInput(value) {
    state.expression = value;
    if (!syncPoolFromExpression(state.expression)) {
      resetDicePool();
    }
    commitState();
  }

  function setReasonFromInput(value) {
    state.reason = value;
    commitState();
  }

  function rollCurrent() {
    onRollClick(
      state.expression || state.lastExpression || DEFAULT_LAST_EXPRESSION,
      state.reason,
    );
  }

  function rollInputExpression() {
    onRollClick(state.expression, state.reason);
  }

  const RollWorkflow = (() => {
    function normalizeRequest(expression, reason) {
      const cleanExpression = String(expression || "").trim();
      const cleanReason = String(reason || "").trim();
      if (!cleanExpression) {
        throw new Error("Please enter a dice expression");
      }
      return { expression: cleanExpression, reason: cleanReason };
    }

    function recordLocalResult(request, playerName, total) {
      addHistoryEntry({
        playerName,
        expression: request.expression,
        reason: request.reason,
        total,
        timestamp: Date.now(),
      });

      state.expression = request.expression;
      state.reason = request.reason;
      state.lastExpression = request.expression;
      state.lastReason = request.reason;
      state.lastResult = String(total);
      commitState({ scrollHistory: true });
    }

    function perform(expression, reason) {
      const request = normalizeRequest(expression, reason);
      const api = ExcalidrawRuntime.ensureApi();
      const roll = ExcalidrawRuntime.rollNotation(request.expression);
      const playerName = getPlayerName(api);
      const line = formatRollLine(
        playerName,
        request.expression,
        request.reason,
        roll.total,
      );

      CanvasLog.appendLine(api, line);
      recordLocalResult(request, playerName, roll.total);
      setStatus(roll.output);
    }

    return {
      perform,
    };
  })();

  function setStatus(message) {
    if (statusNode) {
      statusNode.textContent = message;
    }
  }

  function getCurrentSummary() {
    const expression =
      state.expression || state.lastExpression || DEFAULT_LAST_EXPRESSION;
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

    renderPanelVisibility();
    renderInputs();
    renderSummary();
    renderHistory();
    renderDicePool();
  }

  function renderPanelVisibility() {
    root.classList.toggle("excalidraw-dice-expanded", state.expanded);
    root.classList.toggle("excalidraw-dice-collapsed", !state.expanded);

    if (panelNode) {
      panelNode.hidden = !state.expanded;
      panelNode.style.display = state.expanded ? "grid" : "none";
    }
    if (toggleButton) {
      toggleButton.textContent = state.expanded ? "▴" : "▸";
      toggleButton.title = state.expanded
        ? "Collapse dice panel"
        : "Expand dice panel";
      toggleButton.setAttribute("aria-expanded", String(state.expanded));
    }
  }

  function renderInputs() {
    if (expressionInput && expressionInput.value !== state.expression) {
      expressionInput.value = state.expression;
    }
    if (reasonInput && reasonInput.value !== state.reason) {
      reasonInput.value = state.reason;
    }
  }

  function renderSummary() {
    if (collapsedSummaryNode) {
      collapsedSummaryNode.textContent = getCurrentSummary();
    }
    if (collapsedResultNode) {
      collapsedResultNode.textContent = isShowingLastRoll()
        ? `= ${state.lastResult}`
        : "";
    }
  }

  function renderDicePool() {
    for (const [key, row] of dicePoolRows) {
      const count =
        key === "modifier" ? state.modifier : state.dicePool[key] || 0;
      row.count.textContent = count ? String(count) : "";
      row.minus.disabled = key === "modifier" ? false : count <= 0;
    }
  }

  function onRollClick(expression, reason) {
    try {
      setStatus("Rolling...");
      RollWorkflow.perform(expression, reason);
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

  function createRootNode() {
    const rootNode = document.createElement("div");
    rootNode.id = "excalidraw-dice-root";
    rootNode.className = "excalidraw-dice-root";
    for (const eventName of [
      "pointerdown",
      "mousedown",
      "click",
      "dblclick",
      "wheel",
      "keydown",
      "keyup",
    ]) {
      rootNode.addEventListener(eventName, (event) => event.stopPropagation());
    }
    return rootNode;
  }

  function createHeaderView() {
    const header = document.createElement("div");
    header.className = "excalidraw-dice-header";

    toggleButton = createButton("▸", "excalidraw-dice-toggle", toggleExpanded);
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

    const headerRoll = createButton(
      "Roll",
      "excalidraw-dice-roll",
      rollCurrent,
    );

    header.append(toggleButton, summary, headerRoll);
    return header;
  }

  function createDicePoolView() {
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
    return pool;
  }

  function createExpressionInput() {
    const input = document.createElement("input");
    input.className = "excalidraw-dice-input";
    input.type = "text";
    input.spellcheck = false;
    input.placeholder = "d20+3";
    input.addEventListener("input", () => {
      setExpressionFromInput(input.value);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        rollInputExpression();
      }
    });
    return input;
  }

  function createHistoryControlsView() {
    const controls = document.createElement("div");
    controls.className = "excalidraw-dice-controls";

    historyNode = document.createElement("div");
    historyNode.className = "excalidraw-dice-history";

    expressionInput = createExpressionInput();
    controls.append(historyNode, expressionInput);
    return controls;
  }

  function createReasonRowView() {
    const row = document.createElement("div");
    row.className = "excalidraw-dice-reason-row";

    reasonInput = document.createElement("input");
    reasonInput.className = "excalidraw-dice-input";
    reasonInput.type = "text";
    reasonInput.placeholder = "Reason for Roll";
    reasonInput.addEventListener("input", () => {
      setReasonFromInput(reasonInput.value);
    });
    reasonInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        rollInputExpression();
      }
    });

    const modifierRow = createDicePoolRow(
      "modifier",
      "+1",
      () => changeModifier(1),
      () => changeModifier(-1),
    );
    modifierRow.classList.add("excalidraw-dice-modifier");
    row.append(reasonInput, modifierRow);
    return row;
  }

  function createExpandedPanelView() {
    panelNode = document.createElement("div");
    panelNode.className = "excalidraw-dice-panel";
    panelNode.append(createDicePoolView(), createHistoryControlsView());
    return panelNode;
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
        min-height: 36px;
        padding: 3px 6px 3px;
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
        align-items: stretch;
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
        padding: 6px 6px 0px;
      }

      .excalidraw-dice-modifier {
        display: grid;
        grid-template-columns: 30px 58px;
        column-gap: 4px;
        align-items: center;
      }

      .excalidraw-dice-modifier .excalidraw-dice-minus,
      .excalidraw-dice-modifier .excalidraw-dice-die {
        height: 32px;
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
        height: 32px;
        box-sizing: border-box;
        border: 1px solid rgba(17, 24, 39, 0.18);
        border-radius: 4px;
        padding: 6px;
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
        display: flex;
        flex-direction: column;
        grid-template-rows: auto auto;
        align-content: stretch;
        min-height: 100%;
        max-height: 200px;
        gap: 6px;
        min-width: 0;
      }

      .excalidraw-dice-history {
        box-sizing: border-box;
        display: grid;
        align-content: start;
        gap: 4px;
        min-height: 0;
        border-radius: 4px;
        background: rgba(17, 24, 39, 0.03);
        padding: 6px;
        overflow-x: hidden;
        overflow-y: auto;
        flex:1
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

    root = createRootNode();
    const card = document.createElement("div");
    card.className = "excalidraw-dice-card";
    card.append(
      createExpandedPanelView(),
      createReasonRowView(),
      createHeaderView(),
    );
    root.append(card);
    document.body.append(root);
    console.info("[excalidraw-dice] UI mounted");

    renderState();
  }

  async function boot() {
    buildUi();
    ExcalidrawRuntime.startScan(setStatus);

    try {
      await ExcalidrawRuntime.loadDiceLibraries(setStatus);
      if (ExcalidrawRuntime.hasApi()) {
        setStatus("Ready");
      }
    } catch (error) {
      console.error("[excalidraw-dice] dice library failed", error);
      setStatus(error && error.message ? error.message : String(error));
    }
  }

  boot();
})();
