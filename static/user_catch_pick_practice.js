(() => {
    "use strict";

    const canvas = document.getElementById("practiceCanvas");
    const ctx = canvas.getContext("2d");

    const ui = {
        mode: document.getElementById("modeSelect"),
        difficulty: document.getElementById("difficultySelect"),
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
        R1: 5
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

    const DIFFICULTIES = {
        rookie: {
            label: "Rookie",
            ballSpeed: 360,
            routeSpeed: 58,
            steerSpeed: 205,
            catchRadius: 68,
            switchStart: 0.12,
            switchEnd: 0.80,
            guideStrength: 1,
            resultDelay: 1900
        },
        pro: {
            label: "Pro",
            ballSpeed: 430,
            routeSpeed: 67,
            steerSpeed: 220,
            catchRadius: 55,
            switchStart: 0.20,
            switchEnd: 0.70,
            guideStrength: 0.78,
            resultDelay: 1700
        },
        allPro: {
            label: "All-Pro",
            ballSpeed: 505,
            routeSpeed: 76,
            steerSpeed: 235,
            catchRadius: 44,
            switchStart: 0.27,
            switchEnd: 0.62,
            guideStrength: 0.36,
            resultDelay: 1500
        },
        allMadden: {
            label: "All-Madden",
            ballSpeed: 585,
            routeSpeed: 84,
            steerSpeed: 248,
            catchRadius: 36,
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
        keysDown: new Set(),
        gamepadIndex: null,
        flash: null,
        paused: false,
        pauseStartedAt: 0
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
        ui.rep.textContent = `${state.completedReps} / ${state.totalReps}`;
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
        state.totalReps = Number(ui.reps.value);
        state.completedReps = 0;
        state.successCount = 0;
        state.streak = 0;
        state.totalScore = 0;
        state.running = true;
        state.nextRepAt = 0;
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
            setInstruction(
                `Lead away from the defender and throw to ${BUTTON_LABELS[state.rep.throwButton]}.`
            );
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
        const routeType = randomChoice(["go", "slantLeft", "slantRight", "outLeft", "outRight"]);
        const receiver = {
            x: randomRange(300, 700),
            y: 475,
            vx: 0,
            vy: -currentDifficulty().routeSpeed,
            radius: 18
        };

        if (routeType === "slantLeft") receiver.vx = -34;
        if (routeType === "slantRight") receiver.vx = 34;
        if (routeType === "outLeft") receiver.vx = -53;
        if (routeType === "outRight") receiver.vx = 53;

        const leverage = randomChoice(["left", "right", "trail", "top"]);
        const defender = {
            x: receiver.x,
            y: receiver.y,
            vx: receiver.vx * 0.92,
            vy: receiver.vy * 0.96,
            radius: 18
        };

        if (leverage === "left") defender.x -= 38;
        if (leverage === "right") defender.x += 38;
        if (leverage === "trail") defender.y += 42;
        if (leverage === "top") defender.y -= 42;

        const catchType = randomChoice([
            { button: "X", name: "Possession" },
            { button: "SQUARE", name: "RAC" },
            { button: "TRIANGLE", name: "Aggressive" }
        ]);

        return {
            kind: "offense",
            routeType,
            leverage,
            qb: { x: 500, y: 555 },
            receiver,
            defender,
            ball: null,
            reticle: { x: receiver.x, y: receiver.y - 125 },
            safePoint: { x: receiver.x, y: receiver.y - 125 },
            throwButton: randomChoice(THROW_BUTTONS),
            catchType,
            thrown: false,
            switched: false,
            catchAttempted: false,
            success: false,
            placementPoints: 0,
            switchPoints: 0,
            movementPoints: 0,
            catchPoints: 0,
            switchedAt: null,
            catchAttemptAt: null,
            resultReason: "",
            startedAt: performance.now()
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
                elapsed: 0
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
                if (button.pressed && !wasPressed) {
                    pressed.add(index);
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
        state.keyboardPressed.clear();

        return {
            axisX: clamp(axisX, -1, 1),
            axisY: clamp(axisY, -1, 1),
            pressed
        };
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

        if (state.phase === "result") {
            if (now >= state.nextRepAt) {
                beginRep();
            }
            draw();
            return;
        }

        if (state.rep.kind === "offense") {
            updateOffense(dt, input);
        } else {
            updateDefense(dt, input);
        }

        draw();
    }

    function updateOffense(dt, input) {
        const rep = state.rep;
        const difficulty = currentDifficulty();

        if (!rep.thrown) {
            moveAutoRoute(rep.receiver, dt);
            moveDefender(rep.defender, rep.receiver, dt, 0.74);

            const projectedReceiver = {
                x: rep.receiver.x + rep.receiver.vx * 1.35,
                y: rep.receiver.y + rep.receiver.vy * 1.35
            };

            const away = normalize(
                projectedReceiver.x - rep.defender.x,
                projectedReceiver.y - rep.defender.y
            );

            rep.safePoint.x = clamp(projectedReceiver.x + away.x * 95, 95, 905);
            rep.safePoint.y = clamp(projectedReceiver.y + away.y * 78, 80, 445);

            rep.reticle.x = clamp(projectedReceiver.x + input.axisX * 120, 65, 935);
            rep.reticle.y = clamp(projectedReceiver.y + input.axisY * 105, 65, 465);

            if (pressed(input, rep.throwButton)) {
                throwOffensePass(rep);
            } else {
                for (const name of THROW_BUTTONS) {
                    if (name !== rep.throwButton && pressed(input, name)) {
                        setTiming(`Wrong receiver button. Use ${BUTTON_LABELS[rep.throwButton]}.`, "bad");
                        vibrate(80, 0.35);
                    }
                }
            }
            return;
        }

        updateBall(rep.ball, dt);

        moveDefender(rep.defender, rep.receiver, dt, 0.68);

        if (!rep.switched) {
            moveAutoRoute(rep.receiver, dt);
            if (pressed(input, "CIRCLE")) {
                rep.switched = true;
                rep.switchedAt = rep.ball.progress;
                rep.switchPoints = scoreSwitchTiming(rep.ball.progress, difficulty);
                setTiming(switchTimingLabel(rep.switchPoints), rep.switchPoints >= 18 ? "good" : "warn");
                setInstruction(
                    `Steer to the ball and press ${BUTTON_LABELS[rep.catchType.button]} for a ${rep.catchType.name} catch.`
                );
                vibrate(45, 0.22);
            }
        } else {
            rep.receiver.x = clamp(
                rep.receiver.x + input.axisX * difficulty.steerSpeed * dt,
                35,
                965
            );
            rep.receiver.y = clamp(
                rep.receiver.y + input.axisY * difficulty.steerSpeed * dt,
                45,
                520
            );
        }

        const catchButtons = ["X", "SQUARE", "TRIANGLE"];
        for (const buttonName of catchButtons) {
            if (pressed(input, buttonName)) {
                attemptOffenseCatch(rep, buttonName);
                break;
            }
        }

        if (rep.ball.progress >= 1.06 && !rep.catchAttempted) {
            rep.resultReason = rep.switched ? "No catch input" : "No click-on";
            finishRep(false);
        }
    }

    function throwOffensePass(rep) {
        rep.thrown = true;
        const distToSafe = distance(rep.reticle, rep.safePoint);
        rep.placementPoints = Math.round(clamp(1 - distToSafe / 190, 0, 1) * 40);

        const dist = distance(rep.qb, rep.reticle);
        rep.ball = {
            start: { ...rep.qb },
            target: { ...rep.reticle },
            x: rep.qb.x,
            y: rep.qb.y,
            progress: 0,
            duration: dist / currentDifficulty().ballSpeed,
            elapsed: 0
        };

        if (rep.placementPoints >= 32) {
            setTiming("Good placement—click on now.", "good");
        } else if (rep.placementPoints >= 20) {
            setTiming("Catchable, but lead farther from coverage.", "warn");
        } else {
            setTiming("Throw is too close to the defender.", "bad");
        }
        setInstruction("Press Circle to click on to the receiver.");
        beep(520, 0.05);
    }

    function attemptOffenseCatch(rep, buttonName) {
        if (rep.catchAttempted || !rep.ball) return;

        const ballDistance = distance(rep.receiver, rep.ball);
        const catchRadius = currentDifficulty().catchRadius;
        const inWindow = ballDistance <= catchRadius;

        if (!inWindow) {
            if (rep.ball.progress < 0.72) {
                setTiming("Catch button too early.", "warn");
            } else {
                setTiming("Move closer to the ball.", "bad");
            }
            return;
        }

        rep.catchAttempted = true;
        rep.catchAttemptAt = rep.ball.progress;

        const movementQuality = clamp(1 - ballDistance / catchRadius, 0, 1);
        rep.movementPoints = Math.round(movementQuality * 15);

        const correctCatch = buttonName === rep.catchType.button;
        rep.catchPoints = correctCatch ? 20 : 11;

        const success =
            rep.switched &&
            rep.placementPoints >= 16 &&
            rep.switchPoints >= 8 &&
            rep.movementPoints >= 5;

        rep.resultReason = correctCatch
            ? `${rep.catchType.name} catch`
            : `Caught, but ${BUTTON_LABELS[rep.catchType.button]} fit the situation better`;

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
            ? rep.placementPoints + rep.switchPoints + rep.movementPoints + rep.catchPoints
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
                feedbackPlacement(rep.placementPoints),
                feedbackSwitch(rep.switchPoints),
                feedbackMovement(rep.movementPoints),
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

    function moveAutoRoute(player, dt) {
        player.x = clamp(player.x + player.vx * dt, 38, 962);
        player.y = clamp(player.y + player.vy * dt, 55, 525);
    }

    function moveDefender(defender, receiver, dt, followStrength) {
        const dx = receiver.x - defender.x;
        const dy = receiver.y - defender.y;
        defender.x += (defender.vx + dx * followStrength) * dt;
        defender.y += (defender.vy + dy * followStrength) * dt;
        defender.x = clamp(defender.x, 38, 962);
        defender.y = clamp(defender.y, 55, 525);
    }

    function updateBall(ball, dt) {
        ball.elapsed += dt;
        ball.progress = ball.elapsed / ball.duration;
        const t = clamp(ball.progress, 0, 1);
        ball.x = lerp(ball.start.x, ball.target.x, t);
        ball.y = lerp(ball.start.y, ball.target.y, t) - Math.sin(Math.PI * t) * 72;
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

        for (let y = 70; y <= 550; y += 60) {
            ctx.beginPath();
            ctx.moveTo(30, y);
            ctx.lineTo(970, y);
            ctx.stroke();

            ctx.fillStyle = "rgba(255,255,255,0.45)";
            ctx.font = "16px Arial";
            ctx.fillText(String(Math.round((550 - y) / 6)), 45, y - 7);
            ctx.fillText(String(Math.round((550 - y) / 6)), 925, y - 7);
        }

        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.setLineDash([8, 9]);
        for (let x = 210; x <= 790; x += 145) {
            ctx.beginPath();
            ctx.moveTo(x, 25);
            ctx.lineTo(x, 575);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    function drawOffense(rep) {
        if (!rep.thrown) {
            drawGuide(rep);
            drawReticle(rep.reticle, "#ffd166");
        }

        drawPlayer(rep.defender, "#f55c69", "D", false);
        drawPlayer(
            rep.receiver,
            "#5ca8ff",
            BUTTON_SYMBOLS[rep.throwButton],
            rep.switched
        );

        drawPlayer(rep.qb, "#d7dde8", "QB", false);

        if (rep.ball) {
            drawBall(rep.ball);
        }

        if (rep.thrown && rep.switched) {
            drawCatchPrompt(rep.receiver, rep.catchType.button);
        }

        drawMiniLegend("Blue = receiver", "Red = defender");
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

    function drawGuide(rep) {
        const strength = currentDifficulty().guideStrength;
        if (strength <= 0) return;

        ctx.save();
        ctx.globalAlpha = strength * 0.42;
        ctx.fillStyle = "#26d07c";
        ctx.beginPath();
        ctx.arc(rep.safePoint.x, rep.safePoint.y, 52, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = strength;
        ctx.strokeStyle = "#7bf0b2";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(rep.safePoint.x, rep.safePoint.y, 52, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = "#d9ffea";
        ctx.font = "bold 17px Arial";
        ctx.textAlign = "center";
        ctx.fillText("SAFE LEAD", rep.safePoint.x, rep.safePoint.y - 62);
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

    function drawReticle(point, color) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 24, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(point.x - 34, point.y);
        ctx.lineTo(point.x + 34, point.y);
        ctx.moveTo(point.x, point.y - 34);
        ctx.lineTo(point.x, point.y + 34);
        ctx.stroke();
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
        const dt = Math.min((now - state.lastTime) / 1000, 0.033);
        state.lastTime = now;
        update(dt, now);
        requestAnimationFrame(loop);
    }

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
        if (mapped !== null && !event.repeat) {
            state.keyboardPressed.add(mapped);
        }

    });

    window.addEventListener("keyup", event => {
        state.keysDown.delete(event.code);
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

            // Clear keyboard input and record currently held controller
            // buttons so nothing fires beneath the pause overlay.
            state.keysDown.clear();
            state.keyboardPressed.clear();
            syncCurrentControllerButtons();
            return;
        }

        const pausedFor = Number(event.detail?.pausedFor) ||
            Math.max(0, performance.now() - state.pauseStartedAt);

        state.paused = false;
        state.pauseStartedAt = 0;

        // The result screen uses an absolute deadline. Move it forward
        // so the next repetition waits for the same remaining time.
        if (state.phase === "result" && state.nextRepAt > 0) {
            state.nextRepAt += pausedFor;
        }

        // Preserve any timestamps stored on the active repetition.
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
