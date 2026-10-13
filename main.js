Read 

Copy this entire script into Tampermonkey’s **Create a new script** page, then save it with **⌘S**.

```javascript
// ==UserScript==
// @name         GeoFS Walkabout
// @namespace    local.geofs.walkabout
// @version      1.0.0
// @description  Leave the aircraft and walk around GeoFS with a locally visible, customizable avatar.
// @match        https://*.geo-fs.com/*
// @match        https://geo-fs.com/*
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const STORAGE_KEY = "geofs-walkabout-settings-v1";
  const EARTH_RADIUS_METERS = 6371008.8;
  const RUN_SPEED = 7.2;
  const WALK_KEYS = new Set([
    "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown",
    "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "KeyE", "Escape",
  ]);
  const defaults = {
    name: "Pilot",
    skin: "#f1c27d",
    shirt: "#2563eb",
    pants: "#1f2937",
  };

  let settings = loadSettings();
  let viewer;
  let panel;
  let statusText;
  let toggleButton;
  let speedInput;
  let avatar;
  let walking = false;
  let previousTrackedEntity;
  let previousFrameTime = 0;
  const pressedKeys = new Set();

  function loadSettings() {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    } catch {
      return { ...defaults };
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function waitForGeoFS() {
    const timer = window.setInterval(() => {
      const geoViewer = window.geofs?.api?.viewer;
      if (geoViewer?.entities && window.Cesium) {
        window.clearInterval(timer);
        viewer = geoViewer;
        buildPanel();
        requestAnimationFrame(updateWalk);
      }
    }, 500);
  }

  function buildPanel() {
    const style = document.createElement("style");
    style.textContent = `
      #geofs-walkabout-panel{position:fixed;z-index:100000;top:14px;right:14px;width:282px;
        padding:15px;color:#eef3ff;background:rgba(13,20,36,.94);border:1px solid #3b4b69;
        border-radius:14px;box-shadow:0 12px 36px #0008;font:13px/1.4 system-ui,-apple-system,sans-serif}
      #geofs-walkabout-panel *{box-sizing:border-box}
      #geofs-walkabout-panel h2{font-size:16px;margin:0 0 5px}
      #geofs-walkabout-panel p{margin:5px 0 12px;color:#b9c6dc}
      #geofs-walkabout-panel .wa-row{display:flex;gap:8px;margin-top:9px;align-items:center}
      #geofs-walkabout-panel label{display:block;flex:1;color:#ccd6e7}
      #geofs-walkabout-panel input[type=text]{width:100%;margin-top:4px;padding:8px;color:white;
        background:#18243a;border:1px solid #41516e;border-radius:7px}
      #geofs-walkabout-panel input[type=color]{display:block;width:100%;height:30px;margin-top:4px;
        padding:2px;background:#18243a;border:1px solid #41516e;border-radius:7px}
      #geofs-walkabout-panel input[type=range]{width:100%;accent-color:#62a5ff}
      #geofs-walkabout-panel button{width:100%;padding:9px;color:white;background:#2868d7;
        border:0;border-radius:8px;font-weight:700;cursor:pointer}
      #geofs-walkabout-panel button:hover{background:#3779eb}
      #geofs-walkabout-panel .wa-secondary{background:#34435c}
      #geofs-walkabout-panel .wa-secondary:hover{background:#445675}
      #geofs-walkabout-panel .wa-status{min-height:18px;color:#9ec5ff}
      #geofs-walkabout-panel .wa-help{font-size:11px;color:#a9b7ce;margin:10px 0 0}
      #geofs-walkabout-panel[hidden]{display:none}
    `;
    document.head.appendChild(style);

    panel = document.createElement("section");
    panel.id = "geofs-walkabout-panel";
    panel.innerHTML = `
      <h2>Walkabout</h2>
      <p>Your character is visible only on your screen.</p>
      <button id="wa-toggle">Exit aircraft</button>
      <div class="wa-row"><label>Character name
        <input id="wa-name" type="text" maxlength="20"></label></div>
      <div class="wa-row">
        <label>Skin<input id="wa-skin" type="color"></label>
        <label>Shirt<input id="wa-shirt" type="color"></label>
        <label>Pants<input id="wa-pants" type="color"></label>
      </div>
      <div class="wa-row"><label>Walk speed <span id="wa-speed-value"></span>
        <input id="wa-speed" type="range" min="1" max="10" step="0.5" value="3.2"></label></div>
      <div class="wa-status" id="wa-status" aria-live="polite">Ready</div>
      <p class="wa-help">W/S walk · A/D sidestep · ←/→ turn · Shift run · E or Esc return</p>
      <button class="wa-secondary" id="wa-hide">Hide panel</button>
    `;
    document.body.appendChild(panel);

    statusText = panel.querySelector("#wa-status");
    toggleButton = panel.querySelector("#wa-toggle");
    speedInput = panel.querySelector("#wa-speed");
    const speedValue = panel.querySelector("#wa-speed-value");
    speedValue.textContent = `${Number(speedInput.value).toFixed(1)} m/s`;

    panel.querySelector("#wa-name").value = settings.name;
    panel.querySelector("#wa-skin").value = settings.skin;
    panel.querySelector("#wa-shirt").value = settings.shirt;
    panel.querySelector("#wa-pants").value = settings.pants;

    panel.querySelector("#wa-name").addEventListener("input", (event) => {
      settings.name = event.target.value.trim().slice(0, 20) || "Pilot";
      saveSettings();
      refreshAvatar();
    });
    for (const part of ["skin", "shirt", "pants"]) {
      panel.querySelector(`#wa-${part}`).addEventListener("input", (event) => {
        settings[part] = event.target.value;
        saveSettings();
        refreshAvatar();
      });
    }
    speedInput.addEventListener("input", () => {
      speedValue.textContent = `${Number(speedInput.value).toFixed(1)} m/s`;
    });
    toggleButton.addEventListener("click", toggleWalking);
    panel.querySelector("#wa-hide").addEventListener("click", () => {
      panel.hidden = true;
      addReopenButton();
    });

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", clearPressedKeys);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) clearPressedKeys();
    });
  }

  function addReopenButton() {
    if (document.getElementById("geofs-walkabout-reopen")) return;
    const button = document.createElement("button");
    button.id = "geofs-walkabout-reopen";
    button.textContent = "Walkabout";
    button.style.cssText = "position:fixed;z-index:100000;top:14px;right:14px;padding:9px 13px;"
      + "color:white;background:#2868d7;border:0;border-radius:8px;font:700 13px system-ui;cursor:pointer";
    button.addEventListener("click", () => {
      panel.hidden = false;
      button.remove();
    });
    document.body.appendChild(button);
  }

  function isTextField(target) {
    return target instanceof HTMLElement && (
      target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
    );
  }

  function onKeyDown(event) {
    if (!walking || isTextField(event.target) || !WALK_KEYS.has(event.code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pressedKeys.add(event.code);
    if (event.code === "KeyE" && !event.repeat) stopWalking();
    if (event.code === "Escape" && !event.repeat) stopWalking();
  }

  function onKeyUp(event) {
    if (!walking || !WALK_KEYS.has(event.code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pressedKeys.delete(event.code);
  }

  function clearPressedKeys() {
    pressedKeys.clear();
  }

  function readPosition(value) {
    if (!value) return null;
    const Cesium = window.Cesium;

    if (Array.isArray(value) && value.length >= 2) {
      const latitude = Number(value[0]);
      const longitude = Number(value[1]);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)
        && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 360) {
        return { latitude, longitude };
      }
    }

    if (typeof value === "object") {
      const latitude = Number(value.latitude ?? value.lat);
      const longitude = Number(value.longitude ?? value.lon ?? value.lng);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)
        && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 360) {
        return { latitude, longitude };
      }
      if (Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
        try {
          const cartographic = Cesium.Cartographic.fromCartesian(value);
          return {
            latitude: Cesium.Math.toDegrees(cartographic.latitude),
            longitude: Cesium.Math.toDegrees(cartographic.longitude),
          };
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  function getAircraftPosition() {
    const aircraft = window.geofs?.aircraft;
    const instance = aircraft?.instance;
    if (!instance) return null;

    const candidates = [
      instance.llaLocation,
      instance.lla,
      instance.coordinates,
      instance.location,
      instance.position,
      aircraft.llaLocation,
      aircraft.lla,
    ];
    for (const candidate of candidates) {
      const position = readPosition(candidate);
      if (position) return position;
    }
    return null;
  }

  function toggleWalking() {
    if (walking) stopWalking();
    else startWalking();
  }

  function startWalking() {
    const position = getAircraftPosition();
    if (!position) {
      statusText.textContent = "Could not read aircraft position. Wait for the aircraft to load.";
      return;
    }

    const latitudeRadians = position.latitude * Math.PI / 180;
    avatar = {
      latitude: position.latitude + (6 / EARTH_RADIUS_METERS) * 180 / Math.PI,
      longitude: position.longitude + (6 / (EARTH_RADIUS_METERS
        * Math.max(0.01, Math.abs(Math.cos(latitudeRadians))))) * 180 / Math.PI,
      heading: 0,
      entity: null,
    };

    const Cesium = window.Cesium;
    avatar.entity = viewer.entities.add({
      name: "Your local Walkabout character",
      position: Cesium.Cartesian3.fromDegrees(avatar.longitude, avatar.latitude, 0),
      billboard: {
        image: makeAvatarImage(),
        width: 62,
        height: 94,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: settings.name,
        font: "bold 13px system-ui",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -96),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });

    previousTrackedEntity = viewer.trackedEntity;
    walking = true;
    clearPressedKeys();
    try {
      viewer.trackedEntity = avatar.entity;
    } catch (error) {
      console.warn("[GeoFS Walkabout] Could not attach the camera to the avatar.", error);
    }
    updatePanelState();
    statusText.textContent = "You're out. Explore with the walking keys.";
  }

  function stopWalking() {
    if (!walking) return;
    walking = false;
    clearPressedKeys();
    if (avatar?.entity) viewer.entities.remove(avatar.entity);
    avatar = null;
    try {
      viewer.trackedEntity = previousTrackedEntity || undefined;
    } catch (error) {
      console.warn("[GeoFS Walkabout] Could not restore the previous camera target.", error);
    }
    previousTrackedEntity = undefined;
    updatePanelState();
    statusText.textContent = "Back in the aircraft.";
  }

  function makeAvatarImage() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150" viewBox="0 0 100 150">
      <ellipse cx="50" cy="144" rx="24" ry="5" fill="#000" opacity=".25"/>
      <path d="M37 91h26l7 42H54l-4-27-4 27H30z" fill="${settings.pants}" stroke="#172033" stroke-width="3" stroke-linejoin="round"/>
      <path d="M29 52q21-15 42 0l8 42q-29 13-58 0z" fill="${settings.shirt}" stroke="#172033" stroke-width="3" stroke-linejoin="round"/>
      <path d="M30 58 18 87m52-29 12 29" fill="none" stroke="${settings.skin}" stroke-width="10" stroke-linecap="round"/>
      <circle cx="50" cy="31" r="20" fill="${settings.skin}" stroke="#172033" stroke-width="3"/>
      <path d="M31 28q2-22 20-20 17 1 19 20-17-8-39 0" fill="#342719"/>
      <path d="M36 141h16m2 0h17" stroke="#111827" stroke-width="8" stroke-linecap="round"/>
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function refreshAvatar() {
    if (!avatar?.entity) return;
    avatar.entity.billboard.image = makeAvatarImage();
    avatar.entity.label.text = settings.name;
  }

  function updatePanelState() {
    toggleButton.textContent = walking ? "Enter aircraft" : "Exit aircraft";
    toggleButton.classList.toggle("wa-secondary", walking);
  }

  function moveAvatar(distance, direction) {
    const latitudeRadians = avatar.latitude * Math.PI / 180;
    const latitudeDelta = distance * Math.cos(direction) / EARTH_RADIUS_METERS;
    const longitudeScale = EARTH_RADIUS_METERS
      * Math.max(0.01, Math.abs(Math.cos(latitudeRadians)));
    const longitudeDelta = distance * Math.sin(direction) / longitudeScale;

    avatar.latitude = Math.max(-89.9999, Math.min(89.9999,
      avatar.latitude + latitudeDelta * 180 / Math.PI));
    avatar.longitude = ((avatar.longitude + longitudeDelta * 180 / Math.PI + 540) % 360) - 180;
    avatar.entity.position = window.Cesium.Cartesian3.fromDegrees(
      avatar.longitude,
      avatar.latitude,
      0,
    );
  }

  function updateWalk(timestamp) {
    requestAnimationFrame(updateWalk);
    if (!walking || !avatar) return;

    const elapsed = previousFrameTime
      ? Math.min((timestamp - previousFrameTime) / 1000, 0.05)
      : 0;
    previousFrameTime = timestamp;

    if (pressedKeys.has("ArrowLeft")) avatar.heading -= 2.4 * elapsed;
    if (pressedKeys.has("ArrowRight")) avatar.heading += 2.4 * elapsed;

    const forward = Number(pressedKeys.has("KeyW") || pressedKeys.has("ArrowUp"))
      - Number(pressedKeys.has("KeyS") || pressedKeys.has("ArrowDown"));
    const sideways = Number(pressedKeys.has("KeyD")) - Number(pressedKeys.has("KeyA"));
    if (forward || sideways) {
      const direction = avatar.heading + Math.atan2(sideways, forward);
      const speed = pressedKeys.has("ShiftLeft") || pressedKeys.has("ShiftRight")
        ? RUN_SPEED
        : Number(speedInput.value);
      moveAvatar(speed * elapsed, direction);
    }
  }

  waitForGeoFS();
})();
```
