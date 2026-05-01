(function initAutodartsOverlay() {
  'use strict';

  const { normalizeAutodartsState } = window.AutodartsNormalizer;

  const elements = {
    form: document.getElementById('profileForm'),
    host: document.getElementById('hostInput'),
    port: document.getElementById('portInput'),
    pollInterval: document.getElementById('pollIntervalInput'),
    profileState: document.getElementById('profileState'),
    formMessage: document.getElementById('formMessage'),
    phaseBanner: document.getElementById('phaseBanner'),
    phaseTitle: document.getElementById('phaseTitle'),
    phaseDetail: document.getElementById('phaseDetail'),
    connected: document.getElementById('connectedValue'),
    running: document.getElementById('runningValue'),
    status: document.getElementById('statusValue'),
    event: document.getElementById('eventValue'),
    numThrows: document.getElementById('numThrowsValue'),
    visitScore: document.getElementById('visitScoreValue'),
    throwCountHint: document.getElementById('throwCountHint'),
    dartCards: document.getElementById('dartCards'),
    eventLog: document.getElementById('eventLog'),
    rawJson: document.getElementById('rawJson'),
    configJson: document.getElementById('configJson'),
    testButton: document.getElementById('testButton'),
    startButton: document.getElementById('startButton'),
    stopButton: document.getElementById('stopButton'),
    discoverButton: document.getElementById('discoverButton'),
    discoverResults: document.getElementById('discoverResults'),
    configButton: document.getElementById('configButton'),
    clearLogButton: document.getElementById('clearLogButton')
  };

  const state = {
    timer: null,
    requestInFlight: false,
    lastConnection: null,
    lastStatusKey: '',
    lastTakeoutActive: false,
    lastThrowSignature: '',
    lastNumThrows: 0,
    lastEventKey: '',
    discoveryInFlight: false
  };

  function getProfileFromForm() {
    return {
      host: elements.host.value.trim(),
      port: Number(elements.port.value || 3180),
      pollIntervalMs: Number(elements.pollInterval.value || 1000)
    };
  }

  function setMessage(text, tone) {
    elements.formMessage.textContent = text || '';
    elements.formMessage.dataset.tone = tone || '';
  }

  function formatBoolean(value) {
    return value ? 'true' : 'false';
  }

  function formatCoordinate(value) {
    return value === null || value === undefined ? '-' : Number(value).toFixed(3);
  }

  function stateUrl(endpoint) {
    const profile = getProfileFromForm();
    const query = new URLSearchParams({
      host: profile.host,
      port: String(profile.port)
    });
    return `${endpoint}?${query.toString()}`;
  }

  function discoverUrl() {
    const profile = getProfileFromForm();
    const query = new URLSearchParams({
      port: String(profile.port || 3180)
    });
    return `/api/discover?${query.toString()}`;
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    if (!response.ok) {
      const message = body && body.error ? body.error : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return body;
  }

  function addLog(message, key) {
    const eventKey = key || message;
    if (state.lastEventKey === eventKey) return;
    state.lastEventKey = eventKey;

    const item = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = new Date().toLocaleTimeString();
    const text = document.createElement('span');
    text.textContent = message;
    item.append(time, text);
    elements.eventLog.prepend(item);

    while (elements.eventLog.children.length > 80) {
      elements.eventLog.lastElementChild.remove();
    }
  }

  function updateEventLog(normalized) {
    if (state.lastConnection !== normalized.connected) {
      addLog(normalized.connected ? 'Verbindung erfolgreich' : 'Verbindung verloren', `connection:${normalized.connected}`);
      state.lastConnection = normalized.connected;
    }

    const statusKey = `${normalized.phase}|${normalized.statusText}|${normalized.eventText}`;
    if (statusKey !== state.lastStatusKey) {
      addLog(`Statuswechsel: ${normalized.phase} (${normalized.statusText || '-'}/${normalized.eventText || '-'})`, `status:${statusKey}`);
      state.lastStatusKey = statusKey;
    }

    if (!state.lastTakeoutActive && normalized.takeoutActive) {
      addLog('Takeout gestartet', 'takeout:start');
    }
    if (state.lastTakeoutActive && !normalized.takeoutActive) {
      addLog('Takeout beendet', 'takeout:end');
    }
    state.lastTakeoutActive = normalized.takeoutActive;

    const throwSignature = normalized.throws.map((dart) => `${dart.index}:${dart.segmentName}:${dart.x}:${dart.y}`).join('|');
    if (throwSignature && throwSignature !== state.lastThrowSignature) {
      const latest = normalized.throws[normalized.throws.length - 1];
      addLog(`Neuer Dart erkannt: Dart ${latest.index} ${latest.segmentName}`, `dart:${throwSignature}`);
    }
    state.lastThrowSignature = throwSignature;

    if (state.lastNumThrows > 0 && normalized.numThrows === 0) {
      addLog('Aufnahme geleert', 'visit:cleared');
    }
    state.lastNumThrows = normalized.numThrows;
  }

  function phaseCopy(normalized) {
    if (normalized.phase === 'offline') {
      return ['Board nicht bereit', normalized.connected ? 'Gestoppt oder nicht laufend' : 'Nicht verbunden'];
    }
    if (normalized.phase === 'takeout') {
      return ['Darts entfernen / Takeout laeuft', normalized.eventText || normalized.statusText || 'Hand erkannt'];
    }
    if (normalized.phase === 'dart-detected') {
      return ['Wurfphase', `${normalized.numThrows} Dart${normalized.numThrows === 1 ? '' : 's'} erkannt`];
    }
    if (normalized.phase === 'throwing') {
      return ['Wurfphase', normalized.eventText || 'Bereit fuer Wurf'];
    }
    if (normalized.phase === 'error') {
      return ['Fehler', normalized.eventText || normalized.statusText || 'Fehlerzustand'];
    }
    return ['Bereit', normalized.eventText || normalized.statusText || 'Status unbekannt'];
  }

  function renderPhase(normalized) {
    const [title, detail] = phaseCopy(normalized);
    elements.phaseTitle.textContent = title;
    elements.phaseDetail.textContent = detail;
    elements.phaseBanner.className = `phase phase-${normalized.phase}`;
  }

  function renderDarts(normalized) {
    elements.dartCards.textContent = '';
    elements.throwCountHint.textContent = normalized.numThrows
      ? `${normalized.numThrows} Dart${normalized.numThrows === 1 ? '' : 's'}`
      : 'Keine Darts';

    for (let index = 1; index <= 3; index += 1) {
      const dart = normalized.throws[index - 1];
      const card = document.createElement('article');
      card.className = `dart-card${dart ? '' : ' empty'}`;

      const title = document.createElement('span');
      title.className = 'dart-index';
      title.textContent = `Dart ${index}`;

      const segment = document.createElement('strong');
      segment.textContent = dart ? dart.segmentName : index <= normalized.numThrows ? 'Erkannt' : '-';

      const score = document.createElement('span');
      score.className = 'dart-score';
      score.textContent = dart ? `${dart.score} Punkte` : 'Keine Segmentdaten';

      const coords = document.createElement('span');
      coords.className = 'coords';
      coords.textContent = dart ? `x ${formatCoordinate(dart.x)} / y ${formatCoordinate(dart.y)}` : 'x - / y -';

      card.append(title, segment, score, coords);
      elements.dartCards.append(card);
    }
  }

  function renderState(normalized) {
    renderPhase(normalized);
    elements.connected.textContent = formatBoolean(normalized.connected);
    elements.running.textContent = formatBoolean(normalized.running);
    elements.status.textContent = normalized.statusText || '-';
    elements.event.textContent = normalized.eventText || '-';
    elements.numThrows.textContent = String(normalized.numThrows);
    elements.visitScore.textContent = String(normalized.visitScore);
    renderDarts(normalized);
    elements.rawJson.textContent = JSON.stringify(normalized.raw, null, 2);
    updateEventLog(normalized);
  }

  function renderNetworkError(error) {
    const normalized = normalizeAutodartsState({
      connected: false,
      running: false,
      status: 'Error',
      event: error.message,
      numThrows: 0
    });
    renderState(normalized);
    elements.rawJson.textContent = JSON.stringify({ error: error.message }, null, 2);
    setMessage(error.message, 'error');
  }

  async function pollOnce() {
    if (state.requestInFlight) return;
    state.requestInFlight = true;
    try {
      const raw = await fetchJson(stateUrl('/api/state'));
      const normalized = normalizeAutodartsState(raw);
      renderState(normalized);
      setMessage('Status aktualisiert.', 'ok');
    } catch (error) {
      renderNetworkError(error);
    } finally {
      state.requestInFlight = false;
    }
  }

  function stopPolling() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
      setMessage('Polling gestoppt.', 'info');
    }
  }

  function startPolling() {
    stopPolling();
    const interval = Math.max(250, Math.min(10000, Number(elements.pollInterval.value || 1000)));
    pollOnce();
    state.timer = setInterval(pollOnce, interval);
    setMessage(`Polling gestartet (${interval} ms).`, 'ok');
  }

  async function saveProfile(event) {
    event.preventDefault();
    try {
      const profile = getProfileFromForm();
      const saved = await fetchJson('/api/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(profile)
      });
      elements.profileState.textContent = 'Gespeichert';
      setMessage('Profil lokal gespeichert.', 'ok');
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }

  async function loadProfile() {
    try {
      const profile = await fetchJson('/api/profile');
      if (profile.host) elements.host.value = profile.host;
      if (profile.port) elements.port.value = profile.port;
      if (profile.pollIntervalMs) elements.pollInterval.value = profile.pollIntervalMs;
      elements.profileState.textContent = profile.host ? 'Gespeichert' : 'Nicht gespeichert';
    } catch (error) {
      setMessage(`Profil konnte nicht geladen werden: ${error.message}`, 'error');
    }
  }

  async function testConnection() {
    try {
      const raw = await fetchJson(stateUrl('/api/state'));
      const normalized = normalizeAutodartsState(raw);
      renderState(normalized);
      setMessage('Verbindungstest erfolgreich.', 'ok');
    } catch (error) {
      renderNetworkError(error);
    }
  }

  async function loadConfig() {
    try {
      elements.configJson.textContent = 'Lade...';
      const raw = await fetchJson(stateUrl('/api/config'));
      elements.configJson.textContent = JSON.stringify(raw, null, 2);
      setMessage('/api/config gelesen.', 'ok');
    } catch (error) {
      elements.configJson.textContent = JSON.stringify({ error: error.message }, null, 2);
      setMessage(`/api/config nicht verfuegbar: ${error.message}`, 'error');
    }
  }

  function renderDiscoveryResults(result) {
    elements.discoverResults.textContent = '';

    const summary = document.createElement('p');
    summary.className = 'discover-summary';
    summary.textContent = `${result.scanned || 0} Adressen geprueft, ${result.boards.length} Board${result.boards.length === 1 ? '' : 's'} gefunden.`;
    elements.discoverResults.append(summary);

    if (!result.boards.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Kein verbundenes Board mit connected: true gefunden.';
      elements.discoverResults.append(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'discover-list';

    for (const board of result.boards) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'discover-item';
      const title = document.createElement('strong');
      title.textContent = `${board.host}:${board.port}`;
      const detail = document.createElement('span');
      detail.textContent = `${board.status || '-'} / ${board.event || '-'}`;
      item.append(title, detail);
      item.addEventListener('click', () => {
        elements.host.value = board.host;
        elements.port.value = board.port;
        setMessage(`Board ${board.host}:${board.port} uebernommen.`, 'ok');
      });
      list.append(item);
    }

    elements.discoverResults.append(list);
  }

  async function discoverBoards() {
    if (state.discoveryInFlight) return;
    state.discoveryInFlight = true;
    elements.discoverButton.disabled = true;
    elements.discoverResults.textContent = '';
    setMessage('Suche Board im lokalen Netzwerk...', 'info');

    try {
      const result = await fetchJson(discoverUrl());
      renderDiscoveryResults(result);
      setMessage(`Netzwerksuche abgeschlossen (${result.durationMs || 0} ms).`, result.boards.length ? 'ok' : 'info');
    } catch (error) {
      elements.discoverResults.textContent = '';
      setMessage(`Netzwerksuche fehlgeschlagen: ${error.message}`, 'error');
    } finally {
      state.discoveryInFlight = false;
      elements.discoverButton.disabled = false;
    }
  }

  elements.form.addEventListener('submit', saveProfile);
  elements.testButton.addEventListener('click', testConnection);
  elements.startButton.addEventListener('click', startPolling);
  elements.stopButton.addEventListener('click', stopPolling);
  elements.discoverButton.addEventListener('click', discoverBoards);
  elements.configButton.addEventListener('click', loadConfig);
  elements.clearLogButton.addEventListener('click', () => {
    elements.eventLog.textContent = '';
    state.lastEventKey = '';
  });

  loadProfile();
})();
