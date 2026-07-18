/*
 * Duux Card — a compact, animated Home Assistant Lovelace card for Duux fans.
 * Works with any integration that exposes the fan as a standard `fan.*` entity
 * (percentage speed, optional preset_modes) plus optional companion entities
 * for horizontal/vertical oscillation angle, night mode, child lock and timer.
 */

const CARD_VERSION = "1.0.0";

const DEFAULTS = {
  name: null,
  entity: null,
  horizontal_entity: null,
  vertical_entity: null,
  night_entity: null,
  lock_entity: null,
  timer_entity: null,
  horizontal_on_value: "30°",
  horizontal_off_value: "Off",
  vertical_on_value: "45°",
  vertical_off_value: "Off",
};

/* role -> candidate suffixes (tried against several domains, in priority order) */
const AUX_ROLES = {
  horizontal_entity: {
    domains: ["select", "number", "switch"],
    suffixes: ["horizontal_angle", "oscillation_horizontal", "horizontal_oscillation", "horizontal", "swing_horizontal"],
  },
  vertical_entity: {
    domains: ["select", "number", "switch"],
    suffixes: ["vertical_angle", "oscillation_vertical", "vertical_oscillation", "vertical", "tilt_angle", "tilt"],
  },
  night_entity: {
    domains: ["switch"],
    suffixes: ["night_mode", "night"],
  },
  lock_entity: {
    domains: ["switch", "lock"],
    suffixes: ["lock", "child_lock"],
  },
  timer_entity: {
    domains: ["number", "select"],
    suffixes: ["timer"],
  },
};

