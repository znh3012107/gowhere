const STORAGE_KEY = "gowhere-v1";
const SUPABASE_REST_URL = "https://wzujhoqsezqyuxhlelnp.supabase.co/rest/v1";
const SUPABASE_KEY = "sb_publishable_3gPlW8b0BfMqIC9AFiRZig_n0Ee4WYK";
const SUPABASE_TABLE = "gowhere_state";
const SUPABASE_STATE_ID = "main";

const defaultPlaces = [
  { id: "place-1", name: "地点一", capacity: 3 },
  { id: "place-2", name: "地点二", capacity: 4 },
  { id: "place-3", name: "地点三", capacity: 4 },
  { id: "place-4", name: "地点四", capacity: 4 },
  { id: "place-5", name: "地点五", capacity: 4 },
  { id: "place-6", name: "地点六", capacity: 4 },
  { id: "place-7", name: "地点七", capacity: 4 },
];

const state = loadState();
let serverAvailable = false;
let remoteProvider = "local";
let activeView = "home";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function loadState() {
  const fallback = {
    places: defaultPlaces.map((place) => ({ ...place })),
    roster: Array.from({ length: 27 }, (_, index) => ({
      name: `成员${index + 1}`,
      gender: "",
    })),
    submissions: [],
  };

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return normalizeState(stored, fallback);
  } catch {
    return fallback;
  }
}

function normalizeState(input, fallback = state) {
  if (!input) {
    return {
      places: fallback.places.map((place) => ({ ...place })),
      roster: fallback.roster.map((member) => ({ ...member })),
      submissions: fallback.submissions.map((submission) => ({ ...submission })),
    };
  }

  return {
    places:
      Array.isArray(input.places) && input.places.length === 7
        ? input.places.map((place, index) => ({
            id: place.id || `place-${index + 1}`,
            name: place.name || `地点${index + 1}`,
            capacity: Number(place.capacity) || fallback.places[index]?.capacity || 4,
          }))
        : fallback.places.map((place) => ({ ...place })),
    roster: Array.isArray(input.roster)
      ? input.roster.map((member) => ({
          name: member.name || "",
          gender: member.gender === "男" || member.gender === "女" ? member.gender : "",
        }))
      : fallback.roster.map((member) => ({ ...member })),
    submissions: Array.isArray(input.submissions)
      ? input.submissions.map((submission) => ({
          ...submission,
          score: Number(submission.score),
          avoid: Array.isArray(submission.avoid) ? submission.avoid : [],
          prefer: Array.isArray(submission.prefer) ? submission.prefer : [],
        }))
      : fallback.submissions.map((submission) => ({ ...submission })),
  };
}

function applyState(nextState) {
  state.places.splice(0, state.places.length, ...nextState.places);
  state.roster.splice(0, state.roster.length, ...nextState.roster);
  state.submissions.splice(0, state.submissions.length, ...nextState.submissions);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (remoteProvider === "supabase") return saveSupabaseState();
  if (!serverAvailable) return Promise.resolve(false);

  return fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  })
    .then((response) => {
      if (!response.ok) throw new Error("save failed");
      return true;
    })
    .catch(() => {
      serverAvailable = false;
      remoteProvider = "local";
      renderSummary();
      showToast("共享保存失败，当前暂存到本机。");
      return false;
    });
}

