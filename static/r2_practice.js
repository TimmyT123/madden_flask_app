// WURD Running Vision + R2 Practice v10 — blocker leverage and cutback recognition
// Offense begins at the bottom and moves upward.
// Defense begins at the top and closes downward, matching Madden's standard camera orientation.
"use strict";

const DIFFICULTIES = {
    beginner: {
        label: "Beginner",
        readMin: 1700,
        readMax: 2800,
        reactionWindow: 1200,
        insideApproach: 1100,
        outsideOpenApproach: 480,
        outsideDevelopingApproach: 1400,
        defenseApproach: 520
    },
    normal: {
        label: "Normal",
        readMin: 1250,
        readMax: 2250,
        reactionWindow: 850,
        insideApproach: 850,
        outsideOpenApproach: 360,
        outsideDevelopingApproach: 1100,
        defenseApproach: 400
    },
    fast: {
        label: "Fast",
        readMin: 900,
        readMax: 1750,
        reactionWindow: 650,
        insideApproach: 660,
        outsideOpenApproach: 285,
        outsideDevelopingApproach: 850,
        defenseApproach: 310
    },
    game: {
        label: "Game Speed",
        readMin: 650,
        readMax: 1350,
        reactionWindow: 500,
        insideApproach: 520,
        outsideOpenApproach: 225,
        outsideDevelopingApproach: 700,
        defenseApproach: 245
    }
};

const R2_BUTTON_INDEX = 7;
const PS_HOME_BUTTON_INDEX = 16;
const WURD_HOME_URL = "/";
const R2_THRESHOLD = 0.35;
const LEFT_STICK_DEADZONE = 0.18;
const STICK_FORWARD_MIN = 0.28;
const STICK_SIDE_MIN = 0.30;
const STICK_MIDDLE_MAX_X = 0.38;
const DIRECTIONS = ["left", "middle", "right"];
const OUTSIDE_DIRECTIONS = ["left", "right"];

// Each scenario describes what the runner should learn to SEE, not a lane that is shown to them.
// blockerDx / defenderDx are percentage-point movements from each player's starting X position.
const VISION_SCENARIOS = [
    {
        id: "inside-press-right-cut-left",
        concepts: ["inside"],
        family: "cutback",
        initialDirection: "right",
        direction: "left",
        label: "PRESS RIGHT → CUT LEFT",
        blockerDx: [-2, 4, 7],
        defenderDx: [1, -7, -10],
        defenderDy: [1, 2, 2],
        linebackerDxInitial: [0, 2, -2],
        linebackerDyInitial: [0, 0, 0],
        linebackerDxFinal: [4, 10, 8],
        linebackerDyFinal: [1, 4, 2],
        coaching: "Your right-side leverage invites you to press right, but the linebackers overfit it. Plant and cut back left before using R2."
    },
    {
        id: "inside-press-left-cut-right",
        concepts: ["inside"],
        family: "cutback",
        initialDirection: "left",
        direction: "right",
        label: "PRESS LEFT → CUT RIGHT",
        blockerDx: [-7, -4, 2],
        defenderDx: [10, 7, -1],
        defenderDy: [2, 2, 1],
        linebackerDxInitial: [2, -2, 0],
        linebackerDyInitial: [0, 0, 0],
        linebackerDxFinal: [-8, -10, -4],
        linebackerDyFinal: [2, 4, 1],
        coaching: "The first-level leverage says press left. When the second level flows left, cut behind it to the right."
    },
    {
        id: "inside-press-middle-stay",
        concepts: ["inside"],
        family: "stay",
        initialDirection: "middle",
        direction: "middle",
        label: "PRESS MIDDLE → STAY",
        blockerDx: [-4, -7, 5],
        defenderDx: [6, -10, -7],
        defenderDy: [1, 2, 1],
        linebackerDxInitial: [-1, 0, 1],
        linebackerDyInitial: [0, 0, 0],
        linebackerDxFinal: [-7, 0, 7],
        linebackerDyFinal: [2, 2, 2],
        coaching: "The blockers create a vertical crease and the linebackers widen. Do not invent a cutback—stay vertical through the middle."
    },
    {
        id: "inside-press-right-stay",
        concepts: ["inside"],
        family: "stay",
        initialDirection: "right",
        direction: "right",
        label: "PRESS RIGHT → STAY",
        blockerDx: [-1, -5, 7],
        defenderDx: [0, -8, -10],
        defenderDy: [1, 2, 2],
        linebackerDxInitial: [0, -2, 1],
        linebackerDyInitial: [0, 0, 0],
        linebackerDxFinal: [-2, -5, 5],
        linebackerDyFinal: [1, 2, 2],
        coaching: "The right-side blocker keeps leverage and the linebackers do not close the lane. Stay on the original path and get vertical."
    },
    {
        id: "outside-press-left-bounce-left",
        concepts: ["outside"],
        family: "bounce",
        initialDirection: "left",
        direction: "left",
        label: "PRESS LEFT → BOUNCE LEFT",
        blockerDx: [-9, -2, 2],
        defenderDx: [11, 5, 1],
        defenderDy: [1, 2, 0],
        linebackerDxInitial: [2, 1, 0],
        linebackerDyInitial: [0, 0, 0],
        linebackerDxFinal: [7, 6, 1],
        linebackerDyFinal: [2, 3, 1],
        coaching: "The edge defender is sealed inside and the linebackers get caught inside. Keep pressing left, then bounce outside and burst."
    },
    {
        id: "outside-press-right-cut-middle",
        concepts: ["outside"],
        family: "cutback",
        initialDirection: "right",
        direction: "middle",
        label: "PRESS RIGHT → CUT MIDDLE",
        blockerDx: [-1, 3, 8],
        defenderDx: [0, -3, -11],
        defenderDy: [0, 1, 1],
        linebackerDxInitial: [0, 1, -2],
        linebackerDyInitial: [0, 0, 0],
        linebackerDxFinal: [1, 8, 10],
        linebackerDyFinal: [1, 4, 2],
        coaching: "Press the outside run right to move the defense. When the linebackers widen, plant and cut underneath into the middle crease."
    },
    {
        id: "muddy-press-left-minimize",
        concepts: ["inside"],
        family: "damage-control",
        initialDirection: "middle",
        direction: "left",
        label: "PRESS MIDDLE → ESCAPE LEFT",
        blockerDx: [-3, 1, 4],
        defenderDx: [4, 8, -4],
        defenderDy: [2, 6, 2],
        linebackerDxInitial: [0, 0, 0],
        linebackerDyInitial: [0, 0, 0],
        linebackerDxFinal: [0, 5, 5],
        linebackerDyFinal: [1, 3, 1],
        coaching: "The called lane never becomes clean. Press it long enough to confirm the problem, then escape left for the best available yards."
    }
];

