/* Slope Sentinel – IPITEx 2027
 * Mobile-first dashboard. Data: ESP32 -> MQTT (EMQX public broker) -> this Web App (MQTT over WebSocket).
 */
(() => {
  'use strict';

  /* ---------- configuration ---------- */
  const DEFAULTS = {
    broker: 'wss://broker.emqx.io:8084/mqtt',
    base: 'ipitex2027/slopesentinel/dl01',
    sound: true,
    demo: false
  };
  // Must stay identical to the thresholds in the firmware
  const TH = { soilWatch: 70, soilWarn: 85, tiltWatch: 6, tiltWarn: 12, tiltDanger: 20, battLow: 20 };
  const STALE_MS = 12000;
  const MAX_POINTS = 150;

  const SEV = [
    { name: 'ALL CLEAR', msg: 'Slope conditions are stable.', color: '#2e9e5b' },
    { name: 'WATCH',     msg: 'Early signs detected. Monitor closely.', color: '#d9a000' },
    { name: 'WARNING',   msg: 'Slope is becoming unstable. Prepare to evacuate.', color: '#ee7a1c' },
    { name: 'DANGER',    msg: 'Landslide risk is critical. Evacuate now.', color: '#d92d2d' }
  ];

  /* ---------- tiny helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };
  const cfg = Object.assign({}, DEFAULTS, store.get('ss.cfg', {}));
  if (new URLSearchParams(location.search).get('demo') === '1') cfg.demo = true;

  const state = { data: null, lastRx: 0, sev: -1, online: false, mqtt: null, notif: false };
  const history = [];
  let logItems = store.get('ss.log', []);

  const fmt = (n, d = 1) => (typeof n === 'number' && isFinite(n)) ? n.toFixed(d) : '--';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const timeStr = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  /* ---------- severity (used by demo; the device computes its own) ---------- */
  function computeSeverity(d) {
    let s = 0, n = 0, trig = 0;
    if (d.soil >= TH.soilWarn) { s = Math.max(s, 2); n++; trig |= 1; }
    else if (d.soil >= TH.soilWatch) { s = Math.max(s, 1); n++; trig |= 1; }
    if (d.tilt >= TH.tiltDanger) { s = Math.max(s, 3); n++; trig |= 2; }
    else if (d.tilt >= TH.tiltWarn) { s = Math.max(s, 2); n++; trig |= 2; }
    else if (d.tilt >= TH.tiltWatch) { s = Math.max(s, 1); n++; trig |= 2; }
    if (d.crack) { s = 3; n++; trig |= 4; }
    if (d.batt <= TH.battLow) trig |= 8;
    if (n >= 2 && s < 3) s++;
    return { sev: s, trig };
  }

  /* ---------- rendering ---------- */
  function setSev(sev) { document.body.dataset.sev = String(sev); }

  function render() {
    const d = state.data;
    const fresh = d && (Date.now() - state.lastRx) < STALE_MS;
    const live = cfg.demo || fresh;

    // connection chip
    const chip = $('connChip');
    chip.className = 'conn ' + (live ? 'on' : (state.mqtt && state.mqtt.connected ? '' : 'off'));
    $('connText').textContent = cfg.demo ? 'Demo mode'
      : fresh ? 'Stake online'
      : (state.mqtt && state.mqtt.connected ? 'Cloud connected · stake offline' : 'Cloud disconnected');
    $('updatedText').textContent = d ? 'Updated ' + timeStr(state.lastRx) : 'No data yet';

    if (!d || !live) {
      setSev(-1);
      $('heroLevel').textContent = d ? 'STAKE OFFLINE' : 'NO DATA';
      $('heroMsg').textContent = d ? 'No report for over 12 seconds. Last values are shown below.' : 'Waiting for the stake to report.';
      $('trigChips').innerHTML = '<li class="none">No active triggers</li>';
      if (!d) return;
    } else {
      const s = clamp(d.sev | 0, 0, 3);
      setSev(s);
      $('heroLevel').textContent = SEV[s].name;
      $('heroMsg').textContent = SEV[s].msg;
      const chips = [];
      if (d.trig & 1) chips.push('Soil saturated');
      if (d.trig & 2) chips.push('Slope tilting');
      if (d.trig & 4) chips.push('Crack opened');
      if (d.trig & 8) chips.push('Low battery');
      $('trigChips').innerHTML = chips.length
        ? chips.map((c) => `<li>${c}</li>`).join('')
        : '<li class="none">No active triggers</li>';
    }

    // soil
    $('soilVal').textContent = fmt(d.soil, 0);
    const sf = $('soilFill');
    sf.style.width = clamp(d.soil, 0, 100) + '%';
    sf.style.background = d.soil >= TH.soilWarn ? 'var(--warn)' : d.soil >= TH.soilWatch ? 'var(--watch)' : '#1b8bd0';
    $('soilState').textContent = d.soil >= TH.soilWarn ? 'Saturated' : d.soil >= TH.soilWatch ? 'Very wet' : d.soil >= 35 ? 'Moist' : 'Dry';

    // tilt
    $('tiltVal').textContent = fmt(d.tilt, 1);
    $('tiltX').textContent = fmt(d.tiltx, 1);
    $('tiltY').textContent = fmt(d.tilty, 1);
    $('tiltState').textContent = d.tilt >= TH.tiltDanger ? 'Severe' : d.tilt >= TH.tiltWarn ? 'Significant' : d.tilt >= TH.tiltWatch ? 'Slight' : 'Stable';
    const dom = Math.abs(d.tiltx) >= Math.abs(d.tilty) ? d.tiltx : d.tilty;
    $('stakeG').style.transform = `rotate(${clamp(dom, -35, 35)}deg)`;

    // crack
    const cb = $('crackBox');
    cb.className = 'crack ' + (d.crack ? 'open' : '');
    $('crackVal').textContent = d.crack ? 'CRACK DETECTED' : 'Pin in place';
    $('crackSub').textContent = d.crack ? 'Pin pulled out, circuit shorted' : 'No ground opening detected';

    // battery
    $('battVal').textContent = fmt(d.batt, 0);
    const bf = $('battFill');
    bf.style.width = clamp(d.batt, 0, 100) + '%';
    bf.style.background = d.batt <= 10 ? 'var(--danger)' : d.batt <= TH.battLow ? 'var(--warn)' : 'var(--ok)';
    $('battV').textContent = fmt(d.batt_v, 2);
    $('rssi').textContent = d.rssi === undefined ? '--' : d.rssi;
  }

  /* ---------- chart (no external library) ---------- */
  function drawChart() {
    const cv = $('chart');
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const padL = 30, padR = 30, padT = 8, padB = 18;
    const pw = w - padL - padR, ph = h - padT - padB;

    g.font = '11px system-ui,sans-serif';
    g.strokeStyle = '#e1ece8'; g.fillStyle = '#5d7770'; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + ph * i / 4;
      g.beginPath(); g.moveTo(padL, y); g.lineTo(w - padR, y); g.stroke();
      g.textAlign = 'right'; g.fillText(String(100 - i * 25), padL - 5, y + 4);
      g.textAlign = 'left'; g.fillText((30 - i * 7.5).toString(), w - padR + 5, y + 4);
    }
    if (history.length < 2) {
      g.textAlign = 'center'; g.fillText('Collecting data…', w / 2, h / 2);
      return;
    }
    const t0 = history[0].t, t1 = history[history.length - 1].t, span = Math.max(1, t1 - t0);
    const X = (t) => padL + pw * (t - t0) / span;
    const line = (key, max, color) => {
      g.beginPath(); g.strokeStyle = color; g.lineWidth = 2.2; g.lineJoin = 'round';
      history.forEach((p, i) => {
        const y = padT + ph * (1 - clamp(p[key] / max, 0, 1));
        i ? g.lineTo(X(p.t), y) : g.moveTo(X(p.t), y);
      });
      g.stroke();
    };
    line('soil', 100, '#1b8bd0');
    line('tilt', 30, '#e0701a');
    g.fillStyle = '#5d7770'; g.textAlign = 'left';
    g.fillText(timeStr(t0).slice(3), padL, h - 3);
    g.textAlign = 'right'; g.fillText(timeStr(t1).slice(3), w - padR, h - 3);
  }

  /* ---------- event log ---------- */
  function addLog(text, sev) {
    logItems.unshift({ t: Date.now(), text, sev });
    logItems = logItems.slice(0, 40);
    store.set('ss.log', logItems);
    renderLog();
  }
  function renderLog() {
    const ul = $('logList');
    if (!logItems.length) { ul.innerHTML = '<li class="empty">No events yet.</li>'; return; }
    ul.innerHTML = logItems.map((e) =>
      `<li><time>${timeStr(e.t)}</time><span class="dot" style="background:${SEV[clamp(e.sev, 0, 3)].color}"></span><span>${e.text}</span></li>`
    ).join('');
  }

  /* ---------- alerts: notification, vibration, sound ---------- */
  let audioCtx = null;
  function beep(sev) {
    if (!cfg.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const n = sev >= 3 ? 3 : sev >= 2 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const o = audioCtx.createOscillator(), gn = audioCtx.createGain();
        o.type = 'square'; o.frequency.value = sev >= 3 ? 1000 : 760;
        gn.gain.value = 0.06;
        o.connect(gn); gn.connect(audioCtx.destination);
        const st = audioCtx.currentTime + i * 0.28;
        o.start(st); o.stop(st + 0.18);
      }
    } catch (e) { /* audio blocked */ }
  }

  async function notify(sev, body) {
    if (navigator.vibrate) navigator.vibrate(sev >= 3 ? [400, 150, 400, 150, 400] : [250, 120, 250]);
    beep(sev);
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const title = `Slope Sentinel · ${SEV[sev].name}`;
    const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png', tag: 'slope-alert',
      renotify: true, requireInteraction: sev >= 3, vibrate: [300, 100, 300] };
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) return reg.showNotification(title, opts);
      new Notification(title, opts);
    } catch (e) { /* ignore */ }
  }

  function onSeverity(newSev, d) {
    if (newSev === state.sev) return;
    const prev = state.sev;
    state.sev = newSev;
    if (prev === -1) { addLog(`Monitoring started: ${SEV[newSev].name}`, newSev); return; }
    const reasons = [];
    if (d.trig & 1) reasons.push(`soil ${fmt(d.soil, 0)} %`);
    if (d.trig & 2) reasons.push(`tilt ${fmt(d.tilt, 1)}°`);
    if (d.trig & 4) reasons.push('crack pin pulled');
    const why = reasons.length ? ' (' + reasons.join(', ') + ')' : '';
    addLog(`Level ${prev < 0 ? '-' : prev} → ${newSev}: ${SEV[newSev].name}${why}`, newSev);
    if (newSev > prev && newSev >= 1) notify(newSev, `${SEV[newSev].msg}${why}`);
  }

  /* ---------- incoming data ---------- */
  function ingest(d) {
    state.data = d;
    state.lastRx = Date.now();
    history.push({ t: state.lastRx, soil: d.soil, tilt: d.tilt });
    if (history.length > MAX_POINTS) history.shift();
    onSeverity(clamp(d.sev | 0, 0, 3), d);
    render();
    drawChart();
  }

  /* ---------- MQTT ---------- */
  function topic(s) { return `${cfg.base}/${s}`; }

  function connectMqtt() {
    if (state.mqtt) { try { state.mqtt.end(true); } catch (e) { /* ignore */ } state.mqtt = null; }
    if (cfg.demo || typeof mqtt === 'undefined') { render(); return; }
    const c = mqtt.connect(cfg.broker, {
      clientId: 'ss-web-' + Math.random().toString(16).slice(2, 10),
      reconnectPeriod: 3000, connectTimeout: 8000, clean: true
    });
    state.mqtt = c;
    c.on('connect', () => {
      c.subscribe([topic('data'), topic('status'), topic('event')], { qos: 0 });
      render();
    });
    c.on('close', render);
    c.on('error', render);
    c.on('message', (t, buf) => {
      const txt = buf.toString();
      if (t === topic('data')) {
        try { ingest(JSON.parse(txt)); } catch (e) { /* malformed */ }
      } else if (t === topic('status')) {
        if (txt === 'offline') addLog('Stake went offline', 1);
        render();
      } else if (t === topic('event')) {
        addLog(txt.replace(/</g, '&lt;'), state.sev < 0 ? 0 : state.sev);
      }
    });
  }

  function sendCmd(cmd, label) {
    const msg = $('cmdMsg');
    if (cfg.demo) { demoCmd(cmd); msg.textContent = `Demo: "${label}" executed.`; return; }
    if (state.mqtt && state.mqtt.connected) {
      state.mqtt.publish(topic('cmd'), cmd, { qos: 0 });
      msg.textContent = `Sent: ${label}`;
    } else msg.textContent = 'Not connected to the cloud. Command not sent.';
    if (navigator.vibrate) navigator.vibrate(30);
  }

  /* ---------- demo simulator ---------- */
  const demo = { scn: 'normal', soil: 38, tilt: 0.3, tx: 0.2, ty: -0.1, crack: 0, batt: 87, timer: null, muted: false };
  function demoStep() {
    const tgt = { normal: [38, 0.3], rain: [92, 0.9], tilt: [45, 14], crack: [88, 8] }[demo.scn];
    demo.soil += (tgt[0] - demo.soil) * 0.12 + (Math.random() - 0.5) * 0.8;
    demo.tilt += (tgt[1] - demo.tilt) * 0.12 + (Math.random() - 0.5) * 0.08;
    demo.tilt = Math.max(0, demo.tilt);
    demo.tx = demo.tilt * 0.8 * (demo.scn === 'tilt' || demo.scn === 'crack' ? 1 : (Math.random() > .5 ? 1 : -1));
    demo.ty = Math.sqrt(Math.max(0, demo.tilt * demo.tilt - demo.tx * demo.tx)) * 0.6;
    demo.batt = Math.max(5, demo.batt - 0.004);
    const d = {
      soil: +demo.soil.toFixed(1), tilt: +demo.tilt.toFixed(2), tiltx: +demo.tx.toFixed(2), tilty: +demo.ty.toFixed(2),
      crack: demo.crack, batt: +demo.batt.toFixed(0), batt_v: +(3.3 + demo.batt * 0.009).toFixed(2), rssi: -58 + Math.round(Math.random() * 4)
    };
    const r = computeSeverity(d);
    d.sev = r.sev; d.trig = r.trig;
    ingest(d);
  }
  function demoCmd(cmd) {
    if (cmd === 'reset') { demo.crack = 0; demo.scn = 'normal'; }
    if (cmd === 'zero') { demo.tilt = 0.1; if (demo.scn === 'tilt') demo.scn = 'normal'; }
    if (cmd === 'test') notify(3, 'Alarm test');
    if (cmd === 'mute') demo.muted = true;
  }
  function startDemo() {
    stopDemo();
    state.sev = -1; history.length = 0;
    demo.scn = 'normal'; demo.crack = 0; demo.soil = 38; demo.tilt = 0.3; demo.batt = 87;
    demoStep();
    demo.timer = setInterval(demoStep, 1500);
  }
  function stopDemo() { if (demo.timer) { clearInterval(demo.timer); demo.timer = null; } }

  /* ---------- UI wiring ---------- */
  function applyMode() {
    $('demoBanner').hidden = !cfg.demo;
    $('demoCard').hidden = !cfg.demo;
    $('setDemo').checked = cfg.demo;
    if (cfg.demo) { if (state.mqtt) { try { state.mqtt.end(true); } catch (e) { /* ignore */ } state.mqtt = null; } startDemo(); }
    else { stopDemo(); state.data = null; state.sev = -1; history.length = 0; connectMqtt(); render(); drawChart(); }
  }

  function updateNotifUI() {
    const el = $('notifState'), btn = $('btnNotif');
    if (!('Notification' in window)) { el.textContent = 'Not supported on this browser'; btn.disabled = true; return; }
    const p = Notification.permission;
    el.textContent = p === 'granted' ? 'On' : p === 'denied' ? 'Blocked in browser settings' : 'Off';
    btn.textContent = p === 'granted' ? 'Send test' : 'Enable';
    btn.disabled = p === 'denied';
  }

  function init() {
    // tabs
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + t.dataset.page));
      window.scrollTo({ top: 0 });
      if (t.dataset.page === 'monitor') drawChart();
    }));

    // controls
    $('btnMute').onclick = () => sendCmd('mute', 'Mute buzzer');
    $('btnReset').onclick = () => sendCmd('reset', 'Reset alarm');
    $('btnZero').onclick = () => sendCmd('zero', 'Re-zero tilt');
    $('btnTest').onclick = () => sendCmd('test', 'Test alarm');
    $('btnClearLog').onclick = () => { logItems = []; store.set('ss.log', logItems); renderLog(); };
    document.querySelectorAll('[data-scn]').forEach((b) => b.addEventListener('click', () => {
      demo.scn = b.dataset.scn;
      if (demo.scn === 'crack') demo.crack = 1;
      if (demo.scn === 'normal') demo.crack = 0;
    }));

    // settings
    $('setBroker').value = cfg.broker;
    $('setTopic').value = cfg.base;
    $('setSound').checked = !!cfg.sound;
    $('btnSave').onclick = () => {
      const b = $('setBroker').value.trim(), t = $('setTopic').value.trim().replace(/\/+$/, '');
      if (!/^wss?:\/\//i.test(b)) { $('setMsg').textContent = 'Broker must start with wss:// or ws://'; return; }
      if (!t || /[#+]/.test(t)) { $('setMsg').textContent = 'Topic base is empty or contains # or +.'; return; }
      cfg.broker = b; cfg.base = t; store.set('ss.cfg', cfg);
      $('setMsg').textContent = 'Saved. Reconnecting…';
      state.data = null; state.sev = -1; history.length = 0;
      if (!cfg.demo) connectMqtt();
      render(); drawChart();
    };
    $('btnDefaults').onclick = () => {
      cfg.broker = DEFAULTS.broker; cfg.base = DEFAULTS.base; store.set('ss.cfg', cfg);
      $('setBroker').value = cfg.broker; $('setTopic').value = cfg.base;
      $('setMsg').textContent = 'Defaults restored.';
      if (!cfg.demo) connectMqtt();
    };
    $('setSound').onchange = (e) => { cfg.sound = e.target.checked; store.set('ss.cfg', cfg); if (cfg.sound) beep(1); };
    $('setDemo').onchange = (e) => { cfg.demo = e.target.checked; store.set('ss.cfg', cfg); applyMode(); };
    $('btnNotif').onclick = async () => {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') { notify(2, 'This is a test notification.'); return; }
      try { await Notification.requestPermission(); } catch (e) { /* ignore */ }
      updateNotifUI();
    };

    updateNotifUI();
    renderLog();
    window.addEventListener('resize', drawChart);
    setInterval(render, 3000); // refresh stale state

    applyMode();
    drawChart();

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => { /* optional */ });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
