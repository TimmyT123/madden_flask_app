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

const perfectSound = new Audio("/static/sounds/perfect.mp3");
perfectSound.volume = 0.7;

const wrongSound = new Audio("/static/sounds/wrong.mp3");
wrongSound.volume = 0.6;

const tempoBtn = document.getElementById("tempoBtn");

const knockSound = new Audio("/static/sounds/knock.mp3");
knockSound.volume = 0.40;

let tempoEnabled = false;
let tempoIntervalId = null;

let tempoMs = 1400;         // slower starting tempo
let minTempoMs = 450;       // fastest allowed
let maxTempoMs = 1800;      // slowest allowed

let perfectsNeededForSpeedUp = 4;
let tempoSpeedUpAmount = 100;
let tempoSlowDownAmount = 200;
let perfectsSinceSpeedUp = 0;
let lastKnockTime = 0;
let pressedOnBeat = false;
let beatWindowMs = 500; // how close to the knock the release must be

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

const ps5Buttons = [
    { label: "△", key: "w", controllerButton: 3, className: "symbol-triangle" },
    { label: "□", key: "a", controllerButton: 2, className: "symbol-square" },
    { label: "X", key: "s", controllerButton: 0, className: "symbol-x" },
    { label: "O", key: "d", controllerButton: 1, className: "symbol-circle" },
    { label: "R1", key: "e", controllerButton: 5, className: "symbol-r1" },
    { label: "L1", key: "q", controllerButton: 4, className: "symbol-l1" },
];

const xboxButtons = [
    { label: "Y", key: "w", controllerButton: 3, className: "symbol-triangle" },
    { label: "X", key: "a", controllerButton: 2, className: "symbol-square" },
    { label: "A", key: "s", controllerButton: 0, className: "symbol-x" },
    { label: "B", key: "d", controllerButton: 1, className: "symbol-circle" },
    { label: "RB", key: "e", controllerButton: 5, className: "symbol-r1" },
    { label: "LB", key: "q", controllerButton: 4, className: "symbol-l1" },
];

startBtn.addEventListener("click", startGame);