const els = {
    inputMode: document.getElementById("inputModeSelect"),
    drillType: document.getElementById("drillTypeSelect"),
    runRead: document.getElementById("runReadSelect"),
    difficulty: document.getElementById("difficultySelect"),
    drillLength: document.getElementById("drillLengthSelect"),
    startBtn: document.getElementById("startBtn"),
    controllerStatus: document.getElementById("controllerStatus"),
    r2Status: document.getElementById("r2Status"),
    leftStickStatus: document.getElementById("leftStickStatus"),
    keyboardHelp: document.getElementById("keyboardHelp"),
    gameArea: document.getElementById("gameArea"),
    perfectCount: document.getElementById("perfectCount"),
    earlyCount: document.getElementById("earlyCount"),
    lateCount: document.getElementById("lateCount"),
    wrongDirectionCount: document.getElementById("wrongDirectionCount"),
    disciplinePercent: document.getElementById("disciplinePercent"),
    visionPercent: document.getElementById("visionPercent"),
    leveragePercent: document.getElementById("leveragePercent"),
    cutbackPercent: document.getElementById("cutbackPercent"),
    averageReaction: document.getElementById("averageReaction"),
    streak: document.getElementById("streak"),
    bestStreak: document.getElementById("bestStreak"),
    runner: document.getElementById("runner"),
    defender: document.getElementById("defender"),
    ballCarrier: document.getElementById("ballCarrier"),
    blockers: [
        document.getElementById("blockerLeft"),
        document.getElementById("blockerMiddle"),
        document.getElementById("blockerRight")
    ],
    runDefenders: [
        document.getElementById("runDefenderLeft"),
        document.getElementById("runDefenderMiddle"),
        document.getElementById("runDefenderRight")
    ],
    runLinebackers: [
        document.getElementById("runLinebackerLeft"),
        document.getElementById("runLinebackerMiddle"),
        document.getElementById("runLinebackerRight")
    ],
    lanes: {
        left: document.getElementById("laneLeft"),
        middle: document.getElementById("laneMiddle"),
        right: document.getElementById("laneRight")
    },
    lineOfScrimmage: document.getElementById("lineOfScrimmage"),
    lineOfScrimmageLabel: document.getElementById("lineOfScrimmageLabel"),
    burstLine: document.getElementById("burstLine"),
    burstLineLabel: document.getElementById("burstLineLabel"),
    directionArrow: document.getElementById("directionArrow"),
    countdown: document.getElementById("countdown"),
    playBadge: document.getElementById("playBadge"),
    phaseTitle: document.getElementById("phaseTitle"),
    phaseInstruction: document.getElementById("phaseInstruction"),
    cueLight: document.getElementById("cueLight"),
    cueText: document.getElementById("cueText"),
    reactionMeterFill: document.getElementById("reactionMeterFill"),
    reactionWindowText: document.getElementById("reactionWindowText"),
    r2TestButton: document.getElementById("r2TestButton"),
    feedback: document.getElementById("feedback")
};

const state = {
    running: false,
    phase: "idle",
    playType: "offense",
    runConcept: "inside",
    outsideTiming: null,
    direction: "middle",
    initialDirection: "middle",
    visionScenario: null,
    visionChoice: null,
    visionAttempts: 0,
    visionCorrect: 0,
    leverageAttempts: 0,
    leverageCorrect: 0,
    cutbackAttempts: 0,
    cutbackCorrect: 0,
    initialChoice: null,
    finalChoice: null,
    readStage: "press",
    stageProgress: 0,
    missedStage: null,
    wrongLaneHoldMs: 0,
    playsCompleted: 0,
    targetPlays: null,
    perfect: 0,
    early: 0,
    late: 0,
    wrongDirection: 0,
    streak: 0,
    bestStreak: 0,
    reactions: [],
    cueAt: 0,
    r2Down: false,
    keyboardR2Down: false,
    pointerR2Down: false,
    leftX: 0,
    leftY: 0,
    approachProgress: 0,
    approachDuration: 850,
    burstLineTop: 52,
    lineOfScrimmageTop: 44,
    approachLastAt: 0,
    cueTimer: null,
    lateTimer: null,
    nextTimer: null,
    countdownTimer: null,
    lastControllerIndex: null,
    animationFrame: null,
    psHomeDown: false,
    paused: false,
    pauseStartedAt: 0,
    readAnimationTimer: null
};

const managedTimerMeta = {};

const perfectSound = new Audio("/static/sounds/perfect.mp3");
const wrongSound = new Audio("/static/sounds/wrong.mp3");
perfectSound.preload = "auto";
wrongSound.preload = "auto";

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function lerp(start, end, amount) {
    return start + (end - start) * amount;
}

function easeOut(amount) {
    const t = clamp(amount, 0, 1);
    return 1 - Math.pow(1 - t, 2);
}

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function currentDifficulty() {
    return DIFFICULTIES[els.difficulty.value] || DIFFICULTIES.normal;
}

function clearManagedTimer(key) {
    if (state[key] !== null) {
        clearTimeout(state[key]);
        state[key] = null;
    }

    delete managedTimerMeta[key];
}

function armManagedTimer(key) {
    const meta = managedTimerMeta[key];
    if (!meta || state.paused || !state.running) return;

    meta.startedAt = performance.now();

    state[key] = setTimeout(() => {
        state[key] = null;
        delete managedTimerMeta[key];

        if (!state.running || state.paused) return;
        meta.callback();
    }, Math.max(0, meta.remaining));
}

function setManagedTimer(key, callback, delayMs) {
    clearManagedTimer(key);

    managedTimerMeta[key] = {
        callback,
        remaining: Math.max(0, Number(delayMs) || 0),
        startedAt: performance.now()
    };

    armManagedTimer(key);
}

function pauseManagedTimers() {
    const now = performance.now();

    Object.entries(managedTimerMeta).forEach(([key, meta]) => {
        if (state[key] !== null) {
            clearTimeout(state[key]);
            state[key] = null;
            meta.remaining = Math.max(0, meta.remaining - (now - meta.startedAt));
        }
    });
}

function resumeManagedTimers() {
    Object.keys(managedTimerMeta).forEach(armManagedTimer);
}

function clearTimers() {
    clearManagedTimer("cueTimer");
    clearManagedTimer("lateTimer");
    clearManagedTimer("nextTimer");
    clearManagedTimer("countdownTimer");
    clearManagedTimer("readAnimationTimer");
}

function playSound(sound) {
    try {
        sound.currentTime = 0;
        void sound.play().catch(() => {});
    } catch (_) {
        // Visual feedback remains available when audio playback is blocked.
    }
}

function setFeedback(text, kind = "neutral") {
    els.feedback.textContent = text;
    els.feedback.className = `feedback ${kind}`;
}

function setCue(mode, text) {
    els.cueLight.className = `cue-light ${mode}`;
    els.cueText.textContent = text;
}

