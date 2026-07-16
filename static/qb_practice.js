const modeSelect = document.getElementById("modeSelect");
const startBtn = document.getElementById("startBtn");
const gameArea = document.getElementById("gameArea");
const targetButton = document.getElementById("targetButton");
const movingLine = document.getElementById("movingLine");
const feedback = document.getElementById("feedback");
const scoreEl = document.getElementById("score");
const attemptsEl = document.getElementById("attempts");
const accuracyEl = document.getElementById("accuracy");
const drillLengthSelect = document.getElementById("drillLengthSelect");
const speedSelect = document.getElementById("speedSelect");

// New display element. The tempoBtn fallback lets the current HTML keep working
// until you replace the old button with a normal display element.
const tempoDisplay =
    document.getElementById("tempoDisplay") ||
    document.getElementById("tempoBtn");

const perfectSound = new Audio("/static/sounds/perfect.mp3");
perfectSound.volume = 0.6;

const wrongSound = new Audio("/static/sounds/wrong.mp3");
wrongSound.volume = 0.5;

const knockSound = new Audio("/static/sounds/knock.mp3");
knockSound.volume = 0.40;

// Tempo is controlled manually now.
// A larger millisecond value is slower; a smaller value is faster.
const SLOWEST_TEMPO_MS = 1500;
const FASTEST_TEMPO_MS = 950;
const TEMPO_STEP_MS = 10;
const STARTING_TEMPO_MS = 1200;

const L2_BUTTON = 6;
const R2_BUTTON = 7;

let tempoMs = STARTING_TEMPO_MS;
let tempoTimerId = null;
let lastKnockTime = 0;
let pressedOnBeat = false;
let beatWindowMs = 400;

let currentTarget = null;
let linePosition = 0;
let lineSpeed = 4.4;
let gameRunning = false;
let animationId = null;
let lineMoving = false;

let drillLength = "free";
let drillComplete = false;

let score = 0;
let attempts = 0;

let pressedCorrectButton = false;
let lastControllerButtons = [];
let roundLocked = false;
let startSequenceId = 0;

// R1/RB remains a drill target. L2/R2 (LT/RT) are reserved for tempo control.
const ps5Buttons = [
    { label: "△", key: "w", controllerButton: 3, className: "symbol-triangle" },
    { label: "□", key: "a", controllerButton: 2, className: "symbol-square" },
    { label: "X", key: "s", controllerButton: 0, className: "symbol-x" },
    { label: "O", key: "d", controllerButton: 1, className: "symbol-circle" },
    { label: "R1", key: "e", controllerButton: 5, className: "symbol-r1" },
];

const xboxButtons = [
    { label: "Y", key: "w", controllerButton: 3, className: "symbol-triangle" },
    { label: "X", key: "a", controllerButton: 2, className: "symbol-square" },
    { label: "A", key: "s", controllerButton: 0, className: "symbol-x" },
    { label: "B", key: "d", controllerButton: 1, className: "symbol-circle" },
    { label: "RB", key: "e", controllerButton: 5, className: "symbol-r1" },
];

startBtn.addEventListener("click", startGame);

// Keyboard equivalents for tempo control:
// Left Arrow = slower, Right Arrow = faster.
// E remains available for the R1/RB drill target.
document.addEventListener("keydown", function(event) {
    if (!gameRunning || drillComplete) return;

    const mode = modeSelect.value;
    if (!mode.startsWith("keyboard")) return;

    if (event.key === "ArrowLeft") {
        event.preventDefault();
        decreaseTempo();
        return;
    }

    if (event.key === "ArrowRight") {
        event.preventDefault();
        increaseTempo();
        return;
    }

    const key = event.key.toLowerCase();
    const validKeys = getButtonSet().map(button => button.key);
    if (!validKeys.includes(key)) return;

    if (currentTarget && key === currentTarget.key && !pressedCorrectButton) {
        pressedCorrectButton = true;
        pressedOnBeat = isOnBeat();
        lineMoving = true;

        if (!pressedOnBeat) {
            feedback.textContent = "Good button, but missed the knock!";
        } else {
            feedback.textContent = "On beat! Release near the target zone!";
        }
    } else if (currentTarget && key !== currentTarget.key) {
        wrongButton();
    }
});

document.addEventListener("keyup", function(event) {
    if (!gameRunning) return;

    const mode = modeSelect.value;
    if (!mode.startsWith("keyboard")) return;

    const key = event.key.toLowerCase();

    if (currentTarget && key === currentTarget.key && pressedCorrectButton) {
        checkRelease();
    }
});