document.addEventListener("keydown", function(event) {
    if (!gameRunning || drillComplete) return;

    const mode = modeSelect.value;

    if (!mode.startsWith("keyboard")) return;

    const key = event.key.toLowerCase();
    const validKeys = getButtonSet().map(button => button.key);

    // Ignore keys that are not part of the drill controls
    if (!validKeys.includes(key)) return;

    if (currentTarget && key === currentTarget.key && !pressedCorrectButton) {
        pressedCorrectButton = true;
        pressedOnBeat = isOnBeat();
        lineMoving = true;

        if (tempoEnabled && !pressedOnBeat) {
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
    lineSpeed = parseFloat(speedSelect.value);
    drillLength = drillLengthSelect.value;
    drillComplete = false;

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

    score = 0;
    attempts = 0;
    updateScoreboard();

    tempoMs = 1400;
    perfectsSinceSpeedUp = 0;

    if (tempoEnabled) {
        startTempo();
    }

    gameArea.classList.remove("hidden");
    gameRunning = true;

    startBtn.textContent = "Restart Practice";

    nextRound();

    if (animationId) {
        cancelAnimationFrame(animationId);
    }

    gameLoop();
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

    // Target zone is 68% to 80%
    if (linePosition >= 68 && linePosition <= 80 && pressedOnBeat) {
        score++;
        perfectsSinceSpeedUp++;

        feedback.textContent = "Perfect!";

        perfectSound.currentTime = 0;
        perfectSound.play().catch(error => {
            console.log("Perfect sound failed:", error);
        });

        if (perfectsSinceSpeedUp >= perfectsNeededForSpeedUp) {
            perfectsSinceSpeedUp = 0;
            speedUpTempo();
        } else if (tempoEnabled) {
            tempoBtn.textContent = "Tempo: On - " + tempoMs + "ms | Perfects: " + perfectsSinceSpeedUp + "/" + perfectsNeededForSpeedUp;
        }
    } else if (linePosition >= 68 && linePosition <= 80 && !pressedOnBeat) {
        perfectsSinceSpeedUp = 0;
        feedback.textContent = "Good release, but missed the beat!";
        slowDownTempo();
    } else if (linePosition >= 60 && linePosition < 68) {
        perfectsSinceSpeedUp = 0;
        feedback.textContent = "Early!";
    } else if (linePosition > 80 && linePosition <= 88) {
        perfectsSinceSpeedUp = 0;
        feedback.textContent = "Late!";
    } else if (linePosition > 88) {
        perfectsSinceSpeedUp = 0;
        feedback.textContent = "Overthrown!";
    } else {
        perfectsSinceSpeedUp = 0;
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

    perfectsSinceSpeedUp = 0;
    slowDownTempo();

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

    return attempts >= parseInt(drillLength);
}

function finishDrill() {
    drillComplete = true;
    gameRunning = false;
    lineMoving = false;

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

    if (!gamepad || !currentTarget || drillComplete) return;

    const validButtons = getButtonSet().map(button => button.controllerButton);
    const correctButtonIndex = currentTarget.controllerButton;

    for (const buttonIndex of validButtons) {
        const button = gamepad.buttons[buttonIndex];
        if (!button) continue;

        const wasPressed = lastControllerButtons[buttonIndex] || false;
        const isPressed = button.pressed;

        // Button was just pressed
        if (isPressed && !wasPressed) {
            if (buttonIndex === correctButtonIndex && !pressedCorrectButton) {
                pressedCorrectButton = true;
                pressedOnBeat = isOnBeat();
                lineMoving = true;

                if (tempoEnabled && !pressedOnBeat) {
                    feedback.textContent = "Good button, but late on the beat!";
                } else {
                    feedback.textContent = "Release near the target zone!";
                }
            } else if (buttonIndex !== correctButtonIndex) {
                wrongButton();
            }
        }

        // Correct button was just released
        if (!isPressed && wasPressed && buttonIndex === correctButtonIndex && pressedCorrectButton) {
            checkRelease();
        }

        lastControllerButtons[buttonIndex] = isPressed;
    }
}

tempoBtn.addEventListener("click", toggleTempo);

function toggleTempo() {
    tempoEnabled = !tempoEnabled;

    if (tempoEnabled) {
        tempoBtn.textContent = "Tempo: On - " + tempoMs + "ms";
        playKnock();
        startTempo();
    } else {
        tempoBtn.textContent = "Tempo: Off";
        stopTempo();
    }
}

function restartTempoAfterChange() {
    stopTempo();

    if (!tempoEnabled) return;

    tempoIntervalId = setInterval(() => {
        playKnock();
    }, tempoMs);
}

function startTempo() {
    stopTempo();

    if (!tempoEnabled) return;

    tempoIntervalId = setInterval(() => {
        playKnock();
    }, tempoMs);
}

function stopTempo() {
    if (tempoIntervalId) {
        clearInterval(tempoIntervalId);
        tempoIntervalId = null;
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
    if (!tempoEnabled) {
        return true; // normal mode still works without tempo
    }

    const now = performance.now();
    const timeSinceKnock = now - lastKnockTime;

    return timeSinceKnock <= beatWindowMs;
}

function speedUpTempo() {
    tempoMs = Math.max(minTempoMs, tempoMs - tempoSpeedUpAmount);
    tempoBtn.textContent = "Tempo: On - " + tempoMs + "ms";

    restartTempoAfterChange();
}

function slowDownTempo() {
    tempoMs = Math.min(maxTempoMs, tempoMs + tempoSlowDownAmount);
    tempoBtn.textContent = "Tempo: On - " + tempoMs + "ms";

    restartTempoAfterChange();
}

window.addEventListener("gamepadconnected", function(event) {
    feedback.textContent = "Controller connected: " + event.gamepad.id;
});

window.addEventListener("gamepaddisconnected", function() {
    feedback.textContent = "Controller disconnected.";
});