function updateReactionWindowLabel() {
    const difficulty = currentDifficulty();
    els.reactionWindowText.textContent = `${difficulty.label} green window: ${difficulty.reactionWindow} ms`;
}

function updateRunReadAvailability() {
    const defenseOnly = els.drillType.value === "defense";
    els.runRead.disabled = defenseOnly;
    els.runRead.title = defenseOnly ? "This setting applies only to offense." : "Choose which offensive run reads appear.";
}

function updateScoreboard() {
    const attempts = state.perfect + state.early + state.late + state.wrongDirection;
    const discipline = attempts ? Math.round((state.perfect / attempts) * 100) : 100;
    const average = state.reactions.length
        ? Math.round(state.reactions.reduce((sum, value) => sum + value, 0) / state.reactions.length)
        : null;
    const vision = state.visionAttempts ? Math.round((state.visionCorrect / state.visionAttempts) * 100) : 100;
    const leverage = state.leverageAttempts ? Math.round((state.leverageCorrect / state.leverageAttempts) * 100) : 100;
    const cutback = state.cutbackAttempts ? Math.round((state.cutbackCorrect / state.cutbackAttempts) * 100) : 100;

    els.perfectCount.textContent = String(state.perfect);
    els.earlyCount.textContent = String(state.early);
    els.lateCount.textContent = String(state.late);
    els.wrongDirectionCount.textContent = String(state.wrongDirection);
    els.disciplinePercent.textContent = `${discipline}%`;
    if (els.visionPercent) els.visionPercent.textContent = `${vision}%`;
    if (els.leveragePercent) els.leveragePercent.textContent = `${leverage}%`;
    if (els.cutbackPercent) els.cutbackPercent.textContent = `${cutback}%`;
    els.averageReaction.textContent = average === null ? "--" : `${average} ms`;
    els.streak.textContent = String(state.streak);
    els.bestStreak.textContent = String(state.bestStreak);
}

function resetStats() {
    state.playsCompleted = 0;
    state.perfect = 0;
    state.early = 0;
    state.late = 0;
    state.wrongDirection = 0;
    state.visionAttempts = 0;
    state.visionCorrect = 0;
    state.leverageAttempts = 0;
    state.leverageCorrect = 0;
    state.cutbackAttempts = 0;
    state.cutbackCorrect = 0;
    state.visionChoice = null;
    state.initialChoice = null;
    state.finalChoice = null;
    state.readStage = "press";
    state.stageProgress = 0;
    state.missedStage = null;
    state.wrongLaneHoldMs = 0;
    state.streak = 0;
    state.bestStreak = 0;
    state.reactions = [];
    updateScoreboard();
}

function choosePlayType() {
    const selected = els.drillType.value;
    if (selected === "mixed") {
        return Math.random() < 0.58 ? "offense" : "defense";
    }
    return selected;
}

function chooseOffenseConcept() {
    const selected = els.runRead.value;
    if (selected === "inside") return "inside";
    if (selected === "outside") return "outside";
    return Math.random() < 0.55 ? "inside" : "outside";
}

function chooseVisionScenario(concept) {
    const options = VISION_SCENARIOS.filter((scenario) => scenario.concepts.includes(concept));
    return randomItem(options.length ? options : VISION_SCENARIOS);
}

function configurePlaySelection() {
    state.playType = choosePlayType();
    state.outsideTiming = null;
    state.visionScenario = null;
    state.visionChoice = null;
    state.initialChoice = null;
    state.finalChoice = null;
    state.readStage = "press";
    state.stageProgress = 0;
    state.missedStage = null;
    state.wrongLaneHoldMs = 0;

    if (state.playType === "defense") {
        state.runConcept = "defense";
        state.direction = randomItem(DIRECTIONS);
        state.initialDirection = state.direction;
        return;
    }

    state.runConcept = chooseOffenseConcept();
    state.visionScenario = chooseVisionScenario(state.runConcept);
    state.initialDirection = state.visionScenario.initialDirection || state.visionScenario.direction;
    state.direction = state.visionScenario.direction;
    if (state.runConcept === "outside") {
        state.outsideTiming = Math.random() < 0.48 ? "open" : "developing";
    }
}

function directionX(direction) {
    if (direction === "left") return 24;
    if (direction === "right") return 76;
    return 50;
}


function losRelationshipText() {
    if (state.playType === "defense") {
        return "Stay above the LOS until you close downhill.";
    }
    if (state.runConcept === "outside" && state.outsideTiming === "open") {
        return "Use the LOS as a reference only; a clean edge can justify bursting before or near it.";
    }
    return "If you are still behind the LOS, R2 is usually still too early.";
}

function requiredStickLabel(direction) {
    const verticalWord = state.playType === "defense" ? "down" : "up";
    const verticalArrow = state.playType === "defense" ? "↓" : "↑";

    if (direction === "left") {
        return state.playType === "defense" ? "down-left ↙" : "up-left ↖";
    }
    if (direction === "right") {
        return state.playType === "defense" ? "down-right ↘" : "up-right ↗";
    }
    return `straight ${verticalWord} ${verticalArrow}`;
}

function describeStickDirection(x = state.leftX, y = state.leftY) {
    const magnitude = Math.hypot(x, y);
    if (magnitude < 0.28) return "centered";

    const horizontal = x <= -0.28 ? "left" : x >= 0.28 ? "right" : "";
    const vertical = y <= -0.28 ? "up" : y >= 0.28 ? "down" : "";

    if (vertical && horizontal) return `${vertical}-${horizontal}`;
    if (vertical) return vertical;
    if (horizontal) return horizontal;
    return "slightly moved";
}

function stickMatchesTarget(direction, x = state.leftX, y = state.leftY) {
    // Madden's standard camera keeps offense at the bottom and defense at the top.
    // Offense therefore attacks upward; a user-controlled defender closes downward.
    const movingForward = state.playType === "defense"
        ? y >= STICK_FORWARD_MIN
        : y <= -STICK_FORWARD_MIN;

    if (!movingForward) return false;
    if (direction === "left") return x <= -STICK_SIDE_MIN;
    if (direction === "right") return x >= STICK_SIDE_MIN;
    return Math.abs(x) <= STICK_MIDDLE_MAX_X;
}

