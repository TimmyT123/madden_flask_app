"use strict";

const modeSelect = document.getElementById("modeSelect");
const drillTypeSelect = document.getElementById("drillTypeSelect");
const routeSpeedSelect = document.getElementById("routeSpeedSelect");
const reactionWindowSelect = document.getElementById("reactionWindowSelect");
const drillLengthSelect = document.getElementById("drillLengthSelect");
const startBtn = document.getElementById("startBtn");
const gameArea = document.getElementById("gameArea");
const defenderLayer = document.getElementById("defenderLayer");
const receiverLayer = document.getElementById("receiverLayer");
const practiceInstructions = document.getElementById("practiceInstructions");
const feedback = document.getElementById("feedback");
const controllerStatus = document.getElementById("controllerStatus");
const stickStatus = document.getElementById("stickStatus");
const leftStickStatus = document.getElementById("leftStickStatus");
const stickDot = document.getElementById("stickDot");
const leftStickDot = document.getElementById("leftStickDot");
const leftStickPanel = document.getElementById("leftStickPanel");
const flickDetails = document.getElementById("flickDetails");
const movementDetails = document.getElementById("movementDetails");
const coverHud = document.getElementById("coverHud");
const coverPhaseLabel = document.getElementById("coverPhaseLabel");
const passTime = document.getElementById("passTime");
const passMeterFill = document.getElementById("passMeterFill");
const flickArrow = document.getElementById("flickArrow");
const routeTrail = document.getElementById("routeTrail");

const scoreEl = document.getElementById("score");
const scoreLabel = document.getElementById("scoreLabel");
const switchScoreItem = document.getElementById("switchScoreItem");
const switchCorrectEl = document.getElementById("switchCorrect");
const attemptsEl = document.getElementById("attempts");
const accuracyEl = document.getElementById("accuracy");
const accuracyLabel = document.getElementById("accuracyLabel");
const averageReactionEl = document.getElementById("averageReaction");
const streakEl = document.getElementById("streak");
const bestStreakEl = document.getElementById("bestStreak");

const perfectSound = new Audio("/static/sounds/perfect.mp3");
perfectSound.volume = 0.6;

const wrongSound = new Audio("/static/sounds/wrong.mp3");
wrongSound.volume = 0.5;

// Standard browser Gamepad mapping for DualSense and Xbox controllers.
const LEFT_STICK_X_AXIS = 0;
const LEFT_STICK_Y_AXIS = 1;
const RIGHT_STICK_X_AXIS = 2;
const RIGHT_STICK_Y_AXIS = 3;
const NEUTRAL_THRESHOLD = 0.30;
const FLICK_THRESHOLD = 0.72;
const MIN_DIRECTION_MAGNITUDE = 0.35;
const LEFT_STICK_DEADZONE = 0.14;
const DEFENDER_MOVE_SPEED = 18.5;
const COVERAGE_RADIUS = 5.5;

const ROUND_FEEDBACK_MS = 1100;
const NEXT_TARGET_DELAY_MS = 260;
const ROUTE_BREAK_FRACTION = 0.52;

const defenders = [
    { id: "FS", role: "FS", x: 50, y: 16 },
    { id: "SS", role: "SS", x: 72, y: 27 },
    { id: "LCB", role: "LCB", x: 14, y: 31 },
    { id: "RCB", role: "RCB", x: 86, y: 31 },
    { id: "NICKEL", role: "NICKEL", x: 28, y: 49 },
    { id: "MLB", role: "MLB", x: 50, y: 61 },
    { id: "OLB", role: "OLB", x: 72, y: 49 },
];

let defenderPositions = {};
const pressedMovementKeys = new Set();

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
let routeSpeedMs = 1050;
let drillLength = "free";
let drillType = "route_reaction";

let activeRoute = null;
let receiverElement = null;
let catchPointElement = null;
let coverPhaseActive = false;
let coverResolved = false;
let pendingCoverAttempt = null;
let leftStickVector = { x: 0, y: 0 };
let lastAnimationTimestamp = null;

let score = 0;
let attempts = 0;
let streak = 0;
let bestStreak = 0;
let totalReactionMs = 0;
let measuredReactionCount = 0;
let switchCorrectCount = 0;

