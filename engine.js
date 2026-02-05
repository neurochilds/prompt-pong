(() => {
  "use strict";

  const WIDTH = 800;
  const HEIGHT = 500;
  const WIN_SCORE = 11;
  const START_LIVES = 3;

  const BASE_BALL_SPEED = 320;
  const BALL_ACCELERATION = 10;
  const MAX_BOUNCE_ANGLE = Math.PI * 0.38;
  const SERVE_DELAY = 1.1;
  const MAX_BALLS = 4;

  const PADDLE_WIDTH = 14;
  const BASE_PADDLE_HEIGHT = 92;
  const PLAYER_X = 24;
  const ENEMY_X = WIDTH - PLAYER_X - PADDLE_WIDTH;

  const POWERUP_RADIUS = 12;
  const POWERUP_DURATION = 9000;
  const POWERUP_TYPES = new Set([
    "speed_boost",
    "multi_ball",
    "paddle_grow",
    "paddle_shrink"
  ]);

  const canvas = document.getElementById("game");
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.style.touchAction = "none";

  const logEl = document.getElementById("agentLog");
  const meterCodexEl = document.getElementById("meterCodex");
  const meterClaudeEl = document.getElementById("meterClaude");

  const playerPaddle = {
    x: PLAYER_X,
    y: HEIGHT / 2 - BASE_PADDLE_HEIGHT / 2,
    width: PADDLE_WIDTH,
    height: BASE_PADDLE_HEIGHT,
    baseHeight: BASE_PADDLE_HEIGHT,
    color: "#23f7ff"
  };

  const enemyPaddle = {
    x: ENEMY_X,
    y: HEIGHT / 2 - BASE_PADDLE_HEIGHT / 2,
    width: PADDLE_WIDTH,
    height: BASE_PADDLE_HEIGHT,
    baseHeight: BASE_PADDLE_HEIGHT,
    color: "#ff45cd"
  };

  const state = {
    running: false,
    gameOver: false,
    winner: null,
    score: {
      player: 0,
      enemy: 0
    },
    lives: START_LIVES,
    elapsedSec: 0,
    difficulty: 1,
    serving: true,
    serveTimerSec: SERVE_DELAY,
    pointerY: HEIGHT / 2,
    enemyTarget: HEIGHT / 2,
    balls: [],
    powerups: [],
    nextPowerupId: 1,
    effects: {
      playerGrowUntilMs: 0,
      enemyShrinkUntilMs: 0
    },
    contribution: {
      codex: 50,
      claude: 50
    },
    directorInitErrorLogged: false,
    directorUpdateErrorLogged: false,
    fallbackLogged: false
  };

  const directorApi = {
    setEnemyTarget(y) {
      if (!Number.isFinite(y)) {
        return;
      }
      state.enemyTarget = clamp(y, enemyPaddle.height / 2, HEIGHT - enemyPaddle.height / 2);
    },
    spawnPowerup(spec) {
      spawnPowerup(spec);
    },
    logThought(agent, text) {
      appendLog(agent, text);
    },
    setContribution(payload) {
      setContribution(payload);
    }
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function randomRange(min, max) {
    return min + Math.random() * (max - min);
  }

  function getDirector() {
    if (window.Director === null || window.Director === undefined) {
      return null;
    }
    const type = typeof window.Director;
    return type === "object" || type === "function" ? window.Director : null;
  }

  function appendLog(agent, text) {
    if (!logEl || typeof text !== "string" || text.trim() === "") {
      return;
    }
    const entry = document.createElement("div");
    entry.className = "agentLogEntry";
    entry.textContent = `${agent || "Agent"}: ${text.trim()}`;
    logEl.appendChild(entry);
    while (logEl.childElementCount > 80) {
      logEl.removeChild(logEl.firstChild);
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setContribution(payload = {}) {
    let codex = state.contribution.codex;
    let claude = state.contribution.claude;

    if (Number.isFinite(payload.codex)) {
      codex = clamp(payload.codex, 0, 100);
    }
    if (Number.isFinite(payload.claude)) {
      claude = clamp(payload.claude, 0, 100);
    }
    if (Number.isFinite(payload.codex) && !Number.isFinite(payload.claude)) {
      claude = clamp(100 - codex, 0, 100);
    }
    if (!Number.isFinite(payload.codex) && Number.isFinite(payload.claude)) {
      codex = clamp(100 - claude, 0, 100);
    }

    state.contribution.codex = codex;
    state.contribution.claude = claude;

    if (meterCodexEl) {
      meterCodexEl.style.width = `${codex}%`;
    }
    if (meterClaudeEl) {
      meterClaudeEl.style.width = `${claude}%`;
    }
  }

  function emitDirectorEvent(evt) {
    const director = getDirector();
    if (!director || typeof director.onEvent !== "function") {
      return;
    }
    try {
      director.onEvent(evt);
    } catch (err) {
      if (!state.directorUpdateErrorLogged) {
        appendLog("Engine", "Director.onEvent failed, continuing with local engine state.");
        state.directorUpdateErrorLogged = true;
      }
      void err;
    }
  }

  function spawnPowerup(spec = {}) {
    if (typeof spec !== "object" || spec === null) {
      return;
    }
    if (!POWERUP_TYPES.has(spec.type)) {
      return;
    }

    const ttlMs = Number.isFinite(spec.ttlMs) ? clamp(spec.ttlMs, 600, 20000) : 7000;
    const x = Number.isFinite(spec.x) ? clamp(spec.x, 120, WIDTH - 120) : randomRange(180, WIDTH - 180);
    const y = Number.isFinite(spec.y) ? clamp(spec.y, 40, HEIGHT - 40) : randomRange(40, HEIGHT - 40);

    state.powerups.push({
      id: state.nextPowerupId++,
      type: spec.type,
      x,
      y,
      r: POWERUP_RADIUS,
      expiresAtMs: state.elapsedSec * 1000 + ttlMs
    });
  }

  function initDirector() {
    const director = getDirector();
    if (!director || typeof director.init !== "function") {
      if (!state.fallbackLogged) {
        appendLog("Codex", "Director unavailable. Running fallback enemy AI.");
        state.fallbackLogged = true;
      }
      setContribution({ codex: 70, claude: 30 });
      return;
    }

    try {
      director.init(directorApi);
      appendLog("Codex", "Director connected.");
    } catch (err) {
      if (!state.directorInitErrorLogged) {
        appendLog("Codex", "Director init failed. Using fallback enemy AI.");
        state.directorInitErrorLogged = true;
      }
      setContribution({ codex: 75, claude: 25 });
      void err;
    }
  }

  function createBall(direction = Math.random() < 0.5 ? -1 : 1, yOffset = 0) {
    return {
      x: WIDTH / 2,
      y: HEIGHT / 2 + yOffset,
      r: 8,
      vx: 0,
      vy: 0,
      serveDirection: direction
    };
  }

  function queueServe(lastPointWinner = null) {
    state.serving = true;
    state.serveTimerSec = SERVE_DELAY;
    const direction =
      lastPointWinner === "player"
        ? 1
        : lastPointWinner === "enemy"
          ? -1
          : Math.random() < 0.5
            ? -1
            : 1;
    state.balls = [createBall(direction)];
    state.powerups = [];
    emitDirectorEvent("serve");
  }

  function launchBall(ball) {
    const angle = randomRange(-0.45, 0.45);
    const speed = BASE_BALL_SPEED * (1 + (state.difficulty - 1) * 0.16);
    ball.vx = ball.serveDirection * speed * Math.cos(angle);
    ball.vy = speed * Math.sin(angle);
  }

  function updatePlayerPaddle() {
    const desiredTop = clamp(state.pointerY - playerPaddle.height / 2, 0, HEIGHT - playerPaddle.height);
    playerPaddle.y = desiredTop;
  }

  function updateEnemyPaddle(dt) {
    const targetTop = clamp(state.enemyTarget - enemyPaddle.height / 2, 0, HEIGHT - enemyPaddle.height);
    const delta = targetTop - enemyPaddle.y;
    const maxStep = (360 + state.difficulty * 65) * dt;
    if (Math.abs(delta) <= maxStep) {
      enemyPaddle.y = targetTop;
    } else {
      enemyPaddle.y += Math.sign(delta) * maxStep;
    }
    enemyPaddle.y = clamp(enemyPaddle.y, 0, HEIGHT - enemyPaddle.height);
  }

  function predictBallYAtX(ball, targetX) {
    if (ball.vx <= 0) {
      return HEIGHT / 2;
    }
    const time = (targetX - ball.x) / ball.vx;
    if (!Number.isFinite(time) || time <= 0) {
      return ball.y;
    }

    let y = ball.y + ball.vy * time;
    const minY = ball.r;
    const maxY = HEIGHT - ball.r;

    while (y < minY || y > maxY) {
      if (y < minY) {
        y = minY + (minY - y);
      }
      if (y > maxY) {
        y = maxY - (y - maxY);
      }
    }
    return y;
  }

  function runFallbackAI(t) {
    if (!state.balls.length) {
      state.enemyTarget = HEIGHT / 2;
      return;
    }

    let trackedBall = state.balls[0];
    for (let i = 0; i < state.balls.length; i += 1) {
      const ball = state.balls[i];
      if (ball.vx > 0 && ball.x > trackedBall.x) {
        trackedBall = ball;
      }
    }

    const predictedY = predictBallYAtX(trackedBall, enemyPaddle.x - trackedBall.r);
    const jitter = Math.sin(t * 2.0) * (18 / Math.max(1, state.difficulty));
    state.enemyTarget = clamp(
      predictedY + jitter,
      enemyPaddle.height / 2,
      HEIGHT - enemyPaddle.height / 2
    );
  }

  function snapshotPaddle(paddle) {
    return {
      x: paddle.x,
      y: paddle.y,
      width: paddle.width,
      height: paddle.height
    };
  }

  function snapshotBall(ball) {
    return ball
      ? {
          x: ball.x,
          y: ball.y,
          vx: ball.vx,
          vy: ball.vy,
          r: ball.r
        }
      : null;
  }

  function callDirectorUpdate(t, dt) {
    const director = getDirector();
    if (!director || typeof director.update !== "function") {
      runFallbackAI(t);
      return;
    }

    try {
      director.update({
        t,
        dt,
        score: {
          player: state.score.player,
          enemy: state.score.enemy,
          lives: state.lives
        },
        ball: snapshotBall(state.balls[0] || null),
        playerPaddle: snapshotPaddle(playerPaddle),
        enemyPaddle: snapshotPaddle(enemyPaddle),
        difficulty: state.difficulty
      });
    } catch (err) {
      if (!state.directorUpdateErrorLogged) {
        appendLog("Engine", "Director update crashed. Fallback AI enabled.");
        state.directorUpdateErrorLogged = true;
      }
      runFallbackAI(t);
      void err;
    }
  }

  function intersectsPaddle(ball, paddle) {
    return (
      ball.x + ball.r > paddle.x &&
      ball.x - ball.r < paddle.x + paddle.width &&
      ball.y + ball.r > paddle.y &&
      ball.y - ball.r < paddle.y + paddle.height
    );
  }

  function accelerateBall(ball, dt) {
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed <= 0) {
      return;
    }
    const boosted = Math.min(speed + BALL_ACCELERATION * state.difficulty * dt, 920);
    const scale = boosted / speed;
    ball.vx *= scale;
    ball.vy *= scale;
  }

  function bounceFromPaddle(ball, paddle, isPlayerSide) {
    const paddleCenter = paddle.y + paddle.height / 2;
    const relative = clamp((ball.y - paddleCenter) / (paddle.height / 2), -1, 1);
    const angle = relative * MAX_BOUNCE_ANGLE;

    let speed = Math.hypot(ball.vx, ball.vy);
    const minSpeed = BASE_BALL_SPEED * (0.9 + state.difficulty * 0.24);
    speed = Math.max(speed * 1.04, minSpeed);

    const direction = isPlayerSide ? 1 : -1;
    ball.vx = direction * speed * Math.cos(angle);
    ball.vy = speed * Math.sin(angle);

    if (isPlayerSide) {
      ball.x = paddle.x + paddle.width + ball.r;
    } else {
      ball.x = paddle.x - ball.r;
    }
  }

  function removeExpiredPowerups() {
    const nowMs = state.elapsedSec * 1000;
    state.powerups = state.powerups.filter((powerup) => powerup.expiresAtMs > nowMs);
  }

  function pickupPowerup(ball) {
    for (let i = 0; i < state.powerups.length; i += 1) {
      const powerup = state.powerups[i];
      const dx = ball.x - powerup.x;
      const dy = ball.y - powerup.y;
      const hitDistance = ball.r + powerup.r;
      if (dx * dx + dy * dy <= hitDistance * hitDistance) {
        state.powerups.splice(i, 1);
        return powerup;
      }
    }
    return null;
  }

  function spawnExtraBall(fromBall) {
    if (state.balls.length >= MAX_BALLS) {
      return;
    }

    const baseSpeed = Math.max(BASE_BALL_SPEED, Math.hypot(fromBall.vx, fromBall.vy));
    const sourceAngle = Math.atan2(fromBall.vy, fromBall.vx);
    const splitAngle = sourceAngle + (Math.random() < 0.5 ? -0.55 : 0.55);
    const vx = baseSpeed * Math.cos(splitAngle);
    const vy = baseSpeed * Math.sin(splitAngle);

    state.balls.push({
      x: fromBall.x,
      y: fromBall.y,
      r: fromBall.r,
      vx: Math.abs(vx) < 130 ? Math.sign(vx || 1) * 130 : vx,
      vy,
      serveDirection: vx >= 0 ? 1 : -1
    });
  }

  function applyPowerup(powerup, ball) {
    switch (powerup.type) {
      case "speed_boost": {
        ball.vx *= 1.28;
        ball.vy *= 1.28;
        break;
      }
      case "multi_ball": {
        spawnExtraBall(ball);
        break;
      }
      case "paddle_grow": {
        state.effects.playerGrowUntilMs = Math.max(
          state.effects.playerGrowUntilMs,
          state.elapsedSec * 1000 + POWERUP_DURATION
        );
        break;
      }
      case "paddle_shrink": {
        state.effects.enemyShrinkUntilMs = Math.max(
          state.effects.enemyShrinkUntilMs,
          state.elapsedSec * 1000 + POWERUP_DURATION
        );
        break;
      }
      default:
        break;
    }
  }

  function updatePaddleEffects() {
    const nowMs = state.elapsedSec * 1000;

    const playerTargetHeight =
      nowMs < state.effects.playerGrowUntilMs
        ? playerPaddle.baseHeight * 1.45
        : playerPaddle.baseHeight;
    const enemyTargetHeight =
      nowMs < state.effects.enemyShrinkUntilMs
        ? enemyPaddle.baseHeight * 0.62
        : enemyPaddle.baseHeight;

    playerPaddle.height += (playerTargetHeight - playerPaddle.height) * 0.2;
    enemyPaddle.height += (enemyTargetHeight - enemyPaddle.height) * 0.2;

    playerPaddle.height = clamp(playerPaddle.height, 46, 220);
    enemyPaddle.height = clamp(enemyPaddle.height, 40, 220);

    playerPaddle.y = clamp(playerPaddle.y, 0, HEIGHT - playerPaddle.height);
    enemyPaddle.y = clamp(enemyPaddle.y, 0, HEIGHT - enemyPaddle.height);
  }

  function awardPoint(side) {
    if (side === "player") {
      state.score.player += 1;
    } else {
      state.score.enemy += 1;
      state.lives = Math.max(0, state.lives - 1);
      emitDirectorEvent("life_lost");
    }
    emitDirectorEvent("score");

    if (
      state.lives <= 0 ||
      state.score.player >= WIN_SCORE ||
      state.score.enemy >= WIN_SCORE
    ) {
      state.gameOver = true;
      state.serving = false;
      state.balls = [];
      if (state.lives <= 0 || state.score.enemy >= WIN_SCORE) {
        state.winner = "enemy";
      } else {
        state.winner = "player";
      }
      return;
    }

    queueServe(side);
  }

  function updateBalls(dt) {
    for (let i = 0; i < state.balls.length; i += 1) {
      const ball = state.balls[i];
      accelerateBall(ball, dt);

      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      if (ball.y - ball.r <= 0 && ball.vy < 0) {
        ball.y = ball.r;
        ball.vy *= -1;
        emitDirectorEvent("wall_hit");
      } else if (ball.y + ball.r >= HEIGHT && ball.vy > 0) {
        ball.y = HEIGHT - ball.r;
        ball.vy *= -1;
        emitDirectorEvent("wall_hit");
      }

      if (ball.vx < 0 && intersectsPaddle(ball, playerPaddle)) {
        bounceFromPaddle(ball, playerPaddle, true);
        emitDirectorEvent("paddle_hit");
      } else if (ball.vx > 0 && intersectsPaddle(ball, enemyPaddle)) {
        bounceFromPaddle(ball, enemyPaddle, false);
        emitDirectorEvent("enemy_hit");
      }

      const touchedPowerup = pickupPowerup(ball);
      if (touchedPowerup) {
        applyPowerup(touchedPowerup, ball);
      }

      if (ball.x + ball.r < 0) {
        awardPoint("enemy");
        return;
      }
      if (ball.x - ball.r > WIDTH) {
        awardPoint("player");
        return;
      }
    }
  }

  function update(dt, t) {
    if (!state.running) {
      return;
    }

    state.elapsedSec += dt;
    state.difficulty = 1 + Math.min(state.elapsedSec * 0.03, 2.4);

    updatePaddleEffects();
    updatePlayerPaddle();
    callDirectorUpdate(t, dt);
    updateEnemyPaddle(dt);
    removeExpiredPowerups();

    if (state.gameOver) {
      return;
    }

    if (state.serving) {
      state.serveTimerSec -= dt;
      for (let i = 0; i < state.balls.length; i += 1) {
        state.balls[i].x = WIDTH / 2;
        state.balls[i].y = HEIGHT / 2 + i * 14;
      }
      if (state.serveTimerSec <= 0) {
        state.serving = false;
        for (let i = 0; i < state.balls.length; i += 1) {
          launchBall(state.balls[i]);
        }
      }
      return;
    }

    updateBalls(dt);
  }

  function drawCenterLine() {
    ctx.save();
    ctx.setLineDash([10, 12]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(WIDTH / 2, 16);
    ctx.lineTo(WIDTH / 2, HEIGHT - 16);
    ctx.stroke();
    ctx.restore();
  }

  function drawPaddle(paddle, color) {
    ctx.save();
    ctx.shadowBlur = 18;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);
    ctx.restore();
  }

  function drawBall(ball) {
    ctx.save();
    ctx.shadowBlur = 20;
    ctx.shadowColor = "#ffe85a";
    ctx.fillStyle = "#fff07a";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPowerups() {
    const colorByType = {
      speed_boost: "#ff9e2b",
      multi_ball: "#54ff9f",
      paddle_grow: "#67dbff",
      paddle_shrink: "#ff7de4"
    };
    const iconByType = {
      speed_boost: "S",
      multi_ball: "M",
      paddle_grow: "+",
      paddle_shrink: "-"
    };

    for (let i = 0; i < state.powerups.length; i += 1) {
      const powerup = state.powerups[i];
      const color = colorByType[powerup.type] || "#ffffff";

      ctx.save();
      ctx.shadowBlur = 16;
      ctx.shadowColor = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(powerup.x, powerup.y, powerup.r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(iconByType[powerup.type] || "?", powerup.x, powerup.y + 0.5);
      ctx.restore();
    }
  }

  function drawHud() {
    ctx.save();
    ctx.fillStyle = "#f6f3ff";
    ctx.font = "700 34px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${state.score.player}  :  ${state.score.enemy}`, WIDTH / 2, 44);

    ctx.font = "600 18px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#8ee6ff";
    ctx.fillText(`Lives: ${state.lives}`, 18, 30);

    ctx.textAlign = "right";
    ctx.fillStyle = "#ffa9f0";
    ctx.fillText(`Difficulty: ${state.difficulty.toFixed(2)}x`, WIDTH - 18, 30);
    ctx.restore();
  }

  function drawServeBanner() {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.font = "700 24px monospace";
    ctx.fillText("Serve!", WIDTH / 2, HEIGHT / 2 - 24);
    ctx.font = "500 14px monospace";
    ctx.fillStyle = "rgba(210, 230, 255, 0.9)";
    ctx.fillText("Move your paddle with mouse or touch", WIDTH / 2, HEIGHT / 2 + 6);
    ctx.restore();
  }

  function drawGameOverScreen() {
    ctx.save();
    ctx.fillStyle = "rgba(5, 3, 15, 0.78)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 44px monospace";
    ctx.fillText("GAME OVER", WIDTH / 2, HEIGHT / 2 - 44);

    ctx.font = "700 24px monospace";
    if (state.winner === "player") {
      ctx.fillStyle = "#6dffd5";
      ctx.fillText("Player wins the boss fight.", WIDTH / 2, HEIGHT / 2 + 4);
    } else {
      ctx.fillStyle = "#ff9bd9";
      ctx.fillText("Enemy wins the boss fight.", WIDTH / 2, HEIGHT / 2 + 4);
    }

    ctx.font = "500 16px monospace";
    ctx.fillStyle = "#d9dcff";
    ctx.fillText("Tap or click to restart.", WIDTH / 2, HEIGHT / 2 + 44);
    ctx.restore();
  }

  function render() {
    const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    bg.addColorStop(0, "#050813");
    bg.addColorStop(1, "#13051f");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    drawCenterLine();
    drawPowerups();
    drawPaddle(playerPaddle, playerPaddle.color);
    drawPaddle(enemyPaddle, enemyPaddle.color);
    for (let i = 0; i < state.balls.length; i += 1) {
      drawBall(state.balls[i]);
    }
    drawHud();

    if (state.serving && !state.gameOver) {
      drawServeBanner();
    }
    if (state.gameOver) {
      drawGameOverScreen();
    }
  }

  function restartMatch() {
    state.gameOver = false;
    state.winner = null;
    state.score.player = 0;
    state.score.enemy = 0;
    state.lives = START_LIVES;
    state.elapsedSec = 0;
    state.difficulty = 1;
    state.powerups = [];
    state.effects.playerGrowUntilMs = 0;
    state.effects.enemyShrinkUntilMs = 0;

    playerPaddle.height = playerPaddle.baseHeight;
    enemyPaddle.height = enemyPaddle.baseHeight;
    playerPaddle.y = HEIGHT / 2 - playerPaddle.height / 2;
    enemyPaddle.y = HEIGHT / 2 - enemyPaddle.height / 2;

    queueServe(null);
  }

  function updatePointerFromClientY(clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaledY = (clientY - rect.top) * (canvas.height / rect.height);
    state.pointerY = clamp(scaledY, 0, HEIGHT);
  }

  function attachInputHandlers() {
    canvas.addEventListener("pointermove", (event) => {
      updatePointerFromClientY(event.clientY);
    });

    canvas.addEventListener("pointerdown", (event) => {
      updatePointerFromClientY(event.clientY);
      if (state.gameOver) {
        restartMatch();
      }
    });

    canvas.addEventListener(
      "touchmove",
      (event) => {
        if (!event.touches.length) {
          return;
        }
        updatePointerFromClientY(event.touches[0].clientY);
        event.preventDefault();
      },
      { passive: false }
    );
  }

  function frame(nowMs) {
    if (!state.running) {
      return;
    }

    if (!frame.lastTimeMs) {
      frame.lastTimeMs = nowMs;
    }
    const dt = Math.min((nowMs - frame.lastTimeMs) / 1000, 0.0333);
    frame.lastTimeMs = nowMs;

    update(dt, nowMs / 1000);
    render();
    window.requestAnimationFrame(frame);
  }

  function init() {
    attachInputHandlers();
    setContribution({ codex: 50, claude: 50 });
    initDirector();
    queueServe(null);

    state.running = true;
    window.requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