const TIMER_HOURS = [0, 1, 2, 4, 8];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function cap(s) {
  if (!s) return s;
  const lower = String(s).toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

class DuuxCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._sig = null;
    this._entityCache = null;
    this._open = false;
    this._dragging = false;
    this._dragPct = null;
    this._onPointerUp = () => {
      if (this._dragging) {
        this._dragging = false;
        if (this._dragPct != null) this._setPercentage(this._dragPct);
        this._dragPct = null;
        if (this._hass) this._update();
      }
    };
    this._onPointerMove = (e) => {
      if (this._dragging) this._paintPctFromEvent(e);
    };
  }

  connectedCallback() {
    window.addEventListener("pointerup", this._onPointerUp);
    window.addEventListener("pointermove", this._onPointerMove);
    this._sig = null;
    if (this._hass && this._config) this._update();
  }

  disconnectedCallback() {
    window.removeEventListener("pointerup", this._onPointerUp);
    window.removeEventListener("pointermove", this._onPointerMove);
  }

  static getConfigElement() {
    return document.createElement("duux-card-editor");
  }

  static getStubConfig(hass) {
    let entity = "";
    if (hass && hass.states) {
      entity = Object.keys(hass.states).find((e) => e.startsWith("fan.") && e.toLowerCase().includes("duux"))
        || Object.keys(hass.states).find((e) => e.startsWith("fan."))
        || "";
    }
    return { entity };
  }

  getCardSize() {
    return 2;
  }

  setConfig(config) {
    if (!config || !config.entity) throw new Error("duux-card: 'entity' is required");
    this._config = { ...DEFAULTS, ...config };
    this._entityCache = null;
    this._sig = null;
    if (this._hass) this._update();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    this._update();
  }

  /* ---------- entity resolution ---------- */

  _prefix() {
    const src = this._config.entity;
    if (!src || !src.includes(".")) return null;
    return src.split(".")[1];
  }

  _findAux(role) {
    const def = AUX_ROLES[role];
    const hass = this._hass;
    const prefix = this._prefix();
    if (!prefix || !hass) return null;
    for (const domain of def.domains) {
      for (const suf of def.suffixes) {
        const id = `${domain}.${prefix}_${suf}`;
        if (hass.states[id]) return id;
      }
    }
    for (const domain of def.domains) {
      const hit = Object.keys(hass.states).find(
        (e) => e.startsWith(`${domain}.${prefix}`) && def.suffixes.some((s) => e.endsWith(s))
      );
      if (hit) return hit;
    }
    return null;
  }

  _resolveEntities() {
    if (this._entityCache) return this._entityCache;
    const map = { entity: this._config.entity };
    for (const role of Object.keys(AUX_ROLES)) {
      map[role] = this._config[role] || this._findAux(role);
    }
    this._entityCache = map;
    return map;
  }

  _st(entityId) {
    if (!entityId || !this._hass) return null;
    return this._hass.states[entityId] || null;
  }

  /* ---------- service calls ---------- */

  _call(domain, service, entityId, data) {
    if (!entityId) return;
    this._hass.callService(domain, service, { entity_id: entityId, ...data });
  }

  _domain(entityId) {
    return entityId ? entityId.split(".")[0] : null;
  }

  _setAxis(entityId, onValue, offValue, turnOn) {
    const domain = this._domain(entityId);
    if (domain === "switch") {
      this._call("switch", turnOn ? "turn_on" : "turn_off", entityId);
    } else if (domain === "select") {
      this._call("select", "select_option", entityId, { option: turnOn ? onValue : offValue });
    } else if (domain === "number") {
      this._call("number", "set_value", entityId, { value: Number(turnOn ? onValue : offValue) });
    }
  }

  _axisIsOn(entityId, onValue) {
    const st = this._st(entityId);
    if (!st) return false;
    if (this._domain(entityId) === "switch") return st.state === "on";
    return String(st.state) === String(onValue);
  }

  _togglePower() {
    const st = this._st(this._config.entity);
    const on = st && st.state === "on";
    this._call("fan", on ? "turn_off" : "turn_on", this._config.entity);
  }

  _setPercentage(pct) {
    this._call("fan", "set_percentage", this._config.entity, { percentage: clamp(Math.round(pct), 0, 100) });
  }

  _setPreset(mode) {
    this._call("fan", "set_preset_mode", this._config.entity, { preset_mode: String(mode).toLowerCase() });
  }

  _cycleTimer(ent) {
    const id = ent.timer_entity;
    if (!id) return;
    const domain = this._domain(id);
    const st = this._st(id);
    if (domain === "select" && st && Array.isArray(st.attributes.options)) {
      const opts = st.attributes.options;
      const next = opts[(opts.indexOf(st.state) + 1) % opts.length];
      this._call("select", "select_option", id, { option: next });
    } else if (domain === "number") {
      const cur = Number(st ? st.state : 0) || 0;
      const idx = TIMER_HOURS.findIndex((h) => h === cur);
      const next = TIMER_HOURS[(idx + 1 + TIMER_HOURS.length) % TIMER_HOURS.length];
      this._call("number", "set_value", id, { value: next });
    }
  }

  _timerLabel(ent) {
    const id = ent.timer_entity;
    if (!id) return null;
    const st = this._st(id);
    if (!st) return null;
    const domain = this._domain(id);
    if (domain === "select") return st.state;
    const n = Number(st.state) || 0;
    return n <= 0 ? "Off" : `${n}h`;
  }

  /* ---------- render ---------- */

  _paintPctFromEvent(e) {
    const track = this.shadowRoot.querySelector(".track");
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const pct = clamp(Math.round((x / rect.width) * 100), 0, 100);
    this._dragPct = pct;
    this._paintSpeed(pct);
  }

  _paintSpeed(pct) {
    const root = this.shadowRoot;
    const fill = root.querySelector(".fill");
    const thumb = root.querySelector(".thumb");
    const label = root.querySelector(".pctlabel span");
    if (fill) fill.style.width = pct + "%";
    if (thumb) thumb.style.left = pct + "%";
    if (label) label.textContent = pct;
  }

  _update() {
    const ent = this._resolveEntities();
    const tracked = [ent.entity, ent.horizontal_entity, ent.vertical_entity, ent.night_entity, ent.lock_entity, ent.timer_entity].filter(Boolean);
    const sig = JSON.stringify(this._config) + "|" + tracked.map((e) => {
      const st = this._st(e);
      if (!st) return "?";
      return [st.state, st.attributes.percentage, st.attributes.preset_mode, JSON.stringify(st.attributes.preset_modes || st.attributes.options || "")].join("|");
    }).join(",");
    if (sig === this._sig || this._dragging) return;
    this._sig = sig;
    this._render(ent);
  }

  _render(ent) {
    const hass = this._hass;
    const st = this._st(ent.entity);
    if (!st) {
      this.shadowRoot.innerHTML = `<ha-card><div style="padding:16px;color:var(--secondary-text-color)">Entity not found: ${esc(ent.entity)}</div></ha-card>`;
      return;
    }

    const power = st.state === "on";
    const pct = this._dragging && this._dragPct != null ? this._dragPct : Math.round(st.attributes.percentage || 0);
    const presetModes = Array.isArray(st.attributes.preset_modes) ? st.attributes.preset_modes : [];
    const activePreset = st.attributes.preset_mode || null;
    const name = this._config.name || st.attributes.friendly_name || ent.entity;

    const hOn = ent.horizontal_entity ? this._axisIsOn(ent.horizontal_entity, this._config.horizontal_on_value) : false;
    const vOn = ent.vertical_entity ? this._axisIsOn(ent.vertical_entity, this._config.vertical_on_value) : false;
    const night = ent.night_entity ? this._st(ent.night_entity)?.state === "on" : false;
    const lockDomain = this._domain(ent.lock_entity);
    const lockSt = this._st(ent.lock_entity);
    const locked = lockSt ? (lockDomain === "lock" ? lockSt.state === "locked" : lockSt.state === "on") : false;
    const timerLabel = this._timerLabel(ent);

    const frac = Math.max(pct / 100, 0.08);
    const spinDur = power ? (1.2 / frac).toFixed(2) + "s" : "0s";
    const blur = power ? (frac * 1.1).toFixed(2) + "px" : "0px";
    const pulseDur = power ? (2.4 / frac).toFixed(2) + "s" : "3s";

    let axisSuffix = "";
    if (power && (hOn || vOn)) axisSuffix = ` · ${hOn ? "H" : ""}${vOn ? "V" : ""}`;
    const subline = power ? `${activePreset ? cap(activePreset) + " · " : ""}${pct}%${axisSuffix}` : "Off";

    this.shadowRoot.innerHTML = `
      <style>${this._css()}</style>
      <ha-card>
        <div class="row-main">
          <div class="glyph ${power ? "on" : ""}" style="--spin-dur:${spinDur};--blade-blur:${blur};--pulse-dur:${pulseDur}">
            <div class="tilt-h ${power && hOn ? "active" : ""}">
              <div class="tilt-v ${power && vOn ? "active" : ""}">
                <svg class="glyph-svg" viewBox="0 0 40 40">
                  <defs>
                    <radialGradient id="bladeGrad" cx="30%" cy="30%" r="80%">
                      <stop offset="0%" stop-color="currentColor" stop-opacity=".95"/>
                      <stop offset="100%" stop-color="currentColor" stop-opacity=".2"/>
                    </radialGradient>
                  </defs>
                  <g>
                    <circle class="ring r1" cx="20" cy="20"/>
                    <circle class="ring r2" cx="20" cy="20"/>
                    <circle class="ring r3" cx="20" cy="20"/>
                  </g>
                  <g class="blade-set" fill="url(#bladeGrad)">
                    <path d="M20 20C20 20 20.6 9.4 25.6 6.4C28.7 4.6 32 7 30.8 10.6C29.5 14.6 20 20 20 20Z"/>
                    <path d="M20 20C20 20 20.6 9.4 25.6 6.4C28.7 4.6 32 7 30.8 10.6C29.5 14.6 20 20 20 20Z" transform="rotate(120 20 20)"/>
                    <path d="M20 20C20 20 20.6 9.4 25.6 6.4C28.7 4.6 32 7 30.8 10.6C29.5 14.6 20 20 20 20Z" transform="rotate(240 20 20)"/>
                  </g>
                  <circle class="hub" cx="20" cy="20" r="3.4"/>
                </svg>
              </div>
            </div>
          </div>
          <div class="info">
            <div class="t1">${esc(name)}</div>
            <div class="t2">${esc(subline)}</div>
          </div>
          <svg class="chev ${this._open ? "open" : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
          <button class="pwr" aria-pressed="${power}" aria-label="Power"></button>
        </div>

        <div class="drawer ${this._open ? "open" : ""}">
          <div class="drawer-inner"><div class="drawer-pad">
            <div class="speedbar">
              <div class="track"><div class="fill" style="width:${pct}%"></div><div class="thumb" style="left:${pct}%"></div></div>
              <div class="pctlabel"><span>${pct}</span>%</div>
            </div>

            ${presetModes.length ? `
            <div class="presets">
              ${presetModes.map((m) => `<button class="preset-btn ${String(m).toLowerCase() === String(activePreset || "").toLowerCase() ? "active" : ""}" data-preset="${esc(m)}">${esc(cap(m))}</button>`).join("")}
            </div>` : ""}

            <div class="quickrow">
              ${ent.horizontal_entity ? `
              <button class="qbtn ${hOn ? "active" : ""}" data-action="horizontal" title="Horizontal oscillation">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12h20M6 8l-4 4 4 4M18 8l4 4-4 4"/></svg>
              </button>` : ""}
              ${ent.vertical_entity ? `
              <button class="qbtn ${vOn ? "active" : ""}" data-action="vertical" title="Vertical oscillation">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v20M8 6l4-4 4 4M8 18l4 4 4-4"/></svg>
              </button>` : ""}
              ${ent.night_entity ? `
              <button class="qbtn ${night ? "active" : ""}" data-action="night" title="Night mode">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>
              </button>` : ""}
              ${ent.lock_entity ? `
              <button class="qbtn lockq ${locked ? "active" : ""}" data-action="lock" title="Child lock">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
              </button>` : ""}
              ${ent.timer_entity ? `
              <button class="qbtn ${timerLabel && timerLabel !== "Off" ? "active" : ""}" data-action="timer" title="Timer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="7"/><path d="M12 9v4l2.5 1.5M9 3h6"/></svg>
                <span class="badge">${timerLabel && timerLabel !== "Off" ? esc(timerLabel) : ""}</span>
              </button>` : ""}
            </div>
          </div></div>
        </div>
      </ha-card>
    `;

    this._bind(ent, locked);
  }

  _bind(ent, locked) {
    const root = this.shadowRoot;
    const rowMain = root.querySelector(".row-main");
    const pwrBtn = root.querySelector(".pwr");
    const track = root.querySelector(".track");
    const presetBtns = root.querySelectorAll(".preset-btn");
    const qbtns = root.querySelectorAll(".qbtn");

    rowMain.addEventListener("click", (e) => {
      if (e.target === pwrBtn) return;
      this._open = !this._open;
      this._render(ent);
    });
    pwrBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._togglePower();
    });
    track.addEventListener("pointerdown", (e) => {
      if (locked) return;
      e.stopPropagation();
      this._dragging = true;
      this._paintPctFromEvent(e);
    });
    presetBtns.forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (locked) return;
      this._setPreset(b.dataset.preset);
    }));
    qbtns.forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = b.dataset.action;
      if (locked && action !== "lock") return;
      if (action === "horizontal") {
        this._setAxis(ent.horizontal_entity, this._config.horizontal_on_value, this._config.horizontal_off_value, !this._axisIsOn(ent.horizontal_entity, this._config.horizontal_on_value));
      } else if (action === "vertical") {
        this._setAxis(ent.vertical_entity, this._config.vertical_on_value, this._config.vertical_off_value, !this._axisIsOn(ent.vertical_entity, this._config.vertical_on_value));
      } else if (action === "night") {
        const st = this._st(ent.night_entity);
        this._call("switch", st && st.state === "on" ? "turn_off" : "turn_on", ent.night_entity);
      } else if (action === "lock") {
        const dom = this._domain(ent.lock_entity);
        if (dom === "lock") this._call("lock", locked ? "unlock" : "lock", ent.lock_entity);
        else this._call("switch", locked ? "turn_off" : "turn_on", ent.lock_entity);
      } else if (action === "timer") {
        this._cycleTimer(ent);
      }
    }));
  }

  _css() {
    return `
      ha-card{ cursor:pointer; overflow:hidden; }
      .row-main{ display:flex; align-items:center; gap:12px; padding:12px 14px; }

      .glyph{ position:relative; width:42px; height:42px; flex-shrink:0; color:var(--disabled-text-color); }
      .glyph.on{ color:var(--state-icon-active-color, var(--primary-color)); }
      .tilt-h,.tilt-v{ width:100%; height:100%; }
      .tilt-h.active{ animation:tilt-h 3.2s ease-in-out infinite; }
      .tilt-v.active{ animation:tilt-v 2.7s ease-in-out infinite; }
      @keyframes tilt-h{ 0%,100%{ transform:skewX(-13deg);} 50%{ transform:skewX(13deg);} }
      @keyframes tilt-v{ 0%,100%{ transform:skewY(-7deg);} 50%{ transform:skewY(7deg);} }
      @media (prefers-reduced-motion: reduce){ .tilt-h.active,.tilt-v.active{ animation:none!important; } }

      .glyph-svg{ width:100%; height:100%; overflow:visible; }
      .ring{ fill:none; stroke:currentColor; opacity:0; }
      .glyph.on .ring{ animation:pulse-ring var(--pulse-dur,2.2s) cubic-bezier(.2,.6,.4,1) infinite; }
      .glyph.on .r2{ animation-delay:calc(var(--pulse-dur,2.2s) / 3); }
      .glyph.on .r3{ animation-delay:calc(var(--pulse-dur,2.2s) / 3 * 2); }
      @keyframes pulse-ring{ 0%{ r:4; stroke-width:2.4; opacity:.5; } 100%{ r:19; stroke-width:.3; opacity:0; } }
      @media (prefers-reduced-motion: reduce){ .glyph.on .ring{ animation:none!important; } }

      .blade-set{ transform-origin:20px 20px; transition:filter .2s ease; }
      .glyph.on .blade-set{ animation:blade-spin linear infinite; animation-duration:var(--spin-dur,2.4s); filter:blur(var(--blade-blur,0px)); }
      @keyframes blade-spin{ to{ transform:rotate(360deg); } }
      @media (prefers-reduced-motion: reduce){ .blade-set{ animation:none!important; filter:none!important; } }
      .hub{ fill:currentColor; }

      .info{ flex:1; min-width:0; }
      .t1{ font-size:14px; font-weight:600; color:var(--primary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .t2{ font-size:11.5px; color:var(--secondary-text-color); margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-variant-numeric:tabular-nums; }

      .chev{ width:16px; height:16px; color:var(--secondary-text-color); flex-shrink:0; transition:transform .3s ease; }
      .chev.open{ transform:rotate(180deg); }

      .pwr{ --w:36px; width:var(--w); height:21px; border-radius:999px; position:relative; cursor:pointer; background:var(--disabled-text-color); flex-shrink:0; transition:background .25s ease; border:none; padding:0; }
      .pwr::after{ content:""; position:absolute; top:2px; left:2px; width:17px; height:17px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.35); transition:transform .25s ease; }
      .pwr[aria-pressed="true"]{ background:var(--primary-color); }
      .pwr[aria-pressed="true"]::after{ transform:translateX(15px); }

      .drawer{ display:grid; grid-template-rows:0fr; transition:grid-template-rows .32s cubic-bezier(.4,0,.2,1); }
      .drawer.open{ grid-template-rows:1fr; }
      .drawer-inner{ overflow:hidden; }
      .drawer-pad{ padding:0 14px 16px; border-top:1px solid var(--divider-color); margin-top:2px; padding-top:14px; }

      .speedbar{ display:flex; align-items:center; gap:10px; margin-bottom:20px; }
      .track{ flex:1; height:8px; border-radius:999px; background:var(--divider-color); position:relative; cursor:pointer; touch-action:none; }
      .fill{ position:absolute; inset:0; border-radius:999px; background:var(--primary-color); }
      .thumb{ position:absolute; top:50%; width:16px; height:16px; border-radius:50%; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.3); transform:translate(-50%,-50%); }
      .pctlabel{ font:600 12px var(--paper-font-common-base_-_font-family, inherit); width:34px; text-align:right; font-variant-numeric:tabular-nums; color:var(--primary-text-color); }

      .presets{ display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap; }
      .preset-btn{ flex:1; min-width:60px; font:500 11px inherit; padding:6px 4px; border-radius:8px; border:none; background:var(--divider-color); color:var(--secondary-text-color); cursor:pointer; transition:background .2s ease,color .2s ease; }
      .preset-btn.active{ background:var(--primary-color); color:#fff; }

      .quickrow{ display:grid; grid-template-columns:repeat(auto-fit,minmax(0,1fr)); gap:6px; }
      .qbtn{ height:34px; border-radius:9px; border:none; background:var(--divider-color); color:var(--secondary-text-color); display:flex; align-items:center; justify-content:center; cursor:pointer; position:relative; transition:background .2s ease,color .2s ease; }
      .qbtn svg{ width:16px; height:16px; }
      .qbtn.active{ background:color-mix(in srgb, var(--primary-color) 18%, transparent); color:var(--primary-color); }
      .qbtn .badge{ position:absolute; bottom:2px; right:4px; font:700 8.5px inherit; }
    `;
  }
}

class DuuxCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  connectedCallback() {
    this._render();
  }

  _schema() {
    return [
      { name: "entity", selector: { entity: { domain: "fan" } } },
      { name: "name", selector: { text: {} } },
      { name: "horizontal_entity", selector: { entity: { domain: ["select", "number", "switch"] } } },
      { name: "vertical_entity", selector: { entity: { domain: ["select", "number", "switch"] } } },
      { name: "night_entity", selector: { entity: { domain: ["switch"] } } },
      { name: "lock_entity", selector: { entity: { domain: ["switch", "lock"] } } },
      { name: "timer_entity", selector: { entity: { domain: ["number", "select"] } } },
      { name: "horizontal_on_value", selector: { text: {} } },
      { name: "horizontal_off_value", selector: { text: {} } },
      { name: "vertical_on_value", selector: { text: {} } },
      { name: "vertical_off_value", selector: { text: {} } },
    ];
  }

  _labels() {
    return {
      entity: "Fan entity",
      name: "Name (optional)",
      horizontal_entity: "Horizontal oscillation entity (optional)",
      vertical_entity: "Vertical oscillation entity (optional)",
      night_entity: "Night mode entity (optional)",
      lock_entity: "Child lock entity (optional)",
      timer_entity: "Timer entity (optional)",
      horizontal_on_value: "Horizontal 'on' value",
      horizontal_off_value: "Horizontal 'off' value",
      vertical_on_value: "Vertical 'on' value",
      vertical_off_value: "Vertical 'off' value",
    };
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = "";
    if (!this._config) return;
    const form = document.createElement("ha-form");
    form.hass = this._hass;
    form.data = this._config;
    form.schema = this._schema();
    const labels = this._labels();
    form.computeLabel = (s) => labels[s.name] || s.name;
    form.addEventListener("value-changed", (e) => {
      this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: e.detail.value }, bubbles: true, composed: true }));
    });
    this.shadowRoot.appendChild(form);
    this._form = form;
  }
}

customElements.define("duux-card", DuuxCard);
customElements.define("duux-card-editor", DuuxCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "duux-card",
  name: "Duux Card",
  description: "A compact, animated card for Duux fans.",
  preview: false,
});

console.info(`%c DUUX-CARD %c v${CARD_VERSION} `, "color:#fff;background:#1f9b93;font-weight:700", "color:#1f9b93;background:transparent;font-weight:700");
