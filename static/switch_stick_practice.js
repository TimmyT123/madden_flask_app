"use strict";

const modeSelect = document.getElementById("modeSelect");
const reactionWindowSelect = document.getElementById("reactionWindowSelect");
const drillLengthSelect = document.getElementById("drillLengthSelect");
const startBtn = document.getElementById("startBtn");
const gameArea = document.getElementById("gameArea");
const footballField = document.getElementById("footballField");
const defenderLayer = document.getElementById("defenderLayer");
const feedback = document.getElementById("feedback");
const controllerStatus = document.getElementById("controllerStatus");
const stickStatus = document.getElementById("stickStatus");
const stickDot = document.getElementById("stickDot");
const flickDetails = document.getElementById("flickDetails");
const flickArrow = document.getElementById("flickArrow");

const scoreEl = document.getElementById("score");
const attemptsEl = document.getElementById("attempts");
const accuracyEl = document.getElementById("accuracy");
const averageReactionEl = document.getElementById("averageReaction");
const streakEl = document.getElementById("streak");
const bestStreakEl = document.getElementById("bestStreak");

const perfectSound = new Audio("/static/sounds/perfect.mp3");
perfectSound.volume = 0.6;

const wrongSound = new Audio("/static/sounds/wrong.mp3");
wrongSound.volume = 0.5;

// Standard browser Gamepad mapping for both DualSense and Xbox controllers.
const RIGHT_STICK_X_AXIS = 2;
const RIGHT_STICK_Y_AXIS = 3;
const NEUTRAL_THRESHOLD = 0.30;
const FLICK_THRESHOLD = 0.72;
const MIN_DIRECTION_MAGNITUDE = 0.35;

const ROUND_FEEDBACK_MS = 800;
const NEXT_TARGET_DELAY_MS = 220;

const defenders = [
    { id: "FS", role: "FS", x: 50, y: 16 },
    { id: "SS", role: "SS", x: 72, y: 27 },
    { id: "LCB", role: "LCB", x: 14, y: 31 },
    { id: "RCB", role: "RCB", x: 86, y: 31 },
    { id: "NICKEL", role: "NICKEL", x: 28, y: 49 },
    { id: "MLB", role: "MLB", x: 50, y: 61 },
    { id: "OLB", role: "OLB", x: 72, y: 49 },
];

let gameRunning = false;
let drillComplete = false;
let roundLocked = true;
let waitingForNeutral = true;
let animationId = null;
let roundTimeoutId = null;
let nextRoundTimerId = null;
let countdownTimerIds = [];
let startSequenceId = 0;

let activeGamepadIndex = null;
let currentControlledId = "MLB";
let targetDefenderId = null;
let selectedDefenderId = null;
let lastTargetDefenderId = null;
let roundStartedAt = 0;
let reactionWindowMs = 0;
let drillLength = "free";

let score = 0;
let attempts = 0;
let streak = 0;
let bestStreak = 0;
let totalReactionMs = 0;
let measuredReactionCount = 0;

startBtn.addEventListener("click", startGame);
modeSelect.addEventListener("change", updateModeHelp);

window.addEventListener("gamepadconnected", function(event) {
    activeGamepadIndex = event.gamepad.index;
    showControllerConnected(event.gamepad);
});

window.addEventListener("gamepaddisconnected", function(event) {
    if (activeGamepadIndex === event.gamepad.index) {
        activeGamepadIndex = null;
    }

    controllerStatus.textContent = "Controller disconnected.";
    controllerStatus.classList.remove("connected");
});

document.addEventListener("keydown", function(event) {
    if (!gameRunning || drillComplete || modeSelect.value !== "keyboard") return;
    if (event.repeat) return;

    const vector = keyboardVectorForKey(event.key);
    if (!vector) return;

    event.preventDefault();
    updateStickMonitor(vector.x, vector.y);

    if (!roundLocked) {
        processFlick(vector.x, vector.y);
    }
});

document.addEventListener("keyup", function(event) {
    if (modeSelect.value !== "keyboard") return;
    if (!keyboardVectorForKey(event.key)) return;

    updateStickMonitor(0, 0);
    waitingForNeutral = false;
});