function resetFieldVisuals() {
    Object.values(els.lanes).forEach((lane) => lane.classList.remove("open"));
    els.directionArrow.classList.remove("visible");
    els.directionArrow.style.left = "50%";
    els.directionArrow.style.top = "23%";
    els.directionArrow.textContent = "▲";
    els.directionArrow.style.transform = "translate(-50%, -50%) rotate(0deg)";

    els.lineOfScrimmage.style.top = `${state.lineOfScrimmageTop}%`;
    els.lineOfScrimmageLabel.textContent = "LINE OF SCRIMMAGE";

    els.burstLine.classList.remove("visible", "ready");
    els.burstLine.style.top = "52%";
    els.burstLineLabel.textContent = "R2 BURST POINT";

    els.runner.style.left = "50%";
    els.runner.style.top = "72%";
    els.runner.style.opacity = "1";
    // Madden camera orientation: defense at the top, offense at the bottom.
    els.defender.style.left = "50%";
    els.defender.style.top = "30%";
    els.defender.style.opacity = "1";
    els.ballCarrier.style.left = "50%";
    els.ballCarrier.style.top = "68%";
    els.ballCarrier.style.opacity = "1";

    els.blockers.forEach((blocker, index) => {
        blocker.style.left = `${28 + index * 22}%`;
        blocker.style.top = "47%";
        blocker.style.opacity = "1";
        blocker.style.transform = "translate(-50%, -50%) scale(1)";
    });

    els.runDefenders.forEach((defender, index) => {
        defender.style.left = `${28 + index * 22}%`;
        defender.style.top = "39%";
        defender.style.opacity = "1";
        defender.style.transform = "translate(-50%, -50%) scale(1)";
    });

    els.runLinebackers.forEach((linebacker, index) => {
        linebacker.style.left = `${28 + index * 22}%`;
        linebacker.style.top = "28%";
        linebacker.style.opacity = "1";
        linebacker.style.transform = "translate(-50%, -50%) scale(1)";
    });
}

function configureFieldForPlay() {
    resetFieldVisuals();

    if (state.playType === "defense") {
        els.playBadge.textContent = "DEFENSE";
        els.playBadge.className = "play-badge defense";
        els.runner.classList.add("hidden");
        els.blockers.forEach((blocker) => blocker.classList.add("hidden"));
        els.runDefenders.forEach((defender) => defender.classList.add("hidden"));
        els.runLinebackers.forEach((linebacker) => linebacker.classList.add("hidden"));
        els.defender.classList.remove("hidden");
        els.ballCarrier.classList.remove("hidden");
        els.phaseTitle.textContent = "Stay square at the top and read";
        els.phaseInstruction.textContent = "The runner is below you. Stay above the LOS, keep R2 released, then close downward only after he commits.";
        return;
    }

    els.runner.classList.remove("hidden");
    els.blockers.forEach((blocker) => blocker.classList.remove("hidden"));
    els.runDefenders.forEach((defender) => defender.classList.remove("hidden"));
    els.runLinebackers.forEach((linebacker) => linebacker.classList.remove("hidden"));
    els.defender.classList.add("hidden");
    els.ballCarrier.classList.add("hidden");

    const family = state.visionScenario?.family || "clean";
    const badgeFamilyText = family === "cutback"
        ? "CUTBACK READ"
        : family === "stay"
            ? "STAY READ"
            : family === "damage-control"
                ? "DAMAGE CONTROL"
                : family === "bounce"
                    ? "BOUNCE READ"
                    : "LEVERAGE READ";

    els.playBadge.textContent = `${state.runConcept.toUpperCase()} • ${badgeFamilyText}`;
    els.playBadge.className = `play-badge ${state.runConcept} ${family}`;

    if (family === "cutback") {
        els.phaseTitle.textContent = "Press first—expect the fit to change";
        els.phaseInstruction.textContent = "Use blocker leverage for your first path. The linebackers may over-pursue and create a cutback after you press it.";
    } else if (family === "stay") {
        els.phaseTitle.textContent = "Press the leverage and stay disciplined";
        els.phaseInstruction.textContent = "Not every run needs a cut. If the second level does not close the lane, stay vertical instead of inventing a move.";
    } else if (family === "bounce") {
        els.phaseTitle.textContent = "Press the edge leverage";
        els.phaseInstruction.textContent = "Use the outside block to move the defense, then decide whether the edge remains the best path.";
    } else if (family === "damage-control") {
        els.phaseTitle.textContent = "Press the called picture, then minimize damage";
        els.phaseInstruction.textContent = "Confirm that the lane is muddy before escaping to the best available space. Do not sprint into the first red jersey.";
    } else {
        els.phaseTitle.textContent = "Read the first-level leverage";
        els.phaseInstruction.textContent = "Press the blocker leverage first, then let the linebackers tell you whether to stay or redirect.";
    }
}

function showWaitState() {
    setCue("wait", "WAIT");
    els.reactionMeterFill.className = "reaction-meter-fill";
    els.reactionMeterFill.style.animationDuration = "";
    setFeedback(`Read first. Keep R2 completely released. ${losRelationshipText()}`, "neutral");
}

function animateReadPhase() {
    if (state.playType === "defense") {
        const fakeDirection = Math.random() < 0.5 ? -1 : 1;
        els.ballCarrier.style.left = `${50 + fakeDirection * 6}%`;
        setManagedTimer("readAnimationTimer", () => {
            if (state.running && state.phase === "read") {
                els.ballCarrier.style.left = "50%";
            }
        }, 260);
        return;
    }

    const movement = state.runConcept === "outside" ? [-2, 1, 2] : [-3, 2, -2];
    els.blockers.forEach((blocker, index) => {
        const base = 28 + index * 22;
        blocker.style.left = `${base + movement[index]}%`;
        blocker.style.transform = "translate(-50%, -50%) scale(1.04)";
    });
    els.runDefenders.forEach((defender, index) => {
        const base = 28 + index * 22;
        defender.style.left = `${base - movement[index] * 0.45}%`;
    });
    els.runLinebackers.forEach((linebacker, index) => {
        const base = 28 + index * 22;
        const lbShift = index === 1 ? 0 : (index === 0 ? 1.5 : -1.5);
        linebacker.style.left = `${base + lbShift}%`;
    });
}

function setDirectionArrow() {
    const x = directionX(state.direction);
    els.directionArrow.style.left = `${x}%`;
    els.directionArrow.classList.add("visible");

    if (state.playType === "defense") {
        els.directionArrow.style.top = "43%";
        els.directionArrow.textContent = "▼";
        if (state.direction === "left") {
            els.directionArrow.style.transform = "translate(-50%, -50%) rotate(45deg)";
        } else if (state.direction === "right") {
            els.directionArrow.style.transform = "translate(-50%, -50%) rotate(-45deg)";
        } else {
            els.directionArrow.style.transform = "translate(-50%, -50%) rotate(0deg)";
        }
        return;
    }

    els.directionArrow.style.top = "23%";
    els.directionArrow.textContent = "▲";
    if (state.direction === "left") {
        els.directionArrow.style.transform = "translate(-50%, -50%) rotate(-45deg)";
    } else if (state.direction === "right") {
        els.directionArrow.style.transform = "translate(-50%, -50%) rotate(45deg)";
    } else {
        els.directionArrow.style.transform = "translate(-50%, -50%) rotate(0deg)";
    }
}

