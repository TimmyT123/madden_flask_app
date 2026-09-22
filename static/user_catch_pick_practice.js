// VERSION 14: selectable pre-snap routes + adjustable cut depth + ball-spot catch grading
// Catch success now requires BOTH: release in the green timing zone AND receiver inside the target.
// Safe-lead guidance has been removed. Route and cut-depth controls are injected by this script.
(() => {
    "use strict";

    // Offense field geometry: show exactly 0-40 yards past the line of scrimmage
    // across the full practice canvas so catch depth is easy to judge.
    const OFFENSE_LOS_Y = 540;
    const OFFENSE_FIELD_TOP_Y = 40;
    const OFFENSE_FIELD_YARDS = 40;
    const OFFENSE_PIXELS_PER_YARD = (OFFENSE_LOS_Y - OFFENSE_FIELD_TOP_Y) / OFFENSE_FIELD_YARDS;

    const canvas = document.getElementById("practiceCanvas");
    const ctx = canvas.getContext("2d");

    const ui = {
        mode: document.getElementById("modeSelect"),
        difficulty: document.getElementById("difficultySelect"),
        catchMeterMin: document.getElementById("catchMeterMinSelect"),
        reps: document.getElementById("repsSelect"),
        start: document.getElementById("startBtn"),
        reset: document.getElementById("resetBtn"),
        controller: document.getElementById("controllerStatus"),
        instruction: document.getElementById("instructionText"),
        timing: document.getElementById("timingMessage"),
        rep: document.getElementById("repValue"),
        score: document.getElementById("scoreValue"),
        success: document.getElementById("successValue"),
        streak: document.getElementById("streakValue"),
        placement: document.getElementById("placementFeedback"),
        switching: document.getElementById("switchFeedback"),
        movement: document.getElementById("movementFeedback"),
        catching: document.getElementById("catchFeedback")
    };

    const BUTTONS = {
        X: 0,
        CIRCLE: 1,
        SQUARE: 2,
        TRIANGLE: 3,
        L1: 4,
        R1: 5,
        L2: 6,
        DPAD_LEFT: 14,
        DPAD_RIGHT: 15
    };

    const BUTTON_LABELS = {
        X: "X",
        CIRCLE: "Circle",
        SQUARE: "Square",
        TRIANGLE: "Triangle",
        L1: "L1",
        R1: "R1"
    };

    const BUTTON_SYMBOLS = {
        X: "✕",
        CIRCLE: "○",
        SQUARE: "□",
        TRIANGLE: "△",
        L1: "L1",
        R1: "R1"
    };

    const THROW_BUTTONS = ["X", "SQUARE", "TRIANGLE", "R1"];

    // DualSense PS/Home button in the standard browser Gamepad mapping.
    // Keep this independent of drill length so Infinite practice can always exit.
    const PS_HOME_BUTTON_INDEX = 16;
    const WURD_HOME_URL = "/";
    const THROW_METER_DURATION_MS = 820;
    const LOB_MAX_HOLD_MS = 165;
    const TOUCH_MAX_HOLD_MS = 500;
    const CATCH_METER_MIN_STORAGE_KEY = "wurdCatchMeterMinYards";
    const ROUTE_TYPE_STORAGE_KEY = "wurdCatchRouteType";
    const ROUTE_CUT_STORAGE_KEY = "wurdCatchRouteCutYards";
    const OFFENSE_ROUTE_TYPES = ["go", "out", "in", "dig", "post", "corner"];

    const DIFFICULTIES = {
        rookie: {
            label: "Rookie",
            ballSpeed: 360,
            routeSpeed: 57,
            steerSpeed: 205,
            catchRadius: 68,
            catchMeterDuration: 870,
            catchSweetStart: 0.52,
            catchSweetEnd: 0.78,
            catchReadyProgress: 0.44,
            switchStart: 0.12,
            switchEnd: 0.80,
            guideStrength: 1,
            resultDelay: 1900
        },
        pro: {
            label: "Pro",
            ballSpeed: 430,
            routeSpeed: 65,
            steerSpeed: 220,
            catchRadius: 55,
            catchMeterDuration: 675,
            catchSweetStart: 0.56,
            catchSweetEnd: 0.76,
            catchReadyProgress: 0.50,
            switchStart: 0.20,
            switchEnd: 0.70,
            guideStrength: 0.78,
            resultDelay: 1700
        },
        allPro: {
            label: "All-Pro",
            ballSpeed: 505,
            routeSpeed: 81,
            steerSpeed: 235,
            catchRadius: 44,
            catchMeterDuration: 565,
            catchSweetStart: 0.59,
            catchSweetEnd: 0.75,
            catchReadyProgress: 0.55,
            switchStart: 0.27,
            switchEnd: 0.62,
            guideStrength: 0.36,
            resultDelay: 1500
        },
        allMadden: {
            label: "All-Madden",
            ballSpeed: 585,
            routeSpeed: 74,
            steerSpeed: 248,
            catchRadius: 36,
            catchMeterDuration: 490,
            catchSweetStart: 0.61,
            catchSweetEnd: 0.74,
            catchReadyProgress: 0.59,
            switchStart: 0.33,
            switchEnd: 0.57,
            guideStrength: 0,
            resultDelay: 1350
        }
    };

    const state = {
        running: false,
        mode: "offense",
        difficultyKey: "pro",
        catchMeterMinYards: 5,
        totalReps: 10,
        completedReps: 0,
        successCount: 0,
        streak: 0,
        totalScore: 0,
        phase: "idle",
        rep: null,
        lastTime: performance.now(),
        nextRepAt: 0,
        previousButtons: [],
        keyboardButtons: new Set(),
        keyboardPressed: new Set(),
        keyboardReleased: new Set(),
        keysDown: new Set(),
        gamepadIndex: null,
        psHomeDown: false,
        flash: null,
        paused: false,
        pauseStartedAt: 0,
        routeType: "out",
        routeCutYards: 10
    };

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const lerp = (a, b, t) => a + (b - a) * t;
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const randomChoice = items => items[Math.floor(Math.random() * items.length)];
    const randomRange = (min, max) => min + Math.random() * (max - min);

    function normalize(x, y) {
        const length = Math.hypot(x, y) || 1;
        return { x: x / length, y: y / length };
    }

    function currentDifficulty() {
        return DIFFICULTIES[state.difficultyKey];
    }

    function loadOffenseRouteSettings() {
        try {
            const savedRoute = localStorage.getItem(ROUTE_TYPE_STORAGE_KEY);
            if (OFFENSE_ROUTE_TYPES.includes(savedRoute)) {
                state.routeType = savedRoute;
            }

            const savedCut = Number(localStorage.getItem(ROUTE_CUT_STORAGE_KEY));
            if (Number.isFinite(savedCut) && savedCut >= 3 && savedCut <= 40) {
                state.routeCutYards = Math.round(savedCut);
            }
        } catch (error) {
            // Defaults still work if localStorage is unavailable.
        }
    }

    function saveOffenseRouteSettings() {
        try {
            localStorage.setItem(ROUTE_TYPE_STORAGE_KEY, state.routeType);
            localStorage.setItem(ROUTE_CUT_STORAGE_KEY, String(state.routeCutYards));
        } catch (error) {
            // Settings still work for the current session.
        }
    }

    function selectedRouteSettings() {
        return {
            type: OFFENSE_ROUTE_TYPES.includes(state.routeType) ? state.routeType : "out",
            cutYards: clamp(Math.round(Number(state.routeCutYards) || 10), 3, 40)
        };
    }

    function applyPreSnapRouteSettings(rep) {
        if (!rep || rep.kind !== "offense" || rep.snapped) return;

        rep.routeType = state.routeType;
        rep.routeCutYards = state.routeCutYards;
        rep.receiver.routeType = state.routeType;
        rep.receiver.cutYards = state.routeCutYards;
        rep.receiver.cutMade = false;
        rep.receiver.x = rep.receiver.startX;
        rep.receiver.y = rep.receiver.startY;
        rep.receiver.vx = 0;
        rep.receiver.vy = -currentDifficulty().routeSpeed;

        const cutText = state.routeType === "go"
            ? ""
            : ` • cut at ${state.routeCutYards} yds`;

        setInstruction(
            `${state.routeType.toUpperCase()}${cutText}. L1/R1 changes route • D-pad Left/Right changes cut • X hikes.`
        );
    }

    function cyclePreSnapRoute(rep, direction) {
        const currentIndex = Math.max(0, OFFENSE_ROUTE_TYPES.indexOf(state.routeType));
        const nextIndex =
            (currentIndex + direction + OFFENSE_ROUTE_TYPES.length) % OFFENSE_ROUTE_TYPES.length;

        state.routeType = OFFENSE_ROUTE_TYPES[nextIndex];
        applyPreSnapRouteSettings(rep);
        saveOffenseRouteSettings();
        beep(360 + nextIndex * 35, 0.025);
    }

    function changePreSnapCut(rep, delta) {
        if (state.routeType === "go") {
            setTiming("GO route has no cut point.", "warn");
            return;
        }

        const nextCut = clamp(state.routeCutYards + delta, 3, 40);
        if (nextCut === state.routeCutYards) return;

        state.routeCutYards = nextCut;
        applyPreSnapRouteSettings(rep);
        saveOffenseRouteSettings();
        setTiming(`Cut set to ${state.routeCutYards} yards.`, "good");
        beep(470, 0.025);
    }

    function setInstruction(text) {
        ui.instruction.textContent = text;
    }

    function setTiming(text = "", className = "") {
        ui.timing.textContent = text;
        ui.timing.className = `timing-message ${className}`.trim();
    }

    function setFeedback(placement = "—", switching = "—", movement = "—", catching = "—") {
        ui.placement.textContent = placement;
        ui.switching.textContent = switching;
        ui.movement.textContent = movement;
        ui.catching.textContent = catching;
    }

    function updateScoreboard() {
        const repLimit = state.totalReps === Infinity ? "∞" : state.totalReps;
        ui.rep.textContent = `${state.completedReps} / ${repLimit}`;
        ui.score.textContent = Math.round(state.totalScore);
        const successRate = state.completedReps
            ? Math.round((state.successCount / state.completedReps) * 100)
            : 0;
        ui.success.textContent = `${successRate}%`;
        ui.streak.textContent = String(state.streak);
    }

    function resetDrill() {
        state.running = false;
        state.paused = false;
        state.pauseStartedAt = 0;

        if (window.WurdPracticeControls?.isPaused()) {
            window.WurdPracticeControls.setPaused(false);
        }
        state.completedReps = 0;
        state.successCount = 0;
        state.streak = 0;
        state.totalScore = 0;
        state.phase = "idle";
        state.rep = null;
        state.nextRepAt = 0;
        state.keyboardButtons.clear();
        state.keyboardPressed.clear();
        state.keyboardReleased.clear();
        setInstruction("Connect a controller and press Start Drill.");
        setTiming("");
        setFeedback();
        updateScoreboard();
    }

    function startDrill() {
        state.paused = false;
        state.pauseStartedAt = 0;

        if (window.WurdPracticeControls?.isPaused()) {
            window.WurdPracticeControls.setPaused(false);
        }

        state.mode = ui.mode.value;
        state.difficultyKey = ui.difficulty.value;
        state.catchMeterMinYards = Number(ui.catchMeterMin?.value ?? 5);
        state.totalReps =
            ui.reps.value === "infinite"
                ? Infinity
                : Number(ui.reps.value);
        state.completedReps = 0;
        state.successCount = 0;
        state.streak = 0;
        state.totalScore = 0;
        state.running = true;
        state.nextRepAt = 0;
        state.keyboardButtons.clear();
        state.keyboardPressed.clear();
        state.keyboardReleased.clear();
        syncCurrentControllerButtons();
        updateScoreboard();
        beginRep();
    }

    function beginRep() {
        if (!state.running) return;

        if (state.completedReps >= state.totalReps) {
            finishDrill();
            return;
        }

        state.phase = "active";
        setTiming("");
        setFeedback();

        if (state.mode === "offense") {
            state.rep = createOffenseRep();
            const routeName = state.rep.routeType.toUpperCase();
            const cutText = state.rep.routeType === "go" ? "" : ` • cut at ${state.rep.routeCutYards} yds`;
            setInstruction(`${routeName}${cutText}. L1/R1 = route • D-pad Left/Right = cut • X = hike.`);
        } else {
            state.rep = createDefenseRep();
            setInstruction("Read the pass. Press Circle to click on at the right time.");
        }
    }

    function finishDrill() {
        state.running = false;
        state.paused = false;
        state.pauseStartedAt = 0;
        state.phase = "complete";

        if (window.WurdPracticeControls?.isPaused()) {
            window.WurdPracticeControls.setPaused(false);
        }
        const rate = state.completedReps
            ? Math.round((state.successCount / state.completedReps) * 100)
            : 0;
        setInstruction(`Drill complete: ${state.successCount}/${state.completedReps} successful (${rate}%).`);
        setTiming("Press Start Drill to run it again.", "good");
    }

    function createOffenseRep() {
        const route = selectedRouteSettings();
        const receiverX = randomRange(300, 700);
        const receiver = {
            x: receiverX,
            y: OFFENSE_LOS_Y,
            startX: receiverX,
            startY: OFFENSE_LOS_Y,
            vx: 0,
            vy: -currentDifficulty().routeSpeed,
            radius: 18,
            routeType: route.type,
            cutYards: route.cutYards,
            cutMade: false
        };

        const leverage = randomChoice(["left", "right"]);
        const coverageOffset = 46;
        const defender = {
            x: receiver.x + (leverage === "left" ? -coverageOffset : coverageOffset),
            y: receiver.y,
            vx: receiver.vx,
            vy: receiver.vy,
            radius: 18
        };

        return {
            kind: "offense",
            routeType: route.type,
            routeCutYards: route.cutYards,
            leverage,
            qb: { x: 500, y: 578 },
            receiver,
            defender,
            ball: null,
            throwButton: randomChoice(THROW_BUTTONS),
            catchType: randomChoice([
                { button: "X", name: "Possession" },
                { button: "SQUARE", name: "RAC" },
                { button: "TRIANGLE", name: "Aggressive" }
            ]),
            throwHolding: false,
            throwHeldAt: null,
            throwHoldMs: 0,
            precisionLeadActive: false,
            precisionLeadX: 0,
            precisionLeadY: 0,
            defenderSidePick: false,
            defenderSidePickReason: "",
            passType: "lob",
            thrown: false,
            switched: false,
            catchAttempted: false,
            catchHolding: false,
            catchHeldAt: null,
            catchHoldMs: 0,
            catchButtonHeld: null,
            catchMeterStarted: false,
            catchMeterStartedAt: null,
            catchMeterLocked: false,
            catchMeterEnabled: true,
            catchMeterStartProgress: 0,
            catchDepthYards: 0,
            success: false,
            placementPoints: 0,
            catchTimingPoints: 0,
            movementPoints: 0,
            catchPoints: 0,
            switchedAt: null,
            catchAttemptAt: null,
            resultReason: "",
            startedAt: performance.now(),
            snapped: false,
            snappedAt: null
        };
    }

    function createDefenseRep() {
        const targetX = randomRange(300, 700);
        const receiver = {
            x: targetX + randomRange(-75, 75),
            y: 445,
            vx: 0,
            vy: -currentDifficulty().routeSpeed * 0.92,
            radius: 18
        };

        const catchPoint = {
            x: targetX,
            y: randomRange(165, 245)
        };

        const defenders = [
            { x: receiver.x - 115, y: receiver.y - 20, vx: 24, vy: -54, radius: 18, selected: false },
            { x: receiver.x + 105, y: receiver.y + 12, vx: -20, vy: -58, radius: 18, selected: false },
            { x: receiver.x + randomRange(-25, 25), y: receiver.y - 95, vx: 0, vy: -45, radius: 18, selected: false }
        ];

        const bestIndex = Math.floor(randomRange(0, defenders.length));
        defenders[bestIndex].x = catchPoint.x + randomRange(-52, 52);
        defenders[bestIndex].y = catchPoint.y + randomRange(95, 145);
        defenders[bestIndex].vx = (catchPoint.x - defenders[bestIndex].x) * 0.16;
        defenders[bestIndex].vy = -72;

        const ballStart = { x: 500, y: 555 };
        const dist = Math.hypot(catchPoint.x - ballStart.x, catchPoint.y - ballStart.y);
        const duration = dist / currentDifficulty().ballSpeed;

        return {
            kind: "defense",
            qb: ballStart,
            receiver,
            defenders,
            bestIndex,
            selectedIndex: null,
            catchPoint,
            ball: {
                start: { ...ballStart },
                target: { ...catchPoint },
                x: ballStart.x,
                y: ballStart.y,
                progress: 0,
                duration,
                elapsed: 0,
                arcHeight: 72
            },
            switched: false,
            pickAttempted: false,
            success: false,
            switchPoints: 0,
            movementPoints: 0,
            catchPoints: 0,
            switchedAt: null,
            resultReason: "",
            startedAt: performance.now()
        };
    }

    function getInput() {
        let axisX = 0;
        let axisY = 0;
        const pressed = new Set();
        const released = new Set();
        const down = new Set();

        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let pad = null;

        if (state.gamepadIndex !== null && pads[state.gamepadIndex]) {
            pad = pads[state.gamepadIndex];
        } else {
            pad = Array.from(pads).find(Boolean) || null;
            state.gamepadIndex = pad ? pad.index : null;
        }

        if (pad) {
            ui.controller.textContent = `Controller connected: ${pad.id.split("(")[0].trim()}`;
            ui.controller.className = "controller-status connected";

            axisX = Math.abs(pad.axes[0] || 0) > 0.14 ? pad.axes[0] : 0;
            axisY = Math.abs(pad.axes[1] || 0) > 0.14 ? pad.axes[1] : 0;

            pad.buttons.forEach((button, index) => {
                const wasPressed = Boolean(state.previousButtons[index]);

                if (button.pressed) {
                    down.add(index);
                }
                if (button.pressed && !wasPressed) {
                    pressed.add(index);
                }
                if (!button.pressed && wasPressed) {
                    released.add(index);
                }
            });

            state.previousButtons = pad.buttons.map(button => button.pressed);
        } else {
            ui.controller.textContent = "Controller not detected";
            ui.controller.className = "controller-status disconnected";
            state.previousButtons = [];
        }

        if (state.keysDown.has("KeyA")) axisX -= 1;
        if (state.keysDown.has("KeyD")) axisX += 1;
        if (state.keysDown.has("KeyW")) axisY -= 1;
        if (state.keysDown.has("KeyS")) axisY += 1;

        for (const button of state.keyboardPressed) {
            pressed.add(button);
        }
        for (const button of state.keyboardReleased) {
            released.add(button);
        }
        for (const button of state.keyboardButtons) {
            down.add(button);
        }
        state.keyboardPressed.clear();
        state.keyboardReleased.clear();

        return {
            axisX: clamp(axisX, -1, 1),
            axisY: clamp(axisY, -1, 1),
            pressed,
            released,
            down
        };
    }

    function checkPsHomeButton() {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let pad = null;

        if (state.gamepadIndex !== null && pads[state.gamepadIndex]) {
            pad = pads[state.gamepadIndex];
        } else {
            pad = Array.from(pads).find(Boolean) || null;
            state.gamepadIndex = pad ? pad.index : null;
        }

        if (!pad) {
            state.psHomeDown = false;
            return false;
        }

        const homePressed = Boolean(pad.buttons[PS_HOME_BUTTON_INDEX]?.pressed);

        if (homePressed && !state.psHomeDown) {
            state.psHomeDown = true;
            window.location.assign(WURD_HOME_URL);
            return true;
        }

        state.psHomeDown = homePressed;
        return false;
    }

    function syncCurrentControllerButtons() {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let pad = null;

        if (state.gamepadIndex !== null && pads[state.gamepadIndex]) {
            pad = pads[state.gamepadIndex];
        } else {
            pad = Array.from(pads).find(Boolean) || null;
            state.gamepadIndex = pad ? pad.index : null;
        }

        state.previousButtons = pad
            ? pad.buttons.map(button => Boolean(button?.pressed))
            : [];
    }

    function keyboardButtonForCode(code) {
        if (code === "Digit1") return BUTTONS.X;
        if (code === "Digit2") return BUTTONS.CIRCLE;
        if (code === "Digit3") return BUTTONS.SQUARE;
        if (code === "Digit4") return BUTTONS.TRIANGLE;
        if (code === "Digit5") return BUTTONS.L1;
        if (code === "Digit6") return BUTTONS.R1;
        return null;
    }

    function pressed(input, name) {
        return input.pressed.has(BUTTONS[name]);
    }

    function released(input, name) {
        return input.released.has(BUTTONS[name]);
    }

    function update(dt, now) {
        if (state.paused) {
            draw();
            return;
        }

        const input = getInput();

        if (!state.running || !state.rep) {
            draw();
            return;
        }

        // Keep watching the offensive catch button even after the play itself
        // has ended. This lets the meter freeze when the user releases the
        // button after a missed catch / result transition.
        if (
            state.rep.kind === "offense" &&
            state.rep.catchMeterStarted &&
            !state.rep.catchMeterLocked &&
            state.rep.catchButtonHeld
        ) {
            const heldButtonIndex = BUTTONS[state.rep.catchButtonHeld];
            const releaseEdge = released(input, state.rep.catchButtonHeld);
            const noLongerDown = !input.down.has(heldButtonIndex);

            if (releaseEdge || noLongerDown) {
                stopOffenseCatchMeter(state.rep, now);
            }
        }

        if (state.phase === "result") {
            if (now >= state.nextRepAt) {
                beginRep();
            }
            draw();
            return;
        }

        if (state.rep.kind === "offense") {
            updateOffense(dt, input, now);
        } else {
            updateDefense(dt, input);
        }

        draw();
    }

    function updateOffense(dt, input, now) {
        const rep = state.rep;
        const difficulty = currentDifficulty();

        if (!rep.thrown) {
            // Pre-snap route editor remains on the controller.
            if (!rep.snapped) {
                if (pressed(input, "L1")) {
                    cyclePreSnapRoute(rep, -1);
                }

                if (pressed(input, "R1")) {
                    cyclePreSnapRoute(rep, 1);
                }

                if (pressed(input, "DPAD_LEFT")) {
                    changePreSnapCut(rep, -1);
                }

                if (pressed(input, "DPAD_RIGHT")) {
                    changePreSnapCut(rep, 1);
                }

                if (pressed(input, "X")) {
                    rep.snapped = true;
                    rep.snappedAt = now;
                    setInstruction(
                        `${rep.routeType.toUpperCase()} route. Move QB with left stick. Hold ${BUTTON_LABELS[rep.throwButton]} for the throw meter, then release to throw.`
                    );
                    setTiming("Ball hiked.", "good");
                    beep(420, 0.04);
                }
                return;
            }

            // Receiver and defender run automatically after the snap.
            moveOffenseRoute(rep, dt);
            moveCoverageDefender(rep);

            const l2Held = input.down.has(BUTTONS.L2);

            // Normally the left stick moves the QB. While L2 is held during the
            // throw, the same stick becomes precision lead input instead.
            if (!(rep.throwHolding && l2Held)) {
                rep.qb.x = clamp(
                    rep.qb.x + input.axisX * difficulty.steerSpeed * dt,
                    55,
                    945
                );
                rep.qb.y = clamp(
                    rep.qb.y + input.axisY * difficulty.steerSpeed * dt,
                    OFFENSE_LOS_Y + 10,
                    canvas.height - 18
                );
            }

            // Manual throw meter: press/hold the receiver button, then release.
            if (pressed(input, rep.throwButton)) {
                rep.throwHolding = true;
                rep.throwHeldAt = now;
                rep.throwHoldMs = 0;
                rep.precisionLeadActive = l2Held;
                rep.precisionLeadX = l2Held ? input.axisX : 0;
                rep.precisionLeadY = l2Held ? input.axisY : 0;

                setTiming(
                    l2Held
                        ? `L2 precision lead: use left stick while holding ${BUTTON_LABELS[rep.throwButton]}, then release to throw.`
                        : `Hold ${BUTTON_LABELS[rep.throwButton]} for throw power, then release.`,
                    "good"
                );
            }

            if (rep.throwHolding && rep.throwHeldAt !== null) {
                rep.throwHoldMs = Math.max(0, now - rep.throwHeldAt);

                if (l2Held) {
                    rep.precisionLeadActive = true;
                    rep.precisionLeadX = input.axisX;
                    rep.precisionLeadY = input.axisY;
                }
            }

            if (rep.throwHolding && released(input, rep.throwButton)) {
                rep.throwHoldMs = Math.max(0, now - (rep.throwHeldAt || now));
                rep.throwHolding = false;
                throwOffensePassToReceiver(rep);
                return;
            }

            for (const name of THROW_BUTTONS) {
                if (name !== rep.throwButton && pressed(input, name)) {
                    setTiming(`Wrong receiver button. Use ${BUTTON_LABELS[rep.throwButton]}.`, "bad");
                    vibrate(80, 0.35);
                }
            }

            return;
        }

        updateBall(rep.ball, dt);

        // A precision throw led to the defender's leverage side is intercepted
        // as soon as the pass reaches the catch point.
        if (rep.defenderSidePick && rep.ball.progress >= 1.0 && !rep.catchAttempted) {
            rep.catchAttempted = true;
            rep.catchPoints = 0;
            rep.catchTimingPoints = 0;
            rep.movementPoints = 0;
            rep.resultReason = rep.defenderSidePickReason || "Picked off";
            finishRep(false);
            return;
        }

        // The receiver remains automatic after the throw.
        // We intentionally do not practice receiver steering here.
        moveOffenseRoute(rep, dt);
        moveCoverageDefender(rep);

        // Madden 27 catch meter behavior:
        // PRESS a catch button to START the meter.
        // HOLD the button while the meter moves.
        // RELEASE that same button to FREEZE/STOP the meter.
        const catchButtons = ["X", "SQUARE", "TRIANGLE"];

        if (!rep.catchMeterStarted && !rep.catchAttempted) {
            for (const buttonName of catchButtons) {
                if (pressed(input, buttonName)) {
                    startOffenseCatchMeter(rep, buttonName, now);
                    break;
                }
            }
        }

        if (
            rep.catchMeterStarted &&
            !rep.catchMeterLocked &&
            rep.catchMeterStartedAt !== null
        ) {
            rep.catchHoldMs = Math.max(0, now - rep.catchMeterStartedAt);
        }

        if (
            rep.catchMeterStarted &&
            !rep.catchMeterLocked &&
            rep.catchButtonHeld
        ) {
            const heldButtonIndex = BUTTONS[rep.catchButtonHeld];
            const releaseEdge = released(input, rep.catchButtonHeld);
            const noLongerDown = !input.down.has(heldButtonIndex);

            // Normally releaseEdge catches the exact transition. noLongerDown
            // is a safety net for browsers/controllers that occasionally miss
            // that one-frame release transition.
            if (releaseEdge || noLongerDown) {
                stopOffenseCatchMeter(rep, now);
            }
        }

        // Once the meter has been frozen by RELEASE, let the play continue.
        // The eventual catch can still succeed or fail independently.
        if (rep.catchMeterLocked && !rep.catchAttempted && rep.ball.progress >= 1.0) {
            finishOffenseCatch(rep, rep.catchButtonHeld);
            return;
        }

        if (rep.ball.progress >= 1.08 && !rep.catchAttempted) {
            if (rep.catchMeterStarted && !rep.catchMeterLocked) {
                rep.resultReason = "Catch button held too long";
            } else if (!rep.catchMeterStarted) {
                rep.resultReason = "No catch input";
            } else {
                rep.resultReason = "Catch attempt did not reach the ball";
            }
            finishRep(false);
        }
    }

    function getPassProfile(holdMs, difficulty) {
        const baseSpeed = difficulty.ballSpeed;

        if (holdMs < LOB_MAX_HOLD_MS) {
            return {
                type: "lob",
                durationFactor: 1.22,
                arcHeight: 108,
                timingText: "Lob pass — run under it."
            };
        }

        if (holdMs < TOUCH_MAX_HOLD_MS) {
            return {
                type: "touch",
                durationFactor: 1.0,
                arcHeight: 78,
                timingText: "Touch pass — get ready to catch."
            };
        }

        return {
            type: "bullet",
            durationFactor: 0.78,
            arcHeight: 40,
            timingText: "Bullet pass — react quickly."
        };
    }

    function projectReceiverAtArrival(rep, durationSeconds) {
        const sim = {
            x: rep.receiver.x,
            y: rep.receiver.y,
            startX: rep.receiver.startX,
            startY: rep.receiver.startY,
            vx: rep.receiver.vx,
            vy: rep.receiver.vy,
            routeType: rep.receiver.routeType,
            cutYards: rep.receiver.cutYards,
            cutMade: rep.receiver.cutMade
        };

        const speed = currentDifficulty().routeSpeed;
        let remaining = Math.max(0, durationSeconds);
        const step = 1 / 120;

        while (remaining > 0) {
            const dt = Math.min(step, remaining);
            const depthYards = (sim.startY - sim.y) / OFFENSE_PIXELS_PER_YARD;

            if (!sim.cutMade && sim.routeType !== "go" && depthYards >= sim.cutYards) {
                sim.cutMade = true;

                const towardSideline = sim.startX < canvas.width / 2 ? -1 : 1;
                const towardMiddle = -towardSideline;

                if (sim.routeType === "out") {
                    sim.vx = towardSideline * speed;
                    sim.vy = 0;
                } else if (sim.routeType === "in" || sim.routeType === "dig") {
                    sim.vx = towardMiddle * speed;
                    sim.vy = 0;
                } else if (sim.routeType === "post") {
                    sim.vx = towardMiddle * speed * 0.72;
                    sim.vy = -speed * 0.70;
                } else if (sim.routeType === "corner") {
                    sim.vx = towardSideline * speed * 0.72;
                    sim.vy = -speed * 0.70;
                }
            }

            sim.x = clamp(sim.x + sim.vx * dt, 38, 962);
            sim.y = clamp(sim.y + sim.vy * dt, OFFENSE_FIELD_TOP_Y, OFFENSE_LOS_Y);
            remaining -= dt;
        }

        return { x: sim.x, y: sim.y };
    }

    function throwOffensePassToReceiver(rep) {
        if (rep.thrown) return;

        rep.thrown = true;

        const profile = getPassProfile(rep.throwHoldMs, currentDifficulty());
        rep.passType = profile.type;

        // The user controls throw power/type with the throw meter, but does not aim.
        // The football automatically targets the projected receiver location.
        const roughDist = distance(rep.qb, rep.receiver);
        let passDuration = Math.max(
            0.30,
            (roughDist / currentDifficulty().ballSpeed) * profile.durationFactor
        );

        let projectedCatchPoint = projectReceiverAtArrival(rep, passDuration);
        const refinedDist = distance(rep.qb, projectedCatchPoint);
        passDuration = Math.max(
            0.30,
            (refinedDist / currentDifficulty().ballSpeed) * profile.durationFactor
        );
        projectedCatchPoint = projectReceiverAtArrival(rep, passDuration);

        // L2 precision lead: while the throw meter is being held, left-stick
        // input offsets the otherwise automatic receiver target.
        // Keep precision placement tight to the receiver. This is a small
        // adjustment, not free-aiming.
        const LEAD_PIXELS = 24;
        const leadX = rep.precisionLeadActive ? rep.precisionLeadX * LEAD_PIXELS : 0;
        const leadY = rep.precisionLeadActive ? rep.precisionLeadY * LEAD_PIXELS : 0;

        const passTarget = {
            x: clamp(projectedCatchPoint.x + leadX, 38, 962),
            y: clamp(projectedCatchPoint.y + leadY, OFFENSE_FIELD_TOP_Y, OFFENSE_LOS_Y)
        };

        // Defender leverage is locked to one side of the receiver.
        // If an L2 precision throw is deliberately led toward that side,
        // treat it as a defensive interception.
        const defenderSide = rep.leverage === "left" ? -1 : 1;
        const leadSide = Math.abs(leadX) >= 5 ? Math.sign(leadX) : 0;
        rep.defenderSidePick =
            rep.precisionLeadActive &&
            leadSide !== 0 &&
            leadSide === defenderSide;

        rep.defenderSidePickReason = rep.defenderSidePick
            ? `Picked off — L2 lead was thrown toward the defender on the ${rep.leverage}`
            : "";

        rep.placementPoints = 40;

        rep.ball = {
            start: { ...rep.qb },
            target: { ...passTarget },
            x: rep.qb.x,
            y: rep.qb.y,
            progress: 0,
            duration: passDuration,
            elapsed: 0,
            arcHeight: profile.arcHeight
        };

        rep.catchDepthYards = clamp(
            (OFFENSE_LOS_Y - rep.ball.target.y) / OFFENSE_PIXELS_PER_YARD,
            0,
            OFFENSE_FIELD_YARDS
        );

        rep.catchMeterEnabled = rep.catchDepthYards >= state.catchMeterMinYards;
        rep.catchMeterStartProgress = getCatchMeterStartProgress(
            rep.catchDepthYards,
            currentDifficulty()
        );

        rep.switched = false;

        if (!rep.catchMeterEnabled) {
            setInstruction(
                `${BUTTON_LABELS[rep.catchType.button]} = ${rep.catchType.name}. No catch meter at ${rep.catchDepthYards.toFixed(1)} yds.`
            );
        } else {
            setInstruction(
                `${BUTTON_LABELS[rep.catchType.button]} = ${rep.catchType.name}. Press, hold, and release in GREEN.`
            );
        }

        setTiming(
            rep.defenderSidePick
                ? `${profile.timingText} Dangerous lead — defender has inside position.`
                : rep.precisionLeadActive
                    ? `${profile.timingText} L2 precision lead applied.`
                    : `${profile.timingText} Pass aimed automatically at receiver.`,
            rep.defenderSidePick ? "bad" : "good"
        );
        beep(520, 0.05);
    }

    function getCatchMeterStartProgress(depthYards, difficulty) {
        // With Madden's minimum set to 0, practice testing showed 0-5 yard
        // catches use the same short-pass meter behavior as the 5-10 yard band.
        const effectiveDepthYards = Math.max(depthYards, 5);

        // Empirical Madden 27 behavior from practice testing:
        // 5-10 yd catches open inside the green near its late edge (quick tap).
        // 10-15 yd catches open just before green (very short hold).
        // From 15 to about 40 yd, the starting point moves progressively
        // backward until a ~40 yd catch can show the full meter.
        if (effectiveDepthYards < 10) {
            const t = clamp((effectiveDepthYards - 5) / 5, 0, 1);
            // Still starts in/near green on very short catches, but slightly
            // farther left than before to give the user a touch more reaction time.
            const lateGreen = difficulty.catchSweetEnd - 0.095;
            const earlyGreen = difficulty.catchSweetStart - 0.02;
            return lerp(lateGreen, earlyGreen, t);
        }

        if (effectiveDepthYards < 15) {
            const t = clamp((effectiveDepthYards - 10) / 5, 0, 1);
            return lerp(
                difficulty.catchSweetStart - 0.065,
                Math.max(0, difficulty.catchSweetStart - 0.15),
                t
            );
        }

        if (effectiveDepthYards < 40) {
            const t = clamp((effectiveDepthYards - 15) / 25, 0, 1);
            return lerp(Math.max(0, difficulty.catchSweetStart - 0.15), 0, t);
        }

        return 0;
    }

    function currentCatchMeterProgress(rep, now = performance.now()) {
        if (!rep.catchMeterStarted) return rep.catchMeterStartProgress || 0;

        const difficulty = currentDifficulty();
        const heldMs =
            !rep.catchMeterLocked && rep.catchMeterStartedAt !== null
                ? Math.max(0, now - rep.catchMeterStartedAt)
                : rep.catchHoldMs;

        return clamp(
            (rep.catchMeterStartProgress || 0) + heldMs / difficulty.catchMeterDuration,
            0,
            1.25
        );
    }

    function startOffenseCatchMeter(rep, buttonName, now) {
        if (
            rep.catchAttempted ||
            rep.catchMeterStarted ||
            rep.catchMeterLocked ||
            !rep.ball
        ) {
            return;
        }

        rep.catchMeterStarted = true;
        rep.catchMeterStartedAt = now;
        rep.catchHolding = true;
        rep.catchHeldAt = now;
        rep.catchHoldMs = 0;
        rep.catchButtonHeld = buttonName;
        // Below the selected minimum distance, Madden does not display
        // timing-based catching. The catch type still matters, but there is no meter.
        if (!rep.catchMeterEnabled) {
            rep.catchMeterLocked = true;
            rep.catchHolding = false;
            rep.catchTimingPoints = 25;
            setTiming(
                buttonName === rep.catchType.button
                    ? `No catch meter at this depth — ${BUTTON_LABELS[buttonName]} registered.`
                    : `Wrong catch type — use ${BUTTON_LABELS[rep.catchType.button]} for ${rep.catchType.name}.`,
                buttonName === rep.catchType.button ? "good" : "bad"
            );
            return;
        }

        const startProgress = rep.catchMeterStartProgress || 0;
        const startsGreen =
            startProgress >= currentDifficulty().catchSweetStart &&
            startProgress <= currentDifficulty().catchSweetEnd;

        setTiming(
            startsGreen
                ? `Catch meter opened GREEN — release ${BUTTON_LABELS[buttonName]} NOW.`
                : `Catch meter started — release ${BUTTON_LABELS[buttonName]} in the green.`,
            "good"
        );

        vibrate(28, 0.14);
    }

    function stopOffenseCatchMeter(rep, now) {
        if (
            rep.catchMeterLocked ||
            !rep.catchMeterStarted ||
            rep.catchMeterStartedAt === null
        ) {
            return;
        }

        // Freeze the meter at the exact instant the held catch button is released.
        rep.catchHoldMs = Math.max(0, now - rep.catchMeterStartedAt);
        rep.catchMeterLocked = true;
        rep.catchHolding = false;
        rep.catchHeldAt = null;

        rep.catchTimingPoints = scoreCatchRelease(
            currentCatchMeterProgress(rep, now),
            currentDifficulty()
        );

        if (rep.catchTimingPoints >= 22) {
            setTiming("Catch meter stopped: GREEN.", "good");
        } else if (rep.catchTimingPoints >= 15) {
            setTiming("Catch meter stopped near green.", "warn");
        } else {
            setTiming("Catch meter stopped outside the green.", "bad");
        }

        vibrate(38, 0.20);
    }

    function scoreCatchRelease(ratio, difficulty) {
        ratio = clamp(ratio, 0, 1.25);

        if (ratio >= difficulty.catchSweetStart && ratio <= difficulty.catchSweetEnd) {
            const middle = (difficulty.catchSweetStart + difficulty.catchSweetEnd) / 2;
            const half = (difficulty.catchSweetEnd - difficulty.catchSweetStart) / 2;
            const quality = 1 - Math.abs(ratio - middle) / Math.max(half, 0.01);
            return Math.round(22 + clamp(quality, 0, 1) * 3);
        }

        if (ratio < difficulty.catchSweetStart) {
            const quality = ratio / Math.max(difficulty.catchSweetStart, 0.01);
            return Math.round(clamp(quality, 0, 1) * 18);
        }

        const lateSpan = Math.max(1 - difficulty.catchSweetEnd, 0.01);
        const quality = 1 - (ratio - difficulty.catchSweetEnd) / lateSpan;
        return Math.round(clamp(quality, 0, 1) * 18);
    }

    function finishOffenseCatch(rep, buttonName) {
        if (rep.catchAttempted || !rep.ball) return;

        rep.catchAttempted = true;
        rep.catchAttemptAt = rep.ball.progress;

        const difficulty = currentDifficulty();
        const releaseProgress = currentCatchMeterProgress(rep);
        const correctCatch = buttonName === rep.catchType.button;
        const placementGood = rep.placementPoints >= 16;

        const inGreen = !rep.catchMeterEnabled || (
            releaseProgress >= difficulty.catchSweetStart &&
            releaseProgress <= difficulty.catchSweetEnd
        );

        // Offense now has three requirements:
        // 1) automatic pass must be catchable,
        // 2) use the requested catch type, and
        // 3) if the meter is enabled, release inside GREEN.
        rep.movementPoints = 0;
        rep.catchPoints = correctCatch ? 20 : 0;
        const success = correctCatch && inGreen;

        if (!correctCatch) {
            rep.resultReason = `Wrong catch type—use ${BUTTON_LABELS[rep.catchType.button]} for ${rep.catchType.name}`;
        } else if (!inGreen) {
            rep.resultReason = "Missed: catch meter was outside GREEN";
        } else {
            rep.resultReason = `${rep.catchType.name} catch: catchable throw + GREEN timing`;
        }

        finishRep(success);
    }

    function updateDefense(dt, input) {
        const rep = state.rep;
        const difficulty = currentDifficulty();

        updateBall(rep.ball, dt);
        moveAutoRoute(rep.receiver, dt);

        rep.defenders.forEach((defender, index) => {
            if (rep.switched && rep.selectedIndex === index) {
                defender.x = clamp(defender.x + input.axisX * difficulty.steerSpeed * dt, 35, 965);
                defender.y = clamp(defender.y + input.axisY * difficulty.steerSpeed * dt, 45, 530);
            } else {
                defender.x += defender.vx * dt;
                defender.y += defender.vy * dt;
            }
        });

        if (!rep.switched && pressed(input, "CIRCLE")) {
            handleDefenseSwitch(rep);
        }

        if (pressed(input, "TRIANGLE")) {
            attemptInterception(rep);
        }

        if (rep.ball.progress >= 1.06 && !rep.pickAttempted) {
            rep.resultReason = rep.switched ? "No interception attempt" : "No click-on";
            finishRep(false);
        }
    }

    function handleDefenseSwitch(rep) {
        const difficulty = currentDifficulty();
        const p = rep.ball.progress;

        rep.switched = true;
        rep.switchedAt = p;
        rep.switchPoints = scoreSwitchTiming(p, difficulty);

        if (p < difficulty.switchStart) {
            rep.selectedIndex = (rep.bestIndex + 1) % rep.defenders.length;
            setTiming("Too early—you switched to the wrong defender.", "bad");
        } else {
            rep.selectedIndex = rep.bestIndex;
            if (p <= difficulty.switchEnd) {
                setTiming("Good click-on. Drive toward the passing lane.", "good");
            } else {
                setTiming("Late click-on—move immediately.", "warn");
            }
        }

        rep.defenders.forEach((defender, index) => {
            defender.selected = index === rep.selectedIndex;
        });

        setInstruction("Steer into the passing lane and press Triangle at the ball.");
        vibrate(48, 0.24);
    }

    function attemptInterception(rep) {
        if (rep.pickAttempted) return;

        if (!rep.switched || rep.selectedIndex === null) {
            setTiming("Press Circle to click on before using Triangle.", "bad");
            return;
        }

        const selected = rep.defenders[rep.selectedIndex];
        const ballDistance = distance(selected, rep.ball);
        const catchRadius = currentDifficulty().catchRadius;

        if (ballDistance > catchRadius) {
            if (rep.ball.progress < 0.72) {
                setTiming("Triangle too early.", "warn");
            } else {
                setTiming("You are outside the interception window.", "bad");
            }
            return;
        }

        rep.pickAttempted = true;
        rep.movementPoints = Math.round(clamp(1 - ballDistance / catchRadius, 0, 1) * 35);
        rep.catchPoints = 40;

        const correctDefender = rep.selectedIndex === rep.bestIndex;
        const success =
            correctDefender &&
            rep.switchPoints >= 8 &&
            rep.movementPoints >= 9;

        rep.resultReason = success ? "User interception" : "Reached the ball, but the angle was poor";
        finishRep(success);
    }

    function scoreSwitchTiming(progress, difficulty) {
        if (progress < difficulty.switchStart) {
            return Math.round(clamp(progress / difficulty.switchStart, 0, 1) * 8);
        }

        if (progress <= difficulty.switchEnd) {
            const middle = (difficulty.switchStart + difficulty.switchEnd) / 2;
            const halfWindow = (difficulty.switchEnd - difficulty.switchStart) / 2;
            const quality = 1 - Math.abs(progress - middle) / Math.max(halfWindow, 0.01);
            return Math.round(18 + clamp(quality, 0, 1) * 7);
        }

        return Math.round(clamp(1 - (progress - difficulty.switchEnd) / 0.38, 0, 1) * 17);
    }

    function switchTimingLabel(points) {
        if (points >= 22) return "Perfect click-on timing.";
        if (points >= 18) return "Good click-on timing.";
        if (points >= 10) return "Usable, but click on sooner.";
        return "Click-on timing was poor.";
    }

    function finishRep(success) {
        if (state.phase === "result") return;

        state.phase = "result";
        state.completedReps += 1;

        const rep = state.rep;
        const repScore = rep.kind === "offense"
            ? rep.catchTimingPoints + rep.catchPoints
            : rep.switchPoints + rep.movementPoints + rep.catchPoints;

        state.totalScore += repScore;

        if (success) {
            state.successCount += 1;
            state.streak += 1;
            setTiming(`${rep.resultReason} — ${repScore} points`, "good");
            setInstruction("Successful rep.");
            beep(760, 0.09);
            vibrate(95, 0.5);
        } else {
            state.streak = 0;
            setTiming(`${rep.resultReason} — ${repScore} points`, "bad");
            setInstruction("Review the feedback, then the next rep will begin.");
            beep(185, 0.12);
            vibrate(150, 0.6);
        }

        if (rep.kind === "offense") {
            setFeedback(
                "Auto pass",
                feedbackCatchTiming(rep.catchTimingPoints),
                "Auto route",
                feedbackCatch(rep.catchPoints)
            );
        } else {
            setFeedback(
                "Defense",
                feedbackSwitch(rep.switchPoints),
                feedbackMovement(rep.movementPoints, true),
                feedbackCatch(rep.catchPoints, true)
            );
        }

        updateScoreboard();
        state.nextRepAt = performance.now() + currentDifficulty().resultDelay;
    }

    function feedbackPlacement(points) {
        if (points >= 34) return "Excellent";
        if (points >= 25) return "Good";
        if (points >= 16) return "Catchable";
        return "Too close to coverage";
    }

    function feedbackCatchTiming(points) {
        if (points >= 22) return "Perfect";
        if (points >= 15) return "Good";
        if (points >= 8) return "Marginal";
        return "Missed";
    }

    function feedbackSwitch(points) {
        if (points >= 22) return "Perfect";
        if (points >= 18) return "Good";
        if (points >= 10) return "Late / early";
        return "Poor";
    }

    function feedbackMovement(points, defense = false) {
        const max = defense ? 35 : 15;
        const ratio = points / max;
        if (ratio >= 0.72) return "Strong angle";
        if (ratio >= 0.38) return "Usable";
        if (points > 0) return "Needs adjustment";
        return "No control";
    }

    function feedbackCatch(points, defense = false) {
        const max = defense ? 40 : 20;
        const ratio = points / max;
        if (ratio >= 0.95) return defense ? "Interception" : "Correct catch";
        if (ratio >= 0.45) return "Wrong catch type";
        return "Missed";
    }

    function moveOffenseRoute(rep, dt) {
        const receiver = rep.receiver;
        const speed = currentDifficulty().routeSpeed;
        const depthYards = (receiver.startY - receiver.y) / OFFENSE_PIXELS_PER_YARD;

        if (!receiver.cutMade && receiver.routeType !== "go" && depthYards >= receiver.cutYards) {
            receiver.cutMade = true;

            const towardSideline = receiver.startX < canvas.width / 2 ? -1 : 1;
            const towardMiddle = -towardSideline;

            if (receiver.routeType === "out") {
                receiver.vx = towardSideline * speed;
                receiver.vy = 0;
            } else if (receiver.routeType === "in" || receiver.routeType === "dig") {
                receiver.vx = towardMiddle * speed;
                receiver.vy = 0;
            } else if (receiver.routeType === "post") {
                receiver.vx = towardMiddle * speed * 0.72;
                receiver.vy = -speed * 0.70;
            } else if (receiver.routeType === "corner") {
                receiver.vx = towardSideline * speed * 0.72;
                receiver.vy = -speed * 0.70;
            }
        }

        receiver.x = clamp(receiver.x + receiver.vx * dt, 38, 962);
        receiver.y = clamp(receiver.y + receiver.vy * dt, OFFENSE_FIELD_TOP_Y, OFFENSE_LOS_Y);
    }

    function moveAutoRoute(player, dt) {
        player.x = clamp(player.x + player.vx * dt, 38, 962);
        player.y = clamp(player.y + player.vy * dt, OFFENSE_FIELD_TOP_Y, OFFENSE_LOS_Y);
    }

    function moveCoverageDefender(rep) {
        const side = rep.leverage === "left" ? -1 : 1;
        const coverageOffset = 46;

        // Lock the defender to the chosen hip while matching the receiver's
        // route velocity exactly. This keeps the coverage picture consistent.
        rep.defender.vx = rep.receiver.vx;
        rep.defender.vy = rep.receiver.vy;
        rep.defender.x = clamp(rep.receiver.x + side * coverageOffset, 38, 962);
        rep.defender.y = clamp(rep.receiver.y, OFFENSE_FIELD_TOP_Y, OFFENSE_LOS_Y);
    }

    function updateBall(ball, dt) {
        ball.elapsed += dt;
        ball.progress = ball.elapsed / ball.duration;
        const t = clamp(ball.progress, 0, 1);
        ball.x = lerp(ball.start.x, ball.target.x, t);
        ball.y = lerp(ball.start.y, ball.target.y, t) - Math.sin(Math.PI * t) * (ball.arcHeight || 72);
    }

    function draw() {
        drawField();

        if (!state.rep) {
            drawCenterMessage("User Catch & Pick Practice", "Press Start Drill");
            return;
        }

        if (state.rep.kind === "offense") {
            drawOffense(state.rep);
        } else {
            drawDefense(state.rep);
        }
    }

    function drawField() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, "#173f26");
        gradient.addColorStop(1, "#0d2b1a");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = "rgba(255,255,255,0.025)";
        for (let x = 0; x < canvas.width; x += 100) {
            ctx.fillRect(x, 0, 50, canvas.height);
        }

        ctx.strokeStyle = "rgba(255,255,255,0.28)";
        ctx.lineWidth = 2;
        ctx.font = "bold 16px Arial";
        ctx.textAlign = "left";

        // 0-40 yards stretched over the full vertical practice area.
        // Madden's catch-meter starting behavior changes in roughly 5-yard
        // bands, so show every 5 yards. Ten-yard lines are slightly stronger.
        for (let yards = 0; yards <= OFFENSE_FIELD_YARDS; yards += 5) {
            const y = OFFENSE_LOS_Y - yards * OFFENSE_PIXELS_PER_YARD;
            const isTenYardLine = yards % 10 === 0;

            ctx.strokeStyle = yards === 0
                ? "rgba(255, 209, 102, 0.95)"
                : isTenYardLine
                    ? "rgba(255,255,255,0.36)"
                    : "rgba(255,255,255,0.20)";
            ctx.lineWidth = yards === 0 ? 4 : isTenYardLine ? 2 : 1;

            ctx.beginPath();
            ctx.moveTo(30, y);
            ctx.lineTo(970, y);
            ctx.stroke();

            ctx.fillStyle = yards === 0
                ? "rgba(255, 209, 102, 0.95)"
                : isTenYardLine
                    ? "rgba(255,255,255,0.70)"
                    : "rgba(255,255,255,0.48)";
            const label = yards === 0 ? "LOS" : `${yards}`;
            ctx.font = yards === 0
                ? "bold 17px Arial"
                : isTenYardLine
                    ? "bold 16px Arial"
                    : "14px Arial";
            ctx.fillText(label, 45, y - 6);
            ctx.fillText(label, 925, y - 6);
        }

        ctx.font = "bold 16px Arial";
        ctx.lineWidth = 2;

        ctx.strokeStyle = "rgba(255, 209, 102, 0.9)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(30, OFFENSE_LOS_Y);
        ctx.lineTo(970, OFFENSE_LOS_Y);
        ctx.stroke();

        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 9]);
        for (let x = 210; x <= 790; x += 145) {
            ctx.beginPath();
            ctx.moveTo(x, OFFENSE_FIELD_TOP_Y - 15);
            ctx.lineTo(x, OFFENSE_LOS_Y + 35);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    function drawOffense(rep) {
        if (!rep.thrown) {
            if (!rep.snapped) {
                drawRoutePreview(rep);
                drawPreSnapRoutePanel(rep);
            }
        }

        drawPlayer(rep.defender, "#f55c69", "D", false);
        drawPlayer(
            rep.receiver,
            "#5ca8ff",
            BUTTON_SYMBOLS[rep.throwButton],
            rep.switched
        );
        drawThrowMeter(rep);
        drawPlayer(rep.qb, "#d7dde8", "QB", false);

        if (rep.ball) {
            drawBall(rep.ball);
        }

        if (rep.thrown) {
            if (rep.catchType.button) {
                drawCatchPrompt(rep.receiver, rep.catchType.button);
            }
            if (rep.catchMeterStarted) {
                drawCatchMeter(rep);
            }
        }

        drawMiniLegend(
            "Receiver runs automatically",
            rep.thrown
                ? `${BUTTON_SYMBOLS[rep.catchType.button]} = ${rep.catchType.name} • release in GREEN`
                : "Left stick = QB movement • L2 + stick = tight lead • defender side = PICK"
        );
    }

    function drawDefense(rep) {
        drawPlayer(rep.receiver, "#5ca8ff", "WR", false);

        rep.defenders.forEach((defender, index) => {
            const isBest = index === rep.bestIndex && currentDifficulty().guideStrength > 0.7;
            drawPlayer(
                defender,
                isBest ? "#ffd166" : "#f55c69",
                "DB",
                defender.selected
            );
        });

        drawPlayer(rep.qb, "#d7dde8", "QB", false);
        drawBall(rep.ball);

        if (rep.switched && rep.selectedIndex !== null) {
            drawCatchPrompt(rep.defenders[rep.selectedIndex], "TRIANGLE");
        }

        drawMiniLegend("Circle = click on", "Triangle = intercept");
    }

    function drawRoutePreview(rep) {
        const r = rep.receiver;
        const cutY = r.startY - r.cutYards * OFFENSE_PIXELS_PER_YARD;
        const towardSideline = r.startX < canvas.width / 2 ? -1 : 1;
        const towardMiddle = -towardSideline;

        ctx.save();
        ctx.strokeStyle = "rgba(92,168,255,.72)";
        ctx.lineWidth = 4;
        ctx.setLineDash([9, 8]);
        ctx.beginPath();
        ctx.moveTo(r.startX, r.startY);

        if (r.routeType === "go") {
            ctx.lineTo(r.startX, OFFENSE_FIELD_TOP_Y + 10);
        } else {
            ctx.lineTo(r.startX, cutY);
            let endX = r.startX;
            let endY = cutY;
            if (r.routeType === "out") {
                endX += towardSideline * 180;
            } else if (r.routeType === "in" || r.routeType === "dig") {
                endX += towardMiddle * 180;
            } else if (r.routeType === "post") {
                endX += towardMiddle * 150;
                endY -= 150;
            } else if (r.routeType === "corner") {
                endX += towardSideline * 150;
                endY -= 150;
            }
            ctx.lineTo(clamp(endX, 45, 955), clamp(endY, OFFENSE_FIELD_TOP_Y, OFFENSE_LOS_Y));
        }
        ctx.stroke();
        ctx.setLineDash([]);

        if (r.routeType !== "go") {
            ctx.fillStyle = "#ffd166";
            ctx.beginPath();
            ctx.arc(r.startX, cutY, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#fff6cc";
            ctx.font = "bold 13px Arial";
            ctx.textAlign = "center";
            ctx.fillText(`CUT ${r.cutYards} YDS`, r.startX, cutY - 13);
        }
        ctx.restore();
    }


    function drawPreSnapRoutePanel(rep) {
        const routeLabel = rep.routeType.toUpperCase();
        const cutLabel = rep.routeType === "go" ? "—" : `${rep.routeCutYards} YDS`;

        ctx.save();

        const panelX = 265;
        const panelY = 52;
        const panelW = 470;
        const panelH = 102;

        ctx.fillStyle = "rgba(4, 10, 16, 0.88)";
        ctx.strokeStyle = "rgba(255,255,255,0.28)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(panelX, panelY, panelW, panelH, 14);
        } else {
            ctx.rect(panelX, panelY, panelW, panelH);
        }
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 16px Arial";
        ctx.fillText("PRE-SNAP ROUTE", 500, panelY + 18);

        ctx.fillStyle = "#5ca8ff";
        ctx.font = "bold 27px Arial";
        ctx.fillText(routeLabel, 410, panelY + 50);

        ctx.fillStyle = "#ffd166";
        ctx.font = "bold 23px Arial";
        ctx.fillText(`CUT ${cutLabel}`, 595, panelY + 50);

        ctx.fillStyle = "rgba(255,255,255,.92)";
        ctx.font = "bold 13px Arial";
        ctx.fillText("L1 / R1 = ROUTE     D-PAD ← / → = CUT     X = HIKE", 500, panelY + 79);

        ctx.restore();
    }

    function drawPlayer(player, color, label, selected) {
        ctx.save();

        if (selected) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(player.x, player.y, 29, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.moveTo(player.x, player.y - 42);
            ctx.lineTo(player.x - 10, player.y - 58);
            ctx.lineTo(player.x + 10, player.y - 58);
            ctx.closePath();
            ctx.fill();
        }

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.radius || 18, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#071015";
        ctx.font = "bold 13px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, player.x, player.y + 1);
        ctx.restore();
    }

    function drawBall(ball) {
        ctx.save();
        ctx.translate(ball.x, ball.y);
        ctx.rotate(-0.45);

        ctx.fillStyle = "#8b4a22";
        ctx.beginPath();
        ctx.ellipse(0, 0, 14, 8, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#f5e2c8";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-3, -4);
        ctx.lineTo(4, 4);
        ctx.stroke();
        ctx.restore();
    }



    function drawThrowMeter(rep) {
        const isVisible = !rep.thrown || rep.throwHoldMs > 0;
        if (!isVisible) return;

        const heldMs = rep.throwHolding && rep.throwHeldAt !== null
            ? Math.max(0, performance.now() - rep.throwHeldAt)
            : rep.throwHoldMs;

        const progress = clamp(heldMs / THROW_METER_DURATION_MS, 0, 1);
        const width = 150;
        const height = 12;
        const x = clamp(rep.receiver.x - width / 2, 20, canvas.width - width - 20);
        const y = clamp(rep.receiver.y - 54, 38, canvas.height - 38);

        ctx.save();
        ctx.fillStyle = "rgba(4, 9, 13, 0.92)";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, 7);
        ctx.fill();
        ctx.stroke();

        const lobWidth = width * 0.25;
        const touchWidth = width * 0.36;
        const bulletWidth = width - lobWidth - touchWidth;

        ctx.fillStyle = "rgba(125, 211, 252, 0.45)";
        ctx.fillRect(x, y, lobWidth, height);
        ctx.fillStyle = "rgba(250, 204, 21, 0.45)";
        ctx.fillRect(x + lobWidth, y, touchWidth, height);
        ctx.fillStyle = "rgba(248, 113, 113, 0.45)";
        ctx.fillRect(x + lobWidth + touchWidth, y, bulletWidth, height);

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, y, width * progress, height);

        const markerX = x + width * progress;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(markerX, y - 4);
        ctx.lineTo(markerX, y + height + 4);
        ctx.stroke();

        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "center";
        ctx.fillText("LOB", x + lobWidth / 2, y - 8);
        ctx.fillText("TOUCH", x + lobWidth + touchWidth / 2, y - 8);
        ctx.fillText("BULLET", x + lobWidth + touchWidth + bulletWidth / 2, y - 8);

        const passType = heldMs < LOB_MAX_HOLD_MS ? "LOB" : heldMs < TOUCH_MAX_HOLD_MS ? "TOUCH" : "BULLET";
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px Arial";
        ctx.fillText(passType, x + width / 2, y + 28);
        ctx.restore();
    }

    function drawCatchMeter(rep) {
        if (!rep.catchMeterEnabled) return;

        const difficulty = currentDifficulty();
        const progress = clamp(currentCatchMeterProgress(rep), 0, 1);
        const width = 150;
        const height = 12;
        const x = clamp(rep.receiver.x - width / 2, 20, canvas.width - width - 20);
        const y = clamp(rep.receiver.y + 46, 38, canvas.height - 38);

        ctx.save();
        ctx.fillStyle = "rgba(4, 9, 13, 0.92)";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, 7);
        ctx.fill();
        ctx.stroke();

        // Madden-style timing zones: neutral before green, green release window,
        // then red for a late release. The marker itself shows current progress.
        ctx.fillStyle = "rgba(148, 163, 184, 0.38)";
        ctx.fillRect(x, y, width * difficulty.catchSweetStart, height);

        const sweetX = x + width * difficulty.catchSweetStart;
        const sweetWidth = width * (difficulty.catchSweetEnd - difficulty.catchSweetStart);
        ctx.fillStyle = "rgba(34, 197, 94, 0.78)";
        ctx.fillRect(sweetX, y, sweetWidth, height);

        const lateX = x + width * difficulty.catchSweetEnd;
        ctx.fillStyle = "rgba(239, 68, 68, 0.78)";
        ctx.fillRect(lateX, y, width * (1 - difficulty.catchSweetEnd), height);

        const markerX = x + width * progress;
        ctx.strokeStyle = "#071015";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(markerX, y - 4);
        ctx.lineTo(markerX, y + height + 4);
        ctx.stroke();

        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "center";
        ctx.fillText(
            `${BUTTON_SYMBOLS[rep.catchType.button]} ${rep.catchType.name.toUpperCase()} — RELEASE IN GREEN`,
            x + width / 2,
            y - 8
        );
        ctx.restore();
    }

    function drawCatchPrompt(player, buttonName) {
        ctx.save();
        const x = player.x + 36;
        const y = player.y - 35;

        ctx.fillStyle = "rgba(10, 15, 22, 0.9)";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x - 25, y - 22, 50, 44, 10);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 15px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(BUTTON_LABELS[buttonName], x, y);
        ctx.restore();
    }

    function drawMiniLegend(left, right) {
        ctx.save();
        ctx.fillStyle = "rgba(4, 9, 13, 0.68)";
        ctx.fillRect(18, 18, 315, 42);
        ctx.fillStyle = "#f1f5f9";
        ctx.font = "bold 15px Arial";
        ctx.textAlign = "left";
        ctx.fillText(left, 32, 44);
        ctx.fillText(right, 177, 44);
        ctx.restore();
    }

    function drawCenterMessage(title, subtitle) {
        ctx.save();
        ctx.fillStyle = "rgba(4, 9, 13, 0.78)";
        ctx.fillRect(235, 218, 530, 150);

        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.font = "bold 31px Arial";
        ctx.fillText(title, 500, 275);

        ctx.fillStyle = "#b9c5d5";
        ctx.font = "20px Arial";
        ctx.fillText(subtitle, 500, 320);
        ctx.restore();
    }

    function beep(frequency, duration) {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            const audio = new AudioContextClass();
            const oscillator = audio.createOscillator();
            const gain = audio.createGain();
            oscillator.frequency.value = frequency;
            gain.gain.value = 0.055;
            oscillator.connect(gain);
            gain.connect(audio.destination);
            oscillator.start();
            gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
            oscillator.stop(audio.currentTime + duration);
        } catch (error) {
            // Audio feedback is optional.
        }
    }

    function vibrate(duration, magnitude) {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const pad = state.gamepadIndex !== null ? pads[state.gamepadIndex] : null;
        const actuator = pad?.vibrationActuator;
        if (!actuator || typeof actuator.playEffect !== "function") return;

        actuator.playEffect("dual-rumble", {
            startDelay: 0,
            duration,
            weakMagnitude: magnitude,
            strongMagnitude: magnitude
        }).catch(() => {});
    }

    function loop(now) {
        // Always poll PS/Home, even while paused, idle, complete, or using Infinite reps.
        if (checkPsHomeButton()) return;

        const dt = Math.min((now - state.lastTime) / 1000, 0.033);
        state.lastTime = now;
        update(dt, now);
        requestAnimationFrame(loop);
    }

    function loadCatchMeterMinimumSetting() {
        const allowed = new Set(["0", "5", "10", "20"]);
        let saved = "5";

        try {
            const stored = localStorage.getItem(CATCH_METER_MIN_STORAGE_KEY);
            if (stored && allowed.has(stored)) saved = stored;
        } catch (error) {
            // localStorage may be unavailable in some private/browser modes.
        }

        if (ui.catchMeterMin) {
            ui.catchMeterMin.value = saved;
        }
        state.catchMeterMinYards = Number(saved);
    }

    function saveCatchMeterMinimumSetting() {
        if (!ui.catchMeterMin) return;

        const value = ["0", "5", "10", "20"].includes(ui.catchMeterMin.value)
            ? ui.catchMeterMin.value
            : "5";

        state.catchMeterMinYards = Number(value);

        try {
            localStorage.setItem(CATCH_METER_MIN_STORAGE_KEY, value);
        } catch (error) {
            // The selector still works for this session if storage is unavailable.
        }
    }

    loadOffenseRouteSettings();
    loadCatchMeterMinimumSetting();
    ui.catchMeterMin?.addEventListener("change", saveCatchMeterMinimumSetting);

    window.addEventListener("gamepadconnected", event => {
        state.gamepadIndex = event.gamepad.index;
    });

    window.addEventListener("gamepaddisconnected", event => {
        if (state.gamepadIndex === event.gamepad.index) {
            state.gamepadIndex = null;
        }
    });

    window.addEventListener("keydown", event => {
        if (
            ["KeyW", "KeyA", "KeyS", "KeyD", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"]
                .includes(event.code)
        ) {
            event.preventDefault();
        }

        if (state.paused) return;

        state.keysDown.add(event.code);
        const mapped = keyboardButtonForCode(event.code);
        if (mapped !== null) {
            state.keyboardButtons.add(mapped);
            if (!event.repeat) {
                state.keyboardPressed.add(mapped);
            }
        }

    });

    window.addEventListener("keyup", event => {
        state.keysDown.delete(event.code);

        const mapped = keyboardButtonForCode(event.code);
        if (mapped !== null) {
            const wasDown = state.keyboardButtons.delete(mapped);
            if (wasDown && !state.paused) {
                state.keyboardReleased.add(mapped);
            }
        }
    });

    // Universal WURD practice controls:
    // D-pad Up starts or restarts this practice.
    window.addEventListener("wurd:practice-start", () => {
        startDrill();
    });

    // D-pad Down pauses or resumes this practice.
    window.addEventListener("wurd:practice-pause", event => {
        if (!state.running || state.phase === "complete") {
            state.paused = false;
            state.pauseStartedAt = 0;

            if (window.WurdPracticeControls?.isPaused()) {
                window.WurdPracticeControls.setPaused(false);
            }
            return;
        }

        const shouldPause = Boolean(event.detail?.paused);

        if (shouldPause === state.paused) {
            return;
        }

        if (shouldPause) {
            state.paused = true;
            state.pauseStartedAt = performance.now();

            state.keysDown.clear();
            state.keyboardButtons.clear();
            state.keyboardPressed.clear();
            state.keyboardReleased.clear();

            if (state.rep?.kind === "offense" && !state.rep.thrown) {
                state.rep.throwHolding = false;
                state.rep.throwHeldAt = null;
                state.rep.throwHoldMs = 0;
            }

            if (
                state.rep?.kind === "offense" &&
                state.rep.catchMeterStarted &&
                !state.rep.catchMeterLocked
            ) {
                state.rep.catchHolding = false;
                state.rep.catchHeldAt = null;
                state.rep.catchHoldMs = 0;
                state.rep.catchButtonHeld = null;
                state.rep.catchMeterStarted = false;
                state.rep.catchMeterStartedAt = null;
                state.rep.catchMeterLocked = false;
            }

            syncCurrentControllerButtons();
            return;
        }

        const pausedFor = Number(event.detail?.pausedFor) ||
            Math.max(0, performance.now() - state.pauseStartedAt);

        state.paused = false;
        state.pauseStartedAt = 0;

        if (state.phase === "result" && state.nextRepAt > 0) {
            state.nextRepAt += pausedFor;
        }

        if (state.rep?.startedAt) {
            state.rep.startedAt += pausedFor;
        }

        state.lastTime = performance.now();
        syncCurrentControllerButtons();
    });

    ui.start.addEventListener("click", startDrill);
    ui.reset.addEventListener("click", resetDrill);

    ui.mode.addEventListener("change", () => {
        if (!state.running) {
            state.mode = ui.mode.value;
            setInstruction(
                state.mode === "offense"
                    ? "Offense mode selected. Press Start Drill."
                    : "Defense mode selected. Press Start Drill."
            );
        }
    });

    resetDrill();
    requestAnimationFrame(loop);
})();