function startGame() {
    const thisStartSequence = ++startSequenceId;

    clearAllTimers();
    stopAnimationLoop();

    gameRunning = false;
    drillComplete = false;
    roundLocked = true;
    waitingForNeutral = true;

    reactionWindowMs = parseInt(reactionWindowSelect.value, 10) || 0;
    drillLength = drillLengthSelect.value;

    score = 0;
    attempts = 0;
    streak = 0;
    bestStreak = 0;
    totalReactionMs = 0;
    measuredReactionCount = 0;

    currentControlledId = "MLB";
    targetDefenderId = null;
    selectedDefenderId = null;
    lastTargetDefenderId = null;

    updateScoreboard();
    hideFlickArrow();
    renderDefenders();
    updateStickMonitor(0, 0);

    gameArea.classList.remove("hidden");
    startBtn.disabled = true;
    startBtn.textContent = "Starting...";
    setFeedback("Starting in 3...", "info");

    logPracticeStart();

    countdownTimerIds.push(setTimeout(() => {
        if (thisStartSequence !== startSequenceId) return;
        setFeedback("Starting in 2...", "info");
    }, 1000));

    countdownTimerIds.push(setTimeout(() => {
        if (thisStartSequence !== startSequenceId) return;
        setFeedback("Starting in 1...", "info");
    }, 2000));

    countdownTimerIds.push(setTimeout(() => {
        if (thisStartSequence !== startSequenceId) return;

        gameRunning = true;
        startBtn.disabled = false;
        startBtn.textContent = "Restart Practice";
        startAnimationLoop();
        beginNextRound();
    }, 3000));
}

function beginNextRound() {
    if (!gameRunning || drillComplete) return;

    clearRoundTimer();
    hideFlickArrow();
    selectedDefenderId = null;
    roundLocked = false;
    waitingForNeutral = true;

    const candidates = getGoodTargetCandidates();
    const target = chooseRandomTarget(candidates);

    targetDefenderId = target.id;
    lastTargetDefenderId = target.id;
    roundStartedAt = performance.now();

    renderDefenders();
    setFeedback("Flick toward the pulsing defender!", "info");
    flickDetails.textContent = "Center the right stick, then make one quick flick.";

    if (reactionWindowMs > 0) {
        roundTimeoutId = setTimeout(handleReactionTimeout, reactionWindowMs);
    }
}

function getGoodTargetCandidates() {
    const current = getDefender(currentControlledId);
    const available = defenders.filter(defender => defender.id !== currentControlledId);

    // Prefer targets with at least 12 degrees of separation from every other
    // eligible defender. This reduces unfairly ambiguous practice targets.
    const separated = available.filter(candidate => {
        const candidateAngle = angleFromTo(current, candidate);

        const nearestOtherAngle = Math.min(...available
            .filter(other => other.id !== candidate.id)
            .map(other => angularDifferenceDegrees(candidateAngle, angleFromTo(current, other))));

        return nearestOtherAngle >= 12;
    });

    return separated.length >= 2 ? separated : available;
}

function chooseRandomTarget(candidates) {
    let pool = candidates;

    if (pool.length > 1 && lastTargetDefenderId) {
        const withoutRepeat = pool.filter(defender => defender.id !== lastTargetDefenderId);
        if (withoutRepeat.length > 0) pool = withoutRepeat;
    }

    return pool[Math.floor(Math.random() * pool.length)];
}

function startAnimationLoop() {
    stopAnimationLoop();

    const loop = () => {
        if (!gameRunning) return;

        checkControllerInput();
        animationId = requestAnimationFrame(loop);
    };

    animationId = requestAnimationFrame(loop);
}

function stopAnimationLoop() {
    if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
}

function checkControllerInput() {
    if (!modeSelect.value.startsWith("controller")) return;

    const gamepad = getActiveGamepad();
    if (!gamepad) {
        controllerStatus.textContent = "No controller detected.";
        controllerStatus.classList.remove("connected");
        return;
    }

    showControllerConnected(gamepad);

    const rawX = gamepad.axes[RIGHT_STICK_X_AXIS] || 0;
    const rawY = gamepad.axes[RIGHT_STICK_Y_AXIS] || 0;
    const vector = applyRadialDeadzone(rawX, rawY, 0.10);
    const magnitude = Math.hypot(vector.x, vector.y);

    updateStickMonitor(vector.x, vector.y);

    if (magnitude <= NEUTRAL_THRESHOLD) {
        waitingForNeutral = false;
        stickStatus.textContent = "Right stick: centered and ready";
        return;
    }

    if (waitingForNeutral || roundLocked || drillComplete) {
        stickStatus.textContent = waitingForNeutral
            ? "Right stick: return to center"
            : "Right stick: flick detected";
        return;
    }

    if (magnitude >= FLICK_THRESHOLD) {
        waitingForNeutral = true;
        processFlick(vector.x, vector.y);
    }
}

function getActiveGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

    if (activeGamepadIndex !== null && gamepads[activeGamepadIndex]) {
        return gamepads[activeGamepadIndex];
    }

    for (const gamepad of gamepads) {
        if (gamepad) {
            activeGamepadIndex = gamepad.index;
            return gamepad;
        }
    }

    return null;
}

function processFlick(rawX, rawY) {
    if (!gameRunning || drillComplete || roundLocked || !targetDefenderId) return;

    const magnitude = Math.hypot(rawX, rawY);
    if (magnitude < MIN_DIRECTION_MAGNITUDE) return;

    roundLocked = true;
    clearRoundTimer();

    const direction = {
        x: rawX / magnitude,
        y: rawY / magnitude,
    };

    const reactionMs = Math.round(performance.now() - roundStartedAt);
    const selected = chooseDefenderFromDirection(direction.x, direction.y);
    const target = getDefender(targetDefenderId);
    const current = getDefender(currentControlledId);

    selectedDefenderId = selected ? selected.id : null;
    attempts++;
    totalReactionMs += reactionMs;
    measuredReactionCount++;

    const targetVector = normalizeVector(target.x - current.x, target.y - current.y);
    const angleError = Math.round(vectorAngleDifferenceDegrees(direction, targetVector));
    const isCorrect = Boolean(selected && selected.id === target.id);

    showFlickArrow(current, direction, isCorrect);

    if (isCorrect) {
        score++;
        streak++;
        bestStreak = Math.max(bestStreak, streak);

        setFeedback(
            `Correct switch to ${target.role}! ${reactionMs} ms · ${angleError}° off target`,
            "good"
        );
        flickDetails.textContent = `Selected ${target.role}. Your flick was ${angleError}° from the exact target line.`;
        playSound(perfectSound);
    } else {
        streak = 0;
        const selectedName = selected ? selected.role : "no defender";

        setFeedback(
            `Wrong switch: ${selectedName}. Target was ${target.role}. ${reactionMs} ms · ${angleError}° off target`,
            "bad"
        );
        flickDetails.textContent = selected
            ? `Your direction was closest to ${selected.role}, so control moves there next.`
            : "No eligible defender matched that flick.";
        playSound(wrongSound);
    }

    updateScoreboard();
    renderDefenders(isCorrect);

    if (isDrillFinished()) {
        nextRoundTimerId = setTimeout(finishDrill, ROUND_FEEDBACK_MS);
        return;
    }

    // Madden gives you the defender selected by the flick, even when that was
    // not the defender you intended. Reproduce that result for the next rep.
    if (selected) {
        currentControlledId = selected.id;
    }

    nextRoundTimerId = setTimeout(() => {
        targetDefenderId = null;
        selectedDefenderId = null;
        renderDefenders();

        nextRoundTimerId = setTimeout(beginNextRound, NEXT_TARGET_DELAY_MS);
    }, ROUND_FEEDBACK_MS);
}

function handleReactionTimeout() {
    if (!gameRunning || roundLocked || drillComplete) return;

    roundTimeoutId = null;
    roundLocked = true;
    attempts++;
    streak = 0;

    const target = getDefender(targetDefenderId);
    renderDefenders();
    setFeedback(`Too slow! The target was ${target.role}.`, "bad");
    flickDetails.textContent = "Return the right stick to center and prepare for the next target.";
    playSound(wrongSound);
    updateScoreboard();

    if (isDrillFinished()) {
        nextRoundTimerId = setTimeout(finishDrill, ROUND_FEEDBACK_MS);
        return;
    }

    nextRoundTimerId = setTimeout(() => {
        targetDefenderId = null;
        renderDefenders();
        nextRoundTimerId = setTimeout(beginNextRound, NEXT_TARGET_DELAY_MS);
    }, ROUND_FEEDBACK_MS);
}