function configureApproachTiming() {
    const difficulty = currentDifficulty();
    state.lineOfScrimmageTop = 44;

    if (state.playType === "defense") {
        state.approachDuration = difficulty.defenseApproach;
        state.burstLineTop = 49;
        els.burstLineLabel.textContent = "R2 CLOSE POINT";
        return;
    }

    if (state.runConcept === "outside" && state.outsideTiming === "open") {
        state.approachDuration = difficulty.outsideOpenApproach;
        state.burstLineTop = 62;
        els.burstLineLabel.textContent = "EDGE SEALED — EARLY R2 POINT";
        return;
    }

    if (state.runConcept === "outside") {
        state.approachDuration = difficulty.outsideDevelopingApproach;
        state.burstLineTop = 49;
        els.burstLineLabel.textContent = "FOLLOW BLOCK — R2 POINT";
        return;
    }

    state.approachDuration = difficulty.insideApproach;
    state.burstLineTop = 52;
    els.burstLineLabel.textContent = "ENTER GAP — R2 POINT";
}

function moveBlockersForDecision() {
    if (state.playType !== "offense" || !state.visionScenario) return;

    const scenario = state.visionScenario;
    els.blockers.forEach((blocker, index) => {
        const base = 28 + index * 22;
        blocker.style.left = `${base + scenario.blockerDx[index]}%`;
        blocker.style.transform = "translate(-50%, -50%) scale(1.08)";
    });

    els.runDefenders.forEach((defender, index) => {
        const base = 28 + index * 22;
        defender.style.left = `${base + scenario.defenderDx[index]}%`;
        defender.style.top = `${39 + scenario.defenderDy[index]}%`;
        defender.style.transform = "translate(-50%, -50%) scale(1.07)";
    });

    els.runLinebackers.forEach((linebacker, index) => {
        const base = 28 + index * 22;
        linebacker.style.left = `${base + scenario.linebackerDxInitial[index]}%`;
        linebacker.style.top = `${28 + scenario.linebackerDyInitial[index]}%`;
        linebacker.style.transform = "translate(-50%, -50%) scale(1.04)";
    });
}

function showSecondLevelFit() {
    if (state.playType !== "offense" || !state.visionScenario || state.readStage !== "press") return;
    const scenario = state.visionScenario;
    state.readStage = "cut";
    state.stageProgress = 0;
    state.wrongLaneHoldMs = 0;

    els.runLinebackers.forEach((linebacker, index) => {
        const base = 28 + index * 22;
        linebacker.style.left = `${base + scenario.linebackerDxFinal[index]}%`;
        linebacker.style.top = `${28 + scenario.linebackerDyFinal[index]}%`;
        linebacker.style.transform = "translate(-50%, -50%) scale(1.10)";
    });

    setCue("aim", state.direction === state.initialDirection ? "STAY?" : "CUT?");
    els.phaseTitle.textContent = state.direction === state.initialDirection
        ? "Second level moved—do you stay?"
        : "Second level overfit—find the cutback";
    els.phaseInstruction.textContent = "Read the linebackers now. Stay on the leverage path if it remains clean, or redirect to the cutback/bounce lane without R2.";
    setFeedback("The first-level read got you here. Now let the linebacker fit decide whether you stay or redirect.", "neutral");
}

function stickLaneChoice(x = state.leftX, y = state.leftY) {
    const movingForward = y <= -STICK_FORWARD_MIN;
    if (!movingForward) return null;
    if (x <= -STICK_SIDE_MIN) return "left";
    if (x >= STICK_SIDE_MIN) return "right";
    if (Math.abs(x) <= STICK_MIDDLE_MAX_X) return "middle";
    return null;
}

function revealCorrectRead() {
    if (state.playType !== "offense") return;
    els.lanes[state.direction]?.classList.add("open");
}

function revealDecision() {
    if (!state.running || state.paused || state.phase !== "read") return;

    state.phase = "approach";
    state.approachProgress = 0;
    state.approachLastAt = performance.now();
    configureApproachTiming();
    if (state.playType === "defense") setDirectionArrow();

    els.lineOfScrimmage.style.top = `${state.lineOfScrimmageTop}%`;
    els.burstLine.style.top = `${state.burstLineTop}%`;
    els.burstLine.classList.add("visible");
    els.burstLine.classList.remove("ready");
    setCue("aim", "STEER");

    const x = directionX(state.direction);
    if (state.playType === "defense") {
        els.ballCarrier.style.left = `${x}%`;
        els.ballCarrier.style.top = "58%";
        els.phaseTitle.textContent = "Runner committed below you—close under control";
        els.phaseInstruction.textContent = `Push ${requiredStickLabel(state.direction)} without R2. Stay above the blue dashed LOS until you close downhill, and sprint only when you reach the close point.`;
        setFeedback("Pursue downward toward the runner. The LOS is a reference in defense too, but wait for the close point before R2.", "neutral");
        return;
    }

    moveBlockersForDecision();
    els.phaseTitle.textContent = "PRESS the leverage—do not sprint";
    els.phaseInstruction.textContent = "Read which shoulder your blocker owns and press that lane first. The linebackers have not made their final fit yet.";
    setFeedback("First-level job: press the lane created by blocker leverage. Stay off R2 and make the linebackers declare themselves.", "neutral");
}

function updateApproachVisual() {
    if (state.playType === "defense") {
        const progress = easeOut(state.approachProgress);
        const targetX = directionX(state.direction);
        els.defender.style.left = `${lerp(50, targetX, progress)}%`;
        els.defender.style.top = `${lerp(30, state.burstLineTop, progress)}%`;
        return;
    }

    const target = state.readStage === "press" ? state.initialDirection : state.direction;
    const targetX = directionX(target);
    const t = easeOut(state.stageProgress);
    if (state.readStage === "press") {
        els.runner.style.left = `${lerp(50, targetX, t)}%`;
        els.runner.style.top = `${lerp(72, 58, t)}%`;
    } else {
        const startX = directionX(state.initialDirection);
        els.runner.style.left = `${lerp(startX, targetX, t)}%`;
        els.runner.style.top = `${lerp(58, state.burstLineTop, t)}%`;
    }
}

