// WURD R2 Discipline Practice v7 — LOS reference moved above offensive line
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

    els.perfectCount.textContent = String(state.perfect);
    els.earlyCount.textContent = String(state.early);
    els.lateCount.textContent = String(state.late);
    els.wrongDirectionCount.textContent = String(state.wrongDirection);
    els.disciplinePercent.textContent = `${discipline}%`;
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

function configurePlaySelection() {
    state.playType = choosePlayType();
    state.outsideTiming = null;

    if (state.playType === "defense") {
        state.runConcept = "defense";
        state.direction = randomItem(DIRECTIONS);
        return;
    }

    state.runConcept = chooseOffenseConcept();
    if (state.runConcept === "outside") {
        state.direction = randomItem(OUTSIDE_DIRECTIONS);
        state.outsideTiming = Math.random() < 0.48 ? "open" : "developing";
    } else {
        state.direction = randomItem(DIRECTIONS);
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
}

function configureFieldForPlay() {
    resetFieldVisuals();

    if (state.playType === "defense") {
        els.playBadge.textContent = "DEFENSE";
        els.playBadge.className = "play-badge defense";
        els.runner.classList.add("hidden");
        els.blockers.forEach((blocker) => blocker.classList.add("hidden"));
        els.defender.classList.remove("hidden");
        els.ballCarrier.classList.remove("hidden");
        els.phaseTitle.textContent = "Stay square at the top and read";
        els.phaseInstruction.textContent = "The runner is below you. Stay above the LOS, keep R2 released, then close downward only after he commits.";
        return;
    }

    els.runner.classList.remove("hidden");
    els.blockers.forEach((blocker) => blocker.classList.remove("hidden"));
    els.defender.classList.add("hidden");
    els.ballCarrier.classList.add("hidden");

    if (state.runConcept === "outside") {
        const timingText = state.outsideTiming === "open" ? "EDGE SEALED" : "EDGE DEVELOPING";
        els.playBadge.textContent = `OUTSIDE • ${timingText}`;
        els.playBadge.className = state.outsideTiming === "open"
            ? "play-badge outside-open"
            : "play-badge outside-developing";
        els.phaseTitle.textContent = "Read the outside block";
        els.phaseInstruction.textContent = "Do not sprint merely because the play is outside. Read whether the edge is already sealed.";
    } else {
        els.playBadge.textContent = "OFFENSE • INSIDE";
        els.playBadge.className = "play-badge inside";
        els.phaseTitle.textContent = "Read the inside blocks";
        els.phaseInstruction.textContent = "Stay patient behind the line and wait for a gap to declare itself.";
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
    if (state.playType !== "offense") return;

    const blockerIndex = state.direction === "left" ? 0 : state.direction === "middle" ? 1 : 2;
    const selectedBlocker = els.blockers[blockerIndex];

    if (state.runConcept === "outside") {
        const sealOffset = state.direction === "left" ? 10 : -10;
        selectedBlocker.style.left = `${directionX(state.direction) + sealOffset}%`;
        selectedBlocker.style.transform = "translate(-50%, -50%) scale(1.08)";
        return;
    }

    const gapOffset = state.direction === "left" ? -9 : state.direction === "right" ? 9 : 8;
    selectedBlocker.style.left = `${directionX(state.direction) + gapOffset}%`;
    selectedBlocker.style.transform = "translate(-50%, -50%) scale(1.08)";
}

function revealDecision() {
    if (!state.running || state.paused || state.phase !== "read") return;

    state.phase = "approach";
    state.approachProgress = 0;
    state.approachLastAt = performance.now();
    configureApproachTiming();
    setDirectionArrow();

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

    els.lanes[state.direction].classList.add("open");
    moveBlockersForDecision();

    if (state.runConcept === "outside" && state.outsideTiming === "open") {
        els.phaseTitle.textContent = "The edge is already sealed";
        els.phaseInstruction.textContent = `Push ${requiredStickLabel(state.direction)}. The blue dashed LOS is your reference; this clean edge gives you an earlier burst point.`;
        setFeedback("The edge is clean. You may burst before or near the LOS here—but still steer first and do not mash R2 from the handoff.", "neutral");
    } else if (state.runConcept === "outside") {
        els.phaseTitle.textContent = "The outside block is developing";
        els.phaseInstruction.textContent = `Push ${requiredStickLabel(state.direction)} and follow the block. The blue dashed LOS helps show when you are still behind it. Keep R2 released until the later burst point.`;
        setFeedback("Stay patient and follow the blocker before accelerating. Use the LOS as a guide, not an automatic sprint signal.", "neutral");
    } else {
        els.phaseTitle.textContent = "The inside lane opened";
        els.phaseInstruction.textContent = `Push ${requiredStickLabel(state.direction)} and enter the gap without R2. The blue dashed LOS helps show when you are approaching the hole. Accelerate at the burst point.`;
        setFeedback("Enter the opening under control. If you are still behind the LOS, R2 is usually still too early.", "neutral");
    }
}

function updateApproachVisual() {
    const progress = easeOut(state.approachProgress);
    const targetX = directionX(state.direction);

    if (state.playType === "defense") {
        els.defender.style.left = `${lerp(50, targetX, progress)}%`;
        els.defender.style.top = `${lerp(30, state.burstLineTop, progress)}%`;
    } else {
        els.runner.style.left = `${lerp(50, targetX, progress)}%`;
        els.runner.style.top = `${lerp(72, state.burstLineTop, progress)}%`;
    }
}

function advanceApproach(now) {
    if (!state.running || state.paused || state.phase !== "approach") return;

    const elapsed = clamp(now - state.approachLastAt, 0, 50);
    state.approachLastAt = now;

    if (stickMatchesTarget(state.direction)) {
        state.approachProgress = clamp(
            state.approachProgress + elapsed / state.approachDuration,
            0,
            1
        );
        updateApproachVisual();
    }

    if (state.approachProgress >= 1) {
        showBurstCue();
    }
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
    const actual = describeStickDirection();
    const required = requiredStickLabel(state.direction);
    return `Wrong lane/angle. Your timing was green, but the stick was ${actual}. Hold ${required} with R2.`;
}

function earlyMessage(phaseAtResult) {
    if (phaseAtResult === "approach") {
        return "Too early. The lane was chosen, but you had not reached the burst point yet.";
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
        setFeedback(`Perfect—steer first, then R2 at the burst point in ${reaction} ms.`, "perfect");
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

    els.phaseTitle.textContent = "Practice complete";
    els.phaseInstruction.textContent = "Take the same read → steer → burst sequence into Madden practice mode.";
    setFeedback(
        `Finished: ${discipline}% complete reps, ${state.early} early, ${state.wrongDirection} wrong lane, best streak ${state.bestStreak}.`,
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
    setFeedback("Starting burst-point practice...", "neutral");

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