function startGame() {
    const thisStartSequence = ++startSequenceId;

    stopTempo();

    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    gameRunning = false;
    lineMoving = false;
    drillComplete = false;
    roundLocked = false;
    pressedCorrectButton = false;
    pressedOnBeat = false;
    lastControllerButtons = [];

    lineSpeed = parseFloat(speedSelect.value);
    drillLength = drillLengthSelect.value;

    score = 0;
    attempts = 0;
    updateScoreboard();

    // Every new drill starts at 1200 ms.
    tempoMs = STARTING_TEMPO_MS;
    updateTempoDisplay();

    fetch("/api/qb-practice-start", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            mode: modeSelect.value,
            speed: speedSelect.value,
            drillLength: drillLengthSelect.value
        })
    }).catch(error => {
        console.log("Practice tracking failed:", error);
    });

    gameArea.classList.remove("hidden");
    startBtn.disabled = true;
    startBtn.textContent = "Starting...";
    feedback.textContent = "Starting in 3...";

    setTimeout(() => {
        if (thisStartSequence !== startSequenceId) return;
        feedback.textContent = "Starting in 2...";
    }, 1000);

    setTimeout(() => {
        if (thisStartSequence !== startSequenceId) return;
        feedback.textContent = "Starting in 1...";
    }, 2000);

    setTimeout(() => {
        if (thisStartSequence !== startSequenceId) return;

        gameRunning = true;
        startBtn.disabled = false;
        startBtn.textContent = "Restart Practice";

        nextRound();
        startTempo();
        gameLoop();
    }, 3000);
}

function getButtonSet() {
    const mode = modeSelect.value;

    if (mode.includes("xbox")) {
        return xboxButtons;
    }

    return ps5Buttons;
}

function nextRound() {
    const buttons = getButtonSet();
    currentTarget = buttons[Math.floor(Math.random() * buttons.length)];

    targetButton.textContent = currentTarget.label;
    targetButton.className = "target-button " + currentTarget.className;

    feedback.textContent = "Press and hold " + currentTarget.label;

    linePosition = 0;
    movingLine.style.left = "0%";
    pressedCorrectButton = false;
    pressedOnBeat = false;
    lineMoving = false;
    roundLocked = false;
}

function gameLoop() {
    if (!gameRunning) return;

    if (lineMoving) {
        linePosition += lineSpeed;

        if (linePosition > 100 && !roundLocked) {
            roundLocked = true;
            lineMoving = false;
            attempts++;
            feedback.textContent = "Too late!";
            updateScoreboard();

            if (isDrillFinished()) {
                finishDrill();
            } else {
                setTimeout(nextRound, 700);
            }

            linePosition = 0;
        }

        movingLine.style.left = linePosition + "%";
    }

    checkControllerInput();
    animationId = requestAnimationFrame(gameLoop);
}

function checkRelease() {
    if (drillComplete || roundLocked) return;

    roundLocked = true;
    lineMoving = false;
    attempts++;

    // Target zone is 68% to 80%.
    // Results no longer change the tempo automatically.
    if (linePosition >= 68 && linePosition <= 80 && pressedOnBeat) {
        score++;
        feedback.textContent = "Perfect!";

        perfectSound.currentTime = 0;
        perfectSound.play().catch(error => {
            console.log("Perfect sound failed:", error);
        });
    } else if (linePosition >= 68 && linePosition <= 80 && !pressedOnBeat) {
        feedback.textContent = "Good release, but missed the beat!";
    } else if (linePosition >= 60 && linePosition < 68) {
        feedback.textContent = "Early!";
    } else if (linePosition > 80 && linePosition <= 88) {
        feedback.textContent = "Late!";
    } else if (linePosition > 88) {
        feedback.textContent = "Overthrown!";
    } else {
        feedback.textContent = "Way too early!";
    }

    updateScoreboard();

    if (isDrillFinished()) {
        finishDrill();
    } else {
        setTimeout(nextRound, 250);
    }
}

function wrongButton() {
    if (drillComplete || roundLocked) return;

    roundLocked = true;
    lineMoving = false;
    pressedCorrectButton = false;
    attempts++;

    feedback.textContent = "Wrong button!";

    // Wrong buttons no longer slow the tempo automatically.
    wrongSound.currentTime = 0;
    wrongSound.play().catch(error => {
        console.log("Wrong sound failed:", error);
    });

    updateScoreboard();

    if (isDrillFinished()) {
        finishDrill();
    } else {
        setTimeout(nextRound, 350);
    }
}

function isDrillFinished() {
    if (drillLength === "free") {
        return false;
    }

    return attempts >= parseInt(drillLength, 10);
}

function finishDrill() {
    drillComplete = true;
    gameRunning = false;
    lineMoving = false;
    stopTempo();

    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    const accuracy = attempts === 0 ? 0 : Math.round((score / attempts) * 100);

    feedback.textContent = `Drill Complete! Score: ${score}/${attempts} - Accuracy: ${accuracy}%`;
    startBtn.textContent = "Start New Drill";
}

function updateScoreboard() {
    scoreEl.textContent = score;
    attemptsEl.textContent = attempts;

    const accuracy = attempts === 0 ? 0 : Math.round((score / attempts) * 100);
    accuracyEl.textContent = accuracy + "%";
}