function advanceApproach(now) {
    if (!state.running || state.paused || state.phase !== "approach") return;

    const elapsed = clamp(now - state.approachLastAt, 0, 50);
    state.approachLastAt = now;

    if (state.playType === "offense") {
        const choice = stickLaneChoice();
        if (!choice) {
            state.wrongLaneHoldMs = 0;
            return;
        }

        if (state.readStage === "press") {
            if (state.initialChoice === null) {
                state.initialChoice = choice;
                state.leverageAttempts += 1;
                state.visionAttempts += 1;
                if (choice === state.initialDirection) {
                    state.leverageCorrect += 1;
                    state.visionCorrect += 1;
                }
                updateScoreboard();
            }

            if (choice !== state.initialDirection) {
                state.wrongLaneHoldMs += elapsed;
                if (state.wrongLaneHoldMs >= 280) {
                    state.missedStage = "leverage";
                    finishPlay("wrong_direction");
                }
                return;
            }

            state.wrongLaneHoldMs = 0;
            state.stageProgress = clamp(state.stageProgress + elapsed / (state.approachDuration * 0.58), 0, 1);
            updateApproachVisual();
            if (state.stageProgress >= 1) showSecondLevelFit();
            return;
        }

        if (state.finalChoice === null) {
            state.finalChoice = choice;
            state.visionChoice = choice;
            state.cutbackAttempts += 1;
            if (choice === state.direction) state.cutbackCorrect += 1;
            updateScoreboard();
        }

        if (choice !== state.direction) {
            state.wrongLaneHoldMs += elapsed;
            if (state.wrongLaneHoldMs >= 280) {
                state.missedStage = "cutback";
                revealCorrectRead();
                finishPlay("wrong_direction");
            }
            return;
        }

        state.wrongLaneHoldMs = 0;
        state.stageProgress = clamp(state.stageProgress + elapsed / (state.approachDuration * 0.68), 0, 1);
        updateApproachVisual();
        if (state.stageProgress >= 1) showBurstCue();
        return;
    }

    if (stickMatchesTarget(state.direction)) {
        state.approachProgress = clamp(
            state.approachProgress + elapsed / state.approachDuration,
            0,
            1
        );
        updateApproachVisual();
    }

    if (state.approachProgress >= 1) showBurstCue();
}

function startReactionMeter() {
    const windowMs = currentDifficulty().reactionWindow;
    els.reactionMeterFill.style.animationPlayState = "running";
    els.reactionMeterFill.className = "reaction-meter-fill";
    void els.reactionMeterFill.offsetWidth;
    els.reactionMeterFill.style.animationDuration = `${windowMs}ms`;
    els.reactionMeterFill.classList.add("running");
}

function showBurstCue() {
    if (!state.running || state.paused || state.phase !== "approach") return;

    state.phase = "burst";
    state.cueAt = performance.now();
    els.burstLine.classList.add("ready");
    setCue("go", "R2 NOW");
    startReactionMeter();

    if (state.playType === "defense") {
        els.phaseTitle.textContent = "Close now!";
        els.phaseInstruction.textContent = `Keep ${requiredStickLabel(state.direction)} and press R2 through the runner.`;
        setFeedback("You reached the close point—accelerate now.", "neutral");
    } else if (state.runConcept === "outside" && state.outsideTiming === "open") {
        els.phaseTitle.textContent = "Edge won—accelerate!";
        els.phaseInstruction.textContent = `Keep ${requiredStickLabel(state.direction)} and press R2 now.`;
        setFeedback("The clean edge justified an earlier R2 burst.", "neutral");
    } else {
        els.phaseTitle.textContent = "You reached the burst point!";
        els.phaseInstruction.textContent = `Keep ${requiredStickLabel(state.direction)} and press R2 now.`;
        setFeedback("Now accelerate through the opening.", "neutral");
    }

    setManagedTimer("lateTimer", () => finishPlay("late"), currentDifficulty().reactionWindow);
}

function beginReadPhase() {
    if (!state.running || state.paused) return;

    configurePlaySelection();
    state.phase = "read";
    state.approachProgress = 0;
    configureFieldForPlay();
    showWaitState();
    animateReadPhase();

    const difficulty = currentDifficulty();
    const cueDelay = randomBetween(difficulty.readMin, difficulty.readMax);
    setManagedTimer("cueTimer", revealDecision, cueDelay);
}

function waitForR2ReleaseThenBegin() {
    if (!state.running || state.paused) return;

    state.phase = "waiting_release";
    configurePlaySelection();
    configureFieldForPlay();
    setCue("wait", "RELEASE");
    els.phaseTitle.textContent = "Release R2";
    els.phaseInstruction.textContent = "Each repetition begins only after the trigger is fully released.";
    setFeedback("Release R2, then prepare to read the play.", "neutral");

    const checkRelease = () => {
        if (!state.running || state.paused || state.phase !== "waiting_release") return;
        if (!state.r2Down) {
            setManagedTimer("nextTimer", beginReadPhase, 350);
            return;
        }
        setManagedTimer("nextTimer", checkRelease, 80);
    };
    checkRelease();
}

function runCountdown() {
    state.phase = "countdown";
    els.countdown.classList.remove("hidden");
    let value = 3;
    els.countdown.textContent = String(value);
    setCue("wait", "READY");
    setFeedback("Get ready. Keep R2 released.", "neutral");

    const tick = () => {
        if (!state.running || state.paused) return;
        value -= 1;
        if (value > 0) {
            els.countdown.textContent = String(value);
            setManagedTimer("countdownTimer", tick, 650);
            return;
        }

        els.countdown.textContent = "GO";
        setManagedTimer("countdownTimer", () => {
            els.countdown.classList.add("hidden");
            waitForR2ReleaseThenBegin();
        }, 500);
    };

    setManagedTimer("countdownTimer", tick, 650);
}

function wrongDirectionMessage() {
    if (state.playType === "offense" && state.visionScenario) {
        if (state.missedStage === "leverage") {
            return `Leverage miss: you pressed ${state.initialChoice || stickLaneChoice() || "the wrong lane"}, but the first-level leverage called for ${state.initialDirection}. Press the block first, then make the linebackers commit.`;
        }
        const chosen = state.finalChoice || state.visionChoice || stickLaneChoice() || describeStickDirection();
        return `Second-level miss: you chose ${chosen}, but the linebacker fit made ${state.direction} the best answer. ${state.visionScenario.coaching}`;
    }
    const actual = describeStickDirection();
    const required = requiredStickLabel(state.direction);
    return `Wrong lane/angle. Your timing was green, but the stick was ${actual}. Hold ${required} with R2.`;
}

function earlyMessage(phaseAtResult) {
    if (phaseAtResult === "approach") {
        return "Too early. You saw a lane, but you burst before you were through the traffic picture.";
    }
    return "Too early. You pressed R2 before the play declared the lane or pursuit angle.";
}