function chooseDefenderFromDirection(x, y) {
    const current = getDefender(currentControlledId);
    const flickDirection = normalizeVector(x, y);
    let best = null;

    for (const defender of defenders) {
        if (defender.id === currentControlledId) continue;

        const defenderDirection = normalizeVector(
            defender.x - current.x,
            defender.y - current.y
        );

        const angleDifference = vectorAngleDifferenceDegrees(
            flickDirection,
            defenderDirection
        );

        const distance = Math.hypot(defender.x - current.x, defender.y - current.y);

        // Direction is the main factor. Distance only breaks nearly identical
        // angles by slightly preferring the closer coverage defender.
        const selectionScore = angleDifference + (distance * 0.015);

        if (!best || selectionScore < best.selectionScore) {
            best = {
                ...defender,
                angleDifference,
                selectionScore,
            };
        }
    }

    return best;
}

function renderDefenders(lastAttemptWasCorrect = false) {
    defenderLayer.innerHTML = "";

    for (const defender of defenders) {
        const element = document.createElement("div");
        element.className = "defender";
        element.dataset.role = defender.role;
        element.textContent = defender.role;
        element.style.left = defender.x + "%";
        element.style.top = defender.y + "%";

        if (defender.id === currentControlledId) {
            element.classList.add("controlled");
        }

        if (defender.id === targetDefenderId && !roundLocked) {
            element.classList.add("target");
        }

        if (defender.id === selectedDefenderId && roundLocked) {
            element.classList.add(lastAttemptWasCorrect ? "selected-correct" : "selected-wrong");
        }

        defenderLayer.appendChild(element);
    }
}

function showFlickArrow(current, direction, isCorrect) {
    const arrowLength = 24;
    const endX = clamp(current.x + direction.x * arrowLength, 3, 97);
    const endY = clamp(current.y + direction.y * arrowLength, 3, 97);

    flickArrow.setAttribute("x1", current.x);
    flickArrow.setAttribute("y1", current.y);
    flickArrow.setAttribute("x2", endX);
    flickArrow.setAttribute("y2", endY);
    flickArrow.classList.remove("correct-arrow", "wrong-arrow");
    flickArrow.classList.add("visible", isCorrect ? "correct-arrow" : "wrong-arrow");
}

function hideFlickArrow() {
    flickArrow.classList.remove("visible", "correct-arrow", "wrong-arrow");
}

function updateStickMonitor(x, y) {
    const maxOffsetPercent = 36;
    const clampedX = clamp(x, -1, 1);
    const clampedY = clamp(y, -1, 1);

    stickDot.style.left = `${50 + clampedX * maxOffsetPercent}%`;
    stickDot.style.top = `${50 + clampedY * maxOffsetPercent}%`;

    const magnitude = Math.hypot(clampedX, clampedY);
    stickStatus.textContent = magnitude <= NEUTRAL_THRESHOLD
        ? "Right stick: centered"
        : `Right stick: ${directionName(clampedX, clampedY)}`;
}

function updateScoreboard() {
    scoreEl.textContent = score;
    attemptsEl.textContent = attempts;
    streakEl.textContent = streak;
    bestStreakEl.textContent = bestStreak;

    const accuracy = attempts === 0 ? 0 : Math.round((score / attempts) * 100);
    accuracyEl.textContent = accuracy + "%";

    const averageReaction = measuredReactionCount === 0
        ? null
        : Math.round(totalReactionMs / measuredReactionCount);

    averageReactionEl.textContent = averageReaction === null
        ? "--"
        : averageReaction + " ms";
}

function isDrillFinished() {
    if (drillLength === "free") return false;
    return attempts >= parseInt(drillLength, 10);
}

function finishDrill() {
    if (drillComplete) return;

    drillComplete = true;
    gameRunning = false;
    roundLocked = true;
    clearAllTimers();
    stopAnimationLoop();

    targetDefenderId = null;
    selectedDefenderId = null;
    renderDefenders();
    hideFlickArrow();

    const accuracy = attempts === 0 ? 0 : Math.round((score / attempts) * 100);
    const averageReaction = measuredReactionCount === 0
        ? 0
        : Math.round(totalReactionMs / measuredReactionCount);

    setFeedback(
        `Drill Complete! ${score}/${attempts} correct · ${accuracy}% · ${averageReaction || "--"} average reaction`,
        "good"
    );

    flickDetails.textContent = `Best streak: ${bestStreak}. Press Start New Drill to practice again.`;
    startBtn.textContent = "Start New Drill";

    logPracticeResult({ accuracy, averageReaction });
}

