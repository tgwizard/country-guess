import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { feature } from "https://cdn.jsdelivr.net/npm/topojson-client@3/+esm";
import {
  COUNTRIES,
  DIFFICULTIES,
  countriesForDifficulty,
  flagEmoji,
  matchGuess,
  canonicalName,
  swedishName,
} from "./countries.js";

const TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const MAX_MISTAKES = 3;

const els = {
  map: document.getElementById("map"),
  loading: document.getElementById("loading"),
  stats: document.querySelector(".stats"),
  score: document.getElementById("score"),
  lives: document.getElementById("lives"),
  screenStart: document.getElementById("screen-start"),
  screenOver: document.getElementById("screen-over"),
  hud: document.getElementById("hud"),
  btnSubmit: document.getElementById("btn-submit"),
  btnSkip: document.getElementById("btn-skip"),
  guess: document.getElementById("guess"),
  guessForm: document.getElementById("guess-form"),
  flag: document.getElementById("flag"),
  feedback: document.getElementById("feedback"),
  finalScore: document.getElementById("final-score"),
  finalDiff: document.getElementById("final-diff"),
};

// By-id country lookup (by topojson id OR topoName) → country record.
const byTopoId = new Map();
for (const c of COUNTRIES) {
  if (c.num != null) byTopoId.set(c.num, c);
}
const byTopoName = new Map();
for (const c of COUNTRIES) {
  if (c.topoName) byTopoName.set(c.topoName, c);
}

function countryForFeature(f) {
  if (f.id != null && byTopoId.has(String(f.id))) return byTopoId.get(String(f.id));
  const name = f.properties && f.properties.name;
  if (name && byTopoName.has(name)) return byTopoName.get(name);
  return null;
}

const state = {
  deck: [],
  cursor: 0,
  score: 0,
  mistakes: 0,
  current: null,
  difficulty: "normal",
  pathsByCountryNum: new Map(), // key: country.num ?? ("name:" + topoName) → SVGPathElement
  activePath: null,
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function countryKey(c) {
  return c.num != null ? c.num : "name:" + c.topoName;
}

// ---- Map rendering ------------------------------------------------------

const projection = d3.geoNaturalEarth1();
const path = d3.geoPath(projection);
let mapBounds = null; // {x, y, w, h} baseline viewBox

async function renderMap() {
  const topo = await fetch(TOPO_URL).then((r) => r.json());
  const fc = feature(topo, topo.objects.countries);

  projection.fitSize([960, 500], fc);

  const svg = d3.select(els.map);
  svg.selectAll("*").remove();
  const g = svg.append("g").attr("class", "countries-layer");

  const paths = g
    .selectAll("path")
    .data(fc.features)
    .join("path")
    .attr("class", "country")
    .attr("d", path);

  paths.each(function (f) {
    const c = countryForFeature(f);
    if (c) state.pathsByCountryNum.set(countryKey(c), this);
  });

  mapBounds = { x: 0, y: 0, w: 960, h: 500 };
  els.map.setAttribute("viewBox", `0 0 ${mapBounds.w} ${mapBounds.h}`);
  els.loading.hidden = true;
  els.screenStart.hidden = false;
}

function focusOnCountry(country, { instant = false } = {}) {
  const el = state.pathsByCountryNum.get(countryKey(country));
  if (!el) return;

  const bbox = el.getBBox();
  // Pad around the country and clamp to the full map bounds so we don't pan
  // into empty ocean beyond the map edges.
  const padX = Math.max(bbox.width * 0.8, 40);
  const padY = Math.max(bbox.height * 0.8, 40);
  let x = bbox.x - padX;
  let y = bbox.y - padY;
  let w = bbox.width + padX * 2;
  let h = bbox.height + padY * 2;

  // Maintain the map aspect ratio so the projection doesn't distort.
  const targetAspect = 960 / 500;
  const currentAspect = w / h;
  if (currentAspect < targetAspect) {
    const newW = h * targetAspect;
    x -= (newW - w) / 2;
    w = newW;
  } else {
    const newH = w / targetAspect;
    y -= (newH - h) / 2;
    h = newH;
  }

  // Bias the country toward the upper portion of the visible area so the
  // bottom HUD (flag + guess input) doesn't sit on top of it.
  y += h * 0.12;

  // Clamp
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + w > mapBounds.w) x = mapBounds.w - w;
  if (y + h > mapBounds.h) y = mapBounds.h - h;

  animateViewBox(x, y, w, h, instant ? 0 : 700);
}

function resetFocus(instant = false) {
  animateViewBox(0, 0, mapBounds.w, mapBounds.h, instant ? 0 : 600);
}

