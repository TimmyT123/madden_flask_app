"use strict";

const modeSelect = document.getElementById("modeSelect");
const drillTypeSelect = document.getElementById("drillTypeSelect");
const targetSpeedSelect = document.getElementById("targetSpeedSelect");
const targetSizeSelect = document.getElementById("targetSizeSelect");
const sensitivitySelect = document.getElementById("sensitivitySelect");
const drillLengthSelect = document.getElementById("drillLengthSelect");
const startBtn = document.getElementById("startBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const gameArea = document.getElementById("gameArea");
const arena = document.getElementById("arena");
const targetLayer = document.getElementById("targetLayer");
const knifeLayer = document.getElementById("knifeLayer");
const crosshair = document.getElementById("crosshair");
const countdown = document.getElementById("countdown");
const hitMarker = document.getElementById("hitMarker");
const controllerStatus = document.getElementById("controllerStatus");
const aimStatus = document.getElementById("aimStatus");
const r1Status = document.getElementById("r1Status");
const keyboardHelp = document.getElementById("keyboardHelp");
const knifeReady = document.getElementById("knifeReady");
const knifeReadyText = document.getElementById("knifeReadyText");
const feedback = document.getElementById("feedback");

const hitsEl = document.getElementById("hits");
const throwsEl = document.getElementById("throws");
const accuracyEl = document.getElementById("accuracy");
const escapedEl = document.getElementById("escaped");
const averageReactionEl = document.getElementById("averageReaction");
const centerHitsEl = document.getElementById("centerHits");
const streakEl = document.getElementById("streak");
const bestStreakEl = document.getElementById("bestStreak");
const roundsCompletedEl = document.getElementById("roundsCompleted");
const roundGoalEl = document.getElementById("roundGoal");

const perfectSound = new Audio("/static/sounds/perfect.mp3");
perfectSound.volume = 0.55;

const wrongSound = new Audio("/static/sounds/wrong.mp3");
wrongSound.volume = 0.42;

// Standard browser Gamepad mapping for a DualSense controller.
const RIGHT_STICK_X_AXIS = 2;
const RIGHT_STICK_Y_AXIS = 3;
const R1_BUTTON_INDEX = 5;
const PS_HOME_BUTTON_INDEX = 16;
const WURD_HOME_URL = "/";
const STICK_DEADZONE = 0.12;
const KNIFE_RECOVERY_MS = 570;
const NEXT_TARGET_DELAY_MS = 560;

const SPEED_SETTINGS = {
    slow: { moving: 21, visible: 2600, peekHold: 1450 },
    normal: { moving: 30, visible: 2050, peekHold: 1100 },
    fast: { moving: 40, visible: 1550, peekHold: 820 },
    elite: { moving: 51, visible: 1150, peekHold: 590 },
};

const AIM_SPEED = {
    low: 125,
    normal: 165,
    high: 185,
};

const TARGET_SCALE = {
    large: "target-large",
    normal: "",
    small: "target-small",
};

const PEEK_COVERS = [
    { x: 18, y: 62 },
    { x: 50, y: 62 },
    { x: 82, y: 62 },
];

let activeGamepadIndex = null;
let animationId = null;
let startSequenceId = 0;
let countdownTimers = [];
let nextTargetTimer = null;
let knifeRecoveryTimer = null;
let hitMarkerTimer = null;
let lastFrameTime = null;
let lastR1Pressed = false;
let lastPsHomePressed = false;
let activeTarget = null;
let gameRunning = false;
let drillComplete = false;
let roundLocked = true;
let knifeIsReady = true;
let crosshairX = 50;
let crosshairY = 50;
let drillLength = "free";

let hits = 0;
let throwsMade = 0;
let escaped = 0;
let centerHits = 0;
let roundsCompleted = 0;
let streak = 0;
let bestStreak = 0;
let totalReactionMs = 0;
let reactionCount = 0;

const pressedKeys = new Set();

startBtn.addEventListener("click", startPractice);
fullscreenBtn.addEventListener("click", toggleFullscreen);
modeSelect.addEventListener("change", updateInputHelp);

window.addEventListener("gamepadconnected", event => {
    activeGamepadIndex = event.gamepad.index;
    showControllerConnected(event.gamepad);
});

window.addEventListener("gamepaddisconnected", event => {
    if (activeGamepadIndex === event.gamepad.index) {
        activeGamepadIndex = null;
    }
    controllerStatus.textContent = "Controller disconnected.";
    controllerStatus.classList.remove("connected");
});

document.addEventListener("keydown", event => {
    if (modeSelect.value !== "keyboard") return;

    if (isAimKey(event.key) || event.code === "Space" || event.key.toLowerCase() === "r") {
        event.preventDefault();
    }

    if (isAimKey(event.key)) {
        pressedKeys.add(normalizeKey(event.key));
    }

    if (!event.repeat && (event.code === "Space" || event.key.toLowerCase() === "r")) {
        throwKnife();
    }
});

document.addEventListener("keyup", event => {
    if (modeSelect.value !== "keyboard") return;
    if (isAimKey(event.key)) {
        pressedKeys.delete(normalizeKey(event.key));
    }
});

arena.addEventListener("pointerdown", event => {
    if (modeSelect.value !== "keyboard" || !gameRunning || drillComplete) return;
    const rect = arena.getBoundingClientRect();
    crosshairX = clamp(((event.clientX - rect.left) / rect.width) * 100, 3, 97);
    crosshairY = clamp(((event.clientY - rect.top) / rect.height) * 100, 5, 95);
    renderCrosshair();
});

function startPractice() {
    const thisSequence = ++startSequenceId;

    clearAllTimers();
    stopAnimationLoop();
    clearTarget();
    knifeLayer.innerHTML = "";

    gameRunning = false;
    drillComplete = false;
    roundLocked = true;
    knifeIsReady = true;
    lastR1Pressed = false;
    lastPsHomePressed = false;
    lastFrameTime = null;
    pressedKeys.clear();
    drillLength = drillLengthSelect.value;

    hits = 0;
    throwsMade = 0;
    escaped = 0;
    centerHits = 0;
    roundsCompleted = 0;
    streak = 0;
    bestStreak = 0;
    totalReactionMs = 0;
    reactionCount = 0;

    crosshairX = 50;
    crosshairY = 50;
    renderCrosshair();
    updateScoreboard();
    updateKnifeReady(true);
    hideHitMarker();

    gameArea.classList.remove("hidden");
    startBtn.disabled = true;
    startBtn.textContent = "Starting...";
    arena.focus({ preventScroll: true });

    logPracticeStart();
    runCountdown(thisSequence);
}

function runCountdown(sequenceId) {
    countdown.classList.remove("hidden");
    countdown.textContent = "3";
    setFeedback("Get ready. Aim with the right stick and throw with R1.", "info");

    countdownTimers.push(setTimeout(() => {
        if (sequenceId !== startSequenceId) return;
        countdown.textContent = "2";
    }, 1000));

    countdownTimers.push(setTimeout(() => {
        if (sequenceId !== startSequenceId) return;
        countdown.textContent = "1";
    }, 2000));

    countdownTimers.push(setTimeout(() => {
        if (sequenceId !== startSequenceId) return;
        countdown.classList.add("hidden");
        countdown.textContent = "";
        gameRunning = true;
        roundLocked = false;
        startBtn.disabled = false;
        startBtn.textContent = "Restart Practice";
        startAnimationLoop();
        spawnNextTarget();
    }, 3000));
}

function spawnNextTarget() {
    if (!gameRunning || drillComplete) return;

    clearTarget();
    roundLocked = false;

    const selectedDrill = drillTypeSelect.value;
    const actualDrill = selectedDrill === "mixed"
        ? chooseRandom(["moving", "peek", "stationary"])
        : selectedDrill;

    const target = document.createElement("div");
    target.className = `target ${TARGET_SCALE[targetSizeSelect.value] || ""}`.trim();
    target.innerHTML = `
        <div class="target-head"></div>
        <div class="target-body"><div class="target-center"></div></div>
    `;
    targetLayer.appendChild(target);

    const now = performance.now();
    const speed = SPEED_SETTINGS[targetSpeedSelect.value] || SPEED_SETTINGS.normal;
    const sizePadding = targetSizeSelect.value === "large" ? 7 : targetSizeSelect.value === "small" ? 4 : 5;

    activeTarget = {
        element: target,
        kind: actualDrill,
        x: 50,
        y: 45,
        vx: 0,
        spawnedAt: now,
        deadlineAt: now + speed.visible,
        throwable: true,
        resolved: false,
        sizePadding,
    };

    if (actualDrill === "moving") {
        const fromLeft = Math.random() >= 0.5;
        activeTarget.x = fromLeft ? -7 : 107;
        activeTarget.y = randomBetween(25, 60);
        activeTarget.vx = (fromLeft ? 1 : -1) * speed.moving;
        activeTarget.deadlineAt = Number.POSITIVE_INFINITY;
        setFeedback("Moving target — track it, settle the aim, then press R1.", "info");
    } else if (actualDrill === "peek") {
        const cover = chooseRandom(PEEK_COVERS);
        const direction = cover.x < 40 ? 1 : cover.x > 60 ? -1 : (Math.random() > 0.5 ? 1 : -1);
        activeTarget.hiddenX = cover.x;
        activeTarget.exposedX = cover.x + direction * randomBetween(8.5, 11.5);
        activeTarget.x = activeTarget.hiddenX;
        activeTarget.y = cover.y;
        activeTarget.peekSlideMs = 230;
        activeTarget.peekHoldMs = speed.peekHold;
        activeTarget.peekTotalMs = activeTarget.peekSlideMs * 2 + activeTarget.peekHoldMs;
        activeTarget.deadlineAt = now + activeTarget.peekTotalMs;
        activeTarget.throwable = false;
        setFeedback("Quick peek — wait until the target clears cover, then throw.", "info");
    } else {
        activeTarget.x = randomBetween(12, 88);
        activeTarget.y = randomBetween(23, 59);
        activeTarget.deadlineAt = now + speed.visible;
        setFeedback("Target up — aim and press R1.", "info");
    }

    renderTarget();
}

function startAnimationLoop() {
    stopAnimationLoop();

    const loop = timestamp => {
        if (!gameRunning) return;

        const deltaMs = lastFrameTime === null
            ? 0
            : Math.min(50, Math.max(0, timestamp - lastFrameTime));
        lastFrameTime = timestamp;

        updateInput(deltaMs);
        updateTarget(timestamp, deltaMs);
        animationId = requestAnimationFrame(loop);
    };

    animationId = requestAnimationFrame(loop);
}

function stopAnimationLoop() {
    if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    lastFrameTime = null;
}

function updateInput(deltaMs) {
    if (modeSelect.value === "keyboard") {
        const vector = getKeyboardAimVector();
        moveCrosshair(vector.x, vector.y, deltaMs);
        aimStatus.textContent = vector.x || vector.y ? "Keyboard aim: moving" : "Keyboard aim: ready";
        return;
    }

    const gamepad = getActiveGamepad();
    if (!gamepad) {
        controllerStatus.textContent = "No controller detected. Press a controller button.";
        controllerStatus.classList.remove("connected");
        r1Status.textContent = "R1: waiting for controller";
        return;
    }

    showControllerConnected(gamepad);

    // Return to the WURD homepage when the browser exposes the
    // DualSense PS/Home button as standard Gamepad button 16.
    const psHomePressed = Boolean(gamepad.buttons[PS_HOME_BUTTON_INDEX]?.pressed);

    if (psHomePressed && !lastPsHomePressed) {
        window.location.assign(WURD_HOME_URL);
        return;
    }

    lastPsHomePressed = psHomePressed;

    const rawX = gamepad.axes[RIGHT_STICK_X_AXIS] || 0;
    const rawY = gamepad.axes[RIGHT_STICK_Y_AXIS] || 0;
    const vector = applyRadialDeadzone(rawX, rawY, STICK_DEADZONE);
    moveCrosshair(vector.x, vector.y, deltaMs);

    const magnitude = Math.hypot(vector.x, vector.y);
    aimStatus.textContent = magnitude > 0.05
        ? `Right stick: aiming (${vector.x.toFixed(2)}, ${vector.y.toFixed(2)})`
        : "Right stick: centered";

    const r1Pressed = Boolean(gamepad.buttons[R1_BUTTON_INDEX]?.pressed);
    r1Status.textContent = r1Pressed ? "R1: pressed" : (knifeIsReady ? "R1: ready" : "R1: recovering");
    r1Status.classList.toggle("active", r1Pressed);

    if (r1Pressed && !lastR1Pressed) {
        throwKnife();
    }

    lastR1Pressed = r1Pressed;
}

function moveCrosshair(x, y, deltaMs) {
    if (!gameRunning || drillComplete || deltaMs <= 0) return;

    const speed = AIM_SPEED[sensitivitySelect.value] || AIM_SPEED.normal;
    crosshairX = clamp(crosshairX + x * speed * (deltaMs / 1000), 2.5, 97.5);
    crosshairY = clamp(crosshairY + y * speed * (deltaMs / 1000), 4, 96);
    renderCrosshair();
}

function updateTarget(timestamp, deltaMs) {
    if (!activeTarget || activeTarget.resolved || roundLocked) return;

    if (activeTarget.kind === "moving") {
        activeTarget.x += activeTarget.vx * (deltaMs / 1000);
        renderTarget();

        if (activeTarget.x < -9 || activeTarget.x > 109) {
            handleTargetEscape("The moving target escaped.");
        }
        return;
    }

    if (activeTarget.kind === "peek") {
        const elapsed = timestamp - activeTarget.spawnedAt;
        const slide = activeTarget.peekSlideMs;
        const holdEnd = slide + activeTarget.peekHoldMs;

        if (elapsed < slide) {
            const progress = easeOut(clamp(elapsed / slide, 0, 1));
            activeTarget.x = lerp(activeTarget.hiddenX, activeTarget.exposedX, progress);
            activeTarget.throwable = progress >= 0.68;
        } else if (elapsed < holdEnd) {
            activeTarget.x = activeTarget.exposedX;
            activeTarget.throwable = true;
        } else if (elapsed < activeTarget.peekTotalMs) {
            const progress = easeIn(clamp((elapsed - holdEnd) / slide, 0, 1));
            activeTarget.x = lerp(activeTarget.exposedX, activeTarget.hiddenX, progress);
            activeTarget.throwable = progress <= 0.35;
        } else {
            handleTargetEscape("The target returned behind cover.");
            return;
        }

        renderTarget();
        return;
    }

    if (timestamp >= activeTarget.deadlineAt) {
        handleTargetEscape("Too slow — the target dropped.");
    }
}

function throwKnife() {
    if (!gameRunning || drillComplete || roundLocked || !activeTarget || activeTarget.resolved) return;

    if (!knifeIsReady) {
        setFeedback("Knife is still recovering. Do not spam R1.", "bad");
        return;
    }

    roundLocked = true;
    throwsMade += 1;
    roundsCompleted += 1;
    updateKnifeReady(false);
    animateKnifeThrow();

    const reactionMs = Math.max(0, Math.round(performance.now() - activeTarget.spawnedAt));
    totalReactionMs += reactionMs;
    reactionCount += 1;

    const hitResult = evaluateHit();

    if (!activeTarget.throwable) {
        handleThrowResult(false, false, reactionMs, "Too early — the target was still behind cover.");
    } else if (hitResult.hit) {
        handleThrowResult(true, hitResult.center, reactionMs, hitResult.center
            ? `Center hit — ${reactionMs} ms!`
            : `Hit — ${reactionMs} ms.`);
    } else {
        handleThrowResult(false, false, reactionMs, "Miss. Settle the crosshair before pressing R1.");
    }
}

function evaluateHit() {
    if (!activeTarget?.element) return { hit: false, center: false };

    const arenaRect = arena.getBoundingClientRect();
    const targetRect = activeTarget.element.getBoundingClientRect();
    const aimX = arenaRect.left + (crosshairX / 100) * arenaRect.width;
    const aimY = arenaRect.top + (crosshairY / 100) * arenaRect.height;
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height * 0.53;

    const radiusX = targetRect.width * 0.47;
    const radiusY = targetRect.height * 0.49;
    const normalizedX = (aimX - targetCenterX) / radiusX;
    const normalizedY = (aimY - targetCenterY) / radiusY;
    const distance = Math.hypot(normalizedX, normalizedY);

    return {
        hit: distance <= 1,
        center: distance <= 0.27,
    };
}

function handleThrowResult(didHit, wasCenter, reactionMs, message) {
    if (!activeTarget) return;

    activeTarget.resolved = true;

    if (didHit) {
        hits += 1;
        streak += 1;
        bestStreak = Math.max(bestStreak, streak);
        activeTarget.element.classList.add("hit");
        if (wasCenter) centerHits += 1;
        showHitMarker(wasCenter);
        playSound(perfectSound);
        setFeedback(message, "good");
    } else {
        streak = 0;
        activeTarget.element.classList.add("missed");
        playSound(wrongSound);
        setFeedback(message, "bad");
    }

    updateScoreboard();

    if (shouldFinishDrill()) {
        nextTargetTimer = setTimeout(finishPractice, 650);
    } else {
        nextTargetTimer = setTimeout(spawnNextTarget, NEXT_TARGET_DELAY_MS);
    }
}

function handleTargetEscape(message) {
    if (!activeTarget || activeTarget.resolved || roundLocked) return;

    roundLocked = true;
    activeTarget.resolved = true;
    escaped += 1;
    roundsCompleted += 1;
    streak = 0;
    activeTarget.element.classList.add("escaped");
    playSound(wrongSound);
    setFeedback(message, "bad");
    updateScoreboard();

    if (shouldFinishDrill()) {
        nextTargetTimer = setTimeout(finishPractice, 650);
    } else {
        nextTargetTimer = setTimeout(spawnNextTarget, NEXT_TARGET_DELAY_MS);
    }
}

function finishPractice() {
    gameRunning = false;
    drillComplete = true;
    roundLocked = true;
    stopAnimationLoop();
    clearTarget();
    updateKnifeReady(true);

    const accuracy = throwsMade > 0 ? Math.round((hits / throwsMade) * 100) : 0;
    const averageReaction = reactionCount > 0 ? Math.round(totalReactionMs / reactionCount) : null;

    setFeedback(
        `Complete: ${hits} hits, ${accuracy}% accuracy, best streak ${bestStreak}. Press Restart Practice to go again.`,
        "good"
    );

    logPracticeResult({ accuracy, averageReaction });
}

function shouldFinishDrill() {
    if (drillLength === "free") return false;
    const targetCount = parseInt(drillLength, 10);
    return Number.isFinite(targetCount) && roundsCompleted >= targetCount;
}

function animateKnifeThrow() {
    crosshair.classList.add("throwing");
    setTimeout(() => crosshair.classList.remove("throwing"), 160);

    const knife = document.createElement("div");
    knife.className = "knife-projectile";
    knifeLayer.appendChild(knife);

    const dx = crosshairX - 50;
    const dy = crosshairY - 91;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;

    requestAnimationFrame(() => {
        knife.style.left = `${crosshairX}%`;
        knife.style.top = `${crosshairY}%`;
        knife.style.transform = `translate(-50%, -50%) rotate(${angle + 480}deg)`;
        knife.style.opacity = "0";
    });

    setTimeout(() => knife.remove(), 260);
}

function updateKnifeReady(isReady) {
    knifeIsReady = isReady;
    clearTimeout(knifeRecoveryTimer);

    if (isReady) {
        knifeReady.classList.add("ready");
        knifeReady.classList.remove("recovering");
        knifeReadyText.textContent = "Knife ready — press R1";
        return;
    }

    knifeReady.classList.remove("ready");
    knifeReady.classList.add("recovering");
    knifeReadyText.textContent = "Recovering knife...";

    knifeRecoveryTimer = setTimeout(() => {
        knifeIsReady = true;
        knifeReady.classList.add("ready");
        knifeReady.classList.remove("recovering");
        knifeReadyText.textContent = "Knife ready — press R1";
    }, KNIFE_RECOVERY_MS);
}

function showHitMarker(wasCenter) {
    hideHitMarker();
    hitMarker.style.left = `${crosshairX}%`;
    hitMarker.style.top = `${crosshairY}%`;
    hitMarker.classList.toggle("center-hit", wasCenter);
    hitMarker.classList.remove("hidden");

    hitMarkerTimer = setTimeout(hideHitMarker, 260);
}

function hideHitMarker() {
    clearTimeout(hitMarkerTimer);
    hitMarker.classList.add("hidden");
    hitMarker.classList.remove("center-hit");
}

function renderCrosshair() {
    crosshair.style.left = `${crosshairX}%`;
    crosshair.style.top = `${crosshairY}%`;
}

function renderTarget() {
    if (!activeTarget?.element) return;
    activeTarget.element.style.left = `${activeTarget.x}%`;
    activeTarget.element.style.top = `${activeTarget.y}%`;
}

function clearTarget() {
    if (activeTarget?.element) {
        activeTarget.element.remove();
    }
    targetLayer.innerHTML = "";
    activeTarget = null;
}

function updateScoreboard() {
    const accuracy = throwsMade > 0 ? Math.round((hits / throwsMade) * 100) : 0;
    const averageReaction = reactionCount > 0 ? Math.round(totalReactionMs / reactionCount) : null;

    hitsEl.textContent = String(hits);
    throwsEl.textContent = String(throwsMade);
    accuracyEl.textContent = `${accuracy}%`;
    escapedEl.textContent = String(escaped);
    averageReactionEl.textContent = averageReaction === null ? "--" : `${averageReaction} ms`;
    centerHitsEl.textContent = String(centerHits);
    streakEl.textContent = String(streak);
    bestStreakEl.textContent = String(bestStreak);
    roundsCompletedEl.textContent = String(roundsCompleted);
    roundGoalEl.textContent = drillLength === "free" ? "" : ` / ${drillLength}`;
}

function updateInputHelp() {
    const keyboardMode = modeSelect.value === "keyboard";
    keyboardHelp.classList.toggle("hidden", !keyboardMode);

    if (keyboardMode) {
        controllerStatus.textContent = "Keyboard test mode selected.";
        controllerStatus.classList.remove("connected");
        r1Status.textContent = "Throw: Space or R";
        return;
    }

    const gamepad = getActiveGamepad();
    if (gamepad) {
        showControllerConnected(gamepad);
    } else {
        controllerStatus.textContent = "Waiting for controller...";
        controllerStatus.classList.remove("connected");
    }
    r1Status.textContent = "R1: ready";
}

function showControllerConnected(gamepad) {
    controllerStatus.textContent = `Controller connected: ${gamepad.id}`;
    controllerStatus.classList.add("connected");
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

function getKeyboardAimVector() {
    let x = 0;
    let y = 0;

    if (pressedKeys.has("a") || pressedKeys.has("arrowleft")) x -= 1;
    if (pressedKeys.has("d") || pressedKeys.has("arrowright")) x += 1;
    if (pressedKeys.has("w") || pressedKeys.has("arrowup")) y -= 1;
    if (pressedKeys.has("s") || pressedKeys.has("arrowdown")) y += 1;

    const magnitude = Math.hypot(x, y);
    return magnitude > 1 ? { x: x / magnitude, y: y / magnitude } : { x, y };
}

function isAimKey(key) {
    return ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"]
        .includes(normalizeKey(key));
}

function normalizeKey(key) {
    return String(key).toLowerCase();
}

function applyRadialDeadzone(x, y, deadzone) {
    const magnitude = Math.hypot(x, y);
    if (magnitude <= deadzone) return { x: 0, y: 0 };

    const normalizedMagnitude = clamp((magnitude - deadzone) / (1 - deadzone), 0, 1);
    const scale = normalizedMagnitude / magnitude;
    return { x: x * scale, y: y * scale };
}

function toggleFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
        return;
    }

    arena.requestFullscreen().catch(error => {
        console.log("Fullscreen failed:", error);
    });
}