function checkControllerInput() {
    const mode = modeSelect.value;
    if (!mode.startsWith("controller")) return;

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gamepad = gamepads[0];

    if (!gamepad || drillComplete) return;

    handleTempoControllerButtons(gamepad);

    if (!currentTarget) return;

    const validButtons = getButtonSet().map(button => button.controllerButton);
    const correctButtonIndex = currentTarget.controllerButton;

    for (const buttonIndex of validButtons) {
        const button = gamepad.buttons[buttonIndex];
        if (!button) continue;

        const wasPressed = lastControllerButtons[buttonIndex] || false;
        const isPressed = button.pressed;

        if (isPressed && !wasPressed) {
            if (buttonIndex === correctButtonIndex && !pressedCorrectButton) {
                pressedCorrectButton = true;
                pressedOnBeat = isOnBeat();
                lineMoving = true;

                if (!pressedOnBeat) {
                    feedback.textContent = "Good button, but late on the beat!";
                } else {
                    feedback.textContent = "Release near the target zone!";
                }
            } else if (buttonIndex !== correctButtonIndex) {
                wrongButton();
            }
        }

        if (
            !isPressed &&
            wasPressed &&
            buttonIndex === correctButtonIndex &&
            pressedCorrectButton
        ) {
            checkRelease();
        }

        lastControllerButtons[buttonIndex] = isPressed;
    }
}

function handleTempoControllerButtons(gamepad) {
    const l2 = gamepad.buttons[L2_BUTTON];
    const r2 = gamepad.buttons[R2_BUTTON];

    if (l2) {
        const wasPressed = lastControllerButtons[L2_BUTTON] || false;
        const isPressed = l2.pressed;

        if (isPressed && !wasPressed) {
            decreaseTempo();
        }

        lastControllerButtons[L2_BUTTON] = isPressed;
    }

    if (r2) {
        const wasPressed = lastControllerButtons[R2_BUTTON] || false;
        const isPressed = r2.pressed;

        if (isPressed && !wasPressed) {
            increaseTempo();
        }

        lastControllerButtons[R2_BUTTON] = isPressed;
    }
}

// L2/LT decreases the tempo by making the interval longer (slower).
function decreaseTempo() {
    const oldTempo = tempoMs;
    tempoMs = Math.min(SLOWEST_TEMPO_MS, tempoMs + TEMPO_STEP_MS);

    if (tempoMs !== oldTempo) {
        restartTempoAfterChange();
    }

    updateTempoDisplay();
}

// R2/RT increases the tempo by making the interval shorter (faster).
function increaseTempo() {
    const oldTempo = tempoMs;
    tempoMs = Math.max(FASTEST_TEMPO_MS, tempoMs - TEMPO_STEP_MS);

    if (tempoMs !== oldTempo) {
        restartTempoAfterChange();
    }

    updateTempoDisplay();
}

function updateTempoDisplay() {
    if (!tempoDisplay) return;

    const mode = modeSelect.value;
    const shoulderLabels = mode.includes("xbox")
        ? "LT slower | RT faster"
        : "L2 slower | R2 faster";

    tempoDisplay.textContent = `Tempo: ${tempoMs}ms | ${shoulderLabels}`;

    // The old tempo button is now display-only.
    if (tempoDisplay.tagName === "BUTTON") {
        tempoDisplay.disabled = true;
    }
}

function startTempo() {
    stopTempo();

    if (!gameRunning) return;

    playKnock();
    tempoTimerId = setTimeout(tempoLoop, tempoMs);
}

function tempoLoop() {
    if (!gameRunning || drillComplete) {
        tempoTimerId = null;
        return;
    }

    playKnock();
    tempoTimerId = setTimeout(tempoLoop, tempoMs);
}

function restartTempoAfterChange() {
    stopTempo();

    if (!gameRunning || drillComplete) return;

    // Do not make an extra instant knock when the tempo changes.
    // Schedule the next knock using the new interval.
    tempoTimerId = setTimeout(tempoLoop, tempoMs);
}

function stopTempo() {
    if (tempoTimerId) {
        clearTimeout(tempoTimerId);
        tempoTimerId = null;
    }
}

function playKnock() {
    lastKnockTime = performance.now();

    knockSound.currentTime = 0;
    knockSound.play().catch(error => {
        console.log("Knock sound failed:", error);
    });
}

function isOnBeat() {
    const now = performance.now();
    const timeSinceLastKnock = now - lastKnockTime;
    const timeUntilNextKnock = tempoMs - timeSinceLastKnock;

    const nearestBeatDistance = Math.min(
        Math.abs(timeSinceLastKnock),
        Math.abs(timeUntilNextKnock)
    );

    return nearestBeatDistance <= beatWindowMs;
}

window.addEventListener("gamepadconnected", function(event) {
    feedback.textContent = "Controller connected: " + event.gamepad.id;
    updateTempoDisplay();
});

window.addEventListener("gamepaddisconnected", function() {
    feedback.textContent = "Controller disconnected.";
});

modeSelect.addEventListener("change", updateTempoDisplay);
updateTempoDisplay();
