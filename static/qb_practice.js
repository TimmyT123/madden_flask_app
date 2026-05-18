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

let currentTarget = null;
let linePosition = 0;
let lineSpeed = 4.2;
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
    { label: "△", key: "w", controllerButton: 3 },
    { label: "□", key: "a", controllerButton: 2 },
    { label: "X", key: "s", controllerButton: 0 },
    { label: "O", key: "d", controllerButton: 1 },
    { label: "R1", key: "e", controllerButton: 5 },
    { label: "L1", key: "q", controllerButton: 4 },
];

const xboxButtons = [
    { label: "Y", key: "w", controllerButton: 3 },
    { label: "X", key: "a", controllerButton: 2 },
    { label: "A", key: "s", controllerButton: 0 },
    { label: "B", key: "d", controllerButton: 1 },
    { label: "RB", key: "e", controllerButton: 5 },
    { label: "LB", key: "q", controllerButton: 4 },
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
        lineMoving = true;
        feedback.textContent = "Release near the target zone!";
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
    feedback.textContent = "Press and hold " + currentTarget.label;

    linePosition = 0;
    movingLine.style.left = "0%";
    pressedCorrectButton = false;
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
    if (linePosition >= 68 && linePosition <= 80) {
        score++;
        feedback.textContent = "Perfect!";
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
        setTimeout(nextRound, 700);
    }
}

function wrongButton() {
    if (drillComplete || roundLocked) return;

    roundLocked = true;
    lineMoving = false;
    pressedCorrectButton = false;
    attempts++;

    feedback.textContent = "Wrong button!";
    updateScoreboard();

    if (isDrillFinished()) {
        finishDrill();
    } else {
        setTimeout(nextRound, 700);
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
                lineMoving = true;
                feedback.textContent = "Release near the target zone!";
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

window.addEventListener("gamepadconnected", function(event) {
    feedback.textContent = "Controller connected: " + event.gamepad.id;
});

window.addEventListener("gamepaddisconnected", function() {
    feedback.textContent = "Controller disconnected.";
});