startBtn.addEventListener("click", startGame);
modeSelect.addEventListener("change", updateModeHelp);
drillTypeSelect.addEventListener("change", updateDrillTypeHelp);

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

    if (isMovementKey(event.key)) {
        event.preventDefault();
        pressedMovementKeys.add(event.key.toLowerCase());
        const movementVector = getKeyboardMovementVector();
        leftStickVector = movementVector;
        updateLeftStickMonitor(movementVector.x, movementVector.y);
        return;
    }

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

    if (isMovementKey(event.key)) {
        pressedMovementKeys.delete(event.key.toLowerCase());
        const movementVector = getKeyboardMovementVector();
        leftStickVector = movementVector;
        updateLeftStickMonitor(movementVector.x, movementVector.y);
        return;
    }

    if (!keyboardVectorForKey(event.key)) return;

    updateStickMonitor(0, 0);
    waitingForNeutral = false;
});

function startGame() {
    const thisStartSequence = ++startSequenceId;

    clearAllTimers();
    stopAnimationLoop();
    clearRouteVisuals();

    gameRunning = false;
    drillComplete = false;
    roundLocked = true;
    waitingForNeutral = true;
    coverPhaseActive = false;
    coverResolved = false;
    pendingCoverAttempt = null;
    leftStickVector = { x: 0, y: 0 };
    lastAnimationTimestamp = null;
    pressedMovementKeys.clear();

    drillType = drillTypeSelect.value;
    routeSpeedMs = parseInt(routeSpeedSelect.value, 10) || 1050;
    reactionWindowMs = parseInt(reactionWindowSelect.value, 10) || 0;
    drillLength = drillLengthSelect.value;

    score = 0;
    attempts = 0;
    streak = 0;
    bestStreak = 0;
    totalReactionMs = 0;
    measuredReactionCount = 0;
    switchCorrectCount = 0;

    currentControlledId = "MLB";
    targetDefenderId = null;
    selectedDefenderId = null;
    lastTargetDefenderId = null;
    activeRoute = null;
    resetDefenderPositions();

    updateScoreboard();
    hideFlickArrow();
    renderDefenders();
    updateStickMonitor(0, 0);
    updateLeftStickMonitor(0, 0);
    hideCoverHud();

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
    clearRouteVisuals();
    hideFlickArrow();

    selectedDefenderId = null;
    targetDefenderId = null;
    activeRoute = null;
    roundLocked = true;
    waitingForNeutral = true;
    coverPhaseActive = false;
    coverResolved = false;
    pendingCoverAttempt = null;
    leftStickVector = { x: 0, y: 0 };
    resetDefenderPositions();
    updateLeftStickMonitor(0, 0);
    hideCoverHud();

    const candidates = getGoodTargetCandidates();
    const provisionalTarget = chooseRandomTarget(candidates);

    if (drillType === "route_reaction" || drillType === "switch_and_cover") {
        activeRoute = buildRouteForTarget(provisionalTarget);

        // The catch point determines the responsible defender. This is what
        // makes the route itself, rather than a highlighted icon, the cue.
        const responsibleDefender = chooseResponsibleDefender(activeRoute.catchPoint);
        targetDefenderId = responsibleDefender.id;
        lastTargetDefenderId = responsibleDefender.id;

        createRouteVisuals(activeRoute);
        renderDefenders();
        setFeedback("Watch the receiver. Be ready for the route break...", "info");
        flickDetails.textContent = "The correct defender will not light up. Read where the route is entering coverage.";
        movementDetails.textContent = drillType === "switch_and_cover"
            ? "After your right-stick switch, immediately use the left stick to close on the catch area."
            : "Left-stick movement is used only in Switch and Cover mode.";
        return;
    }

    targetDefenderId = provisionalTarget.id;
    lastTargetDefenderId = provisionalTarget.id;
    roundLocked = false;
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

    // Prefer targets with enough angular separation to reduce unfairly
    // ambiguous right-stick selections.
    const separated = available.filter(candidate => {
        const candidateAngle = angleFromTo(current, candidate);
        const otherCandidates = available.filter(other => other.id !== candidate.id);

        if (otherCandidates.length === 0) return true;

        const nearestOtherAngle = Math.min(...otherCandidates.map(other =>
            angularDifferenceDegrees(candidateAngle, angleFromTo(current, other))
        ));

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
    lastAnimationTimestamp = null;

    const loop = timestamp => {
        if (!gameRunning) return;

        const deltaMs = lastAnimationTimestamp === null
            ? 0
            : Math.min(50, Math.max(0, timestamp - lastAnimationTimestamp));
        lastAnimationTimestamp = timestamp;

        checkControllerInput();
        updateControlledMovement(deltaMs);
        updateRouteAnimation(timestamp);
        updateCoverHud(timestamp);
        animationId = requestAnimationFrame(loop);
    };

    animationId = requestAnimationFrame(loop);
}

function stopAnimationLoop() {
    if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    lastAnimationTimestamp = null;
}

function updateRouteAnimation(timestamp) {
    if (!activeRoute || activeRoute.frozen) return;

    const elapsed = Math.max(0, timestamp - activeRoute.startedAt);
    const breakTime = activeRoute.breakDuration;

    if (elapsed < breakTime) {
        const progress = clamp(elapsed / breakTime, 0, 1);
        const position = interpolatePoint(activeRoute.start, activeRoute.breakPoint, easeInOut(progress));
        setReceiverPosition(position);
        updateRouteTrail([activeRoute.start, position]);
        return;
    }

    if (!activeRoute.breakTriggered) {
        triggerRouteBreak(timestamp);
    }

    const finishDuration = activeRoute.finishDuration;
    const progress = clamp((elapsed - breakTime) / finishDuration, 0, 1);
    const position = interpolatePoint(activeRoute.breakPoint, activeRoute.catchPoint, easeOut(progress));

    setReceiverPosition(position, true);
    updateRouteTrail([activeRoute.start, activeRoute.breakPoint, position]);

    if (progress >= 1) {
        activeRoute.completed = true;

        if (drillType === "switch_and_cover" && !coverResolved) {
            resolveCoverPlay();
        }
    }
}

function triggerRouteBreak(timestamp) {
    if (!activeRoute || activeRoute.breakTriggered) return;

    activeRoute.breakTriggered = true;
    roundLocked = false;
    roundStartedAt = timestamp;

    showCatchPoint(activeRoute.catchPoint);
    setFeedback(`${activeRoute.name} break! Switch to the defender responsible for that area.`, "info");
    flickDetails.textContent = "The reaction clock started at the route break. Flick once, then return the stick to center.";

    if (drillType === "switch_and_cover") {
        activeRoute.passArrivalAt = timestamp + activeRoute.finishDuration;
        showCoverHud();
        coverPhaseLabel.textContent = "Flick to the responsible defender, then close on the catch area.";
        movementDetails.textContent = "The pass clock is running. Switch first, then move with the left stick.";
    }

    if (reactionWindowMs > 0) {
        roundTimeoutId = setTimeout(handleReactionTimeout, reactionWindowMs);
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

    const rawLeftX = gamepad.axes[LEFT_STICK_X_AXIS] || 0;
    const rawLeftY = gamepad.axes[LEFT_STICK_Y_AXIS] || 0;
    const movementVector = applyRadialDeadzone(rawLeftX, rawLeftY, LEFT_STICK_DEADZONE);
    leftStickVector = coverPhaseActive ? movementVector : { x: 0, y: 0 };
    updateLeftStickMonitor(leftStickVector.x, leftStickVector.y);

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

    // Moving or holding the stick before a route breaks should not create an
    // instant switch when the cue appears. The user must re-center first.
    if (roundLocked) {
        waitingForNeutral = true;
        stickStatus.textContent = "Right stick: return to center";
        return;
    }

    if (waitingForNeutral || drillComplete) {
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
    const routeName = activeRoute ? activeRoute.name : null;

    selectedDefenderId = selected ? selected.id : null;
    totalReactionMs += reactionMs;
    measuredReactionCount++;

    const targetVector = normalizeVector(target.x - current.x, target.y - current.y);
    const angleError = Math.round(vectorAngleDifferenceDegrees(direction, targetVector));
    const isCorrect = Boolean(selected && selected.id === target.id);

    showFlickArrow(current, direction, isCorrect);

    if (drillType === "switch_and_cover") {
        if (isCorrect) {
            switchCorrectCount++;
        }

        pendingCoverAttempt = {
            reactionMs,
            selectedId: selected ? selected.id : null,
            targetId: target.id,
            routeName,
            angleError,
            isCorrect,
        };

        if (selected) {
            currentControlledId = selected.id;
            coverPhaseActive = true;
        }

        renderDefenders(isCorrect, false);
        updateScoreboard();

        if (isCorrect) {
            setFeedback(
                `Correct switch to ${target.role}! Now close on the catch area with the left stick.`,
                "good"
            );
            flickDetails.textContent = `${reactionMs} ms · ${angleError}° off target. Right-stick job complete.`;
        } else {
            const selectedName = selected ? selected.role : "no defender";
            setFeedback(
                `Wrong switch to ${selectedName}. Recover by moving him into the catch area!`,
                "bad"
            );
            flickDetails.textContent = `${target.role} was responsible, but Madden gave you ${selectedName}. Try to save the play.`;
        }

        movementDetails.textContent = "Hold the left stick toward the orange circle before the pass meter empties.";
        return;
    }

    if (activeRoute) {
        activeRoute.frozen = true;
    }

    attempts++;

    if (isCorrect) {
        score++;
        streak++;
        bestStreak = Math.max(bestStreak, streak);

        const routeText = routeName ? `${routeName} · ` : "";
        setFeedback(
            `Correct switch to ${target.role}! ${routeText}${reactionMs} ms · ${angleError}° off target`,
            "good"
        );
        flickDetails.textContent = routeName
            ? `${routeName} entered ${target.role}'s area. Your flick was ${angleError}° from the exact target line.`
            : `Selected ${target.role}. Your flick was ${angleError}° from the exact target line.`;
        playSound(perfectSound);
    } else {
        streak = 0;
        const selectedName = selected ? selected.role : "no defender";
        const routeText = routeName ? ` on the ${routeName}` : "";

        setFeedback(
            `Wrong switch: ${selectedName}. ${target.role} was responsible${routeText}. ${reactionMs} ms · ${angleError}° off target`,
            "bad"
        );
        flickDetails.textContent = selected
            ? `Your direction selected ${selected.role}. The green ring reveals the correct defender: ${target.role}.`
            : `No eligible defender matched that flick. The green ring reveals ${target.role}.`;
        playSound(wrongSound);
    }

    updateScoreboard();
    renderDefenders(isCorrect, true);

    if (isDrillFinished()) {
        nextRoundTimerId = setTimeout(finishDrill, ROUND_FEEDBACK_MS);
        return;
    }

    if (selected) {
        currentControlledId = selected.id;
    }

    scheduleNextRound();
}

function handleReactionTimeout() {
    if (!gameRunning || roundLocked || drillComplete) return;

    roundTimeoutId = null;
    roundLocked = true;
    attempts++;
    streak = 0;
    coverPhaseActive = false;
    coverResolved = drillType === "switch_and_cover";
    leftStickVector = { x: 0, y: 0 };
    updateLeftStickMonitor(0, 0);

    if (activeRoute) {
        activeRoute.frozen = true;
    }

    const target = getDefender(targetDefenderId);
    const routeText = activeRoute ? ` on the ${activeRoute.name}` : "";

    markCatchPointResult(false);
    renderDefenders(false, true);
    setFeedback(`Too slow! ${target.role} was responsible${routeText}.`, "bad");
    flickDetails.textContent = "The green ring reveals the correct defender. Return the right stick to center.";
    movementDetails.textContent = drillType === "switch_and_cover"
        ? "The reaction window expired before you could switch and close on the route."
        : "Left-stick movement is used only in Switch and Cover mode.";
    playSound(wrongSound);
    updateScoreboard();
    hideCoverHud();

    if (isDrillFinished()) {
        nextRoundTimerId = setTimeout(finishDrill, ROUND_FEEDBACK_MS);
        return;
    }

    scheduleNextRound();
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

function chooseResponsibleDefender(catchPoint) {
    let best = null;

    for (const baseDefender of defenders) {
        if (baseDefender.id === currentControlledId) continue;

        const defender = getDefender(baseDefender.id);
        const distance = Math.hypot(
            defender.x - catchPoint.x,
            defender.y - catchPoint.y
        );

        if (!best || distance < best.distance) {
            best = { ...defender, distance };
        }
    }

    return best;
}

function renderDefenders(lastAttemptWasCorrect = false, revealTarget = false) {
    defenderLayer.innerHTML = "";

    for (const baseDefender of defenders) {
        const defender = getDefender(baseDefender.id);
        const element = document.createElement("div");
        element.className = "defender";
        element.dataset.id = defender.id;
        element.dataset.role = defender.role;
        element.textContent = defender.role;
        element.style.left = defender.x + "%";
        element.style.top = defender.y + "%";

        if (defender.id === currentControlledId) {
            element.classList.add("controlled");
            if (coverPhaseActive) element.classList.add("moving-controlled");
        }

        if (
            drillType === "target_recognition" &&
            defender.id === targetDefenderId &&
            !roundLocked
        ) {
            element.classList.add("target");
        }

        if (revealTarget && defender.id === targetDefenderId) {
            element.classList.add("target-reveal");
        }

        if (defender.id === selectedDefenderId && roundLocked) {
            element.classList.add(lastAttemptWasCorrect ? "selected-correct" : "selected-wrong");
        }

        defenderLayer.appendChild(element);
    }
}

function buildRouteForTarget(target) {
    const catchPoint = getCatchPointForTarget(target);
    let start;
    let breakPoint;
    let name;
    let receiverLabel = "WR";

    switch (target.role) {
        case "FS": {
            const fromLeft = Math.random() < 0.5;
            start = { x: fromLeft ? 18 : 82, y: 88 };
            breakPoint = { x: fromLeft ? 29 : 71, y: 53 };
            name = "Post";
            break;
        }

        case "SS": {
            if (Math.random() < 0.5) {
                start = { x: 58, y: 88 };
                breakPoint = { x: 61, y: 55 };
                name = "Corner";
            } else {
                start = { x: 18, y: 88 };
                breakPoint = { x: 31, y: 59 };
                name = "Deep Crosser";
            }
            break;
        }

        case "LCB": {
            if (Math.random() < 0.5) {
                start = { x: 30, y: 88 };
                breakPoint = { x: 30, y: 52 };
                name = "Out";
            } else {
                start = { x: 42, y: 88 };
                breakPoint = { x: 38, y: 58 };
                name = "Corner";
            }
            break;
        }

        case "RCB": {
            if (Math.random() < 0.5) {
                start = { x: 70, y: 88 };
                breakPoint = { x: 70, y: 52 };
                name = "Out";
            } else {
                start = { x: 58, y: 88 };
                breakPoint = { x: 62, y: 58 };
                name = "Corner";
            }
            break;
        }

        case "NICKEL": {
            if (Math.random() < 0.5) {
                start = { x: 78, y: 88 };
                breakPoint = { x: 66, y: 68 };
                name = "Drag";
            } else {
                start = { x: 18, y: 88 };
                breakPoint = { x: 31, y: 67 };
                name = "Crosser";
            }
            receiverLabel = Math.random() < 0.35 ? "TE" : "WR";
            break;
        }

        case "MLB": {
            const fromLeft = Math.random() < 0.5;
            start = { x: fromLeft ? 20 : 80, y: 88 };
            breakPoint = { x: fromLeft ? 27 : 73, y: 66 };
            name = Math.random() < 0.5 ? "Dig" : "Hook-In";
            receiverLabel = Math.random() < 0.45 ? "TE" : "WR";
            break;
        }

        case "OLB":
        default: {
            if (Math.random() < 0.5) {
                start = { x: 20, y: 88 };
                breakPoint = { x: 34, y: 67 };
                name = "Crosser";
                receiverLabel = "TE";
            } else {
                start = { x: 84, y: 88 };
                breakPoint = { x: 78, y: 68 };
                name = "Flat";
                receiverLabel = "RB";
            }
            break;
        }
    }

    const breakDuration = routeSpeedMs * ROUTE_BREAK_FRACTION;
    const finishDuration = drillType === "switch_and_cover"
        ? routeSpeedMs
        : routeSpeedMs * (1 - ROUTE_BREAK_FRACTION);

    return {
        name,
        receiverLabel,
        start,
        breakPoint,
        catchPoint,
        breakDuration,
        finishDuration,
        totalDuration: breakDuration + finishDuration,
        passArrivalAt: null,
        startedAt: performance.now(),
        breakTriggered: false,
        completed: false,
        frozen: false,
    };
}

function getCatchPointForTarget(target) {
    const routeOffsets = {
        FS: { x: 0, y: 4 },
        SS: { x: -1, y: 3 },
        LCB: { x: 4, y: 3 },
        RCB: { x: -4, y: 3 },
        NICKEL: { x: 2, y: 2 },
        MLB: { x: 0, y: -2 },
        OLB: { x: -2, y: 2 },
    };

    const coverOffsets = {
        FS: { x: Math.random() < 0.5 ? -7 : 7, y: 8 },
        SS: { x: -7, y: 7 },
        LCB: { x: 8, y: 6 },
        RCB: { x: -8, y: 6 },
        NICKEL: { x: 8, y: 3 },
        MLB: { x: Math.random() < 0.5 ? -8 : 8, y: -5 },
        OLB: { x: -8, y: 4 },
    };

    const offsets = drillType === "switch_and_cover" ? coverOffsets : routeOffsets;

    const offset = offsets[target.role] || { x: 0, y: 0 };

    return {
        x: clamp(target.x + offset.x + randomBetween(-1.2, 1.2), 8, 92),
        y: clamp(target.y + offset.y + randomBetween(-1.2, 1.2), 11, 82),
    };
}

function createRouteVisuals(route) {
    receiverLayer.innerHTML = "";

    catchPointElement = document.createElement("div");
    catchPointElement.className = "catch-point";
    if (drillType === "switch_and_cover") {
        catchPointElement.classList.add("cover-zone");
    }
    catchPointElement.style.left = route.catchPoint.x + "%";
    catchPointElement.style.top = route.catchPoint.y + "%";

    receiverElement = document.createElement("div");
    receiverElement.className = "receiver";
    receiverElement.dataset.label = route.name;
    receiverElement.textContent = route.receiverLabel;

    receiverLayer.appendChild(catchPointElement);
    receiverLayer.appendChild(receiverElement);

    setReceiverPosition(route.start);
    updateRouteTrail([route.start]);
}

function clearRouteVisuals() {
    receiverLayer.innerHTML = "";
    routeTrail.setAttribute("points", "");
    receiverElement = null;
    catchPointElement = null;
    activeRoute = null;
    hideCoverHud();
}

function setReceiverPosition(point, isBreaking = false) {
    if (!receiverElement) return;

    receiverElement.style.left = point.x + "%";
    receiverElement.style.top = point.y + "%";
    receiverElement.classList.toggle("breaking", isBreaking);
}

function showCatchPoint(point) {
    if (!catchPointElement) return;

    catchPointElement.style.left = point.x + "%";
    catchPointElement.style.top = point.y + "%";
    catchPointElement.classList.add("visible");
}

function updateRouteTrail(points) {
    const text = points
        .map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
        .join(" ");

    routeTrail.setAttribute("points", text);
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

function updateLeftStickMonitor(x, y) {
    const maxOffsetPercent = 36;
    const clampedX = clamp(x, -1, 1);
    const clampedY = clamp(y, -1, 1);

    leftStickDot.style.left = `${50 + clampedX * maxOffsetPercent}%`;
    leftStickDot.style.top = `${50 + clampedY * maxOffsetPercent}%`;

    const magnitude = Math.hypot(clampedX, clampedY);
    leftStickStatus.textContent = magnitude <= LEFT_STICK_DEADZONE
        ? "Left stick: centered"
        : `Left stick: ${directionName(clampedX, clampedY)}`;
}

function isMovementKey(key) {
    return ["w", "a", "s", "d"].includes(key.toLowerCase());
}

function getKeyboardMovementVector() {
    let x = 0;
    let y = 0;

    if (pressedMovementKeys.has("a")) x -= 1;
    if (pressedMovementKeys.has("d")) x += 1;
    if (pressedMovementKeys.has("w")) y -= 1;
    if (pressedMovementKeys.has("s")) y += 1;

    return normalizeVector(x, y);
}

function updateControlledMovement(deltaMs) {
    if (!coverPhaseActive || coverResolved || deltaMs <= 0 || !currentControlledId) return;

    const input = modeSelect.value === "keyboard"
        ? getKeyboardMovementVector()
        : leftStickVector;

    const magnitude = Math.min(1, Math.hypot(input.x, input.y));
    if (magnitude <= LEFT_STICK_DEADZONE) return;

    const direction = normalizeVector(input.x, input.y);
    const distance = DEFENDER_MOVE_SPEED * (deltaMs / 1000) * magnitude;
    const current = getDefender(currentControlledId);

    defenderPositions[currentControlledId] = {
        x: clamp(current.x + direction.x * distance, 4, 96),
        y: clamp(current.y + direction.y * distance, 9, 84),
    };

    updateDefenderElementPosition(currentControlledId);

    if (activeRoute && activeRoute.catchPoint) {
        const moved = getDefender(currentControlledId);
        const remainingDistance = Math.hypot(
            moved.x - activeRoute.catchPoint.x,
            moved.y - activeRoute.catchPoint.y
        );
        movementDetails.textContent = remainingDistance <= COVERAGE_RADIUS
            ? "You are in position. Stay inside the catch area until the pass arrives."
            : `Close on the catch area — distance ${remainingDistance.toFixed(1)}.`;
    }
}

function updateDefenderElementPosition(defenderId) {
    const element = defenderLayer.querySelector(`[data-id="${defenderId}"]`);
    const defender = getDefender(defenderId);
    if (!element || !defender) return;

    element.style.left = defender.x + "%";
    element.style.top = defender.y + "%";
}

function showCoverHud() {
    coverHud.classList.remove("hidden");
    coverHud.classList.remove("urgent");
    passMeterFill.style.width = "100%";
}

function hideCoverHud() {
    coverHud.classList.add("hidden");
    coverHud.classList.remove("urgent");
    passTime.textContent = "--";
    passMeterFill.style.width = "100%";
}

function updateCoverHud(timestamp) {
    if (
        drillType !== "switch_and_cover" ||
        !activeRoute ||
        !activeRoute.breakTriggered ||
        coverResolved ||
        !activeRoute.passArrivalAt
    ) {
        return;
    }

    const remaining = Math.max(0, activeRoute.passArrivalAt - timestamp);
    const percent = clamp((remaining / activeRoute.finishDuration) * 100, 0, 100);

    passTime.textContent = `${Math.ceil(remaining)} ms`;
    passMeterFill.style.width = percent + "%";
    coverHud.classList.toggle("urgent", remaining <= 350);
}

function markCatchPointResult(defended) {
    if (!catchPointElement) return;
    catchPointElement.classList.remove("defended", "open");
    catchPointElement.classList.add(defended ? "defended" : "open");
}

function resolveCoverPlay() {
    if (drillType !== "switch_and_cover" || coverResolved) return;

    coverResolved = true;
    coverPhaseActive = false;
    roundLocked = true;
    clearRoundTimer();
    leftStickVector = { x: 0, y: 0 };
    updateLeftStickMonitor(0, 0);
    hideCoverHud();

    if (activeRoute) activeRoute.frozen = true;

    attempts++;

    const target = getDefender(targetDefenderId);
    const controlled = currentControlledId ? getDefender(currentControlledId) : null;
    const distance = controlled && activeRoute
        ? Math.hypot(
            controlled.x - activeRoute.catchPoint.x,
            controlled.y - activeRoute.catchPoint.y
        )
        : Infinity;
    const defended = Boolean(pendingCoverAttempt && distance <= COVERAGE_RADIUS);
    const switchWasCorrect = Boolean(pendingCoverAttempt && pendingCoverAttempt.isCorrect);

    if (defended) {
        score++;
        streak++;
        bestStreak = Math.max(bestStreak, streak);
        markCatchPointResult(true);

        if (switchWasCorrect) {
            setFeedback(
                `Perfect stop! Correct switch to ${target.role}, then closed the catch window.`,
                "good"
            );
            flickDetails.textContent = `${pendingCoverAttempt.reactionMs} ms reaction · ${pendingCoverAttempt.angleError}° directional error.`;
        } else {
            setFeedback(
                `Recovery stop! The switch was wrong, but you moved ${controlled.role} into position.`,
                "good"
            );
            flickDetails.textContent = `${target.role} was responsible. You recovered with ${controlled.role}.`;
        }

        movementDetails.textContent = `Defender finished ${distance.toFixed(1)} from the catch point.`;
        playSound(perfectSound);
    } else {
        streak = 0;
        markCatchPointResult(false);

        if (!pendingCoverAttempt) {
            setFeedback(`Pass completed — no switch before the ball arrived. ${target.role} was responsible.`, "bad");
            flickDetails.textContent = "Read the break sooner and make one quick right-stick flick.";
        } else if (switchWasCorrect) {
            setFeedback("Correct switch, but late coverage. The receiver stayed open.", "bad");
            flickDetails.textContent = `You selected ${target.role}, but did not reach the catch area before the pass.`;
        } else {
            const controlledName = controlled ? controlled.role : "no defender";
            setFeedback("Wrong switch and no recovery. The pass was completed.", "bad");
            flickDetails.textContent = `${target.role} was responsible; you controlled ${controlledName}.`;
        }

        movementDetails.textContent = Number.isFinite(distance)
            ? `Defender finished ${distance.toFixed(1)} from the catch point.`
            : "No defender reached the catch point.";
        playSound(wrongSound);
    }

    selectedDefenderId = pendingCoverAttempt && controlled ? controlled.id : null;
    renderDefenders(defended, true);
    updateScoreboard();

    if (isDrillFinished()) {
        nextRoundTimerId = setTimeout(finishDrill, ROUND_FEEDBACK_MS);
        return;
    }

    scheduleNextRound();
}

function scheduleNextRound() {
    nextRoundTimerId = setTimeout(() => {
        targetDefenderId = null;
        selectedDefenderId = null;
        clearRouteVisuals();
        renderDefenders();

        nextRoundTimerId = setTimeout(beginNextRound, NEXT_TARGET_DELAY_MS);
    }, ROUND_FEEDBACK_MS);
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
    const coverMode = drillType === "switch_and_cover";

    scoreLabel.textContent = coverMode ? "Stops" : "Correct";
    accuracyLabel.textContent = coverMode ? "Stop Rate" : "Accuracy";
    switchScoreItem.classList.toggle("hidden", !coverMode);

    scoreEl.textContent = score;
    switchCorrectEl.textContent = switchCorrectCount;
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
    clearRouteVisuals();
    renderDefenders();
    hideFlickArrow();

    const accuracy = attempts === 0 ? 0 : Math.round((score / attempts) * 100);
    const averageReaction = measuredReactionCount === 0
        ? 0
        : Math.round(totalReactionMs / measuredReactionCount);

    const resultWord = drillType === "switch_and_cover" ? "stops" : "correct";
    const switchText = drillType === "switch_and_cover"
        ? ` · ${switchCorrectCount} correct switches`
        : "";

    setFeedback(
        `Drill Complete! ${score}/${attempts} ${resultWord} · ${accuracy}%${switchText} · ${averageReaction || "--"} average reaction`,
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
    const base = defenders.find(defender => defender.id === id);
    if (!base) return null;

    const position = defenderPositions[id] || { x: base.x, y: base.y };
    return { ...base, x: position.x, y: position.y };
}

function resetDefenderPositions() {
    defenderPositions = {};
    for (const defender of defenders) {
        defenderPositions[defender.id] = { x: defender.x, y: defender.y };
    }
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

function interpolatePoint(first, second, progress) {
    return {
        x: first.x + (second.x - first.x) * progress,
        y: first.y + (second.y - first.y) * progress,
    };
}

function easeInOut(value) {
    return value < 0.5
        ? 2 * value * value
        : 1 - Math.pow(-2 * value + 2, 2) / 2;
}

function easeOut(value) {
    return 1 - Math.pow(1 - value, 3);
}

function randomBetween(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
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

function updateDrillTypeHelp() {
    const selectedType = drillTypeSelect.value;
    const routeMode = selectedType === "route_reaction" || selectedType === "switch_and_cover";
    const coverMode = selectedType === "switch_and_cover";
    routeSpeedSelect.disabled = !routeMode;

    practiceInstructions.textContent = coverMode
        ? "Read the route break, flick the right stick to the responsible defender, then use the left stick to move him into the catch area before the pass arrives."
        : selectedType === "route_reaction"
            ? "Watch the receiver run his route. When he makes his break, identify the coverage defender responsible for the threatened area and flick the right stick toward that defender."
            : "Find the pulsing coverage defender and flick the right stick toward him. The selected defender becomes your controlled defender for the next repetition.";

    leftStickPanel.classList.toggle("hidden", !coverMode);
    leftStickStatus.classList.toggle("hidden", !coverMode);
    if (!coverMode) hideCoverHud();

    drillType = selectedType;
    updateScoreboard();
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
            drillType: drillTypeSelect.value,
            routeSpeed: routeSpeedSelect.value,
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
            drillType: drillTypeSelect.value,
            routeSpeed: routeSpeedSelect.value,
            reactionWindow: reactionWindowSelect.value,
            drillLength: drillLengthSelect.value,
            score,
            attempts,
            accuracy,
            averageReaction,
            bestStreak,
            switchCorrectCount,
            stops: drillType === "switch_and_cover" ? score : null,
        }),
    }).catch(error => {
        console.log("Switch Stick result tracking failed:", error);
    });
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

resetDefenderPositions();
renderDefenders();
updateScoreboard();
updateModeHelp();
updateDrillTypeHelp();
updateStickMonitor(0, 0);
updateLeftStickMonitor(0, 0);