function clearAllTimers() {
    clearRoundTimer();

    if (nextRoundTimerId !== null) {
        clearTimeout(nextRoundTimerId);
        nextRoundTimerId = null;
    }

    for (const timerId of countdownTimerIds) {
        clearTimeout(timerId);
    }
    countdownTimerIds = [];
}

function clearRoundTimer() {
    if (roundTimeoutId !== null) {
        clearTimeout(roundTimeoutId);
        roundTimeoutId = null;
    }
}

function getDefender(id) {
    return defenders.find(defender => defender.id === id);
}

function angleFromTo(from, to) {
    return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
}

function normalizeVector(x, y) {
    const magnitude = Math.hypot(x, y);
    if (magnitude === 0) return { x: 0, y: 0 };
    return { x: x / magnitude, y: y / magnitude };
}

function vectorAngleDifferenceDegrees(first, second) {
    const dot = clamp(first.x * second.x + first.y * second.y, -1, 1);
    return Math.acos(dot) * 180 / Math.PI;
}

function angularDifferenceDegrees(first, second) {
    let difference = Math.abs(first - second) % 360;
    if (difference > 180) difference = 360 - difference;
    return difference;
}

function applyRadialDeadzone(x, y, deadzone) {
    const magnitude = Math.hypot(x, y);
    if (magnitude <= deadzone) return { x: 0, y: 0 };

    const normalizedMagnitude = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
    return {
        x: (x / magnitude) * normalizedMagnitude,
        y: (y / magnitude) * normalizedMagnitude,
    };
}

function directionName(x, y) {
    const angle = Math.atan2(y, x) * 180 / Math.PI;

    if (angle >= -22.5 && angle < 22.5) return "right";
    if (angle >= 22.5 && angle < 67.5) return "down-right";
    if (angle >= 67.5 && angle < 112.5) return "down";
    if (angle >= 112.5 && angle < 157.5) return "down-left";
    if (angle >= 157.5 || angle < -157.5) return "left";
    if (angle >= -157.5 && angle < -112.5) return "up-left";
    if (angle >= -112.5 && angle < -67.5) return "up";
    return "up-right";
}

function keyboardVectorForKey(key) {
    const normalizedKey = key.toLowerCase();
    const vectors = {
        arrowup: { x: 0, y: -1 },
        arrowdown: { x: 0, y: 1 },
        arrowleft: { x: -1, y: 0 },
        arrowright: { x: 1, y: 0 },
        q: normalizeVector(-1, -1),
        e: normalizeVector(1, -1),
        z: normalizeVector(-1, 1),
        c: normalizeVector(1, 1),
    };

    return vectors[normalizedKey] || null;
}

function setFeedback(message, type) {
    feedback.textContent = message;
    feedback.classList.remove("good", "bad", "info");
    if (type) feedback.classList.add(type);
}

function showControllerConnected(gamepad) {
    controllerStatus.textContent = `Controller connected: ${gamepad.id}`;
    controllerStatus.classList.add("connected");
}

function updateModeHelp() {
    if (modeSelect.value === "keyboard") {
        controllerStatus.textContent = "Keyboard test mode selected.";
        controllerStatus.classList.remove("connected");
    } else {
        const gamepad = getActiveGamepad();
        if (gamepad) {
            showControllerConnected(gamepad);
        } else {
            controllerStatus.textContent = "Waiting for controller...";
            controllerStatus.classList.remove("connected");
        }
    }
}

function playSound(sound) {
    sound.currentTime = 0;
    sound.play().catch(error => {
        console.log("Practice sound failed:", error);
    });
}

function logPracticeStart() {
    fetch("/api/switch-stick-practice-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            mode: modeSelect.value,
            reactionWindow: reactionWindowSelect.value,
            drillLength: drillLengthSelect.value,
        }),
    }).catch(error => {
        console.log("Switch Stick start tracking failed:", error);
    });
}

function logPracticeResult({ accuracy, averageReaction }) {
    fetch("/api/switch-stick-practice-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            mode: modeSelect.value,
            reactionWindow: reactionWindowSelect.value,
            drillLength: drillLengthSelect.value,
            score,
            attempts,
            accuracy,
            averageReaction,
            bestStreak,
        }),
    }).catch(error => {
        console.log("Switch Stick result tracking failed:", error);
    });
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

renderDefenders();
updateScoreboard();
updateModeHelp();
updateStickMonitor(0, 0);