function setFeedback(message, type) {
    feedback.textContent = message;
    feedback.className = `feedback ${type || "info"}`;
}

function playSound(sound) {
    sound.currentTime = 0;
    sound.play().catch(error => {
        console.log("Practice sound failed:", error);
    });
}

function logPracticeStart() {
    fetch("/api/knife-practice-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            mode: modeSelect.value,
            drillType: drillTypeSelect.value,
            targetSpeed: targetSpeedSelect.value,
            targetSize: targetSizeSelect.value,
            sensitivity: sensitivitySelect.value,
            drillLength: drillLengthSelect.value,
        }),
    }).catch(error => {
        console.log("Knife practice start tracking failed:", error);
    });
}

function logPracticeResult({ accuracy, averageReaction }) {
    fetch("/api/knife-practice-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            mode: modeSelect.value,
            drillType: drillTypeSelect.value,
            targetSpeed: targetSpeedSelect.value,
            targetSize: targetSizeSelect.value,
            sensitivity: sensitivitySelect.value,
            drillLength: drillLengthSelect.value,
            hits,
            throws: throwsMade,
            escaped,
            centerHits,
            roundsCompleted,
            accuracy,
            averageReaction,
            bestStreak,
        }),
    }).catch(error => {
        console.log("Knife practice result tracking failed:", error);
    });
}

function clearAllTimers() {
    countdownTimers.forEach(timer => clearTimeout(timer));
    countdownTimers = [];
    clearTimeout(nextTargetTimer);
    clearTimeout(knifeRecoveryTimer);
    clearTimeout(hitMarkerTimer);
    nextTargetTimer = null;
    knifeRecoveryTimer = null;
    hitMarkerTimer = null;
}

function chooseRandom(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function randomBetween(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
}

function lerp(start, end, progress) {
    return start + (end - start) * progress;
}

function easeOut(value) {
    return 1 - Math.pow(1 - value, 3);
}

function easeIn(value) {
    return value * value * value;
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

renderCrosshair();
updateScoreboard();
updateInputHelp();