function animateViewBox(nx, ny, nw, nh, duration) {
  const svg = els.map;
  const [cx, cy, cw, ch] = (svg.getAttribute("viewBox") || "0 0 960 500")
    .split(/\s+/)
    .map(Number);
  if (duration === 0) {
    svg.setAttribute("viewBox", `${nx} ${ny} ${nw} ${nh}`);
    return;
  }
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3); // easeOutCubic
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const k = ease(t);
    const x = cx + (nx - cx) * k;
    const y = cy + (ny - cy) * k;
    const w = cw + (nw - cw) * k;
    const h = ch + (nh - ch) * k;
    svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function clearActive() {
  if (state.activePath) {
    state.activePath.classList.remove("active", "reveal");
    state.activePath = null;
  }
  els.map.querySelectorAll(".country.dimmed").forEach((n) => n.classList.remove("dimmed"));
}

function markActive(country) {
  clearActive();
  const el = state.pathsByCountryNum.get(countryKey(country));
  if (!el) return;
  els.map.querySelectorAll(".country").forEach((n) => {
    if (n !== el) n.classList.add("dimmed");
  });
  el.classList.add("active");
  state.activePath = el;
}

function markReveal(country) {
  const el = state.pathsByCountryNum.get(countryKey(country));
  if (!el) return;
  el.classList.remove("active");
  el.classList.add("reveal");
}

// ---- Game flow ----------------------------------------------------------

function showScreen(which) {
  els.screenStart.hidden = which !== "start";
  els.screenOver.hidden = which !== "over";
  els.hud.hidden = which !== "play";
  els.stats.hidden = which !== "play";
}

function updateStats() {
  els.score.textContent = String(state.score);
  const remaining = MAX_MISTAKES - state.mistakes;
  els.lives.textContent = "❤️".repeat(remaining) + "🖤".repeat(state.mistakes);
}

function startGame(difficulty = "normal") {
  if (!DIFFICULTIES[difficulty]) difficulty = "normal";
  state.difficulty = difficulty;
  state.deck = shuffle(countriesForDifficulty(difficulty));
  state.cursor = 0;
  state.score = 0;
  state.mistakes = 0;
  updateStats();
  showScreen("play");
  nextCountry();
}

function nextCountry() {
  if (state.mistakes >= MAX_MISTAKES || state.cursor >= state.deck.length) {
    endGame();
    return;
  }
  state.current = state.deck[state.cursor++];
  els.flag.textContent = flagEmoji(state.current.a2);
  els.guess.value = "";
  els.feedback.textContent = "";
  els.feedback.className = "feedback";
  els.guess.disabled = false;
  els.btnSubmit.disabled = false;
  els.btnSkip.disabled = false;
  markActive(state.current);
  focusOnCountry(state.current);
  els.guess.focus();
}

function advanceAfter(ms) {
  els.guess.disabled = true;
  els.btnSubmit.disabled = true;
  els.btnSkip.disabled = true;
  setTimeout(() => {
    clearActive();
    nextCountry();
  }, ms);
}

function submitGuess() {
  const raw = els.guess.value;
  if (!raw.trim()) return;
  if (matchGuess(raw, state.current)) {
    state.score++;
    els.feedback.textContent = `Correct! ${canonicalName(state.current)} / ${swedishName(state.current)}`;
    els.feedback.className = "feedback correct";
    markReveal(state.current);
    updateStats();
    advanceAfter(900);
  } else {
    state.mistakes++;
    els.feedback.textContent = `Wrong — it was ${canonicalName(state.current)} / ${swedishName(state.current)}`;
    els.feedback.className = "feedback wrong";
    markReveal(state.current);
    updateStats();
    advanceAfter(1600);
  }
}

function skip() {
  state.mistakes++;
  els.feedback.textContent = `Skipped — it was ${canonicalName(state.current)} / ${swedishName(state.current)}`;
  els.feedback.className = "feedback wrong";
  markReveal(state.current);
  updateStats();
  advanceAfter(1400);
}

function endGame() {
  clearActive();
  resetFocus();
  els.finalScore.textContent = String(state.score);
  els.finalDiff.textContent = DIFFICULTIES[state.difficulty].label;
  showScreen("over");
}

// ---- Wire up ------------------------------------------------------------

for (const btn of document.querySelectorAll("[data-diff]")) {
  btn.addEventListener("click", () => startGame(btn.dataset.diff));
}
els.guessForm.addEventListener("submit", (e) => {
  e.preventDefault();
  submitGuess();
});
els.btnSkip.addEventListener("click", skip);

renderMap().catch((err) => {
  console.error(err);
  els.loading.textContent = "Failed to load map — reload to retry.";
});