function finishPlay(result, reactionMs = null) {
    if (!state.running || state.paused || !["read", "approach", "burst"].includes(state.phase)) return;

    const phaseAtResult = state.phase;
    clearManagedTimer("cueTimer");
    clearManagedTimer("lateTimer");
    state.phase = "feedback";
    state.playsCompleted += 1;
    els.reactionMeterFill.className = "reaction-meter-fill";

    if (result === "perfect") {
        const reaction = Math.max(0, Math.round(reactionMs ?? 0));
        state.perfect += 1;
        state.streak += 1;
        state.bestStreak = Math.max(state.bestStreak, state.streak);
        state.reactions.push(reaction);
        setCue("go", "PERFECT");
        if (state.playType === "offense") revealCorrectRead();
        const visionText = state.playType === "offense" && state.visionScenario
            ? ` ${state.visionScenario.label}.`
            : "";
        const readText = state.playType === "offense"
            ? ` Leverage: ${state.initialDirection}. Second level: ${state.direction}.`
            : "";
        setFeedback(`Perfect—read leverage, read the fit, then R2 in ${reaction} ms.${visionText}${readText}`.trim(), "perfect");
        playSound(perfectSound);

        const x = directionX(state.direction);
        if (state.playType === "offense") {
            els.runner.style.left = `${x}%`;
            els.runner.style.top = "27%";
        } else {
            els.defender.style.left = `${x}%`;
            els.defender.style.top = "58%";
        }
    } else if (result === "early") {
        state.early += 1;
        state.streak = 0;
        if (state.playType === "offense") revealCorrectRead();
        setCue("bad", "TOO EARLY");
        setFeedback(earlyMessage(phaseAtResult), "early");
        playSound(wrongSound);
    } else if (result === "wrong_direction") {
        state.wrongDirection += 1;
        state.streak = 0;
        setCue("bad", "WRONG LANE");
        setFeedback(wrongDirectionMessage(), "wrong-direction");
        playSound(wrongSound);
    } else {
        state.late += 1;
        state.streak = 0;
        if (state.playType === "offense") revealCorrectRead();
        setCue("bad", "TOO LATE");
        setFeedback("Too late. You reached the burst point and the green window expired.", "late");
        playSound(wrongSound);
    }

    updateScoreboard();

    if (state.targetPlays !== null && state.playsCompleted >= state.targetPlays) {
        setManagedTimer("nextTimer", finishSession, 1150);
    } else {
        setManagedTimer("nextTimer", waitForR2ReleaseThenBegin, 1200);
    }
}

function finishSession() {
    clearTimers();
    state.running = false;
    state.paused = false;
    state.pauseStartedAt = 0;
    els.reactionMeterFill.style.animationPlayState = "running";

    if (window.WurdPracticeControls?.isPaused()) {
        window.WurdPracticeControls.setPaused(false);
    }
    state.phase = "finished";
    els.startBtn.textContent = "Start Again";
    setCue("go", "FINISHED");

    const attempts = state.perfect + state.early + state.late + state.wrongDirection;
    const discipline = attempts ? Math.round((state.perfect / attempts) * 100) : 100;
    const average = state.reactions.length
        ? Math.round(state.reactions.reduce((sum, value) => sum + value, 0) / state.reactions.length)
        : null;
    const vision = state.visionAttempts ? Math.round((state.visionCorrect / state.visionAttempts) * 100) : 100;
    const leverage = state.leverageAttempts ? Math.round((state.leverageCorrect / state.leverageAttempts) * 100) : 100;
    const cutback = state.cutbackAttempts ? Math.round((state.cutbackCorrect / state.cutbackAttempts) * 100) : 100;

    els.phaseTitle.textContent = "Practice complete";
    els.phaseInstruction.textContent = "Take the same press → leverage → linebacker fit → stay/cut → burst sequence into Madden.";
    setFeedback(
        `Finished: ${leverage}% leverage, ${cutback}% second-level reads, ${discipline}% complete reps, best streak ${state.bestStreak}.`,
        discipline >= 80 ? "perfect" : "neutral"
    );

    postResult({
        mode: els.inputMode.value,
        drillType: els.drillType.value,
        runRead: els.runRead.value,
        difficulty: els.difficulty.value,
        drillLength: els.drillLength.value,
        plays: attempts,
        perfect: state.perfect,
        early: state.early,
        late: state.late,
        wrongDirection: state.wrongDirection,
        visionAttempts: state.visionAttempts,
        visionCorrect: state.visionCorrect,
        vision,
        leverageAttempts: state.leverageAttempts,
        leverageCorrect: state.leverageCorrect,
        leverage,
        cutbackAttempts: state.cutbackAttempts,
        cutbackCorrect: state.cutbackCorrect,
        cutback,
        discipline,
        averageReaction: average,
        bestStreak: state.bestStreak
    });
}

function startPractice() {
    state.paused = false;
    state.pauseStartedAt = 0;

    if (window.WurdPracticeControls?.isPaused()) {
        window.WurdPracticeControls.setPaused(false);
    }

    clearTimers();
    els.reactionMeterFill.style.animationPlayState = "running";
    state.running = true;
    state.phase = "starting";
    state.targetPlays = els.drillLength.value === "free" ? null : Number(els.drillLength.value);
    resetStats();
    resetFieldVisuals();
    updateReactionWindowLabel();

    els.gameArea.classList.remove("hidden");
    els.startBtn.textContent = "Restart Practice";
    setFeedback("Starting leverage + cutback practice...", "neutral");

    void fetch("/api/r2-practice-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            mode: els.inputMode.value,
            drillType: els.drillType.value,
            runRead: els.runRead.value,
            difficulty: els.difficulty.value,
            drillLength: els.drillLength.value
        })
    }).catch(() => {});

    runCountdown();
}

function postResult(payload) {
    void fetch("/api/r2-practice-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
    }).catch(() => {});
}

function onR2Pressed() {
    if (!state.running || state.paused) return;

    if (state.phase === "read" || state.phase === "approach") {
        finishPlay("early");
    } else if (state.phase === "burst") {
        const reaction = performance.now() - state.cueAt;
        if (stickMatchesTarget(state.direction)) {
            finishPlay("perfect", reaction);
        } else {
            finishPlay("wrong_direction", reaction);
        }
    }
}

function renderR2State() {
    els.r2Status.textContent = state.r2Down ? "R2: pressed" : "R2: released";
    els.r2Status.classList.toggle("active", state.r2Down);
    els.r2TestButton.classList.toggle("pressed", state.r2Down);
}

function syncHeldR2WithoutAction() {
    const pad = findActiveGamepad();
    const button = pad?.buttons[R2_BUTTON_INDEX];
    const triggerValue = button
        ? Math.max(button.value || 0, button.pressed ? 1 : 0)
        : 0;

    state.r2Down = triggerValue >= R2_THRESHOLD;
    renderR2State();
}

function updateR2State(isDown) {
    const wasDown = state.r2Down;
    state.r2Down = Boolean(isDown);
    renderR2State();

    if (!state.paused && state.r2Down && !wasDown) {
        onR2Pressed();
    }
}

function applyLeftStick(x, y) {
    state.leftX = Math.abs(x) < LEFT_STICK_DEADZONE ? 0 : clamp(x, -1, 1);
    state.leftY = Math.abs(y) < LEFT_STICK_DEADZONE ? 0 : clamp(y, -1, 1);
    els.leftStickStatus.textContent = `Left stick: ${describeStickDirection()}`;

    if (!state.running || state.phase !== "read") return;

    const xOffset = state.leftX * 8;
    const yOffset = state.leftY * 3;
    if (state.playType === "offense") {
        els.runner.style.left = `${50 + xOffset}%`;
        els.runner.style.top = `${72 + yOffset}%`;
    } else {
        els.defender.style.left = `${50 + xOffset}%`;
        els.defender.style.top = `${30 + yOffset}%`;
    }
}

function findActiveGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (!pads) return null;

    if (state.lastControllerIndex !== null && pads[state.lastControllerIndex]) {
        return pads[state.lastControllerIndex];
    }

    for (const pad of pads) {
        if (pad && pad.connected) {
            state.lastControllerIndex = pad.index;
            return pad;
        }
    }
    return null;
}

function pollController(now) {
    if (state.paused) {
        state.animationFrame = requestAnimationFrame(pollController);
        return;
    }

    const controllerMode = els.inputMode.value !== "keyboard";

    if (controllerMode) {
        const pad = findActiveGamepad();
        if (pad) {
            const mappingText = pad.mapping === "standard" ? "standard mapping" : "browser mapping";
            els.controllerStatus.textContent = `Connected: ${pad.id.split("(")[0].trim()} · ${mappingText}`;
            els.controllerStatus.classList.add("connected");

            // Return to the WURD homepage when the browser exposes the
            // DualSense PS/Home button as standard Gamepad button 16.
            const psHomePressed = Boolean(pad.buttons[PS_HOME_BUTTON_INDEX]?.pressed);

            if (psHomePressed && !state.psHomeDown) {
                window.location.assign(WURD_HOME_URL);
                return;
            }

            state.psHomeDown = psHomePressed;

            const x = Number.isFinite(pad.axes[0]) ? pad.axes[0] : 0;
            const y = Number.isFinite(pad.axes[1]) ? pad.axes[1] : 0;
            applyLeftStick(x, y);
            advanceApproach(now);

            const button = pad.buttons[R2_BUTTON_INDEX];
            const triggerValue = button ? Math.max(button.value || 0, button.pressed ? 1 : 0) : 0;
            updateR2State(triggerValue >= R2_THRESHOLD || state.pointerR2Down);
        } else {
            state.psHomeDown = false;
            els.controllerStatus.textContent = "Waiting for controller—press a controller button.";
            els.controllerStatus.classList.remove("connected");
            applyLeftStick(0, 0);
            advanceApproach(now);
            updateR2State(state.pointerR2Down);
        }
    } else {
        state.psHomeDown = false;
        els.controllerStatus.textContent = "Keyboard test mode";
        els.controllerStatus.classList.add("connected");
        applyLeftStick(keyboardAxisX(), keyboardAxisY());
        advanceApproach(now);
        updateR2State(state.keyboardR2Down || state.pointerR2Down);
    }

    state.animationFrame = requestAnimationFrame(pollController);
}

const keysDown = new Set();

function keyboardAxisX() {
    const left = keysDown.has("ArrowLeft") || keysDown.has("KeyA");
    const right = keysDown.has("ArrowRight") || keysDown.has("KeyD");
    return (right ? 1 : 0) - (left ? 1 : 0);
}

function keyboardAxisY() {
    const up = keysDown.has("ArrowUp") || keysDown.has("KeyW");
    const down = keysDown.has("ArrowDown") || keysDown.has("KeyS");
    return (down ? 1 : 0) - (up ? 1 : 0);
}

function isR2KeyboardCode(code) {
    return code === "Space" || code === "ShiftLeft" || code === "ShiftRight";
}

window.addEventListener("keydown", (event) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
        event.preventDefault();
    }

    if (state.paused) return;

    keysDown.add(event.code);
    if (isR2KeyboardCode(event.code)) {
        state.keyboardR2Down = true;
    }
});

window.addEventListener("keyup", (event) => {
    if (state.paused) return;

    keysDown.delete(event.code);
    if (isR2KeyboardCode(event.code)) {
        state.keyboardR2Down = false;
    }
});

window.addEventListener("blur", () => {
    keysDown.clear();
    state.keyboardR2Down = false;
    state.pointerR2Down = false;
});

window.addEventListener("gamepadconnected", (event) => {
    state.lastControllerIndex = event.gamepad.index;
    els.controllerStatus.textContent = `Connected: ${event.gamepad.id.split("(")[0].trim()}`;
    els.controllerStatus.classList.add("connected");
});

window.addEventListener("gamepaddisconnected", (event) => {
    if (state.lastControllerIndex === event.gamepad.index) {
        state.lastControllerIndex = null;
    }
    els.controllerStatus.textContent = "Controller disconnected.";
    els.controllerStatus.classList.remove("connected");
});

els.r2TestButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (state.paused) return;

    state.pointerR2Down = true;
    els.r2TestButton.setPointerCapture?.(event.pointerId);
});

function releasePointerR2() {
    state.pointerR2Down = false;
}

els.r2TestButton.addEventListener("pointerup", releasePointerR2);
els.r2TestButton.addEventListener("pointercancel", releasePointerR2);
els.r2TestButton.addEventListener("lostpointercapture", releasePointerR2);

// Universal WURD practice controls:
// D-pad Up starts or restarts this practice.
window.addEventListener("wurd:practice-start", () => {
    startPractice();
});

// D-pad Down pauses or resumes this practice.
window.addEventListener("wurd:practice-pause", (event) => {
    if (!state.running || state.phase === "finished") {
        state.paused = false;

        if (window.WurdPracticeControls?.isPaused()) {
            window.WurdPracticeControls.setPaused(false);
        }
        return;
    }

    const shouldPause = Boolean(event.detail?.paused);

    if (shouldPause === state.paused) return;

    if (shouldPause) {
        state.paused = true;
        state.pauseStartedAt = performance.now();
        pauseManagedTimers();

        els.reactionMeterFill.style.animationPlayState = "paused";
        keysDown.clear();
        state.keyboardR2Down = false;
        state.pointerR2Down = false;
        syncHeldR2WithoutAction();
        return;
    }

    const pausedFor = Number(event.detail?.pausedFor) ||
        Math.max(0, performance.now() - state.pauseStartedAt);

    state.paused = false;
    state.pauseStartedAt = 0;

    // Keep approach and reaction timing exactly where they were.
    state.approachLastAt = performance.now();

    if (state.phase === "burst" && state.cueAt) {
        state.cueAt += pausedFor;
    }

    syncHeldR2WithoutAction();
    els.reactionMeterFill.style.animationPlayState = "running";
    resumeManagedTimers();
});

els.startBtn.addEventListener("click", startPractice);
els.difficulty.addEventListener("change", updateReactionWindowLabel);
els.drillType.addEventListener("change", updateRunReadAvailability);
els.inputMode.addEventListener("change", () => {
    els.keyboardHelp.classList.toggle("hidden", els.inputMode.value !== "keyboard");
});

updateReactionWindowLabel();
updateRunReadAvailability();
updateScoreboard();
state.animationFrame = requestAnimationFrame(pollController);