async function pullSharedState(options = {}) {
  if (SUPABASE_REST_URL && SUPABASE_KEY) {
    const supabaseOk = await pullSupabaseState(options);
    if (supabaseOk) return true;
  }

  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("load failed");
    const remote = await response.json();
    serverAvailable = true;
    remoteProvider = "server";
    applyState(normalizeState(remote));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderAll();
    if (!options.silent) showToast("已连接共享数据。");
    return true;
  } catch {
    serverAvailable = false;
    remoteProvider = "local";
    renderSummary();
    return false;
  }
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function pullSupabaseState(options = {}) {
  const url = `${SUPABASE_REST_URL}/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(SUPABASE_STATE_ID)}&select=data`;

  try {
    const response = await fetch(url, {
      headers: supabaseHeaders(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("supabase load failed");

    const rows = await response.json();
    serverAvailable = true;
    remoteProvider = "supabase";
    if (rows[0]?.data) {
      applyState(normalizeState(rows[0].data));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      await saveSupabaseState();
    }
    renderAll();
    if (!options.silent) showToast("已连接 Supabase 共享数据。");
    return true;
  } catch {
    return false;
  }
}

async function saveSupabaseState() {
  const url = `${SUPABASE_REST_URL}/${SUPABASE_TABLE}?on_conflict=id`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...supabaseHeaders(),
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        id: SUPABASE_STATE_ID,
        data: state,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) throw new Error("supabase save failed");
    serverAvailable = true;
    remoteProvider = "supabase";
    return true;
  } catch {
    serverAvailable = false;
    remoteProvider = "local";
    renderSummary();
    showToast("Supabase 保存失败，当前暂存到本机。");
    return false;
  }
}

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ");
}

function placeName(placeId) {
  return state.places.find((place) => place.id === placeId)?.name || placeId || "未选择";
}

function totalCapacity() {
  return state.places.reduce((sum, place) => sum + Number(place.capacity || 0), 0);
}

function uniqueValues(values) {
  return values.filter(Boolean).filter((value, index, all) => all.indexOf(value) === index);
}

