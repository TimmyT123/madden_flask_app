(() => {
    "use strict";

    const START_BUTTON = 12; // D-pad Up
    const PAUSE_BUTTON = 13; // D-pad Down

    let activeGamepadIndex = null;
    let previousButtons = [];
    let paused = false;
    let pauseStartedAt = 0;

    function isPressed(button) {
        return Boolean(
            button &&
            (button.pressed || button.value > 0.5)
        );
    }

    function sendEvent(name, detail = {}) {
        window.dispatchEvent(
            new CustomEvent(name, {
                detail
            })
        );
    }

    function createPauseOverlay() {
        if (document.getElementById("wurd-practice-pause-overlay")) {
            return;
        }

        const overlay = document.createElement("div");
        overlay.id = "wurd-practice-pause-overlay";
        overlay.innerHTML = `
            <div class="wurd-pause-box">
                <div class="wurd-pause-title">PAUSED</div>
                <div class="wurd-pause-text">
                    Press the pause button to resume
                </div>
            </div>
        `;

        Object.assign(overlay.style, {
            display: "none",
            position: "fixed",
            inset: "0",
            zIndex: "99999",
            background: "rgba(0, 0, 0, 0.72)",
            alignItems: "center",
            justifyContent: "center"
        });

        const style = document.createElement("style");
        style.textContent = `
            #wurd-practice-pause-overlay .wurd-pause-box {
                background: #151515;
                border: 2px solid #22c55e;
                border-radius: 12px;
                padding: 28px 40px;
                text-align: center;
                color: #ffffff;
                box-shadow: 0 10px 35px rgba(0, 0, 0, 0.55);
            }

            #wurd-practice-pause-overlay .wurd-pause-title {
                font-size: 38px;
                font-weight: bold;
                margin-bottom: 8px;
            }

            #wurd-practice-pause-overlay .wurd-pause-text {
                color: #cccccc;
                font-size: 17px;
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(overlay);
    }

    function showPauseOverlay(show) {
        createPauseOverlay();

        const overlay = document.getElementById(
            "wurd-practice-pause-overlay"
        );

        overlay.style.display = show ? "flex" : "none";
    }

    function setPaused(value) {
        const nextValue = Boolean(value);

        if (paused === nextValue) {
            return;
        }

        let pausedFor = 0;

        if (nextValue) {
            pauseStartedAt = performance.now();
        } else if (pauseStartedAt) {
            pausedFor = performance.now() - pauseStartedAt;
            pauseStartedAt = 0;
        }

        paused = nextValue;
        document.body.classList.toggle("practice-paused", paused);
        showPauseOverlay(paused);

        sendEvent("wurd:practice-pause", {
            paused,
            pausedFor
        });
    }

    function togglePaused() {
        setPaused(!paused);
    }

    function getActiveGamepad() {
        const gamepads = navigator.getGamepads
            ? navigator.getGamepads()
            : [];

        if (
            activeGamepadIndex !== null &&
            gamepads[activeGamepadIndex]
        ) {
            return gamepads[activeGamepadIndex];
        }

        const gamepad = Array.from(gamepads).find(Boolean);

        if (!gamepad) {
            activeGamepadIndex = null;
            previousButtons = [];
            return null;
        }

        activeGamepadIndex = gamepad.index;
        previousButtons = new Array(gamepad.buttons.length).fill(false);

        return gamepad;
    }

    function handleNewButtonPress(buttonIndex) {
        // D-pad Up starts the practice
        if (buttonIndex === START_BUTTON) {
            sendEvent("wurd:practice-start");
            return;
        }

        // D-pad Down pauses or resumes
        if (buttonIndex === PAUSE_BUTTON) {
            togglePaused();
        }
    }

    function controllerLoop() {
        const gamepad = getActiveGamepad();

        if (gamepad) {
            const currentButtons = gamepad.buttons.map(isPressed);

            currentButtons.forEach((buttonIsPressed, index) => {
                const wasPressed = previousButtons[index] || false;
                const justPressed = buttonIsPressed && !wasPressed;

                if (justPressed) {
                    handleNewButtonPress(index, gamepad);
                }
            });

            previousButtons = currentButtons;
        }

        requestAnimationFrame(controllerLoop);
    }

    window.WurdPracticeControls = {
        isPaused() {
            return paused;
        },

        setPaused,

        reset() {
            setPaused(false);
        }
    };

    window.addEventListener("gamepaddisconnected", event => {
        if (event.gamepad.index === activeGamepadIndex) {
            activeGamepadIndex = null;
            previousButtons = [];
        }
    });

    document.addEventListener("DOMContentLoaded", createPauseOverlay);

    requestAnimationFrame(controllerLoop);
})();