function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function switchView(viewName) {
  activeView = viewName;
  $$(".view").forEach((view) => view.classList.remove("active"));
  $(`#${viewName}View`).classList.add("active");
  $$(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
}

function renderPlaceOptions() {
  const selects = $$(".avoid-select, .prefer-select");
  selects.forEach((select) => {
    const current = select.value;
    select.innerHTML = [
      `<option value="">第 ${select.dataset.rank} 志愿，可留空</option>`,
      ...state.places.map((place) => `<option value="${place.id}">${place.name}</option>`),
    ].join("");
    select.value = state.places.some((place) => place.id === current) ? current : "";
  });
}

function renderSummary() {
  const capacity = totalCapacity();
  const submittedNames = new Set(state.submissions.map((item) => item.name));
  const maleCount = state.submissions.filter((item) => item.gender === "男").length;

  $("#submissionCount").textContent = state.submissions.length;
  $("#memberCount").textContent = capacity;
  $("#placeCount").textContent = state.places.length;
  $("#dataMode").textContent =
    remoteProvider === "supabase" ? "公网" : remoteProvider === "server" ? "共享" : "本机";
  $("#homeSubmissionCount").textContent = `${state.submissions.length} / ${capacity}`;
  $("#homeProgress").style.width = `${Math.min(100, (state.submissions.length / Math.max(1, capacity)) * 100)}%`;
  $("#homeCapacity").textContent = capacity;
  $("#homeCapacityNote").textContent = state.places.map((place) => `${place.name} ${place.capacity} 人`).join("，");
  $("#homeMaleCount").textContent = maleCount;

  $$(".profile-card").forEach((card) => {
    card.classList.toggle("submitted", submittedNames.has(card.dataset.name));
  });
}

function renderProfiles() {
  const grid = $("#profileGrid");
  const query = $("#profileSearch").value.trim().toLowerCase();

  const filtered = state.submissions
    .slice()
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh-CN"))
    .filter((person) => {
      const haystack = [
        person.name,
        person.gender,
        String(person.score),
        ...person.avoid.map(placeName),
        ...person.prefer.map(placeName),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="notice-line">还没有匹配的公开意愿。</div>`;
    return;
  }

  grid.innerHTML = filtered
    .map(
      (person) => `
        <button class="profile-card" data-name="${person.name}" type="button">
          <div>
            <h3>${person.name}</h3>
            <div class="tag-row">
              <span class="tag">${person.gender}</span>
              <span class="tag">积分 ${person.score}</span>
            </div>
          </div>
          <ul class="mini-list">
            <li>想去：${formatRankList(person.prefer)}</li>
            <li>不想去：${formatRankList(person.avoid)}</li>
          </ul>
        </button>
      `,
    )
    .join("");

  $$(".profile-card").forEach((card) => {
    card.addEventListener("click", () => openProfile(card.dataset.name));
  });
}

function formatRankList(placeIds) {
  return placeIds.length ? placeIds.map((id, index) => `${index + 1}. ${placeName(id)}`).join(" / ") : "未填写";
}

function openProfile(name) {
  const person = state.submissions.find((item) => item.name === name);
  if (!person) return;

  $("#dialogName").textContent = person.name;
  $("#dialogBody").innerHTML = `
    <div class="tag-row">
      <span class="tag">${person.gender}</span>
      <span class="tag">积分 ${person.score}</span>
      <span class="tag">提交时间 ${new Date(person.updatedAt).toLocaleString("zh-CN")}</span>
    </div>
    <div>
      <strong>最想去的地方</strong>
      <ul class="mini-list">${rankItems(person.prefer)}</ul>
    </div>
    <div>
      <strong>最不能接受去的地方</strong>
      <ul class="mini-list">${rankItems(person.avoid)}</ul>
    </div>
  `;
  $("#profileDialog").showModal();
}

function rankItems(placeIds) {
  if (!placeIds.length) return "<li>未填写</li>";
  return placeIds.map((id, index) => `<li>第 ${index + 1} 位：${placeName(id)}</li>`).join("");
}

function renderSettings() {
  $("#placesEditor").innerHTML = state.places
    .map(
      (place, index) => `
        <div class="place-editor-row">
          <input data-place-name="${index}" value="${place.name}" aria-label="地点名称 ${index + 1}" />
          <input data-place-capacity="${index}" min="1" max="8" type="number" value="${place.capacity}" aria-label="地点容量 ${index + 1}" />
        </div>
      `,
    )
    .join("");

  $("#rosterInput").value = state.roster.map((member) => [member.name, member.gender].filter(Boolean).join(",")).join("\n");
}

function collectRanked(className) {
  return uniqueValues($$(className).map((select) => select.value));
}

async function handleWishSubmit(event) {
  event.preventDefault();
  const name = normalizeName($("#nameInput").value);
  const gender = $("#genderInput").value;
  const score = Number($("#scoreInput").value);
  const avoid = collectRanked(".avoid-select");
  const prefer = collectRanked(".prefer-select");

  if (!name || !gender || Number.isNaN(score)) {
    showToast("请把姓名、性别和积分填写完整。");
    return;
  }

  const overlap = avoid.find((placeId) => prefer.includes(placeId));
  if (overlap) {
    showToast(`${placeName(overlap)} 同时出现在想去和不想去里，请调整。`);
    return;
  }

  await pullSharedState({ silent: true });
  const existingIndex = state.submissions.findIndex((item) => item.name === name);
  const record = {
    id: existingIndex >= 0 ? state.submissions[existingIndex].id : createId(),
    name,
    gender,
    score,
    avoid,
    prefer,
    updatedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    state.submissions.splice(existingIndex, 1, record);
  } else {
    state.submissions.push(record);
  }

  const rosterMember = state.roster.find((member) => member.name === name);
  if (rosterMember) rosterMember.gender = gender;

  await saveState();
  renderAll();
  $("#wishForm").reset();
  showToast(existingIndex >= 0 ? "已更新公开意愿。" : "已提交公开意愿。");
  switchView("profiles");
}

async function handlePlacesSubmit(event) {
  event.preventDefault();
  const nextPlaces = state.places.map((place, index) => ({
    ...place,
    name: normalizeName($(`[data-place-name="${index}"]`).value) || `地点${index + 1}`,
    capacity: Math.max(1, Number($(`[data-place-capacity="${index}"]`).value) || place.capacity),
  }));

  state.places.splice(0, state.places.length, ...nextPlaces);
  await saveState();
  renderAll();
  showToast("地点设置已保存。");
}

async function handleRosterSubmit(event) {
  event.preventDefault();
  const rows = $("#rosterInput").value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const roster = rows.map((line) => {
    const [namePart, genderPart = ""] = line.split(/[,，\s]+/);
    const gender = genderPart === "男" || genderPart === "女" ? genderPart : "";
    return { name: normalizeName(namePart), gender };
  });

  state.roster.splice(0, state.roster.length, ...roster);
  state.submissions.forEach((submission) => {
    const rosterMember = state.roster.find((member) => member.name === submission.name);
    if (rosterMember && !rosterMember.gender) rosterMember.gender = submission.gender;
  });
  await saveState();
  renderAll();
  showToast("成员名单已保存。");
}

function buildMembersForSimulation() {
  const submissionsByName = new Map(state.submissions.map((submission) => [submission.name, submission]));
  const members = [];

  state.roster.forEach((member) => {
    const submission = submissionsByName.get(member.name);
    if (submission) {
      members.push({ ...submission, submitted: true });
      submissionsByName.delete(member.name);
    } else {
      members.push({
        id: `roster-${member.name}`,
        name: member.name,
        gender: member.gender || "",
        score: -1,
        avoid: [],
        prefer: [],
        submitted: false,
      });
    }
  });

  submissionsByName.forEach((submission) => {
    members.push({ ...submission, submitted: true });
  });

  while (members.length < totalCapacity()) {
    members.push({
      id: `placeholder-${members.length + 1}`,
      name: `未填写成员${members.length + 1}`,
      gender: "",
      score: -1,
      avoid: [],
      prefer: [],
      submitted: false,
    });
  }

  return members.slice(0, totalCapacity());
}

function runSimulation() {
  const members = buildMembersForSimulation();
  const assignments = Object.fromEntries(state.places.map((place) => [place.id, []]));
  const assigned = new Set();

  const submittedMembers = members.filter((member) => member.submitted);
  const unsubmittedMembers = members.filter((member) => !member.submitted);

  seedMaleCoverage(members, assignments, assigned);

  const ordered = [...submittedMembers, ...unsubmittedMembers]
    .filter((member) => !assigned.has(member.id))
    .sort((a, b) => Number(b.submitted) - Number(a.submitted) || b.score - a.score || a.name.localeCompare(b.name, "zh-CN"));

  ordered.forEach((member) => {
    const target = pickBestPlace(member, assignments);
    if (target) {
      assignments[target.id].push(member);
      assigned.add(member.id);
    }
  });

  renderAssignments(assignments, members);
}

function seedMaleCoverage(members, assignments, assigned) {
  const maleMembers = members
    .filter((member) => member.gender === "男")
    .sort(
      (a, b) =>
        Number(b.submitted) - Number(a.submitted) ||
        b.score - a.score ||
        a.avoid.length - b.avoid.length ||
        a.name.localeCompare(b.name, "zh-CN"),
    );

  state.places.forEach((place) => {
    if (assignments[place.id].some((member) => member.gender === "男")) return;
    const candidate = maleMembers
      .filter((member) => !assigned.has(member.id))
      .map((member) => ({ member, score: scorePlace(member, place, assignments, true) }))
      .sort((a, b) => b.score - a.score || b.member.score - a.member.score)[0]?.member;

    if (candidate && hasSpace(place, assignments)) {
      assignments[place.id].push(candidate);
      assigned.add(candidate.id);
    }
  });
}

function pickBestPlace(member, assignments) {
  return state.places
    .filter((place) => hasSpace(place, assignments))
    .map((place) => ({ place, score: scorePlace(member, place, assignments, false) }))
    .sort((a, b) => b.score - a.score || openSpace(b.place, assignments) - openSpace(a.place, assignments))[0]?.place;
}

function hasSpace(place, assignments) {
  return assignments[place.id].length < place.capacity;
}

function openSpace(place, assignments) {
  return place.capacity - assignments[place.id].length;
}

function scorePlace(member, place, assignments, maleSeed) {
  let score = 100;
  const avoidRank = member.avoid.indexOf(place.id);
  const preferRank = member.prefer.indexOf(place.id);

  if (avoidRank >= 0) score -= 90 - avoidRank * 18;
  if (preferRank >= 0) score += 42 - preferRank * 10;
  if (!member.submitted) score -= 18;
  if (maleSeed && member.gender === "男") score += 34;
  if (member.gender === "男" && !assignments[place.id].some((item) => item.gender === "男")) score += 18;
  if (openSpace(place, assignments) === 1) score -= 4;
  return score;
}

function renderAssignments(assignments, members) {
  const grid = $("#assignmentGrid");
  const unsubmittedCount = members.filter((member) => !member.submitted).length;
  const uncoveredMalePlaces = state.places.filter((place) => !assignments[place.id].some((member) => member.gender === "男"));
  const avoidHits = membersAssigned(assignments).filter((member) => member.avoid.includes(member.assignedPlaceId));

  $("#simulationNotice").textContent = [
    `已按 ${members.length} 人容量模拟。`,
    unsubmittedCount ? `${unsubmittedCount} 人未填写，已排在已填写人员后插空。` : "所有模拟人员均已填写。",
    uncoveredMalePlaces.length ? `${uncoveredMalePlaces.length} 个地点暂未满足男生覆盖。` : "每个地点均已有至少 1 名男生。",
    avoidHits.length ? `${avoidHits.length} 人仍分到了不想去的地点。` : "没有人被分到已填写的不想去地点。",
  ].join(" ");

  grid.innerHTML = state.places
    .map((place) => {
      const membersInPlace = assignments[place.id] || [];
      return `
        <article class="place-card">
          <div class="place-header">
            <div>
              <h3>${place.name}</h3>
              <span class="assignment-meta">${membersInPlace.length} / ${place.capacity} 人</span>
            </div>
            <span class="tag ${membersInPlace.some((member) => member.gender === "男") ? "good" : "bad"}">
              ${membersInPlace.some((member) => member.gender === "男") ? "已有男生" : "缺男生"}
            </span>
          </div>
          <ul class="member-list">
            ${membersInPlace.map((member) => assignmentItem(member, place.id)).join("") || "<li>暂无人员</li>"}
          </ul>
        </article>
      `;
    })
    .join("");
}

function membersAssigned(assignments) {
  return Object.entries(assignments).flatMap(([placeId, members]) =>
    members.map((member) => ({
      ...member,
      assignedPlaceId: placeId,
    })),
  );
}

function assignmentItem(member, placeId) {
  const avoidRank = member.avoid.indexOf(placeId);
  const preferRank = member.prefer.indexOf(placeId);
  const className = avoidRank >= 0 ? "avoid" : preferRank >= 0 ? "prefer" : "";
  const status =
    avoidRank >= 0
      ? `不想去第 ${avoidRank + 1} 位`
      : preferRank >= 0
        ? `想去第 ${preferRank + 1} 位`
        : member.submitted
          ? "非强偏好地点"
          : "未填写，插空";

  return `
    <li class="${className}">
      <strong>${member.name}</strong>
      <span class="assignment-meta">${member.gender || "性别未知"} / ${member.submitted ? `积分 ${member.score}` : "未填写"} / ${status}</span>
    </li>
  `;
}

async function resetData() {
  const ok = window.confirm("恢复默认会清空地点、名单和已提交意愿，确定继续吗？");
  if (!ok) return;

  state.places.splice(0, state.places.length, ...defaultPlaces.map((place) => ({ ...place })));
  state.roster.splice(
    0,
    state.roster.length,
    ...Array.from({ length: 27 }, (_, index) => ({ name: `成员${index + 1}`, gender: "" })),
  );
  state.submissions.splice(0, state.submissions.length);
  await saveState();
  renderAll();
  showToast("已恢复默认数据。");
}

function renderAll() {
  renderPlaceOptions();
  renderProfiles();
  renderSettings();
  renderSummary();
}

function bindEvents() {
  $$("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  $("#wishForm").addEventListener("submit", handleWishSubmit);
  $("#clearFormButton").addEventListener("click", () => $("#wishForm").reset());
  $("#profileSearch").addEventListener("input", renderProfiles);
  $("#closeDialogButton").addEventListener("click", () => $("#profileDialog").close());
  $("#runSimulationButton").addEventListener("click", runSimulation);
  $("#placesForm").addEventListener("submit", handlePlacesSubmit);
  $("#rosterForm").addEventListener("submit", handleRosterSubmit);
  $("#resetDataButton").addEventListener("click", resetData);
}

bindEvents();
renderAll();
pullSharedState({ silent: true });
